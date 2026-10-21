(options = {}) => {
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const number = value => { const parsed = Number.parseFloat(String(value || '')); return Number.isFinite(parsed) ? parsed : 0; };
  const round = value => Math.round(value * 100) / 100;
  const environmentGaps = [];
  const mediaMatches = condition => {
    try { if (typeof matchMedia === 'function') return matchMedia(condition).matches; } catch { /* Restricted observation API. */ }
    if (!environmentGaps.includes('Public DOM observer cannot access media-query matching; matching declarations remain unobserved.')) environmentGaps.push('Public DOM observer cannot access media-query matching; matching declarations remain unobserved.');
    return null;
  };
  const observedDeviceFacts = () => {
    const supplied=options.deviceFacts&&Array.isArray(options.deviceFacts.evidence)&&options.deviceFacts.evidence.length?options.deviceFacts:null;
    const dpr=typeof devicePixelRatio==='number'&&Number.isFinite(devicePixelRatio)?devicePixelRatio:Number.isFinite(supplied?.devicePixelRatio)?supplied.devicePixelRatio:null;
    const touch=typeof navigator!=='undefined'&&navigator&&Number.isFinite(navigator.maxTouchPoints)?navigator.maxTouchPoints>0:typeof supplied?.touch==='boolean'?supplied.touch:null;
    const matched=mediaMatches('(pointer:coarse)'),coarsePointer=typeof matched==='boolean'?matched:typeof supplied?.coarsePointer==='boolean'?supplied.coarsePointer:null;
    if(dpr===null||touch===null||coarsePointer===null){const message='Device pixel ratio, touch or pointer facts are unavailable to this public DOM observer; no false desktop values were inferred.';if(!environmentGaps.includes(message))environmentGaps.push(message);}
    return {innerWidth,clientWidth:document.documentElement.clientWidth,devicePixelRatio:dpr,touch,coarsePointer,...(supplied?{evidence:supplied.evidence}:{})};
  };
  const excluded = 'script,style,noscript,iframe,object,embed,template,input,textarea,select,[contenteditable="true"]';
  const cloning = '.slick-cloned,.swiper-slide-duplicate,[data-clone="true"]';
  const publicCache = new Map();
  const publicElement = element => {
    if(!element)return false;if(publicCache.has(element))return publicCache.get(element);
    const allowed=!element.matches(excluded)&&!element.closest(excluded)&&!element.closest(cloning);publicCache.set(element,allowed);return allowed;
  };
  const rectCache = new Map(), styleCache = new Map(), selectorCache = new Map(), textCache = new Map(), visibilityCache = new Map(), lineCache = new Map(), glyphCache = new Map();
  const rect = element => { if (rectCache.has(element)) return rectCache.get(element); const value = element.getBoundingClientRect(); const result = { x: round(value.x + scrollX), y: round(value.y + scrollY), width: round(value.width), height: round(value.height) }; rectCache.set(element, result); return result; };
  const union = elements => {
    const values = elements.map(rect).filter(value => value.width > 0 && value.height > 0);
    if (!values.length) return { x: 0, y: 0, width: 0, height: 0 };
    const left = Math.min(...values.map(value => value.x)), top = Math.min(...values.map(value => value.y));
    return { x: left, y: top, width: round(Math.max(...values.map(value => value.x + value.width)) - left), height: round(Math.max(...values.map(value => value.y + value.height)) - top) };
  };
  const cssProperties = ['display','visibility','opacity','position','z-index','width','height','min-width','min-height','max-width','max-height','box-sizing','flex-direction','flex-wrap','flex-basis','flex-grow','flex-shrink','justify-content','align-items','align-content','grid-template-columns','grid-template-rows','gap','row-gap','column-gap','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','color','background-color','background-image','background-position','background-size','background-clip','-webkit-background-clip','-webkit-text-fill-color','border-top-color','border-right-color','border-bottom-color','border-left-color','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius','box-shadow','font-family','font-size','font-weight','line-height','letter-spacing','text-align','text-decoration-line','text-decoration-color','text-transform','white-space','overflow','overflow-x','overflow-y','object-fit','object-position','transform','transition','cursor'];
  cssProperties.push('content-visibility');
  const style = element => { if (styleCache.has(element)) return styleCache.get(element); const computed = getComputedStyle(element); const result = Object.fromEntries(cssProperties.map(property => [property, computed.getPropertyValue(property)])); styleCache.set(element,result); return result; };
  // Content may be skipped without removing the element's principal layout box.
  const skippedPaint = (element, includeOwnContent = true) => {
    for (let parent = element; parent; parent = parent.parentElement) {
      if ((parent !== element || includeOwnContent) && getComputedStyle(parent).contentVisibility === 'hidden') return true;
      if (parent !== element && parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) {
        const summary = Array.from(parent.children).find(child => child.tagName === 'SUMMARY');
        if (!summary?.contains(element)) return true;
      }
    }
    return false;
  };
  const visible = (element, includeOwnContent = true) => { const value = rect(element), computed = style(element); return !skippedPaint(element, includeOwnContent) && value.width > 0 && value.height > 0 && computed.display !== 'none' && computed.visibility !== 'hidden' && number(computed.opacity) !== 0; };
  const selector = element => {
    if (selectorCache.has(element)) return selectorCache.get(element);
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) { const result = '#' + CSS.escape(element.id); selectorCache.set(element,result); return result; }
    const parts = []; let current = element;
    for (let depth = 0; current && depth < 40; depth++) {
      if (current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) { parts.unshift('#' + CSS.escape(current.id)); break; }
      const parent = current.parentElement, tag = current.tagName.toLowerCase();
      if (!parent) { parts.unshift(tag); break; }
      const peers = Array.from(parent.children).filter(peer => peer.tagName === current.tagName);
      parts.unshift(tag + (peers.length > 1 ? ':nth-of-type(' + (peers.indexOf(current) + 1) + ')' : ''));
      current = parent;
    }
    const result = parts.join(' > '); selectorCache.set(element,result); return result;
  };
  const ancestorSelectors = element => { const result=[];for(let parent=element.parentElement,depth=0;parent&&depth<40;parent=parent.parentElement,depth++)result.push(selector(parent));return result; };
  const text = element => {
    if (textCache.has(element)) return textCache.get(element);
    const values = [];
    const walk = owner => {
      for (const node of Array.from(owner.childNodes || [])) {
        if (node.nodeType === 3 && clean(node.nodeValue)) values.push(clean(node.nodeValue));
        else if (node.nodeType === 1 && publicElement(node)) walk(node);
      }
    };
    if (publicElement(element)) walk(element);
    const result = clean(values.join(' ')); textCache.set(element,result); return result;
  };
  const directText = element => clean(Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.nodeValue || '').join(' '));
  const attributes = element => {
    const names = ['id','class','role','title','alt','href','src','srcset','data-src','data-srcset','data-slick','data-disable-autoplay','data-autoplay-speed','data-autoplay','data-slides-to-show','data-slides-to-scroll','aria-label','aria-controls','aria-expanded','aria-hidden','aria-disabled','tabindex','disabled','type','placeholder'];
    return Object.fromEntries(names.filter(name => element.hasAttribute(name)).map(name => [name, element.getAttribute(name)]));
  };
  const visibilityFacts = element => {
    if (visibilityCache.has(element)) return visibilityCache.get(element);
    const own = element.getBoundingClientRect(); let left = own.left, right = own.right, top = own.top, bottom = own.bottom, hidden = skippedPaint(element), opacity = 1;
    const clippingAncestors = [];
    for (let parent = element, depth = 0; parent && depth < 40; parent = parent.parentElement, depth++) {
      const css = getComputedStyle(parent); opacity *= number(css.opacity);
      if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse') hidden = true;
      if (parent !== element && /^(hidden|clip|auto|scroll)$/.test(css.overflowX + '')) { const clip = parent.getBoundingClientRect(); left = Math.max(left, clip.left); right = Math.min(right, clip.right); clippingAncestors.push({ selector: selector(parent), axis: 'x', rect: rect(parent), overflow: css.overflowX }); }
      if (parent !== element && /^(hidden|clip|auto|scroll)$/.test(css.overflowY + '')) { const clip = parent.getBoundingClientRect(); top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); clippingAncestors.push({ selector: selector(parent), axis: 'y', rect: rect(parent), overflow: css.overflowY }); }
    }
    const area = own.width * own.height, shown = Math.max(0, right - left) * Math.max(0, bottom - top);
    const result = { painted: !hidden && opacity > .001 && area > .01 && shown > .01, effectiveOpacity: round(opacity), clippedRatio: area > 0 ? round(Math.max(0, Math.min(1, 1 - shown / area))) : 1, clippingAncestors, inViewport: own.right > 0 && own.left < innerWidth && own.bottom > 0 && own.top < innerHeight }; visibilityCache.set(element, result); return result;
  };
  const glyphFacts = element => {
    if (glyphCache.has(element)) return glyphCache.get(element);
    const svg = element.matches('svg') ? element : element.querySelector('svg');
    const pseudo = ['::before', '::after'].map(part => { const css = getComputedStyle(element, part); return { part, content: css.content, color: css.color, fontFamily: css.fontFamily, fontSize: css.fontSize, width: css.width, height: css.height, border: css.border, transform: css.transform }; }).filter(value => value.content && !['none','normal','""',"''"].includes(value.content));
    const result = { kind: svg ? 'svg' : pseudo.length ? 'pseudo' : clean(element.textContent) ? 'text' : 'none', pseudo, ...(svg ? { viewBox: svg.getAttribute('viewBox'), shapes: Array.from(svg.querySelectorAll('path,polyline,polygon,line,circle,rect,use')).slice(0,12).map(shape => ({ tag: shape.tagName, d: (shape.getAttribute('d') || shape.getAttribute('points') || '').slice(0,2000), fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke, strokeWidth: getComputedStyle(shape).strokeWidth, href: shape.getAttribute('href') || shape.getAttribute('xlink:href') })) } : {}) }; glyphCache.set(element, result); return result;
  };
  const compactGlyph = element => {
    const raw = glyphFacts(element), svg = element.matches('svg') ? element : element.querySelector('svg'), glyphBox = (svg || element).getBoundingClientRect();
    const shapes = raw.shapes?.map(shape => ({ ...shape, d: shape.d.replace(/\s+/g,' ').trim() }));
    return { kind: svg ? 'svg' : raw.pseudo.length ? 'pseudo' : element.querySelector('img') ? 'image' : clean(element.textContent) ? 'text' : 'none', ...(svg ? { signature: JSON.stringify({ viewBox: raw.viewBox, shapes }), stroke: shapes[0]?.stroke, fill: shapes[0]?.fill } : raw.pseudo.length ? { content: raw.pseudo[0].content, fontFamily: raw.pseudo[0].fontFamily } : { content: clean(element.textContent).slice(0,100) }), width: glyphBox.width, height: glyphBox.height };
  };
  const lineFacts = element => {
    if (lineCache.has(element)) return lineCache.get(element);
    const range = document.createRange(); range.selectNodeContents(element);
    const fragments = Array.from(range.getClientRects()).filter(box => box.width > .1 && box.height > .1).slice(0,160).map(box => ({ x: round(box.x + scrollX), y: round(box.y + scrollY), width: round(box.width), height: round(box.height) }));
    const tops = []; for (const box of fragments) if (!tops.some(y => Math.abs(y - box.y) <= 2)) tops.push(box.y);
    const result = { lineCount: tops.length, fragments, visibility: visibilityFacts(element), method: 'bounded-live-Range-client-rects' }; lineCache.set(element,result); return result;
  };
  const image = element => {
    const current = element.currentSrc || element.getAttribute('src') || element.getAttribute('data-src') || '';
    return { selector: selector(element), ancestorSelectors: ancestorSelectors(element), url: current, currentSrc: element.currentSrc || '', src: element.getAttribute('src') || '', dataSrc: element.getAttribute('data-src') || '', srcset: element.getAttribute('srcset') || '', sizes: element.getAttribute('sizes') || '', pictureSources: Array.from(element.closest('picture')?.querySelectorAll('source') || []).slice(0,16).map(source => ({ media: source.media, type: source.type, srcset: source.srcset, sizes: source.sizes, matches: !source.media || mediaMatches(source.media) })), alt: element.getAttribute('alt') || '', naturalWidth: element.naturalWidth || 0, naturalHeight: element.naturalHeight || 0, loaded: !!element.complete && !!element.naturalWidth, rect: rect(element), visible: visible(element), visibility: visibilityFacts(element), style: style(element) };
  };
  const images = root => Array.from(root.querySelectorAll('img')).filter(publicElement).map(image);
  const links = root => Array.from(root.querySelectorAll('a[href]')).filter(publicElement).map(element => ({ selector: selector(element), text: text(element), href: element.href, rect: rect(element), visible: visible(element), style: style(element), attributes: attributes(element) }));
  const atoms = roots => {
    const output = []; const seen = new Set();
    for (const root of roots) {
      const walk = element => {
        if (!publicElement(element)) return;
        for (const node of Array.from(element.childNodes || [])) {
          if (node.nodeType === 1) { walk(node); continue; }
          if (node.nodeType !== 3) continue;
          const value = clean(node.nodeValue); if (!value) continue;
          const address = selector(element), identity = address + ':' + value;
          if (seen.has(identity)) continue; seen.add(identity);
          const tag = element.tagName.toLowerCase(), parentLink = element.closest('a[href]');
          output.push({ id: 'text-' + (output.length + 1), text: value, selector: address, ancestorSelectors: ancestorSelectors(element), tag, fullElementText: text(element), visible: visible(element), rect: rect(element), style: style(element), lineLayout: lineFacts(element), href: parentLink ? parentLink.href : undefined });
        }
      };
      walk(root);
    }
    return output;
  };
  const carousel = root => {
    const original = Array.from(root.querySelectorAll('.slick-slide:not(.slick-cloned),.swiper-slide:not(.swiper-slide-duplicate)')).filter(publicElement);
    const slides = original.filter(element => !original.some(other => other !== element && other.contains(element)));
    const controls = Array.from(root.querySelectorAll('.slick-prev,.slick-next,.slick-arrow,.slick-dots button,.swiper-button-prev,.swiper-button-next,.swiper-pagination-bullet,button[aria-label]')).filter(publicElement).map(element => ({ selector: selector(element), text: text(element), rect: rect(element), visible: visible(element), attributes: attributes(element), style: style(element) }));
    const track = root.querySelector('.slick-list,.swiper-wrapper') || root;
    const trackRect = track.getBoundingClientRect();
    const intersects = element => { const box = element.getBoundingClientRect(); return visible(element) && box.right > trackRect.left + 2 && box.left < trackRect.right - 2 && box.bottom > trackRect.top && box.top < trackRect.bottom; };
    return { selector: selector(root), rect: rect(root), style: style(root), attributes: attributes(root), trackSelector: selector(track), declared: { disableAutoplay: root.getAttribute('data-disable-autoplay'), autoplaySpeed: root.getAttribute('data-autoplay-speed'), autoplay: root.getAttribute('data-autoplay'), slick: root.getAttribute('data-slick') }, visibleCount: slides.filter(intersects).length, controls, slides: slides.map((element, index) => ({ index, selector: selector(element), rect: rect(element), visible: visible(element), intersectsTrack: intersects(element), text: text(element), attributes: attributes(element), style: style(element), atoms: atoms([element]), images: images(element), links: links(element) })) };
  };
  const carouselRoots = roots => {
    const candidates = roots.flatMap(root => [root, ...root.querySelectorAll('.pd-carousel,.slick-slider,.swiper,[data-slick]')]).filter(element => publicElement(element) && element.matches('.pd-carousel,.slick-slider,.swiper,[data-slick]'));
    const unique = Array.from(new Set(candidates));
    return unique.filter(element => rect(element).width > 1 && rect(element).height > 1 && !unique.some(other => other !== element && rect(other).width > 1 && rect(other).height > 1 && other.contains(element))).map(carousel);
  };
  const meaningful = element => !!(publicElement(element) && (text(element) || element.querySelector('img,svg')) && (visible(element) || element.querySelector('.slick-slide:not(.slick-cloned)')));
  // Computed margins resolve `auto` to pixels. Keep accessible declarations as
  // evidence separately rather than guessing centering from a symmetric rect.
  const layoutRuleFacts = [], layoutRuleGaps = [], responsiveMediaConditions = [], responsiveWidthBreakpoints = new Set(), containerQueryConditions = [];
  let visitedLayoutRules = 0;
  const marginProperties = ['margin','margin-left','margin-right','margin-inline','margin-inline-start','margin-inline-end'];
  const readLayoutRules = (rules, stylesheetIndex, conditions = []) => {
    for (const rule of Array.from(rules || [])) {
      if (++visitedLayoutRules > 24000) { if (!layoutRuleGaps.includes('CSS rule inspection reached its bounded limit.')) layoutRuleGaps.push('CSS rule inspection reached its bounded limit.'); return; }
      if (rule.media) {
        const condition = String(rule.conditionText || rule.media.mediaText || '').slice(0,2000), widthBreakpoints = [];
        for (const pattern of [/\b(?:min-|max-)?width\s*:\s*(\d*\.?\d+)\s*px\b/gi,/\bwidth\s*(?:<=|>=|<|>|=)\s*(\d*\.?\d+)\s*px\b/gi,/(\d*\.?\d+)\s*px\s*(?:<=|>=|<|>|=)\s*width\b/gi]) for (const match of condition.matchAll(pattern)) { const width = Number(match[1]); if (Number.isFinite(width) && width >= 240 && width <= 2560) { widthBreakpoints.push(width); if (responsiveWidthBreakpoints.size < 32) responsiveWidthBreakpoints.add(width); } }
        const matches = mediaMatches(condition);
        if (responsiveMediaConditions.length < 128) responsiveMediaConditions.push({ condition,matches,widthBreakpoints:[...new Set(widthBreakpoints)],stylesheetIndex });
        if (/\bwidth\b/.test(condition) && (!widthBreakpoints.length || /\d(?:em|rem|vw)\b|calc\(/.test(condition))) layoutRuleGaps.push('A CSS media width condition has unsupported units/expression; no breakpoint conversion was guessed.');
        if (matches === false) continue;
      }
      if (rule.constructor?.name === 'CSSContainerRule') { if (containerQueryConditions.length < 32) containerQueryConditions.push(String(rule.conditionText || '').slice(0,2000)); if (!layoutRuleGaps.includes('Container-query conditions require separate element-container measurements.')) layoutRuleGaps.push('Container-query conditions require separate element-container measurements.'); }
      if (rule.constructor?.name === 'CSSSupportsRule' && typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports(rule.conditionText)) continue;
      if (rule.type === CSSRule.IMPORT_RULE) { try { if (rule.styleSheet) readLayoutRules(rule.styleSheet.cssRules,stylesheetIndex,conditions); else layoutRuleGaps.push('An imported stylesheet is not ready; its layout/media facts remain unobserved.'); } catch { layoutRuleGaps.push('An imported stylesheet is inaccessible; its layout/media facts remain unobserved.'); } }
      if (rule.selectorText && rule.style) {
        const declarations = Object.fromEntries(marginProperties.map(name => [name, rule.style.getPropertyValue(name)]).filter(([, value]) => value));
        if (Object.keys(declarations).length) layoutRuleFacts.push({ selector: rule.selectorText, declarations, stylesheetIndex, conditions });
      } else if (rule.cssRules) {
        if (rule.constructor?.name === 'CSSScopeRule') { layoutRuleGaps.push('Scoped CSS margin declarations require separate cascade evidence.'); continue; }
        readLayoutRules(rule.cssRules, stylesheetIndex, rule.conditionText ? [...conditions, rule.conditionText] : conditions);
      }
    }
  };
  for (const [stylesheetIndex, sheet] of Array.from(document.styleSheets).entries()) {
    if (sheet.disabled || (sheet.media?.mediaText && mediaMatches(sheet.media.mediaText) === false)) continue;
    try { readLayoutRules(sheet.cssRules, stylesheetIndex); }
    catch { layoutRuleGaps.push('Stylesheet ' + stylesheetIndex + ' margin declarations are inaccessible to this public DOM observation.'); }
  }
  const horizontalFrame = (element, relationship) => {
    const css = style(element), box = rect(element), sides = ['top','right','bottom','left'];
    const padding = Object.fromEntries(sides.map(side => [side, number(css['padding-' + side])])), border = Object.fromEntries(sides.map(side => [side, number(css['border-' + side + '-width'])]));
    let paddingBoxMeasured = true;
    for (let current = element, depth = 0; current && depth < 30; current = current.parentElement, depth++) {
      const currentCss = getComputedStyle(current), zoom = currentCss.getPropertyValue('zoom');
      if (zoom && !['normal','1'].includes(zoom)) { paddingBoxMeasured = false; break; }
      if (currentCss.transform !== 'none') {
        try { const matrix = new DOMMatrixReadOnly(currentCss.transform); if (!matrix.is2D || Math.abs(matrix.a - 1) > .00001 || Math.abs(matrix.d - 1) > .00001 || Math.abs(matrix.b) > .00001 || Math.abs(matrix.c) > .00001) { paddingBoxMeasured = false; break; } }
        catch { paddingBoxMeasured = false; break; }
      }
    }
    const contentRect = paddingBoxMeasured ? { x: round(box.x + border.left + padding.left), y: round(box.y + border.top + padding.top), width: round(Math.max(0, box.width - padding.left - padding.right - border.left - border.right)), height: round(Math.max(0, box.height - padding.top - padding.bottom - border.top - border.bottom)) } : undefined;
    const maxWidth = css['max-width'], responsibilities = [];
    if (maxWidth && maxWidth !== 'none') responsibilities.push('max-width');
    if (padding.left || padding.right) responsibilities.push('horizontal-padding');
    if (number(css['margin-left']) > 0 || number(css['margin-right']) > 0) responsibilities.push('horizontal-margin');
    if (['flex','inline-flex','grid','inline-grid'].includes(css.display)) responsibilities.push('layout-children');
    if (css.position !== 'static') responsibilities.push('positioned-layout');
    const inlineMargins = Object.fromEntries(marginProperties.map(name => [name, element.style.getPropertyValue(name)]).filter(([, value]) => value));
    const matchedMargins = layoutRuleFacts.filter(rule => { try { return element.matches(rule.selector); } catch { return false; } }).slice(-24);
    if (Object.values(inlineMargins).some(value => /\bauto\b/.test(value)) || matchedMargins.some(rule => Object.values(rule.declarations).some(value => /\bauto\b/.test(value)))) responsibilities.push('declared-auto-margin');
    const address = selector(element);
    return { sourceNodeId: address, selector: address, tag: element.tagName.toLowerCase(), parentSelector: element.parentElement ? selector(element.parentElement) : null, relationship, rect: box, contentRect, contentRectStatus: paddingBoxMeasured ? 'measured-padding-box' : 'unverified-transform', maxWidth, boxSizing: css['box-sizing'], padding, computedMargins: { left: css['margin-left'], right: css['margin-right'] }, declaredMargins: { inline: inlineMargins, matchedRules: matchedMargins, notice: 'Matched declarations are evidence, not a resolved cascade; computed pixels and measured rects remain authoritative.' }, display: css.display, direction: css['flex-direction'], gap: css.gap, position: css.position, background: { color: css['background-color'], image: css['background-image'] }, responsibilities, proof: ['public DOM selector', 'getBoundingClientRect', 'getComputedStyle'] };
  };
  const collectContentLayout = (roots, blockAtoms, blockImages, headerInputs) => {
    const viewport = { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, scrollX };
    const ancestors = [], seenAncestors = new Set();
    for (const root of roots) for (let current = root.parentElement, depth = 0; current && depth < 20; current = current.parentElement, depth++) {
      if (seenAncestors.has(current) || !publicElement(current)) continue;
      seenAncestors.add(current); ancestors.push(horizontalFrame(current, 'ancestor'));
    }
    const anchors = Array.from(new Set([...blockAtoms, ...blockImages, ...headerInputs].filter(record => record.visible !== false && record.rect?.width > 0 && record.rect?.height > 0 && record.rect.x + record.rect.width > scrollX && record.rect.x < scrollX + innerWidth).map(record => document.querySelector(record.selector)).filter(Boolean)));
    const frameElements = new Map();
    for (const root of roots) {
      frameElements.set(root, horizontalFrame(root, 'root'));
      for (const element of root.querySelectorAll('*')) {
        if (frameElements.size >= 600) break;
        if (!publicElement(element) || !visible(element) || /^(?:img|svg|path|span|a|button|input|select|textarea)$/i.test(element.tagName)) continue;
        const frame = horizontalFrame(element, 'descendant');
        if (frame.responsibilities.length) frameElements.set(element, frame);
      }
    }
    for (const element of seenAncestors) if (!frameElements.has(element)) {
      const frame = horizontalFrame(element, 'ancestor');
      if (frame.responsibilities.length) frameElements.set(element, frame);
    }
    const candidates = Array.from(frameElements.entries()).filter(([, frame]) => frame.rect.width > 0 && frame.rect.height > 0 && frame.responsibilities.some(reason => ['max-width','horizontal-padding','horizontal-margin'].includes(reason)));
    const contentFrames = candidates.map(([element, frame]) => ({ ...frame, ownsVisibleContent: anchors.length > 0 && anchors.every(anchor => element === anchor || element.contains(anchor)), ownsBlockRoots: roots.every(root => element === root || element.contains(root)) }));
    const owning = candidates.filter(([element]) => anchors.length > 0 && anchors.every(anchor => element === anchor || element.contains(anchor)));
    const preferred = owning.filter(([element]) => !owning.some(([other]) => other !== element && element.contains(other)));
    const gaps = [...layoutRuleGaps];
    if (!anchors.length) gaps.push('No visible public content anchors were measured for this block.');
    if (!preferred.length) gaps.push('No unique horizontal layout owner covers all visible block content; review retained frame and ancestor evidence.');
    if (frameElements.size >= 600) gaps.push('Descendant layout-frame collection reached its bounded limit.');
    if (contentFrames.some(frame => frame.contentRectStatus !== 'measured-padding-box')) gaps.push('A content-frame padding box is unmeasured because scale, rotation, perspective or CSS zoom affects its geometry; its actual border rect is retained.');
    return { version: 1, viewport, status: preferred.length === 1 ? 'observed' : 'unobserved', preferredFrameSelectors: preferred.map(([, frame]) => frame.selector), contentFrames, layoutFrames: Array.from(frameElements.values()), ancestors, paintedRoots: roots.map(root => horizontalFrame(root, 'root')), anchorSelectors: anchors.map(selector), gaps, notice: 'Content frames, their padding boxes and full-width painted roots are separate measured facts. Preferred frames require DOM ownership of every visible public content anchor; no padding or content width is guessed.' };
  };
  const main = document.querySelector('main,[role="main"]');
  const transparentWrappers = [];
  const transparentWrapper = element => {
    if (!element || !publicElement(element) || element.tagName !== 'DIV' || !visible(element)) return false;
    const css = style(element), box = rect(element);
    if (css.display !== 'block' || css.position !== 'static' || css.transform !== 'none' || number(css.opacity) !== 1 || css['box-shadow'] !== 'none' || css['max-width'] !== 'none' || !['0px','auto'].includes(css['min-width']) || number(css['min-height']) > 0 || number(css['flex-grow']) > 0 || css['flex-basis'] !== 'auto') return false;
    if (css['background-image'] !== 'none' || !['rgba(0, 0, 0, 0)','transparent'].includes(css['background-color'])) return false;
    if (['top','right','bottom','left'].some(side => number(css['padding-' + side]) || number(css['margin-' + side]) || number(css['border-' + side + '-width']) || number(css['border-' + side + '-left-radius']) || number(css['border-' + side + '-right-radius']))) return false;
    if (!['visible','clip'].includes(css['overflow-x']) || !['visible','clip'].includes(css['overflow-y']) || css['overflow-x'] === 'clip' || css['overflow-y'] === 'clip') return false;
    const parent = element.parentElement; if (!parent) return false;
    const parentBox = rect(parent), parentCss = style(parent), parentLeft = parentBox.x + number(parentCss['border-left-width']) + number(parentCss['padding-left']), parentWidth = parentBox.width - number(parentCss['border-left-width']) - number(parentCss['border-right-width']) - number(parentCss['padding-left']) - number(parentCss['padding-right']);
    if (['flex','inline-flex','grid','inline-grid'].includes(parentCss.display)) return false;
    return Math.abs(box.x - parentLeft) <= 0.5 && Math.abs(box.width - parentWidth) <= 0.5;
  };
  let wrapper = main;
  for (let depth = 0; wrapper && depth < 20 && wrapper.children.length === 1 && transparentWrapper(wrapper.firstElementChild); depth++) {
    const child = wrapper.firstElementChild;
    transparentWrappers.push({ selector: selector(child), parentSelector: selector(wrapper), rect: rect(child), style: style(child), proof: ['single-child traversal', 'computed block/static/transparent/no-padding/no-margin/no-border/no-max-width/no-clipping', 'measured horizontal box equals parent content box'], notice: 'This traversal selects block candidates; the ancestor remains in contentLayout evidence and is not deleted from a reconstruction contract.' });
    wrapper = child;
  }
  const major = wrapper ? Array.from(wrapper.children) : [];
  const header = document.querySelector('header,[role="banner"]');
  const footer = document.querySelector('footer,[role="contentinfo"]');
  const explicitBoundaries = Array.isArray(options.blockBoundaries)?options.blockBoundaries.map(candidate=>({id:String(candidate.id),role:String(candidate.role||'unknown'),elements:Array.isArray(candidate.selectors)?candidate.selectors.map(address=>document.querySelector(address)).filter(Boolean):[],sourceIndices:Array.isArray(candidate.sourceIndices)?candidate.sourceIndices:[]})):null;
  const blockCandidates = explicitBoundaries?explicitBoundaries.map(({elements,...candidate})=>({...candidate,element:elements[0],elements})).filter(candidate=>candidate.element):[
    ...(header ? [{id:'header',role:'header',element:header,sourceIndices:[]}] : []),
    ...major.map((element,index)=>({id:'source-block-'+index,role:'unknown',element,sourceIndices:[index]})).filter(({element})=>publicElement(element)&&(visible(element,false)&&rect(element).width>0&&rect(element).height>=1||element.querySelector('.slick-slide:not(.slick-cloned)'))),
    ...(footer ? [{id:'footer',role:'footer',element:footer,sourceIndices:[]}] : []),
  ];
  if(options.boundariesOnly===true){
    const boundaryRoot=typeof options.boundaryRootSelector==='string'?document.querySelector(options.boundaryRootSelector):wrapper;
    const candidates=Array.from(boundaryRoot?.children||[]).map((element,sourceIndex)=>{const owners=blockCandidates.filter(candidate=>(candidate.elements||[candidate.element]).some(root=>root===element||root.contains(element)));return {selector:selector(element),sourceIndex,ownerBlockId:owners.length===1?owners[0].id:undefined,rect:rect(element)};});
    return {version:1,observedPage:{url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight},pageHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)},deviceFacts:observedDeviceFacts(),blocks:blockCandidates.map(({element,elements,...candidate})=>({...candidate,selector:selector(element),selectors:(elements||[element]).map(selector),rect:union(elements||[element])})),boundaryObservation:{rootSelector:boundaryRoot?selector(boundaryRoot):null,candidates},responsiveCSS:{widthBreakpoints:[...responsiveWidthBreakpoints].sort((a,b)=>a-b),mediaConditions:responsiveMediaConditions,containerQueryConditions,gaps:[...new Set(layoutRuleGaps)]}};
  }
  const collectPresentationObservation = (roots, captures) => {
    const origin = union(roots), evidence = ['public-live-DOM', 'getBoundingClientRect', 'getComputedStyle'];
    const relative = element => { const box = rect(element); return { ...box, x: round(box.x - origin.x), y: round(box.y - origin.y) }; };
    const identity = (prefix, element) => { const address = selector(element); let hash = 2166136261; for (let index = 0; index < address.length; index++) hash = Math.imul(hash ^ address.charCodeAt(index),16777619); return prefix + '-' + (hash >>> 0).toString(16); };
    const paint = element => {
      const css = style(element), box = rect(element), radii = css['border-top-left-radius'].trim().split(/\s+/);
      const resolveRadius = (value, dimension) => {
        if (/^-?[\d.]+%$/.test(value)) return Number.parseFloat(value) * dimension / 100;
        if (/^-?[\d.]+px$/.test(value) || /^0(?:\.0+)?$/.test(value)) { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : undefined; }
        return undefined;
      };
      const horizontal = resolveRadius(radii[0], box.width), vertical = resolveRadius(radii[1] || radii[0], box.height);
      const borderRadius = horizontal === undefined || vertical === undefined ? undefined : Math.max(0, Math.min(horizontal, vertical));
      return { color: css.color, backgroundColor: css['background-color'], borderColor: css['border-top-color'], borderWidth: number(css['border-top-width']), borderRadius, opacity: number(css.opacity), fontSize: number(css['font-size']), lineHeight: number(css['line-height']), fontWeight: css['font-weight'], boxShadow: css['box-shadow'] };
    };
    const sourceMapping = [], regions = [], controlGroups = [], media = [], relations = [], nodes = new Map(), gaps = [];
    const record = (element, prefix = 'region') => ({ id: identity(prefix,element), sourceNodeId: selector(element), evidence, rect: relative(element), visible: visibilityFacts(element).painted, paint: paint(element), maxClippedRatio: visibilityFacts(element).clippedRatio });
    const addRegion = element => {
      if (nodes.has(element)) return nodes.get(element);
      if (regions.length >= 200) return null;
      const result = record(element); if (directText(element)) result.lineCount = lineFacts(element).lineCount;
      regions.push(result); nodes.set(element,result.id); sourceMapping.push({ id: result.id, selector: selector(element), parentSelector: element.parentElement ? selector(element.parentElement) : null, tag: element.tagName.toLowerCase(), visibility: visibilityFacts(element), lineLayout: directText(element) ? lineFacts(element) : undefined }); return result.id;
    };
    const controlSelector = '.slick-prev,.slick-next,.slick-arrow,.slick-dots button,.swiper-button-prev,.swiper-button-next,.swiper-pagination-bullet,[aria-controls],button[aria-label]';
    const ownership = [];
    for (const capture of captures.slice(0,24)) {
      const carouselRoot = document.querySelector(capture.selector); if (!carouselRoot) continue;
      const ownerId = addRegion(carouselRoot), track = document.querySelector(capture.trackSelector); if (track) addRegion(track);
      const candidates = new Set(Array.from(carouselRoot.querySelectorAll(controlSelector)).filter(publicElement));
      // Some libraries mount controls beside the track/root. Retain that ownership
      // fact without treating every nearby commerce action as a carousel control.
      for (let parent = carouselRoot.parentElement, depth = 0; parent && depth < 3 && !parent.matches('body,html,main,header,footer'); parent = parent.parentElement, depth++) {
        for (const candidate of parent.querySelectorAll(controlSelector)) {
          if (!publicElement(candidate) || candidates.has(candidate) || carouselRoot.contains(candidate)) continue;
          const aria = (candidate.getAttribute('aria-controls') || '').split(/\s+/), explicit = !!carouselRoot.id && aria.includes(carouselRoot.id) || !!track?.id && aria.includes(track.id);
          const closest = candidate.closest('.pd-carousel,.slick-slider,.swiper,[data-slick]');
          const nearby = !closest && candidate.matches('.slick-prev,.slick-next,.slick-arrow,.swiper-button-prev,.swiper-button-next') && Array.from(parent.querySelectorAll('.pd-carousel,.slick-slider,.swiper,[data-slick]')).filter(root => !Array.from(parent.querySelectorAll('.pd-carousel,.slick-slider,.swiper,[data-slick]')).some(other => other !== root && other.contains(root))).length === 1;
          if (explicit || nearby) { candidates.add(candidate); ownership.push({ control: selector(candidate), carousel: capture.selector, kind: explicit ? 'aria-controls' : 'unique-sibling-carousel', commonParent: selector(parent), evidence }); }
        }
      }
      const controls = [...candidates].slice(0,160), groups = new Map();
      const fractionSearchRoots = new Set([carouselRoot,...controls.map(control => control.parentElement).filter(Boolean)]);
      const fractionCandidates = Array.from(new Set([...fractionSearchRoots].flatMap(root => [...root.querySelectorAll('span,output,[aria-live]')]))).filter(element => publicElement(element) && /^\s*\d+\s*\/\s*\d+\s*$/.test(element.textContent || '') && !Array.from(element.children).some(child => /^\s*\d+\s*\/\s*\d+\s*$/.test(child.textContent || ''))).slice(0,24);
      for (const element of [...controls,...fractionCandidates]) {
        const tokens = [element.className?.toString(),element.getAttribute('aria-label'),element.getAttribute('title')].join(' ').toLowerCase();
        const role = fractionCandidates.includes(element) ? 'fraction' : /prev|previous|back/.test(tokens) ? 'previous' : /next|forward/.test(tokens) ? 'next' : /autoplay|pause|play|stop/.test(tokens) ? 'autoplay' : element.matches('.swiper-pagination-bullet,.slick-dots button,[role="tab"]') || element.closest('.slick-dots') ? 'dot' : null;
        if (!role) continue;
        const group = element.closest('.slick-dots,.swiper-pagination,[role="tablist"]') || element.parentElement || carouselRoot;
        const values = groups.get(group) || []; const item = { ...record(element,'control'), role, text: text(element), disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true' || element.matches('.slick-disabled,.swiper-button-disabled'), active: element.getAttribute('aria-current') === 'true' || element.getAttribute('aria-selected') === 'true' || element.matches('.slick-active,.swiper-pagination-bullet-active') || !!element.closest('.slick-dots .slick-active'), glyph: compactGlyph(element), glyphEvidence: glyphFacts(element) };
        values.push(item); groups.set(group,values); sourceMapping.push({ id: item.id, selector: selector(element), parentSelector: element.parentElement ? selector(element.parentElement) : null, carouselSelector: capture.selector, tag: element.tagName.toLowerCase(), visibility: visibilityFacts(element), glyphEvidence: item.glyphEvidence });
      }
      for (const [group, items] of groups) {
        let componentOwner = carouselRoot; while (componentOwner && !componentOwner.contains(group)) componentOwner = componentOwner.parentElement;
        const componentOwnerId = componentOwner && roots.some(root => root === componentOwner || root.contains(componentOwner)) ? addRegion(componentOwner) : ownerId;
        if (!componentOwner || !componentOwnerId) gaps.push('Carousel controls have no measured component owner inside this block.');
        const boxes = items.filter(item => item.visible).map(item => item.rect), row = boxes.length > 1 && boxes.every(box => Math.abs(box.y + box.height / 2 - boxes[0].y - boxes[0].height / 2) <= Math.max(4,box.height / 4)), column = boxes.length > 1 && boxes.every(box => Math.abs(box.x + box.width / 2 - boxes[0].x - boxes[0].width / 2) <= Math.max(4,box.width / 4));
        const result = { ...record(group,'controls'), ownerId: componentOwnerId, layout: row ? 'row' : column ? 'column' : style(group).position === 'absolute' ? 'overlay' : 'separate', pagination: items.some(item => item.role === 'fraction') ? 'fraction' : items.some(item => item.role === 'dot') ? 'bullets' : 'none', controls: items };
        controlGroups.push(result); sourceMapping.push({ id: result.id, selector: selector(group), parentSelector: group.parentElement ? selector(group.parentElement) : null, carouselSelector: capture.selector, tag: group.tagName.toLowerCase() });
      }
    }
    for (const root of roots) {
      addRegion(root);
      const candidates = [root,...root.querySelectorAll('*')].filter(element => publicElement(element) && (directText(element) || element.matches('img,picture,button,svg,a[href]') || element.parentElement === root || /url\(/.test(style(element)['background-image'])));
      for (const element of candidates.slice(0,240)) {
        addRegion(element);
        if (element.matches('img')) { const observation = image(element), result = { ...record(element,'media'), mode: 'image', fit: observation.style['object-fit'], objectPosition: observation.style['object-position'], aspectRatio: observation.rect.height > 0 ? round(observation.rect.width / observation.rect.height) : undefined, actualImage: observation }; media.push(result); sourceMapping.push({ id: result.id, selector: selector(element), parentSelector: element.parentElement ? selector(element.parentElement) : null, tag: 'img' }); }
        else if (/url\(/.test(style(element)['background-image'])) { const css = style(element), box = rect(element), result = { ...record(element,'media'), mode: 'background', fit: css['background-size'], objectPosition: css['background-position'], aspectRatio: box.height > 0 ? round(box.width / box.height) : undefined, actualBackground: css['background-image'] }; media.push(result); sourceMapping.push({ id: result.id, selector: selector(element), parentSelector: element.parentElement ? selector(element.parentElement) : null, tag: element.tagName.toLowerCase() }); }
      }
      if (candidates.length > 240) gaps.push('Presentation node inspection reached the bounded per-root limit; unrecorded components require explicit evidence.');
    }
    for (const [element, id] of nodes) {
      const parent = element.parentElement, parentId = nodes.get(parent); if (parentId) relations.push({ id: id + '-parent', kind: 'contains', from: parentId, to: id, tolerancePx: 2, evidence });
      const sibling = element.nextElementSibling, siblingId = nodes.get(sibling); if (!siblingId || !visibilityFacts(element).painted || !visibilityFacts(sibling).painted) continue;
      const a = relative(element), b = relative(sibling), overlap = Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>1;
      if (!overlap) relations.push({ id: id + '-sibling', kind: 'non-overlap', from: id, to: siblingId, tolerancePx: 2, evidence });
      if (Math.abs(a.y+a.height/2-b.y-b.height/2) <= 4) relations.push({ id: id + '-row', kind: 'same-row', from: id, to: siblingId, tolerancePx: 4, evidence });
    }
    if (regions.length >= 200) gaps.push('Presentation regions reached the bounded limit.');
    const viewportFacts=observedDeviceFacts();
    for(const message of environmentGaps)if(!gaps.includes(message))gaps.push(message);
    return { version: 1, status: roots.length ? 'observed' : 'unobserved', width: innerWidth, height: innerHeight, evidence, regions, controlGroups, media, relations, sourceMapping, ownership, gaps, viewportFacts, notice: 'Relative rectangles, actual ownership and responsive media are observed facts; source selectors must be mapped to registered target native elements before verification. No missing control is inferred from a component name.' };
  };
  const recordBlock = (id, role, roots, sourceIndices) => {
    if(options.sceneOnly===true||options.sceneDetailedOnly===true){
      const publicRoots=roots.filter(publicElement);
      return {id,role,sourceIndices,selectors:publicRoots.map(selector),rect:union(publicRoots),style:{},rootStyles:[],contentLayout:{status:'unobserved',preferredFrameSelectors:[],contentFrames:[],gaps:['Fast independent scene observation omits detailed content-frame cascade; complete frame capture remains required.']},textAtoms:[],images:[],links:[],headerInputs:[],carousels:[],presentation:'static',productCount:0};
    }
    const publicRoots = roots.filter(publicElement), captures = carouselRoots(publicRoots), productCount = publicRoots.reduce((count, root) => count + root.querySelectorAll('.product-tile,.product,.product-card').length, 0);
    let blockAtoms = atoms(publicRoots), blockImages = publicRoots.flatMap(images), blockLinks = publicRoots.flatMap(links);
    const headerInputs = [];
    if (role === 'header') {
      const displayable = record => {
        const element = document.querySelector(record.selector); if (!element) return false;
        const parentCarousel = element.closest('.pd-carousel,.slick-slider,.swiper,[data-slick]');
        if (parentCarousel && rect(parentCarousel).width > 1 && rect(parentCarousel).height > 1 && element.closest('.slick-slide:not(.slick-cloned),.swiper-slide:not(.swiper-slide-duplicate)')) return true;
        const box = rect(element); return visible(element) && box.x + box.width > scrollX && box.x < scrollX + innerWidth;
      };
      blockAtoms = blockAtoms.filter(displayable); blockImages = blockImages.filter(displayable); blockLinks = blockLinks.filter(displayable);
      for (const root of publicRoots) for (const input of root.querySelectorAll('input')) {
        if (!visible(input)) continue; const box = rect(input); if (box.x + box.width <= scrollX || box.x >= scrollX + innerWidth) continue;
        const inputType = String(input.getAttribute('type') || 'text').toLowerCase();
        if (!['text','search'].includes(inputType)) continue;
        headerInputs.push({ selector: selector(input), rect: box, style: style(input), attributes: Object.fromEntries(['type','placeholder','aria-label','title'].filter(name => input.hasAttribute(name)).map(name => [name,input.getAttribute(name)])) });
      }
    }
    return { id, role, sourceIndices, selectors: publicRoots.map(selector), rect: union(publicRoots), style: publicRoots[0] ? style(publicRoots[0]) : {}, rootStyles: publicRoots.map(root => ({ selector: selector(root), rect: rect(root), style: style(root) })), contentLayout: collectContentLayout(publicRoots, blockAtoms, blockImages, headerInputs), presentationObservation: collectPresentationObservation(publicRoots,captures), text: role === 'header' ? clean(blockAtoms.map(atom => atom.text).join(' ')) : clean(publicRoots.map(text).join(' ')), textAtoms: blockAtoms, images: blockImages, links: blockLinks, headerInputs, carousels: captures, presentation: captures.some(item => item.slides.length > 1) ? 'carousel' : 'static', productCount };
  };
  const blocks = [];
  const selected = id => typeof options.blockId!=='string'||options.blockId===id;
  if(explicitBoundaries)for(const candidate of explicitBoundaries){if(selected(candidate.id))blocks.push(recordBlock(candidate.id,candidate.role,candidate.elements,candidate.sourceIndices));}
  if (!explicitBoundaries&&header&&selected('header')) blocks.push(recordBlock('header', 'header', [header], []));
  major.forEach((element, index) => {
    if(explicitBoundaries)return;
    if(!selected('source-block-'+index))return;
    if (!publicElement(element)) return;
    const preservedLayoutBox = visible(element, false) && rect(element).width > 0 && rect(element).height >= 1;
    if(options.sceneOnly===true){if(preservedLayoutBox){const block=recordBlock('source-block-'+index,'unknown',[element],[index]);block.candidateReason='fast-visible-layout-candidate';blocks.push(block);}return;}
    if (meaningful(element) || preservedLayoutBox) {
      const block = recordBlock('source-block-' + index, 'unknown', [element], [index]);
      block.candidateReason = meaningful(element) ? 'observed-public-content' : 'visible-layout-box-without-text';
      blocks.push(block);
    }
  });
  if (!explicitBoundaries&&footer&&selected('footer')) blocks.push(recordBlock('footer', 'footer', [footer], []));
  // This inventory is enumerated before a reconstruction contract exists. It does
  // not inherit the author's selected presentation regions or slider library.
  const collectSourceScene = () => {
    const items = [], gaps = [], identity = (kind, address) => {
      let hash = 2166136261; for (let index = 0; index < address.length; index++) hash = Math.imul(hash ^ address.charCodeAt(index),16777619);
      return 'scene-' + kind + '-' + (hash >>> 0).toString(16);
    };
    const seen = new Set(), evidence = ['independent-public-DOM-enumeration','getBoundingClientRect','getComputedStyle'];
    const roots = blocks.flatMap(block => block.selectors.map(address => ({ block, element: document.querySelector(address) })).filter(row => row.element));
    const blockFor = element => roots.filter(row => row.element === element || row.element.contains(element)).sort((a,b) => a.block.rect.width * a.block.rect.height - b.block.rect.width * b.block.rect.height)[0]?.block;
    const painted = element => {
      if(!publicElement(element))return false;
      if(options.sceneOnly!==true)return visible(element)&&visibilityFacts(element).painted;
      const box=rect(element);if(box.width<=0||box.height<=0)return false;const css=getComputedStyle(element);
      return css.display!=='none'&&css.visibility!=='hidden'&&number(css.opacity)!==0&&visibilityFacts(element).painted;
    };
    const record = (kind, element, options = {}) => {
      const address = selector(element), key = identity(kind, (options.sourceBlockId || '') + ':' + address);
      if (seen.has(key)) return items.find(item => item.id === key);
      seen.add(key); const shown = painted(element), result = { id: key, kind, selector: address, ancestorSelectors: ancestorSelectors(element), sourceBlockId: options.sourceBlockId || blockFor(element)?.id, rect: rect(element), visible: shown, required: shown, state: 'resting', facts: {}, evidence, ...options };
      items.push(result); return result;
    };
    for (const block of blocks) {
      const element = document.querySelector(block.selectors[0]); if (!element) continue;
      record('block',element,{sourceBlockId:block.id,rect:block.rect,facts:{selectors:block.selectors,role:block.role,order:blocks.indexOf(block)}});
      for (const address of block.contentLayout.preferredFrameSelectors) {
        const frame = document.querySelector(address), observation=block.contentLayout.contentFrames.find(value=>value.selector===address); if (frame) record('content-frame',frame,{sourceBlockId:block.id,...(observation?.contentRect?{rect:observation.contentRect}:{}),facts:{relationship:'independently-measured-content-owner',frame:observation}});
      }
      if (block.contentLayout.status !== 'observed') gaps.push({code:'scene-content-owner-unresolved',message:'A source block has no unique measured content owner.',sourceId:identity('block',block.id+':'+selector(element))});
    }
    const sceneRoots=typeof options.blockId==='string'?(blocks[0]?.selectors||[]).map(address=>document.querySelector(address)).filter(Boolean):[typeof options.sceneScope==='string'?document.querySelector(options.sceneScope):document.body].filter(Boolean);
    const scopedQuery=address=>Array.from(new Set(sceneRoots.flatMap(root=>Array.from(root.querySelectorAll(address)))));
    const maxSceneNodes=Number.isInteger(options.maxSceneNodes)&&options.maxSceneNodes>0&&options.maxSceneNodes<=12000?options.maxSceneNodes:options.sceneOnly===true?1800:12000;
    const queriedElements=scopedQuery('*'),elements=queriedElements.slice(0,maxSceneNodes).filter(publicElement);
    if(typeof options.sceneScope==='string'||typeof options.blockId==='string')gaps.push({code:'scene-scoped-observation',message:'This independent scene packet covers only '+(options.blockId||options.sceneScope)+'; other source blocks require separate observation.'});
    if (queriedElements.length > maxSceneNodes) gaps.push({code:'scene-node-limit',message:'Independent scene enumeration reached its '+maxSceneNodes+' node budget; remaining nodes are unobserved.'});
    if(options.sceneOnly===true)gaps.push({code:'scene-fast-frames-unobserved',message:'Fast scene mode captures independent feature boundaries; detailed content-frame cascade and text/media paint require full or per-block evidence.'});
    const bounded = elements.slice(0,maxSceneNodes), repeats = [], tracks = [];
    // Control discovery is a separate denominator: a large hidden mega-menu
    // early in document order must not consume the entire feature budget.
    const queriedControls=scopedQuery('button,[role="button"],[role="tab"],output,[aria-live]');
    const priorityParents=new Set(scopedQuery('[aria-roledescription="carousel"],[role="listbox"],[data-slider-track],.slick-track,.swiper-wrapper'));
    for(const control of queriedControls)for(const id of (control.getAttribute('aria-controls')||'').split(/\s+/).filter(Boolean)){
      for(let target=document.getElementById(id),depth=0;target&&depth<3;target=target.parentElement,depth++)priorityParents.add(target);
    }
    const parentCandidates=Array.from(new Set([...priorityParents,...bounded]));
    const signatureCache=new Map(),signature = element => {if(signatureCache.has(element))return signatureCache.get(element);const value=[element.tagName,element.getAttribute('role') || '',Math.min(element.querySelectorAll('img,picture').length,2),Math.min(element.querySelectorAll('a[href]').length,2),Math.min(element.querySelectorAll('h1,h2,h3,h4,h5,h6').length,2)].join(':');signatureCache.set(element,value);return value;};
    for (const parent of parentCandidates) {
      if (parent.children.length<2||parent.children.length>100||!painted(parent) || parent.matches('ul[role="tablist"],ol[role="tablist"]')) continue;
      const children = Array.from(parent.children).filter(element=>publicElement(element)&&rect(element).width>1&&rect(element).height>1&&!element.matches('script,style,svg,path,button'));
      if (children.length < 2 || children.length > 100) continue;
      const buckets = new Map(); for (const child of children) { const token=signature(child), group=buckets.get(token)||[];group.push(child);buckets.set(token,group); }
      const repeated = [...buckets.values()].sort((a,b)=>b.length-a.length)[0];
      if (repeated.length < 2 || repeated.length < children.length * .6 || !repeated.some(element=>element.querySelector('img,a[href],h1,h2,h3,h4,h5,h6') || element.matches('a[href],article,[role="group"]'))) continue;
      const recordItem = record('repeated-template',parent,{facts:{itemSelectors:repeated.map(selector),itemCount:repeated.length,visibleItems:repeated.filter(painted).map(selector),signature:signature(repeated[0]),representativeSelector:selector(repeated.find(painted)||repeated[0]),layout:{display:style(parent).display,direction:style(parent)['flex-direction'],columns:style(parent)['grid-template-columns'],gap:style(parent).gap},slots:Array.from(repeated[0].querySelectorAll('img,picture,a[href],h1,h2,h3,h4,h5,h6,[itemprop],button')).slice(0,32).map(element=>({selector:selector(element),tag:element.tagName.toLowerCase(),itemprop:element.getAttribute('itemprop'),rect:rect(element)}))}});
      repeats.push({element:parent,item:recordItem,children:repeated});
      const css=getComputedStyle(parent), first=rect(repeated[0]), second=rect(repeated[1]), horizontal=Math.abs(first.y-second.y)<Math.max(6,Math.min(first.height,second.height)*.2)&&Math.abs(first.x-second.x)>2;
      const overflow=parent.scrollWidth>parent.clientWidth+2&&/auto|scroll|hidden|clip/.test(css.overflowX), transforms=repeated.some(element=>getComputedStyle(element).transform!=='none'), semantics=parent.getAttribute('aria-roledescription')==='carousel'||parent.getAttribute('role')==='listbox'||repeated.some(element=>element.getAttribute('aria-roledescription')==='slide');
      // Library names are supplemental facts, never the only supported route.
      const hint=parent.matches('.slick-track,.swiper-wrapper,[data-slider-track]')||!!parent.closest('[aria-roledescription="carousel"]');
      let clip=parent.parentElement, clipped=false; for(let depth=0;clip&&depth<3;depth++,clip=clip.parentElement){if(clip.scrollWidth>clip.clientWidth+2&&/auto|scroll|hidden|clip/.test(getComputedStyle(clip).overflowX)){clipped=true;break;}}
      if(horizontal&&(overflow||transforms||semantics||hint||clipped)) tracks.push({element:parent,item:recordItem,children:repeated,evidence:[...(overflow||clipped?['horizontal-overflow']:[]),...(transforms?['transformed-items']:[]),...(semantics?['ARIA-component-semantics']:[]),...(hint?['supplemental-track-hint']:[])]});
    }
    const fractionSpans=scopedQuery('span'),fractionCandidates=fractionSpans.slice(0,2000).filter(element=>element.children.length<=3&&/^\d+\s*\/\s*\d+$/.test(clean(element.textContent)));
    if(fractionSpans.length>2000)gaps.push({code:'scene-fraction-scan-limit',message:'Fraction span enumeration reached 2000 candidates; later fractions remain unobserved.'});
    const controlElements = Array.from(new Set([...queriedControls,...fractionCandidates])).filter(element => painted(element) && (element.matches('button,[role="button"],[role="tab"],input[type="button"],input[type="submit"]') || element.matches('output,[aria-live],span') && /^\d+\s*\/\s*\d+$/.test(clean(element.textContent)) && !Array.from(element.children).some(child=>/^\d+\s*\/\s*\d+$/.test(clean(child.textContent)))));
    // Hidden controls and non-action aria-live regions are measured absences, not missing observations.
    const controlVisibility = queriedControls.map(element=>({selector:selector(element),painted:painted(element),role:element.getAttribute('role'),tag:element.tagName.toLowerCase()}));
    const groups = new Map();
    for (const element of controlElements.slice(0,500)) {
      const label=clean([element.getAttribute('aria-label'),element.getAttribute('title'),directText(element)].join(' ')), tokens=(label+' '+String(element.className||'')).toLowerCase(), value=clean(element.textContent);
      const role=/^\d+\s*\/\s*\d+$/.test(value)?'fraction':/\b(prev|previous|back|vorige|précédent)\b|上一|前一/.test(tokens)||/^[‹←❮]$/.test(value)?'previous':/\b(next|forward|suivant)\b|下一|后一/.test(tokens)||/^[›→❯]$/.test(value)?'next':/autoplay|pause|\bplay\b|\bstop\b|暂停|播放/.test(tokens)?'autoplay':element.getAttribute('role')==='tab'||!!element.closest('[role="tablist"],.slick-dots,.swiper-pagination')||/^\d+$/.test(value)&&Array.from(element.parentElement?.children||[]).filter(child=>child.matches('button,[role="tab"]')).length>1?'dot':'action';
      let candidates=[]; const ariaIds=(element.getAttribute('aria-controls')||'').split(/\s+/).filter(Boolean), controlled=ariaIds.map(id=>document.getElementById(id)).filter(Boolean);
      if(controlled.length)candidates=tracks.filter(track=>controlled.some(target=>target===track.element||target.contains(track.element)||track.element.contains(target)));
      let ownership=candidates.length===1?'aria-controls':undefined;
      if(!candidates.length&&role!=='action'){
        for(let parent=element.parentElement,depth=0;parent&&depth<5&&!parent.matches('body,html,main');parent=parent.parentElement,depth++){
          const nearby=tracks.filter(track=>parent.contains(track.element));
          if(nearby.length===1){candidates=nearby;ownership='unique-component-ancestor';break;}
          if(nearby.length>1)break;
        }
      }
      const owner=candidates.length===1?candidates[0]:undefined, control=record('control',element,{role,...(owner?{ownerId:owner.item.id}:{}),facts:{label,disabled:element.hasAttribute('disabled')||element.getAttribute('aria-disabled')==='true',active:element.getAttribute('aria-current')==='true'||element.getAttribute('aria-selected')==='true',ownership:ownership||'unproven',ariaControls:ariaIds,glyph:compactGlyph(element),behavior:'unobserved'}});
      if(role!=='action'&&!owner)gaps.push({code:'scene-control-owner-unresolved',message:'A directional, pagination or autoplay control has no proven unique repeated component owner.',sourceId:control.id});
      if(!control.sourceBlockId)gaps.push({code:'scene-control-block-unresolved',message:'A visible control lies outside independently observed source blocks.',sourceId:control.id});
      if(owner){const groupElement=element.closest('[role="tablist"],.slick-dots,.swiper-pagination')||element.parentElement||owner.element,key=owner.item.id+':'+selector(groupElement),group=groups.get(key)||{element:groupElement,owner,controls:[]};group.controls.push(control);groups.set(key,group);}
    }
    if(controlElements.length>500)gaps.push({code:'scene-control-limit',message:'Independent control enumeration reached 500 controls; later controls remain unobserved.'});
    for(const group of groups.values())record('control-group',group.element,{ownerId:group.owner.item.id,facts:{controlIds:group.controls.map(control=>control.id),roles:group.controls.map(control=>control.role),ownershipEvidence:group.owner.evidence,pagination:group.controls.some(control=>control.role==='fraction')?'fraction':group.controls.some(control=>control.role==='dot')?'bullets':'none'}});
    const facts=observedDeviceFacts();for(const message of environmentGaps)gaps.push({code:'scene-environment-unobserved',message});
    return {version:1,method:'independent-public-dom-scene',viewport:{width:innerWidth,height:innerHeight,...facts},state:'resting',enumeration:{queriedNodes:queriedElements.length,examinedNodes:bounded.length,queriedControls:queriedControls.length,visibleControls:controlElements.length,scope:typeof options.blockId==='string'?options.blockId:typeof options.sceneScope==='string'?options.sceneScope:'document.body',rootSelectors:sceneRoots.map(selector),controlVisibility,nodeBudget:maxSceneNodes},items,gaps,notice:'Independent inventory; no source action is executed. Layout and resting state are observed; behavior and uncertain ownership remain explicit gaps.'};
  };
  const sourceScene = collectSourceScene();
  if(options.sceneDetailedOnly===true)return {version:1,observedPage:{url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight},pageHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)},sourceScene,notice:'Independent detailed scene inventory with block content captured separately.'};
  if(typeof options.blockId==='string')return {version:1,observedPage:{url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight},pageHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)},blocks,sourceScene,observedNodes:[],notice:'Scoped full block packet. Merge only with a complete independently captured boundary inventory and every corresponding block packet.'};
  if(options.sceneOnly===true)return {version:1,observedPage:{url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight},pageHeight:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)},blocks,sourceScene,notice:'Bounded independent scene-only observation. Its explicit scope/limits/frame gaps prevent it from impersonating a complete capture.'};
  const allNodes = []; const recorded = new Set();
  if (options.includeNodes !== false) for (const block of blocks) for (const address of block.selectors) {
    const root = document.querySelector(address); if (!root) continue;
    for (const element of [root, ...root.querySelectorAll('*')]) {
      if (!publicElement(element) || recorded.has(element) || allNodes.length >= 2600) continue;
      recorded.add(element); const computed = getComputedStyle(element);
      if (!visible(element) && !element.closest('.slick-slide,.swiper-slide')) continue;
      const tag = element.tagName.toLowerCase();
      allNodes.push({ id: 'node-' + (allNodes.length + 1), blockId: block.id, selector: selector(element), parentSelector: element.parentElement ? selector(element.parentElement) : undefined, tag, attributes: attributes(element), text: text(element), directText: directText(element), rect: rect(element), visible: visible(element), style: style(element), layoutResponsibility: ['flex','inline-flex','grid','inline-grid'].includes(computed.display) || computed.position !== 'static' || number(computed.paddingTop) + number(computed.paddingRight) + number(computed.paddingBottom) + number(computed.paddingLeft) > 0, image: tag === 'img' ? image(element) : undefined });
    }
  }
  const pageImages = Array.from(document.querySelectorAll('img')).filter(publicElement).map(image);
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(element => publicElement(element) && visible(element)).map(element => ({ level: Number(element.tagName.slice(1)), text: text(element), selector: selector(element), rect: rect(element) })).filter(item => item.text);
  const navigation = Array.from(document.querySelectorAll('header a[href],nav a[href]')).filter(publicElement).map(element => ({ text: text(element), href: element.href, selector: selector(element) }));
  const ctas = Array.from(document.querySelectorAll('a[href],button')).filter(element => publicElement(element) && visible(element) && text(element)).map(element => ({ text: text(element), href: element.tagName === 'A' ? element.href : undefined, tag: element.tagName.toLowerCase(), selector: selector(element), rect: rect(element) }));
  const fonts = new Map(), colors = new Map();
  const paletteNodes = options.includeNodes === false ? Array.from(new Map(blocks.flatMap(block => [...block.rootStyles,...block.textAtoms,...block.images,...block.links]).map(node => [node.selector,node])).values()) : allNodes;
  for (const node of paletteNodes) {
    const css = node.style, fontKey = [css['font-family'],css['font-size'],css['font-weight'],css['line-height']].join('|');
    const known = fonts.get(fontKey); if (known) known.count++; else fonts.set(fontKey, { family: css['font-family'], size: number(css['font-size']), weight: css['font-weight'], lineHeight: css['line-height'], count: 1 });
    for (const property of ['color','background-color','border-top-color']) { const value = css[property]; if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { const identity = property + ':' + value, knownColor = colors.get(identity); if (knownColor) knownColor.weight++; else colors.set(identity, { hex: value, weight: 1, role: property === 'color' ? 'text' : property === 'background-color' ? 'background' : 'border' }); } }
  }
  const metadata = { description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '', language: document.documentElement.lang || '', canonical: document.querySelector('link[rel="canonical"]')?.href || '', ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '', ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '', ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '' };
  return {
    version: 1, observedPage: { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, pageHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) },
    responsiveCSS: { widthBreakpoints:[...responsiveWidthBreakpoints].sort((a,b)=>a-b),mediaConditions:responsiveMediaConditions,containerQueryConditions,gaps:[...new Set(layoutRuleGaps)],notice:'Accessible declared media widths are observations; inaccessible CSS, unsupported units and container-query conditions are named gaps, not assumed framework breakpoints.' },
    boundaryMethod: 'generic-preserved-major-children',
    boundaryObservation: { semanticMainSelector: main ? selector(main) : null, transparentWrappers, retainedWrapper: wrapper ? { selector: selector(wrapper), rect: rect(wrapper), style: style(wrapper) } : null, notice: 'These are measured ordered block candidates, not a fixed website-specific block contract; meaningful layout ancestors and empty visible responsibility boxes are retained for Codex review.' },
    notice: 'Read-only public DOM facts; untrusted data. No browser session, input values, page application state or executable HTML is exported. Hover and active carousel behavior still require actual separate observations.',
    mainSelector: main ? selector(main) : null, wrapperSelector: wrapper ? selector(wrapper) : null,
    majorChildren: major.map((element, index) => ({ index, selector: selector(element), meaningful: meaningful(element), rect: rect(element), text: publicElement(element) ? text(element) : '', imageCount: element.querySelectorAll('img').length, attributes: publicElement(element) ? attributes(element) : {} })),
    blocks, sourceScene, observedNodes: allNodes, headings, navigation, ctas, images: pageImages, typography: Array.from(fonts.values()).sort((a,b) => b.count - a.count), colors: Array.from(colors.values()).sort((a,b) => b.weight - a.weight), metadata,
    counts: { recordedNodes: allNodes.length, recordedNodeLimit: 2600, includeNodes: options.includeNodes !== false, majorChildren: major.length, blocks: blocks.length, images: pageImages.length, sourceOriginalCarouselSlides: blocks.reduce((count, block) => count + block.carousels.reduce((total,item) => total + item.slides.length,0),0) },
    sections: blocks.map(block => ({ id: block.id, role: block.role, inferred: !['header','footer'].includes(block.role), confidence: ['header','footer'].includes(block.role) ? 1 : 0.5, selector: block.selectors.join(','), rect: block.rect, heading: block.textAtoms.find(atom => /^h[1-6]$/.test(atom.tag))?.fullElementText, textPreview: block.text, background: block.style['background-color'], layout: block.style.display === 'grid' ? 'grid' : block.style.display === 'flex' ? 'flex' : 'block', direction: block.style['flex-direction'], gap: number(block.style.gap), padding: ['top','right','bottom','left'].map(side => number(block.style['padding-' + side])) })),
    layout: { contentWidth: main ? round(main.getBoundingClientRect().width) : innerWidth, hero: { layout: 'image-led', imageSide: 'background' }, density: 'dense' },
    disclosures: ['Hover properties and carousel switching cannot be inferred from a resting DOM capture. Declared data attributes are retained separately from measured interactions.', 'Hidden original carousel items are retained; cloned slides and private field values are excluded.'],
  };
}
