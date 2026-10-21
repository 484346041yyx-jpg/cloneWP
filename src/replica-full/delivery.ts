import { validateFullReplicaManifest, validateFullReplicaReview } from './contract.js';
import type { FullReplicaManifest, FullReplicaRunState } from './types.js';

const label = (value: string): string => value.replace(/[\\`*_{}\[\]()#+.!|<>]/g, '\\$&');
export function fullReplicaDelivery(input: FullReplicaRunState, manifestInput: FullReplicaManifest, editorCompletion?: { required: boolean; complete: boolean; status: string }) {
  const manifest = validateFullReplicaManifest(manifestInput), header = input.checkpoints.header;
  const page = input.checkpoints.body ?? input.checkpoints.page;
  const review = input.review && input.checkpoints.bound ? validateFullReplicaReview(input.review, manifest, input.checkpoints.bound) : null;
  const editor = editorCompletion ?? { required: !!manifest.editorCompletionPolicy, complete: !manifest.editorCompletionPolicy, status: manifest.editorCompletionPolicy ? 'awaiting-editor-alignment-and-reopen' : 'historical-contract' };
  const complete = input.status === 'published' && Boolean(input.checkpoints.published) && review?.decision === 'approved' && !input.pending && editor.complete;
  const resources = [
    ...(page ? [{ kind: 'page', name: manifest.title, id: String(page.pageId), editUrl: page.editUrl }] : []),
    ...(header ? [{ kind: 'header', name: header.name, id: header.headerId, editUrl: header.editUrl }, ...header.menus.map(menu => ({ kind: 'menu', name: menu.name, id: String(menu.id), editUrl: menu.editUrl })), { kind: 'style', name: header.styleBlock.name, id: String(header.styleBlock.id), editUrl: header.styleBlock.editUrl }] : []),
    ...(header?.menuContent?.map(content => ({ kind: 'menu-content', name: content.name, id: String(content.id), editUrl: content.editUrl })) ?? []),
  ];
  const markdown = [
    `状态：${input.status}${complete ? '，当前整页复核与发布读回已确认' : '，尚未完成整页交付'}。`,
    ...(input.checkpoints.published ? [`公开页面：[${label(manifest.title)}](${input.checkpoints.published.publicUrl})`] : []),
    '', ...resources.map(resource => `- ${resource.kind}：[${label(resource.name)}](${resource.editUrl})（${label(resource.id)}）`),
    ...(manifest.responsive ? ['', `验证范围：桌面 1920×1080、1440×1000；手机 ${manifest.responsive.viewports.map(v => `${v.width}×${v.height}`).join('、')}；平板沿用桌面，仅核对断点。`, '同一个 WoodMart 页眉包含独立手机布局，菜单使用上述任务自有菜单。'] : []),
    '', '页眉布局、菜单和样式可分别修改；原组件实现与旧页面保持。',
    ...(editor.required ? [`编辑器与自动保存：${editor.status}${editor.complete ? '，已确认正常可编辑重开版本' : '；交付未完成，自动继续当前任务页的对齐及重开验证'}。`] : []),
  ].join('\n');
  return { version: 1, kind: 'clonewp-full-replica-delivery', taskId: input.taskId, runId: input.runId, status: input.status, complete, editorCompletion: editor, ...(!editor.complete ? { nextAction: 'editor:complete prepare -> align/reconcile -> normal editor reopen -> recover --stdin if loading -> verify' } : {}), resources, publicUrl: input.checkpoints.published?.publicUrl ?? null, reviewFingerprint: review?.fingerprint ?? null, lastError: input.lastError ?? null, markdown };
}
