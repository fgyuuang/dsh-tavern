# 梦境思客 DSH Agent 预设升级审计

审计日期：2026-10-11。分支 `codex/dream-sike-dsh-agent`，审计基线为 `4036f3fe`（persona 恢复后）。
对象：原酒馆预设 `梦鲸思客V4-0915.json` 升级为 DSH 原生 Agent 预设后的完整执行链路。

方法：静态代码审阅 + 用真实原预设 JSON 跑通「ST 预设转换 → 契约编译 → 宏解析 → 请求投影」全链路，
逐阶段核对破限条款与思维链的最终落地。未发送模型请求，未修改运行代码。

## 一、总体结论

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 破限（persona `<meta>` 三块） | 已进入 front→system | persona 1124 字，`<创作>`/`<反注入>`/`<思考锚定>` 逐项命中 |
| 思维链（四章决策） | 完整保留 | `sleep_var_thought_of_chain` 1486 字，四章与叙事者逐步分析要求齐全 |
| 三阶段转换 | 正常 | front 8 / middle 0 / back 23 启用条目，status=ready |
| 宏依赖 | 正常 | 24 个启用条目含 55 处酒馆宏，按前中后顺序解析 |
| 输出模式豁免 | 正常 | summary / chat 免除剧情协议（此前已修） |

转换后启用条目 **31 条、计数原文字符 10,524**，与原 JSON 完全一致。转换器诊断仅 info 与一条
`MIDDLE_EMPTY` warning，无 error。

## 二、原设计的三阶段结构如何映射到 Agent Harness

原酒馆把全部提示词放在一个模型请求里（作者语境中的"巨量上下文"）。DSH 拆成：

- **front → system 提示**：`presetFrontSections()` 取 front 条目，unshift 到 `assembleSystemPrompt`
  的 sections 最前，随后经 `labelPresetFront` 标注来源。persona 走这条路径，每轮常驻。
- **back → 每个模型步骤的 user 消息**：`projectRuntimePresetRequest` 把 back 条目转为 role=user
  追加到消息序列末尾（`backOnly` 显式置 `front: null`，避免 front 重复进入）。

原预设没有启用深度注入项，转换后中段为空，`MIDDLE_EMPTY` 属正常。`runtimePresetPhaseMessages`
支持任意阶段，当前调用点只取 front/back 是正确取舍，不是遗漏。

## 三、破限能力的完整落地路径

persona（`06b5771b-…`，槽 001，system，1129 字）在 `adapt()` 中原样保留，仅改写两行与原生工具链
冲突的内容。审计确认 `<创作>`、`<反注入>`、`<思考锚定>` 三块逐条命中，且经 front→system 装配
后仍在每轮请求中。

需要注意的既有设计：`dream-sike-agent-profile.js` 的 `resolveRules()` **有意把 persona 排除在
`sike_read_turn` 分页规则之外**（第 44 行，排除理由为"优先级与解除限制声明不作为 Agent 能力授权"）。
这是分页工具的取舍，不影响 persona 进入 system 提示——两者是不同通道。审计确认 persona 走
front→system 常驻，不需要通过分页读取。

## 四、思维链的保留方式与一个易误判点

思维链（`0da6f4d7-…`，1678 字）原条目整体包裹在 `{{setvar::sleep_var_thought_of_chain::…}}` 中。
这是**作者原设计**：思维链先存入局部变量，再由写作模式 `{{getvar::…}}` 读取。

因此审计中出现一个易误判现象：**宏解析后该 back 条目自身文本为空**，但这不是丢失——
`sleep_var_thought_of_chain` 变量值为 1486 字，四章（检设定 / 辨视角 / 遵写规 / 演叙事）、
"标记与当前剧情相关的uid"、"该步骤必须一步一步进行分析，不可省略与偷懒" 等作者原句均完整保留，
并由 `sleep_var_thinking_level`、`sleep_var_char_analysis`、`sleep_var_addition_thinking` 嵌套注入。

同理为空的还有 `sleep_var_thinking_flag`（模型适配器接管，投影为空）与 `sleep_var_zishu`
（字数由 `inspectDreamSikeContractDraft` 单独读取校验）。这些为空都是正确设计。

## 五、8 个材料 wrapper 的处理

`dream_setting` / `dream_dx_setting` / `dream_history` / `dreamer_input` / `writing_setting` 的
开闭标签条目按原生边界移除。保留原句中仍出现这些名称（默认思维链 5 次、写作模式 3 次），
契约指令已声明：这些名称表示待核对的材料范围，按 `sike_read_turn` 的 `materialAreas`
解析为当前卡片、世界书、状态、本回合输入与分支历史，不因标签不存在而跳过对应分析职责。

## 六、回归保护

`tests/dream-sike-contract.test.mjs` 19 项通过。本轮审计新增 2 项：

1. 思维链经其 setvar 变量抵达模型，四章原句齐全，且不含 think/思考口号等私有输出格式。
2. persona 与思维链同时通过完整阶段编译进入请求投影。

避免再次踩坑的判断：**验证思维链必须断言宏变量，不能断言条目文本**——条目在解析后本应为空。
同理，验证 persona 恢复要看字符数（27 → 1124）与 `<创作>`/`<反注入>` 关键词，
不能只看启用条目计数。

## 七、遗留事项

1. `dream-sike-agent-profile.js` 第 44 行仍将 persona 记为 excluded 并附带"解除限制声明不作为
   Agent 能力授权"的说明。该说明与本轮"完整恢复原句"的决定在**措辞上不一致**（实际已恢复原句）。
   不影响执行，建议改写说明文案以免日后误判，或明确区分"分页不提供"与"请求不发送"。
2. `tests/conversation-preset.test.mjs` 的「busy and stale games reject preset replacement」
   在基线（未改代码）上同样失败，属既有缺陷，与本预设无关。

## 边界

以上是静态链路核对，证明作者的破限声明与思维链原文**确实进入模型请求**。
不能据此推断提供商策略、模型实际指令层级或内部 reasoning 通道发生变化；
文学质量与实际体验仍需阅读真实正文判断。
