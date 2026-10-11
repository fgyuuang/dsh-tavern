# 梦鲸思客 V4-0915：正则、助手、设置与请求处理只读取证

取证日期：2026-10-11。此报告只解析用户指定 JSON 与本地对应源码，没有执行附带脚本，没有远程加载，没有改动运行文件或聊天。

## 1. 对象与结论

- 指定文件：`D:/pro/SillyTavern Launcher GUI/other/梦鲸思客V4-0915.json`。
- DSH 对照预设：`D:/pro/DSH-Tavern/data/harness/profile-data/tavern/data/resources/presets/梦鲸思客V4-0915.json`。两者解析后的 JSON 完全相同。
- 119 个 `prompts`，115 个顺序项；当前顺序内 39 项启用，其中 31 项内容非空。
- 27 条正则，24 条启用；6 个助手脚本外层全部启用，Kimi 内部 `data.enabled=false`。

**目前 Agent 适配不是原提示词工程的完整复刻。**

1. `D:/pro/DSH-Tavern/source/tavern-plugin/lib/domain/dream-sike-mode.js:93` 在 `dream-sike-dsh` 模式直接返回空的预设脚本集合，六个预设助手全部停止运行。
2. `D:/pro/DSH-Tavern/source/tavern-plugin/lib/domain/dream-sike-contract.js:43` 的 `adapt()` 删除已知原材料边界条目；用自写文本替代原 persona、默认思维链、V4.1flash 思考强度、模型适配、自检修复，并修改平行事件与写作模式。
3. 保留正则和部分文风文字，不自动保留消息处理器的请求布局、动态宏处理、缓存锚点、设置助手组合切换、格式补全第二次请求。

这些差异足以改变叙事体验。工具流程通过不能等同于原体验还原。

## 2. 正则分层权威

对应本地 SillyTavern 1.18.0：`D:/pro/SillyTavern Launcher GUI/data/sillytavern/1.18.0/public/scripts/extensions/regex/engine.js:334`。

- `markdownOnly=true`：显示处理。
- `promptOnly=true`：发给模型的请求投影。
- 两者都为 true：分别参与显示与请求，不要求同时处于两种状态。
- 两者都为 false：正式消息处理，原引擎不在 prompt/display 调用中重复运行。
- placement 1 为用户输入，2 为 AI 输出。
- 全部 27 条 `runOnEdit=true`、`substituteRegex=0`；没有隐藏的正则替换宏开关。
- 启用不证明执行；执行还取决于层、placement、depth、源文本是否匹配及 runtime 生命周期。

下面序号从 1 开始，JSON 定位下标从 0 开始。

- 文件 SHA-256：`77e620d002e2be7b12c2785333702178ea95112e7c8e60f521e818974d284f0b`。

|序号|名称|启用|placement|markdownOnly|promptOnly|depth|功能|JSON 定位|
|---|---|---|---|---|---|---|---|---|
|1|[🚫删除]正文后思考|关|[2]|False|False|None..None|正式 AI 消息；删除 dream_after_thinking|`/extensions/regex_scripts/0`|
|2|[🥷隐藏]隐藏多余格式内容|开|[2]|True|True|None..None|请求与显示；去 dream_body、dream_after_format 外标签|`/extensions/regex_scripts/1`|
|3|[🥷隐藏]正文后思考 - 旧|开|[2]|True|True|None..None|请求与显示；去 dream_after_thinking|`/extensions/regex_scripts/2`|
|4|[🥷隐藏]八股超杀V2 - 隐藏草稿内容|开|[2]|True|True|None..None|请求与显示；去整行 HTML 注释草稿|`/extensions/regex_scripts/3`|
|5|[🥷隐藏]思考正则格式化|开|[2]|False|False|None..None|正式 AI 消息；补 think 起止边界|`/extensions/regex_scripts/4`|
|6|[🥷隐藏]思考正则隐藏 - 备用方案|开|[2]|False|True|None..None|请求；删除 think 区块|`/extensions/regex_scripts/5`|
|7|[🥷隐藏]选项框不发送|开|[2]|False|True|None..None|请求；删除 dream_option|`/extensions/regex_scripts/6`|
|8|[🥷隐藏]对AI隐藏 10 层内摘要（仅启用了摘要才生效）|开|[2]|False|True|None..10|请求；maxDepth=10，删除 dream_summary|`/extensions/regex_scripts/7`|
|9|[🥷隐藏]10 层外只显示摘要（仅启用了摘要才生效）|开|[2]|False|True|11..None|请求；minDepth=11，整篇替换为 dream_summary 内文|`/extensions/regex_scripts/8`|
|10|[🥷隐藏]对AI屏蔽MVU变量更新|开|[2]|False|True|None..None|请求；删除 UpdateVariable|`/extensions/regex_scripts/9`|
|11|[🥷隐藏]对AI隐藏 2 层外的思客说书|开|[2]|False|True|2..None|请求；minDepth=2，删除 dream_discuss|`/extensions/regex_scripts/10`|
|12|[🥷隐藏]对AI隐藏 2 层外的用户大输入|开|[1]|False|True|2..None|用户请求；minDepth=2，去 dream_answer 外壳但保留回答|`/extensions/regex_scripts/11`|
|13|[🥷隐藏]对AI隐藏思客大调查|开|[2]|False|True|None..None|请求；删除 dream_big_discuss|`/extensions/regex_scripts/12`|
|14|[🥷隐藏]对AI隐藏平行思考|开|[2]|False|True|None..None|请求；删除 simple_thinking|`/extensions/regex_scripts/13`|
|15|[🦋美化]思考正则美化 - 二选一|关|[2]|True|False|None..None|显示；将 think 转折叠 details|`/extensions/regex_scripts/14`|
|16|[🦋美化]思考正则隐藏 - 二选一|开|[2]|True|False|None..None|显示；删除 think|`/extensions/regex_scripts/15`|
|17|[🦋美化]梦鲸摘要|开|[2]|True|False|None..None|显示；摘要转 details|`/extensions/regex_scripts/16`|
|18|[🦋美化]思客说书|开|[2]|True|False|None..None|显示；说书转 details|`/extensions/regex_scripts/17`|
|19|[🦋美化]思客大调查|开|[2]|True|False|None..None|显示；大调查 HTML/JS 交互界面（16,334 字符）|`/extensions/regex_scripts/18`|
|20|[🦋美化]八股超杀过程美化 - V2版本|关|[2]|True|False|None..None|显示；HTML 注释分析过程美化|`/extensions/regex_scripts/19`|
|21|[🦋美化]梦境状态栏|开|[2]|True|False|None..None|显示；date/time/location 状态栏（5,768 字符）|`/extensions/regex_scripts/20`|
|22|[🦋美化]梦境平行事件|开|[2]|True|False|None..None|显示；平行事件 HTML/JS（24,769 字符）|`/extensions/regex_scripts/21`|
|23|[🦋美化]梦境选项框|开|[2]|True|False|None..None|显示；选项框 HTML/JS（25,285 字符）|`/extensions/regex_scripts/22`|
|24|[🦋美化]梦境自修复|开|[2]|True|False|None..None|显示；自修复 HTML/JS 面板（23,319 字符）|`/extensions/regex_scripts/23`|
|25|[🥷隐藏]删除额外标签|开|[2]|True|True|None..None|请求与显示；删除额外边界与 done 标签|`/extensions/regex_scripts/24`|
|26|[🥷隐藏]特殊空行合并，放到最后|开|[2]|True|True|None..None|请求与显示；多空行压成两行|`/extensions/regex_scripts/25`|
|27|[🥷隐藏]梦境自修复|开|[2]|False|True|None..None|请求；删除 dream_self_check|`/extensions/regex_scripts/26`|

