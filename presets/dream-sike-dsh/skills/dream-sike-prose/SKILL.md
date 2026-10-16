---
name: dream-sike-prose
description: "读取并执行本局原作者文风、输入处理、叙事者与字数规则，用原生草稿和审稿工具实现写作。"
metadata:
  tavern:
    purpose: writing
---

# 叙事文风

直接依本次请求已经装配的作者原文写作；`sike_read_turn` 仅在缺少规则、材料或当前分支信息时补查。不要因加载本 Skill 再读同一份规则。`presetRules.delivery=current-model-request` 表示完整原文已收到，直接使用；主动核验时才显式 `includeRules:true`。原预设按 setvar/addvar/getvar 组合后的内容才是本回合写规。本 Skill 不提供另一套默认文风。

依作者“遵写规”步骤，逐项核对完整 `writing_setting` 和当前输入处理要求。检查玩家输入属于文章开头转述、已经发生的行动还是全文大纲，执行本局选项的对应范围；不能把几种选项写成同一种效果。人物说话、场景描写、对白比例、内心戏、结尾与禁词均由选定原文定义。

文风分析在内部完成，正文可直接输出，也可用一次 `sike_put_draft` 保存并提交。按已启用作者条目核对全文、认知来源与结尾；review/brief 是可选记录。仅明确需要继续优化时传 `finalize:false` 后局部修订；可选预算结束立即提交可用正文，不为追加检查、完整回执或完成提示额外请求模型。聊天和大总结模式采用各自规则，不套用剧情文风。
