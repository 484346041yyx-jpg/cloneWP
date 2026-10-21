import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { planControlAlignment, type ControlAlignmentInput } from '../src/fidelity/control-alignment.js';

function fixture(): ControlAlignmentInput {
  return {
    coordinateSpace: { kind: 'block-relative', sourceBlockId: 'arbitrary-block' },
    ownerBinding: { sourceOwnerId: 'observed-slider-owner', nativeOwnerKey: 'native-carousel', evidence: ['actual-owner-binding'] },
    source: { status: 'observed', blockId: 'arbitrary-block', groupId: 'source-arrow-group', ownerId: 'observed-slider-owner', viewport: { name: 'desktop', width: 1440 }, rect: { x: 390, y: -20, width: 100, height: 30 }, evidence: ['actual-source-group'] },
    target: { blockId: 'arbitrary-block', sourceGroupId: 'source-arrow-group', nativeOwnerKey: 'native-carousel', viewport: { name: 'desktop', width: 1440 }, relativeSelector: '.arrows', matchedCount: 1, rect: { x: 405, y: -20, width: 100, height: 30 }, evidence: ['actual-target-group'], position: 'absolute', insets: { top: -20, right: 10, bottom: 'auto', left: 'auto' }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, transform: 'none', containingBlock: { nativeOwnerKey: 'native-carousel', relativeSelector: '.track-container', matchedCount: 1, rect: { x: -15, y: 0, width: 530, height: 120 }, box: 'css-positioning-padding-box', cssPixels: 'unscaled-axis-aligned', evidence: ['actual-offset-parent-padding-box'] } },
    viewport: { name: 'desktop', width: 1440, breakpoint: { minWidth: 1025 }, evidence: ['actual-native-breakpoint'] },
  };
}

test('actual containing-block origin explains the translation; widget-root guessing cannot', () => {
  const input = fixture(), before = structuredClone(input), result = planControlAlignment(input);
  assert.deepEqual(input, before); assert.equal(result.afterInsets.right, 25); assert.equal(result.afterInsets.top, -20);
  assert.equal(result.localRule, 'selector .arrows{right:25px;}');
  assert.equal(result.css, '@media(min-width:1025px){selector .arrows{right:25px;}}');
  assert.equal(result.predictedRect.x, 390); assert.equal(result.fidelityPassGranted, false); assert.equal(result.verification, 'requires-browser-remeasurement');
  const guessed = fixture(); guessed.target.containingBlock.rect = { x: 0, y: 0, width: 500, height: 120 };
  assert.throws(() => planControlAlignment(guessed), /origin\/insets do not explain/);
  const aligned = fixture(); aligned.target.insets = result.afterInsets; aligned.target.rect = result.predictedRect;
  assert.equal(planControlAlignment(aligned).status, 'already-aligned'); assert.equal(planControlAlignment(aligned).css, '');
});

test('left/top and right/bottom anchors retain actual computed margins and pure translation transforms', () => {
  const input = fixture(); input.source.rect = { x: 50, y: 70, width: 100, height: 20 }; input.target.rect = { x: 45, y: 65, width: 100, height: 20 };
  input.target.containingBlock.rect = { x: 10, y: 20, width: 200, height: 100 };
  input.target.insets = { left: 25, top: 40, right: 'auto', bottom: 'auto' }; input.target.margins = { left: 5, right: 0, top: 3, bottom: 0 }; input.target.transform = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 2 };
  const first = planControlAlignment(input); assert.equal(first.afterInsets.left, 30); assert.equal(first.afterInsets.top, 45);
  input.target.transform = 'none'; input.target.margins = { left: 0, right: 5, top: 0, bottom: 2 }; input.target.insets = { left: 'auto', top: 'auto', right: 20, bottom: 10 };
  input.target.rect = { x: 85, y: 88, width: 100, height: 20 }; input.source.rect = { x: 95, y: 83, width: 100, height: 20 };
  const second = planControlAlignment(input); assert.equal(second.afterInsets.right, 10); assert.equal(second.afterInsets.bottom, 15);
});

