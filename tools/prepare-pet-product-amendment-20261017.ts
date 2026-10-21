import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {loadConfig,redactor} from '../src/core/config.js';
import {WordPressClient} from '../src/wordpress/client.js';
import {NATIVE44_ALL_TYPES} from '../src/native44/catalog.js';
import {discoverNative44Contracts} from '../src/native44/target-context.js';
import {loadNative44Knowledge} from '../src/native44/knowledge.js';
const root='D:/cloneWP',run=root+'/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c',dir=run+'/amendments/20261017-products-and-css';
await mkdir(dir,{recursive:true});
const manifest=JSON.parse(await readFile(run+'/compare-manifest.json','utf8'));
await writeFile(dir+'/request.json',JSON.stringify({version:1,kind:'explicit-user-draft-amendment',pageId:15621,runId:manifest.runId,baseDocumentHash:manifest.documentHash,requestedAt:new Date().toISOString(),userInstruction:'你直接把 CSS 应用到这个草稿里，再做视觉复核，商品区也要管，一样的，我说的是一样的用组件，但是具体里面的商品不用管',scope:['apply-page-css','replace-two-product-placeholders-with-native-product-carousels','read-only-visual-review','use-existing-target-products-for-component-verification'],preserve:['original-program','original-release-lock','existing-page-id','existing-media','all-other-page-content'],forbid:['publish','product-write','global-theme-or-plugin-write']},null,2));
const loaded=await loadConfig(root);
const client=new WordPressClient({targetUrl:loaded.config.targetUrl,username:loaded.credentials.wp_user,applicationPassword:loaded.credentials.wp_app_password,executionStrategy:'native44-css-handoff',allowedWidgetTypes:NATIVE44_ALL_TYPES});
try{
 const types=[...new Set([...manifest.widgetTypes,'wd_products'])];
 const caps=await discoverNative44Contracts(client,types);
 const {snapshot}=await client.readOwnedReviewCheckpoint(15621,manifest.runId,manifest.widgetTypes);
 if(snapshot.hash!==manifest.documentHash)throw Error('Current document differs from handed-off draft; preserve user changes');
 const catalog=await client.readTargetCatalog(30);
 const querySource=await client.readNativeProductQuerySourceProof();
 const knowledge=await loadNative44Knowledge(['wd_products']);
 await writeFile(dir+'/before.json',JSON.stringify(snapshot,null,2));
 await writeFile(dir+'/capabilities.json',JSON.stringify(caps,null,2));
 await writeFile(dir+'/target-catalog.json',JSON.stringify(catalog,null,2));
 await writeFile(dir+'/product-query-source.json',JSON.stringify(querySource,null,2));
 const local=knowledge.components.wd_products;
 await writeFile(dir+'/product-contract-summary.json',JSON.stringify({local:Object.fromEntries(local.controls.filter(c=>/layout|slide|carousel|pag|nav|arrow|columns|gap|border|product|design|img|height|per_page|order|include|post_type/.test(c.id)).map(c=>[c.id,{type:c.type,default:c.defaultValue,domain:c.valueDomain,condition:c.condition}])),live:Object.fromEntries(Object.entries(caps.legacySchemas.wd_products.controls).filter(([k])=>/layout|slide|carousel|pag|nav|arrow|columns|gap|border|product|design|img|height|per_page|order|include|post_type/.test(k)))},null,2));
 console.log(JSON.stringify({status:'read-only-product-context-ready',products:catalog.products?.length??catalog.length,snapshotHash:snapshot.hash,remoteWrites:0}));
}catch(e){console.error(redactor(loaded.credentials)(e));process.exitCode=1;}finally{await client.close();}
