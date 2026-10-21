import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {acquireLock,writeJson} from '../src/core/files.js';
import {readNative44CurrentState} from '../src/native44/current-state.js';
import {buildNative44PageCSS} from '../src/native44/css-handoff.js';
import {consolidateNative44CSS} from '../src/native44/consolidate-css.js';
import {fingerprintNative44Snapshot} from '../src/native44/compare.js';
import {documentHashV2} from '../src/replica-v2/journal.js';
const root='D:/cloneWP',run=root+'/runs/2026-10-17-pet-unified-draft',prior=run+'/amendments/20261017-block-final',dir=run+'/amendments/20261017-pixel-finish',out=root+'/runs/2026-10-17-pet-pixel-final-review',job=root+'/references/reference-v2-2026-10-17T01-53-33-144Z-www-petsupermarket-com-0f207465';
const j=async(p:string)=>JSON.parse(await readFile(p,'utf8')),sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex'),unlock=await acquireLock(root);
try{
 await mkdir(dir,{recursive:true});if((await readdir(dir)).length)throw Error('Immutable final preparation already exists');await mkdir(out,{recursive:true});
 const state=await readNative44CurrentState(root,run);if(state?.pageId!==15734||state.documentHash!=='6559e7aaad5523850a103524fdbdbf5118887e786e6850145df46be3814d4101')throw Error('Current owned draft changed');
 const before=await j(state.currentSnapshot.path),manifest=await j(run+'/compare-manifest.json'),rules:any[]=[];
 const add=(moduleKey:string,selector:string,declarations:Record<string,string>,reason:string,packet:string)=>rules.push({moduleKey,selector,declarations:Object.fromEntries(Object.entries(declarations).map(([k,v])=>[k,v+' !important'])),media:'(min-width:1025px)',reason,evidence:[job+'/reference/'+packet]});
 add('header','.cwp-n44-ee9e18e85c22',{'min-height':'42px'},'Readback identified legacy43px min-height overriding the correct42px source frame.','packet-16.json');
 add('header','.cwp-n44-183442b5bd25 img',{display:'block',width:'137px',height:'37px','object-fit':'contain'},'Frozen source logo is137x37 centered in44px row.','packet-16.json');
 for(const cl of ['bb4255ef8e7f','ed40a9a3df3c','abdc2bf24cf0'])add('header','.cwp-n44-'+cl+' .wd-image img',{display:'block'},'Remove inline-image baseline space so the real24px image +4px gap aligns source labels.','packet-16.json');
 for(const side of ['prev','next'])add('hero','.cwp-n44-28e2e914e29f .elementor-swiper-button-'+side,{top:'calc(50% - 13px)'},'Source arrow center belongs to225px banner, excluding26px pagination; native transform remains.','packet-2.json');
 const fragment=buildNative44PageCSS({pageId:15734,modules:manifest.modules,rules,canvasCss:'',replicationProfile:manifest.replicationProfile});
 const css=consolidateNative44CSS(before.settings.custom_css+'\n'+fragment.css,{modules:manifest.modules,elements:before.elements}).css,settings={...before.settings,custom_css:css},expected={...before,settings,hash:documentHashV2(before.elements,settings)};
 await writeJson(dir+'/before.json',before);await writeJson(dir+'/expected.json',expected);await writeFile(dir+'/page-custom.css',css);await writeFile(out+'/page-custom.css',css);await copyFile(prior+'/static-style-map.json',dir+'/static-style-map.json');await writeJson(dir+'/rules.json',[...await j(prior+'/rules.json'),...rules]);await copyFile(root+'/runs/2026-10-17-pet-block-review/arrow-png-media-receipt.json',out+'/arrow-png-media-receipt.json');
 const request={...await j(prior+'/request.json'),scope:'Final actual readback: remove1px search min-height conflict, image baseline offsets and2px hero arrow center error. Full page CSS remains consolidated.'};await writeJson(dir+'/request.json',request);
 await writeJson(dir+'/intent.json',{version:1,kind:'explicit-user-owned-draft-amendment',pageId:15734,runId:state.runId,beforeHash:before.hash,expectedHash:expected.hash,requestSha256:sha(await readFile(dir+'/request.json')),payloadSha256:expected.hash,cssSha256:sha(css),replacementIds:[],status:'prepared',createdAt:new Date().toISOString()});await writeJson(out+'/prepared-manifest.json',{...manifest,...fingerprintNative44Snapshot(expected)});await writeJson(out+'/repair-target.json',{run,dir,out,pageId:15734,runId:state.runId});console.log(JSON.stringify({status:'prepared',hash:expected.hash,rules:rules.length,bodyWrites:0}));
}finally{await unlock()}
