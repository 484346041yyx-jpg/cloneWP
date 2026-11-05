# 已启用原生组件绘制索引

本页与 [原生组件绘制基线](native-paint-baselines.md) 配合使用。按实际组件 key 查：第二列是已有控件/渲染档案和已核对的安装包源码入口，第三列是成品需要分开核对的绘制部位。它不宣称每个模式已在当前目标站实测。配置、依赖、预设或级联不匹配时，只补受影响的部位；动态模板及用户 HTML 不从包内推定实际像素。

范围只取 [基础清单](../../config/native44-component-set.json) 与 [当前单品扩展](../../data/native-product/extension-v1.json)：44 + 12 个不同组件 key。普通正文只用基础 44；单品扩展需本任务明确引用并符合原资格。目录覆盖不改变任何组件的启用或执行权限。

## 基础 44 个

| 组件 key | 档案与包内源码入口 | 原生绘制核对重点 |
| --- | --- | --- |
| `accordion` | [原生档案](../../data/native44/components/accordion.json) · `elementor/includes/widgets/accordion.php` | 标题、原生展开/折叠图标和面板分层；用原生图标字段，展开和折叠各只显示对应图标。 |
| `breadcrumbs` | [原生档案](../../data/native44/components/breadcrumbs.json) · `elementor-pro/modules/theme-elements/widgets/breadcrumbs.php` | 面包屑链接、分隔符和当前项由组件输出；用原生分隔符样式，检查是否被主题再次添加。 |
| `button` | [原生档案](../../data/native44/components/button.json) · `elementor/includes/widgets/button.php` | 使用原生文字/图标包裹层、图标位置和间距；检查同行、焦点及悬停。 |
| `container` | [原生档案](../../data/native44/components/container.json) · `elementor/includes/elements/container.php` | 核对 Flex/Grid、盒宽和子层间距；背景、遮罩和形状分隔分别验，避免外内两层重复背景。 |
| `divider` | [原生档案](../../data/native44/components/divider.json) · `elementor/includes/widgets/divider.php` | 保留原生线、文字或图标的组合；调原有线宽、对齐和间距，检查是否又添加了一条边框。 |
| `form` | [原生档案](../../data/native44/components/form.json) · `elementor-pro/modules/forms/widgets/form.php` | 字段、标签、必填标记及提交按钮各有原生层；检查必填星号、提交图标和错误状态。 |
| `heading` | [原生档案](../../data/native44/components/heading.json) · `elementor/includes/widgets/heading.php` | 只在原生标题文字及其链接上调整；对照标签级别、换行和继承字体。 |
| `html` | [原生档案](../../data/native44/components/html.json) · `elementor/includes/widgets/html.php` | 自定义 HTML 没有固定的内容绘制基线；复用组件壳知识，内部按本次 HTML 检查；不假设它等于原生部件。 |
| `icon` | [原生档案](../../data/native44/components/icon.json) · `elementor/includes/widgets/icon.php` | 沿用原生字体图标或 SVG 以及图标包裹层；区分图形、边框与背景。 |
| `icon-box` | [原生档案](../../data/native44/components/icon-box.json) · `elementor/includes/widgets/icon-box.php` | 图标、标题和说明分别调整；检查原生图标底形与外层背景有无重画。 |
| `image-box` | [原生档案](../../data/native44/components/image-box.json) · `elementor/includes/widgets/image-box.php` | 图片区、标题、说明与链接分层；先用原生排列和图文间距，再查裁切。 |
| `nested-accordion` | [原生档案](../../data/native44/components/nested-accordion.json) · `elementor/modules/nested-accordion/widgets/nested-accordion.php` | 保留原生标题和状态图标；查看展开/折叠图标是否被同时显示。 |
| `nested-carousel` | [原生档案](../../data/native44/components/nested-carousel.json) · `elementor-pro/modules/nested-carousel/widgets/nested-carousel.php` | 保留共享导航设置及 `.swiper-wrapper`，核对箭头、分页、拖动和边缘预露。 |
| `nested-tabs` | [原生档案](../../data/native44/components/nested-tabs.json) · `elementor/modules/nested-tabs/widgets/nested-tabs.php` | 选项卡标题、选中样式和内容面板分别验；保留原生切换，检查窄屏模式。 |
| `slides` | [原生档案](../../data/native44/components/slides.json) · `elementor-pro/modules/slides/widgets/slides.php` | 由原生导航选择箭头或圆点；幻灯内容、遮罩和按钮分层，分别检查。 |
| `social-icons` | [原生档案](../../data/native44/components/social-icons.json) · `elementor/includes/widgets/social-icons.php` | 每个链接用原生图标、形状和颜色；检查悬停及外层是否重复画底。 |
| `text-editor` | [原生档案](../../data/native44/components/text-editor.json) · `elementor/includes/widgets/text-editor.php` | 富文本的段落、列表、链接由内容渲染；检查主题排版继承，不对内容另套重复图标。 |
| `wd_banner_carousel` | [原生档案](../../data/native44/components/wd_banner_carousel.json) · `woodmart/inc/integrations/elementor/elements/banner/class-banner-carousel.php` | 先查原生轮播导航；横幅媒体、遮罩和文字分别核对。 |
| `wd_blog` | [原生档案](../../data/native44/components/wd_blog.json) · `woodmart/inc/integrations/elementor/elements/blog/class-blog.php` | 按当前网格/轮播模式检查文章卡片；区分组件翻页、分页与卡片链接。 |
| `wd_button` | [原生档案](../../data/native44/components/wd_button.json) · `woodmart/inc/integrations/elementor/elements/button/class-button.php` | 先查原生文字、链接和图标；核对同行、按钮底层和悬停。 |
| `wd_compare` | [原生档案](../../data/native44/components/wd_compare.json) · `woodmart/inc/integrations/elementor/elements/class-compare.php` | 比较区内容来自目标站功能；核对空态、比较表和操作控件，不手工重建业务按钮。 |
| `wd_contact_form_7` | [原生档案](../../data/native44/components/wd_contact_form_7.json) · `woodmart/inc/integrations/elementor/elements/class-contact-form-7.php` | WoodMart 是表单挂载层，字段、状态和按钮还受 Contact Form 7 输出影响；后者需目标站证据。 |
| `wd_counter` | [原生档案](../../data/native44/components/wd_counter.json) · `woodmart/inc/integrations/elementor/elements/class-counter.php` | 沿用原生数值动画与文本输出；区分数值、前后缀和外层装饰。 |
| `wd_element_breadcrumbs` | [原生档案](../../data/native44/components/wd_element_breadcrumbs.json) · `woodmart/inc/integrations/elementor/elements/class-breadcrumbs.php` | 按该 WoodMart 面包屑出口核对链接、当前项和分隔；不与主题公共面包屑叠放。 |
| `wd_extra_menu_list` | [原生档案](../../data/native44/components/wd_extra_menu_list.json) · `woodmart/inc/integrations/elementor/elements/class-extra-menu-list.php` | 菜单项目和子项使用原生层；检查项目图标、分隔和层级，保留链接。 |
| `wd_image_or_svg` | [原生档案](../../data/native44/components/wd_image_or_svg.json) · `woodmart/inc/integrations/elementor/elements/class-image.php` | 区分原生图片与 SVG 路径；调整现有媒体及包裹层，不叠放同一素材。 |
| `wd_infobox` | [原生档案](../../data/native44/components/wd_infobox.json) · `woodmart/inc/integrations/elementor/elements/infobox/class-infobox.php` | 媒体/图标、正文和动作分别核对；已有 CTA 或图标时不另画同一层。 |
| `wd_infobox_carousel` | [原生档案](../../data/native44/components/wd_infobox_carousel.json) · `woodmart/inc/integrations/elementor/elements/infobox/class-infobox-carousel.php` | 信息框卡片与轮播导航分开；核对箭头/分页的原生绘制与卡片内容。 |
| `wd_list` | [原生档案](../../data/native44/components/wd_list.json) · `woodmart/inc/integrations/elementor/elements/class-list.php` | 列表标记和行内容分开；检查原生图标与 CSS 列表标记是否同时出现。 |
| `wd_nested_carousel` | [原生档案](../../data/native44/components/wd_nested_carousel.json) · `woodmart/inc/integrations/elementor/elements/class-nested-carousel.php` | 先查嵌套滑块与 WoodMart 原生导航；分别核对子容器和外层箭头。 |
| `wd_page_heading` | [原生档案](../../data/native44/components/wd_page_heading.json) · `woodmart/inc/integrations/elementor/elements/class-page-heading.php` | 查页面标题背景、文字与可选导航；避免页面壳与正文同时画同一标题区。 |
| `wd_product_categories` | [原生档案](../../data/native44/components/wd_product_categories.json) · `woodmart/inc/integrations/elementor/elements/class-product-categories.php` | 类别图、标题及覆盖层分开；先确认网格/轮播模式，再决定是否需要导航样式。 |
| `wd_products` | [原生档案](../../data/native44/components/wd_products.json) · `woodmart/inc/integrations/elementor/elements/products/class-products.php` | 区分商品网格、商品轮播、卡片内图库；轮播沿用原生箭头，检查 `.wd-arrow-inner` 的尺寸、底色和图标。 |
| `wd_products_brands` | [原生档案](../../data/native44/components/wd_products_brands.json) · `woodmart/inc/integrations/elementor/elements/class-products-brands.php` | 品牌图片、标题与链接沿用原生输出；如果当前模式启用导航，单独核对导航绘制。 |
| `wd_products_tabs` | [原生档案](../../data/native44/components/wd_products_tabs.json) · `woodmart/inc/integrations/elementor/elements/products-tabs/class-products-tabs.php` | 选项卡控件、当前商品结果和结果区内部导航分开；保留原生切换及加载状态。 |
| `wd_sidebar` | [原生档案](../../data/native44/components/wd_sidebar.json) · `woodmart/inc/integrations/elementor/elements/class-sidebar.php` | 组件只提供侧栏挂载，实际绘制依赖目标站所选侧栏和其中的小工具；只复用挂载层。 |
| `wd_social_buttons` | [原生档案](../../data/native44/components/wd_social_buttons.json) · `woodmart/inc/integrations/elementor/elements/class-social.php` | 使用原生社交链接、图标与按钮样式；检查已有图标及背景，不额外描绘一套。 |
| `wd_testimonials` | [原生档案](../../data/native44/components/wd_testimonials.json) · `woodmart/inc/integrations/elementor/elements/class-testimonials.php` | 先核对评价卡片内容；在当前模式确有导航时才调整已有导航层。 |
| `wd_text_block` | [原生档案](../../data/native44/components/wd_text_block.json) · `woodmart/inc/integrations/elementor/elements/class-text-block.php` | 保留富文本层；检查现有段落、链接、列表与主题排版继承。 |
| `wd_title` | [原生档案](../../data/native44/components/wd_title.json) · `woodmart/inc/integrations/elementor/elements/class-title.php` | 沿用原生标题及启用的副标题和装饰；线、背景和文字分开确认。 |
| `wd_toggle` | [原生档案](../../data/native44/components/wd_toggle.json) · `woodmart/inc/integrations/elementor/elements/class-toggle.php` | 保留原生触发按钮和折叠内容；检查开关状态图标是否各显示一次。 |
| `wd_wc_breadcrumb` | [原生档案](../../data/native44/components/wd_wc_breadcrumb.json) · `woodmart/inc/modules/layouts/elementor/woocommerce/class-breadcrumb.php` | 路径来自当前 WooCommerce 请求；核对分隔和当前项，不叠加普通页面面包屑。 |
| `wd_wishlist` | [原生档案](../../data/native44/components/wd_wishlist.json) · `woodmart/inc/integrations/elementor/elements/class-wishlist.php` | 功能区交给目标站愿望单；检查空态、商品行和操作是否被静态仿制层覆盖。 |
| `woocommerce-products` | [原生档案](../../data/native44/components/woocommerce-products.json) · `elementor-pro/modules/woocommerce/widgets/products.php` | Elementor Pro 组件与 WooCommerce 商品模板分层；检查实际列、分页及卡片操作，不套用 WoodMart 轮播选择器。 |

