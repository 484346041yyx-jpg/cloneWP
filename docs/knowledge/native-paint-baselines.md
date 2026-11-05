# 原生组件绘制基线：安装包源码索引

这是 [组件知识层](../../COMPONENTS.md) 的按需查阅补充。记录的是指定安装包的注册和渲染源码，未运行包内代码；不替代目标站的版本、设置、级联样式或当前页面验收，也不新增已启用组件或修改冻结的 native44 档案。

| 包内版本 | 本地安装包文件名 | SHA-256 |
| --- | --- | --- |
| WoodMart 8.5.5 | `woodmart.zip` | `29a1f89b06cc6ca8ffd42be1433ff7e2276205c93d8f8134d6558a713fba2798` |
| Elementor 3.35.4 | `elementor.3.35.4.zip` | `f5aed94308f8d3dd15b4724888c796dcf3e5d62c8ceb5eca113116b37ce94081` |
| Elementor Pro 3.35.1 | `elementor-pro_3.35.1.zip` | `5cd81f4754447eb79eb74c0927ac0f24bae4a040dea67cc9c1a6b85811eafc67` |

## 制作前怎么复用

1. 按实际组件 key、提供方和模式先查现有 native44 档案（控件、默认值、条件），需要判断绘制时再查本页。源码基线可跨站复用，前提是对应版本和渲染模式匹配；例如同名的经典与嵌套手风琴要分开。
2. 对目标站一次核对有关版本与绘制条件，包括主题预设、全局 Kit、影响该部位的 CSS、方向和断点。版本及条件没有变化且已有目标站实测基线时，直接引用它。换站时按所用模式抽一个代表实例轻量核对，继续复用源码基线；只有未知项、结构或外观条件变化、或实际不符时，才补采受影响的部位。一个页面多个同模式实例可以共享基线；实例的局部覆盖只记录差异。
3. 发布前仍用当前成品核对实际外观、状态与交互。目标站历史基线不能证明本次 CSS 没引入重复绘制、溢出、换行或错位。复用的是默认知识，验收证据仍来自当前页面。

## 按组件查阅

[已启用原生组件绘制索引](native-paint-component-index.md) 覆盖基础 44 个和单品扩展 12 个。逐组件链接原有控件/渲染档案及安装包源码入口；下表补充最容易发生重叠的绘制细节。未启用的安装包组件不纳入索引。

| 原生组件或模式 | 控件和绘制分别在哪里 | 制作时优先改什么 |
| --- | --- | --- |
| WoodMart 商品轮播使用的通用翻页箭头（`wd_products` 的 carousel 模式） | `woodmart/css/parts/lib-swiper-arrows.css`：`.wd-btn-arrow` 外部控件内的 `.wd-arrow-inner` 负责尺寸、底色、边框、阴影和圆角；`::after` 用 `woodmart-font` 绘制前后图标，图标变体和禁用外观有独立规则。内层尺寸先读 `--wd-arrow-width` / `--wd-arrow-height`，再读 `--wd-arrow-size`，最后回退 50px；底色读取 `--wd-arrow-bg`，灰色不是写死的通用默认。 | 先看当前组件和主题的原生设置；需补样式时使用组件作用域内的原生变量或现有绘制层。只保留一个可见底圈和图标，不另造箭头；看正常、禁用和焦点时实际尺寸及相邻间隔。 |
| Elementor Button（经典 `button`） | `elementor/includes/widgets/button.php` 使用 `elementor/includes/widgets/traits/button-trait.php`。原生图标 `selected_icon` 和文字在 `.elementor-button-content-wrapper`，对应 `.elementor-button-icon`、`.elementor-button-text`；`icon_align` 改方向，`icon_indent` 改间距。旧图标迁移路径另有兼容逻辑。 | 先用原生图标、位置和间距；查当前前台及编辑器输出是否已有图标。需自定义时确认只有一枚，并检查文字与图标的同行关系。 |
| Elementor 经典 Accordion（`accordion`） | `elementor/includes/widgets/accordion.php` 注册 `selected_icon`、`selected_active_icon`；`.elementor-accordion-icon` 是标题的原生图标区，活动态用 `.elementor-active` 定位。 | 先配置原生开、关图标，按状态看实际可见层；DOM 中有两种状态图标不等于同时重复显示。 |
| Elementor Nested Accordion（`nested-accordion`） | `elementor/modules/nested-accordion/widgets/nested-accordion.php` 使用 `.e-n-accordion-item-title-icon` 内的 `.e-opened` / `.e-closed`，对应 `accordion_item_title_icon_active` 和 `accordion_item_title_icon`。 | 用本模式的原生设置核对展开和折叠，别照搬经典手风琴选择器，也别在原有标题后再加加减号。 |
| Elementor Pro Slides（`slides`） | `elementor-pro/modules/slides/widgets/slides.php` 按 `navigation` 区分箭头、圆点或两者；箭头尺寸的原生样式作用于 `.elementor-swiper-button`。 | 先选原生导航模式和样式，分别验箭头和分页，确认当前模式没有额外覆盖。 |
| Elementor Pro Nested Carousel（`nested-carousel`） | `elementor-pro/modules/nested-carousel/widgets/nested-carousel.php` 使用 `elementor-pro/base/base-carousel-trait.php` 的原生导航及样式控件，渲染 `.swiper-wrapper` 与导航尾部。 | 按本组件实际输出核对箭头、分页及开关条件，不借用 WoodMart 的内层选择器。 |
| Elementor Pro Form（`form`） | `elementor-pro/modules/forms/widgets/form.php` 注册 `selected_button_icon`、`button_icon_align`、`button_icon_indent`；必填标记由 `.elementor-mark-required .elementor-field-label::after` 绘制，标签与字段属于 `.elementor-field-group`。 | 提交图标先用原生设置；确认当前必填标记开关和伪元素，避免手写第二个星号。表单实际提交、收件及测试权限按原项目流程。 |

启用组件的具体模式若仍有缺档，先从索引中的现有档案起步，只补实际需要的绘制知识，记录组件 key、提供方版本、模式和源码入口。源码事实与目标站实测分别归档；不把某个页面的 CSS、实际颜色、尺寸或业务数据写成其他站的默认值。
