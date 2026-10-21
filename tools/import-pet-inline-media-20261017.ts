import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareLocalTask} from '../src/native44/local-task.js';
import {readNative44ReleaseLock} from '../src/native44/release-lock.js';
import {loadConfig,redactor} from '../src/core/config.js';
import {acquireLock} from '../src/core/files.js';
import {WordPressClient} from '../src/wordpress/client.js';
import {NATIVE44_ALL_TYPES} from '../src/native44/catalog.js';
import {importNative44Media} from '../src/native44/media.js';
import {referencedNative44Assets} from '../src/native44/compiler.js';
import {usedNative44WidgetTypes} from '../src/native44/compiler.js';
import {discoverNative44Contracts} from '../src/native44/target-context.js';
import {assertSafeSVGBytesV2} from '../src/replica-v2/runtime.js';
const root='D:/cloneWP',dir=root+'/references/reference-v2-2026-10-17T01-53-33-144Z-www-petsupermarket-com-0f207465',runDir=root+'/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const input=await prepareLocalTask(dir+'/program.json',root);
const journal=JSON.parse(await readFile(runDir+'/journal.json','utf8'));
await readNative44ReleaseLock(root,journal.releaseLock,{taskId:input.program.taskId,program:{filename:input.filename,sha256:input.programHash,program:input.program}});
if(journal.programHash!==input.programHash||journal.pageId!==15621||journal.mutations.length)throw Error('Only this owned pre-body draft may resume its media preparation');
const manifest=[];const provenance=[];
for(const asset of input.manifest.assets){if(!asset.sourceUrl.startsWith('inline-svg:')){manifest.push(asset);continue;}
 const originalFile=(asset as typeof asset&{originalSourcePath?:string}).originalSourcePath;
 if(!originalFile||!asset.originalSha256)throw Error('Inline source requires its actual original SVG provenance');
 const original=await readFile(path.resolve(dir,originalFile));if(hash(original)!==asset.originalSha256)throw Error('Original SVG changed');assertSafeSVGBytesV2(original);
 manifest.push({...asset,sourceUrl:'data:image/svg+xml;base64,'+original.toString('base64')});
 provenance.push({key:asset.key,observedResourceUrl:asset.sourceUrl,transport:'data:image/svg+xml;base64',original:{path:originalFile,sha256:asset.originalSha256},convertedSha256:asset.sha256,storedIdentity:'urn:clonewp:sha256:'+asset.sha256});
}
await writeFile(runDir+'/assets/inline-source-transport.json',JSON.stringify({kind:'verified-inline-source-transport',taskId:input.program.taskId,runId:journal.runId,immutableManifest:input.program.assetsManifest,assets:provenance},null,2)+'\n');
const loaded=await loadConfig(root),unlock=await acquireLock(root);
const client=new WordPressClient({targetUrl:loaded.config.targetUrl,username:loaded.credentials.wp_user,applicationPassword:loaded.credentials.wp_app_password,executionStrategy:'native44-css-handoff',allowedWidgetTypes:NATIVE44_ALL_TYPES});
try{await discoverNative44Contracts(client,usedNative44WidgetTypes(input.program));await client.createDraft(journal.runId,input.program.title,{requireExistingPageId:journal.pageId});const snapshot=await client.snapshotDraft(journal.pageId);if(snapshot.status!=='draft'||snapshot.elements.length)throw Error('Owned draft already contains body content; preserve it');const result=await importNative44Media({client,root,runDir,jobDir:dir,runId:journal.runId,pageId:journal.pageId,manifest,required:[...referencedNative44Assets(input.program)]});console.log(JSON.stringify({status:'complete-media-preparation',pageId:journal.pageId,assets:result.length,bodyWrites:0}));}
catch(error){const e=error as Error&{code?:string;status?:number};console.error(JSON.stringify({message:redactor(loaded.credentials)(e),code:e.code,status:e.status,metrics:client.diagnostics()}));process.exitCode=1;}
finally{await client.close();await unlock();}
