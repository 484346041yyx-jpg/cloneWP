import { redactor } from './core/config.js';
import { assertCreationTaskMode, parseCreationArguments, readCreationInput, resolveCreationMode } from './core/creation-mode.js';

const args = process.argv.slice(2);
const selected = parseCreationArguments(args);
if (!selected) {
  console.error('Usage: npm run create -- <DESIGN_JSON> [--mode original|replica] [--stage desktop|responsive|final] [--resume RUN_DIR] [--review-draft]');
  process.exitCode = 2;
} else {
  try {
    const root = process.cwd(), { filename, input } = await readCreationInput(root, selected.filename);
    const mode = resolveCreationMode(input, selected.mode);
    if (selected.reviewDraft && (mode !== 'replica' || (input as {executionStrategy?:unknown}).executionStrategy !== 'native44-css-handoff')) throw Error('--review-draft requires a complete native44 component-reference task');
    await assertCreationTaskMode(root, filename, mode);
    if (mode === 'replica' && (input as {version?:unknown}).version === 2) {
      if ((input as {executionStrategy?:unknown}).executionStrategy === 'native44-css-handoff') {
        if (selected.stage) throw Error('native44-css-handoff builds the complete document once and does not accept --stage');
        const { runNative44Replica } = await import('./native44/runtime.js');
        const result = await runNative44Replica(filename, { root, resume: selected.resume, ...(selected.reviewDraft ? { reviewDraft: true } : {}), onProgress: message => console.error(`[cloneWP native44] ${message}`) });
        console.log(JSON.stringify(result, null, 2));
        process.exitCode = result.deliveryComplete ? 0 : result.status === 'awaiting-comparison' ? 3 : 1;
      } else {
      const { runReplicaV2 } = await import('./replica-v2/runtime.js');
      const result = await runReplicaV2(filename, {root,stage:selected.stage ?? 'desktop',resume:selected.resume,onProgress: message => console.error(`[cloneWP replica v2] ${message}`)});
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.wholeTaskComplete ? 0 : ['failed','interrupted'].includes(result.status) ? 1 : 3;
      }
    } else {
      if (selected.stage || selected.resume) throw new Error('Stage/resume arguments require a version 2 replica program.');
      const writer = mode === 'replica' ? (await import('./fidelity/runner.js')).runFidelity : (await import('./original/runner.js')).runOriginal;
      const result = await writer(filename, { onProgress: message => console.error(`[cloneWP ${mode}] ${message}`) });
      console.log(JSON.stringify({ mode, status: result.status, pageId: result.pageId, editUrl: result.editUrl, previewUrl: result.previewUrl, resultFile: `${result.runDir}/result.json`, error: result.error }, null, 2));
      process.exitCode = result.status === 'completed' ? 0 : result.status === 'needs-review' ? 3 : 1;
    }
  } catch (error) { console.error(redactor()(error)); process.exitCode = 1; }
}

