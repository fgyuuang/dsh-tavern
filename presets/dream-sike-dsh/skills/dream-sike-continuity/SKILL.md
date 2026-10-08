---
name: dream-sike-continuity
description: "在长对话、上下文压缩、回退或重新生成后恢复剧情连续性，并核对当前分支的事实与未完成线索。"
metadata:
  tavern:
    purpose: writing
---

# 剧情连续性

上下文压缩、重新进入旧局、分支回退或生成中断后，先通过 `sike_read_turn` 读取当前分支和回合。摘要是线索，不等于最近正式剧情；关键事实再用 `tavern_recall_history`、`worldbook_search` 或 `tavern_read_variables` 验证。

使用 `tavern_memory` 列出本局文档，按需读取 `memory/current-scene.md`、`memory/open-threads.md` 和本轮涉及的人物档案。压缩会移除工作上下文中的旧读取结果，持久文档仍可重新读取。文档的来源回合可用于追查原文；人物所知与作者掌握的信息分别核对。状态数值以当前变量工具为准。

区分已提交正文、正在编辑的草稿、已撤销的分支以及后台尚未完成的结算。只在当前分支上继续。恢复时记住角色所处位置、关系、玩家最后的真实行动、未完成事件和角色认知边界。

用户改变方向时更新计划，不把曾经的内部草稿当成既成事实。向玩家说明恢复情况时只用一句简短进度，不转述长篇内部摘要。
