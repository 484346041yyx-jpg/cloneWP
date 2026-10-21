import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {sha256,observationCountsV2,readObservationDirectoryV2} from '../src/replica-v2/observation.js';
import {buildSourceFactsV2} from '../src/replica-v2/source.js';

const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
function packet(id='desktop-fixture',name='desktop'):any{
  const width=name==='desktop'?320:390,height=name==='desktop'?240:844,rect={x:0,y:0,width,height},nodes:any={};
  for(const [key,tag,parentId,childIds]of [['outer','section',null,['heading']],['heading','h2','outer',[]]]as const)nodes[key]={id:key,tag,parentId,childIds:[...childIds],regionId:'region',selector:'#'+key,attributes:{},styleId:'style',layoutId:'layout',visible:true};
  return{version:2,kind:'observation-packet',snapshot:{id,url:'https://8.8.8.8/',title:'Actual public shop fixture',capturedAt:'2026-10-15T00:00:00.000Z',viewport:{name,width,height,clientWidth:width,scrollbarWidth:0,devicePixelRatio:1},pageHeight:height,screenshot:{path:'source.png',sha256:'0'.repeat(64),width,height}},nodes,regions:[{id:'region',nodeId:'outer',contentNodeId:'outer',role:'region',order:0,gapBefore:0}],texts:{title:{id:'title',nodeId:'heading',regionId:'region',kind:'heading',level:2,text:'Actual observed public source heading remains complete and independently captured.'}},styles:{style:{display:'block',color:'#333'}},layouts:{layout:{id:'layout',rect,contentRect:rect,padding:[0,0,0,0],margin:[0,0,0,0],gap:{row:0,column:0},display:'block',position:'static',maxWidth:'none',direction:'column',flowIndex:0}},resources:{},usages:{},interactions:{},gaps:[],commerceEvidence:{version:1,productUrls:[]}};
}
const inventory=(p:any)=>({version:2,kind:'scene-inventory',snapshotId:p.snapshot.id,sourceUrl:p.snapshot.url,capturedAt:p.snapshot.capturedAt,viewport:{name:p.snapshot.viewport.name,width:p.snapshot.viewport.width,height:p.snapshot.viewport.height},regions:[{id:'region',selector:'#outer'}],entries:{title:{id:'title',selector:'#heading',ownerRegionId:'region',kind:'text',label:p.texts.title.text,rect:p.layouts.layout.rect}},counts:{total:1,text:1,media:0,control:0,assigned:1,unassigned:0,vendorUtilities:0}});

test('offline append preserves desktop bytes, validates actual screenshot metadata and supports identical safe resume',async()=>{
  const base='D:/cloneWP/references';await mkdir(base,{recursive:true});const jobDir=await mkdtemp(path.join(base,'test-responsive-append-'));
  try{
    const ref=path.join(jobDir,'reference'),capture=path.join(jobDir,'mobile');await mkdir(ref);await mkdir(capture);
    const desktop=packet(),pixels=await sharp({create:{width:320,height:240,channels:3,background:'#abcdef'}}).png().toBuffer();desktop.snapshot.screenshot.sha256=sha256(pixels);await writeFile(path.join(ref,'source.png'),pixels);
    const packetBytes=json(desktop),sceneBytes=json(inventory(desktop));await writeFile(path.join(ref,'packet.json'),packetBytes);await writeFile(path.join(ref,'scene.json'),sceneBytes);
    const manifest={version:2,kind:'observation-manifest',sourceUrl:desktop.snapshot.url,provenance:{method:'user-opened-browser',observer:'cua_repl',browser:'iab'},packets:[{path:'packet.json',sha256:sha256(packetBytes),snapshotId:desktop.snapshot.id,regionIds:['region'],counts:observationCountsV2(desktop),dependencies:[]}],screenshots:[{path:'source.png',sha256:sha256(pixels),snapshotId:desktop.snapshot.id}],sceneInventories:[{path:'scene.json',sha256:sha256(sceneBytes),snapshotId:desktop.snapshot.id}]};
    await writeFile(path.join(ref,'observation-manifest.json'),json(manifest));const source=buildSourceFactsV2(await readObservationDirectoryV2(ref));await writeFile(path.join(jobDir,'source-facts.json'),json(source));await writeFile(path.join(jobDir,'asset-manifest.json'),json({version:2,assets:[]}));
    const mobile=packet('mobile-fixture','mobile'),transport={version:2,kind:'observation-transport',chunks:[{snapshotId:mobile.snapshot.id,regionIds:['region'],json:JSON.stringify(mobile)}]};
    await writeFile(path.join(capture,'packet-1.json'),json([JSON.stringify(transport)]));await writeFile(path.join(capture,'source.jpg'),await sharp({create:{width:390,height:844,channels:3,background:'#ffeedd'}}).png().toBuffer());await writeFile(path.join(capture,'scene-inventory.json'),json(inventory(mobile)));await writeFile(path.join(capture,'capture-meta.json'),json({snapshotId:mobile.snapshot.id,viewportName:'mobile',packetFiles:['packet-1.json'],screenshotFile:'source.jpg',sceneInventoryFile:'scene-inventory.json'}));
    const protectedFiles=[path.join(ref,'observation-manifest.json'),path.join(jobDir,'source-facts.json'),path.join(jobDir,'asset-manifest.json')],before=await Promise.all(protectedFiles.map(file=>readFile(file)));
    const{appendPetResponsiveV2}=await import(pathToFileURL('D:/cloneWP/tools/append-pet-v2-responsive.mjs').href),result=await appendPetResponsiveV2({jobDir,captureDirectories:[capture]});assert.equal(result.remoteRequests,0);assert.equal(result.targetWrites,0);assert.equal(result.snapshots[0].screenshot.width,390);assert.ok(result.snapshots[0].screenshot.path.endsWith('.png'));assert.equal(result.addedAssets,0);
    const revised=JSON.parse(await readFile(path.join(jobDir,result.sourceFactsFile),'utf8'));for(const[id,fact]of Object.entries(source.facts))assert.deepEqual(revised.facts[id],fact);for(let index=0;index<protectedFiles.length;index++)assert.ok((await readFile(protectedFiles[index])).equals(before[index]));
    assert.deepEqual(await appendPetResponsiveV2({jobDir,captureDirectories:[capture]}),result);
    mobile.texts.title.text='A changed capture cannot overwrite previously frozen responsive evidence.';transport.chunks[0].json=JSON.stringify(mobile);await writeFile(path.join(capture,'packet-1.json'),json([JSON.stringify(transport)]));await assert.rejects(appendPetResponsiveV2({jobDir,captureDirectories:[capture]}),/Immutable responsive output/);
  }finally{assert.ok(path.resolve(jobDir).startsWith(path.resolve(base)+path.sep));await rm(jobDir,{recursive:true,force:true});}
});
