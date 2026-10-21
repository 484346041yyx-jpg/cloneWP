import { readFile, writeFile } from 'node:fs/promises';
import * as css from 'css-tree';
const dir = 'D:/cloneWP/references/hoshiichi-mobile-20261019';
const current = JSON.parse(await readFile(`${dir}/mobile-result-inspect-amendment-adminbar-fix.json`, 'utf8'));
if (!current.ok || current.snapshot.page.pageId !== 16038) throw Error('wrong_current_page');
const before = current.snapshot;
const all = new Map();
const visit = nodes => nodes.forEach(n => { all.set(n.id, n); visit(n.elements || []); });
visit(before.page.elements);
const rows = ['534f96f', 'aaab0b0', '4e04d25', '45075cc'].map(id => {
  const row = all.get(id), [icon, text] = row.elements;
  if (!icon.elements?.some(n => n.widgetType === 'wd_image_or_svg') || !text.elements?.some(n => n.widgetType === 'heading')) throw Error('role_identity');
  return { rowId: id, row: row.settings.css_classes, iconId: icon.id, icon: icon.settings.css_classes, textId: text.id, text: text.settings.css_classes };
});
const decision = {
  version: 1, kind: 'current-user-mobile-repair-decisions', pageId: 16038, mobileMaxWidth: 768,
  authorization: 'Current user requests phone icon/text layout, two simultaneous products, and a fixed whole mobile header; preserve desktop and unrelated pages.',
  layouts: rows.map(r => ({ ...r, direction: 'row', wrap: 'nowrap', iconSize: 55, imageSize: 25, gap: 20, padding: 10, textFlex: '1 1 0', nativeFields: ['flex_wrap_mobile', 'border_radius_mobile'], stableRoleClasses: true })),
  carousel: { componentId: '729b018', nativeField: 'slides_per_view_mobile', expected: [{ width: 390, count: 2 }, { width: 430, count: 2 }], reference: 'User screenshots and actual HOSHIICHI phone carousel observations; user explicitly requires 2.', desktopValuePreserved: all.get('729b018').settings.slides_per_view },
  header: { id: 'header_4112946416031808', policy: 'fixed', authority: 'explicit-current-user-request', wholeHeader: true, menuAndLogoTogether: true, offsets: { visitor: 0, adminBar: 46, editor: 0 }, zIndex: 350 },
  acceptance: ['editor-and-front-icon-text-layout', 'two-actual-visible-products-at-both-phone-widths', 'header-top-down-up-and-open-menu', 'desktop-1440-and-1920-regression', 'protected-remote-readback'],
};
const ast = css.parse(before.page.settings.custom_css);
// Keep the historical desktop bytes' semantics. On phones the same roles are
// addressed explicitly; editor overlays must not change sibling membership.
ast.children.forEach((node, item, list) => {
  if (node.type !== 'Rule') return;
  const selector = css.generate(node.prelude);
  if (!selector.includes('.cwp-n44-5b8a8b56dada') || !/:(first|last)-child/.test(selector)) return;
  const wrap = css.parse('@media(min-width:769px){}').children.first;
  wrap.block.children.appendData(node);
  list.replace(item, list.createItem(wrap));
});
const scope = '.elementor-16038 .cwp-n44-5b8a8b56dada';
const native = [];
const blocks = rows.map(r => {
  native.push({ id: r.rowId, settings: { flex_wrap_mobile: 'nowrap' } });
  native.push({ id: r.iconId, settings: { border_radius_mobile: { unit: '%', top: '50', right: '50', bottom: '50', left: '50', isLinked: true } } });
  return `${scope} .${r.row}>.${r.icon}{flex:0 0 55px;min-width:55px;background:#2b3ecd;border-radius:var(--border-radius);height:55px}
${scope} .${r.row}>.${r.icon} img{width:25px;height:25px;object-fit:contain}
${scope} .${r.row}>.${r.text}{flex:1 1 0;min-width:0;width:auto;text-align:left}`;
}).join('\n');
native.push({ id: '729b018', settings: { slides_per_view_mobile: { unit: 'px', size: 2, sizes: [] } } });
const header = 'body.page-id-16038 .whb-header.whb-header_4112946416031808';
const fixed = `${header}{position:fixed;inset:auto 0 auto;top:0;width:100%;z-index:350;transform:none}
body.admin-bar.page-id-16038 .whb-header.whb-header_4112946416031808{top:46px}
${header} .whb-general-header{position:relative;top:0;left:auto;right:auto;width:100%;transform:none}
body.admin-bar.page-id-16038 .whb-header.whb-header_4112946416031808 .whb-general-header{top:0}
${header} .whb-main-header{transform:none}
body.page-id-16038 .elementor-16038 h2,body.page-id-16038 .elementor-16038 h3{scroll-margin-top:130px}`;
const newCSS = css.generate(ast) + `\n/* Frozen current-user phone decisions; stable roles, native count, whole-header positioning. */\n@media(max-width:768px){\n${blocks}\n${fixed}\n}\n`;
css.parse(newCSS, { onParseError() { throw Error('invalid_css'); } });
const patch = { authorization: 'current-user-mobile-amendment', pageId: 16038, maxWidth: 768, nodes: native, css: newCSS, header: before.header.snapshot.module.header };
await writeFile(`${dir}/planning-fix-decisions.json`, JSON.stringify(decision, null, 2), { flag: 'wx' });
await writeFile(`${dir}/current-before-planning-fix.json`, JSON.stringify(current), { flag: 'wx' });
await writeFile(`${dir}/mobile-patch-planning-fix.json`, JSON.stringify(patch), { flag: 'wx' });
await writeFile(`${dir}/phone-planning-fix.css`, `@media(max-width:768px){${blocks}\n${fixed}}`, { flag: 'wx' });
console.log(JSON.stringify({ pageId: 16038, nativePatches: native.length, roleRows: rows.length, remoteWrites: 0 }));
