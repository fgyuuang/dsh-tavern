---
name: dream-sike-card-play
description: "游玩前台处理人物卡开局、状态面板与交互输入带来的剧情约束，读取正确分支状态并保留卡片渲染契约。"
metadata:
  tavern:
    purpose: writing
---

# 人物卡交互与正文衔接

开局页、物品按钮、行动候选或状态面板提供新输入时，先 `sike_read_turn` 核对实际玩家行动与当前回合。卡片按钮填入输入框只形成草稿，用户发送后才是行动；不能把点击、欢迎页或未发送内容当作已经发生的剧情。

用 `tavern_read_variables` 读取当前状态，以 `worldbook_search` 查询本局可用资料；必要时用 `tavern_recall_history` 和 `tavern_memory` 核对已提交的事实。开局选择与当前状态冲突时标记冲突，不擅自重新初始化世界。角色卡专用的检定、阶段、认知、世界和事件约束来自当前资料，不以通用预设覆盖。

建立正文时保留卡片要求的 HTML、面板入口、已启用场景栏与平行事件。显示正则和 iframe 由宿主渲染，不把脚本全文当作角色知识。以 `dream-sike-format` 检查正文；变量和记忆只由正式提交后的后台结算，前台不调用维护工具、不输出 UpdateVariable、不启动另一份 MVU。

卡片特有的检定与写前流程作为内部执行约束保留；例如 redemption_chain 指定的角色、阶段、认知核对仍须执行，但该标签和完整思考过程不进入正文或简报。需要让玩家看到的检定结果，按卡片可见格式单独呈现。

玩家报告无法填入输入框、发送、打开图片或面板数据不更新时，说明当前前台不能直接操作 DOM 或改卡，转到卡片工作台使用 `tavern-card-opening`、`tavern-card-surface`、`tavern-card-state`。保留当前局，不通过再发正文、删历史或全局改世界书“修复”界面。
