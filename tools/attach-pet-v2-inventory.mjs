import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readObservationDirectoryV2} from '../src/replica-v2/observation.ts';
import {buildSourceFactsV2} from '../src/replica-v2/source.ts';
const job='D:/cloneWP/references/reference-v2-2026-10-15T04-35-43-856Z-www-petsupermarket-com-67f02b1e';
const ref=path.join(job,'reference'),file='desktop-scene-inventory.json';
const bytes=await fs.readFile('D:/cloneWP/references/pet-v2-observation-20261015/'+file);
await fs.writeFile(path.join(ref,file),bytes);
const manifestPath=path.join(ref,'observation-manifest.json'),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
manifest.sceneInventories=[{path:file,sha256:createHash('sha256').update(bytes).digest('hex'),snapshotId:'pet-desktop-1920'}];
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const factsFile=path.join(job,'source-facts.json');
try{await fs.copyFile(factsFile,path.join(job,'source-facts-desktop-before-inventory.json'),fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
const observation=await readObservationDirectoryV2(ref,manifest.sourceUrl),facts=buildSourceFactsV2(observation);
await fs.writeFile(factsFile,JSON.stringify(facts,null,2)+'\n');
console.log(JSON.stringify({sourceFacts:Object.keys(facts.facts).length,inventory:JSON.parse(bytes).counts}));
