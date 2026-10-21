import { parseFragment, serialize } from 'parse5';
import { createHash } from 'node:crypto';
import { mapResponsiveBindings } from './pet-v2-responsive-mapping.mjs';

/** Apply current-job measured variants without writing programs or target state.
 * The target's discovered breakpoints are mobile<=768 and tablet<=1024. */
export function applyPetResponsiveMarketing({ authored, packetsByViewport, breakpoints = { mobile: 768, tablet: 1024 } }) {
  if (breakpoints.mobile !== 768 || breakpoints.tablet !== 1024) throw Error('This current-job authoring helper requires the actually discovered 768/1024 Elementor breakpoints');
  const next = structuredClone(authored), adaptations = [], gaps = [], measurements = [], components = new Map();
  const walk = blocks => { for (const block of blocks) { components.set(block.key, block); walk(block.children || block.slides || []); } }; walk(next.blocks);
  const at = key => components.get(key), binding = key => next.bindings.find(item => item.componentKey === key), tablet = `@media(max-width:${breakpoints.tablet}px)`, mobile = `@media(max-width:${breakpoints.mobile}px)`;
  const scoped = (key, child) => `#cwp-${createHash('sha256').update(`clonewp-replica-v2:${next.taskId}:${key}-content`).digest('hex').slice(0, 7)} ${child}`;
  const ownedElement = key => `[data-id="${createHash('sha256').update(`clonewp-replica-v2:${next.taskId}:${key}`).digest('hex').slice(0, 7)}"]`;
  const append = (key, css) => { const component = at(key); if (component) component.responsiveCss = (component.responsiveCss || '') + css; };
  const rule = (viewport, componentKey, sourceNodeIds, text, target, sourceFactIds = []) => {
    const packet = packetsByViewport[viewport]?.[binding(componentKey)?.regionIds[0]]; if (!packet) return;
    const entry = { snapshotId: packet.snapshot.id, componentKey, sourceNodeIds, ...(sourceFactIds.length ? { sourceFactIds } : {}), rule: text, ...(target ? { target: { componentKey, ...target } } : {}) }; adaptations.push(entry);
  };
  const nodeByClass = (packet, className) => Object.values(packet?.nodes || {}).find(node => (node.attributes?.class || '').split(/\s+/).includes(className));
  const rootId = packet => packet.regions[0].nodeId;
  const layoutFacts = packet => [...new Set([packet.regions[0].nodeId, packet.regions[0].contentNodeId])].map(id => `${packet.snapshot.id}:layout:${packet.nodes[id].layoutId}`);
  const responsiveMappings = packetsByViewport.desktop ? ['narrow', 'tablet', 'mobile'].filter(v => packetsByViewport[v]).map(viewport => mapResponsiveBindings({ desktopPackets: packetsByViewport.desktop, variantPackets: packetsByViewport[viewport], bindings: next.bindings })) : [];
  for (const viewport of ['narrow', 'tablet', 'mobile']) for (const region of ['categories', 'bogo', 'brands', 'dog-deals', 'cat-deals', 'other-deals', 'shop-way', 'services', 'footer']) {
    const p = packetsByViewport[viewport]?.[region]; if (!p) continue; const node = p.nodes[rootId(p)]; measurements.push({ viewport, regionId: region, snapshotId: p.snapshot.id, nodeId: node.id, rect: p.layouts[node.layoutId].rect });
  }
  if (at('category-heading')) {
    Object.assign(at('category-heading').widgetSettings, { typography_font_size_tablet: { unit: 'px', size: 25, sizes: [] }, typography_line_height_tablet: { unit: 'px', size: 15, sizes: [] }, typography_font_size_mobile: { unit: 'px', size: 24, sizes: [] }, typography_line_height_mobile: { unit: 'px', size: 25, sizes: [] }, align_mobile: 'center' });
    at('category-heading').settings ??= {}; at('category-heading').settings.custom_css = (at('category-heading').settings.custom_css || '') + ` ${tablet}{selector .elementor-heading-title{font-weight:600;color:#6e6259;}}${mobile}{selector{padding-left:24px;padding-right:24px;}selector .elementor-heading-title{letter-spacing:.8px;}}`;
  }
  append('category-tiles', `${tablet}{.pets{height:200px;padding:40px 100px 50px;gap:26px;}.pets img{width:74px;height:74px}.pets a{gap:0}.pets h3{font-size:13px;line-height:16px;font-weight:500;letter-spacing:.8px;padding:20px 0 0;color:#3d3935}}${mobile}{.pets{display:flex;height:132px;padding:14px 14px 18px;gap:0;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:none}.pets a{flex:0 0 88px;gap:0}.pets h3{padding-top:10px}.pets::-webkit-scrollbar{display:none}}`);
  append('bogo', `${tablet}{.bogo-frame{padding:0 0 10px;background-size:100% auto;background-repeat:no-repeat}h2{font-size:32px;line-height:41.6px;margin-bottom:4px}.pet-strip{width:50%;max-width:none}.deal-grid .deal:first-child{justify-content:flex-start}.deal-image{max-width:none}}${mobile}{.bogo-frame{overflow:hidden;padding-bottom:12px}h2{font-size:28px;line-height:32px;margin-bottom:10px}.pet-groups{grid-template-columns:minmax(0,1fr);row-gap:8px}.pet-group{width:calc(100% + 56px);margin-left:-24px}.pet-strip{width:50%}.deal-grid .deal:first-child{justify-content:center}.deal-image{width:80%}}`);
  for (const region of ['brands', 'dog-deals', 'cat-deals', 'other-deals']) {
    // This registered Swiper engine starts its tablet configuration at 768
    // (min-inclusive). Its generated CSS mobile query includes 768 instead.
    // Keep these marketing cards on the engine's actual tablet side there.
    const carouselMobile = `@media(max-width:${breakpoints.mobile - 1}px)`;
    const compactControls = region === 'other-deals', brands = region === 'brands';
    const reserve = compactControls ? 40 : brands ? 67.422 : 88, mobileReserve = brands ? 64.875 : reserve;
    const controlBottom = compactControls ? 0 : brands ? 23.422 : 44, mobileControlBottom = brands ? 20.875 : controlBottom;
    append(`${region}-heading`, `${tablet}{.marketing-heading{position:static;padding:0 10px 8px}h2{font-size:33px;line-height:48px}.heading-shop-all{position:absolute;top:auto;bottom:${compactControls ? 9 : 4}px;left:50%;right:auto;transform:translateX(-50%);display:block;text-align:center;font-size:14px;line-height:22px;margin:0;white-space:nowrap;z-index:3}}${carouselMobile}{h2{font-size:24px;line-height:32px}.marketing-heading{padding-bottom:8px}}`);
    const section = at(region);
    if (section) {
      section.settings ??= {};
      // Both components compile through their own e-con before the actual widget.
      // The heading's e-con must not contain its bottom link; that link belongs
      // to the complete section. Keep this exact owned wrapper static only.
      section.settings.custom_css = (section.settings.custom_css || '') + ` ${tablet}{selector{position:relative}selector>${ownedElement(`${region}-heading`)}{position:static}selector .elementor-widget-html,selector .elementor-widget-container{position:static}}`;
    }
    const carousel = at(`${region}-carousel`);
    if (carousel) {
      Object.assign(carousel.widgetSettings, { slides_to_show_tablet: '6', slides_to_scroll_tablet: '1', slides_to_show_mobile: '2', slides_to_scroll_mobile: '1' });
      // The native widget is inside the padded component e-con. Elementor
      // positions that widget by default, so it must also be static for the
      // controls to use the complete padded component as their containing box.
      carousel.settings.custom_css = (carousel.settings.custom_css || '') + ` ${tablet}{selector{position:relative;max-width:none;width:calc(100% - 20px);margin-left:10px;margin-right:10px;padding-bottom:${reserve}px}selector>${ownedElement(`${region}-carousel-carousel`)}{position:static}selector .swiper,selector .elementor-swiper{position:static}selector .swiper-pagination-fraction{top:auto;bottom:${controlBottom}px;left:${compactControls ? 'auto' : 'calc(50% - 40px)'};right:${compactControls ? '40px' : 'auto'};width:${compactControls ? 70 : 80}px;line-height:${compactControls ? 40 : 44}px;color:#0047d2}selector .elementor-swiper-button{top:auto;bottom:${controlBottom}px;height:${compactControls ? 40 : 44}px;width:${compactControls ? 40 : 56}px;color:#0047d2}selector .elementor-swiper-button-prev{left:${compactControls ? '0' : 'calc(50% - 100px)'};right:auto}selector .elementor-swiper-button-next{left:${compactControls ? 'auto' : 'calc(50% + 44px)'};right:${compactControls ? '0' : 'auto'}}}${carouselMobile}{selector{padding-bottom:${mobileReserve}px}selector .swiper-pagination-fraction,selector .elementor-swiper-button{bottom:${mobileControlBottom}px}}@media(min-width:768px) and (max-width:768px){selector>${ownedElement(`${region}-carousel-carousel`)}{--e-n-carousel-swiper-slides-to-display:6}}`;
      for (const slide of carousel.slides) slide.responsiveCss = (slide.responsiveCss || '') + `${tablet}{a{color:#52350d}.marketing-card{padding:0 0 3px}.marketing-image{width:120px;height:120px;margin:0}.marketing-copy{max-width:130px;padding-top:5px}p,.caption{font-size:13px;line-height:16px;letter-spacing:.8px;font-weight:450}.offer{font-weight:700}}${carouselMobile}{.marketing-card{padding:5px 0 .921875px}.marketing-image{width:140px;height:140px}.marketing-copy{width:130px;max-width:130px;padding:0 24px;margin-top:3.6875px}p,.caption{font-size:13.5px;line-height:15px}}`;
    }
    if (!brands) for (const viewport of ['tablet', 'mobile']) {
      const packet = packetsByViewport[viewport]?.[region], heading = at(`${region}-heading`);
      if (!packet || !heading) continue;
      const shopAll = Object.values(packet.texts).filter(text => text.text === 'Shop All'), targetText = Object.entries(heading.slots.text).filter(([, text]) => text === 'Shop All'), targetLinks = Object.entries(heading.slots.links);
      const hrefFor = nodeId => { while (nodeId) { const node = packet.nodes[nodeId]; if (node?.tag === 'a' && node.attributes.href) return node.attributes.href; nodeId = node?.parentId; } };
      const hrefs = [...new Set(shopAll.map(text => hrefFor(text.nodeId)).filter(Boolean))];
      if (shopAll.length !== 2 || hrefs.length !== 1 || targetText.length !== 1 || targetLinks.filter(([, link]) => link.url === hrefs[0]).length !== 1) { gaps.push({ componentKey: heading.key, snapshotId: packet.snapshot.id, code: 'responsive-shop-all-owner-unproven', message: 'The mutually exclusive source top/bottom links require two actual text owners, one identical destination and one existing typed target anchor' }); continue; }
      const textSlot = targetText[0][0], linkSlot = targetLinks.find(([, link]) => link.url === hrefs[0])[0];
      rule(viewport, heading.key, [], 'Adapt the two actual mutually exclusive source top/bottom Shop All implementations to the one existing typed anchor at the bottom of this same marketing section. Preserve exact copy and its actual external destination; desktop keeps its original top placement. Verify the one visible current-viewport anchor, not an invisible duplicate.', { kind: 'text', slot: textSlot, expected: { text: 'Shop All', visible: true } }, shopAll.map(text => `${packet.snapshot.id}:text:${text.id}`));
      const linkNodes = new Set(shopAll.flatMap(text => { const ids = []; let nodeId = text.nodeId; while (nodeId) { const node = packet.nodes[nodeId]; if (node?.tag === 'a') { ids.push(nodeId); break; } nodeId = node?.parentId; } return ids; }));
      const interactions = Object.values(packet.interactions).filter(interaction => linkNodes.has(interaction.nodeId) && interaction.href === hrefs[0]);
      if (interactions.length) rule(viewport, heading.key, [], 'Preserve both observed implementations of the same source Shop All destination through the single visible same-section typed bottom anchor; this is an external entry, not a recreated target catalog service.', { kind: 'external', slot: linkSlot, expected: hrefs[0] }, interactions.map(interaction => `${packet.snapshot.id}:interaction:${interaction.id}`));
      if (compactControls) rule(viewport, `${region}-carousel`, [], 'The source specialty-pet carousel hides its controller strip. Retain the required working manual native arrows and synchronized fraction in one compact 40px footer row shared with the centered same-section Shop All entry. Arrow/fraction controls stay on the sides, outside all card content.', { kind: 'interaction', selector: `[data-id="${createHash('sha256').update(`clonewp-replica-v2:${next.taskId}:${region}-carousel`).digest('hex').slice(0, 7)}"]`, property: 'carousel', expected: { manual: true } }, Object.values(packet.interactions).filter(interaction => interaction.kind === 'carousel').map(interaction => `${packet.snapshot.id}:interaction:${interaction.id}`));
    }
  }
  append('recently-viewed', `${tablet}{.empty-personalization{height:48px}}`);
  append('shop-way', `${tablet}{.services-frame{padding:17.688px 24px 6px}.shop-icons h2{font-size:32px;line-height:41.6px}.shop-icons a{color:#3d3935}.service-grid{gap:16px}.service-image{width:calc(50% + 0px);height:auto}.shop-icons .service-card:nth-child(2) .service-image,.shop-icons .service-card:nth-child(3) .service-image{width:calc(50% - 8px);height:auto}.mobile-copy{display:block;font-size:14px;line-height:15px}.desktop-copy{display:none}h3{font-size:16px;line-height:24px}p{line-height:24px}}${mobile}{.services-frame{padding:11.5px 24px 0}.shop-icons h2{font-size:28px;line-height:32px;margin-bottom:0}.service-grid{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px;row-gap:11px}.service-copy{max-width:100px;margin:auto}.service-image{width:50%;height:auto}.shop-icons .service-card:nth-child(2) .service-image,.shop-icons .service-card:nth-child(3) .service-image{width:calc(50% - 8px);height:auto}}`);
  const services = at('services'), serviceBinding = binding('services');
  append('services', `${tablet}{.services-frame{padding:10px 0 24px}h2{font-size:25px;line-height:29px;margin:0 0 10px;color:#6e6259}.service-grid{display:flex;gap:8px;padding:0 12px;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:none}.service-card{flex:0 0 268px}.service-image{width:268px;height:162px}.service-copy{padding-top:12px}h3{font-size:14px;line-height:21px}.service-grid::-webkit-scrollbar{display:none}}${mobile}{h2{font-size:23px;line-height:29px;margin-left:24px;margin-right:24px}.service-card{flex-basis:248px}.service-image{width:248px;height:150px}}`);
  if (services && serviceBinding) {
    const titleSlot = /<h2[^>]*data-cwp-text="([^"]+)"/.exec(services.template)?.[1];
    for (const viewport of ['tablet', 'mobile']) {
      const packet = packetsByViewport[viewport]?.services; if (!packet || !titleSlot) continue;
      const identity = responsiveMappings.flatMap(result => result.mappings).find(mapping => mapping.componentKey === 'services' && mapping.snapshotId === packet.snapshot.id), mapped = identity?.slotNodes.text?.[titleSlot]?.[0];
      let owner = packet.nodes[mapped]; while (owner && !(owner.attributes.class || '').split(/\s+/).includes('pd-text-wrap')) owner = packet.nodes[owner.parentId];
      if (!owner) { gaps.push({ componentKey: 'services', snapshotId: packet.snapshot.id, code: 'responsive-heading-owner-unproven', message: 'The alternative source heading needs its exact mapped common text owner before sharing the existing typed slot' }); continue; }
      const inside = id => { while (id) { if (id === owner.id) return true; id = packet.nodes[id]?.parentId; } return false; };
      const headings = Object.values(packet.texts).filter(text => /^h[1-6]$/.test(packet.nodes[text.nodeId].tag) && inside(text.nodeId));
      if (!headings.length || headings.some(text => text.text !== services.slots.text[titleSlot])) { gaps.push({ componentKey: 'services', snapshotId: packet.snapshot.id, code: 'responsive-heading-copy-variant-required', message: 'The same source heading owner contains genuinely changed copy, requiring an explicit new typed slot' }); continue; }
      rule(viewport, 'services', headings.map(text => text.nodeId), 'The mutually exclusive source desktop/mobile headings share one actual semantic heading and unchanged text slot; keep one visible title, not duplicated headings.', { kind: 'text', slot: titleSlot, expected: { text: services.slots.text[titleSlot], visible: true } });
      rule(viewport, 'services', [], 'Preserve the four source service cards in a native horizontal overflow row. Browser scrolling replaces the source touch scrolling implementation, retaining each actual image and external link.', { kind: 'interaction', selector: scoped('services', '.service-grid'), property: 'scroll', expected: { axis: 'x', minOverflow: 1 } }, [`${packet.snapshot.id}:region:${packet.regions[0].id}`]);
    }
  }
  const footer = at('footer');
  if (footer) {
    const fragment = parseFragment(footer.template), nodes = []; const visit = node => { nodes.push(node); (node.childNodes || []).forEach(visit); }; visit(fragment);
    for (const column of nodes.filter(node => node.attrs?.some(attr => attr.name === 'class' && attr.value.split(/\s+/).includes('footer-column')))) {
      const heading = column.childNodes.find(node => node.tagName === 'h3'); if (!heading) { gaps.push({ componentKey: 'footer', code: 'footer-column-heading-unproven', message: 'Every native details column must retain its actual existing typed heading' }); continue; }
      column.tagName = column.nodeName = 'details'; heading.tagName = heading.nodeName = 'summary';
      const children = column.childNodes.filter(node => node !== heading), body = { nodeName: 'div', tagName: 'div', namespaceURI: 'http://www.w3.org/1999/xhtml', attrs: [{ name: 'class', value: 'footer-column-links' }], childNodes: children, parentNode: column }; children.forEach(child => { child.parentNode = body; }); column.childNodes = [heading, body];
    }
    footer.template = serialize(fragment);
    footer.css += `.footer-column>summary{font-size:18px;line-height:25px;color:#706963;margin:0 0 10px;font-weight:700;list-style:none}.footer-column>summary::-webkit-details-marker{display:none}.footer-column>.footer-column-links{margin:0}.footer-column-links>div{margin:0 0 9px;font-size:14px;line-height:21px}@media(min-width:1025px){.footer-column::details-content{content-visibility:visible}.footer-column-links{display:block}.footer-column>summary{pointer-events:none}}`;
    footer.responsiveCss = (footer.responsiveCss || '') + `${tablet}{.footer-main{display:block;padding:60px 40px 42px}.footer-signup h2{font-size:28px;line-height:33.6px}.footer-signup p{line-height:21px}.footer-nav{display:block;margin-top:48px;padding:0}.footer-column{margin:0 0 18px}.footer-column>summary{display:list-item;list-style:disclosure-closed inside;font-size:18px;line-height:40px;min-height:40px;margin:0;cursor:pointer}.footer-column[open]>summary{list-style-type:disclosure-open}.footer-column-links{padding:12px 0}.footer-social{flex-direction:column;gap:24px;min-height:184px;padding:24px 16px}.footer-logo{width:152px;height:40px}.social-links{gap:24px}.legal-inner{padding:24px 40px;align-items:flex-start;flex-direction:column;gap:20px}.back-top{width:44px;height:44px;right:16px;bottom:116px;font-size:30px}}${mobile}{.footer-main{padding:40px 8px 42px}.footer-nav{padding:0 8px}.footer-column>summary{font-size:14px;line-height:40px}.social-links{width:100%;justify-content:space-between;gap:0}.social-icon{width:auto;max-width:50px;height:48px}.legal-inner{padding:24px 8px;font-size:10px;line-height:15px}}`;
    footer.responsiveCss += `${tablet}{.replica-footer{color:#3d3935}.footer-signup h2{font-weight:600;color:#6e6259;letter-spacing:.8px}.footer-signup p{letter-spacing:.8px}.signup-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;border:1px solid #ffc000;border-radius:8px;background:#ffc000;color:#3d3935;font-size:16px;font-weight:550;line-height:24px;letter-spacing:.8px}.signup-button p{font-size:inherit;line-height:inherit;font-weight:inherit;margin:0}.footer-column>summary{font-weight:600;color:#6e6259;letter-spacing:.8px}.legal-links{letter-spacing:.8px}}${mobile}{.legal-inner{font-size:10px;line-height:16px;font-weight:600;letter-spacing:.8px}}`;
    for (const viewport of ['tablet', 'mobile']) {
      const p = packetsByViewport[viewport]?.footer; if (!p) continue;
      const buttons = Object.values(p.nodes).filter(node => node.tag === 'button' && /(?:^|\s)ps-footer-headers(?:\s|$)/.test(node.attributes.class || ''));
      buttons.forEach((node, index) => rule(viewport, 'footer', [node.id], 'The same source column has one actual typed heading and unchanged real links. Native details/summary replaces the source disclosure implementation; tablet/mobile start collapsed and support mouse and keyboard. The native marker adapts the source plus/minus icon.', { kind: 'interaction', selector: scoped('footer', `.footer-column:nth-child(${index + 1})`), property: 'disclosure', expected: { target: ':scope > .footer-column-links', initialOpen: false } }));
    }
  }
  for (const viewport of ['tablet', 'mobile']) for (const key of ['category-tiles', 'bogo', 'shop-way', 'services']) {
    const p = packetsByViewport[viewport]?.[binding(key)?.regionIds[0]]; if (p) rule(viewport, key, [], `Use the actual ${p.snapshot.viewport.width}px source card order, media owners and text variants with natural responsive flow; this adaptation binds only the measured outer/content layout facts, not the owned copy, images or links.`, { kind: 'layout', selector: scoped(key, key === 'category-tiles' ? '.pets' : key === 'bogo' ? '.bogo-frame' : '.services-frame'), expected: { width: p.layouts[p.nodes[rootId(p)].layoutId].rect.width }, tolerance: 16 }, layoutFacts(p));
  }
  if (packetsByViewport.mobile?.categories && binding('category-tiles')) { const p = packetsByViewport.mobile.categories; rule('mobile', 'category-tiles', [], 'Keep all six actual category cards in their source horizontal order and make the source overflow row natively scrollable by pointer and keyboard.', { kind: 'interaction', selector: scoped('category-tiles', '.pets'), property: 'scroll', expected: { axis: 'x', minOverflow: 1 } }, [`${p.snapshot.id}:region:${p.regions[0].id}`]); }
  next.adaptations ??= []; next.adaptations.push(...adaptations);
  return { authored: next, adaptations, gaps, measurements, responsiveMappings };
}

