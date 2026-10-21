/** Pet 2026-10-16 production helpers only. Not a default planner or source-fact generator.
 * Inputs are observed content/computed styles. Component roles and source facts belong to the caller.
 */
import type { Native44Component, Native44Composite, Native44Native, Native44Carousel } from '../src/native44/types.js';

export type ScalarUnit = 'px' | '%' | 'fr' | 'em' | 'rem';
export type ObservedStyle = Record<string, unknown>;
export interface DeviceCounts { desktop: number; tablet?: number; mobile?: number }
export const scalar = (size: number, unit: ScalarUnit = 'px') => {
  if (!Number.isFinite(size)) throw Error('Observed scalar must be finite');
  return { unit, size, sizes: [] as number[] };
};
export const px = (size: number) => scalar(size, 'px');
export const pct = (size: number) => scalar(size, '%');
export const fr = (size: number) => scalar(size, 'fr');
export function edges(top = 0, right = top, bottom = top, left = right, unit: 'px' | '%' = 'px') {
  if (![top, right, bottom, left].every(Number.isFinite)) throw Error('Observed edges must be finite');
  return { unit, top, right, bottom, left, isLinked: top === right && right === bottom && bottom === left };
}
const gaps = (gap = 0) => ({ unit: 'px', row: String(gap), column: String(gap), isLinked: true });
const baseContainer = (): Record<string, unknown> => ({
  container_type: 'flex', content_width: 'full', width: pct(100),
  flex_direction: 'column', flex_align_items: 'stretch', flex_gap: gaps(0),
  margin: edges(0), padding: edges(0),
});
const baseWidget = (): Record<string, unknown> => ({ _margin: edges(0), _padding: edges(0), _element_width: 'inherit' });
export function leafContainer(key: string, children: Native44Component[] = [], settings: Record<string, unknown> = {}): Native44Composite {
  return { kind: 'composite', key, settings: { ...baseContainer(), ...settings }, children };
}
export function sectionContainer(key: string, children: Native44Component[] = [], settings: Record<string, unknown> = {}): Native44Composite {
  const base = baseContainer(); delete base.width;
  return { kind: 'composite', key, settings: { ...base, content_width: 'boxed', boxed_width: px(1440), ...settings }, children };
}
function count(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw Error(`Observed count must be an integer from 1 to ${max}`);
  return value;
}
export function gridContainer(key: string, children: Native44Component[] = [], columns: number | DeviceCounts = 1, gap = 0, settings: Record<string, unknown> = {}): Native44Composite {
  if (!Number.isFinite(gap) || gap < 0) throw Error('Observed grid gap must be nonnegative');
  const widths = typeof columns === 'number' ? { desktop: columns, tablet: columns, mobile: columns } : columns;
  const desktop = count(widths.desktop, 12), tablet = count(widths.tablet ?? desktop, 12), mobile = count(widths.mobile ?? desktop, 12);
  const base = baseContainer(); delete base.flex_direction; delete base.flex_align_items; delete base.flex_gap;
  const rows = (n: number) => fr(count(Math.max(1, Math.ceil(children.length / n)), 12));
  return { kind: 'composite', key, settings: {
    ...base, container_type: 'grid', grid_columns_grid: fr(desktop), grid_columns_grid_tablet: fr(tablet), grid_columns_grid_mobile: fr(mobile),
    grid_rows_grid: rows(desktop), grid_rows_grid_tablet: rows(tablet), grid_rows_grid_mobile: rows(mobile), grid_gaps: gaps(gap), ...settings,
  }, children };
}
const pick = (style: ObservedStyle, camel: string): unknown => style[camel] ?? style[camel.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)];
function observedNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(value.trim())) return undefined;
  const number = Number.parseFloat(value); return Number.isFinite(number) ? number : undefined;
}
function typography(style: ObservedStyle): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const family = pick(style, 'fontFamily'), size = observedNumber(pick(style, 'fontSize')), line = observedNumber(pick(style, 'lineHeight'));
  const weight = pick(style, 'fontWeight'), fontStyle = pick(style, 'fontStyle');
  if (typeof family === 'string' && family.trim()) result.typography_font_family = family.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
  if (size !== undefined) result.typography_font_size = px(size);
  if (line !== undefined) result.typography_line_height = px(line);
  if (weight !== undefined && weight !== '') {
    const value = String(weight);
    if (!/^(?:[1-9]00|normal|bold)$/.test(value)) throw Error(`Observed font weight is outside the actual panel contract: ${value}`);
    result.typography_font_weight = value;
  }
  if (typeof fontStyle === 'string' && ['normal', 'italic', 'oblique'].includes(fontStyle)) result.typography_font_style = fontStyle;
  if (Object.keys(result).length) result.typography_typography = 'custom';
  return result;
}
const textColor = (style: ObservedStyle): string | undefined => typeof pick(style, 'color') === 'string' ? String(pick(style, 'color')) : undefined;
// Only these text-alignment values are shared by the researched and current target heading/text controls.
function commonTextAlign(style: ObservedStyle): Record<string, unknown> {
  const align = pick(style, 'textAlign'); return align === 'center' || align === 'justify' ? { align } : {};
}
function observedEdges(style: ObservedStyle, prefix: 'padding' | 'margin'): ReturnType<typeof edges> | undefined {
  const values = ['Top', 'Right', 'Bottom', 'Left'].map(side => observedNumber(pick(style, `${prefix}${side}`)));
  return values.every(value => value !== undefined) ? edges(values[0]!, values[1]!, values[2]!, values[3]!) : undefined;
}
function observedRadius(style: ObservedStyle): ReturnType<typeof edges> | undefined {
  const values = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => observedNumber(pick(style, `border${corner}Radius`)));
  if (values.every(value => value !== undefined)) return edges(values[0]!, values[1]!, values[2]!, values[3]!);
  const radius = observedNumber(pick(style, 'borderRadius')); return radius === undefined ? undefined : edges(radius);
}
export function styledHeading(key: string, text: string, style: ObservedStyle = {}, tag = 'h2'): Native44Native {
  if (!['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div'].includes(tag)) throw Error('Unsupported observed heading tag');
  const color = textColor(style);
  return { kind: 'native', key, role: 'heading', settings: baseContainer(), widgetType: 'heading', widgetSettings: {
    ...baseWidget(), title: text, header_size: tag, ...typography(style), ...commonTextAlign(style), ...(color ? { title_color: color } : {}),
  } };
}
const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function styledText(key: string, text: string, style: ObservedStyle = {}): Native44Native {
  const color = textColor(style), editor = text.split(/\r?\n\r?\n/).map(paragraph => `<p>${escapeText(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
  return { kind: 'native', key, role: 'text', settings: baseContainer(), widgetType: 'text-editor', widgetSettings: {
    ...baseWidget(), editor, ...typography(style), ...commonTextAlign(style), ...(color ? { text_color: color } : {}),
  } };
}
export function styledImage(key: string, assetKey: string, widthPx: number | { size: number; unit: 'px' | '%' }, href?: string): Native44Native {
  const width = typeof widthPx === 'number' ? { size: widthPx, unit: 'px' as const } : widthPx;
  if (!Number.isFinite(width.size) || width.size < 0 || width.unit === 'px' && width.size > 1000) throw Error('Image custom pixel width must stay within the actual 1000px field range; use a measured percentage for larger images');
  return { kind: 'native', key, role: 'image', settings: baseContainer(), widgetType: 'wd_image_or_svg', widgetSettings: {
    ...baseWidget(), image: { $asset: assetKey }, image_size: 'full', _element_width: 'initial', _element_custom_width: scalar(width.size, width.unit),
    ...(href ? { on_click_action: 'link', link: { url: href } } : { on_click_action: 'none' }),
  } };
}
export function styledButton(key: string, text: string, href: string, style: ObservedStyle = {}): Native44Native {
  const color = textColor(style), background = pick(style, 'backgroundColor'), padding = observedEdges(style, 'padding'), radius = observedRadius(style);
  const align = pick(style, 'textAlign');
  return { kind: 'native', key, role: 'button', settings: baseContainer(), widgetType: 'button', widgetSettings: {
    ...baseWidget(), text, link: { url: href }, ...typography(style),
    ...(typeof align === 'string' && ['left', 'center', 'right', 'justify'].includes(align) ? { align } : {}),
    ...(color ? { button_text_color: color } : {}),
    ...(typeof background === 'string' ? { background_background: 'classic', background_color: background } : {}),
    ...(padding ? { text_padding: padding } : {}), ...(radius ? { border_radius: radius } : {}),
  } };
}
export function manualCarousel(key: string, slides: Native44Component[], counts: DeviceCounts = { desktop: 1, tablet: 1, mobile: 1 }, settings: Record<string, unknown> = {}): Native44Carousel {
  const desktop = count(counts.desktop, 8), tablet = count(counts.tablet ?? desktop, 8), mobile = count(counts.mobile ?? desktop, 8);
  return { kind: 'native-carousel', key, role: 'carousel', settings: { ...baseContainer(), ...settings }, widgetType: 'nested-carousel', widgetSettings: {
    ...baseWidget(), slides_to_show: String(desktop), slides_to_show_tablet: String(tablet), slides_to_show_mobile: String(mobile),
    slides_to_scroll: '1', slides_to_scroll_tablet: '1', slides_to_scroll_mobile: '1', autoplay: 'no', infinite: 'yes', arrows: 'yes', pagination: 'bullets',
  }, slides };
}
