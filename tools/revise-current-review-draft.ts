import { reviseOwnedFidelity } from '../src/fidelity/revision.js';

const result=await reviseOwnedFidelity({
  root:'D:/cloneWP',
  runDir:'D:/cloneWP/runs/2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75',
  programPath:'D:/cloneWP/references/reference-2026-10-15T01-35-56-997Z-www-petsupermarket-com-1698bebb/program.json',
  expectedCurrentHash:'e96c3a42932e7dec7cf25d160ad72186a75e86305afe1299b8e125469f20f69b',
  reviewDraft:{reason:'Improve source-measured static block geometry in the current owned review draft while preserving the frozen source contract, media identity, native tree, and target product queries. Source scene coverage remains incomplete.'},
  onProgress:stage=>process.stderr.write(`[geometry revision] ${stage}\n`),
});
process.stdout.write(JSON.stringify({status:result.status,pageId:result.pageId,revisionDir:result.revisionDir,changedBlocks:result.changedBlocks,skippedBlocks:result.skippedBlocks,finalHash:result.finalHash,verificationPath:result.verificationPath})+'\n');