### 2.1 组合含义

- 默认不展示完整 think：#16 开，#15 关。
- 结构标签先进入正式文本，再独立投影；若把显示去标签结果覆盖唯一原文，自修复可能无法定位 dream_body。
- #8/#9 是消息深度过滤，不是永久摘要数据库，只有正文真有 dream_summary 才生效。
- #11/#12 的实际 minDepth=2；不能用名字“2 层外”猜值。
- 模型侧删除 HTML UI、摘要、变量更新的职责不同，不能统一清洗全部标签。
- 数组顺序影响连续替换；#26 虽名“放到最后”，真实数组中后面还有 #27，应保留实序。

### 2.2 原显示界面操作

- #19 大调查将回答包装为 `<dream_answer q="...">回答</dream_answer>`，写父页面输入框并触发输入事件，不自动生成。
- #23 选项框有可配置填入/发送，优先 `createChatMessages` + `triggerSlash('/trigger')`，还有 `#send_but` DOM 路径。按 chat ID 隔离、CustomEvent 共享设置、pagehide 清理监听器。
- #24 自修复 UI 自己不改正文；使用四类 `dream-self-repair:*` DOM 事件请求状态、重 Patch、反 Patch。连接超时 1.8 秒、动作超时 6 秒；pagehide 清理。
- #21/#22 包含主题、布局和交互展示；重写为普通 Markdown 表格会改变体验。

## 3. 六个助手与依赖

共同依赖：全部检查 Tavern Helper >=4.0.0；检查只发 toastr.error，静态代码不能证明版本不足立即停止。全部远程 import compare-versions、JSON5、jsonrepair、zod/core，源域 testingcf.jsdelivr.net。除自修复外还有 Pinia；多个脚本使用 klona。Vue、$、_、z、TavernHelper globals 由运行环境提供。

多数 npm URL 未锁版本，Pinia 部分锁 3.0.4。没有远程加载，本报告不证明 CDN 可达或这些模块正在运行。

多个脚本使用 `th_unique_check.<功能名>`，读取 `#tavern_helper div[data-script-id]` 排序，只让最后面的同功能启用实例实际运行。这是预设脚本覆盖重复角色/全局脚本的真实机制。

