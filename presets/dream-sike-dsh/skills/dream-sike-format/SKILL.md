---
name: dream-sike-format
description: "检查人物卡专用格式、状态协议和正文可渲染性；只对本回合草稿做必要的局部修复。"
metadata:
  tavern:
    purpose: writing
---

# 格式与修订

人物卡的 HTML、状态块、MVU、宏与显示正则各有自己的协议。先读本局预设契约与当前卡要求；原预设已启用的 dream_plot、dream_body、dream_after_format、dream_scene 和 dream_parallel_event 等是渲染契约，须保留在草稿文本中，不约束原生工具消息。未启用的格式不凭习惯添加。不得把工具调用、草稿记录或分析文本混入正式正文。

建立草稿后调用 `sike_check_draft`。修订只针对可说明的具体缺陷，优先使用短且唯一的原文片段，以草稿当前版本调用 `sike_patch_draft`；不使用可能命中多处的宽泛正则或跨段落盲替换。修订后复查受影响的结构和结尾。零问题允许零补丁。

保留角色卡中有意的标签与脚本数据，不把未识别结构当作错误删除。后台状态和变量更新由最终提交后的现有流程处理，草稿阶段不自行改写它们。
