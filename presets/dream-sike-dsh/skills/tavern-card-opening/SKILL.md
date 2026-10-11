---
name: tavern-card-opening
description: "在卡片工作台维护开局页、可选开场和开局世界书联动；定位点选后输入未填入、重复发送或选项串局的问题。"
metadata:
  tavern:
    purpose: card
---

# 开局与交互

仅在卡片工作台维护资源。游玩前台负责本回合写作，不能借本 Skill 修改人物卡、全局世界书或正在进行的存档。

## 读取目标

先确定当前人物卡、要改的开场及期望操作。有关联的 `play-chat:` 时，用 `tavern_read_play_chat` 的 `layer: overview` 定位异常轮次，再按需读 `iframe`、`diagnostics`、`worldbook` 或 `input`。读取界面按钮标签、输入结果和错误摘要，不要求玩家提供模型的私有推理。

- `tavern_read_card`：`field: first_mes` 或 `alternate_greetings`，长内容按 `offset`、`limit` 分段。
- `tavern_read_card_raw`：按实际结构读取 `/data/extensions/regex_scripts` 和 `/data/extensions/tavern_helper`；旧卡可能从 `/extensions` 开始。先读结构，不凭路径猜脚本位置。
- `tavern_read_worldbook`：`path` 省略读取当前卡绑定世界书；以 `ref` 或 `query` 查开局相关条目。先区分内置书和共用的独立书。

## 维护边界

开场标记可能通过显示正则变成 HTML。检查原开场、正则替换和脚本三个环节，保留原有协议、选项数据与初始化字段。已授权维护时，以 `tavern_update_card.fields` 修改开场，以 `rawOperations` 的 JSON Pointer 修改具体扩展字段；世界书的资源修改使用 `tavern_update_worldbook.operations`，不通过 rawOperations 重写世界书。

开局预览属于私人准备区。按钮填入的内容进入“开局指令”，玩家明确开始后才提交到新局；已开始的局只能向自身输入框填入内容。填入与发送是不同操作，切换开场、销毁 iframe 或切换会话后，旧回调不能继续写入。不要把角色卡的 `parent.document` 操作当作宿主兼容层已支持的证明。

若开局脚本只开启条目，重新选择后可能残留旧选择。先确定本次选择管理的条目集合，保留公共常驻条目；资源编辑工具不能替代宿主的本局开局状态事务。当前 Agent 工具没有“选择开局”“提交开局准备”或“切换世界书绑定”接口，不能杜撰调用，也不能修改全局资源来模拟一次本局选择。

## 验收

保存后调用 `tavern_validate_card`，记录实际错误与警告。静态校验不会执行开局脚本；真实交互需在开局页核对：选项切换、指令填入、手动编辑、明确发送一次、切换卡后旧回调失效。浏览器脚本卡不能用 `tavern_test_response` 代替交互检查。

需要新现场时，给出最短复现步骤，由玩家在页面操作后读取新的诊断记录。报告修改字段、静态结果、已观察的交互结果及未验证项目；没有浏览器证据时不宣称开局还原成功。