|序号|名称|外层|内层/实际触发条件|按钮|源码长度|JSON 定位|
|---|---|---|---|---|---|---|
|1|梦鲸思客消息处理 3.0 （原压缩相邻消息）|True|没有 data.enabled 关闭项；仍需运行条件满足|无可见按钮|139,951|`/extensions/tavern_helper/scripts/0`|
|2|格式补全 1.2|True|用户按钮触发，不逐轮自动执行|格式补全|20,360|`/extensions/tavern_helper/scripts/1`|
|3|思维链提取到正文 1.0|True|没有 data.enabled 关闭项；仍需运行条件满足|无可见按钮|13,167|`/extensions/tavern_helper/scripts/2`|
|4|梦鲸思客预设助手 2.3|True|没有 data.enabled 关闭项；仍需运行条件满足|梦鲸思客设置|880,038|`/extensions/tavern_helper/scripts/3`|
|5|Kimi前缀预填充 1.0|True|data.enabled=false，Partial 当前关闭|无可见按钮|11,295|`/extensions/tavern_helper/scripts/4`|
|6|梦境自修复 1.0|True|生成自检的 prompt 当前关；有 dream_self_check 才自动修补|无可见按钮|9,294|`/extensions/tavern_helper/scripts/5`|

### 3.1 消息处理 3.0

来源 `/extensions/tavern_helper/scripts/0`。

当前 `entry_processing.mode=worldbook`；`chat_history.type=squash_into_one`、`squash_role=user`；双换行 delimiter。

实际链：

1. GENERATION_AFTER_COMMANDS 注入聊天头、深度分割、尾三个标记，获取本轮真实历史。
2. WORLDINFO_ENTRIES_LOADED、WORLDINFO_SCAN_DONE、WORLD_INFO_ACTIVATED 收集真实加载、排序、激活条目。
3. 判定动态宏、递归安全 getwi；拆分纯多 getwi 聚合条目，避免静态段被动态段污染。
4. 非动态关键词条目固定到首次触发真实 message/Swipe 锚点，写聊天变量缓存，后续请求回放。
5. GENERATE_AFTER_DATA 预处理并加本轮 token；CHAT_COMPLETION_SETTINGS_READY 消费一次 token，最终整理 messages。新版 ST 两阶段有去重与失败回退。
6. user/assistant/system 历史分别包装 dream_instruction/dream_plot/dream_system，含 uid_${floor}。
7. 聊天主体合为 user 身份，再合并相邻同身份段。
8. 清理内部标记、未消费占位符，失败恢复原请求。
9. STREAM_TOKEN_RECEIVED 停止匹配输出；MESSAGE_RECEIVED 再截断停止串后文本，更新 swipes 与 saveChat。

|当前全部启用的规则|提取占位|特性|
|---|---|---|
|静态蓝灯|`{{压缩相邻消息::lora_constant}}`|constant/static|
|绿灯关键词|`{{压缩相邻消息::lora_key}}`|selective/all，aggressive_green_cache=true|
|动态蓝灯|`{{压缩相邻消息::lora_key}}`|constant/dynamic|
|RUBY 分析|`{{压缩相邻消息::ruby_state}}`|当前方案 outputKey 命中|
|ACU 数据库|`{{压缩相邻消息::sp_memory}}`|标题 `/TavernDB-ACU-(.*)/gi`|
|柏宝历史|`{{压缩相邻消息::bbs_history}}`|实际注入历史|
|柏宝状态|`{{压缩相邻消息::bbs_state}}`|实际状态槽|
|柏宝向量召回|`{{压缩相邻消息::bbs_recall}}`|实际召回槽|
|柏宝时间指令|`{{压缩相邻消息::bbs_instructions}}`|action=keep，保留原位置|

- depth threshold=10、above/below 都开，但当前 worldbook mode 不走旧 depth 搬移分支。
- Ruby/柏宝规则启用不证明插件已安装或有输出；柏宝还检查 apiVersion===1/getSnapshot 和实际 extensionPrompts。
- IndexedDB `dream-whale:squash-debug` 的 records/contents 最多保存 50 请求：它是请求调试日志，不是剧情记忆。绿灯内容缓存另在聊天变量及 message/Swipe 锚点。
- 原 data.stop_string 为 `/(?:</observed_pice>|<\|im_end\|>)/`；observed_pice 比 schema 默认 observed_piece 少 e。不应静默纠错后称原样。
- native Agent 工具协议不能被整包 user squash：该函数跳过 tool 内容包装，组合消息 role 仍会变化。可将原写作材料相同投影，native 工具记录保留外层。

静态定位（解析后 script.content 字符偏移）：92,800–97,500 分区合并；97,111 In() 角色包装；130,900–138,400 token/最终投影/停止。绝不是“压缩成短记忆”的摘要算法。

### 3.2 格式补全 1.2

来源 `/extensions/tavern_helper/scripts/1`；按钮“格式补全”；intercept=true、stream=true；不是每轮自动跑。

1. 用户触发并确认，校验最后 assistant 楼层。
2. SillyTavern.generate('normal') + CHAT_COMPLETION_SETTINGS_READY 截获当时完整 ordered prompts，停止探测生成。
3. 将原 `sleep_var_format_append` 指令插最后 user 提示最后一个 `^</dream_dx_setting>` 之后，找不到则新增 user。
4. generateRaw(ordered_prompts) 产生专用 dream_append_format。
5. 提取区块，插最后匹配 `^<StatusPlaceHolderImpl/>` 之前，否则追加文末。
6. setChatMessages 改原 assistant 楼层；流式预览中断、空文或无格式区块恢复原文。

原指令要求从 dream_dx_setting/dream_setting/dream_history 找正文后必需格式，对照最后 dream_plot 缺项，仅补明确要求，不重写正文。不能用自写通用“审稿”替代原操作提示。

