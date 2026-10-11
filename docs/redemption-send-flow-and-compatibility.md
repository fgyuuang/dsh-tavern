# 救赎之理：原酒馆一次发送链审计

日期：2026-10-11。只读原 ST 安装、迁移原件、当前 DSH 对话结构。未发送真实剧情、未修改角色卡或用户历史。本报告不复制限制绕过提示内容。

## 1. 审计对象与证据界限

- 原应用 SillyTavern 1.18.0，Tavern Helper 4.9.1，ST-Prompt-Template 1.17.3。
- 原设置当前选择 `梦鲸思客V4-0915`，main_api=openai，chat_completion_source=custom，custom_model=deepseek-flash。该名称是客户端请求标识，无法证明中转实际路由或服务端模型版本。
- 原 `characters/救赎之理.png` 的 chara 与 ccv3 两个数据块均与 DSH `resources/cards/救赎之理.json.raw` 完全相同。
- 原 OpenAI Settings 的预设和 worlds 的绑定世界书与 DSH originals 中对应 JSON 完全相同。
- 以下是现存配置与本机源码的静态链路，不是某个过去发送时刻的抓包。现有运行脚本加载成功、实际外部模块版本、监听器最后顺序、provider生效参数，需要运行时轨迹再确认。

## 2. 这个卡的能力实际上放在哪里

| 层 | 实际内容 | 意义 |
|---|---|---|
| 卡基础提示 | description、personality、scenario、system_prompt、post_history_instructions、mes_example全部空；first_mes为 `<开局>` | 不可只迁移角色描述来恢复体验 |
| 卡正则 | 7条均启用 | 2个大前端、变量块显示/请求清理、检定展示、卡专用分析展示 |
| 卡助手脚本 | 变量结构、MVU基础脚本、开局世界书联动，3个enabled | 初始化schema、MVU运行、开局选项激活 |
| 世界书 | 109条，现存17条启用，原文本合计60,800字符 | 核心设定、剧情阶段、人物、检定、变量与卡专用写作决策 |
| 预设 | 31条非空提示启用，原文本合计10,524字符 | 文风、视角、玩家输入处理、叙事、输出协议等 |
| 预设正则 | 27条，24启用 | 分别处理请求历史、落地文本与显示效果 |
| 预设助手脚本 | 6个外层enabled | 请求投影、格式补全、已公开思考字段提取、设置UI、适配与补丁 |

60,800与10,524是字符数，不是token数；宏替换、变量注入、筛选和消息重排后会变化。

## 3. 首次开局：点击界面不是直接发送

1. ST呈现卡first_mes的 `<开局>`。
2. 卡正则“开局”只在markdown显示路径将该标记替换为143,615字符HTML。HTML执行于Helper前端iframe；这些UI代码本身不应进入模型请求。
3. 用户选世界、套组/人物、阶段、降临方式等，本地状态S收集表单。
4. 点击开始调用 `start()`（开局replaceString第948行）。逐项写环境、人物和初始状态，累计成功计数。
5. 按选项收集应开启的书条目，写“环境与剧情.开局激活”标记，调用syncWorldbook开启。此版只开启，从不关闭：重新选择套组可能使旧条目与新条目并存。
6. `start()`生成包含选项、人设和初始化任务的玩家开场文本，调用pushToInput。
7. `pushToInput()`第422–430行查找parent.document中的`#send_textarea`，直接设置value，派发input，focus。
8. 成功时UI明确提示“已写入输入框，按回车”，代码没有自动调用Generate或发送按钮。
9. 后续人物面板物品按钮和建议按钮也直接写parent.document的`#send_textarea`（前端replaceString919–934行）。

因此点击界面后无法写入/发送，应首先检查iframe与宿主输入框的兼容桥。这与提示词是否注入属于两条独立链路。

## 4. 原 ST 点击发送后的确定顺序

### A. 创建玩家消息

- `public/script.js:4231` Generate入口；4262发GENERATION_AFTER_COMMANDS。
- 4342读取`#send_textarea`，4343清空输入并派发input。
- 4394调用sendMessageAsUser；5815定义该函数，5816执行USER_INPUT落地正则。
- 玩家消息写入chat，发MESSAGE_SENT，保存/渲染。

### B. 准备请求历史与世界书

