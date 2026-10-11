# DSH-Tavern 前端与配置设置界面审计

日期：2026-10-11。分支 `codex/dream-sike-dsh-agent`，审计基线 `e2e8b137`（梦境思客破限复刻完成）。
对象：`tavern-plugin/src/client/` 前端源码、生成产物 `tavern-plugin/lib/client.js`、
`tavern-plugin/lib/client-assets/tavern.css`。方法：静态审阅 + 真实浏览器测试 + 用真实预设驱动
客户端分类逻辑。未修改运行代码（仅修复一处失效测试，见第五节）。

## 一、设计过程与架构

### 1.1 构建方式：include 展开的单文件产物

`main.js` 是宿主入口，保留 RPC、会话视图协调与插件装配。其余按职责拆分：

| 目录 | 职责 |
| --- | --- |
| `features/` | 侧栏、卡库、世界书、预设库、游玩操作、设置等完整功能（22 个模块） |
| `runtime/` | Helper、脚本执行、会话生命周期、宿主挂载、iframe 生命周期 |
| `ui/` | 错误中心与消息展示 |
| `modules/` + 根目录文件 | 独立工厂、共享算法、浏览器兼容实现 |

`bin/build-tavern-client.mjs` 从 `main.js` 递归展开 `// @include`，产出 `lib/client.js`
（**20273 行**）。关键约束（见 `src/client/README.md`）：

- 所有片段处于**同一个 factory 作用域**，不能当 ES 模块单独导入；
- 无缩进 include 保留迁移代码原有缩进，使拆分产物逐字节不变；
- `@include-domain` 相对 `lib/domain`；越界与重复 include 会构建失败；
- 构建时用 `new vm.Script()` 全量解析产物，语法错误不会发布；
- `--check` 模式在产物过期时报错而非静默覆盖。

**当前状态：构建同步**（`node bin/build-tavern-client.mjs --check` 通过，产物 20273 行，CSS 2887 行）。

### 1.2 工作台：插件化面板组合

DSH 原生侧栏承载 Agent 工作台，一个导航对应多个内置模块。设计要点（`docs/agent-workbench-frontend.md`）：

- `tavernUi.registerWorkbenchPanel` 是浏览器版本 2 新增接口，**第三方模块与内置模块走同一注册路径**；
- 注册项字段：`id`（须 `<插件名>/<模块名>` 格式）、`label`、`description`、`order`、`component`、`when`、`keepAlive`；
- 宿主 `agent-workbench.js` 只负责导航、显示偏好、挂载与错误隔离；各面板自己读写数据；
- 用 `tavernPluginBoundary()` 做错误隔离，单个模块崩溃可单独重试，不影响其他模块；
- 显示偏好与当前模块存 localStorage，**按前台游戏 ID 隔离**；隐藏界面不等于停用生成能力；
- `keepAlive: true` 的面板在隐藏时保留编辑状态，传 `visible=false`；默认第三方模块离开即卸载。

内置五个模块的注册位置：

| 模块 ID | 标签 | order | keepAlive | 组件 | 注册处 |
| --- | --- | --- | --- | --- | --- |
| `tavern/author-settings` | 创作设置 | 10 | ✓ | `TavernPresetSettings` | play-controls.js |
| `tavern/draft` | 正文与过程 | 20 | — | `DreamSikeDraftTab` | dream-sike-draft.js |
| `tavern/memory` | 分支记忆 | 30 | ✓ | 记忆面板 | game-memory.js |
| `tavern/state` | 人物与状态 | 40 | — | `TavernStatusTab` | play-controls.js |
| `tavern/runtime` | 本局配置 | 50 | ✓ | 多组件组合 | play-controls.js |

### 1.3 配置设置界面：两处入口 + 兼容处理

设置界面有**两条入口**，这是设计上最需要关注的兼容点：

1. **工作台「创作设置」面板**（`tavern/author-settings`）→ `TavernPresetSettings`
2. **侧栏「本局设置」标签页**（`dsh-tavern:conversation-settings`）→ `TavernConversationSettingsTab`
   → 内嵌 `TavernConversationPreset` → 其中渲染 `TavernPresetSettings`

兼容机制是 `includeAuthorSettings` 属性：`play-controls.js:855` 处
`props.includeAuthorSettings !== false ? h(TavernPresetSettings, …) : null`。
工作台路径显式传 `includeAuthorSettings: false`，避免与独立的「创作设置」面板**重复渲染同一组件**。
在线内嵌路径则保留它。**这个处理是正确的，两条入口不会互相重复。**

