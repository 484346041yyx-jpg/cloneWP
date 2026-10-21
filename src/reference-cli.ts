import { prepareObservedReference } from './reference/observation.js';
import { redactor } from './core/config.js';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { NATIVE44_BROWSER_OBSERVATION_FILE, prepareNative44Reference, prepareObservedNative44Reference } from './native44/source.js';
const args = process.argv.slice(2);
const observedDirectory = args.length === 3 && args[1] === '--observed' && path.isAbsolute(args[2]) ? args[2] : undefined;
if (!/^https?:\/\//i.test(args[0] ?? '') || !(args.length === 1 || observedDirectory)) {
  console.error('Usage: npm run reference -- <REFERENCE_URL> [--observed <ABSOLUTE_OBSERVATION_DIRECTORY>]'); process.exitCode = 2;
} else {
  try {
    let legacyObserved = false;
    if (observedDirectory) {
      try { const manifest = JSON.parse(await readFile(path.join(observedDirectory, 'observation-manifest.json'), 'utf8')); if (manifest.version !== 2) throw new Error('Unknown browser observation version'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') legacyObserved = true; else throw error; }
      if (legacyObserved) {
        try { await readFile(path.join(observedDirectory, NATIVE44_BROWSER_OBSERVATION_FILE)); throw Error('Native44 user-browser observations require their v2 manifest; historical fallback is forbidden'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    const job = observedDirectory
      ? legacyObserved ? await prepareObservedReference(args[0], observedDirectory) : await prepareObservedNative44Reference(args[0], observedDirectory)
      : await prepareNative44Reference(args[0], { onProgress: message => console.error(`[reference native44] ${message}`) });
    console.log(JSON.stringify(job, null, 2)); process.exitCode = job.status === 'blocked' ? 1 : 0;
  } catch (error) { console.error(redactor()(error)); process.exitCode = 1; }
}
