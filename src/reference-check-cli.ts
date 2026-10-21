import path from 'node:path';
import { auditFidelityProgram } from './fidelity/check.js';
import { redactor } from './core/config.js';
import { readFile } from 'node:fs/promises';
import { validateLocalInputV2 } from './replica-v2/runtime.js';
const args = process.argv.slice(2);
if (args.length !== 1 || /^(?:[a-z]+:\/\/|--)/i.test(args[0])) {
  console.error('Usage: npm run design:check -- <REFERENCE_JOB_DIR>'); process.exitCode = 2;
} else {
  try {
    const filename = path.resolve(process.cwd(), args[0], 'program.json');
    const input = JSON.parse(await readFile(filename, 'utf8'));
    if (input.executionStrategy !== undefined) {
      if (input.executionStrategy !== 'native44-css-handoff' || input.version !== 2) throw Error('Unknown replica strategy');
      const { validateLocalNative44Input } = await import('./native44/runtime.js');
      const checked = await validateLocalNative44Input(filename, process.cwd());
      console.log(JSON.stringify({ version: 2, executionStrategy: input.executionStrategy, passed: true, blocks: checked.program.blocks.length, sourceFactsHash: checked.sourceFactsHash, componentPlanHash: checked.componentPlanHash, deliveryComplete: false }, null, 2));
      process.exitCode = 0;
    } else if (input.version === 2) {
      const checked = await validateLocalInputV2(filename, process.cwd(), 'desktop');
      console.log(JSON.stringify({version:2,workflow:'block-replication',passed:true,stage:'desktop',blocks:checked.program.blocks.length,sourceFactsHash:checked.sourceFactsHash,componentPlanHash:checked.componentPlanHash,wholeTaskComplete:false},null,2));
      process.exitCode=0;
    } else {
      const { audit } = await auditFidelityProgram(filename);
      console.log(JSON.stringify(audit, null, 2)); process.exitCode = audit.passed ? 0 : audit.status === 'needs-review' ? 3 : 1;
    }
  } catch (error) { console.error(redactor()(error)); process.exitCode = 1; }
}
