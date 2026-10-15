# 项目 Agent

复制整个目录到 Tavern 持久 `plugins/`，重启后显示独立的 Agent 工作区。需要维护版 `projectAgents v1` 和浏览器 `registerSidebarWorkspace`。

新建对话先选择 DSH 自带的标准、PTC、极简或创造模式；不复制、不改写这些原生预设。它们使用 DSH 原生 Session、工具、指令文件、Skills 和压缩。Tavern 不为这些 Session 追加游玩帧、作者提示、草稿提交或变量结算，正文和过程由原生界面显示。

默认持久目录是数据根下的 `project-workspace/`。插件首次启动只补建缺失的 Markdown 说明、记忆索引与 Skills，不覆盖已有文件。可在面板选择已有项目目录。停用插件会释放 UI，已创建原生对话和工作文件保留。
