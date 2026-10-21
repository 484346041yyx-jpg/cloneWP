import { Codex } from '@openai/codex-sdk';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Explicit integration check; never included in ordinary npm test or page tasks.
const root = process.cwd();
const output = path.resolve(root, process.argv[2] ?? 'reports/system-five-layer-20261016/context-sessions.json');
const relative = path.relative(root, output);
if (!relative.startsWith(`reports${path.sep}`) || relative.split(path.sep).includes('..')) throw Error('session_report_outside_reports');
const commandReadOnly = process.argv.includes('--command-read-only');
const restriction = '本次只测试项目的自动阅读。只准备本地上下文并说明下一步；禁止访问网站、浏览器、读取凭据、写文件或执行建站。每次只执行一条本地读取命令，不使用管道、拼接或重定向。不要询问确认，也不要继续后续动作。';
const scenarios = [
  { intent: 'replica', request: '复刻建站：https://example.com/', status: 'ready', required: ['SYSTEM.md', 'COMPONENTS.md', 'reference-elementor/SKILL.md'] },
  { intent: 'original', request: '原创建站：做一个简单的园艺品牌首页。', status: 'ready', required: ['SYSTEM.md', 'original-mode.md'] },
  { intent: 'learn', request: '学习我已打开的产品分类页和详情页，积累通用的组件选型经验，不扩大启用集合。', status: 'ready', required: ['SYSTEM.md', 'COMPONENTS.md'] },
  { intent: 'compare', request: 'CSS 已经加好了，请继续检查之前的草稿，列出问题，不改页面。', status: 'needs-task-selection', required: ['SYSTEM.md', 'COMPONENTS.md'] },
  { intent: 'resume', request: '继续之前没完成的建站任务。', status: 'needs-task-selection', required: ['SYSTEM.md', 'COMPONENTS.md'] },
  { intent: 'maintain', request: '检查项目的五层职责和组件扩展边界，先读对系统资料。', status: 'ready', required: ['SYSTEM.md', 'COMPONENTS.md'] },
].filter(scenario => !process.argv.includes('--only-replica') || scenario.intent === 'replica');
const schema = { type: 'object', additionalProperties: false, properties: {
  intent: { type: 'string' }, status: { type: 'string' }, nextStep: { type: 'string' },
  siteOperationsPerformed: { type: 'boolean' }, localWritesPerformed: { type: 'boolean' },
}, required: ['intent', 'status', 'nextStep', 'siteOperationsPerformed', 'localWritesPerformed'] };
const agent = new Codex({ config: { features: { shell_tool: true, apply_patch_tool: false }, web_search: 'disabled' } });
const results = [];
const hash = text => createHash('sha256').update(text).digest('hex');
function safeCommand(command) {
  // read-only sandbox plus a second stream guard: no arbitrary executable/network/write commands.
  const denied = /(?:Invoke-(?:WebRequest|RestMethod)|\bcurl\b|\bwget\b|\bfetch\s*\(|\bhttps?\.request|\bStart-Process\b|\b(?:Set|Add|Out)-Content\b|\bRemove-Item\b|\bMove-Item\b|\bCopy-Item\b|\bNew-Item\b|\bapply_patch\b|\bcontext:index\b|\bcreate:|\blearn:|\bcompare:replica\b|\bconfig\.json\b|\b\.env\b)/i;
  if (denied.test(command)) return false;
  if (!commandReadOnly) return /(?:context:load|context[\\/]cli\.(?:ts|js)|Get-Content|Get-Item|Test-Path|\brg\b|Get-Location|\bpwd\b)/i.test(command);
  let actual = command.replace(/^.*?\s-Command\s+/i, '').trim();
  if ((actual[0] === '"' || actual[0] === "'") && actual.at(-1) === actual[0]) {
    const quote = actual[0]; actual = actual.slice(1, -1);
    actual = quote === "'" ? actual.replaceAll("''", "'") : actual.replace(/\\"/g, '"');
  }
  if (/[;&|><`$\r\n]/.test(actual)) return false;
  if (/^(?:Get-Location|pwd)\s*$/i.test(actual)) return true;
  if (/^npm(?:\.cmd)?\s+run\s+context:load\s+--\s+--intent\s+(?:replica|original|learn|compare|resume|maintain)\s*$/.test(actual)) return true;
  const tokens = actual.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  if (tokens.shift()?.toLowerCase() !== 'get-content') return false;
  const paths = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index].replace(/^(['"])(.*)\1$/, '$2');
    if (['-literalpath', '-path', '-raw'].includes(token.toLowerCase())) continue;
    if (token.toLowerCase() === '-encoding') { if (!/^utf-?8$/i.test(tokens[++index] ?? '')) return false; continue; }
    if (token.startsWith('-')) return false;
    paths.push(token);
  }
  if (paths.length !== 1) return false;
  const name = path.relative(root, path.resolve(root, paths[0])).split(path.sep).join('/');
  return /^(?:(?:AGENTS|SYSTEM|COMPONENTS)\.md|\.agents\/skills\/(?:clonewp|reference-elementor)\/(?:SKILL\.md|references\/[a-zA-Z\d_-]+\.md))$/.test(name);
}
function readLoaderOutput(text, intent) {
  const offset = text.indexOf('{\n  "status"');
  const windowsOffset = text.indexOf('{\r\n  "status"');
  const start = offset >= 0 ? offset : windowsOffset;
  if (start < 0) return;
  try { const parsed = JSON.parse(text.slice(start)); if (parsed.intent === intent && parsed.metrics && Array.isArray(parsed.documents)) return parsed; } catch {}
}
for (const scenario of scenarios) {
  const started = performance.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const result = { intent: scenario.intent, passed: false, elapsedMs: 0, contextInvocations: 0, commands: [], violations: [], observedDocuments: [] };
  const thread = agent.startThread({ workingDirectory: root, skipGitRepoCheck: true, sandboxMode: commandReadOnly ? 'danger-full-access' : 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled', threadSource: 'exec' });
  let finalResponse, context, usage;
  try {
    const turn = await thread.runStreamed(`${scenario.request}\n${restriction}`, { outputSchema: schema, signal: controller.signal });
    for await (const event of turn.events) {
      if ('item' in event) {
        const item = event.item;
        if (['file_change', 'mcp_tool_call', 'web_search'].includes(item.type)) { result.violations.push(item.type); controller.abort(); }
        if (item.type === 'command_execution') {
          if (!safeCommand(item.command)) { result.violations.push('command_outside_readonly_context_scope'); if (item.command.length < 2048 && !/password|cookie|authorization|token|nonce|\.env/i.test(item.command)) result.rejectedReadCommand = item.command; controller.abort(); }
          if (event.type === 'item.completed') {
            const isContext = /(?:context:load|context[\\/]cli\.(?:ts|js))/.test(item.command);
            result.commands.push({ sha256: hash(item.command), contextCommand: isContext, exitCode: item.exit_code });
            if (isContext) { result.contextInvocations += 1; context ??= readLoaderOutput(item.aggregated_output, scenario.intent); }
          }
        }
        if (event.type === 'item.completed' && item.type === 'agent_message') finalResponse = item.text;
      }
      if (event.type === 'turn.completed') usage = event.usage;
      if (event.type === 'turn.failed' || event.type === 'error') throw Error('session_execution_failed');
    }
    const response = JSON.parse(finalResponse ?? '{}');
    result.observedDocuments = (context?.documents ?? []).map(document => ({ path: path.relative(root, document.path).split(path.sep).join('/'), sha256: document.sha256, bytes: document.bytes }));
    result.contextStatus = context?.status;
    result.contextMetrics = context?.metrics;
    result.response = { intent: response.intent, status: response.status, siteOperationsPerformed: response.siteOperationsPerformed, localWritesPerformed: response.localWritesPerformed };
    result.usage = usage;
    // The actual loader invocation, output and command audit are authoritative;
    // a translated prose description in the final response is not an intent ID.
    result.passed = result.violations.length === 0 && result.contextInvocations === 1 && context?.status === scenario.status && response.siteOperationsPerformed === false && response.localWritesPerformed === false && scenario.required.every(name => result.observedDocuments.some(document => document.path.endsWith(name))) && ['networkRequests', 'credentialLoads', 'browserStarts', 'fileWrites'].every(key => context.metrics[key] === 0);
    if (!context) result.failure = 'actual_loader_output_unverified';
  } catch (error) { result.failure = controller.signal.aborted ? 'session_interrupted_or_timed_out' : 'session_execution_failed'; }
  finally { clearTimeout(timer); result.elapsedMs = Math.round(performance.now() - started); }
  results.push(result);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ version: 1, kind: 'clonewp-independent-context-session-check', readOnly: true, isolation: commandReadOnly ? 'audited-single-read-command-whitelist; no OS read-only sandbox' : 'OS-read-only-sandbox', networkAccessEnabled: false, tests: results }, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify({ intent: result.intent, passed: result.passed, elapsedMs: result.elapsedMs, failure: result.failure })}\n`);
}
process.exitCode = results.every(result => result.passed) ? 0 : 1;
