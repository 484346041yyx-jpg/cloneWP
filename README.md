# cloneWP

把业务 brief 或参考网页转换为可编辑 Elementor 草稿，项目根目录 **D:/cloneWP**。

## 日常使用

在本项目新开 Codex 聊天，直接输入：

- `复刻建站：URL`：从你已打开的浏览器开始，默认独立 WoodMart 页眉＋菜单，正文使用当前 44 组件；并行准备、串行写入，统一双桌面视觉与交互复核后按冻结策略交付。
- `原创建站：业务说明`：使用原有原创流程。
- `学习这个网页/组件`：整理布局、配方和合同知识，不自动建站或启用新组件。
- `继续任务：任务 ID`：按真实状态和冻结合同恢复。
- `CSS 已添加，再检查这个任务`：只读核对应用后的效果。

Codex 由 [AGENTS](D:/cloneWP/AGENTS.md) 自动路由读取资料，无须每次粘贴路径。系统见 [SYSTEM](D:/cloneWP/SYSTEM.md)，组件与学习见 [COMPONENTS](D:/cloneWP/COMPONENTS.md)。项目外聊天需先关联本目录。

## 内部入口

这些命令通常由 Codex 调用：

~~~powershell
npm run context:load -- --intent maintain
npm run context:load -- --intent resume --task "<TASK_ID>"
npm run context:index
npm run reference -- "https://source.example/"
npm run create:replica -- "D:/cloneWP/references/<TASK_ID>/full-manifest.json"
npm run replica:full -- review --run-dir "D:/cloneWP/runs/<RUN_ID>" --evidence "D:/cloneWP/runs/<RUN_ID>/review.json"
npm run replica:full -- publish --run-dir "D:/cloneWP/runs/<RUN_ID>"
npm run create:replica:component -- "D:/cloneWP/references/<COMPONENT_TASK_ID>/program.json"
npm run compare:replica -- "D:/cloneWP/runs/<RUN_ID>"
npm run compare:replica -- "D:/cloneWP/runs/<RUN_ID>" --verify-applied
npm run create:original -- "D:/cloneWP/original/<TASK_ID>/design.json"
npm run learn:page -- --url "https://source.example/" --observed "D:/cloneWP/<OBSERVATION_DIR>"
npm run learn:component -- --widget "<WIDGET_TYPE>" --evidence "D:/cloneWP/<EVIDENCE_MANIFEST>"
~~~

context:load 只读本地，ready 不等于已授权建站或视觉完成。裸 URL reference 入口等待用户浏览器观察，不启动另一采集浏览器。

新复刻检查 1920×1080 和 1440×1000；独立页眉样式与正文页面 CSS 由受保护流程直接保存并读回。[完整复刻流程](D:/cloneWP/docs/full-replica-workflow.md)说明默认入口、资源归属、修订和审查。交付后不自动改页面。已有原创、组件、v1、staged v2 和无 profile native44 保留自己的格式及验收规则。

## 开发验证

~~~powershell
npm test
npm run build
~~~

工具改动先跑专项，冻结后完整测试与构建。能力由实际适配器和证据决定，已学习、已注册、可保存和业务功能已验证分别记录。
