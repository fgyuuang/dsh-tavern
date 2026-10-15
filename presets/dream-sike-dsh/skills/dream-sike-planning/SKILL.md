---
name: dream-sike-planning
description: "梦境思客已启用写前决策流程时，核对材料并保存与当前回合绑定的简短写作准备；压缩或失败恢复后重新核对。"
metadata:
  tavern:
    purpose: writing
---

# 写前准备

调用 `sike_read_turn`，以 `presetContract`、玩家行动、最近正文和状态为本回合依据。检查 `preparation.materials` 的截断标志；按本局档位在正文前使用 1–2 次模型查询请求，关键事实未覆盖时按需调用 `worldbook_search`、`tavern_recall_history`、`tavern_read_variables` 或 `tavern_memory`。不要把截断预览当作完整资料，也不要为了覆盖所有资料重复检索。

读取已展开的作者规则页，依其完整任务顺序工作。原默认流程的“一、检设定”要求定位历史 uid、相关设定及其可产生的反应，并分别核对正文内与后置格式清单；“二、辨视角”使用本局所选人物分析；“三、遵写规”逐项执行写规并区分输入处理方式；“四、演叙事”考察至少三条因果事件链，再逐步执行选定叙事者核心。各章的具体原句以本局规则读取结果为准，不能用六项简报代替这些步骤。

`materialAreas` 映射原作者的设定、动态材料、历史和玩家输入区域；最近历史的来源引用只代表当前分支对应楼层，需要早期依据时召回原文。完整内部推理、未采用候选的分析与思考口号不写入工具、正文或工作窗。`preparationRequired` 表示要完成写前核对，不要求在正常新回合单独发起准备请求。

以下六项各 8–400 字符的事实或执行约束可作为 `sike_put_draft` 的可选 `brief`，与正文和审阅同次提交；正常新回合不单独调用 `sike_prepare_turn`：

- `scene`：当前地点、时间及本轮动作范围。
- `characters`：参与人物的既有性格、动机、能力约束。
- `knowledge`：谁知道什么；哪些秘密没有进入人物认知。
- `style`：本局已选叙事者、视角、文风、篇幅及可见格式。
- `progression`：本轮要呈现的互动与直接后果，不披露完整推演。
- `stopAt`：正文在哪里停住，留给玩家的下一步选择。

在写前核对中保留原作者完整步骤与六项事实要求；首次调用 `sike_put_draft` 时，可在同一请求的 `brief` 中提交 `scene`、`characters`、`knowledge`、`style`、`progression`、`stopAt`，无需单独调用 `sike_prepare_turn`。同次提交正文和六维审阅。审阅通过后由宿主检查并直接提交，不再调用独立 `sike_check_draft` 或 `sike_ready_draft`。若确实需要修订，按所选的 0–2 次修订请求额度，用一次批量 `sike_patch_draft` 同时提交局部补丁与更新后的审阅。失败时依工具反馈处理，不沿用旧回合或旧规则记录。

连续读取规则页时可省略重复的材料与草稿，使用 `includeMaterials=false`、`includeDraft=false`；读取当前草稿时可 `includeRules=false`。首次、压缩或重启后读取完整资料。平行事件及其他已启用附加模块在正文提交和状态结算后由一次独立后台调用生成，不进入主线草稿，也不参与正文前的查询预算。
