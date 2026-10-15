---
name: hushen-planning
description: 按本局狐神抚原作者的两阶段要求和选定规划方式检索材料、核对人物感知边界。
---

# 写前材料与原作者方法

先调用 `sike_read_turn`，读取 `presetRules` 中的完整已选原文；存在续页时按返回位置继续。这里说明工具方法，不另造文风或替换原作者规则。

依照原文的 `stage_1_base_requirements` 和 `stage_2_pre_output_check`，核对角色、视角、转述与玩家控制边界、节奏、文风、篇幅及输出格式。已选多角色、导演、自然或自定义规划方法仍以作者原文为准，在内部完成；不把完整推理写入正文或工具参数。

`All_Context` 对应当前人物卡、世界书、变量与当前分支历史。`fox_extra` 的旧临时注入不能当作已执行任务：用 `worldbook_search`、`tavern_memory`、`tavern_recall_history` 等现有工具读取实际依据。被截断的片段不是全文；来源不明的旧局记忆不能作为当前事实。

在允许的查询请求数内合并必要检索。可选 `brief` 只保存六项短执行约束：`scene`、`characters`、`knowledge`、`style`、`progression`、`stopAt`，与初稿同次提交。不额外启动一个规划 Agent。
