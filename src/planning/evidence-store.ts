import type { CompactSource } from './codex.js';
import type { WidgetSchemas } from './plan.js';

export const EVIDENCE_TOOLS = ['list_sections', 'read_nodes', 'read_controls', 'read_assets', 'read_context'] as const;
export interface EvidenceBundle { source: CompactSource; widgets: WidgetSchemas; assets: unknown[]; capabilities: unknown; previous?: unknown; issues?: unknown }

/** Fixed immutable public bundle. No paths, network calls, commands or WordPress writes. */
export class EvidenceStore {
  constructor(private readonly bundle: EvidenceBundle) {}
  execute(name: string, args: Record<string, unknown> = {}): unknown {
    let result: unknown;
    if (name === 'list_sections') {
      result = { url: this.bundle.source.url, title: this.bundle.source.title, viewports: this.bundle.source.viewports.map(v => ({ name: v.name, width: v.width, height: v.height, pageHeight: v.pageHeight, sections: v.sections })), widgetTypes: Object.keys(this.bundle.widgets), warnings: this.bundle.source.warnings };
    } else if (name === 'read_nodes') {
      const viewport = this.bundle.source.viewports.find(v => v.name === args.viewport);
      if (!viewport) throw new Error('Unknown captured viewport');
      const ids = this.ids(args.ids, 40);
      const styles: CompactSource['stylePatches'] = {};
      const nodes = ids.map(id => {
        const record = viewport.elements.find(e => e.id === id);
        if (!record) throw new Error(`Node ${id} is absent in ${viewport.name}`);
        const node = { ...this.bundle.source.nodes[id] };
        for (const [key, value] of Object.entries(record.nodeDelta ?? {})) { if (value === null) delete node[key]; else node[key] = value; }
        styles[record.styleRef] = this.bundle.source.stylePatches[record.styleRef];
        const children = viewport.elements.filter(e => (Object.hasOwn(e.nodeDelta ?? {}, 'parentId') ? e.nodeDelta?.parentId : this.bundle.source.nodes[e.id]?.parentId) === id);
        const isOwnedRaw = (e: typeof record) => { const child = { ...this.bundle.source.nodes[e.id], ...e.nodeDelta }; return child.primaryOwnerId && child.primaryOwnerId !== e.id; };
        return { id, ...node, rect: record.rect, styleRef: record.styleRef, childIds: children.filter(e => !isOwnedRaw(e)).map(e => e.id), ownedRawChildIds: children.filter(isOwnedRaw).map(e => e.id) };
      });
      result = { encoding: 'computed-css-base-patch-v1', styleBase: this.bundle.source.styleBase, styles, nodes };
    } else if (name === 'read_controls') {
      const type = String(args.widgetType ?? ''), widget = this.bundle.widgets[type];
      if (!widget) throw new Error('Unknown registered widget type');
      const controls = widget.controls ?? {}, all = Object.keys(controls);
      const names = args.names === undefined ? [] : this.ids(args.names, 30);
      for (const key of names) if (!Object.hasOwn(controls, key)) throw new Error(`Control ${key} is unavailable in the registered profile`);
      const selected = new Set(names);
      const collect = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(collect); return; }
        for (const [key, item] of Object.entries(value)) {
          const candidate = key.replace(/[!<>=]+$/, '');
          if (Object.hasOwn(controls, candidate)) selected.add(candidate);
          if (key === 'name' && typeof item === 'string' && Object.hasOwn(controls, item)) selected.add(item);
          if (typeof item === 'object') collect(item);
        }
      };
      for (const key of selected) collect({ condition: controls[key].condition, conditions: controls[key].conditions });
      result = { widgetType: type, controlNames: all, controls: Object.fromEntries([...selected].map(key => [key, controls[key]])) };
    } else if (name === 'read_assets') {
      const offset = this.offset(args.offset);
      result = { total: this.bundle.assets.length, assets: this.bundle.assets.slice(offset, offset + 20), aliases: this.bundle.source.resourceAliases };
    } else if (name === 'read_context') {
      const section = args.section ?? 'capabilities', offset = this.offset(args.offset);
      if (section === 'capabilities') result = { capabilities: this.bundle.capabilities, previousAvailable: !!this.bundle.previous, issueCount: Array.isArray(this.bundle.issues) ? this.bundle.issues.length : 0 };
      else if (section === 'issues') result = { total: Array.isArray(this.bundle.issues) ? this.bundle.issues.length : 0, issues: Array.isArray(this.bundle.issues) ? this.bundle.issues.slice(offset, offset + 20) : this.bundle.issues };
      else if (section === 'previous') {
        const previous = this.bundle.previous as { title?: string; mode?: string; compositionJson?: string; mappings?: Array<{sourceId: string; targetId: string}>; unsupported?: unknown } | undefined;
        const document = previous?.compositionJson ? JSON.parse(previous.compositionJson) : { elements: [] };
        const flattened: Array<Record<string, unknown>> = [];
        const visit = (nodes: Array<Record<string, any>>, parentId: string | null) => { for (const node of nodes) { flattened.push({ ...node, parentId, elements: (node.elements ?? []).map((child: any) => child.id), sourceIds: previous?.mappings?.filter(m => m.targetId === node.id).map(m => m.sourceId) ?? [] }); visit(node.elements ?? [], String(node.id)); } };
        visit(document.elements ?? [], null);
        result = { title: previous?.title, mode: previous?.mode, pageSettings: document.pageSettings, unsupported: previous?.unsupported, total: flattened.length, nodes: flattened.slice(offset, offset + 20) };
      } else throw new Error('Unknown context section');
    } else throw new Error('Unknown read-only evidence tool');
    if (Buffer.byteLength(JSON.stringify(result)) > 40_000) throw new Error('Evidence response exceeds 40 KB; request fewer nodes or controls');
    return result;
  }
  index() {
    const seen = new Set<string>();
    return this.bundle.source.viewports.map(v => ({ name: v.name, nodes: v.elements.flatMap(e => {
      const node = { ...this.bundle.source.nodes[e.id], ...e.nodeDelta };
      if (node.primaryOwnerId && node.primaryOwnerId !== e.id) return [];
      const brief = { id: e.id, parentId: node.parentId, kind: node.kind, tag: node.tag, rect: e.rect, ...(seen.has(e.id) ? {} : { text: node.directText || node.text }) };
      seen.add(e.id); return [brief];
    }) }));
  }
  private ids(value: unknown, max: number): string[] {
    if (!Array.isArray(value) || !value.length || value.length > max || value.some(v => typeof v !== 'string' || v.length > 150)) throw new Error(`Request requires 1–${max} exact evidence identifiers`);
    return value;
  }
  private offset(value: unknown) { if (value === undefined) return 0; if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 10000) throw new Error('Invalid evidence offset'); return Number(value); }
}
