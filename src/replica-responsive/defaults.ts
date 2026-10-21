/** Defaults for the existing create:replica entry. Frozen v1 task documents are
 * read as v1; absent/new contracts use v3 and must supply real phone evidence. */
export const CURRENT_REPLICA_WORKFLOW_VERSION = 3 as const;
export const CURRENT_REPLICA_RESPONSIVE_DEFAULTS = Object.freeze({ tablet: 'desktop' as const, mobileMaxWidth: 768 as const, viewports: Object.freeze([{ width: 390, height: 844 }, { width: 430, height: 932 }]) });
export function responsivePageShellCSS(pageId: number): string {
  if (!Number.isSafeInteger(pageId) || pageId < 1) throw Error('replica_responsive_page_identity');
  return `@media(max-width:1024px){body.page-id-${pageId} .wd-toolbar{display:none!important}body.page-id-${pageId}.sticky-toolbar-on{padding-bottom:0!important}}`;
}
