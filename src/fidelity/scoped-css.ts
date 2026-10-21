import type { NativeElement } from './types.js';

const cssProperties = new Set([
  'color', 'background-color', 'border-color', 'border-width', 'border-style', 'border-radius', 'box-shadow',
  'text-decoration', 'text-decoration-line', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset',
  'opacity', 'transform', 'transform-origin', 'transition', 'transition-property', 'transition-duration', 'transition-timing-function',
  'cursor', 'pointer-events', 'overflow', 'object-fit', 'object-position', 'outline', 'outline-color', 'outline-width', 'outline-offset',
  'display', 'flex-direction', 'order', 'align-items', 'justify-content', 'gap', 'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'position', 'top', 'right', 'bottom', 'left', 'z-index', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'white-space', 'text-align',
  'counter-reset', 'counter-increment', 'content',
]);
/** Narrow stylesheet grammar: scoped visual rules and bounded width queries, no network/code. */
export function validateScopedNativeCSS(css: string): void {
  if (typeof css !== 'string' || css.length > 6000 || /[\\<>]|\/\*|url\s*\(|expression\s*\(|(?:javascript|vbscript|data):|!important|behavior\s*:|-moz-binding/i.test(css)) throw new Error('Native custom CSS contains unsupported content');
  if (!css.trim()) return;
  let queries=0;
  const flattened=css.replace(/@media\s*\(\s*(?:max|min)-width\s*:\s*(\d+)px\s*\)\s*\{((?:\s*selector[^{}]*\{[^{}]*\}\s*)+)\}/g,(_match,width:string,inner:string)=>{queries++;if(Number(width)<320||Number(width)>2560||queries>6)throw Error('Native responsive width queries exceed the visual bound');return inner;});
  if(flattened.includes('@'))throw Error('Native custom CSS contains unsupported at-rules or nested queries');
  const rules = [...flattened.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  if (!rules.length || rules.length > 48 || flattened.replace(/[^{}]+\{[^{}]*\}/g, '').trim()) throw new Error('Native custom CSS must contain bounded visual rules');
  for (const [, selectors, declarations] of rules) {
    for (const selector of selectors.split(',').map(value => value.trim())) {
      if (!/^selector(?=$|[\s.:>\[])/.test(selector) || /(?:\bhtml\b|\bbody\b|:root|:has\(|:global|[{};])/i.test(selector) || /^selector(?::[A-Za-z-]+(?:\([^)]*\))?)*\s*[+~]/.test(selector)) throw new Error('Native custom CSS selectors must stay within their Elementor element');
      // The root token may occur exactly once; descendants cannot escape to the document.
      if ((selector.match(/\bselector\b/g) ?? []).length !== 1 || !/^[\w\s.:[\]="'()>+~*#-]+$/.test(selector)) throw new Error('Unsupported native scoped CSS selector');
    }
    for (const declaration of declarations.split(';').filter(value => value.trim())) {
      const split = declaration.indexOf(':');
      if (split < 1) throw new Error('Invalid native CSS declaration');
      const property = declaration.slice(0, split).trim().toLowerCase(), value = declaration.slice(split + 1).trim();
      if (!cssProperties.has(property) || !value || value.length > 250 || !/^[a-zA-Z0-9#(),.%\s+\/*'"_-]+$/.test(value)) throw new Error(`Unsupported native CSS property or value: ${property}`);
      if (/\b(?:NaN|Infinity)(?:px|rem|em|vw|vh|deg|ms|s)?\b/i.test(value)) throw new Error('Native CSS rejects non-finite style values');
      // Only the native-pagination adapter's live counters are allowed. This is
      // not permission to manufacture labels, prices or static page numbers.
      if (property === 'counter-reset' && value !== 'clonewp-page-current clonewp-page-total') throw new Error('Native counters must reset only the bounded live-pagination counters');
      if (property === 'counter-increment' && !['clonewp-page-total', 'clonewp-page-total clonewp-page-current'].includes(value)) throw new Error('Native counters must increment only the bounded live-pagination counters');
      if (property === 'content' && value !== 'counter(clonewp-page-current) " / " counter(clonewp-page-total)') throw new Error('Native generated content must be the live-pagination counter expression');
      if (property === 'position' && !['relative', 'absolute', 'static'].includes(value)) throw new Error('Native scoped CSS cannot add viewport overlays');
      if (property === 'pointer-events' && !['auto', 'none'].includes(value)) throw new Error('Native decorative media pointer handling must stay bounded');
      if (property === 'z-index' && (!/^\d+$/.test(value) || Number(value) > 10)) throw new Error('Native scoped CSS z-index exceeds the local visual bound');
    }
  }
}

/** Registry-independent validation runs on every authored node before credentials or discovery. */
export function validateNativeProgramCSS(elements: NativeElement[]): void {
  const visit = (node: NativeElement) => {
    if (Object.hasOwn(node.settings, 'custom_css')) {
      if (typeof node.settings.custom_css !== 'string') throw new Error(`Native custom CSS must be a local stylesheet string: ${node.key}`);
      try { validateScopedNativeCSS(node.settings.custom_css); }
      catch (error) { throw new Error(`Invalid local native custom CSS at ${node.key}: ${(error as Error).message}`, { cause: error }); }
    }
    for (const child of node.children ?? []) visit(child);
  };
  elements.forEach(visit);
}

