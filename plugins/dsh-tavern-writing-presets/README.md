# 创作预设菜单插件

复制本目录到 `profile-data/tavern/data/plugins/dsh-tavern-writing-presets/`。需要本维护分支的 `tavern.writingPresets.version === 1` 与 `tavernUi.writingPresets.version === 1`。不兼容时不注册菜单。

宿主入口只使用 `tavern.handle` 和 `tavern.writingPresets.request`；浏览器通过 `tavernUi.callHost`、`watchTurnState`、`assetUrl` 和原生 DSH `slots`、`sessions` 服务工作，不导入 Tavern 私有模块，不访问存档文件，不扫描 DOM。

- Agent 预设、作者预设、酒馆直接回复模式仍可在输入区选择。
- “配置作者选项”打开现有完整作者设置，不复制或重新编写作者提示词。
- 采用原生同 ID 低优先级插槽覆盖宿主菜单；只显示一个入口。卸载会注销插槽、样式、监听器，恢复宿主入口。
- 修改从下一回合生效，切换前仍由宿主检查前后台空闲、版本和脚本生命周期。
- 不调用模型，也不改变模型或供应商配置。

这是插件化迁移的第一步：菜单代码和资源已独立部署；写作工具、草稿事务、会话恢复和变量提交仍由宿主维护。下一步按公共扩展契约迁移预设能力注册、独立后续模块和记忆源，保持一次正文提交的约束。
