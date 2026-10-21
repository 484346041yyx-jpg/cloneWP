import { runFidelity } from '../src/fidelity/runner.js';

const program = 'D:/cloneWP/references/reference-2026-10-15T01-35-56-997Z-www-petsupermarket-com-1698bebb/program.json';
const result = await runFidelity(program, {
  root: 'D:/cloneWP',
  reviewDraft: { reason: 'The user requested a native Elementor replica draft. The current connected browser provides three viewport captures and source assets, but interaction, mobile touch, content ownership and global overlay proof remain explicitly incomplete. This is a review draft, not a fidelity pass.' },
  onProgress: stage => process.stderr.write(`[replica review draft] ${stage}\n`),
});
process.stdout.write(JSON.stringify({ status: result.status, stage: result.stage, pageId: result.pageId, editUrl: result.editUrl, previewUrl: result.previewUrl, runDir: result.runDir, blocksBuilt: result.blocksBuilt, importedAssets: result.importedAssets, error: result.error }) + '\n');