定位：11,750–13,200 末尾拦截与插入；14,900–16,500 第二请求与还原。

### 3.3 思维链提取到正文 1.0

来源 `/extensions/tavern_helper/scripts/2`；start_regex=`^<dream_plot>`、end_regex 空。

MESSAGE_RECEIVED 最后监听。仅当 assistant 正文为空，才从 extra/data/原消息 extra 的 reasoning、reasoningContent、reasoning_content、reasoningText、thinking、thoughts 等字段找文本，提取从 dream_plot 开始的尾部，setChatMessages 写回正文。

这是正文误落 reasoning 字段时的救援，不是正常轮输出全部思维链。定位：11,300–12,880。

### 3.4 梦鲸思客预设助手 2.3

来源 `/extensions/tavern_helper/scripts/3`；可见按钮“梦鲸思客设置”；13 组设置。

读取 getPreset('in_use')，按提示词 name 的 between 边界动态生成选项，replacePreset('in_use', preset, {render:'immediate'}) 应用。

- 单选：应用 disable_group/enable_group，关闭其他项 enable 命中，再应用本项 disable/enable。
- 多选：再次点击只关闭该项自己的 enable 命中。
- effect：通过原 Kimi Partial API 联动，不仅开 prompt。
- var_input 写 chat 变量，自定义角色名；global_var_input 写 global 变量，自定义字数。
- 移除标记或只保留启用 prompts 会破坏 between 的原选项生成。

|组|模式|当前选择/职责|
|---|---|---|
|模型适配|single|Deepseek 官方/Need 思维链/非官方、GLM、Gemini、混元、Kimi 组合；不能仅由 model ID 推断|
|思考强度|single|V4.1flash 放空大脑；其余普通/超短/雷霆/V4flash 关|
|MVU适配|multiple|强制输出 MVU 和额外模型解析按 enable/disable 联动|
|文风设置|single|梦白话文风；其他主要文风关|
|次要文风|multiple|信息差、色色防回避、禁止霸总、杀解释欲、结尾控制开|
|角色设定|single|用户是 user；另有 chat 自定义角色名|
|人称设定|single|第三人称|
|抢话设定|single|转述抢话|
|叙事者|single|平衡叙事|
|字数要求|single|动态字数长；另有 global 自定义字数|
|角色分析|single|通用角色分析|
|其他选开设置|multiple|场景与平行事件开；数据库兼容、八股超杀、选项、说书、大调查、小总结、自检反八股关|
|输出模式|single|写作开；大总结/聊天关|

完整原始 groups 定义附在第 7 节，不从 AI 自创组态重建。

其他真实能力：

- 原 powerUserSettings.reasoning.auto_parse/prefix/suffix + reasoning preset manager 的格式检查、一键 think 配置。
- 组合快照、收藏、排序、导入导出，来源预设内容导入。
- 大总结：临时切输出模式→大总结，创建 user 总结需求，普通生成，finally 恢复原提示词与 effect。
- 总结可 direct/worldbook/first_message；标记总结 floor、隐藏旧消息。
- 当前首层不隐藏、user 隐藏、assistant/system 隐藏、summary 不隐藏、手动总结后自动隐藏；schema 默认只处理最新总结前、保留最新 5 层。
- PRESET_CHANGED 重载；GENERATION_ENDED 检测总结；CHAT_CHANGED 等同步。
- 它主要选择原有 prompt，并非自动生成新的文风提示词。

定位：762,200–764,200 between；767,905 zt() 单多选；791,712 applyOption；800,543 chat/global 变量；782,200–783,700 总结与恢复。

### 3.5 Kimi 前缀预填充 1.0

来源 `/extensions/tavern_helper/scripts/4`；外层开，内部 data.enabled=false，当前 Partial 关闭。

注册 `__dream_whale_kimi_partial_mode_api__` 供设置助手使用；CHAT_COMPLETION_SETTINGS_READY 最后监听。只有非 dryRun、非 JSON/schema、无 tools/tool_calls/tool 消息、末尾 assistant 非空文本时加 partial:true。

原脚本自身明确排除工具请求。定位：9,930–10,690。

### 3.6 梦境自修复 1.0

来源 `/extensions/tavern_helper/scripts/5`；外层开；但对应“梦境自检修复 - 反八股”生成 prompt 关，不能据此称每轮执行末尾修正。

- MESSAGE_RECEIVED 最后监听，取最后 dream_self_check 内 patch。
- 解析 FIND/REPLACE，FIND 编译 JS regex 'm'。
- 仅改 dream_body 与 dream_parallel_event，排除平行事件 simple_thinking。
- 正向找第一个匹配就换，不要求唯一。
- 保存 before/after/位置/左右上下文/目标区块记录。
- 支持重 Patch、反 Patch；反向按位置与上下文选近似匹配。
- 每层 Promise 队列；落盘前检查 chat ID，聊天切换拒写。
- 写原 message 与 data.dream_self_repair，刷新显示。
- 不发第二次模型请求；本轮模型已输出审查与 Patch。

定位：0–3,900 解析范围；4,650–6,950 落盘/串行/撤销；6,950–8,410 自动 Patch 与状态。

## 4. 模型生成参数

以下表格逐项来自根级原字段，排除 prompts/prompt_order/extensions。字符串提示词也保留原值。客户端导出参数不证明供应商接受或执行，max_context 不是模型实际窗口的证明。