`TavernPresetSettings` 单组件同时支持两种模式（`agentEnabled` 判定）：

- **Agent 模式**：六阶段标签页（角色与场景 / 叙事与文风 / 思考与检索 / 输出与共创 / 审稿与状态 / 模型与兼容），
  由服务端 `buildDreamSikeAgentProfile()` 提供阶段定义；
- **原酒馆模式**：按原预设助手分组展示，无阶段划分。

两种模式共用同一套 source group 渲染、变量输入、来源抽屉与高级设置，**兼容性良好**。
`s4` 浏览器测试覆盖「原酒馆模式与缺失 Agent profile 不误报 Agent 已启用」。

## 二、响应式与可访问性

- 设置界面用**容器查询**而非媒体查询（组件可嵌在侧栏或独立页，宽度语义不同）：
  - `@container (max-width:620px)`：六阶段标签页 `repeat(6,…)` → `repeat(3,…)`
  - `@container (max-width:460px)`：分组网格 `repeat(2,…)` → 单列；标题降为 16px
- 可访问性做得比较完整：`role="tablist"/"tab"/"tabpanel"`、`aria-selected`、`aria-controls`、
  方向键/Home/End 键盘导航、来源抽屉用 `<dialog>` + 焦点陷阱（Tab 循环、Escape 关闭、焦点归还触发元素）、
  `role="status"` / `role="alert"` 区分通知与错误。

## 三、真实测试结果（需 `TAVERN_BROWSER_TESTS=1` 才运行）

| 测试文件 | 结果 |
| --- | --- |
| `agent-workbench-browser` | 3/3 通过 |
| `conversation-preset-settings-browser` | 5/5 通过 |
| `global-settings-browser` | 3/3 通过 |
| `source-preset-settings-browser` | 3 通过 / 1 跳过 |
| `mobile-agent-composer-browser` | 1/1 通过 |
| `independent-agent-dock-browser` | 2/2 通过 |
| `dream-sike-draft-ui` | **修复前 0/3 → 修复后 3/3** |

注意：浏览器测试默认**被跳过**（`config = { skip: !process.env.TAVERN_BROWSER_TESTS }`）。
不设该环境变量时，这些测试报告 `# pass 0 # fail 0`，**看起来通过但实际未执行**。
建议在验收流程中显式设置该变量，否则前端回归是"静默未运行"状态。

## 四、发现的问题

### 4.1 高级设置的分类靠关键词正则（主要问题）

`preset-settings.js:90-95` 的 `group(entry)` 用中文关键词正则给规则分类：

```js
if (/角色|信息差|剧情|思维|分析|思考|叙事者/.test(entry.name)) return "剧情理解与角色";
if (/文风|视角|字数|长篇|转述|禁词|叙事|写作/.test(entry.name)) return "文风与叙事";
if (/格式|场景|平行|修复|修正|输出/.test(entry.name)) return "格式与修订";
return "其他写作规则";
```

用真实预设 `梦鲸思客V4-0915.json` 驱动的实际分布（107 条）：

| 分类 | 数量 | 占比 |
| --- | ---: | ---: |
| **其他写作规则** | **57** | **53%** |
| 剧情理解与角色 | 26 | 24% |
| 文风与叙事 | 19 | 18% |
| 格式与修订 | 5 | 5% |

具体错分（作者原文即可判断）：

- `色色防回避`、`色色软强化`、`NSFW-感官刺激`、`NSFW-古风` → 落入「其他」，而它们都是**文风**项
- `1000 字`、`2500 字` → 落入「其他」，但 `动态字数短`/`动态字数长` 却进了「文风与叙事」，**同类被拆开**
- `用户是char`、`第一人称`、`第二人称`、`深度扮演`、`严禁抢话`、`大纲模式` → 落入「其他」，实为**人称/抢话**项
- `大总结模式`、`聊天模式` → 落入「其他」，实为**输出模式**项
- `梦境选项 - NSFW推进` → 落入「其他」

另外，**22 条是作者的分组标题行**（`===预设定===`、`📚===主要文风（选一开启）===` 等）。
它们在 `preset-reading.js` 中 `marker` 为 `false`（只有 order 中无对应记录的占位符才是 marker），
因此会进入列表**被当成可开关的规则项展示**，属噪音。

**根本原因**：服务端 `conversation-preset-settings.js:42-47` 返回的 `entries` 只含
`key / name / phase / role / enabled / content / editableContent / execution`，**不含 `identifier`**。
客户端拿不到稳定标识，只能退回名字正则。

