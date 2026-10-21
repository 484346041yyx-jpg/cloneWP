import { readFile, writeFile, statfs } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadConfig, redactor } from '../src/core/config.js';
import { WoodMartHeaderTransport } from '../src/woodmart-header/transport.js';
import { WordPressBackgroundRevision } from '../src/replica-full/background-revision/index.js';
import { WordPressHeaderModuleDriver } from '../src/woodmart-header/generic/wordpress.js';
import { loadFullReplicaHeaderHelper } from '../src/replica-full/native-helper.js';
import { canonicalHeaderJson, headerJsonHash } from '../src/woodmart-header/contract.js';
const dir = 'D:/cloneWP/references/hoshiichi-mobile-20261019';
const phase=process.argv[3]||'';if(phase&&!/^[a-z0-9-]{1,40}$/.test(phase))throw Error('invalid_phase');const suffix=phase?'-'+phase:'';
const prior = JSON.parse(await readFile('D:/cloneWP/references/hoshiichi-native-background-repair-20261019/revision-repeat/revision.json','utf8'));
const { config, credentials } = await loadConfig('D:/cloneWP');
const transport = new WoodMartHeaderTransport({targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password,timeoutMs:90000});
try {
  if (process.argv[2] === 'editor-align-diff') {
    const value=await transport.readPHP({name:'hoshiichi-mobile.editor-align-diff',trustedLocalCode:true,code:`$read=static function($id){$e=get_post_meta($id,'_elementor_data',true);return ['elements'=>is_string($e)?json_decode($e,true):$e,'settings'=>get_post_meta($id,'_elementor_page_settings',true)];};$a=$read(16038);$b=$read(16146);$out=[];$walk=function($x,$y,$p)use(&$walk,&$out){if(count($out)>=80)return;if(is_array($x)&&is_array($y)){foreach(array_unique(array_merge(array_keys($x),array_keys($y))) as $k){if(!array_key_exists($k,$x)||!array_key_exists($k,$y))$out[]=['path'=>$p.'.'.$k,'published'=>array_key_exists($k,$x)?$x[$k]:'MISSING','autosave'=>array_key_exists($k,$y)?$y[$k]:'MISSING'];else $walk($x[$k],$y[$k],$p.'.'.$k);if(count($out)>=80)break;}}elseif($x!==$y)$out[]=['path'=>$p,'published'=>$x,'autosave'=>$y];};$walk($a,$b,'document');return $out;`});await writeFile(dir+'/editor-align-diff'+suffix+'.json',JSON.stringify(value));console.log(JSON.stringify(value));
  } else if (process.argv[2] === 'editor-align-readback') {
    const value = await transport.readPHP({name:'hoshiichi-mobile.editor-align-readback',trustedLocalCode:true,code:`$ids=[16038];foreach(wp_get_post_revisions(16038,['posts_per_page'=>8]) as $r)if(wp_is_post_autosave($r))$ids[]=$r->ID;$normalize=function($v)use(&$normalize){if(!is_array($v))return $v;$list=array_keys($v)===range(0,count($v)-1);foreach($v as $k=>$x)$v[$k]=$normalize($x);if(!$list)ksort($v);return $v;};$out=[];foreach(array_unique($ids) as $id){$p=get_post($id);$s=get_post_meta($id,'_elementor_page_settings',true);$e=get_post_meta($id,'_elementor_data',true);if(is_string($e))$e=json_decode($e,true);$out[]=['id'=>$id,'parent'=>(int)$p->post_parent,'name'=>$p->post_name,'modified'=>$p->post_modified_gmt,'status'=>$p->post_status,'elementsHash'=>hash('sha256',wp_json_encode($normalize($e))),'settingsHash'=>hash('sha256',wp_json_encode($normalize($s))),'cssHash'=>hash('sha256',$s['custom_css']??'')];}return $out;`});
    await writeFile(dir+'/editor-align-readback'+suffix+'.json',JSON.stringify(value));console.log(JSON.stringify(value));
  } else if (process.argv[2] === 'editor-versions') {
    const value = await transport.readPHP({name:'hoshiichi-mobile.editor-versions',trustedLocalCode:true,code:`$ids=[16038];foreach(wp_get_post_revisions(16038,['posts_per_page'=>8]) as $r)$ids[]=$r->ID;$out=[];foreach(array_unique($ids) as $id){$p=get_post($id);$s=get_post_meta($id,'_elementor_page_settings',true);$els=get_post_meta($id,'_elementor_data',true);if(is_string($els))$els=json_decode($els,true);$product=null;$walk=function($ns)use(&$walk,&$product){foreach(($ns??[]) as $n){if(($n['id']??'')==='729b018')$product=array_intersect_key($n['settings'],array_flip(['slides_per_view_mobile','spacing_mobile','_margin_mobile']));if(!empty($n['elements']))$walk($n['elements']);}};$walk($els);$out[]=['id'=>$id,'name'=>$p->post_name,'modified'=>$p->post_modified_gmt,'cssHash'=>hash('sha256',$s['custom_css']??''),'cssLength'=>strlen($s['custom_css']??''),'product'=>$product];}return $out;`});
    await writeFile(dir+'/editor-versions'+suffix+'.json',JSON.stringify(value)); console.log(JSON.stringify(value));
  } else if (process.argv[2] === 'probe') {
    const value = await transport.readPHP({name:'hoshiichi-mobile.probe',trustedLocalCode:true,code:"return ['pageId'=>16038,'status'=>get_post_status(16038),'available'=>true];"});
    console.log(JSON.stringify(value));
  } else if (process.argv[2] === 'current') {
    const value = await new WordPressBackgroundRevision(transport).inspect(prior.identity);
    await writeFile(dir+'/current-read'+suffix+'.json',JSON.stringify(value));
    console.log(JSON.stringify({pageId:value.snapshot.page?.pageId,status:value.snapshot.page?.status,hash:value.snapshot.hash,readOnly:true}));
  } else if (process.argv[2] === 'reconcile-summary') {
    const intent=JSON.parse(await readFile(dir+'/mobile-intent'+suffix+'.json','utf8'));
    const data=canonicalHeaderJson({identity:intent.identity,operationId:intent.operationId});
    const value=await transport.readPHP({name:'hoshiichi-mobile.reconcile-summary',trustedLocalCode:true,code:`$i=json_decode(base64_decode('${Buffer.from(data).toString('base64')}'),true);$key='clonewp_mobile_amendment_'.hash('sha256',serialize($i['identity']).'|'.$i['operationId']);$s=get_post_meta(16038,'_elementor_page_settings',true);$els=get_post_meta(16038,'_elementor_data',true);if(is_string($els))$els=json_decode($els,true);$found=null;$walk=function($ns)use(&$walk,&$found){foreach($ns as $n){if($n['id']==='729b018')$found=$n['settings'];if(!empty($n['elements']))$walk($n['elements']);}};$walk($els);return ['pageId'=>16038,'status'=>get_post_status(16038),'receipt'=>get_option($key,null),'cssHash'=>hash('sha256',$s['custom_css']??''),'product'=>array_intersect_key($found??[],array_flip(['slides_per_view_mobile','spacing_mobile','_margin_mobile']))];`});
    await writeFile(dir+'/mobile-reconcile-summary'+suffix+'.json',JSON.stringify(value));console.log(JSON.stringify(value));
  } else if (['prepare','apply','inspect-amendment','confirm'].includes(process.argv[2])) {
    const action=process.argv[2], filename=dir+'/mobile-intent'+suffix+'.json';
    if(action==='prepare'){
      const patch=JSON.parse(await readFile(dir+'/mobile-patch'+suffix+'.json','utf8')),before=JSON.parse(await readFile(dir+'/current-before'+suffix+'.json','utf8'));
      const free=await statfs(dir);if(free.bavail*free.bsize<512*1024*1024)throw Error('insufficient_evidence_storage');
      const intent={operationId:'mobile-'+randomUUID(),identity:prior.identity,before:before.snapshot,patch,patchHash:headerJsonHash(patch),authorization:'User explicitly requested current page mobile amendment; preserve desktop and all unrelated records',recordedAt:new Date().toISOString()};
      await writeFile(filename,canonicalHeaderJson(intent),{flag:'wx'});console.log(JSON.stringify({prepared:true,operationId:intent.operationId,pageId:16038,remoteWrites:0}));
    }else{
      const saved=await readFile(filename,'utf8'),intent=JSON.parse(saved);if(headerJsonHash(intent.patch)!==intent.patchHash)throw Error('intent_patch_changed');
      const [header,full,helper]=await Promise.all([loadFullReplicaHeaderHelper(),readFile('D:/cloneWP/src/replica-full/wordpress-full.php','utf8'),readFile(dir+'/mobile-amendment.php','utf8')]);
      const data={identity:intent.identity,operationId:intent.operationId,before:intent.before,patch:intent.patch,patchHash:intent.patchHash,action:action==='inspect-amendment'?'inspect':action};
      const code=`$headerRead=static function($input){${header}\n};$fullRead=static function($input)use($headerRead){${full}\n};$input=json_decode(base64_decode('${Buffer.from(canonicalHeaderJson(data)).toString('base64')}'),true);${helper}`;
      if(action!=='inspect-amendment')await writeFile(dir+'/mobile-submit-'+action+suffix+'.json',JSON.stringify({operationId:intent.operationId,intentHash:headerJsonHash(intent),submittedAt:new Date().toISOString()}),{flag:'wx'});
      const result:any=action==='inspect-amendment'?await transport.readPHP({name:'hoshiichi-mobile.inspect',trustedLocalCode:true,code}):await transport.executePHP({name:'hoshiichi-mobile.'+action,trustedLocalCode:true,code,intent:{runId:intent.identity.owner.runId,operationId:intent.operationId,resource:'mobile-amendment/hoshiichi-16038',expectedSnapshotSha256:intent.before.hash,persistedIntentSha256:headerJsonHash(intent)}});
      await writeFile(dir+'/mobile-result-'+action+suffix+'.json',JSON.stringify(result));
      if(result.ok!==true)throw Error(result.code||'mobile_unconfirmed');
      console.log(JSON.stringify({pageId:result.snapshot?.page?.pageId,status:result.snapshot?.page?.status,receipt:result.receipt,hash:result.snapshot?.hash}));
    }
  } else if (process.argv[2] === 'media') {
    const value = await transport.readPHP({name:'hoshiichi-mobile.media',trustedLocalCode:true,code:`$urls=['https://primevapeoutlet.com/wp-content/uploads/2026/10/cta-bg.webp','https://primevapeoutlet.com/wp-content/uploads/2026/10/top-pc-1.webp','https://primevapeoutlet.com/wp-content/uploads/2026/10/artbottle.webp'];$out=[];foreach($urls as $url){$id=attachment_url_to_postid($url);if(!$id||!wp_attachment_is_image($id)||wp_get_attachment_url($id)!==$url)throw new RuntimeException('media_missing');$out[]=['id'=>$id,'url'=>$url,'parent'=>(int)get_post_field('post_parent',$id)];}return $out;`});
    await writeFile(dir+'/resolved-media.json',JSON.stringify(value));console.log(JSON.stringify(value));
  } else if (process.argv[2] === 'controls') {
    const controls = await transport.readPHP({name:'hoshiichi-mobile.controls',trustedLocalCode:true,code:`
    $plugin=\\Elementor\\Plugin::$instance;$reflection=new ReflectionProperty('Elementor\\Core\\Frontend\\Performance','is_frontend');$reflection->setAccessible(true);$old=$reflection->getValue();$reflection->setValue(null,false);$mode=$plugin->breakpoints->get_responsive_control_duplication_mode();$plugin->breakpoints->set_responsive_control_duplication_mode('on');$plugin->controls_manager->clear_stack_cache();
    try{$doc=$plugin->documents->get(16038,false);$types=[];$walk=function($nodes)use(&$walk,&$types){foreach($nodes as $n){$types[$n['widgetType']??'container']=true;if(!empty($n['elements']))$walk($n['elements']);}};$walk($doc->get_elements_data());$out=[];foreach(array_keys($types) as $type){$instance=$type==='container'?$plugin->elements_manager->create_element_instance(['id'=>'mobileprobe','elType'=>'container','settings'=>[],'elements'=>[]]):$plugin->widgets_manager->get_widget_types($type);if(!$instance)throw new RuntimeException('missing_widget');$stack=$instance->get_stack();$cs=array_merge($stack['controls']??[],$stack['style_controls']??[]);foreach($cs as $k=>$c)if(str_ends_with($k,'_mobile')||in_array($k,['background_background','background_image','background_position','background_size','background_repeat','background_overlay_background','background_overlay_color','background_overlay_color_b','background_overlay_opacity']))$out[$type][$k]=$c;}return ['controls'=>$out,'theme'=>wp_get_theme(get_template())->get('Version')];}finally{$reflection->setValue(null,$old);$plugin->breakpoints->set_responsive_control_duplication_mode($mode);$plugin->controls_manager->clear_stack_cache();}`});
    await writeFile(dir+'/actual-mobile-controls.json',JSON.stringify(controls)); console.log(JSON.stringify({controlsSaved:true}));
  } else {
  const current = await new WordPressBackgroundRevision(transport).inspect(prior.identity);
  await writeFile(dir+'/current-before.json',JSON.stringify(current));
  const contract = await new WordPressHeaderModuleDriver(transport).inspect(prior.identity,{},16038);
  await writeFile(dir+'/header-contract.json',JSON.stringify(contract));
  console.log(JSON.stringify({pageId:current.snapshot.page?.pageId,status:current.snapshot.page?.status,headerId:prior.identity.headerId,hash:current.snapshot.hash,readOnly:true}));
  }
} catch(error) { console.error(redactor(credentials)(error)); process.exitCode=1; }
finally { await transport.close(); }

