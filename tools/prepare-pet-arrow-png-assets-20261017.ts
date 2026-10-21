import { readFile,writeFile,mkdir,statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { loadConfig,redactor } from '../src/core/config.js';
import { acquireLock,writeJson } from '../src/core/files.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { NovamiraTransport } from '../src/wordpress/mcp.js';
import { NATIVE44_ALL_TYPES } from '../src/native44/catalog.js';
import { readNative44CurrentState } from '../src/native44/current-state.js';
const root='D:/cloneWP',run=root+'/runs/2026-10-17-pet-unified-draft',out=root+'/runs/2026-10-17-pet-block-review',assetDir=out+'/source-assets';
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8')),sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const state=await readNative44CurrentState(root,run);if(state?.pageId!==15734||state.documentHash!=='7071a8e2f83dfe7c6a862b7486b58d3f000262abc50bb47a0e876856369f53b0')throw Error('Arrow assets require exact current draft');
const observed=await json(assetDir+'/manifest.json'),free=await statfs(root);if(Number(free.bavail)*Number(free.bsize)<512*1024*1024)throw Error('Insufficient evidence space');
const loaded=await loadConfig(root),origin=new URL(loaded.config.targetUrl).origin,token='Basic '+Buffer.from(loaded.credentials.wp_user+':'+loaded.credentials.wp_app_password).toString('base64');
const fetcher:typeof fetch=async(input,init={})=>{if(new URL(input instanceof Request?input.url:input.toString()).origin!==origin)throw Error('Different origin');const headers=new Headers(init.headers);headers.set('Authorization',token);return fetch(input,{...init,headers,redirect:'error',signal:AbortSignal.timeout(45000)});};
const transport=new NovamiraTransport(new URL('/wp-json/mcp/novamira',origin),fetcher),client=new WordPressClient({targetUrl:origin,username:loaded.credentials.wp_user,applicationPassword:loaded.credentials.wp_app_password,executionStrategy:'native44-css-handoff',allowedWidgetTypes:NATIVE44_ALL_TYPES}),unlock=await acquireLock(root);
try{
 const {snapshot}=await client.readOwnedReviewCheckpoint(15734,state.runId,(await json(run+'/compare-manifest.json')).widgetTypes);if(snapshot.hash!==state.documentHash)throw Error('Draft changed before arrow media preparation');
 const mime:any=await transport.execute('novamira/execute-php',{code:"return ['svgAllowed'=>in_array('image/svg+xml',get_allowed_mime_types(),true)];"});if(mime.success!==true||typeof mime.return_value?.svgAllowed!=='boolean')throw Error('Upload mime read unavailable');
 const svgAllowed=false /* Native upload sanitizer changed SVG bytes; preserve reconciled SVG and use verified PNG conversion. */,assets:any[]=[];
 await writeJson(out+'/arrow-png-media-intent.json',{version:1,pageId:15734,runId:state.runId,documentHash:snapshot.hash,scope:'Observed original carousel arrow assets only; new media owned by current draft.',svgAllowed,status:'prepared'});
 for(const name of ['arrow-left.svg','arrow-right.svg','ps-arrowRightWithBg.svg']){
  const source=observed.assets.find((a:any)=>a.name===name);if(!source||source.contentType!=='image/svg+xml'||new URL(source.url).origin!=='https://www.petsupermarket.com')throw Error('Unobserved arrow');
  const original=await readFile(assetDir+'/'+name);if(/<script|foreignObject|onload=|<image|href=/i.test(original.toString('utf8')))throw Error('Unexpected active SVG asset');
  const filename=svgAllowed?name:name.replace('.svg','.png'),file=assetDir+'/'+filename;
  if(!svgAllowed)await sharp(original).png().toFile(file);
  const bytes=await readFile(file),options={pageId:15734,runId:state.runId,sourceUrl:source.url,mimeType:svgAllowed?'image/svg+xml':'image/png',verifiedSha256:sha(bytes),originalSha256:sha(original),alt:source.name,onCheckpoint:async(checkpoint:any)=>writeJson(out+'/arrow-png-'+name+'-checkpoint.json',{...checkpoint,pageId:15734,runId:state.runId,sha256:sha(bytes)})};
  const imported=await client.importAsset(file,options);assets.push({name,sourceUrl:source.url,originalSha256:sha(original),localPath:file,...imported});await writeJson(out+'/arrow-png-media-receipt.json',{version:1,pageId:15734,runId:state.runId,svgAllowed,assets,status:assets.length===3?'confirmed':'in-progress'});
 }
 console.log(JSON.stringify({status:'arrow-assets-ready',svgAllowed,assets:assets.map(a=>({name:a.name,attachmentId:a.attachmentId,mimeType:a.mimeType}))}));
}catch(e){console.error(redactor(loaded.credentials)(e));process.exitCode=1;}finally{await transport.close();await client.close();await unlock();}