test('tablet range and unobserved breakpoint scope are typed receipts, never broadened media rules', () => {
  const input = fixture(); input.viewport = { name: 'tablet', width: 900, breakpoint: { minWidth: 768, maxWidth: 1024 }, evidence: ['actual-breakpoint'] }; input.source.viewport = input.target.viewport = { name: 'tablet', width: 900 };
  const result = planControlAlignment(input); assert.equal(result.emission, 'requires-existing-breakpoint-context'); assert.equal(result.css, undefined); assert.ok(result.localRule.includes('right:25px'));
  delete input.viewport.breakpoint; assert.equal(planControlAlignment(input).css, undefined);
  input.viewport.breakpoint = { maxWidth: 1024 }; assert.equal(planControlAlignment(input).css, '@media(max-width:1024px){selector .arrows{right:25px;}}');
});

test('resolved opposing CSSOM offsets require actual cascade anchor evidence and never become emitted declarations', () => {
  const input = fixture(); input.target.insets.left = 420; input.target.insets.bottom = 110;
  assert.throws(() => planControlAlignment(input), /ambiguous/);
  input.target.anchorEvidence = { horizontal: 'right', vertical: 'top', opposingInsets: 'declared-auto', evidence: ['actual CSS cascade: left and bottom declared auto'] };
  const result = planControlAlignment(input);
  assert.equal(result.afterInsets.right, 25); assert.equal(result.afterInsets.left, 'auto'); assert.equal(result.afterInsets.bottom, 'auto');
  assert.equal(result.localRule, 'selector .arrows{right:25px;}'); assert.deepEqual(result.positioningAnchors.evidence, input.target.anchorEvidence);
  input.target.anchorEvidence.evidence = []; assert.throws(() => planControlAlignment(input), /actual cascade anchors/);
});

test('missing evidence, cross-owner bindings, scaling, ambiguous anchors, size changes and large deltas fail closed', () => {
  const changes: Array<(input: any) => void> = [
    input => { input.source.evidence = []; }, input => { input.target.containingBlock.evidence = []; }, input => { input.ownerBinding.evidence = []; },
    input => { input.source.status = 'unobserved'; }, input => { input.source.ownerId = 'different-source-engine'; }, input => { input.target.nativeOwnerKey = 'other-engine'; }, input => { input.target.containingBlock.nativeOwnerKey = 'other-engine'; },
    input => { input.target.blockId = 'other-block'; }, input => { input.target.sourceGroupId = 'other-controls'; }, input => { input.target.matchedCount = 2; }, input => { input.target.containingBlock.matchedCount = 2; },
    input => { input.target.rect.width = 101; }, input => { input.source.rect.height = 31; }, input => { input.target.rect.x = NaN; }, input => { input.target.containingBlock.rect.x = Infinity; },
    input => { input.target.transform = { a: .5, b: 0, c: 0, d: 1, e: 0, f: 0 }; }, input => { input.target.transform = { a: 1, d: 1 }; }, input => { input.target.containingBlock.cssPixels = 'scaled'; },
    input => { delete input.target.margins.right; }, input => { input.target.insets.left = 20; }, input => { input.target.insets.right = 'auto'; },
    input => { input.source.rect.x = 200; }, input => { input.maxTranslationPx = 129; }, input => { input.dimensionTolerancePx = 10; },
    input => { input.target.relativeSelector = '.arrows,body'; }, input => { input.target.relativeSelector = '+ .neighbor'; }, input => { input.source.viewport.width = 1425; }, input => { input.viewport.breakpoint = { maxWidth: 1024 }; },
  ];
  for (const change of changes) { const input = fixture(); change(input); assert.throws(() => planControlAlignment(input), /Control translation rejected/); }
});