|参数|原值|JSON 定位|
|---|---|---|
|`temperature`|1|`/temperature`|
|`frequency_penalty`|0|`/frequency_penalty`|
|`presence_penalty`|0|`/presence_penalty`|
|`top_p`|0.95|`/top_p`|
|`top_k`|0|`/top_k`|
|`top_a`|0|`/top_a`|
|`min_p`|0|`/min_p`|
|`repetition_penalty`|1|`/repetition_penalty`|
|`max_context_unlocked`|true|`/max_context_unlocked`|
|`tool_reasoning_mode`|"disabled"|`/tool_reasoning_mode`|
|`openai_max_context`|2000000|`/openai_max_context`|
|`openai_max_tokens`|30000|`/openai_max_tokens`|
|`names_behavior`|0|`/names_behavior`|
|`send_if_empty`|""|`/send_if_empty`|
|`impersonation_prompt`|"[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]"|`/impersonation_prompt`|
|`new_chat_prompt`|""|`/new_chat_prompt`|
|`new_group_chat_prompt`|"[Start a new group chat. Group members: {{group}}]"|`/new_group_chat_prompt`|
|`new_example_chat_prompt`|"[Example Chat]"|`/new_example_chat_prompt`|
|`continue_nudge_prompt`|"[Continue your last message without repeating its original content.]"|`/continue_nudge_prompt`|
|`bias_preset_selected`|"Default (none)"|`/bias_preset_selected`|
|`wi_format`|"{0}"|`/wi_format`|
|`scenario_format`|"{{scenario}}"|`/scenario_format`|
|`personality_format`|"{{personality}}"|`/personality_format`|
|`group_nudge_prompt`|"[Write the next reply only as {{char}}.]"|`/group_nudge_prompt`|
|`stream_openai`|true|`/stream_openai`|
|`assistant_prefill`|""|`/assistant_prefill`|
|`assistant_impersonation`|""|`/assistant_impersonation`|
|`use_sysprompt`|true|`/use_sysprompt`|
|`squash_system_messages`|true|`/squash_system_messages`|
|`media_inlining`|false|`/media_inlining`|
|`inline_image_quality`|"auto"|`/inline_image_quality`|
|`continue_prefill`|true|`/continue_prefill`|
|`continue_postfix`|" "|`/continue_postfix`|
|`function_calling`|false|`/function_calling`|
|`tool_call_recurse_limit`|5|`/tool_call_recurse_limit`|
|`show_thoughts`|true|`/show_thoughts`|
|`reasoning_effort`|"medium"|`/reasoning_effort`|
|`verbosity`|"auto"|`/verbosity`|
|`enable_web_search`|false|`/enable_web_search`|
|`seed`|-1|`/seed`|
|`n`|1|`/n`|
|`request_images`|false|`/request_images`|
|`request_image_aspect_ratio`|""|`/request_image_aspect_ratio`|
|`request_image_resolution`|""|`/request_image_resolution`|

核心：temperature=1、top_p=0.95、max_context=2,000,000、max_tokens=30,000、stream=true、system squash=true；function_calling=false、tool_reasoning_mode=disabled；reasoning_effort=medium、show_thoughts=true；assistant_prefill 空，continue_prefill=true。

DSH 对照：

- `D:/pro/DSH-Tavern/source/tavern-plugin/lib/domain/helper-generation.js:13` 的 generateHelper 只继承 preset temperature/max_tokens。
- 同文件 :70 helperSampling 只接纳 temperature/maxTokens；:85 generateHelperCompletion 拒 tools/functions。
- `D:/pro/DSH-Tavern/source/tavern-plugin/lib/index.js:559`、:570、:605 的 provider/model/reasoningEffort 来自 DSH 模型选择。
- top_p、原 reasoning_effort、squash_system_messages、预填充不会因 JSON 保存字段就自动应用 native 前台。
- 原 function_calling=false 不能原样套给 native Agent 后仍称它有工具循环。

## 5. DSH 保留范围与差距

`D:/pro/DSH-Tavern/source/tavern-plugin/lib/domain/runtime-presets.js:352` buildFullSnapshot 保留 compatibilityPresetDocument、转换后的 front/middle/back、启用正则。:84 resolveRuntimePresetMacros 按序 carry local/global 宏状态。保存原 JSON 与 hash 不代表最终请求与 ST 一致。

|优先项|现状/差距|深度复刻应当保留|
|---|---|---|
|原写规|known ID 被 adapt() 替换自写文案|原 persona/thinking/flash/平行/写作的全部来源文本与可追溯差异；Agent 协议独立外层|
|材料结构|全部规则汇入 native 工程会改变位置|dream_setting/history/dx_setting/writing_setting 边界、静态/动态 lore 位置、尾部指令邻近最新输入|
|设置|普通开关不等价预设助手|13 组 between、单多选、disable/enable、变量作用域、effect；原 data 驱动|
|格式补全|六维审稿不等价专门二次请求|原 append 指令、缺项定位、原楼层插入、停止/失败恢复|
|末尾修复|修复脚本开但生成 prompt 关|原 rubric、开关与规则文本；工具可加 CAS/唯一定位，但不擅改写规|
|记忆/缓存|容易合并成泛化记忆 Skill|绿灯锚点＝前缀稳定；大总结＝显式模式＋隐藏；IndexedDB＝请求日志|
|正则|原三层 vs DSH session/display 投影|这 27 条逐层、逐 depth、逐 placement 对照|
|工具消息|user squash 会破坏工具协议|只对剧情材料同样包装；工具调用/结果保持原生外层|
|功能选择|可能误把全套全启用|全集可选，但默认说书、大调查、小总结、自检关闭仍保留|
|模型参数|原值保存但不会自动应用|受模型支持限制下明确映射、未映射项显式列出|

