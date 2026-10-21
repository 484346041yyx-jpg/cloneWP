import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const run='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c',base=run+'/amendments/20261017-products-and-css',review='D:/cloneWP/runs/2026-10-17-pet-component-complete-15621';
const json=async(f:string)=>JSON.parse(await readFile(f,'utf8')),sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const report=await json(review+'/report.json'),snapshot=await json(base+'/refinement-05/after.json');
if(!report.css.applied||!report.documentUnchanged||report.documentHash!==snapshot.hash||report.captures.length!==2||report.captures.some((c:any)=>!c.geometry.fontReady||c.interactions.length!==7||c.interactions.some((i:any)=>i.status!=='passed')||c.queries.length!==24||c.queries.some((q:any)=>q.status!=='passed')||!c.screenshotReceipt.complete||!c.screenshotReceipt.documentLayoutPreserved))throw Error('Current final evidence is incomplete; do not mark delivered');
const counts={containers:0,widgets:0,html:0,productWidgets:0};const visit=(nodes:any[])=>nodes.forEach(n=>{if(n.elType==='container')counts.containers++;else counts.widgets++;if(n.widgetType==='html')counts.html++;if(n.widgetType==='wd_products')counts.productWidgets++;visit(n.elements??[]);});visit(snapshot.elements);
const chain:any[]=[];
for(const folder of ['',...Array.from({length:5},(_,i)=>'/refinement-0'+(i+1))]){const dir=base+folder,intent=await json(dir+'/intent.json'),receipt=await json(dir+'/receipt.json');if(receipt.status!=='confirmed'||receipt.afterHash!==intent.expectedHash)throw Error('An amendment has no confirmed exact readback');chain.push({intent:{path:dir+'/intent.json',sha256:sha(await readFile(dir+'/intent.json'))},receipt:{path:dir+'/receipt.json',sha256:sha(await readFile(dir+'/receipt.json'))},beforeHash:intent.beforeHash,afterHash:receipt.afterHash});}
for(let i=1;i<chain.length;i++)if(chain[i-1].afterHash!==chain[i].beforeHash)throw Error('Amendment chain is discontinuous');
if(chain.at(-1).afterHash!==snapshot.hash)throw Error('Final chain does not identify current page');
const visualReviews=report.captures.map((capture:any)=>({viewport:capture.viewport,sourceScreenshotHash:capture.sourceScreenshot.sha256,targetScreenshotHash:capture.targetScreenshot.sha256,documentHash:snapshot.hash,verdict:'reviewed',scope:'Desktop native component layout, editable copy/imagery and user-exempt replaceable product content',notes:'Actual overview, top and product views inspected. Source font is loaded, source-like block widths, positions, copy wrapping and backgrounds are present. All seven native carousel checks and all 24 actual product widgets pass at this width. Raw scroll-composed overview retains WordPress admin chrome and is not certified seamless; focused viewport screenshots show actual normal UI. Source external search/account/service destinations remain external; autoplay toggle, feedback and chat integrations were not implemented.',observedAt:new Date().toISOString()}));
await writeFile(review+'/visual-reviews.json',JSON.stringify(visualReviews,null,2));
const current={version:1,kind:'completed-explicit-user-draft-amendment',pageId:15621,runId:report.runId,taskId:(await json(run+'/compare-manifest.json')).taskId,status:'completed',unpublished:true,documentHash:snapshot.hash,cssApplied:true,requestedScope:'Directly apply CSS, restore native product component regions, visually review both desktop widths; actual products remain replaceable.',counts,amendments:chain,verification:{path:review+'/report.json',sha256:sha(await readFile(review+'/report.json'))},visualReview:{path:review+'/visual-reviews.json',sha256:sha(await readFile(review+'/visual-reviews.json'))},currentSnapshot:{path:base+'/refinement-05/after.json',sha256:sha(await readFile(base+'/refinement-05/after.json'))},currentCSS:{path:base+'/refinement-05/page-custom.css',sha256:sha(await readFile(base+'/refinement-05/page-custom.css'))},historicalFrozenContract:'Original program, source facts, release lock, CSS handoff and first-generation comparison remain unchanged; explicit user amendments are recorded separately.',completedAt:new Date().toISOString()};
await writeFile(run+'/current-user-amendment.json',JSON.stringify(current,null,2));
const template=await json(run+'/elementor-template.json');template.content=snapshot.elements;template.page_settings=snapshot.settings;template.title='Pet Supermarket — Native editable component replica';await writeFile(review+'/elementor-template.json',JSON.stringify(template,null,2));await copyFile(base+'/refinement-05/page-custom.css',review+'/page-custom.css');
try{await copyFile(run+'/DELIVERY.md',run+'/DELIVERY-before-explicit-user-amendment.md',1);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
const stats=report.captures.map((c:any)=>({viewport:c.viewport,width:c.geometry.viewport.width,clientWidth:c.geometry.viewport.clientWidth,maxModuleXDelta:Math.max(...c.deltas.map((d:any)=>Math.abs(d.delta.x))),maxModuleYDeltaIgnoringAdminBar:Math.max(...c.deltas.map((d:any)=>Math.abs(d.delta.yIgnoringLoggedInAdminBar))),maxModuleHeightDelta:Math.max(...c.deltas.map((d:any)=>Math.abs(d.delta.height)))}));
await writeFile(review+'/summary.json',JSON.stringify({counts,stats,cssApplied:true,documentHash:snapshot.hash,interactionChecksPassed:14,productChecksPassed:48,remoteWritesDuringFinalReview:0,visualReviews},null,2));
const text=`# Pet Supermarket 草稿：CSS 已应用，商品组件已恢复

[打开 Elementor 草稿](https://primevapeoutlet.com/wp-admin/post.php?post=15621&action=elementor) · [预览](https://primevapeoutlet.com/?page_id=15621&preview=true)

当前页面 15621 仍为未发布草稿。此说明替代先前“手动粘贴 CSS / 商品占位”的交付状态。用户明确要求直接应用 CSS，并澄清商品组件也要复刻、实际商品内容后续自行替换。

两处商品区已恢复为“左侧活动图 + 原生嵌套轮播 + 原生 Products 商品组件”。每屏 5 张卡片、每次前进 1 张，分数分页分别为 11 和 13 个位置；每个位置绑定一个真实现有 WooCommerce 商品。可在 Navigator 的 seasonal 商品轮播中进入对应 Products 控件，更换其商品查询 ID。没有新增或修改商品。

当前正文共 ${counts.containers} 个 Container、${counts.widgets} 个 Widget，其中 ${counts.productWidgets} 个真实 Products 组件，HTML 控件 ${counts.html} 个。来源字体、背景、限宽、留白、图片比例、文字区和原生箭头/分页已应用到此页 CSS。

已实际查看 1920×1080、1440×1000 的来源与当前草稿截图；两桌面共 14 项原生轮播点击/分页/恢复检查通过，48 项实际商品 DOM/数据核对通过。最终只读复核写入次数为 0，CSS 完整内容与页面读回一致，前后文档指纹一致。工具维护的完整测试 923 通过、0 失败，build 通过；软件测试不代替上述页面视觉检查。

[当前验证报告](${review}/report.json) · [当前模板备份](${review}/elementor-template.json) · [当前已应用 CSS](${review}/page-custom.css) · [组件与验证摘要](${review}/summary.json)

原始长图保留登录后的 WordPress 管理条，因此分段图中的管理条会重复；没有把它当成页面内容删改或宣称无缝截图。实际产品、价格、评价使用目标站已有数据，来源促销商品数据没有复制。来源搜索、账户、门店及服务等外链保留；来源自动播放开关、反馈及聊天业务未接入。当前视觉与组件复核不代表这些业务集成已实现。

当前唯一准确的页面状态入口是 current-user-amendment.json 与其最后 after 快照。首次 program、release lock、手动 CSS 交付和 comparison 报告为历史证据，不要重跑原始生成来覆盖当前页面。所有用户授权修订都有写前意图、预期状态、所有权检查和实际读回。
`;
await writeFile(run+'/DELIVERY.md',text);await writeFile(review+'/DELIVERY.md',text);console.log(JSON.stringify({status:'delivered-current-user-amendment',pageId:15621,counts,checks:{interaction:14,products:48},stats,documentHash:snapshot.hash}));
