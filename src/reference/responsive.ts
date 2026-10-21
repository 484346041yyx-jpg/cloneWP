import type { Page } from 'playwright';
import { observeSourceReadiness, type SourceReadiness } from './readiness.js';

export interface ResponsiveWidthDiscovery {
  breakpoints: number[];
  conditions: Array<{ condition: string; matches: boolean; widthBreakpoints: number[]; stylesheetIndex: number }>;
  gaps: string[]; visitedRules: number;
}
export interface LiveViewportFacts {
  innerWidth: number; clientWidth: number; devicePixelRatio: number;
  touch: boolean; coarsePointer: boolean;
}

/** CSS declarations are evidence, not guessed framework defaults. Cross-origin CSS stays a gap. */
export async function discoverResponsiveWidths(page: Page, limits: { maxRules?: number; maxBreakpoints?: number } = {}): Promise<ResponsiveWidthDiscovery> {
  const maxRules = limits.maxRules ?? 6000, maxBreakpoints = limits.maxBreakpoints ?? 32;
  if (!Number.isInteger(maxRules) || maxRules < 1 || maxRules > 24000 || !Number.isInteger(maxBreakpoints) || maxBreakpoints < 1 || maxBreakpoints > 64) throw new Error('Responsive CSS discovery limits must be bounded positive integers');
  return page.evaluate(({ maxRules, maxBreakpoints }) => {
    const breakpoints = new Set<number>(), conditions: ResponsiveWidthDiscovery['conditions'] = [], gaps = new Set<string>(); let visitedRules = 0;
    const inspect = (rules: CSSRuleList, stylesheetIndex: number) => {
      for (const rule of Array.from(rules)) {
        if (++visitedRules > maxRules) { gaps.add('Stylesheet rule inspection reached its bounded limit; undiscovered breakpoints remain unverified.'); return; }
        const typed = rule as CSSRule & { media?: MediaList; conditionText?: string; cssRules?: CSSRuleList };
        if (rule.constructor.name === 'CSSContainerRule') gaps.add('Container-query layout conditions require element-container measurements; viewport width probes cannot establish their equivalence.');
        if (typed.media) {
          const condition = (typed.conditionText || typed.media.mediaText || '').slice(0,2000), widths: number[] = [];
          for (const pattern of [/\b(?:min-|max-)?width\s*:\s*(\d*\.?\d+)\s*px\b/gi,/\bwidth\s*(?:<=|>=|<|>|=)\s*(\d*\.?\d+)\s*px\b/gi,/(\d*\.?\d+)\s*px\s*(?:<=|>=|<|>|=)\s*width\b/gi]) for (const match of condition.matchAll(pattern)) {
            const value = Number(match[1]); if (Number.isFinite(value) && value >= 240 && value <= 2560) { widths.push(value); if (breakpoints.size < maxBreakpoints) breakpoints.add(value); else if (!breakpoints.has(value)) gaps.add('Width breakpoint inspection reached its bounded limit.'); }
          }
          if (/\bwidth\b/.test(condition) && (!widths.length || /\d(?:em|rem|vw)\b|calc\(/.test(condition))) gaps.add('A media width condition uses an unsupported unit/expression; its declared breakpoint is retained without guessed conversion.');
          if (conditions.length < 128) conditions.push({ condition, matches: matchMedia(condition).matches, widthBreakpoints:[...new Set(widths)], stylesheetIndex }); else gaps.add('Media condition recording reached its bounded limit.');
        }
        if (typed.cssRules && visitedRules <= maxRules) inspect(typed.cssRules,stylesheetIndex);
        if (rule.type === CSSRule.IMPORT_RULE && visitedRules <= maxRules) {
          try { const imported=(rule as CSSImportRule).styleSheet; if(imported)inspect(imported.cssRules,stylesheetIndex);else gaps.add('An imported stylesheet is not ready; its breakpoints remain unobserved.'); }
          catch { gaps.add('An imported stylesheet is inaccessible through the public CSSOM; its breakpoints remain unobserved.'); }
        }
      }
    };
    for (const [stylesheetIndex,sheet] of Array.from(document.styleSheets).entries()) {
      if (visitedRules > maxRules) break;
      if (sheet.disabled) continue;
      try { inspect(sheet.cssRules,stylesheetIndex); }
      catch { gaps.add(`Stylesheet ${stylesheetIndex} is inaccessible through the public CSSOM; its media/container breakpoints remain unobserved.`); }
    }
    return { breakpoints:[...breakpoints].sort((a,b)=>a-b),conditions,gaps:[...gaps],visitedRules:Math.min(visitedRules,maxRules) };
  }, { maxRules,maxBreakpoints });
}

/** Add complete ±1 bundles nearest the current width, keeping the observation budget explicit. */
export function planResponsiveWidths(discovery: Pick<ResponsiveWidthDiscovery,'breakpoints'>, options: { currentWidth: number; baseWidths?: number[]; maxProbes?: number } ) {
  const maxProbes = options.maxProbes ?? 8, base = options.baseWidths ?? [360,390,430];
  if (!Number.isInteger(maxProbes) || maxProbes < 1 || maxProbes > 8 || !Number.isFinite(options.currentWidth) || base.some(width=>!Number.isInteger(width)||width<240||width>2560) || base.length>maxProbes) throw new Error('Responsive width plans require bounded integer widths and at most eight probes');
  const widths=[...new Set(base)], selectedBreakpoints:number[]=[], omittedBreakpoints:number[]=[];
  for (const breakpoint of [...new Set(discovery.breakpoints)].filter(value=>Number.isFinite(value)&&value>=240&&value<=2560).sort((a,b)=>Math.abs(a-options.currentWidth)-Math.abs(b-options.currentWidth)||a-b)) {
    const bundle=Number.isInteger(breakpoint)?[breakpoint-1,breakpoint,breakpoint+1]:[Math.floor(breakpoint),Math.ceil(breakpoint)];
    const needed=bundle.filter(width=>width>=240&&width<=2560&&!widths.includes(width));
    if(widths.length+needed.length>maxProbes){omittedBreakpoints.push(breakpoint);continue;}
    widths.push(...needed);selectedBreakpoints.push(breakpoint);
  }
  return { widths,selectedBreakpoints,omittedBreakpoints,notice:'This is a bounded observation plan, not a pass. Only completed live observations cover the selected widths; omitted widths, inaccessible stylesheets and container queries are not passed by interpolation.' };
}

/** Reuse a loaded page and its actual device context. No navigation, cookies or editor state is exported. */
export async function observeLoadedWidths<T>(page: Page, widths: number[], measure: (page: Page, width: number, readiness:SourceReadiness) => Promise<T>): Promise<Array<{ requestedWidth:number; facts:LiveViewportFacts; readiness:SourceReadiness; measurement:T }>> {
  if (widths.length>8 || widths.some(width=>!Number.isInteger(width)||width<240||width>2560)) throw new Error('Responsive probes require at most eight integer widths between 240 and 2560');
  const original=page.viewportSize();if(!original)throw new Error('Responsive probes require a known viewport so it can be restored');
  const position=await page.evaluate(()=>({x:scrollX,y:scrollY})),url=page.url(),observations:Array<{requestedWidth:number;facts:LiveViewportFacts;readiness:SourceReadiness;measurement:T}>=[];
  try {
    for(const width of [...new Set(widths)]){
      await page.setViewportSize({width,height:original.height});
      await page.evaluate(async()=>{scrollTo(0,0);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
      const readiness=await observeSourceReadiness(page);
      if(page.url()!==url)throw new Error('Responsive observation changed the loaded document URL; equivalence cannot be established');
      const facts=await page.evaluate(()=>({innerWidth,clientWidth:document.documentElement.clientWidth,devicePixelRatio,touch:navigator.maxTouchPoints>0,coarsePointer:matchMedia('(pointer:coarse)').matches}));
      observations.push({requestedWidth:width,facts,readiness,measurement:await measure(page,width,readiness)});
    }
  }finally{await page.setViewportSize(original);await page.evaluate(point=>scrollTo(point.x,point.y),position);}
  return observations;
}
