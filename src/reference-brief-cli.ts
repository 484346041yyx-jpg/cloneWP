import { prepareReferenceBrief } from './reference/brief.js';
import { redactor } from './core/config.js';
const args = process.argv.slice(2);
if (args.length !== 1 || /^(?:[a-z]+:\/\/|--)/i.test(args[0])) {
  console.error('Usage: npm run reference:brief -- <REFERENCE_JOB_DIR>'); process.exitCode = 2;
} else {
  try {
    const job = await prepareReferenceBrief(args[0], { onProgress: message => console.error(`[reference:brief] ${message}`) });
    console.log(JSON.stringify(job, null, 2));
  } catch (error) { console.error(redactor()(error)); process.exitCode = 1; }
}