当前 `D:/pro/DSH-Tavern/source/tavern-plugin/lib/domain/tavern-regex-engine.js` enabledFor 主要区分 isMarkdown；`reply-presentation.js:39` 把非 Markdown 结果称 sessionText。原 ST 正式/request/display 三层需要再核对。尤其 #5 正式格式化可能在 DSH 显示阶段重复执行；这是静态代码差异，尚未做代表性运行回放，不能提前宣称已导致某条具体聊天损坏。

## 6. 取证边界与运行验收待办

- 已证实数据结构、启用状态、源文本与对应本地代码逻辑。
- 未执行远程 import、原脚本、真实模型回合、用户聊天改写。
- enabled、源码中订阅不证明实际监听器已注册或相对事件顺序。
- 当前 provider 自定义 ID 不证明实际渠道。
- 需对实际 final messages 捕获、原数据宏解析、世界书激活、格式补全与各 HTML 交互验收后才可称完整复刻。
- 正文质量还需与原提示词工程同源材料对照，不能只验证工具轨迹和标签。

## 7. 附录：原始 data.groups 定义

此内容是 JSON 原值的格式化抄录，没有执行源码、没有创建替代规则。定位 `/extensions/tavern_helper/scripts/3/data/groups`。

```json
[
  {
    "id": "模型适配",
    "label": "模型适配",
    "mode": "single",
    "options": [
      {
        "type": "check_reasoner_format",
        "label": "模型思考格式化"
      },
      {
        "id": "Deepseek官方",
        "label": "Deepseek官方",
        "enable": [
          "Deepseek官方",
          "DeepSeek禁词"
        ]
      },
      {
        "id": "Deepseek官方Need思维链",
        "label": "Deepseek官方Need思维链",
        "enable": [
          "Deepseek官方",
          "DeepSeek禁词",
          "V4Pro神秘小指令",
          "DeepseekV4pro思维链"
        ],
        "disable": [
          "默认思维链"
        ]
      },
      {
        "id": "Deepseek非官方",
        "label": "Deepseek非官方",
        "enable": [
          "硅基流动或其他",
          "DeepSeek禁词"
        ]
      },
      {
        "id": "GLM5.2/其他模型",
        "label": "GLM5.2/其他模型",
        "enable": [
          "硅基流动或其他",
          "Glm/Gemini禁词"
        ]
      },
      {
        "id": "Gemini",
        "label": "Gemini",
        "enable": [
          "硅基流动或其他",
          "☆Gemini预填充",
          "Glm/Gemini禁词"
        ]
      },
      {
        "id": "Gemini无预填充",
        "label": "Gemini无预填充",
        "enable": [
          "硅基流动或其他",
          "schema初始化-thinking",
          "Glm/Gemini禁词"
        ],
        "disable": [
          "schema初始化"
        ],
        "description": "适用于Gemini3.7flash。"
      },
      {
        "id": "混元3",
        "label": "混元3",
        "enable": [
          "硅基流动或其他",
          "☆混元3预填充"
        ]
      },
      {
        "id": "KimiK3",
        "label": "KimiK3 官方渠道",
        "enable": [
          "schema初始化-thinking",
          "KimiK3思考",
          "☆KimiK3预填充"
        ],
        "disable": [
          "schema初始化"
        ],
        "effect": [
          "kimi_partial_mode"
        ],
        "description": "Kimi Code或OpenRouter的官方渠道打开。"
      },
      {
        "id": "KimiK3Other",
        "label": "KimiK3 非官方渠道",
        "enable": [
          "KimiK3思考"
        ],
        "description": "其他非官方K3渠道打开。"
      }
    ],
    "disable_group": [
      "☆Gemini预填充",
      "☆混元3预填充",
      "☆KimiK3预填充",
      "Deepseek官方",
      "KimiK3思考",
      "硅基流动或其他",
      "schema初始化-thinking",
      "DeepSeek禁词",
      "Glm/Gemini禁词",
      "V4Pro神秘小指令",
      "DeepseekV4pro思维链"
    ],
    "enable_group": [
      "schema初始化",
      "默认思维链"
    ]
  },
  {
    "id": "思考强度",
    "label": "思考强度",
    "mode": "single",
    "options": [
      {
        "id": "思考强度",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===思考强度(.*)===/",
          "above": "/(.*)===角色分析(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  },
  {
    "id": "MVU适配",
    "label": "MVU适配",
    "mode": "multiple",
    "options": [
      {
        "id": "MVU适配",
        "label": "强制输出Mvu变量",
        "description": "仅Mvu卡打开",
        "enable": [
          "MVU强制 - 掉格式打开"
        ],
        "disable": [
          "MVU不更新 - 额外模型解析打开"
        ]
      },
      {
        "id": "MVU额外模型解析",
        "label": "MVU额外模型解析",
        "description": "使用额外模型解析时打开",
        "enable": [
          "MVU不更新 - 额外模型解析打开"
        ],
        "disable": [
          "MVU强制 - 掉格式打开"
        ]
      }
    ]
  },
  {
    "id": "文风设置",
    "label": "文风设置",
    "mode": "single",
    "options": [
      {
        "id": "文风",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===主要文风(.*)===/",
          "above": "/(.*)===次要文风(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  },
  {
    "id": "次要文风",
    "label": "次要文风",
    "mode": "multiple",
    "options": [
      {
        "id": "次要文风",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===次要文风(.*)===/",
          "above": "/(.*)===角色设定(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  },
  {
    "id": "角色设定",
    "label": "角色设定",
    "mode": "single",
    "options": [
      {
        "id": "角色设定",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===角色设定(.*)===/",
          "above": "/(.*)===人称设定(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      },
      {
        "id": "自定义角色",
        "label": "自定义扮演角色名",
        "description": "用户自定义扮演的角色名称。需要注意，世界书中的{{user}}依然是用户设置里的user。\n此处设置的是实际游玩中扮演的角色。\n该设置与聊天绑定。",
        "type": "var_input",
        "variable_id": "sleep_var_juese_define"
      }
    ]
  },
  {
    "id": "人称设定",
    "label": "人称设定",
    "mode": "single",
    "options": [
      {
        "id": "人称设定",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===人称设定(.*)===/",
          "above": "/(.*)===抢话设定(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  },
  {
    "id": "抢话设定",
    "label": "抢话设定",
    "mode": "single",
    "options": [
      {
        "id": "抢话设定",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===抢话设定(.*)===/",
          "above": "/(.*)===叙事者(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  },
  {
    "id": "叙事者",
    "label": "叙事者",
    "mode": "single",
    "options": [
      {
        "id": "叙事者",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===叙事者(.*)===/",
          "above": "/(.*)===字数要求(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  },
  {
    "id": "字数要求",
    "label": "字数要求",
    "mode": "single",
    "options": [
      {
        "id": "字数要求",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===字数要求(.*)===/",
          "above": "/(.*)===模型禁词(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      },
      {
        "type": "global_var_input",
        "variable_id": "sleep_var_zishu_define",
        "label": "自定义字数",
        "description": "需要AI输出的自定义字数。"
      }
    ]
  },
  {
    "id": "角色分析",
    "label": "角色分析",
    "mode": "single",
    "options": [
      {
        "id": "角色分析",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===角色分析(.*)===/",
          "above": "/(.*)===思维链(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  },
  {
    "id": "其他选开设置",
    "label": "其他选开设置",
    "mode": "multiple",
    "options": [
      {
        "id": "其他选开设置",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===其他设定(.*)===/",
          "above": "/(.*)===设定结束(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  },
  {
    "id": "输出模式",
    "label": "输出模式",
    "mode": "single",
    "options": [
      {
        "id": "输出模式",
        "label": "{match}",
        "type": "between",
        "match": {
          "below": "/(.*)===输出模式(.*)===/",
          "above": "/(.*)===预填充(.*)===/"
        },
        "enable": [
          "{match}"
        ]
      }
    ]
  }
]
```

