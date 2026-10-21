// Current Pet job only. Read-only probes after the owned responsive document is saved.
import path from 'node:path';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from 'playwright';
import { loadConfig } from '../src/core/config.js';
import { writeJson } from '../src/core/files.js';
import { previewCookies } from '../src/core/runner.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { createScopedContext } from '../src/verification/capture-target.js';
import { navigateOwnedPreview } from '../src/verification/owned-preview.js';
import { waitForNativeCarouselReady } from '../src/fidelity/acceptance.js';
import { nativeCatalogRuntime, waitForNativeCatalogReady } from '../src/fidelity/catalog-browser.js';
import { normalizePreviewChromeV2 } from '../src/replica-v2/verify.js';
import { hashV2, canonicalV2, documentHashV2, ensureDiskSpaceV2, safeErrorV2 } from '../src/replica-v2/journal.js';
import { replicaIdV2, usedWidgetTypesV2 } from '../src/replica-v2/compile.js';
import { walkComponentsV2, type ProgramV2 } from '../src/replica-v2/types.js';

const ROOT = 'D:/cloneWP', DEFAULT_RUN = ROOT + '/runs/2026-10-15T05-02-27-244Z-v2-d52069a9';
const DEFAULT_SOURCE = ROOT + '/references/reference-v2-2026-10-15T04-35-43-856Z-www-petsupermarket-com-67f02b1e/reference/source-breakpoint-probes.json';
const WIDTHS = [767, 768, 769, 1023, 1024, 1025] as const;
function inside(root: string, filename: string): void { const relative = path.relative(root, filename); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Breakpoint evidence must stay inside the explicit current workspace/run'); }
function argument(name: string, fallback: string): string { const index = process.argv.indexOf(name); if (index < 0) return fallback; const value = process.argv[index + 1]; if (!value || value.startsWith('--')) throw Error(`Missing ${name} value`); return path.resolve(ROOT, value); }
function expectedColumns(settings: Record<string, unknown>, key: string, mode: string): number | undefined { const raw = mode === 'desktop' ? settings[key] : settings[`${key}_${mode}`] ?? settings[key], value = raw && typeof raw === 'object' && 'size' in raw ? (raw as { size: unknown }).size : raw, number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; }
/** Native Swiper breakpoints are min-inclusive; Woodmart/CSS device queries
 * keep their separate max-inclusive contract. Never derive expected counts
 * from the current runtime count that is being checked. */
export function nativeCarouselBoundaryContract(width: number, settings: Record<string, unknown>, engine: { breakpointsBase?: string; breakpoints: Record<string, { slidesPerView?: unknown }> }, boundaries = { mobile: 768, tablet: 1024 }) {
  if (!Number.isFinite(width) || width <= 0 || engine.breakpointsBase && engine.breakpointsBase !== 'window') throw Error('Native carousel requires a finite viewport/window breakpoint basis');
  const levels = [{ minimum: 0, mode: 'mobile' }, { minimum: boundaries.mobile, mode: 'tablet' }, { minimum: boundaries.tablet, mode: 'desktop' }];
  const keys = Object.keys(engine.breakpoints).map(Number).sort((a, b) => a - b);
  if (keys.length !== levels.length || keys.some((key, index) => !Number.isFinite(key) || key !== levels[index].minimum)) throw Error('Actual native Swiper breakpoint map differs from the registered current environment');
  const configurations = levels.map(level => ({ ...level, expectedSlidesPerView: expectedColumns(settings, 'slides_to_show', level.mode), actualConfiguredSlidesPerView: Number(engine.breakpoints[String(level.minimum)].slidesPerView) }));
  const active = configurations.filter(level => level.minimum <= width).at(-1)!;
  return { ...active, expectedRuntimeBreakpoint: String(active.minimum), configurations, configuredCountsMatch: configurations.every(level => level.expectedSlidesPerView !== undefined && level.expectedSlidesPerView === level.actualConfiguredSlidesPerView) };
}

export async function marketingBoundaryGeometry(widget: Locator, ids: { carouselOwner: string; section: string }, expectedVisibleCards: number, expectedShopAll = 1) {
  // Compile this fixed read-only measurement body once on the host so the TS
  // loader cannot insert helper names into code serialized for the browser.
  const evaluateGeometry = new Function('root', 'args', `
    const box = element => { if (!element) return null; const r = element.getBoundingClientRect(), s = getComputedStyle(element); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,css:{position:s.position,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight,fontSize:s.fontSize,lineHeight:s.lineHeight} }; };
    const intersects = (a,b) => a && b && a.x < b.right-.01 && b.x < a.right-.01 && a.y < b.bottom-.01 && b.y < a.bottom-.01;
    const inside = (a,b) => a && b && a.width>0 && a.height>0 && a.x>=b.x-1 && a.right<=b.right+1 && a.y>=b.y-1 && a.bottom<=b.bottom+1;
    const section=root.closest('[data-id="'+args.ids.section+'"]'), owner=root.closest('[data-id="'+args.ids.carouselOwner+'"]'), window=root.querySelector('.e-n-carousel.swiper'), track=window?.querySelector(':scope>.swiper-wrapper');
    if(!section||!owner||!window||!track)throw Error('Exact authored carousel, track or section owner is absent');
    const frame=box(window), ownerBox=box(owner), sectionBox=box(section), trackBox=box(track), headings=Array.from(section.querySelectorAll('.marketing-heading h2')).map(box), shopAll=Array.from(section.querySelectorAll('.heading-shop-all')).map(box).filter(b=>b.width>0&&b.height>0);
    const cards=Array.from(track.querySelectorAll(':scope>.swiper-slide')).filter(slide=>{const b=box(slide);return b.width>0&&b.height>0&&Math.min(b.right,frame.right)-Math.max(b.x,frame.x)>1;}).map(slide=>{const image=slide.querySelector('.marketing-image'), copy=slide.querySelector('.marketing-copy');return {slide:box(slide),image:box(image),copy:box(copy),text:Array.from(copy?.querySelectorAll('p')||[]).map(box),imagePainted:!!image&&image.complete&&image.naturalWidth>0};});
    const controls=['.elementor-swiper-button-prev','.elementor-swiper-button-next','.swiper-pagination-fraction'].map(selector=>{const nodes=Array.from(root.querySelectorAll(selector));return{selector,count:nodes.length,box:box(nodes[0]),offsetParentId:nodes[0]?.offsetParent?.getAttribute('data-id')};});
    const bottomStart=Math.max(trackBox.bottom,...cards.flatMap(card=>[card.image?.bottom||0,card.copy?.bottom||0])), checks=[];
    checks.push({kind:'actual-six-card-window',passed:cards.length===args.expectedVisibleCards,expected:args.expectedVisibleCards,actual:cards.length});
    checks.push({kind:'actual-tablet-heading-style-at768',passed:headings.length===1&&headings.every(heading=>parseFloat(heading.css.fontSize)===33&&parseFloat(heading.css.lineHeight)===48)});
    for(const [index,card] of cards.entries()){
      checks.push({kind:'card-media-and-copy-contained',card:index,passed:inside(card.image,card.slide)&&inside(card.copy,card.slide)&&card.imagePainted});
      checks.push({kind:'owned-text-not-clipped',card:index,passed:card.copy&&card.copy.scrollWidth<=card.copy.clientWidth+1&&card.copy.scrollHeight<=card.copy.clientHeight+1&&card.text.every(text=>inside(text,card.copy)&&text.scrollWidth<=text.clientWidth+1&&text.scrollHeight<=text.clientHeight+1)});
      checks.push({kind:'marketing-tablet-card-styles-at768',card:index,passed:card.image&&Math.abs(card.image.height-120)<=.5&&card.copy&&parseFloat(card.copy.css.paddingLeft)===0&&parseFloat(card.copy.css.paddingRight)===0});
    }
    for(const control of controls){
      const collision=[...headings,...shopAll,...cards.flatMap(card=>[card.image,card.copy])].filter(box=>intersects(control.box,box));
      checks.push({kind:'owned-native-bottom-controls',selector:control.selector,passed:control.count===1&&control.offsetParentId===args.ids.carouselOwner&&inside(control.box,ownerBox)&&control.box.y>=bottomStart-.01&&collision.length===0,collisions:collision});
    }
    checks.push({kind:'shop-all-in-same-bottom-region',passed:shopAll.length===args.expectedShopAll&&shopAll.every(box=>box.y>=bottomStart-.01&&inside(box,sectionBox)&&box.bottom<=ownerBox.bottom+1)});
    return {carouselOwnerId:args.ids.carouselOwner,sectionId:args.ids.section,owner:ownerBox,section:sectionBox,window:frame,track:trackBox,headings,shopAll,cards,controls,bottomStart,checks,passed:checks.every(check=>check.passed)};
  `);
  return widget.evaluate(evaluateGeometry as any, { ids, expectedVisibleCards, expectedShopAll });
}

/** Decode only actually painted viewport images, including their clipping
 * ancestors. Offscreen/lazy carousel items cannot delay the viewport capture. */
export async function visibleFrameReadiness(page: Page) {
  const measure = new Function(`return (async()=>{
    await document.fonts.ready;
    const images=Array.from(document.images).filter(image=>{const r=image.getBoundingClientRect();let left=Math.max(0,r.left),right=Math.min(document.documentElement.clientWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);for(let node=image;node;node=node.parentElement){const s=getComputedStyle(node),b=node.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;if(node!==image&&/^(hidden|clip|auto|scroll)$/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(node!==image&&/^(hidden|clip|auto|scroll)$/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}return right-left>1&&bottom-top>1;});
    const results=await Promise.all(images.map(async image=>{let timer;try{await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Visible image decode timeout')),5000);})]);return{src:image.currentSrc||image.src,decoded:image.complete&&image.naturalWidth>0,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight};}catch(error){return{src:image.currentSrc||image.src,decoded:false,error:String(error.message)};}finally{clearTimeout(timer);}}));
    return{fontsReady:document.fonts.status==='loaded',images:results,passed:document.fonts.status==='loaded'&&results.every(image=>image.decoded)};
  })()`);
  return page.evaluate(measure as any);
}

/** Actual promo glyphs and painted image bounds; no CTA containment assertion
 * is made because the frozen source intentionally crops that entry at390. */
export async function promoFrameGeometry(owner: Locator) {
  const measure = new Function('root', `
    const rect=node=>{if(!node)return null;const b=node.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
    const glyphs=node=>{const values=[],walk=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);for(let text=walk.nextNode();text;text=walk.nextNode()){if(!text.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(text);for(const b of range.getClientRects())if(b.width>0&&b.height>0)values.push({left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height});}return values;};
    const intersect=(a,b)=>a&&b&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>.01&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.01;
    const clipping=node=>{const clip={left:0,right:document.documentElement.clientWidth,top:0,bottom:innerHeight},ancestors=[];let painted=true;for(let element=node;element;element=element.parentElement){const s=getComputedStyle(element),b=rect(element),clipsX=/^(hidden|clip|auto|scroll)$/.test(s.overflowX),clipsY=/^(hidden|clip|auto|scroll)$/.test(s.overflowY);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)painted=false;if(clipsX){clip.left=Math.max(clip.left,b.left);clip.right=Math.min(clip.right,b.right);}if(clipsY){clip.top=Math.max(clip.top,b.top);clip.bottom=Math.min(clip.bottom,b.bottom);}if(clipsX||clipsY)ancestors.push({tag:element.tagName.toLowerCase(),id:element.id,class:element.className,overflowX:s.overflowX,overflowY:s.overflowY,clipsX,clipsY,rect:b});}return{clip,painted,ancestors};};
    const outer=root.querySelector('.promo-outer'),thin=root.querySelector('.thin'),images=Array.from(root.querySelectorAll('.logos img')),headingNodes=root.querySelectorAll('[data-cwp-text="heading"]'),termsNodes=root.querySelectorAll('[data-cwp-text="terms"]'),heading=headingNodes[0],terms=termsNodes[0];
    if(!outer||!thin||images.length!==1||headingNodes.length!==1||termsNodes.length!==1)throw Error('The exact authored promo image, frame and typed text owners are missing or duplicated');
    const outerClip=clipping(outer),clip=outerClip.clip,visible=outerClip.painted;
    const texts=[{role:'heading',node:heading},{role:'terms',node:terms}].map(item=>{const css=getComputedStyle(item.node),boxes=glyphs(item.node),state=clipping(item.node);return{role:item.role,text:item.node.textContent.replace(/\\s+/g,' ').trim(),rect:rect(item.node),glyphs:boxes,painted:state.painted,visibleClip:state.clip,clipAncestors:state.ancestors,css:{display:css.display,fontSize:css.fontSize,lineHeight:css.lineHeight}};});
    const media=images.map(image=>{let painted=visible;for(let node=image;node;node=node.parentElement){const s=getComputedStyle(node);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)painted=false;}return{rect:rect(image),complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,decoded:image.complete&&image.naturalWidth>0,painted,src:image.currentSrc||image.src};}),checks=[];
    checks.push({kind:'actual-promo-image-painted',passed:visible&&media.every(image=>image.painted&&image.decoded&&image.rect.width>0&&image.rect.height>0)});
    for(const text of texts){const clip=text.visibleClip,outside=text.glyphs.filter(b=>b.left<clip.left-.01||b.right>clip.right+.01||b.top<clip.top-.01||b.bottom>clip.bottom+.01);checks.push({kind:'promo-'+text.role+'-glyphs-inside-visible-clip',passed:text.painted&&text.glyphs.length>0&&outside.length===0,outside});const collisions=media.flatMap(image=>text.glyphs.filter(b=>intersect(image.rect,b)).map(glyph=>({image:image.rect,glyph})));checks.push({kind:'promo-image-separate-from-'+text.role,passed:collisions.length===0,collisions});}
    const overlaps=texts[0].glyphs.flatMap(heading=>texts[1].glyphs.filter(terms=>intersect(heading,terms)).map(terms=>({heading,terms})));checks.push({kind:'promo-heading-and-terms-separate',passed:overlaps.length===0,overlaps});
    return{outer:rect(outer),thin:rect(thin),gridRows:getComputedStyle(thin).gridTemplateRows,visibleClip:clip,clipAncestors:outerClip.ancestors,media,texts,cta:Array.from(root.querySelectorAll('.cta,.mobile-cta')).map(rect),ctaContainmentRequired:false,checks,passed:checks.every(check=>check.passed)};
  `);
  return owner.evaluate(measure as any);
}

/** Measure the actual native notice and the authored navigation separately.
 * Element boxes alone miss the1025px failure: a fixed-width notice can paint
 * text over an otherwise correctly positioned navigation link. Inactive
 * slides and CSS-hidden navigation variants cannot contribute visible ranges. */
export async function headerOffersGeometry(offers: Locator, headerId: string) {
  const measure = new Function('root', 'headerId', `
    const rect=node=>{const b=node.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
    const intersects=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.01&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.01;
    const physical=node=>{let clip={left:0,right:document.documentElement.clientWidth,top:0,bottom:innerHeight},painted=true;for(let element=node;element;element=element.parentElement){const s=getComputedStyle(element),b=rect(element);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)painted=false;if(/^(hidden|clip|auto|scroll)$/.test(s.overflowX)){clip.left=Math.max(clip.left,b.left);clip.right=Math.min(clip.right,b.right);}if(/^(hidden|clip|auto|scroll)$/.test(s.overflowY)){clip.top=Math.max(clip.top,b.top);clip.bottom=Math.min(clip.bottom,b.bottom);}}return{clip,painted};};
    const glyphs=node=>{const values=[],walk=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);for(let text=walk.nextNode();text;text=walk.nextNode()){if(!text.textContent.trim())continue;const state=physical(text.parentElement);if(!state.painted)continue;const range=document.createRange();range.selectNodeContents(text);for(const b of range.getClientRects()){const box={left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};if(box.width>0&&box.height>0&&intersects(box,state.clip))values.push({text:text.textContent.replace(/\\s+/g,' ').trim(),rect:box,visibleClip:state.clip,contained:box.left>=state.clip.left-.01&&box.right<=state.clip.right+.01&&box.top>=state.clip.top-.01&&box.bottom<=state.clip.bottom+.01});}}return values;};
    const header=document.getElementById(headerId),windows=root.querySelectorAll('.e-n-carousel.swiper');
    if(!header||windows.length!==1)throw Error('Exact authored header and one native offers window are required');
    const window=windows[0],track=window.querySelector(':scope>.swiper-wrapper');if(!track)throw Error('The owned native offers track is absent');
    const navigation=['.shop','.nav-track','.nav-deals','.nav-services'].map(selector=>{const nodes=header.querySelectorAll(selector),node=nodes[0];return{selector,count:nodes.length,rect:node?rect(node):null,glyphs:node?glyphs(node):[]};});
    const slides=Array.from(track.querySelectorAll(':scope>.swiper-slide')).map((slide,index)=>({index,sourceIndex:slide.getAttribute('data-swiper-slide-index'),active:slide.classList.contains('swiper-slide-active'),rect:rect(slide),glyphs:glyphs(slide)})).filter(slide=>slide.glyphs.length>0);
    const controls=['.elementor-swiper-button-prev','.elementor-swiper-button-next','.swiper-pagination-fraction'].map(selector=>{const nodes=root.querySelectorAll(selector),node=nodes[0],state=node?physical(node):null,b=node?rect(node):null;return{selector,count:nodes.length,rect:b,glyphs:node?glyphs(node):[],painted:!!state&&state.painted&&b.width>0&&b.height>0&&intersects(b,state.clip),contained:!!state&&!!b&&b.left>=state.clip.left-.01&&b.right<=state.clip.right+.01&&b.top>=state.clip.top-.01&&b.bottom<=state.clip.bottom+.01};});
    const collisions=[];for(const nav of navigation)for(const navGlyph of nav.glyphs){for(const slide of slides)for(const glyph of slide.glyphs)if(intersects(glyph.rect,navGlyph.rect))collisions.push({kind:'notice-text',slide:slide.index,text:glyph.text,rect:glyph.rect,navigation:nav.selector,navigationText:navGlyph.text,navigationRect:navGlyph.rect});for(const control of controls)if(control.painted&&intersects(control.rect,navGlyph.rect))collisions.push({kind:'native-control',control:control.selector,rect:control.rect,navigation:nav.selector,navigationText:navGlyph.text,navigationRect:navGlyph.rect});}
    const checks=[{kind:'exact-header-navigation-owners',passed:navigation.every(nav=>nav.count===1)&&navigation[0].glyphs.length>0},{kind:'one-visible-native-offer-copy',passed:slides.length===1},{kind:'header-offer-glyphs-inside-visible-clip',passed:slides.length===1&&slides.every(slide=>slide.glyphs.every(glyph=>glyph.contained))},{kind:'visible-owned-header-offer-controls',passed:controls.every(control=>control.count===1&&control.painted&&control.contained)&&(controls[2].glyphs.length>0)},{kind:'header-offers-and-navigation-do-not-overlap',passed:collisions.length===0}];
    return{headerId,offersId:root.getAttribute('data-id'),window:rect(window),track:rect(track),navigation,slides,controls,collisions,checks,passed:checks.every(check=>check.passed)};
  `);
  return offers.evaluate(measure as any, headerId);
}
async function imagePaint(owner: Locator) {
  return owner.evaluate(async root => {
    const physical = (image: HTMLImageElement) => { const box = image.getBoundingClientRect(); let left = box.left, right = box.right, top = box.top, bottom = box.bottom; for (let node: Element | null = image; node; node = node.parentElement) { const css = getComputedStyle(node), clip = node.getBoundingClientRect(); if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false; if (node !== image && /^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); } if (node !== image && /^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); } } return right - left > 1 && bottom - top > 1 && right > 0 && left < innerWidth && bottom > 0 && top < innerHeight; };
    const images = Array.from(root.querySelectorAll('img')).filter(physical);
    await Promise.all(images.map(image => new Promise<void>(resolve => { if (image.complete) { resolve(); return; } const timer = setTimeout(resolve, 4_000), done = () => { clearTimeout(timer); resolve(); }; image.addEventListener('load', done, { once: true }); image.addEventListener('error', done, { once: true }); })));
    return images.map(image => ({ src: image.currentSrc || image.src, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, productId: image.closest('.product-grid-item.product[data-id]')?.getAttribute('data-id') ?? null, painted: image.complete && image.naturalWidth > 0 }));
  });
}

