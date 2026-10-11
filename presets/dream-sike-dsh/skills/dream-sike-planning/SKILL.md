---
name: dream-sike-planning
description: "梦境思客已启用写前决策流程时，核对材料并保存与当前回合绑定的简短写作准备；压缩或失败恢复后重新核对。"
metadata:
  tavern:
    purpose: writing
---

# 写前准备

调用 `sike_read_turn`，以 `presetContract`、玩家行动、最近正文和状态为本回合依据。`preparationRequired` 表示本局是否要求准备步骤。检查 `preparation.materials` 的截断标志；关键事实未覆盖时，调用 `worldbook_search`、`tavern_recall_history`、`tavern_read_variables` 或 `tavern_memory` 补读，不能把截断预览当作完整资料。

执行本局已启用的角色分析、文风和剧情推演要求。梦鲸思客默认决策流程要求内部考察至少三条候选事件链，各有两至三次因果连接，含主线和有持续影响的支线。只落实适合当前回合的推进。完整内部推理、未采用候选的分析与思考口号不写入工具、正文或工作窗。

用 `sike_prepare_turn({brief})` 提交六项各 8–400 字符的事实或执行约束：

- `scene`：当前地点、时间及本轮动作范围。
- `characters`：参与人物的既有性格、动机、能力约束。
- `knowledge`：谁知道什么；哪些秘密没有进入人物认知。
- `style`：本局已选叙事者、视角、文风、篇幅及可见格式。
- `progression`：本轮要呈现的互动与直接后果，不披露完整推演。
- `stopAt`：正文在哪里停住，留给玩家的下一步选择。

准备记录通过后调用 `sike_put_draft`。工具失败时依反馈重新读取，不沿用旧回合或旧规则的记录。更新已有草稿的准备会使审稿失效，需再次 `sike_check_draft`。完成标准是准备与本回合、分支、规则版本一致，正文经过六维审稿后可提交；结构通过不证明文学质量或内部候选数量。
