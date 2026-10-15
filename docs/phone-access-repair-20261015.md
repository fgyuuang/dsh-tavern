# 手机访问修复记录

2026-10-15，安装位置 `D:\pro\DSH-Tavern`。

## 根因

Pocket 入口已监听 `0.0.0.0:3081`，当前 WLAN 为 `192.168.5.153/24`。现有 Windows 防火墙规则允许该运行程序的 TCP 3081，来源限定 `192.168.5.0/24`。密码登录成功返回302，但上游桌面配置 `dsh-desktop.mode: advanced`、`openBrowser: false`，随后导航被 `desktop-browser-access` 拒绝，返回403。

## 已应用

维护配置 `data/harness/settings.yaml` 中仅将 `dsh-desktop.mode` 改为 `compatibility`、`openBrowser` 改为 `true`。原手机密码和局域网防火墙规则保留。通过安装入口正常退出和启动桌面。

字节备份：`D:\pro\DSH-Tavern\data\harness\settings.yaml.bak.20261015-075948`。

## 验证

通过局域网地址 `http://192.168.5.153:3081` 使用真实 Edge 移动视口390×844检查：未认证必须显示密码表单；现有密码登录成功；酒馆只读 getSessionInventory API 正常；WebSocket收到消息；无横向溢出。未提交聊天或触发模型生成。

探针 `D:\pro\DSH-Tavern\temp\verify-phone-access-20261015.mjs` 从本机密码文件读取凭据，不输出密码或cookie。脱敏结果 `D:\pro\DSH-Tavern\temp\phone-access-check-20261015.json`。截图可能含私有会话信息，仅本机保留，不发布。

手机应连接电脑所在Wi-Fi后访问上述HTTP地址；43120是本机主服务端口，手机使用3081入口。电脑网络地址变化后应以手机访问设置页为准。尚未由第二台真实设备验证路由器的客户端隔离或移动数据访问。

## 回滚

关闭此安装的桌面程序后，以 `Copy-Item -LiteralPath 'D:\pro\DSH-Tavern\data\harness\settings.yaml.bak.20261015-075948' -Destination 'D:\pro\DSH-Tavern\data\harness\settings.yaml'` 恢复备份，再通过 `DSH Tavern.exe` 启动。备份包含其他设置，仅在确认没有后续配置编辑时整份恢复；否则只恢复上述两字段。