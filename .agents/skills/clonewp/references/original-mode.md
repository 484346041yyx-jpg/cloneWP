# 原创模式

从本次业务 brief 出发冻结品牌、语言、受众、业务目标、可核实事实、文案、设计 tokens、布局、三端样式和交互。在新的 `original/<taskId>/design.json` 声明 `workflow: original-design`，按 `src/original/types.ts` 和 `validate.ts` 编写。业务资料不足可建立明确标为演示的方案；不要发明资质、优惠、评价、门店或销量。历史 `original/design.json`、MoriPaws 和 Pawberry 是例子，未经当前用户要求不复用。

原创可以读取灵感网页的公共信息帮助设计，但无需伪造 sourceScene、源文字绑定或像素复制契约。需要精确源还原时使用 replica 新任务。新原创资产须在当前任务内记录真实来源；需要生成照片/插画时调用 imagegen，文字型原生布局也有效。本地 prototype 仅用于设计检查，不是 WordPress 的最终页面或组件行为证明。

支持项以当前 schema 与实际注册能力为准：原生 containers、heading、text、image、button、accordion；桌面/平板/手机布局；可注册表达的 hover 和安全 HTTP(S)/站内相对/anchor 链接；`products` 通过 `wd_products` 查询目标已有商品；`carousel` 通过注册 `nested-carousel` 与原生容器 slides 表达。用 `productQuery`、`productDisplay`、`carousel` 的类型字段写设计，不填写未经发现的任意 settings。限宽居中和全宽背景分别设计；文字较长和小屏按钮需有实际三端验证。

运行 `npm run create:original -- "original/<taskId>/design.json"`。系统在认证前验证输入与资产字节，发现真实目标控件/环境，读取需要的真实商品目录，预编译能力后才创建 owned draft 与导入媒体，再使用真实媒体收据重新编译。预检占位数据不能成为写入文件或最终媒体证明。每个累计 section 真实保存回读；产品使用真实 ID/排序，禁止静态卡片、复制源商品字段或新建商品。

商品 ID 字段指定选择的记录，展示顺序采用实际注册组件的日期降序、同日期 ID 降序规则。目录读取采用同一排序，再将真实选择冻结到原生 include 查询，并显式设置可用日期排序，避免网站默认排序或相同日期记录造成不一致。记录本次实际组件/WooCommerce 查询源码哈希与浏览器 ID/排序证明；未提供注册的 `post__in` 选项时不伪造该控件值。所有动态字段仍以实际 WooCommerce 记录为准。

缺失注册功能直接保留具体错误；不要把查询、手动暂停、分数分页或 hover 偷换成默认/静态表现。链接必须安全；未接入的搜索、账户、表单、付款/订阅不能宣称工作。两种模式不会改变测试站的公共业务流程。

前端验收对照 authored design，检查真实目标 document CSS、可绘制图片、标题/文字/顺序/布局、三端溢出和截图质量；有商品/轮播时核对实际目标数据、原生实例与切换结果。有 hover 时实际触发并观察。真实编辑器逐 section 选中，并修改代表性文字、图片、样式、商品查询/展示和轮播设置，保存验证前端，然后精确恢复核对最终 hash。屏外原生 slide 可由实际原生窗口与切换证明解释，普通隐藏内容不能豁免。

报告 `mode: original`、实际状态和原生文档/模板、编辑与预览链接、三端/数据/交互/编辑证据与未解决项。完成不要求与灵感网站原文或像素相同；仍要求真实原生功能和可编辑性。若没执行实际浏览器/编辑器，不报告首页完成。所有远端写入串行且守住当前 hash，保留并发人类编辑。