/** Report-only CAS patches for the already authored current-job components.
 * Never rebuilds the component tree, source ownership, slots or requirements. */
export function petMarketing768Patches(document) {
  const components = new Map(), visit = blocks => { for (const component of blocks) { components.set(component.key, component); visit(component.children || component.slides || []); } }; visit(document.blocks);
  const patches = [], hash = text => createHash('sha256').update(text).digest('hex');
  const record = (component, field, before, after, extra = {}) => { if (before !== after) patches.push({ componentKey: component.key, field, beforeSha256: hash(before), afterSha256: hash(after), after, ...extra }); };
  for (const region of ['brands', 'dog-deals', 'cat-deals', 'other-deals']) {
    const heading = components.get(`${region}-heading`), carousel = components.get(`${region}-carousel`);
    if (!heading || !carousel || !Array.isArray(carousel.slides)) throw Error('Missing actual authored marketing component: ' + region);
    for (const component of [heading, ...carousel.slides]) {
      const before = component.responsiveCss;
      if (typeof before !== 'string' || !/@media\(max-width:(?:767|768)px\)/.test(before)) throw Error('Expected owned marketing responsive CSS is missing: ' + component.key);
      record(component, 'responsiveCss', before, before.replaceAll('@media(max-width:768px)', '@media(max-width:767px)'));
    }
    const nativeWidgetKey = `${carousel.key}-carousel`, nativeWidgetId = hash(`clonewp-replica-v2:${document.taskId}:${nativeWidgetKey}`).slice(0, 7), ownerSelector = `selector>[data-id="${nativeWidgetId}"]`, before = carousel.settings?.custom_css;
    if (typeof before !== 'string' || !before.includes(ownerSelector + '{position:static}')) throw Error('The exact owned native widget wrapper proof is missing: ' + carousel.key);
    const boundary = `@media(min-width:768px) and (max-width:768px){${ownerSelector}{--e-n-carousel-swiper-slides-to-display:6}}`;
    const after = before.replaceAll('@media(max-width:768px)', '@media(max-width:767px)') + (before.includes(boundary) ? '' : boundary);
    record(carousel, 'settings.custom_css', before, after, { exactNativeWidget: { componentKey: carousel.key, nativeWidgetKey, nativeWidgetId, idDerivation: 'sha256(clonewp-replica-v2:<taskId>:<nativeWidgetKey>).slice(0,7)', declaration: '--e-n-carousel-swiper-slides-to-display:6' } });
  }
  return { kind: 'owned-native-carousel-768-boundary-patches', taskId: document.taskId, rule: 'The actual native Swiper uses min-inclusive 768 tablet configuration while global Elementor CSS includes768 in mobile. These four marketing components use tablet6 at exactly768, with their exact native widget CSS variable and owned card/footer styles aligned. Other CSS/header and Woodmart boundaries retain their separately observed rules.', patches };
}
