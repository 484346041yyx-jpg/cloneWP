/** Current-run authoring helpers. Source DOM ancestry owns each card's copy,
 * media and href; no previous job or source product snapshot is consulted. */
import { createHash } from 'node:crypto';
export async function buildMarketing(ctx) {
  const blocks = [], bindings = [], adaptations = [];
  const { packets, asset, html } = ctx;
  const base = ctx.baseSettings || {};
  const font = ctx.fontFamily || 'Arial, Helvetica, sans-serif';
  const marginTop = top => ({ margin: { unit: 'px', top: String(Math.max(0, top)), right: '0', bottom: '0', left: '0', isLinked: false } });
  const chain = (p, id) => { const result = []; while (id && p.nodes[id]) { result.push(p.nodes[id]); id = p.nodes[id].parentId; } return result; };
  const inside = (p, id, ancestor) => chain(p, id).some(node => node.id === ancestor);
  const cloned = (p, id) => chain(p, id).some(node => /(?:^|\s)(?:slick-cloned|swiper-slide-duplicate)(?:\s|$)/.test(node.attributes.class || ''));
  const visibleText = (p, id) => Object.values(p.texts).filter(text => p.nodes[text.nodeId].visible && inside(p, text.nodeId, id) && !cloned(p, text.nodeId));
  const images = (p, id) => [...new Map(Object.values(p.usages).filter(usage => usage.visible && ['img', 'picture'].includes(usage.kind) && inside(p, usage.nodeId, id) && !cloned(p, usage.nodeId)).map(usage => [usage.nodeId, usage])).values()];
  const href = (p, id) => { const anchor = chain(p, id).find(node => node.tag === 'a' && node.attributes.href); return anchor ? { nodeId: anchor.id, url: anchor.attributes.href } : null; };
  const rootId = p => p.regions[0].nodeId;
  const make = (key, regionId) => {
    const p = packets[regionId], slots = { text: {}, media: {}, links: {} }, slotNodes = { text: {}, media: {}, links: {} }; let serial = 0;
    const t = (text, tag = 'span', className = '') => { const key = `t${++serial}`; slots.text[key] = text.text; slotNodes.text[key] = [text.nodeId]; return `<${tag}${className ? ` class="${className}"` : ''} data-cwp-text="${key}"></${tag}>`; };
    const l = (link, content, className = '') => { if (!link) return content; const key = `l${++serial}`; slots.links[key] = { url: link.url, isExternal: false }; slotNodes.links[key] = [link.nodeId]; return `<a${className ? ` class="${className}"` : ''} data-cwp-link="${key}">${content}</a>`; };
    const m = async (usage, className = '', background = false) => { const resource = p.resources[usage.resourceId], key = `m${++serial}`, node = p.nodes[usage.nodeId], assetKey = await asset(resource.url, node.attributes.alt || ''); slots.media[key] = { assetKey, alt: node.attributes.alt || '' }; slotNodes.media[key] = [usage.nodeId]; return background ? `data-cwp-background="${key}"` : `<img${className ? ` class="${className}"` : ''} data-cwp-media="${key}" loading="lazy">`; };
    const finish = async (template, css, sourceNodeIds = [rootId(p)], settings = {}) => {
      const block = await html(key, regionId, template, css, slots, { ...base, ...settings });
      bindings.push({ componentKey: key, regionIds: [regionId], sourceNodeIds, slotNodes }); return block;
    };
    return { p, slots, slotNodes, t, l, m, finish };
  };
  const repeatedCards = p => {
    const media = images(p, rootId(p)), candidates = [];
    for (const usage of media) {
      const owner = chain(p, usage.nodeId).find(node => node.parentId && visibleText(p, node.id).length && p.nodes[node.parentId].childIds.filter(child => images(p, child).length && visibleText(p, child).length).length >= 2);
      if (owner && !candidates.includes(owner.id)) candidates.push(owner.id);
    }
    return candidates;
  };

  if (packets.bogo) {
    const b = make('bogo', 'bogo'), p = b.p, title = visibleText(p, rootId(p)).find(text => chain(p, text.nodeId).some(node => /^h[1-6]$/.test(node.tag)));
    // Direct text can belong to an anchor inside the semantic heading.
    const headingText = b.t;
    b.t = (text, tag = 'span', className = '') => tag === 'h2' && text === title ? b.l(href(p, text.nodeId), headingText(text, tag, className), 'bogo-title-link') : headingText(text, tag, className);
    const media = images(p, rootId(p));
    if (media.length !== 6) throw new Error(`Current BOGO expected six static image uses, got ${media.length}`);
    const backgrounds = Object.values(p.usages).filter(usage => usage.kind === 'background' && usage.visible), bg = backgrounds[0];
    let groups = '';
    for (let index = 0; index < 2; index++) {
      const groupMedia = media.slice(index * 3, index * 3 + 3), headingImage = await b.m(groupMedia[0], 'pet-strip'); let tiles = '';
      for (const usage of groupMedia.slice(1)) tiles += b.l(href(p, usage.nodeId), await b.m(usage, 'deal-image'), 'deal');
      groups += `<div class="pet-group">${b.l(href(p, groupMedia[0].nodeId), headingImage)}<div class="deal-grid">${tiles}</div></div>`;
    }
    const bgAttr = bg ? await b.m(bg, '', true) : '';
    blocks.push(await b.finish(`<section class="bogo-shell"><div class="bogo-frame" ${bgAttr}>${title ? b.t(title, 'h2') : ''}<div class="pet-groups">${groups}</div></div></section>`, `:scope{font-family:${font};width:100%;}.bogo-shell{width:100%;}.bogo-frame{max-width:1440px;margin:auto;background-color:#fadac1;background-position:center top;background-size:100% auto;background-repeat:no-repeat;padding:26px 0 16px;box-sizing:border-box;}h2{margin:0 0 10px;text-align:center;color:#a92c1b;font-size:48px;line-height:60px;font-weight:600;letter-spacing:.8px;}.pet-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));}.pet-group{text-align:center;}.pet-strip{display:block;width:180px;height:auto;margin:0 auto;}.deal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));}.deal{display:flex;justify-content:center;align-items:flex-start;}.deal-image{display:block;width:80%;max-width:288px;height:auto;}a{color:inherit;text-decoration:none;}`, [rootId(p)], marginTop(32)));
    if (backgrounds.length > 1) adaptations.push({ componentKey: 'bogo', rule: 'The same leaf artwork is painted once over the complete native HTML promotion frame; duplicate nested CSS paints are combined, retaining the complete background and six independent image uses.', sourceNodeIds: backgrounds.map(usage => usage.nodeId) });
  }

  for (const regionId of ['brands', 'dog-deals', 'cat-deals', 'other-deals']) {
    if (!packets[regionId]) continue;
    const p = packets[regionId], carousel = Object.values(p.interactions).find(interaction => interaction.kind === 'carousel');
    if (!carousel?.itemNodeIds?.length) throw new Error(`Current ${regionId} has no evidenced native carousel items`);
    const title = visibleText(p, rootId(p)).find(text => /^h[1-6]$/.test(p.nodes[text.nodeId].tag) && !inside(p, text.nodeId, carousel.trackNodeId));
    const head = make(`${regionId}-heading`, regionId);
    const shopAll = visibleText(p, rootId(p)).find(text => text.text === 'Shop All' && !inside(p, text.nodeId, carousel.trackNodeId));
    const heading = await head.finish(`<div class="marketing-heading">${title ? head.t(title, 'h2') : ''}${shopAll ? head.l(href(p, shopAll.nodeId), head.t(shopAll), 'heading-shop-all') : ''}</div>`, `:scope{font-family:${font};}.marketing-heading{position:relative;max-width:1390px;margin:auto;padding:14px 0 8px;box-sizing:border-box;}h2{margin:0;font-size:33px;line-height:48px;font-weight:700;color:#6e6259;text-align:center;letter-spacing:.8px;}.heading-shop-all{position:absolute;right:210px;top:27px;color:#0047d2;font-size:18px;line-height:22px;text-decoration:none;}`);
    const slides = [];
    for (const [index, nodeId] of carousel.itemNodeIds.entries()) {
      const s = make(`${regionId}-item-${index + 1}`, regionId), media = images(p, nodeId), text = visibleText(p, nodeId);
      if (media.length !== 1) throw new Error(`${regionId} item ${nodeId} must have exactly one evidenced image, got ${media.length}`);
      const image = await s.m(media[0], 'marketing-image'), link = href(p, media[0].nodeId), body = text.map((line, i) => s.t(line, 'p', i === 0 && text.length > 1 ? 'offer' : 'caption')).join('');
      const content = s.l(link, `<div class="marketing-card">${image}<div class="marketing-copy">${body}</div></div>`);
      slides.push(await s.finish(content, `:scope{font-family:${font};width:100%;}a{display:block;color:#3d3935;text-decoration:none;}.marketing-card{width:100%;box-sizing:border-box;text-align:center;padding:0 15px 3px;}.marketing-image{display:block;width:202px;max-width:100%;height:202px;object-fit:contain;margin:0 auto;}.marketing-copy{padding-top:5px;}p{margin:0;font-size:16px;line-height:21px;font-weight:400;overflow-wrap:normal;letter-spacing:.8px;}.offer{font-weight:700;}.caption{font-size:16px;}`, [nodeId]));
    }
    if(regionId==='cat-deals'){slides[6].css+='.marketing-copy{margin-inline:-10px;}';adaptations.push({componentKey:slides[6].key,rule:'Compensate the declared Arial font substitution for this long owned caption by using 20px more of its existing 232px card slot. Retain every word, the 16px type and the original 294px natural card height without clipping or crossing its item boundary.'});}
    const key = `${regionId}-carousel`, widgetSettings = { slides_to_show: '6', slides_to_scroll: '1', arrows: 'yes', pagination: 'fraction', fraction_position:'inside', fraction_custom_position:'yes', fraction_horizontal_position:'end', fraction_vertical_position:'start', fraction_vertical_offset:{unit:'px',size:-50,sizes:[]}, fraction_horizontal_offset:{unit:'px',size:56,sizes:[]}, autoplay: 'no', infinite: 'yes', ...(typeof ctx.carouselSettings === 'function' ? ctx.carouselSettings(6, 'fraction') : ctx.carouselSettings || {}) };
    const native = { key, kind: 'native-carousel', widgetType: 'nested-carousel', widgetSettings, settings: { ...base, custom_css: 'selector {max-width:1390px;margin-left:auto;margin-right:auto;} selector .swiper-pagination-fraction {top:-50px;bottom:auto;left:auto;right:56px;width:80px;transform:none;margin:0;position:absolute;color:#706963;font-size:16px;line-height:40px;} selector .elementor-swiper-button {top:-50px;transform:none;height:40px;color:#706963;} selector .elementor-swiper-button-prev {left:auto;right:136px;} selector .elementor-swiper-button-next {left:auto;right:0;} selector .swiper {overflow:hidden;}' }, slides };
    const counterTexts = visibleText(p, rootId(p)).filter(text => chain(p, text.nodeId).some(node => /(?:^|\s)slick-counter(?:\s|$)/.test(node.attributes.class || '')));
    bindings.push({ componentKey: key, regionIds: [regionId], sourceNodeIds: [carousel.nodeId], slotNodes: { text: {}, media: {}, links: {} } });
    blocks.push({ key: regionId, kind: 'composite', settings: { ...base, ...marginTop(p.regions[0].gapBefore), custom_css: 'selector {max-width:1440px;margin-left:auto;margin-right:auto;}' }, children: [heading, native] });
    bindings.push({ componentKey: regionId, regionIds: [regionId], sourceNodeIds: [rootId(p)], slotNodes: { text: {}, media: {}, links: {} } });
    adaptations.push({ componentKey: key, rule: 'Use the registered native carousel with manual arrows and a synchronized native fraction; autoplay is off. Keep each original non-clone card as one native slide.', sourceNodeIds: [carousel.nodeId] });
    if (counterTexts.length) adaptations.push({ componentKey: key, rule: 'The source current/divider/total counter text is owned by this carousel and is generated by the native synchronized pagination. Do not copy these changing numbers as static headings.', sourceNodeIds: counterTexts.map(text => text.nodeId) });
  }

  for (const regionId of ['shop-way', 'services']) {
    if (!packets[regionId]) continue;
    const b = make(regionId, regionId), p = b.p, owners = repeatedCards(p);
    if (owners.length !== 4) throw new Error(`${regionId} expected four observed card owners, got ${owners.length}`);
    const title = visibleText(p, rootId(p)).find(text => /^h[1-6]$/.test(p.nodes[text.nodeId].tag) && !owners.some(owner => inside(p, text.nodeId, owner)));
    let content = '';
    for (const ownerId of owners) {
      const media = images(p, ownerId), text = visibleText(p, ownerId); if (media.length !== 1) throw new Error(`${regionId} card ${ownerId} has ambiguous image ownership`);
      const img = await b.m(media[0], 'service-image'), copy = text.map((line, i) => b.t(line, i === 0 ? 'h3' : 'p', chain(p, line.nodeId).some(node => /(?:^|\s)pd-text--hide-mobile(?:\s|$)/.test(node.attributes.class || '')) ? 'desktop-copy' : '')).join(''), link = href(p, media[0].nodeId);
      const mobileText = regionId === 'shop-way' ? Object.values(p.texts).filter(line => !p.nodes[line.nodeId].visible && inside(p, line.nodeId, ownerId) && chain(p, line.nodeId).some(node => /(?:^|\s)pd-text--hide-desktop(?:\s|$)/.test(node.attributes.class || ''))) : [];
      const mobileCopy = mobileText.map(line => b.t(line, 'p', 'mobile-copy')).join('');
      content += `<article class="service-card">${b.l(link, `${img}<div class="service-copy">${copy}${mobileCopy}</div>`)}</article>`;
    }
    const service = regionId === 'services';
    blocks.push(await b.finish(`<section class="services-frame ${service ? 'photographic' : 'shop-icons'}">${title ? b.t(title, 'h2') : ''}<div class="service-grid">${content}</div></section>`, `:scope{font-family:${font};width:100%;}.services-frame{max-width:1440px;margin:auto;padding:${service ? '10px 0 16px' : '0 40px'};box-sizing:border-box;}.shop-icons{background:#eae8e7;}h2{margin:0 0 ${service ? '30px' : '20px'};text-align:center;color:#706963;font-size:33px;line-height:${service ? '35px' : '40px'};font-weight:600;}.service-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${service ? '58px' : '16px'};align-items:start;padding:${service ? '0 71px' : '0'};}.service-card{text-align:center;}a{color:#52350d;text-decoration:none;}.service-image{display:block;margin:0 auto;width:${service ? '280px' : '164px'};height:${service ? '170px' : '123px'};max-width:100%;object-fit:${service ? 'cover' : 'contain'};${service ? 'border-radius:0 0 16px 16px;' : ''}}.service-copy{padding-top:${service ? '14px' : '2px'};}h3{font-size:${service ? '18px' : '16px'};line-height:${service ? '27px' : '24px'};font-weight:${service ? '500' : '700'};margin:0;letter-spacing:.8px;}p{font-size:16px;line-height:18px;margin:2px 0 0;}`, owners, marginTop(p.regions[0].gapBefore)));
    if (!service) blocks.at(-1).css += '.mobile-copy{display:none}.desktop-copy{display:block}.shop-icons h2{margin-bottom:0;color:#41748d;font-size:48px;line-height:60px}.shop-icons .service-card:nth-child(2) .service-image,.shop-icons .service-card:nth-child(3) .service-image{width:156px;height:117px}.shop-icons .service-copy p{margin:0}';
  }

  if (packets.footer) {
    const b = make('footer', 'footer'), p = b.p, root = rootId(p), text = visibleText(p, root), media = images(p, root);
    const signImage = media.find(usage => /weSpeakPet|we-speak/i.test(p.nodes[usage.nodeId].attributes.class || '') || /WeSpeakPet/i.test(p.resources[usage.resourceId].url));
    const logo = media.find(usage => /footer-logo/.test(p.nodes[usage.nodeId].attributes.class || ''));
    const signContainer = Object.values(p.nodes).find(node => /(?:^|\s)ps-footer-sign-up(?:\s|$)/.test(node.attributes.class || ''));
    const signTexts = signContainer ? visibleText(p, signContainer.id) : [];
    const signMarkup = `${signImage ? await b.m(signImage, 'signup-picture') : ''}${signTexts.map((line, index) => { const tag = index === 0 ? 'h2' : 'p', body = b.t(line, tag); return b.l(href(p, line.nodeId), body, index === signTexts.length - 1 ? 'signup-button' : ''); }).join('')}`;
    const columns = Object.values(p.nodes).filter(node => (node.attributes.class || '').split(/\s+/).includes('content-asset') && visibleText(p, node.id).some(item => /^h[1-6]$/.test(p.nodes[item.nodeId].tag)) && p.nodes[node.id].visible);
    let nav = '';
    for (const column of columns) { const lines = visibleText(p, column.id); nav += `<div class="footer-column">${lines.map(line => /^h[1-6]$/.test(p.nodes[line.nodeId].tag) ? b.t(line, 'h3') : `<div>${b.l(href(p, line.nodeId), b.t(line))}</div>`).join('')}</div>`; }
    const socialImages = media.filter(usage => ![signImage?.nodeId, logo?.nodeId].includes(usage.nodeId));
    let social = ''; for (const usage of socialImages) social += b.l(href(p, usage.nodeId), await b.m(usage, 'social-icon'));
    const legalContainer = Object.values(p.nodes).find(node => node.tag === 'ul' && visibleText(p, node.id).some(line => /Conditions of Use/.test(line.text)));
    const legalTexts = legalContainer ? visibleText(p, legalContainer.id) : [], copyright = text.find(line => /©\s*\d{4}/.test(line.text));
    const legal = legalTexts.map(line => b.l(href(p, line.nodeId), b.t(line))).join('');
    const accountText = Object.values(p.texts).find(line => line.text === 'Create an account' && p.nodes[line.nodeId].attributes.href === 'https://www.petsupermarket.com/login/');
    const accountEntry = accountText ? `<div class="source-account-entry">${b.l(href(p, accountText.nodeId), b.t(accountText))}</div>` : '';
    const topNode = Object.values(p.nodes).find(node => node.tag === 'button' && /(?:^|\s)back-to-top(?:\s|$)/.test(node.attributes.class || ''));
    const topSvg = topNode ? Object.values(p.nodes).find(node => node.tag === 'svg' && inside(p, node.id, topNode.id)) : null;
    const headerScope = `cwp-${createHash('sha256').update(`clonewp-replica-v2:${ctx.taskId || 'pet-supermarket-v2-20261015'}:header-content`).digest('hex').slice(0, 7)}`;
    const backTop = topNode && topSvg ? b.l({ nodeId: topNode.id, url: `#${headerScope}` }, b.t({ text: '↑', nodeId: topSvg.id }, 'span'), 'back-top') : '';
    const markup = `<footer class="replica-footer"><div class="footer-upper"><div class="footer-main"><div class="footer-signup">${signMarkup}</div><nav class="footer-nav">${nav}</nav></div></div><div class="footer-social">${logo ? await b.m(logo, 'footer-logo') : ''}<div class="social-links">${social}</div></div><div class="footer-legal"><div class="legal-inner"><div class="legal-links">${legal}</div>${copyright ? b.t(copyright, 'p') : ''}</div></div>${accountEntry}${backTop}</footer>`;
    blocks.push(await b.finish(markup, `:scope{font-family:${font};width:100%;}.replica-footer{position:relative;color:#302d27;width:100%;}.footer-upper{background:#f0f5f8;}.footer-main{max-width:1440px;margin:auto;box-sizing:border-box;padding:60px 24px 72px 48px;display:grid;grid-template-columns:432px minmax(0,1fr);gap:48px;}.signup-picture{display:block;width:298px;height:152px;object-fit:contain;margin:0 0 0;}h2{font-size:27px;line-height:33px;margin:0 0 12px;color:#706963;font-weight:700;}.footer-signup p{font-size:14px;line-height:20px;margin:0 0 18px;}.signup-button{display:inline-block;padding:13px 17px;border-radius:8px;background:#ffc600;color:#302d27;font-weight:700;}.signup-button p{margin:0;}.footer-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;padding-top:6px;}h3{font-size:18px;line-height:25px;color:#706963;margin:0 0 10px;font-weight:700;}.footer-column>div{margin:0 0 9px;font-size:14px;line-height:21px;}a{color:inherit;text-decoration:none;}a:hover{text-decoration:underline;}.footer-social{max-width:1440px;margin:auto;min-height:120px;display:flex;justify-content:center;align-items:center;gap:48px;padding:24px;box-sizing:border-box;background:#fff;}.footer-logo{width:188px;height:52px;object-fit:contain;}.social-links{display:flex;align-items:center;gap:18px;}.social-icon{display:block;width:49px;height:48px;object-fit:contain;}.footer-legal{background:#e0eaf0;}.legal-inner{max-width:1440px;box-sizing:border-box;margin:auto;padding:30px 24px;display:flex;align-items:center;justify-content:space-between;gap:24px;font-size:12px;line-height:18px;}.legal-links{display:flex;flex-wrap:wrap;gap:3px;}.legal-inner p{margin:0;}`, [root]));
    const cookie = legalTexts.find(line => /Cookie Preferences/.test(line.text));
    if (cookie) adaptations.push({ componentKey: 'footer', rule: 'The cookie-preferences label preserves its actual source external href; the source consent manager is not loaded into this draft.', sourceNodeIds: [cookie.nodeId] });
    blocks.at(-1).css += '.source-account-entry{display:none}.back-top{position:absolute;right:28px;bottom:104px;width:56px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#b2c8fa;color:#0047d2;font-size:38px;line-height:1;z-index:50;text-decoration:none}';
    const mobileHeadings = Object.values(p.nodes).filter(node => node.tag === 'button' && /ps-footer-headers/.test(node.attributes.class || '') && !node.visible);
    if (mobileHeadings.length) adaptations.push({ componentKey: 'footer', rule: 'The mobile-only duplicate disclosure headings are represented by the same static visible navigation columns; no duplicate mobile button is rendered. Preserve each column heading and all real links.', sourceNodeIds: mobileHeadings.map(node => node.id) });
    if (accountText) adaptations.push({ componentKey: 'footer', rule: 'Stock-notification form copy and success states are not fabricated in the draft. Retain their observed hidden Create an account entry as the real source login link; source business service remains external.', sourceNodeIds: [accountText.nodeId] });
    if (topNode && topSvg) adaptations.push({ componentKey: 'footer', rule: 'The return-to-top control uses an ordinary anchor to the actual header HTML scope; a typed upward arrow replaces the source SVG icon and the fixed control remains operable without custom JavaScript.', sourceNodeIds: [topNode.id, topSvg.id] });
  }
  return { blocks, bindings, adaptations };
}
