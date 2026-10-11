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

1. `tests/conversation-preset.test.mjs` 的「busy and stale games reject preset replacement」
   在基线（未改代码）上同样失败，属既有缺陷，与本预设无关。

## 八、收敛改造移除（2026-10-11 第三轮）

用户要求"尽可能还原、去除 Codex 的收敛改造"。以真实预设逐条量化每个启用条目在 `adapt()`
前后的字符损失，再逐条判定是"必要的工具适配"还是"削弱作者职责"。

### 8.1 persona 不再被排除在规则分页之外

`dream-sike-agent-profile.js` 原先把 persona 记入 `excluded`，理由为"解除限制声明不作为 Agent
能力授权"。现已移除该排除：persona 与其他作者规则一样参与 `sike_read_turn` 分页，
`excluded` 恒为空数组，并新增 `selected.persona` 便于直接索引；阶段映射为 `role-scene`。

persona 此前已通过 front→system 常驻进入请求，因此这次改动**不是修复"破限不生效"**，
而是移除一处会误导后续维护者的错误声明，并让分页读取也能取到原文。

### 8.2 思维链与 meta 的绑定被误删

量化比对发现 `adapt()` 对默认思维链移除的行中，有一条并非输出格式，而是作者的**职责声明**：

> `- 你在思考前，必须需要严格遵守"<meta>"协议进行思考。`

这条把写前决策链绑定到 persona 的 `<meta>`（即破限协议）上。Codex 把它与 think 标签、
思考口号一并当作"私有推理格式"删除，结果是**思维链与破限在文本层脱钩**——两者各自保留，
但作者设计里"思考时同样遵守 meta"的联动消失了。

已恢复该行（同时保留 `- ` 列表前缀）。思维链变量长度 1486 → **1548 字**。
另把"终、定乾坤"一行补上"草稿只提交一次，不在正文重复或重述核对内容"，保留作者的
不重复意图，而非仅替换为工具调用。

### 8.3 确认为必要、未改动的适配

逐条核对后，以下移除是正确取舍，予以保留：

| 条目 | 移除内容 | 理由 |
| --- | --- | --- |
| 写作模式 | "最终输出内容必须为一个xml文档" | 已由 DREAM_PLOT 外壳 + 草稿工具承载 |
| V4.1 flash | "独立1000token的思考" | 伪预算，DSH 无法兑现 |
| 平行事件 | `<simple_thinking>` 围栏、400 字预算 | 私有推理输出格式 |
| 8 个材料 wrapper | 标签本身（178 字） | 原生边界由 `materialAreas` 承接 |
| 模型适配条目 | DeepSeek think 前缀、预填充 | 交给原生模型适配器 |

### 8.4 作者可选模块的复刻完整性

作者全部可选模块在 DSH 预设中原样留存（按原设定关闭，可在设置页开启），开启后验证适配正确：

- 三个成人场景文风（温和/感官/古风）以 `addvar` 累积进 `sleep_var_wenfeng`，长度 1110 → **2379**
- 成人叙事者「色色之黄」进入 `sleep_var_tuijin`
- 自检协议 1250 → 1210 字，全文扫描、逐句认知核对、唯一 FIND 三项核心均在
- 八股超杀 1270 → 1293 字

同时确认 `色色防回避`（槽 031）是**启用**的正常文风项，与被删的 persona `<meta>` 是两件事。

### 8.5 回归

`tests/dream-sike-contract.test.mjs` 20 项通过（本轮新增 meta 绑定测试）；
`tests/dream-sike-agent-profile.test.mjs` 8 项通过（persona 排除测试改为断言新行为）；
顺序执行 11 个相关测试文件共 **94 项全绿**。

## 边界

以上是静态链路核对，证明作者的破限声明与思维链原文**确实进入模型请求**。
不能据此推断提供商策略、模型实际指令层级或内部 reasoning 通道发生变化；
文学质量与实际体验仍需阅读真实正文判断。