## 8. 附录：27 条原正则模式

以下为原 findRegex 的精确 JSON 字符串表示，不含超长 HTML replaceString。完整替换 HTML仍在原始文件对应节点，可用第2节定位。

### 正则 1：[🚫删除]正文后思考

来源 `/extensions/regex_scripts/0/findRegex`：

```json
"/^\\s*(?:<dream_after_thinking\\b[^>]*>\\s*)+[\\s\\S]*?(?:<\\/dream_after_thinking>\\s*)+/gm"
```

### 正则 2：[🥷隐藏]隐藏多余格式内容

来源 `/extensions/regex_scripts/1/findRegex`：

```json
"/(<dream_body>|</dream_body>|<dream_after_format>|</dream_after_format>)(?:\\r?\\n)?/g"
```

### 正则 3：[🥷隐藏]正文后思考 - 旧

来源 `/extensions/regex_scripts/2/findRegex`：

```json
"/^\\s*(?:<dream_after_thinking\\b[^>]*>\\s*)+[\\s\\S]*?(?:<\\/dream_after_thinking>\\s*)+/gm"
```

### 正则 4：[🥷隐藏]八股超杀V2 - 隐藏草稿内容

来源 `/extensions/regex_scripts/3/findRegex`：

```json
"/^<!--.*?-->\\n/gms"
```

### 正则 5：[🥷隐藏]思考正则格式化

来源 `/extensions/regex_scripts/4/findRegex`：

```json
"^(?!<think>)([\\s\\S]*\\S[\\s\\S]*)(?:</think>|(<dream_plot>)(?=\\r?\\n))"
```

### 正则 6：[🥷隐藏]思考正则隐藏 - 备用方案

来源 `/extensions/regex_scripts/5/findRegex`：

```json
"/<think>([\\s\\S]*)</think>/i"
```

### 正则 7：[🥷隐藏]选项框不发送

来源 `/extensions/regex_scripts/6/findRegex`：