## 单品扩展 12 个

这些组件还要确认当前 WooCommerce 商品、模板覆盖和状态。安装包中对应的 WoodMart 入口与现有 [单品源码基线](../../data/adapters/core-product-source.json) 一致。

| 组件 key | 档案与包内源码入口 | 原生绘制核对重点 |
| --- | --- | --- |
| `wd_single_product_add_to_cart` | [原生档案](../../data/native-product/components/wd_single_product_add_to_cart.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-add-to-cart.php` | 保留原生数量、变体和加入购物车控件；核对目录模式、登录、不可购及已选变体状态。 |
| `wd_single_product_additional_info_table` | [原生档案](../../data/native-product/components/wd_single_product_additional_info_table.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-additional-info-table.php` | 保留原生属性表及可选图标；检查标签、属性值和行分隔，不重复画同一表。 |
| `wd_single_product_content` | [原生档案](../../data/native-product/components/wd_single_product_content.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-content.php` | 长描述来自当前商品；检查正文样式继承，以及它是否在标签页又展示了一遍。 |
| `wd_single_product_gallery` | [原生档案](../../data/native-product/components/wd_single_product_gallery.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-gallery.php` | 当前商品主图、缩略图和可用的放大/图库控件分层；核对实际模式及导航，不复制第二套控制器。 |
| `wd_single_product_meta` | [原生档案](../../data/native-product/components/wd_single_product_meta.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-meta.php` | 沿用当前商品元信息模板；区分字段标签、值和分类/标签链接。 |
| `wd_single_product_price` | [原生档案](../../data/native-product/components/wd_single_product_price.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-price.php` | 沿用 WooCommerce 当前价格模板；区分正常价、促销价和变体状态。 |
| `wd_single_product_rating` | [原生档案](../../data/native-product/components/wd_single_product_rating.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-rating.php` | 沿用原生评分模板；区分星形背景、填充和评分链接，检查无评分时状态。 |
| `wd_single_product_reviews` | [原生档案](../../data/native-product/components/wd_single_product_reviews.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-reviews.php` | 复用评论列表、原生评分和表单；有评分汇总时与单条评分分开核对。 |
| `wd_single_product_short_description` | [原生档案](../../data/native-product/components/wd_single_product_short_description.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-short-description.php` | 短描述来自当前商品模板；只调当前摘要排版，不复制长描述。 |
| `wd_single_product_tabs` | [原生档案](../../data/native-product/components/wd_single_product_tabs.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-tabs.php` | 标题栏与原生面板分开；检查标签/折叠模式、状态图标及内容是否被另一组件重复展示。 |
| `wd_single_product_title` | [原生档案](../../data/native-product/components/wd_single_product_title.json) · `woodmart/inc/modules/layouts/elementor/single-product/class-title.php` | 沿用当前商品标题模板，检查主题是否又画了一个标题。 |
| `wd_wc_notices` | [原生档案](../../data/native-product/components/wd_wc_notices.json) · `woodmart/inc/modules/layouts/elementor/woocommerce/class-notices.php` | WooCommerce 决定通知内容与类型；检查成功、错误、提示各自的外观，不叠加另一套通知。 |
