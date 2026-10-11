---
name: tavern-card-surface
description: "在卡片工作台维护卡面、HTML 状态栏和显示正则，诊断图片缺失、iframe 裁切与请求正文和显示结果不一致。"
metadata:
  tavern:
    purpose: card
---

# 卡面与渲染

仅维护卡片资源与读取诊断，游玩前台不能执行这些编辑操作。卡面图片、iframe 和输入事件由宿主界面处理，Skill 提供诊断与维护方法。

## 定位层次

有游玩引用时先调用 `tavern_read_play_chat` 的 `layer: overview`。按症状选取 `source`、`display`、`saved-display`、`regex`、`iframe`、`diagnostics`；对照同一轮次和同一版本，区分模型原文、正式正文变换、显示变换与 iframe 内执行。当前规则的重新计算不能证明保存当时的渲染结果。

读取 `tavern_read_card` 的 `first_mes` 或其他相关字段，再用 `tavern_read_card_raw` 分段读取当前卡正则和助手扩展。需要预设来源时用 `tavern_read_preset`，读取导入的正则库用 `tavern_read_regex_library`；正则库中的规则尚未生效。

## 最小修改

已授权时通过 `tavern_update_card` 的 `rawOperations` 修改对应正则或脚本字段，标准开场内容用 `fields`。保留不相关规则的顺序、开关、作用层、深度及匹配范围。先读实际 JSON Pointer 结构，不能假定每张卡都有相同扩展。

显示规则仅处理可显示内容；请求规则不能吞掉工具调用与结果，正式正文规则不能重复触发状态结算。保留卡片有意使用的 HTML、状态入口和数据协议，不能为了消除报错删掉整段面板。正则库规则加入卡片时先读目标列表，保留原规则，检查重复 ID 和作用层。

另存为副本时使用 `tavern_copy_card({path,name})`，检查返回的 `imageCopied`；副本不会自动成为当前卡，也不复制外部世界书绑定。图片为独立资源，不能通过人物卡正文或虚构的 JSON 字段修复图片接口。当前维护工具没有图片上传或放大接口；缺图、接口失败、查看器未呈现应报告给宿主维护，而不是声称 Skill 已完成上传。

iframe 高度、滚动或裁切问题，先调用 `tavern_read_skill_reference({name:"debug-card",path:"references/frame-sizing.md"})`，按布局证据选适配方式。生命周期或宿主桥故障应定位到宿主，不通过改变卡片交互含义掩盖问题。

## 完成标准

调用 `tavern_validate_card` 检查保存后的正则和脚本静态格式。真实验收还需图片加载或占位、图片查看、代表性 HTML、状态栏交互、窄屏和重新挂载结果。现有 iframe 证据只能证明其记录覆盖的操作，不能当作整个前端已通过。

报告原因、所改资源、静态校验和实际渲染观察。没有新的浏览器现场时，明确剩余验证并给出复现步骤，不自动发送剧情或改写旧聊天。