const directlyInvoked = !!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (directlyInvoked && process.argv.includes('--help')) {
  console.log('Read-only owned Pet breakpoints: node --import tsx tools/probe-pet-v2-breakpoints.ts [--run ABS_RUN] [--source ABS_SOURCE_PROBES] [--out ABS_RUN_SUBDIRECTORY]. Execute only after saving the responsive document.');
} else if (directlyInvoked) {
  const runDir = await realpath(argument('--run', DEFAULT_RUN)); inside(ROOT, runDir);
  const sourcePath = await realpath(argument('--source', DEFAULT_SOURCE)); inside(ROOT, sourcePath);
  const sourceBytes = await readFile(sourcePath), source = JSON.parse(sourceBytes.toString('utf8')) as { targetBreakpointProof?: string; probes?: Array<{ width: number; clientWidth?: number; headerHeight?: number; navToggle?: Array<{ visible: boolean }>; heroSource?: Array<{ src: string; width: number; height: number }> }> };
  if (!Array.isArray(source.probes) || WIDTHS.some(width => source.probes!.filter(probe => probe.width === width).length !== 1)) throw Error('Actual independently captured source breakpoint evidence is incomplete');
  const journal = JSON.parse(await readFile(path.join(runDir, 'journal.json'), 'utf8'));
  if (journal.version !== 2 || journal.workflow !== 'block-replication' || journal.pageId !== 15102 || journal.runId !== path.basename(runDir) || journal.targetUrl !== 'https://primevapeoutlet.com/' || journal.mutations.some((intent: { status: string }) => ['intent', 'write-unknown', 'restore-pending', 'conflict'].includes(intent.status))) throw Error('This probe is limited to the exact current owned Pet draft and resolved write state');
  const accepted = JSON.parse(await readFile(path.join(runDir, 'target/accepted-program.json'), 'utf8')) as { program: ProgramV2; stage: string }, program = accepted.program;
  if (!['responsive', 'final'].includes(accepted.stage) || program.version !== 2 || program.workflow !== 'block-replication' || program.taskId !== journal.taskId || program.sourceUrl !== 'https://www.petsupermarket.com/') throw Error('Save the actual responsive program before running breakpoint probes');
  const environmentPath = path.join(runDir, 'target/environment.json'), environmentBytes = await readFile(environmentPath), environment = JSON.parse(environmentBytes.toString('utf8'));
  const configured = environment.responsiveDevices?.breakpoints;
  if (configured?.mobile?.value !== 768 || configured?.mobile?.direction !== 'max' || configured?.tablet?.value !== 1024 || configured?.tablet?.direction !== 'max') throw Error('The actual recorded target must retain mobile<=768 and tablet<=1024');
  if (source.targetBreakpointProof && path.resolve(ROOT, source.targetBreakpointProof) !== path.resolve(environmentPath)) throw Error('Source breakpoint note refers to another target run');
  const out = argument('--out', path.join(runDir, 'verification/breakpoint-probes', randomUUID())); inside(runDir, out); await ensureDiskSpaceV2(ROOT); await mkdir(out, { recursive: true });
  const report: any = { version: 1, kind: 'owned-read-only-breakpoint-probes', createdAt: new Date().toISOString(), pageId: journal.pageId, runId: journal.runId, editorSessions: 0, frontendPages: 1, targetWrites: 0, sourcePixelEqualityClaim: false, sourceRef: { path: sourcePath, sha256: hashV2(sourceBytes) }, environmentRef: { path: environmentPath, sha256: hashV2(environmentBytes) }, targetRules: { mobileMax: 768, tabletMax: 1024, nativeSwiperTabletMin: 768, nativeSwiperDesktopMin: 1024 }, adaptations: [{ width: 768, rule: 'The observed source uses its tablet header and tablet hero assets at 768px; the actual target Elementor mobile breakpoint includes 768px. This is an explicit one-pixel breakpoint adaptation, not a claim of identical source presentation.', sourcePointer: `/probes/${source.probes.findIndex(probe => probe.width === 768)}` }, { width: 768, components: ['brands-carousel','dog-deals-carousel','cat-deals-carousel','other-deals-carousel'], rule: 'These actual native Swiper instances select their min-inclusive768 tablet configuration (6 cards), independently of CSS/header and Woodmart max-inclusive mobile mode. Align the exact owned native widget CSS variable and marketing card/footer CSS to tablet at768. Verify actual six-card geometry, image/text containment and native controls; changing expected count alone cannot pass.' }], probes: [], passed: false };
  const loaded = await loadConfig(ROOT); if (loaded.config.targetUrl !== journal.targetUrl) throw Error('Configured target no longer matches this owned run');
  const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const types = [...new Set([...usedWidgetTypesV2(program, 'final'), ...(walkComponentsV2(program.blocks).some(component => component.kind === 'native-carousel') ? ['heading'] : [])])].sort();
    const before = (await client.readOwnedReviewCheckpoint(journal.pageId, journal.runId, types)).snapshot; report.beforeDocumentHash = before.hash;
    if (before.hash !== journal.documentHash || documentHashV2(before.elements, before.settings) !== before.hash) throw Error('Owned document changed since the saved responsive checkpoint');
    const access = await client.getPreviewAccess(journal.pageId), cookies = await previewCookies(access.adminAccessUrl, loaded.config.targetUrl);
    browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] }); const context = await createScopedContext(browser, access.previewUrl, { cookies }, { readOnly: true });
    try {
      const page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'no-preference' });
      for (const width of WIDTHS) {
        const mode = width <= 768 ? 'mobile' : width <= 1024 ? 'tablet' : 'desktop', index = source.probes.findIndex(probe => probe.width === width), observed = source.probes[index], row: any = { width, mode, sourceEvidence: { path: sourcePath, sha256: report.sourceRef.sha256, pointer: `/probes/${index}` }, sourceObserved: observed, marketing: [], products: [], checks: [] }; report.probes.push(row);
        await page.setViewportSize({ width, height: 1000 }); await navigateOwnedPreview(page, access.previewUrl); row.previewChromeAdjusted = await normalizePreviewChromeV2(page); await page.evaluate(async () => { await document.fonts.ready; });
        const liveBreakpoints = await page.evaluate(() => { const config = (window as any).elementorFrontend?.config?.responsive; return config?.activeBreakpoints ?? config?.breakpoints ?? null; }); row.actualFrontendBreakpoints = liveBreakpoints;
        row.checks.push({ kind: 'actual-target-breakpoints', passed: liveBreakpoints?.mobile?.value === 768 && liveBreakpoints?.tablet?.value === 1024 });
        for (const component of walkComponentsV2(program.blocks).filter(component => component.kind === 'native-carousel' || component.kind === 'native-products')) {
          const id = replicaIdV2(program.taskId, `${component.key}-${component.kind === 'native-carousel' ? 'carousel' : 'products'}`), widget = page.locator(`[data-id="${id}"]`), item: any = { componentKey: component.key, elementId: id }; const list = component.kind === 'native-carousel' ? row.marketing : row.products; list.push(item);
          try {
            if (await widget.count() !== 1) throw Error('Native component is missing or duplicated'); item.visible = await widget.isVisible(); if (!item.visible) { item.skipped = 'CSS-hidden variant; no initialized/paint claim'; continue; } await widget.scrollIntoViewIfNeeded();
            if (component.kind === 'native-carousel') {
              const state = (await waitForNativeCarouselReady(widget)).state; item.runtime = state;
              item.engineBreakpointEvidence = await widget.evaluate(root => { const nodes = Array.from(root.querySelectorAll('.e-n-carousel')).filter((node: any) => node.swiper); if (nodes.length !== 1) throw Error('Native breakpoint proof needs one actual owned engine'); const instance = (nodes[0] as any).swiper; return { breakpointsBase: instance.originalParams.breakpointsBase || 'window', breakpoints: Object.fromEntries(Object.entries(instance.originalParams.breakpoints || {}).map(([key, value]: [string, any]) => [key, { slidesPerView: value.slidesPerView }])) }; });
              item.engineBoundaryContract = nativeCarouselBoundaryContract(width, component.widgetSettings, item.engineBreakpointEvidence, { mobile: configured.mobile.value, tablet: configured.tablet.value });
              item.expectedSlidesPerView = item.engineBoundaryContract.expectedSlidesPerView; item.columnsMatch = Number(state.runtimeSlidesPerView) === item.expectedSlidesPerView; item.cssColumnsMatch = Number(state.cssSlidesToDisplay) === item.expectedSlidesPerView; item.controls = { previous: state.previous, next: state.next, pagination: state.pagination };
              row.checks.push({ kind: 'native-marketing-columns-and-controls', componentKey: component.key, passed: state.initialized && item.engineBoundaryContract.configuredCountsMatch && String(state.runtimeBreakpoint) === item.engineBoundaryContract.expectedRuntimeBreakpoint && item.columnsMatch && item.cssColumnsMatch && state.next && state.previous && state.pagination });
              if (width === 768 && ['brands-carousel','dog-deals-carousel','cat-deals-carousel','other-deals-carousel'].includes(component.key)) {
                const section = program.blocks.find(block => walkComponentsV2([block]).some(child => child.key === component.key)); if (!section) throw Error('Marketing native component has no authored section owner');
                item.boundaryGeometry = await marketingBoundaryGeometry(widget, { carouselOwner: replicaIdV2(program.taskId, component.key), section: replicaIdV2(program.taskId, section.key) }, item.expectedSlidesPerView, component.key === 'brands-carousel' ? 0 : 1);
                row.checks.push({ kind: 'marketing-768-card-and-control-geometry', componentKey: component.key, passed: item.boundaryGeometry.passed });
              }
            } else {
              const state = await waitForNativeCatalogReady(widget); item.runtime = state; item.expectedWindowCount = expectedColumns(component.widgetSettings, 'slides_per_view', mode); item.actualWindowCount = state.visibleIds.length; item.columnsMatch = item.actualWindowCount === item.expectedWindowCount; item.controls = { next: !!state.nextSelector, previous: !!state.previousSelector }; row.checks.push({ kind: 'actual-product-window-count-and-controls', componentKey: component.key, passed: state.initialized && item.columnsMatch && item.controls.next && item.controls.previous });
            }
            item.images = await imagePaint(widget); for (const image of item.images) image.src = safeErrorV2(image.src); const expectsImage = component.kind === 'native-products' || walkComponentsV2([component]).some(child => child.kind === 'html-static' && Object.keys(child.slots.media).length > 0); row.checks.push({ kind: 'visible-window-image-paint', componentKey: component.key, ...(expectsImage ? {} : { notApplicable: 'This text-only source component has no authored media.' }), passed: (!expectsImage || item.images.length > 0) && item.images.every((image: { painted: boolean }) => image.painted) });
          } catch (error) { item.error = safeErrorV2(error); row.checks.push({ kind: 'native-component-probe', componentKey: component.key, passed: false, error: item.error }); }
        }
        await page.evaluate(() => scrollTo(0, 0));
        row.captureReadiness = await visibleFrameReadiness(page);
        for (const image of row.captureReadiness.images) image.src = safeErrorV2(image.src);
        row.checks.push({ kind: 'fonts-and-visible-images-decoded-before-capture', passed: row.captureReadiness.passed });
        const promo = page.locator(`#cwp-${replicaIdV2(program.taskId, 'promo-content')}`);
        if (await promo.count() !== 1) throw Error('The current promo owner is missing or duplicated');
        row.promo = await promoFrameGeometry(promo); for (const image of row.promo.media) image.src = safeErrorV2(image.src);
        row.checks.push({ kind: 'promo-image-text-and-visible-glyph-geometry', passed: row.promo.passed });
        const headerOffers = page.locator(`[data-id="${replicaIdV2(program.taskId, 'header-offers-carousel')}"]`);
        if (await headerOffers.count() !== 1) throw Error('The current native header offers widget is missing or duplicated');
        row.headerOffers = await headerOffersGeometry(headerOffers, `cwp-${replicaIdV2(program.taskId, 'header-content')}`);
        row.checks.push({ kind: 'header-offers-visible-copy-controls-and-navigation-geometry', passed: row.headerOffers.passed });
        row.presentation = await page.evaluate(({ headerId, heroIds }) => {
          const visible = (node: Element) => { const box = node.getBoundingClientRect(); if (box.width <= 0 || box.height <= 0) return false; for (let item: Element | null = node; item; item = item.parentElement) { const css = getComputedStyle(item); if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false; } return true; };
          const original = (id: string) => Array.from(document.querySelectorAll(`[data-id="${id}"]`)).find(node => !node.closest('.swiper-slide-duplicate,.slick-cloned')), header = original(headerId), hero = heroIds.map(id => { const root = original(id), variants = root ? ['desktop-source-copy', 'mobile-source-copy'].map(className => { const nodes = Array.from(root.querySelectorAll('.' + className)); return { className, total: nodes.length, visible: nodes.filter(visible).length }; }) : []; return { elementId: id, present: !!root, variants, exclusive: !variants.some(value => value.total) || variants.reduce((count, value) => count + value.visible, 0) === 1 }; });
          return { width: innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), headerTextVariants: header ? Array.from(header.querySelectorAll('[data-cwp-text]')).filter(node => !node.closest('.swiper-slide-duplicate')).map(node => ({ slot: node.getAttribute('data-cwp-text'), text: node.textContent?.replace(/\s+/g, ' ').trim(), visible: visible(node) })) : [], headerHeight: header?.getBoundingClientRect().height ?? null, hero };
        }, { headerId: replicaIdV2(program.taskId, 'header-content'), heroIds: walkComponentsV2(program.blocks).filter(component => component.kind === 'html-static' && /^hero-slide-/.test(component.key)).map(component => replicaIdV2(program.taskId, `${component.key}-content`)) });
        row.checks.push({ kind: 'page-overflow', passed: row.presentation.horizontalOverflow <= 2 }, { kind: 'mutually-exclusive-hero-text-variants', passed: row.presentation.hero.every((item: { present: boolean; exclusive: boolean }) => item.present && item.exclusive) }, { kind: 'header-real-text-owner', passed: row.presentation.headerTextVariants.length > 0 });
        const screenshot = path.join(out, `width-${width}.png`), bytes = await page.screenshot({ path: screenshot, clip: { x: 0, y: 0, width, height: 700 }, animations: 'disabled' }); row.screenshot = { path: screenshot, sha256: hashV2(bytes), width, height: 700 }; row.passed = row.checks.every((check: { passed: boolean }) => check.passed);
      }
    } finally { await context.close(); }
    const after = await client.snapshotDraft(journal.pageId); report.afterDocumentHash = after.hash; report.documentUnchanged = after.hash === report.beforeDocumentHash && documentHashV2(after.elements, after.settings) === after.hash; if (!report.documentUnchanged) throw Error('Owned document changed during read-only probes; concurrent edits are preserved'); report.passed = report.probes.length === WIDTHS.length && report.probes.every((probe: { passed: boolean }) => probe.passed);
  } catch (error) { report.error = safeErrorV2(error); }
  finally { await browser?.close(); if (report.beforeDocumentHash && !report.afterDocumentHash) try { const after = await client.snapshotDraft(journal.pageId); report.afterDocumentHash = after.hash; report.documentUnchanged = after.hash === report.beforeDocumentHash && documentHashV2(after.elements, after.settings) === after.hash; } catch (error) { report.afterReadError = safeErrorV2(error); report.documentUnchanged = false; } report.requests = client.diagnostics(); await client.close(); await writeJson(path.join(out, 'actual.json'), report); console.log(JSON.stringify({ passed: report.passed, report: path.join(out, 'actual.json'), beforeDocumentHash: report.beforeDocumentHash, afterDocumentHash: report.afterDocumentHash, failedWidths: report.probes.filter((probe: { passed: boolean }) => !probe.passed).map((probe: { width: number }) => probe.width), error: report.error })); if (!report.passed) process.exitCode = 1; }
}