test('actual Chromium arrow and sibling pager align independently under the same native owner and different real containing blocks', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent(`<script>globalThis.__name=(target)=>target;</script><style>body{margin:0}.widget{position:relative;margin-left:100px;width:500px;height:150px}.source{margin-top:50px}.target{margin-top:100px}.arrows{position:absolute;top:-20px;right:10px;width:100px;height:30px;background:#eee}.pager{position:absolute;top:-14px;width:40px;height:20px;background:#ddd}.source .pager{right:80px}.target .pager{right:65px}.track-container{position:relative;left:-15px;width:530px;height:120px}</style><div class="widget source"><div class="arrows"></div><div class="pager">1 / 5</div></div><div class="widget target"><div class="track-container"><div class="arrows"></div></div><div class="pager">1 / 5</div></div>`);
    const plans = [];
    for (const selector of ['.arrows', '.pager']) {
      const measured = await page.evaluate(selector => {
        const source = document.querySelector('.source')!, target = document.querySelector('.target')!, a = source.querySelector(selector)!, b = target.querySelector(selector)! as HTMLElement, cb = b.offsetParent! as HTMLElement, sourceRoot = source.getBoundingClientRect(), targetRoot = target.getBoundingClientRect(), cbBox = cb.getBoundingClientRect(), css = getComputedStyle(b), r = (element: Element, origin: DOMRect) => { const box = element.getBoundingClientRect(); return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }; }, value = (text: string) => text === 'auto' ? 'auto' as const : Number.parseFloat(text);
        // This fixture has plain same-origin CSS rules. Read the declared cascade
        // independently from getComputedStyle, which resolves inactive insets too.
        const declared: Record<string, string> = { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' };
        for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule instanceof CSSStyleRule && b.matches(rule.selectorText)) for (const side of Object.keys(declared)) if (rule.style.getPropertyValue(side)) declared[side] = rule.style.getPropertyValue(side);
        const horizontal = declared.left === 'auto' && declared.right !== 'auto' ? 'right' as const : declared.right === 'auto' && declared.left !== 'auto' ? 'left' as const : undefined;
        const vertical = declared.bottom === 'auto' && declared.top !== 'auto' ? 'top' as const : declared.top === 'auto' && declared.bottom !== 'auto' ? 'bottom' as const : undefined;
        if (!horizontal || !vertical) throw Error('fixture must expose actual unambiguous authored CSS anchors');
        return { source: r(a, sourceRoot), target: r(b, targetRoot), cb: { x: cbBox.x + cb.clientLeft - targetRoot.x, y: cbBox.y + cb.clientTop - targetRoot.y, width: cb.clientWidth, height: cb.clientHeight }, insets: { top: value(css.top), right: value(css.right), bottom: value(css.bottom), left: value(css.left) }, anchorEvidence: { horizontal, vertical, opposingInsets: 'declared-auto' as const, evidence: ['actual fixture matching CSSOM rules: ' + JSON.stringify(declared)] }, margins: { top: parseFloat(css.marginTop), right: parseFloat(css.marginRight), bottom: parseFloat(css.marginBottom), left: parseFloat(css.marginLeft) } };
      }, selector);
      const input = fixture(); input.source.groupId = input.target.sourceGroupId = selector; input.source.rect = measured.source; input.target.rect = measured.target; input.target.insets = measured.insets; input.target.anchorEvidence = measured.anchorEvidence; input.target.margins = measured.margins; input.target.relativeSelector = selector; input.target.containingBlock.rect = measured.cb; input.target.containingBlock.relativeSelector = selector === '.arrows' ? '.track-container' : ':scope';
      const result = planControlAlignment(input); plans.push(result);
      await page.addStyleTag({ content: result.css!.replaceAll('selector', '.target') });
      const after = await page.locator(`.target ${selector}`).evaluate(element => { const box = element.getBoundingClientRect(), owner = document.querySelector('.target')!.getBoundingClientRect(); return { x: box.x - owner.x, y: box.y - owner.y, width: box.width, height: box.height }; });
      assert.deepEqual(after, measured.source);
    }
    assert.equal(plans[0].nativeOwnerKey, plans[1].nativeOwnerKey);
    assert.equal(plans[0].afterInsets.right, 25); assert.equal(plans[1].afterInsets.right, 80);
    assert.equal(plans[0].actualContainingBlock.rect.x, -15); assert.equal(plans[1].actualContainingBlock.rect.x, 0);
    await page.close();
  } finally { await browser.close(); }
});
