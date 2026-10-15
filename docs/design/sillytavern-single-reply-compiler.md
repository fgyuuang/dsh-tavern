# 原版酒馆单次回复编译器

兼容编译器读取本局 `runtimePresetSnapshot.compatibilityPreset` 和
`compatibilityPresetDocument`。条目开关和原文来自本局快照；不会从资源库
重新加载默认开关。`sourceMacroOverrides` 合并到本局宏状态后求值，编译过程
不改写调用者传入的 Chat。

请求按源 `prompt_order` 展开人物卡、世界书、对话示例和历史，保留普通条目
及 marker 的角色；绝对注入按原始历史深度编排。同深度注入复用 ST 1.18.0
的分组方式：在倒序历史中按 injection_order 降序、system/user/assistant
分组，再整体逆转为发送顺序。角色卡和助手的 HTML 不在此转换成 Agent 工具。

兼容路径处理 `wi_format`、`new_chat_prompt`、`send_if_empty`、
`assistant_prefill` 和 `squash_system_messages`。额外提示词后处理只在源配置
`custom_prompt_post_processing` 指定时运行；默认保留源角色，不再强制 strict_tools。

世界书使用共享本地激活引擎，包括主次关键字、扫描深度、递归、包含组与预算；
兼容路径不使用 DSH 的十回合召回冷却，并保留 `[mvu_update]` 规则。
深度世界书和 `tavernScriptPrompts` 的 in_chat 注入一起按角色和深度编排。
once 注入由回合所有者在正式正文成功提交时消费，同步骤的失败重试复用已经编译的请求，编译投影本身不会消费它。
模板预处理、初始变量、助手变量宏和 EJS 继续经过现有运行时。

`compiled.generationOptions` 只包含已核对当前 DSH 适配器支持的
`temperature`、`maxTokens` 与可映射的 `reasoningEffort`；其他源采样字段保存在
`sourceGenerationOptions`，并产生 `unsupported-adapter-options` 诊断。
供应商、模型和凭据仍由当前连接决定。

## 本地依据与验证范围

对应本机 SillyTavern 1.18.0：`public/scripts/openai.js` 中的
`populationInjectionPrompts`、`preparePromptsForChatCompletion`、
`populateChatHistory`、`ChatCompletion.squashSystemMessages`，以及
`src/prompt-converters.js` 的 `postProcessPrompt` / `mergeMessages`。
DSH 参数依据为当前安装 `dsh-llm-pi-ai` 的 `streamSimple` 接点。

纯本地编译检查覆盖源设置保存后的原文、启用状态、宏覆盖、角色、深度、
后处理、附件、递归世界书、MVU 规则与助手注入。没有发起真实模型请求。

本实现不等同于所有 SillyTavern 扩展的完整复现：供应商专属采样、Kimi
Partial、扩展数据库材料提供方、世界书概率及 sticky/cooldown/delay 持久时效、
Author's Note 自定义锚点、命名 outlet 的二次消费仍需对应宿主能力。
Author's Note 上下位置当前按本局可提供的深度与角色注入；未单独提供 Note
时使用默认深度 4。命名 outlet 条目不自动拼接到正文请求中。