- `script.js:4447` 对每个已有消息执行isPrompt=true的历史正则，保留原存储消息、清理请求投影。
- 4576调用getWorldInfoPrompt，书加载→扫描→激活事件发生在这一步。
- `world-info.js:4492` WORLDINFO_ENTRIES_LOADED；5056 WORLDINFO_SCAN_DONE；902 WORLD_INFO_ACTIVATED。
- 位置0是before；位置4是atDepth。变量规则/变量当前列表/卡专用召回位于depth0，role0。静态设定、人物、剧情、卡专用分析等主要在位置0。
- 梦鲸消息处理同时监听书相关事件，按规则把静态常驻条目提取到lora_constant、关键词和动态条目提取到lora_key。ACU/Ruby/柏宝提取规则启用，只说明已配置接口，不能证明本卡存在数据。

### C. 按预设装配、宏替换与请求重排

- `openai.js:1533` prepareOpenAIMessages；脚本5230附近调用该函数。
- 按prompt_order加载启用项；变量初始化、setvar/addvar/getvar等按装配次序生效。
- 实际启用：梦白话文风、信息差、角色言行控制、第三人称、转述抢话、平衡叙事、动态长篇1000–2000字、通用角色分析、默认思维链、场景信息、平行事件、写作模式等。
- 当前“梦境自检修复 - 反八股”生成提示disabled；助手脚本enabled不等于每轮模型会生成修复块。
- `openai.js:1610`发CHAT_COMPLETION_PROMPT_READY。
- `script.js:5259`发GENERATE_AFTER_DATA。梦鲸消息处理可在此预处理条目/分隔符；随后在CHAT_COMPLETION_SETTINGS_READY完成最终请求重排。
- 原script.data.chat_history= squash_into_one，squash_role=user；玩家、正文、系统材料分别以dream_instruction/dream_plot/dream_system及楼层ID包裹，再把指定历史区拼成user消息。
- 外层原聊天角色与最终发送角色因此不一定相同。它是客户端请求投影，不是provider权限提升。

### D. EJS与最终请求参数

- `openai.js:3052`发CHAT_COMPLETION_SETTINGS_READY，3054后POST `/api/backends/chat-completions/generate`。
- EJS的handleChatCompletionReady在此调用processGenerateAfter；`handler.ts:201`，循环在250附近。
- 每个文本message明确先applyRegex(generate=true)，后evalTemplateHandler，再包围已启用的GENERATE BEFORE/AFTER加载器。
- 在main_api=openai时，EJS的GENERATE_AFTER_DATA处理会主动skip（handler.ts174–196），因此不能将该事件称为当前OpenAI模式的EJS最终求值点。
- 梦鲸请求改写、EJS和Kimi适配同用SETTINGS_READY；哪些监听器最终先后取决于加载与eventMakeLast注册顺序。源码能确定hook阶段，不足以证明某次动态注册的总顺序。
- 此卡与已启用梦鲸提示未发现 `<%` EJS代码。EJS扩展启用不代表该卡实际依赖任意EJS程序；宏是另一种机制。

### E. Kimi适配在这个配置中没有生效证据

- 脚本外层enabled=true，但script.data.enabled=false。
- 三个assistant预填充提示全部disabled，assistant_prefill为空。
- 其实现只对最后非空assistant消息设置partial=true，拒绝dryRun、结构化输出和工具消息；本配置未启用，不能把当前体验归因于Partial Mode。

### F. 接收、状态与显示

- `script.js:6422` AI_OUTPUT落地正则可改变存储正文；`script.js:1809` messageFormatting另执行isMarkdown=true显示正则。
- regex engine334–380严格区分普通、markdownOnly和promptOnly；顺序来自GLOBAL→SCOPED(card)→PRESET（98–133）。同一个regex可同时指定promptOnly和markdownOnly，作用于两个不同阶段。
- 变量请求块屏蔽不会自动删除存储里的变量；“前端”HTML显示正则也不会自动把HTML发模型。
- MVU按UpdateVariable/JSONPatch更新message variables.stat_data；卡人物面板从getAllVariables().stat_data读取，等待Mvu初始化并监听VARIABLE_UPDATE_ENDED重绘。
- 卡专用的检定、剧情阶段、人物状态与环境条目也在约束生成；还原梦鲸预设仍不能替代这些卡书规则。
- EJS渲染handler.ts409起，在CHARACTER_MESSAGE_RENDERED makeFirst。raw_message_evaluation_enabled可执行原消息模板并保存后重绘，然后处理显示HTML模板。不能概括为“EJS只显示、不修改历史”。
- Helper前端在可呈现HTML生成后创建iframe，再执行卡UI和交互。
- MESSAGE_RECEIVED上各插件也有回调。MVU、EJS、思考字段提取、补丁之间是否发生二次重绘，需实际运行轨迹确认，不把静态代码排列当总顺序。

