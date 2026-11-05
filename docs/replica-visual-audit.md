# 复刻视觉证据检查

独立桌面组件任务继续使用 `visualAuditVersion: 2`。新建完整复刻 v4 任务必须在 `bodyBase` / `program.json` 中使用 `visualAuditVersion: 3`，手机和桌面都检查来源绑定的计算样式与通用绘制区域。显式旧 v1/v2/v3 任务继续使用冻结合同，不自动迁移。

## 检查范围

### 原生组件默认值、轮播和链接

以下是新任务的默认人工验收步骤，使用既有证据记录；历史冻结合同和已发布页面不自动迁移。

1. **先读原生组件。** 对每种使用的组件及不同预设，记录目标版本、面板实际注册的设置、默认值和实际渲染。看清控件由组件、主题还是插件提供；检查实际按钮、SVG、字体图标、伪元素及背景是否重复绘制。优先调整原生设置；视觉补充限定到页面内的稳定组件类。验证可见、悬停、键盘焦点和首尾禁用；每个方向只留一个可操作按钮和一个图标。
2. **按区块测来源。** 在任务采用的每个桌面和手机宽度记录真实文档 `clientWidth`、生效断点、区块及轮播视窗边界、列表总量、同屏完整卡片数量、左右预露数量和像素、卡片宽度与间距。分别操作前进和后退，记录稳定前后逻辑索引与位移，核对首尾行为；循环项按逻辑索引，尾页不足单独记录。同屏数量、总量与每次移动的数量分别记，按区块取实测值。
3. **同宽验证目标。** 对齐来源、目标前台和 Elementor iframe 的实际 `clientWidth`；前台和画布使用同一保存版本、数据及加载状态。对每个轮播核对上述几何和前后状态，保留截图与数值；编辑器手柄或覆盖层挡住控件时移开再核对。来源或目标缺证据、宽度不同、原生能力无法匹配，都不得标记通过。
4. **单独核对异常链接。** 记录区块、原始地址、实际响应及最终地址，确认是否到达正确页面；区分失效、重定向到无关页面、登录限制、暂时失败或检查器过期标记。能确认正确等价目标才改链接，复查实际落点。不用 CSS 抹掉红框、划线或其它诊断提示。编辑器选中边框单独识别，不当作前台样式缺陷。

#### 原生绘制层证据

- **制作前先查档。** 本次用到的原生组件（含容器、静态及交互组件）都要引用适用基线。先查 [组件知识层及安装包源码基线](knowledge/native-paint-baselines.md)，同版本、同模式直接复用源码知识；目标站的预设、断点和影响绘制的覆盖未变，也可复用已有实测基线。多个同模式实例共享一份基线，各自标注有无局部覆盖。换站做代表性核对，不重新研究组件；只有缺档、有效条件改变或现场不符时补采受影响的层。
- **把控件和绘制分开记录。** 对每个可见部位，标注角色、提供方、节点或伪元素、图标来源、背景、边框、阴影、可见状态和实际尺寸。查看本体、子层及 `::before`/`::after`；识别同一控件画了两层外观、相邻控件相叠，以及图标与所属文字换行或错位。仅统计 DOM 节点或可点击按钮不算证据。
- **先设置，再调整已有层。** 优先使用已注册的原生设置；需要补充时，把 CSS 限定到具体页面与组件，在负责绘制的现有层调整尺寸、间距或外观，保留控件的点击、焦点、状态和语义。已有原生图标不再另加一枚；确需替换时，记录关闭或替换的是哪一层。不要用全站重置掩盖局部冲突。
- **逐实例提交实际对照。** 在当前任务的审核证据中，为各实例关联原站、目标前台及 Elementor 的同宽同状态截图，以及能定位责任层的计算样式或 DOM 读数。检查静态外观和实际出现的交互状态（例如悬停、键盘焦点、禁用、展开和错误）；相邻的独立控件要检查各自职责和对齐。记录预期保留层、实际绘制层、差异与处理结果。没有目标原生基线、缺少任一端实际对照，或仍有未经解释的重复绘制、重叠、错位时，人工验收不得通过。沿用当前证据容器与冻结合同格式。

- 来源与目标区块背后第一层不透明纯色背景；透明区块透出主题底色也会被发现。
- 可见图片和 SVG 图标在区块内的相对位置及尺寸。对数量超过 20 的复杂区块仍以整页截图人工复核。
- 复制文案相同且在区块内唯一的文字颜色、字号、行高和相对水平位置。字体家族不参与判断。
- 链接、标签及按钮的背景、字色、尺寸和下划线实现。
- 轮播进度条的数量、宽高、水平位置、颜色及填充比例；前后箭头的数量、位置、外框与图标尺寸。
- 独立 WoodMart 页眉与来源相同的居中内容限宽。
- 可见的背景、渐变、边框及阴影区域按位置和绘制样式比较，不依赖控件名称或 CSS 类名；任意造型的按钮和装饰块都可进入这一层检查。

动态商品和文章文案不会强行按文字匹配。背景图片与渐变只比较类型，具体像素、图标轮廓、伪元素、动画和交互状态仍需绑定截图及实际操作复核；此检查不代替整页视觉和交互验收。版本 2 要求每个模块提交 `paintLayers`，缺失即拒绝审核；旧版本 1 报告缺少此字段时按原冻结合同执行。

