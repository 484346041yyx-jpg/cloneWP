import { Codex } from '@openai/codex-sdk';

const agent = new Codex({ config: { features: { shell_tool: false, apply_patch_tool: false }, web_search: 'disabled' } });
const thread = agent.startThread({ workingDirectory: process.cwd(), skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', modelReasoningEffort: 'low', webSearchMode: 'disabled', networkAccessEnabled: false });
try {
  const result = await thread.run('Do not use tools or inspect files. Return exactly a JSON object with ready=true to verify this Codex SDK session.', { outputSchema: { type: 'object', additionalProperties: false, properties: { ready: { type: 'boolean' } }, required: ['ready'] }, signal: AbortSignal.timeout(90_000) });
  const response = JSON.parse(result.finalResponse);
  if (response.ready !== true) throw new Error('Agent authentication check did not return the expected structured response');
  console.log(JSON.stringify({ ready: true, usage: result.usage, threadId: thread.id }));
} catch (error) { console.error(error instanceof Error ? error.message : 'Agent check failed'); process.exitCode = 1; }
