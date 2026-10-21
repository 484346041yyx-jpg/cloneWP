import type { Page } from 'playwright';
import type { BlockContract, NativeProgram } from './types.js';
import type { TargetPresentationEvidence } from './presentation-contract.js';
import type { CompiledFidelity, FidelityImportedAsset } from './native.js';
import { collectNativeFractionPaint, NATIVE_FRACTION_SELECTOR } from './native-fraction.js';

/** Read actual component geometry inside its unique native owner. No expected CSS is substituted. */
export async function collectTargetPresentationEvidence(options: {
  page: Page; contract: BlockContract; program: NativeProgram;
  compiled: Pick<CompiledFidelity, 'elementMap'>; viewport: string; evidencePath: string;
  assets?: FidelityImportedAsset[];
}): Promise<TargetPresentationEvidence[]> {
  const mappings = options.contract.blocks.flatMap(source => {
    const detail = source.presentationDetails?.viewports[options.viewport];
    const target = options.program.blocks.find(block => block.sourceBlockId === source.id);
    if (!detail || !target) return [];
    const expected = [...detail.regions, ...detail.controlGroups, ...detail.controlGroups.flatMap(group => group.controls), ...detail.media];
    return expected.map(item => {
      const binding = target.presentationBindings?.find(binding => binding.id === item.id);
      return { blockId: source.id, id: item.id, rootId: options.compiled.elementMap[target.rootKey], elementId: binding ? options.compiled.elementMap[binding.elementKey] : undefined,
        relativeSelector: binding?.relativeSelector, isGroup: detail.controlGroups.some(group => group.id === item.id), absentControls:detail.controlGroups.find(group=>group.id===item.id)?.absentControls??[], groupControls:detail.controlGroups.find(group=>group.id===item.id)?.controls.map(control=>({id:control.id,role:control.role})), isMedia: detail.media.some(media => media.id === item.id) };
    });
  });
  if (mappings.length > 2500) throw new Error('Presentation probes exceed the bounded component limit');
  const rows = await options.page.evaluate(({ mappings, viewport, evidencePath }) => {
    const finite = (value: string) => { const number = Number.parseFloat(value); return Number.isFinite(number) ? number : undefined; };
    const box = (element: Element, origin: DOMRect) => { const rect = element.getBoundingClientRect(); return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }; };
    // Content visibility is separate from retained rect/paint: content-visibility
    // can skip this content while its own principal box/background still paints.
    const visibleBox = (element: Element) => {
      const own = element.getBoundingClientRect(); let left = own.left, right = own.right, top = own.top, bottom = own.bottom, hidden = false, opacity = 1;
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent); opacity *= Number(css.opacity || 1);
        if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse') hidden = true;
        if (css.contentVisibility === 'hidden') hidden = true;
        if (parent !== element && parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) {
          const summary = Array.from(parent.children).find(child => child.tagName === 'SUMMARY');
          if (!summary?.contains(element)) hidden = true;
        }
        if (parent !== element) { const clip = parent.getBoundingClientRect(); if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); } if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); } }
      }
      const area = own.width * own.height, shown = Math.max(0, right - left) * Math.max(0, bottom - top);
      return { visible: !hidden && opacity > .001 && shown > .01 && area > .01, clippedRatio: area > 0 ? Math.max(0, Math.min(1, 1 - shown / area)) : 1, effectiveOpacity: opacity };
    };
    const paint = (element: Element) => {
      const css = getComputedStyle(element), rect = element.getBoundingClientRect();
      // Computed radius may remain a percentage. A 12px circular bullet with
      // 50% radius paints at 6px, not the numeric token 50 interpreted as pixels.
      const radii = css.borderTopLeftRadius.trim().split(/\s+/);
      const resolveRadius = (value: string, dimension: number) => /^-?[\d.]+%$/.test(value) ? Number.parseFloat(value) * dimension / 100 : /^-?[\d.]+px$/.test(value) || /^0(?:\.0+)?$/.test(value) ? finite(value) : undefined;
      const horizontal = resolveRadius(radii[0], rect.width), vertical = resolveRadius(radii[1] ?? radii[0], rect.height);
      const borderRadius = horizontal === undefined || vertical === undefined ? undefined : Math.max(0, Math.min(horizontal, vertical));
      return { color: css.color, backgroundColor: css.backgroundColor, borderColor: css.borderTopColor, borderWidth: finite(css.borderTopWidth), borderRadius, opacity: finite(css.opacity), fontSize: finite(css.fontSize), lineHeight: finite(css.lineHeight), fontWeight: css.fontWeight, fontFamily: css.fontFamily, textAlign: css.textAlign, boxShadow: css.boxShadow };
    };
    const glyph = (element: Element) => {
      const svg = element.matches('svg') ? element : element.querySelector('svg');
      const pseudo = ['::before', '::after'].map(part => { const css = getComputedStyle(element, part); return { part, content: css.content, fontFamily: css.fontFamily, fontSize: css.fontSize, color: css.color, transform: css.transform, border: css.border, width: css.width, height: css.height }; }).filter(item => item.content && !['none', 'normal', '""', "''"].includes(item.content));
      const shapes = svg ? Array.from(svg.querySelectorAll('path,polyline,polygon,line,circle,rect,use')).slice(0, 12).map(shape => ({ tag: shape.tagName, d: (shape.getAttribute('d') || shape.getAttribute('points') || '').replace(/\s+/g, ' ').trim().slice(0, 2000), fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke, strokeWidth: getComputedStyle(shape).strokeWidth, href: shape.getAttribute('href') || shape.getAttribute('xlink:href') })) : [];
      const glyphBox = (svg || element).getBoundingClientRect();
      return { kind: svg ? 'svg' : pseudo.length ? 'pseudo' : element.querySelector('img') ? 'image' : element.textContent?.trim() ? 'text' : 'none', ...(svg ? { signature: JSON.stringify({ viewBox: svg.getAttribute('viewBox'), shapes }), stroke: shapes[0]?.stroke, fill: shapes[0]?.fill } : pseudo.length ? { content: pseudo[0].content, fontFamily: pseudo[0].fontFamily } : { content: element.textContent?.trim().slice(0, 100) }), width: glyphBox.width, height: glyphBox.height };
    };
    const lines = (element: Element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > .1 && rect.height > .1); const tops: number[] = [];
      for (const rect of rects) if (!tops.some(top => Math.abs(top - rect.top) <= 2)) tops.push(rect.top);
      return tops.length;
    };
    const safeURL = (value: string) => { try { const url = new URL(value, location.href); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } };
    const resolved = new Map<string, Element[]>();
    const resolve = (mapping: typeof mappings[number]) => {
      const identity = mapping.blockId + ':' + mapping.id; if (resolved.has(identity)) return resolved.get(identity)!;
      let candidates: Element[] = [];
      if (mapping.rootId && mapping.elementId && /^[a-z0-9_-]+$/i.test(mapping.rootId) && /^[a-z0-9_-]+$/i.test(mapping.elementId)) {
        const roots = document.querySelectorAll(`[data-id="${CSS.escape(mapping.rootId)}"]`), owners = document.querySelectorAll(`[data-id="${CSS.escape(mapping.elementId)}"]`);
        if (roots.length === 1 && owners.length === 1 && roots[0].hasAttribute('data-element_type') && owners[0].hasAttribute('data-element_type') && (roots[0] === owners[0] || roots[0].contains(owners[0]))) {
          try { candidates = mapping.relativeSelector ? Array.from(owners[0].querySelectorAll(mapping.relativeSelector)).filter(element => owners[0].contains(element)) : [owners[0]]; } catch { /* Invalid selectors stay unmeasured. */ }
        }
      }
      resolved.set(identity,candidates); return candidates;
    };
    return mappings.map(mapping => {
      const base = { viewport, blockId: mapping.blockId, id: mapping.id, found: false, count: 0, viewportWidth: innerWidth, evidence: [evidencePath] };
      if (!mapping.rootId || !mapping.elementId || !/^[a-z0-9_-]+$/i.test(mapping.rootId) || !/^[a-z0-9_-]+$/i.test(mapping.elementId)) return base;
      const roots = document.querySelectorAll(`[data-id="${CSS.escape(mapping.rootId)}"]`), owners = document.querySelectorAll(`[data-id="${CSS.escape(mapping.elementId)}"]`);
      if (roots.length !== 1 || owners.length !== 1) return { ...base, count: owners.length };
      const root = roots[0], owner = owners[0]; if (!root.hasAttribute('data-element_type') || !owner.hasAttribute('data-element_type') || !(root === owner || root.contains(owner))) return base;
      const candidates = resolve(mapping);
      if (candidates.length !== 1) return { ...base, count: candidates.length };
      const element = candidates[0], origin = root.getBoundingClientRect(), css = getComputedStyle(element), visibility = visibleBox(element);
      const containedByIds = mappings.filter(candidate => candidate.blockId === mapping.blockId).flatMap(candidate => { const nodes = resolve(candidate); return nodes.length === 1 && (nodes[0] === element || nodes[0].contains(element)) ? [candidate.id] : []; });
      const result = { ...base, found: true, count: 1, viewportWidth: innerWidth, containedByIds, rect: box(element, origin), visible: visibility.visible, paint: paint(element), clippedRatio: visibility.clippedRatio,
        text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000), disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true' || element.classList.contains('swiper-button-disabled') || element.classList.contains('slick-disabled'),
        active: element.getAttribute('aria-current') === 'true' || element.getAttribute('aria-selected') === 'true' || element.classList.contains('swiper-pagination-bullet-active') || element.classList.contains('slick-active'),
        lineCount: lines(element), glyph: glyph(element), viewportFacts: { innerWidth, clientWidth: document.documentElement.clientWidth, devicePixelRatio, touch: navigator.maxTouchPoints > 0, coarsePointer: matchMedia('(pointer:coarse)').matches, editorMode: document.body.classList.contains('elementor-editor-active') || !!document.querySelector('.elementor-editor-active') } };
      if (mapping.isGroup) {
        const roleSelectors = {
          previous: '.elementor-swiper-button-prev,.swiper-button-prev,.slick-prev,.slick-arrow-prev,.wd-nav-arrows .wd-prev,[aria-label="Previous slide"],[aria-label="Previous Slide"],[aria-label="Previous"]',
          next: '.elementor-swiper-button-next,.swiper-button-next,.slick-next,.slick-arrow-next,.wd-nav-arrows .wd-next,[aria-label="Next slide"],[aria-label="Next Slide"],[aria-label="Next"]',
          fraction: '.swiper-pagination-fraction,.carousel-counter,.slick-counter',
          dot: '.swiper-pagination-bullet,.slick-dots button,.slick-dots li,.wd-nav-pagin-item',
          autoplay: '.autoplay-btn,[aria-label*="autoplay" i],[aria-label*="pause" i],[aria-label*="play" i]',
        };
        const controlAbsence = { ownerCount: owners.length, checked: mapping.absentControls.map(role => {
          const selector = roleSelectors[role], matches = Array.from(owner.querySelectorAll(selector));
          return { role, selector, matched: matches.length, visible: matches.filter(match => visibleBox(match).visible).length };
        }) };
        const boundControls = (mapping.groupControls ?? []).flatMap(control=>{const binding=mappings.find(candidate=>candidate.blockId===mapping.blockId&&candidate.id===control.id);return binding?resolve(binding):[];});
        const items = [...new Set(boundControls.length ? boundControls : Array.from(element.querySelectorAll('button,[role="button"],.wd-btn-arrow,.elementor-swiper-button,.swiper-pagination-fraction,.swiper-pagination-bullet,.slick-dots li')))].filter(item => visibleBox(item).visible);
        const rects = items.map(item => item.getBoundingClientRect());
        const row = rects.length > 1 && rects.every(rect => Math.abs((rect.top + rect.height / 2) - (rects[0].top + rects[0].height / 2)) <= Math.max(4, rect.height / 4));
        const column = rects.length > 1 && rects.every(rect => Math.abs((rect.left + rect.width / 2) - (rects[0].left + rects[0].width / 2)) <= Math.max(4, rect.width / 4));
        const boundFraction = boundControls.filter(node => node.matches('.wd-nav-pagin') && node.closest('[data-element_type="widget"]') === owner);
        const nativeFraction = [...new Set([...Array.from(element.querySelectorAll('.wd-nav-pagin')), ...boundFraction])].filter(pager => getComputedStyle(pager, '::after').content.includes('counter(clonewp-page-current)'));
        const pagination = nativeFraction.length === 1 || element.matches('.swiper-pagination-fraction') || element.querySelector('.swiper-pagination-fraction') || /\b\d+\s*\/\s*\d+\b/.test(result.text) ? 'fraction' : element.querySelector('.swiper-pagination-bullet,.slick-dots li,.wd-nav-pagin-item') ? 'bullets' : 'none';
        const controlInventory = (Object.keys(roleSelectors) as Array<keyof typeof roleSelectors>).map(role => {
          const bound = (mapping.groupControls ?? []).filter(control => control.role === role).flatMap(control => { const binding = mappings.find(candidate => candidate.blockId === mapping.blockId && candidate.id === control.id); return binding ? resolve(binding) : []; });
          const selected = Array.from(element.querySelectorAll(roleSelectors[role]));
          if (element.matches(roleSelectors[role])) selected.push(element);
          if (role === 'fraction') selected.push(...nativeFraction);
          // Dots often expose both li and button; count one actual activation target.
          const candidates = [...new Set([...bound, ...selected])].filter(node => role !== 'dot' || ![...bound, ...selected].some(other => other !== node && node.contains(other)));
          return { role, matched: candidates.length, visible: candidates.filter(node => visibleBox(node).visible).length };
        });
        return { ...result, pagination, layout: row ? 'row' : column ? 'column' : css.position === 'absolute' ? 'overlay' : 'separate', controlAbsence, controlInventory };
      }
      if (mapping.isMedia) {
        const images = element.matches('img') ? [element as HTMLImageElement] : Array.from(element.querySelectorAll('img'));
        const image = images.length === 1 ? images[0] : undefined, actualCSS = image ? getComputedStyle(image) : css;
        const mediaRect = image?.getBoundingClientRect() ?? element.getBoundingClientRect();
        return { ...result, ...(image ? { mode: 'image', actualURL: safeURL(image.currentSrc), src: safeURL(image.src), srcset: image.srcset, sizes: image.sizes, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, pictureSources: Array.from(image.closest('picture')?.querySelectorAll('source') ?? []).map(source => ({ media: source.media, srcset: source.srcset, sizes: source.sizes, type: source.type, matches: !source.media || matchMedia(source.media).matches })) } : /url\(/.test(css.backgroundImage) ? { mode: 'background', actualBackground: css.backgroundImage } : {}), fit: image ? actualCSS.objectFit : css.backgroundSize, objectPosition: image ? actualCSS.objectPosition : css.backgroundPosition, aspectRatio: mediaRect.height > 0 ? mediaRect.width / mediaRect.height : undefined };
      }
      if (/^\s*\d+\s*\/\s*\d+\s*$/.test(result.text)) {
        type Runtime = { initialized?: boolean; destroyed?: boolean; params?: { slidesPerGroup?: number; loop?: boolean }; slides?: ArrayLike<Element> };
        const runtimes = [owner, ...owner.querySelectorAll('*')].map(node => (node as Element & { swiper?: Runtime }).swiper).filter((runtime): runtime is Runtime => runtime?.initialized === true && runtime.destroyed !== true);
        const cards = [...owner.querySelectorAll('.product-grid-item.product[data-id]')].filter(card => !card.closest('.swiper-slide-duplicate,.slick-cloned'));
        const ids = [...new Set(cards.map(card => Number(card.getAttribute('data-id'))))];
        const pageSize = runtimes.length === 1 ? runtimes[0].params?.slidesPerGroup ?? 1 : undefined;
        if (ids.length > 0 && ids.every(id => Number.isInteger(id) && id > 0) && pageSize !== undefined && Number.isInteger(pageSize) && pageSize > 0) return { ...result, fractionQuery: { productCount: ids.length, pageSize, totalPages: Math.ceil(ids.length / pageSize), evidence: [evidencePath] } };
      }
      return result;
    });
  }, { mappings, viewport: options.viewport, evidencePath: options.evidencePath });
  // CSS-generated live numbers are absent from textContent. Read Chromium's
  // actual generated text boxes and cross-check the native runtime, once per
  // registered product owner. Neither expected source text nor ceil(query)
  // supplies the displayed fraction.
  const nativeFractions = new Map<string, Awaited<ReturnType<typeof collectNativeFractionPaint>>>();
  for (const block of options.program.blocks.filter(block => block.productQuery)) {
    const id = options.compiled.elementMap[block.productQuery!.widgetKey];
    if (id) nativeFractions.set(block.sourceBlockId, await collectNativeFractionPaint({ page: options.page, ownerSelector: `[data-id="${id}"]`, evidencePath: options.evidencePath }));
  }
  return rows.map(original => {
    let row = original as TargetPresentationEvidence;
    const fraction = nativeFractions.get(row.blockId), mapping = mappings.find(mapping => mapping.blockId === row.blockId && mapping.id === row.id);
    if (fraction && mapping?.relativeSelector === NATIVE_FRACTION_SELECTOR && fraction.selector === `[data-id="${mapping.elementId}"] ${NATIVE_FRACTION_SELECTOR}`) {
      row = { ...row, text: fraction.renderedText, glyph: { kind: 'text', content: fraction.renderedText }, fractionQuery: { productCount: fraction.productCount, pageSize: fraction.runtime.slidesPerGroup, totalPages: fraction.total, evidence: fraction.evidence,
        nativePagination: { kind: 'swiper-native-bullets', initialized: true, bulletCount: fraction.nativeBulletCount, snapCount: fraction.runtime.snapCount, activeIndex: fraction.nativeActiveIndex, loop: fraction.runtime.loop, paintedCurrent: fraction.current, paintSource: fraction.paintSource } } };
    }
    if (!('mode' in row)) return row;
    const actualURL = 'actualURL' in row ? row.actualURL : undefined;
    const backgroundURLs = 'actualBackground' in row && typeof row.actualBackground === 'string' ? [...row.actualBackground.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1]) : [];
    const actualURLs = actualURL ? [actualURL] : backgroundURLs;
    const assets = (options.assets ?? []).filter(asset => actualURLs.some(url => [asset.url,...asset.variants ?? []].includes(url)));
    return assets.length === 1 ? { ...row, ...(actualURLs.length === 1 ? { actualURL: actualURLs[0] } : {}), assetKey: assets[0].key, mediaSha256: assets[0].sha256, attachmentId: assets[0].attachmentId, sourceURL: assets[0].sourceUrl } : { ...row, mediaIdentityGap: !options.assets ? 'Imported asset proof was not supplied' : assets.length ? 'Actual media URL has ambiguous imported asset ownership' : 'Actual rendered media URL does not match a proven imported URL or registered attachment variant' };
  }) as TargetPresentationEvidence[];
}
