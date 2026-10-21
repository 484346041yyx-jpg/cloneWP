// Report the current Pet regression from receipts; never writes the target site.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root='D:/cloneWP';
const current=path.join(root,'runs/2026-10-15T05-02-27-244Z-v2-d52069a9');
const historical=path.join(root,'runs/2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75');
const read=async filename=>JSON.parse(await fs.readFile(filename,'utf8'));
const ref=async filename=>({path:filename,sha256:createHash('sha256').update(await fs.readFile(filename)).digest('hex')});
const journal=await read(path.join(current,'journal.json'));
const old=await read(path.join(historical,'runtime.json'));
const ledger=await read(path.join(current,'assets/ledger.json'));
const job=path.join(root,'references/reference-v2-2026-10-15T04-35-43-856Z-www-petsupermarket-com-67f02b1e');
const program=await read(path.join(job,'program.json'));
const plan=await read(path.join(job,program.componentPlan.path));
const flatten=blocks=>blocks.flatMap(block=>[block,...flatten(block.children??block.slides??[])]);
const editMethod=block=>block.kind==='html-static'?'HTML code editor (typed text / image / link slots; scoped CSS)':block.kind==='native-products'?'Elementor native query / display controls; product facts maintained in existing WooCommerce records':block.kind==='native-carousel'?'Elementor native carousel controls; slide content uses its declared editor':'Elementor native container / widget panel';
const blockManifest=program.blocks.map(block=>({key:block.key,kind:block.kind,editor:editMethod(block),components:flatten([block]).map(child=>({key:child.key,kind:child.kind,editor:editMethod(child),...(child.kind==='native-products'?{targetProductIds:child.query.ids}: {})}))}));
async function bytesBelow(directory){let size=0,count=0;for(const entry of await fs.readdir(directory,{withFileTypes:true})){const filename=path.join(directory,entry.name);if(entry.isDirectory()){const result=await bytesBelow(filename);size+=result.bytes;count+=result.files;}else if(entry.isFile()){size+=(await fs.stat(filename)).size;count++;}}return{bytes:size,files:count};}
const stages={};
for(const name of ['desktop-firstfold','desktop','responsive']){
  const filename=path.join(current,'verification',name,'capture.json');
  try{
    const capture=await read(filename);
    let review;try{review=await ref(path.join(current,'verification',name,'visual-review.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    stages[name]={capture:await ref(filename),review,automatedPassed:capture.automatedPassed,checks:capture.checks.length,failed:capture.checks.filter(check=>check.status!=='passed').length,screenshots:capture.screenshots};
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
const report={version:2,kind:'pet-regression-report',createdAt:new Date().toISOString(),completed:journal.completed,status:journal.status,stage:journal.stage,pageId:journal.pageId,editUrl:journal.editUrl,previewUrl:journal.previewUrl,finalHash:journal.documentHash,journal:await ref(path.join(current,'journal.json')),stages,performance:{scope:'Runtime counters include confirmed attempts and recovery. Historical v1 stopped before full acceptance; these are not equivalent completed runs and do not establish a speedup factor.',historical:{runtime:await ref(path.join(historical,'runtime.json')),elapsedMs:old.elapsedMs,requests:old.targetRequests},current:journal.metrics,media:{complete:ledger.assets.filter(asset=>asset.status==='complete').length,unresolved:ledger.assets.filter(asset=>asset.status!=='complete').map(asset=>({key:asset.key,status:asset.status})),uniqueSourceHashes:new Set(ledger.assets.map(asset=>asset.sha256)).size}},productScope:'Existing target WooCommerce vape products are used only for technical demonstration. They are not a pet catalog and receive no copied pet campaign claims.'};
report.program=await ref(path.join(job,'program.json'));report.componentPlan=await ref(path.join(job,program.componentPlan.path));report.blockManifest=blockManifest;
report.stageRecords=journal.stages;
report.requirements={count:plan.requirements.length,dispositions:plan.requirements.reduce((counts,item)=>({...counts,[item.disposition]:(counts[item.disposition]??0)+1}),{}),namedGaps:plan.gaps??[],adaptations:plan.requirements.filter(item=>item.disposition==='adapt').map(item=>({id:item.id,componentId:item.componentId,rule:item.rule,verification:item.verification}))};
report.performance.artifactSize={current:await bytesBelow(current),historical:await bytesBelow(historical)};
for(const[name,filename]of Object.entries({breakpoints:path.join(root,'reports/pet-v2-20261015/breakpoint-probes.json'),tests:path.join(root,'runs/v2-final-tests-20261015.log')})){try{report[name]=await ref(filename);}catch(error){if(error.code!=='ENOENT')throw error;}}
const directory=path.join(root,'reports/pet-v2-20261015');await fs.mkdir(directory,{recursive:true});
await fs.writeFile(path.join(directory,'regression.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({completed:report.completed,status:report.status,stage:report.stage,pageId:report.pageId,report:path.join(directory,'regression.json')}));