## 完整复刻的审核证据

每个 `review-evidence.json` 的桌面 `viewports[]` 项需增加 `visualAudit` 文件引用（`path` 与 `sha256`）。它引用的 JSON 格式为：

```json
{
  "version": 1,
  "kind": "clonewp-full-replica-visual-audit",
  "pageId": 123,
  "fingerprint": "<与 review 相同的页面指纹>",
  "width": 1920,
  "height": 1080,
  "screenshotSha256": "<此 viewport 截图的 sha256>",
  "observedAt": "<与截图同一稳定页面状态的 ISO 时间>",
  "modules": [
    {
      "sourceUnitId": "<source-units.json 中该视口的 body unit ID>",
      "targetSelector": ".elementor-123 .cwp-n44-<顶部组件的实际哈希类名>",
      "visual": { "solidBackground": "rgb(255, 255, 255)", "texts": [], "progress": [], "arrows": [], "mediaGeometry": [], "paintLayers": [] }
    }
  ]
}
```

桌面 v1 报告的 `modules` 必须覆盖该视口所有可见正文 source unit，且每个 source unit 只能出现一次。选择器由顶部组件的 `native44ModuleClass(key)` 计算。目标模块的 `visual` 必须在与审核截图相同的浏览器、视口、页面状态以及字体加载完成后，从真实 DOM 计算样式采集；可使用 `src/replica-full/visual-review.ts` 导出的 `sampleFullReplicaVisualModule(root)`。采样前要求选择器恰好匹配一个可见根节点。采样函数返回每个模块的背景、图片位置、文字、控件、进度条、箭头和绘制区域读数。旧 v1/v2 的手机仍沿用冻结的响应式与人工审核。

审核器不接受报告中自称的来源颜色或尺寸；它按 `source-evidence.json`、`source-units.json` 和原始 observation packet 的哈希绑定重新计算来源读数。目标报告与页面指纹、截图哈希和视口绑定，任一可比较的视觉偏差会阻止“通过”审核。修正目标页后重新采集截图和报告；不要编辑原始来源证据或沿用旧截图。

## v4 手机视觉与换行

v4 的四个 `review-evidence.json` 视口都必须引用 `visualAudit`。两个桌面仍用上述版本 1 报告，但 `texts[]` 要增加浏览器实际 `width`、`height`、`lineCount`（行高可解析时）和 `whiteSpace`。两个手机用版本 2 报告，包含 `clientWidth`，并将 `modules[]` 中的 `sourceUnitId` 改为 `sectionKey`。每个可见响应式区块恰好一项；`targetSelector` 为该区块实际生成的稳定类名，手机独立区块使用 `_phone` 组件键。

手机来源由 `responsive.source` 的哈希绑定 observation packet 及各区块 `evidence.snapshotId/nodeId` 重新计算，目标的 `clientWidth` 必须和来源相同。截图标称 390px 而内容区是 375px 时，不得用内容区 390px 的模拟结果替代。文字比对增加实际文字框高度、渲染行数和 `nowrap` 状态；已有颜色、字号、行高、背景、控件、箭头、进度条及绘制区域检查仍适用。修正 CSS 后重新采集浏览器计算样式；保存成功不证明覆盖规则生效。

## v4 手机轮播前后状态

如正文含原生轮播，或响应式决定把动态商品配置为轮播，`responsive.carouselMotionSource` 必须引用 `clonewp-responsive-carousel-motion-source` v1。每个轮播在两个手机宽度各有一项：组件和所属区块、来源 snapshot/node、`width/height/clientWidth`、滑动前后截图及 `before/after` 帧。每帧记录轮播视窗宽、当前逻辑索引，以及至少两张卡片相对视窗的 `index/x/width`。来源节点必须属于该区块，截图必须读回哈希和尺寸。

```json
{
  "version": 1,
  "kind": "clonewp-responsive-carousel-motion-source",
  "taskId": "task-id",
  "sourceUrl": "https://source.example/",
  "rows": [{
    "componentKey": "category-carousel",
    "sectionKey": "categories",
    "snapshotId": "phone-390",
    "sourceNodeId": "source-carousel-node",
    "width": 390,
    "height": 844,
    "clientWidth": 375,
    "observedAt": "2026-10-22T00:00:00.000Z",
    "before": { "viewportWidth": 327, "activeIndex": 0, "items": [{ "index": 0, "x": 0, "width": 225 }, { "index": 1, "x": 245, "width": 225 }] },
    "after": { "viewportWidth": 327, "activeIndex": 1, "items": [{ "index": 0, "x": -245, "width": 225 }, { "index": 1, "x": 0, "width": 225 }] },
    "beforeScreenshot": { "path": "source-before.png", "sha256": "<64 位 SHA-256>" },
    "afterScreenshot": { "path": "source-after.png", "sha256": "<64 位 SHA-256>" }
  }]
}
```

目标交互证据对每项增加一次 `carousel-motion:<componentKey>` 操作，选择器使用该组件稳定类名，操作类型为 `carousel`。操作前后状态各带 `motion` 帧和截图。审核器比对来源与目标的逻辑步长、卡片宽度、初始及滑动后位置；首帧看起来正确但原生引擎移动步长错误，会阻止通过。动态商品内容可以不同，位置和行为仍要匹配。来源未能取得实际滑动证据时，v4 在远端写入前失败，不编造通过记录。