**这与项目自身确立的原则冲突**：`dream-sike-contract.js:8-9` 明确写着
"These are source prompt identifiers, not keyword matches against user prose"，
而前端高级分类恰恰在做关键词匹配。

**修复路径（无需改服务端）**：客户端**已收到** `settings.agentPreset.stages[].authorRuleIds`，
每项含 `key`，而 `entries` 也以 `key` 为键。因此可直接用 `key → 阶段` 映射归组，
替代关键词正则。需同步更新 3 处断言分类名的测试
（`conversation-preset-settings-browser`、`independent-agent-dock-browser`、`source-preset-settings-browser`）。

### 4.2 工作台挂载的设置面板缺 `revision`（潜在脆弱点）

`play-controls.js:1420` 的工作台注册：

```js
React.createElement(TavernPresetSettings, { key: props.gameId, sessionId: props.gameId })
```

对比线内嵌路径（`play-controls.js:855`）会传 `revision`，且 `key` 含 `currentPlayPresetId`：

```js
key: props.sessionId + ":" + (data?.currentPlayPresetId || "tavern"),
revision: (data?.current?.id || "") + ":" + (data?.currentPlayPresetId || "tavern")
```

`TavernPresetSettings` 的重载依赖是 `[props.sessionId, props.revision, reload]`。工作台路径下
`revision` 为 `undefined`，`key` 又只含 `gameId`，所以**切换 Agent 预设不会重挂载、也不会触发该依赖重载**。

**当前被兜住**：`changeAgent()` 会 `notifyTavernDataChanged(["sessions"], "play-controls")`，
而组件监听 `dsh-tavern-data-changed` 且接受 `play-controls` 来源，因此仍会刷新。
但这意味着 `keepAlive` 面板的刷新**仅依赖一个全局事件**——将来若任何代码路径切换预设而未发该事件，
面板会静默显示上一个预设的规则。建议显式补 `revision`，与内嵌路径对齐。

### 4.3 阶段定义在两处重复（漂移风险）

客户端 `stages()` 有一份 `defaults`（`groupIds` 硬编码六组），服务端
`dream-sike-agent-profile.js` 另有一份 `stageDefinitions` + `groupStages`。

客户端写法是 `provided?.length ? provided : defaults`，服务端有值时用服务端。
因此**正常路径不受影响**，但兜底副本会随服务端演进而漂移，且漂移时只在服务端 profile 缺失的
边缘场景才暴露。建议删除客户端 `defaults`，缺 profile 时明确提示而非猜测分组。

## 五、已修复

`tests/dream-sike-draft-ui.test.mjs`：3 项失败，报 `tavernUiExtensions is not defined`。

- **成因**：`8f84960b`（Agent 前端工作台重构）给 `dream-sike-draft.js:250` 加了
  `tavernUiExtensions.service.registerWorkbenchPanel(...)` 注册，但该测试的 `vm` 沙箱未提供此桩。
- **影响**：该测试**不在** `TAVERN_BROWSER_TESTS` 门控内，属**默认测试套件中的真实失败**，
  即前端重构后自身测试就红了，未被发现。
- **修复**：在沙箱补 `tavernUiExtensions: { service: { registerWorkbenchPanel() { return () => {} } } }`。
  修复后 3/3 通过。

## 六、结论与建议优先级

**兼容性：可以，且当前实现基本到位。** 双入口用 `includeAuthorSettings` 正确去重；
同一组件同时支持 Agent 模式与原酒馆模式；响应式与可访问性完整。

**重构：可以，且有明确的高价值项。**

| 优先级 | 项 | 收益 | 风险 |
| --- | --- | --- | --- |
| 高 | 4.1 用 `authorRuleIds` 的 key 映射替代关键词正则 | 消除 53% 落入「其他」的错分；与项目既定原则一致 | 中（需同步 3 处测试断言） |
| 中 | 4.2 工作台补 `revision` | 消除对单一全局事件的隐式依赖 | 低 |
| 中 | 4.1 后半 过滤作者分组标题行 | 去除 22 条噪音项 | 低 |
| 低 | 4.3 删除客户端阶段兜底副本 | 消除漂移 | 低 |
| 建议 | 验收流程显式设 `TAVERN_BROWSER_TESTS=1` | 避免前端回归"静默未运行" | 无 |

## 边界

本次为静态审阅 + `vm`/真实浏览器夹具测试；未在玩家实际对话中操作 UI。
浏览器测试使用虚构夹具模块，不代表真实游戏数据的渲染结果。