## 5. 原先严格纠正功能的实际边界

- 格式补全1.2主要是按钮/操作触发：截获当前assembled prompt，再通过generateRaw进行一次只补后置格式的请求，插入/替换指定后置区。不是默认每次玩家发送都会自动第二次模型调用。
- 思维链提取脚本从响应/消息中已有reasoning等字段提取，并插入正文供正则处理。读到reasoning_content只意味着provider已经公开此字段，不能取得未公开的内部推理。
- 梦境自修复在MESSAGE_RECEIVED解析dream_self_check中的patch，通过FIND/REPLACE改dream_body/dream_parallel_event、记录修改并提供逆向。旧实现对每个正则找首个可匹配片段，没有新版Agent要求的唯一命中和草稿版本CAS。
- 对应生成提示当前disabled。若模型没输出检查/patch块，脚本没有任何内容可应用。
- 卡专用“思维链”启用，文本6639字符；“思维链召回”也启用、depth0。可迁移的是角色一致性、信息差、数值因果、节奏与检定等可观察写作/状态职责，不应把显示完整私有推理当作还原验收。

## 6. “破限”到底有哪些东西

现有资产可证明：角色/叙事框架、后置行为约束、消息包装与请求角色重排、渠道格式标记、对输出结构的约束、响应后清理/补丁。它们可能改变模型对写作任务的理解和最终可见文本。

现有资产不能证明：解除provider的服务端内容政策、解锁实际上下文窗口、改变账户权限、读取未公开推理、突破输出上限、保证每次模型服从。

原预设配置openai_max_context=2,000,000、openai_max_tokens=30,000；原当前设置max_tokens=300,000。它们是客户端预算/参数，不是实际模型窗口证明。最终实际值还取决于请求构造、后端适配、中转和provider。本卡在当前原设置function_calling=false，不是多工具Agent循环。

缓存改善也不能只凭“压缩相邻消息”名称判定。该脚本是拼接/投影，不是DSH的记忆压缩摘要；是否提高cache hit需使用实际usage/cacheReadTokens比较。

## 7. DSH额外发现：开局变量写错层，独立于输入故障

只读原4个救赎对话，至少两个DSH开局实际保存了错误变量形态：

- chat-muzu45q5-kp1iwi的row0及chat-muztnly1-4yo451的row0，variables[0]根存在字面“环境与剧情.基础世界”“环境与剧情.开局激活”“待赎者状态.基本信息.名字”等键；同时stat_data已有正常嵌套对象。
- 后续部分正文结算还在stat_data内部产生字面带点键，与正常嵌套对象并存。
- 未打印任何私密值，只比对键名与类型。

源码解释：开局findVarFn优先updateVariable，再Mvu.setVariable，再insertOrAssignVariables({[path]:value})。当前DSH bootstrap未实现前两个路径写接口；insertOrAssignVariables直接mergeWith，不把字面带点键当路径。因此fallback看起来成功，但状态栏、变量列表和开局联动读的是stat_data的嵌套字段，不能读到这份根层影子状态。

正确修复边界：增加明确MVU路径写桥（目标message variables.stat_data），保持标准insertOrAssignVariables对普通带点字面键的语义，避免全局暗改所有Helper变量API。旧局数据修复需确认来源/冲突，不能直接全局把所有带点键拆开并覆盖历史。

卡UI函数摘录：D:/pro/DSH-Tavern/temp/redemption-opening-variable-bridge-20261011.js。该摘录仅含接口函数，无提示词/私密值。

## 8. 可点击源位置

