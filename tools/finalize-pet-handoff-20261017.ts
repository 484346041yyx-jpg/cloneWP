import {readFile,writeFile} from 'node:fs/promises';
const run='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c';
const report=JSON.parse(await readFile(run+'/comparison/report.json','utf8'));
const reviews=report.captures.map((capture:any)=>({viewport:capture.viewport,sourceScreenshotHash:capture.source.sha256,targetScreenshotHash:capture.target.sha256,documentHash:report.documentHash,verdict:'failed',observedAt:new Date().toISOString(),notes:'Actual original screenshots and derived overview/top/footer crops inspected. Correct block order, source imagery and native editable copy are present. Five mounted native carousels pass actual next/previous/pagination/restoration checks at both widths. The user explicitly deferred Halloween/Fall product collections. Current pre-CSS render still differs in outer container padding, promo wrapping, hero backdrop, BOGO background repetition, image sizing, heading/control placement and footer social layout; the reviewed 89-rule manual CSS handoff addresses these differences but has not been applied or visually verified. Raw long target captures retain logged-in WordPress admin chrome, whose repetition is an acknowledged screenshot limitation. Specialty deals is a static six-card row; source runtime controller parity was not reproduced.'}));
await writeFile(run+'/visual-reviews.json',JSON.stringify(reviews,null,2)+'\n');
const delivery=`# Pet Supermarket 原生草稿与 CSS 交付

- 草稿：15621，状态 draft，未发布。
- [在 Elementor 编辑](https://primevapeoutlet.com/wp-admin/post.php?post=15621&action=elementor)
- [登录后预览](https://primevapeoutlet.com/?page_id=15621&preview=true)
- [完整页面 CSS](./page-custom.css)
- [Elementor 模板备份](./elementor-template.json)

按用户“商品不用管，后面我自己弄”，Halloween 和 Fall 商品区保留原生容器及配置提示，没有查询或写入商品。其余区块包括页眉、活动、主轮播、宠物分类、BOGO、品牌、活动卡、服务和页脚。正文为 120 个原生 Container、167 个 Widget；88 项任务媒体已完成准备。完整正文只成功提交一次，后续检查没有改写页面。

请把 page-custom.css 的完整内容粘贴到本页 Elementor → 页面设置 → 高级 → 自定义 CSS。它修正来源/草稿截图中已确认的容器宽度、间距、背景尺寸、控件样式和图标布局。当前是 CSS 待应用交付，不能视为应用后视觉验收通过。

验证：1920×1080 与 1440×1000 两桌面原始来源/草稿截图已检查；5 组真实原生轮播的箭头、分页同步及恢复共 10 项通过。工具开发最终完整测试 923 通过、0 失败，build 通过；这不代替页面视觉验收。原始比较证据见 comparison/report.json、css-review.json 和 visual-reviews.json。

已知边界：来源商业字体未提供，使用 Arial。搜索、账户、门店、服务与普通导航保留来源外链，未接入目标站业务。轮播为原生手动控制，来源自动播放/暂停、反馈和聊天服务未复制。Specialty 区为六卡静态行，未复刻来源运行时控制器。登录后截图中的 WordPress 管理条会在长图分段重复，原始证据保留并明确标记，未当作页面内容修饰或伪造无缝长图。

恢复说明：历史媒体导入错误已解决，88 项媒体已对账，正文保存及读回已确认；日志保留历史错误不代表当前正文未保存。不要重新生成或再次提交正文来应用 CSS。

来源、结构、媒体、查询和交互的实际情况分别记录；自动比较仍保留商品范围差异、静态六卡控制器差异、管理条长图限制以及应用前视觉差异，未伪造完整验收通过。
`;
await writeFile(run+'/DELIVERY.md',delivery);
console.log('Hash-bound visual review and explicit manual-CSS delivery notes written locally.');
