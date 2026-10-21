import {readFile,writeFile,statfs} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {loadConfig,redactor} from '../src/core/config.js';
import {acquireLock} from '../src/core/files.js';
import {WordPressClient} from '../src/wordpress/client.js';
import {NovamiraTransport} from '../src/wordpress/mcp.js';
import {NATIVE44_ALL_TYPES} from '../src/native44/catalog.js';
const root='D:/cloneWP',run=root+'/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c',dir=process.argv[2]??run+'/amendments/20261017-products-and-css';
if(!path.resolve(dir).startsWith(path.resolve(run,'amendments')+path.sep))throw Error('Amendment directory escaped the current owned run');
const json=async(f:string)=>JSON.parse(await readFile(f,'utf8'));
const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])):v;
const canonical=(v:any)=>JSON.stringify(sort(v));const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const php=(v:any)=>`json_decode(base64_decode('${Buffer.from(JSON.stringify(v)).toString('base64')}'),true)`;
const intent=await json(dir+'/intent.json'),expected=await json(dir+'/expected.json'),before=await json(dir+'/before.json'),request=await readFile(dir+'/request.json');
if(intent.pageId!==15621||intent.beforeHash!==before.hash||intent.expectedHash!==expected.hash||intent.requestSha256!==hash(request)||intent.payloadSha256!==hash(canonical({elements:expected.elements,settings:expected.settings})))throw Error('Immutable amendment intent differs from payload');
const free=await statfs(root);if(Number(free.bavail)*Number(free.bsize)<512*1024*1024)throw Error('Insufficient evidence space');
const loaded=await loadConfig(root),origin=new URL(loaded.config.targetUrl).origin;
const client=new WordPressClient({targetUrl:origin,username:loaded.credentials.wp_user,applicationPassword:loaded.credentials.wp_app_password,executionStrategy:'native44-css-handoff',allowedWidgetTypes:NATIVE44_ALL_TYPES});
const authorization='Basic '+Buffer.from(loaded.credentials.wp_user+':'+loaded.credentials.wp_app_password).toString('base64');
const fetcher:typeof fetch=async(input,init={})=>{const url=new URL(input instanceof Request?input.url:input.toString());if(url.origin!==origin)throw Error('Cross-origin credential request rejected');const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers).forEach((v,k)=>headers.set(k,v));headers.set('Authorization',authorization);const response=await fetch(input,{...init,headers,redirect:'manual',signal:AbortSignal.timeout(45000)});if(response.status>=300&&response.status<400)throw Error('Redirect rejected');return response;};
const transport=new NovamiraTransport(new URL('/wp-json/mcp/novamira',origin),fetcher),unlock=await acquireLock(root);
let attempted=false;
try{
 const {snapshot}=await client.readOwnedReviewCheckpoint(15621,intent.runId,['container','heading','text-editor','button','wd_list','wd_image_or_svg','image-box','divider','nested-carousel','wd_products']);
 if(snapshot.hash===intent.expectedHash){await writeFile(dir+'/receipt.json',JSON.stringify({status:'confirmed',reconciled:true,pageId:15621,hash:snapshot.hash,observedAt:new Date().toISOString()},null,2));console.log('Amendment already confirmed; no repeated write.');process.exitCode=0;}
 else{
  if(snapshot.hash!==intent.beforeHash)throw Error('Current owned draft differs from both before and expected; no write');
  if(!['prepared','retryable'].includes(intent.status))throw Error('Previous amendment may have been sent; reconcile before any retry');
  const info=await transport.info('novamira/execute-php');if(!info.input_schema)throw Error('Registered native execution schema unavailable');
  const guard=`$id=15621;$run=${php(intent.runId)};if(get_post_type($id)!=='page'||get_post_status($id)!=='draft'||get_post_meta($id,'_clonewp_run_id',true)!==$run||!current_user_can('edit_post',$id)){throw new RuntimeException('owned_draft_guard');}$matches=get_posts(['post_type'=>'page','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($matches)!==1||(int)$matches[0]!==$id){throw new RuntimeException('ambiguous_owned_draft');}require_once ABSPATH.'wp-admin/includes/post.php';if(wp_check_post_lock($id)){throw new RuntimeException('another_user_editing');}$doc=\\Elementor\\Plugin::$instance->documents->get($id);if(!$doc||!$doc->is_built_with_elementor()){throw new RuntimeException('document_missing');}`;
  const normalize=`$normalize=function($v)use(&$normalize){if(!is_array($v)){return $v;}$keys=array_keys($v);if($keys!==range(0,count($v)-1)){ksort($v,SORT_STRING);}foreach($v as $k=>$x){$v[$k]=$normalize($x);}return $v;};`;
  const optimistic=`$expectedBefore=${php({elements:before.elements,settings:before.settings})};$actual=['elements'=>$doc->get_elements_data(),'settings'=>$doc->get_settings()];if(json_encode($normalize($actual))!==json_encode($normalize($expectedBefore))){throw new RuntimeException('concurrent_document_change');}`;
  const code=guard+normalize+optimistic+`$input=${php({elements:expected.elements,settings:expected.settings})};$ok=$doc->save($input);if(!$ok){throw new RuntimeException('document_save_failed');}return ['saved'=>true,'pageId'=>$id,'status'=>get_post_status($id)];`;
  await writeFile(dir+'/intent.json',JSON.stringify({...intent,status:'intent',attemptedAt:new Date().toISOString()},null,2));
  attempted=true;
  const response:any=await transport.execute('novamira/execute-php',{code});
  if(response.success!==true||response.return_value?.saved!==true)throw Error('Native save response unconfirmed');
  const after=await client.snapshotDraft(15621);await writeFile(dir+'/after.json',JSON.stringify(after,null,2));
  if(after.hash!==intent.expectedHash)throw Error('Native readback differs from exact expected document; preserve actual response for reconciliation');
  await writeFile(dir+'/receipt.json',JSON.stringify({version:1,status:'confirmed',pageId:15621,runId:intent.runId,beforeHash:intent.beforeHash,afterHash:after.hash,bodySubtreesReplaced:intent.replacementIds.length,productWidgets:24,cssApplied:true,observedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({status:'confirmed',pageId:15621,productWidgets:24,cssApplied:true,hash:after.hash}));
 }
}catch(e){
 if(attempted){try{const current=await client.snapshotDraft(15621);await writeFile(dir+'/reconciliation.json',JSON.stringify(current,null,2));await writeFile(dir+'/receipt.json',JSON.stringify({status:current.hash===intent.expectedHash?'confirmed':current.hash===intent.beforeHash?'retryable':'conflict',hash:current.hash,pageId:15621,observedAt:new Date().toISOString()},null,2));}catch{await writeFile(dir+'/receipt.json',JSON.stringify({status:'write-unknown',pageId:15621},null,2));}}
 console.error(redactor(loaded.credentials)(e));process.exitCode=1;
}finally{await transport.close();await client.close();await unlock();}
