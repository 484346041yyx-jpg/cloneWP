import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as cssTree from 'css-tree';
import {acquireLock,writeJson} from '../src/core/files.js';
import {readNative44CurrentState} from '../src/native44/current-state.js';
import {buildNative44PageCSS} from '../src/native44/css-handoff.js';
import {consolidateNative44CSS} from '../src/native44/consolidate-css.js';
import {fingerprintNative44Snapshot} from '../src/native44/compare.js';
import {documentHashV2} from '../src/replica-v2/journal.js';
const root='D:/cloneWP',run=root+'/runs/2026-10-17-pet-unified-draft',prior=run+'/amendments/20261017-block-refinement',dir=run+'/amendments/20261017-block-final',out=root+'/runs/2026-10-17-pet-block-final-review',job=root+'/references/reference-v2-2026-10-17T01-53-33-144Z-www-petsupermarket-com-0f207465';
const j=async(p:string)=>JSON.parse(await readFile(p,'utf8')),sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex'),unlock=await acquireLock(root);
try{
 await mkdir(dir,{recursive:true});if((await readdir(dir)).length)throw Error('Immutable final preparation already exists');await mkdir(out,{recursive:true});
 const state=await readNative44CurrentState(root,run);if(state?.pageId!==15734||state.documentHash!=='3d8a9086c89c73cbb4c41743b91bd23eb4624a07e889e9a0b43bcb6ca97aedd1')throw Error('Current owned draft changed');
 const before=await j(state.currentSnapshot.path),elements=structuredClone(before.elements),manifest=await j(run+'/compare-manifest.json'),rules:any[]=[];
 const nodes:any[]=[];const walk=(ns:any[])=>{for(const n of ns){nodes.push(n);walk(n.elements??[])}};walk(elements);
 const add=(moduleKey:string,selector:string,declarations:Record<string,string>,reason:string,packet='packet-16.json')=>rules.push({moduleKey,selector,declarations:Object.fromEntries(Object.entries(declarations).map(([k,v])=>[k,v+' !important'])),media:'(min-width:1025px)',reason,evidence:[job+'/reference/'+packet,job+'/source-facts.json']});
 const header=nodes.find(n=>n.id==='f3dc1ce');if(!header||header.widgetType!=='nested-carousel')throw Error('Original native header owner missing');
 header.settings.navigation_previous_icon={value:'eicon-chevron-left',library:'eicons'};header.settings.navigation_next_icon={value:'eicon-chevron-right',library:'eicons'};
 // Frozen source screenshot shows the visible compact chevrons. Its Slick SVG
 // controls are separate hidden nodes, so remove only this mistaken image skin.
 const ast=cssTree.parse(before.settings.custom_css);let removed=0;
 cssTree.walk(ast,{visit:'Rule',enter(node){if(!cssTree.generate(node.prelude).includes('cwp-n44-bb60012d40f0'))return;node.block.children.forEach((child,item,list)=>{if(child.type==='Declaration'&&['background-image','background-repeat','background-position','background-size'].includes(child.property)){list.remove(item);removed++;}})}});
 if(removed!==8)throw Error('Unexpected header asset rules: '+removed);
 add('header','.cwp-n44-07eaaad07993',{padding:'16px 40px',height:'76px',gap:'0','align-items':'flex-start','box-sizing':'border-box'},'Frozen source first-row content is44px inside16px top/bottom padding.');
 for(const [cl,w,mr]of[['304fc3dc2a89','calc(40% - 84.140625px)','0'],['ee9e18e85c22','calc(60% - 117.71875px)','28px'],['5a1efb9045d5','66.53125px','12px'],['7e6f0383c767','47.328125px','12px'],['fb9b13fc3dd3','36px','0']])add('header','.cwp-n44-'+cl,{width:w,flex:'0 0 '+w,'margin-right':mr,'box-sizing':'border-box'},'Two source desktop measurements: real unequal icon widths and search proportion.');
 add('header','.cwp-n44-304fc3dc2a89',{height:'44px','justify-content':'center'},'Source logo vertically centered in44px native header row.');
 add('header','.cwp-n44-ee9e18e85c22',{height:'42px','border-radius':'8px',border:'1px solid #b7b1ac','align-self':'flex-start','padding-left':'13px'},'Source search frame42px and8px corner; placeholder is visually scaled to14px.');
 add('header','.cwp-n44-bd285e7a3bdc .elementor-button',{'font-size':'14px','font-weight':'450','line-height':'17.5px','letter-spacing':'0.7px',color:'#6c757d','padding':'11.25px 0'},'Source16px/450/20px/.8px at scale.875; source current placeholder color observed through DOM.');
 for(const cl of ['5a1efb9045d5','7e6f0383c767','fb9b13fc3dd3'])add('header','.cwp-n44-'+cl,{height:'44px',padding:'0 6px',gap:'4px'},'Source native24px icon +4px gap +16px label, horizontal inset6px.');
 for(const [region,id]of[['halloween','13ae3d5'],['fall','fe68007']]){
  const n=nodes.find(n=>n.id===id);if(!n||n.widgetType!=='nested-carousel')throw Error('Missing native seasonal carousel');n.settings.image_spacing_custom={unit:'px',size:0,sizes:[]};
  const cls='.'+n.settings._css_classes;
  add(region,cls+' .e-n-carousel',{width:'calc(100% - 20px)','margin-left':'10px','margin-right':'10px'},'Source seasonal track has10px inner insets.',region==='halloween'?'packet-6.json':'packet-11.json');
  add(region,cls+' .e-n-carousel > .swiper-wrapper > .swiper-slide',{'padding-right':'16px','box-sizing':'border-box'},'Each source212px slide owns196px card and16px trailing gap; native slide layout retained.',region==='halloween'?'packet-6.json':'packet-11.json');
  add(region,'.wd-products .product-wrapper',{gap:'0'},'Source card image and metadata positions use explicit slots rather than an added12px native gap.',region==='halloween'?'packet-6.json':'packet-11.json');
  add(region,'.wd-products .wd-entities-title',{'margin-top':'59px','margin-bottom':'8px','min-height':'40px'},'Source reserves variant area before title:180px image +59px metadata spacing. Actual names remain full and can grow.',region==='halloween'?'packet-6.json':'packet-11.json');
 }
 // Source dots are12px with14px between circles; the left autoplay control
 // occupies34px. Preserve dot geometry without inventing a nonfunctional toggle.
 add('hero','.cwp-n44-28e2e914e29f .swiper-pagination',{display:'flex','justify-content':'center','align-items':'center',gap:'14px',width:'116px',height:'12px','min-height':'12px','line-height':'12px',left:'calc(50% + 17px)',bottom:'3px',top:'auto',transform:'translateX(-50%)'},'Source hero pagination measured116x12,3px above module bottom, offset17px for native capability gap.','packet-2.json');
 add('hero','.cwp-n44-28e2e914e29f .swiper-pagination-bullet',{margin:'0',background:'#e2ebf0',border:'1px solid #e1d5c9'},'Source actual12px circle fill and outline.','packet-2.json');
 add('hero','.cwp-n44-28e2e914e29f .swiper-pagination-bullet-active',{background:'#0047d2',border:'1px solid #0047d2'},'Source active blue dot.','packet-2.json');
 for(const cls of ['7e1a4956247b','f02fce91e779','03541d5cc738','4b9d75db5a9d']){
  add('footer','.cwp-n44-'+cls,{'margin-top':'0'},'Source first footer item starts85px below grid top.','packet-15.json');
  add('footer','.cwp-n44-'+cls+' .wd-list',{'row-gap':'0','margin-bottom':'16px'},'Source UL has8 native30px row slots plus16px bottom margin.','packet-15.json');
  add('footer','.cwp-n44-'+cls+' .wd-list > li',{height:'30px',flex:'0 0 30px','align-items':'flex-start'},'Source fixed30px item row preserves21px link line-height and visible last-item wrap.','packet-15.json');
 }
 add('footer','.cwp-n44-41d584d4aa10',{gap:'1.921875px'},'Source legal links separated by one measured space; copyright remains right aligned.','packet-15.json');
 const fragment=buildNative44PageCSS({pageId:15734,modules:manifest.modules,rules,canvasCss:'',replicationProfile:manifest.replicationProfile});
 const css=consolidateNative44CSS(cssTree.generate(ast)+'\n'+fragment.css,{modules:manifest.modules,elements}).css;
 const settings={...before.settings,custom_css:css},expected={...before,elements,settings,hash:documentHashV2(elements,settings)};
 await writeJson(dir+'/before.json',before);await writeJson(dir+'/expected.json',expected);await writeFile(dir+'/page-custom.css',css);await writeFile(out+'/page-custom.css',css);
 const map=await j(prior+'/static-style-map.json');await writeJson(dir+'/static-style-map.json',map);await writeJson(dir+'/rules.json',[...await j(prior+'/rules.json'),...rules]);
 await copyFile(root+'/runs/2026-10-17-pet-block-review/arrow-png-media-receipt.json',out+'/arrow-png-media-receipt.json');
 await writeJson(dir+'/request.json',{pageId:15734,runId:state.runId,instruction:'逐块比较新草稿与Pet Supermarket原站，除具体商品内容外直接修复布局字体间距轮播样式。',scope:'Current unpublished owned draft; source first-row widths, native product card insets and metadata spacing, hero dot geometry, footer fixed list rows and legal spacing.',knownGaps:['Visible autoplay toggle has no registered supported native control.','Enabled44 component set has no actual search input or dynamic header cart quantity component; existing header is presentation/link controls.','Source third-party chat/feedback services are outside owned draft component scope.']});
 await writeJson(dir+'/intent.json',{version:1,kind:'explicit-user-owned-draft-amendment',pageId:15734,runId:state.runId,beforeHash:before.hash,expectedHash:expected.hash,requestSha256:sha(await readFile(dir+'/request.json')),payloadSha256:expected.hash,cssSha256:sha(css),replacementIds:['f3dc1ce','13ae3d5','fe68007'],status:'prepared',createdAt:new Date().toISOString()});
 await writeJson(out+'/prepared-manifest.json',{...manifest,...fingerprintNative44Snapshot(expected)});await writeJson(out+'/repair-target.json',{run,dir,out,pageId:15734,runId:state.runId});
 console.log(JSON.stringify({status:'prepared',hash:expected.hash,rules:rules.length,bodyWrites:0}));
}finally{await unlock()}
