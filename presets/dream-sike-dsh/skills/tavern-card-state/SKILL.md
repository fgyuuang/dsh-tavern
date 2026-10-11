---
name: tavern-card-state
description: "在卡片工作台维护 MVU 初值、更新规则与变量面板，检查世界书和脚本的状态归属、嵌套路径及重复结算风险。"
metadata:
  tavern:
    purpose: card
---

# 变量与脚本状态

用于人物卡状态结构维护。游玩前台仅查询当前变量，正式正文提交后的后台负责结算；Skill 本身不启动 MVU，不接管正在运行的后台任务，也不把草稿写成已发生的状态。

## 识别实际状态机制

通过 `tavern_read_card` 读取相关开场，以 `tavern_read_card_raw` 查当前助手、面板与迁移声明；以 `tavern_read_worldbook` 的 `query` 或 `ref` 查更新规则。先判断是原生 MVU、助手扩展、表格数据库还是混合机制，不因为出现变量字样就自动转换为 MVU。

有游玩引用时调用 `tavern_read_play_chat`，从 `overview` 开始，按需读取 `tavern`、`background`、`worldbook`、`iframe`、`diagnostics`。区分初值、已保存状态、后台待结算状态和显示缓存；失败或尚未完成的结算不能当成最新状态已经生效。

## 维护一致性

原生 MVU 卡的初值在各开场 `<initvar>`，更新规则在世界书 `[mvu_update]`，面板引用相应路径。需要约定时调用 `tavern_read_skill_reference({name:"card-to-mvu",path:"references/mvu-format.md"})`。原卡使用不同机制时保留该机制，仅修正授权范围内的问题。

修改初值或开场使用 `tavern_update_card.fields`；修改面板、脚本及扩展用 `rawOperations` 的最小 JSON Pointer；更新世界书规则使用 `tavern_update_worldbook.operations`。增加、删除或改名变量时，对齐相关开场、更新规则和面板引用，检查派生字段由谁计算。

点号字符串作为对象键与真正的嵌套路径不同。检查前端写入最终是否进入 `stat_data` 的嵌套结构，不能假定 `insertOrAssignVariables({"a.b":value})` 会创建 `a.b` 路径，也不能杜撰 `Mvu.setVariable` API。后台与面板应读取同一状态归属；禁止为了修复前端而同时启动第二份 MVU。

脚本资源的 enabled 开关不等于运行成功。预设、角色卡和全局脚本有各自生命周期，切换后的监听器、定时器和异步回调必须由宿主清理并拒绝过期版本。当前维护工具不能直接取消宿主运行任务；发现残留或重复结算时记录证据，交由宿主修复。原来关闭的全局脚本不能因“迁移”自动打开。

## 原存档与验收

资源保存不会自动迁移已开始的局。若用户要求原局继续且涉及变量结构，先读取 `tavern_read_skill_reference({name:"debug-card",path:"references/live-update.md"})`，按支持的迁移声明维护资源；不直接重写聊天文件或把所有历史状态替换成新初值。独立世界书可能共用，先确认修改的影响范围。

保存后用 `tavern_validate_card` 检查初值、规则、引用和脚本语法。真实验收需观察一次明确的前端操作和一次完成的后台结算，核对嵌套状态、派生字段、面板刷新及重新挂载。静态通过不证明数据库插件已运行，也不证明后台结算成功；报告观察到的状态变化与仍缺少的证据。