- [原preset消息处理配置](<D:/pro/SillyTavern Launcher GUI/data/st_data/default-user/OpenAI Settings/梦鲸思客V4-0915.json:2503>)
- [原preset历史拼接配置](<D:/pro/SillyTavern Launcher GUI/data/st_data/default-user/OpenAI Settings/梦鲸思客V4-0915.json:2728>)
- [原preset格式补全](<D:/pro/SillyTavern Launcher GUI/data/st_data/default-user/OpenAI Settings/梦鲸思客V4-0915.json:2747>)
- [原卡世界书变量规则](<D:/pro/SillyTavern Launcher GUI/data/st_data/default-user/worlds/- 救赎之理.json:46>)
- [原卡世界书变量当前值](<D:/pro/SillyTavern Launcher GUI/data/st_data/default-user/worlds/- 救赎之理.json:166>)
- [原卡专用决策要求](<D:/pro/SillyTavern Launcher GUI/data/st_data/default-user/worlds/- 救赎之理.json:646>)
- [DSH卡开局UI存放位置](D:/pro/DSH-Tavern/data/harness/profile-data/tavern/data/resources/cards/救赎之理.json:142)
- [原ST Generate](<D:/pro/SillyTavern Launcher GUI/data/sillytavern/1.18.0/public/script.js:4231>)
- [原ST请求与最终hook](<D:/pro/SillyTavern Launcher GUI/data/sillytavern/1.18.0/public/scripts/openai.js:3044>)
- [原ST正则阶段选择](<D:/pro/SillyTavern Launcher GUI/data/sillytavern/1.18.0/public/scripts/extensions/regex/engine.js:334>)
- [原EJS生成阶段](<D:/pro/SillyTavern Launcher GUI/data/sillytavern/1.18.0/public/scripts/extensions/third-party/ST-Prompt-Template/src/modules/handler.ts:201>)
- [原EJS渲染阶段](<D:/pro/SillyTavern Launcher GUI/data/sillytavern/1.18.0/public/scripts/extensions/third-party/ST-Prompt-Template/src/modules/handler.ts:409>)
- [DSH变量merge](D:/pro/DSH-Tavern/source/tavern-plugin/src/client/runtime/helper-bootstrap.js:484)
- [DSH MVU bootstrap](D:/pro/DSH-Tavern/source/tavern-plugin/src/client/runtime/helper-bootstrap.js:721)

## 9. 原 Helper fallback 的进一步核对

原 Helper 4.9.1 的 src/function/variables.ts:241–249 也采用 mergeWith，默认变量作用域是 chat；不解释点号路径。DSH bootstrap 的 optionOf 缺省为 message。本卡 fallback 未指定作用域，也未包 stat_data，因此卡在缺少自定义 updateVariable/Mvu.setVariable 的原 ST 环境中同样有潜在错误。可以确定的是当前 DSH 已存在该实际错误，不能仅凭这一点宣称原酒馆以前一定正确。

[原 Helper 标准合并语义](<D:/pro/SillyTavern Launcher GUI/data/sillytavern/1.18.0/public/scripts/extensions/third-party/JS-Slash-Runner/src/function/variables.ts:241>)

## 10. 本轮修复与验收

- 顶层隐藏的 `send_textarea` 原先只响应发送按钮，没有输入同步。已补明确所属 iframe → 本局 `/setinput` → 原生 `input.setDraft`，单纯填入不触发生成；失效帧和不明确归属拒绝写入。
- 当前桌面另处于“酒馆后台 Agent”视图，原生底部明确提示父会话不在线、子代理只读。点击本局游戏历史后回到前台，键盘输入已实际验证，验证草稿清除，没有发送用户消息。新增“返回剧情对话”按钮，保留后台检查入口。
- 卡开局非标准 `updateVariable(path,value)` 补为当前楼层 `variables.stat_data` 的嵌套写入；串行合并、等待存储、失败回滚，拒绝原型路径。保留标准 Helper 合并语义。旧局带点影子键及已有正文结算错误不批量覆盖，需要独立按来源和冲突审计。
- 新“本局设置 → 预设功能设置”：剧情理解与角色、文风与叙事、格式与修订、其他规则、正则与渲染、脚本接管状态。支持本局规则开关和文本编辑，保存生成新的持久快照、重算契约和正则，下回合生效。Agent 接管的协议只读展示并允许切换，不假装修改原文会改变适配器。
- 保存检查前后台空闲、存储版本与快照摘要；成功后清理旧脚本生命周期。修改不影响预设库原文件、新局默认值、历史和变量。
- 88 项针对性测试全部通过，含两个真实 Edge Chromium 测试。原卡 143k 开局 HTML 与 47k 状态前端直接执行原有事件；覆盖开始、建议、物品遮罩、手工编辑、单次发送、双帧隔离、卸载过期回调。原卡测试使用合成变量与世界书 API，没有调用模型或修改用户数据。
- 真实 React 设置界面通过展开规则、修改剧情分析、保存、保存失败保留输入、重试与返回父会话验收；生产保存 RPC 另验证版本竞态、空闲限制和历史保留。
- 这仍不等于原卡全部脚本已完美还原。原开局世界书只开启不关闭、已有错误变量形态、旧局后台中断，以及卡专用决策/检定约束在 Agent 下的正文品质需继续分项验收。未宣称解除提供商限制，也未以隔离浏览器测试代替当前桌面完整生成轨迹。

验收日志：`D:/pro/DSH-Tavern/temp/redemption-compatibility-checks-20261011.log`。