```json
"/(<dream_option\\b[^>]*>\\s*[\\s\\S]*?\\s*<\\/dream_option>)/gi"
```

### 正则 8：[🥷隐藏]对AI隐藏 10 层内摘要（仅启用了摘要才生效）

来源 `/extensions/regex_scripts/7/findRegex`：

```json
"/^<dream_summary>([\\s\\S]*?)^<\\/dream_summary>/gm"
```

### 正则 9：[🥷隐藏]10 层外只显示摘要（仅启用了摘要才生效）

来源 `/extensions/regex_scripts/8/findRegex`：

```json
"/^[\\s\\S]*?^<dream_summary>([\\s\\S]*?)^<\\/dream_summary>[\\s\\S]*$/m"
```

### 正则 10：[🥷隐藏]对AI屏蔽MVU变量更新

来源 `/extensions/regex_scripts/9/findRegex`：

```json
"/<UpdateVariable>[\\s\\S]*?</UpdateVariable>/gi"
```

### 正则 11：[🥷隐藏]对AI隐藏 2 层外的思客说书

来源 `/extensions/regex_scripts/10/findRegex`：

```json
"/^<dream_discuss>([\\s\\S]*?)^<\\/dream_discuss>/gm"
```

### 正则 12：[🥷隐藏]对AI隐藏 2 层外的用户大输入

来源 `/extensions/regex_scripts/11/findRegex`：

```json
"/<dream_answer\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\/dream_answer>/gi"
```

### 正则 13：[🥷隐藏]对AI隐藏思客大调查

来源 `/extensions/regex_scripts/12/findRegex`：

```json
"/^<dream_big_discuss>([\\s\\S]*?)^<\\/dream_big_discuss>/gm"
```

### 正则 14：[🥷隐藏]对AI隐藏平行思考

来源 `/extensions/regex_scripts/13/findRegex`：

```json
"/(<simple_thinking>\\s*([\\s\\S]*?)\\s*<\\/simple_thinking>\\n?)/gm"
```

### 正则 15：[🦋美化]思考正则美化 - 二选一

来源 `/extensions/regex_scripts/14/findRegex`：

```json
"/<think>([\\s\\S]*)</think>/i"
```

### 正则 16：[🦋美化]思考正则隐藏 - 二选一

来源 `/extensions/regex_scripts/15/findRegex`：

```json
"/<think>([\\s\\S]*)</think>/i"
```

### 正则 17：[🦋美化]梦鲸摘要

来源 `/extensions/regex_scripts/16/findRegex`：

```json
"/^<dream_summary>\\s*([\\s\\S]*?\\S)\\s*^<\\/dream_summary>/gm"
```

### 正则 18：[🦋美化]思客说书

来源 `/extensions/regex_scripts/17/findRegex`：

```json
"/^<dream_discuss>\\s*([\\s\\S]*?\\S)\\s*^<\\/dream_discuss>/gm"
```

### 正则 19：[🦋美化]思客大调查

来源 `/extensions/regex_scripts/18/findRegex`：

```json
"/^<dream_big_discuss>\\s*([\\s\\S]*?)\\s*</dream_big_discuss>/gm"
```

### 正则 20：[🦋美化]八股超杀过程美化 - V2版本

来源 `/extensions/regex_scripts/19/findRegex`：

```json
"/^[ \\t]*<!--[ \\t\\r\\n]*(?:(分析之)[ \\t\\r\\n]*[：:][ \\t\\r\\n]*)?([\\s\\S]*)$/gm"
```

### 正则 21：[🦋美化]梦境状态栏

来源 `/extensions/regex_scripts/20/findRegex`：

```json
"/<dream_scene>\\s*<date>\\s*([\\s\\S]*?)\\s*<\\/date>\\s*<time>\\s*([\\s\\S]*?)\\s*<\\/time>\\s*<location>\\s*([\\s\\S]*?)\\s*<\\/location>\\s*<\\/dream_scene>/gm"
```

### 正则 22：[🦋美化]梦境平行事件

来源 `/extensions/regex_scripts/21/findRegex`：

```json
"/<dream_parallel_event>\\s*([\\s\\S]*?)\\s*<\\/dream_parallel_event>/gm"
```

### 正则 23：[🦋美化]梦境选项框

来源 `/extensions/regex_scripts/22/findRegex`：

```json
"/<dream_option\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\/dream_option>/gi"
```

### 正则 24：[🦋美化]梦境自修复

来源 `/extensions/regex_scripts/23/findRegex`：

```json
"/<dream_self_check\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\/dream_self_check>/gi"
```

### 正则 25：[🥷隐藏]删除额外标签

来源 `/extensions/regex_scripts/24/findRegex`：

```json
"/(</think>|</dream_delete>|<dream_done/>|<dream_plot>|</dream_plot>|<paragraph>|</paragraph>|<dream_check_done/>)/g"
```

### 正则 26：[🥷隐藏]特殊空行合并，放到最后

来源 `/extensions/regex_scripts/25/findRegex`：

```json
"/(\\r?\\n)[ \\t]*(?:\\r?\\n[ \\t]*){2,}/g"
```

### 正则 27：[🥷隐藏]梦境自修复

来源 `/extensions/regex_scripts/26/findRegex`：

```json
"/<dream_self_check\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\/dream_self_check>/gi"
```
