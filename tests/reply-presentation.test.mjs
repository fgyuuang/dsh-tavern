import assert from 'node:assert/strict'
import test from 'node:test'

import { projectReplyHistory, projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

function script(name, findRegex, replaceString, flags = {}) {
  return {
    id: name,
    name,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [2],
    enabled: true,
    markdownOnly: flags.markdownOnly === true,
    promptOnly: flags.promptOnly === true,
    runOnEdit: false,
    minDepth: null,
    maxDepth: null
  }
}

test('历史投影会下发剥离 content 外壳后的纯文本开场白', () => {
  const source = '<content>\n第一段开场白。\n\n第二段开场白。\n</content>'
  const result = projectReplyHistory([
    { role: 'assistant', turn: 1, greeting: true, text: source, sourceText: source }
  ])

  assert.equal(result.projections.length, 1)
  assert.deepEqual(result.projections[0].parts, [
    { kind: 'markdown', text: '第一段开场白。\n\n第二段开场白。' }
  ])
})

test('损坏规则只产生目标诊断，后续规则继续执行', () => {
  const result = projectReplyLayers('进入校园', {
    regexScripts: [
      script('损坏规则', '/[/', '坏'),
      script('可用规则', '校园', '学院')
    ],
    placement: 2
  })

  assert.equal(result.sessionText, '进入学院')
  assert.equal(result.displayText, '进入学院')
  assert.match(result.warnings.join('\n'), /Session：损坏规则/)
  assert.match(result.warnings.join('\n'), /展示：损坏规则/)
})

for (const block of [
  '<UpdateVariable>secret</UpdateVariable>',
  '<INITVAR>secret\r\nsecond</INITVAR>',
  '<initvar format="yaml">secret</initvar>',
  '<UpdateVariable><initvar>secret</initvar></UpdateVariable>',
  '<initvar><initvar>secret</initvar>secret</initvar>'
]) test('变量控制块不作为正文展示：' + block.split('>')[0], () => {
  const source = '之前\r\n' + block + '\r\n之后'
  const result = projectReplyLayers(source)
  assert.equal(result.sourceText, source)
  assert.equal(result.sessionText, source)
  assert.deepEqual(result.displayParts, [{ kind: 'markdown', text: '之前\r\n' }, { kind: 'markdown', text: '\r\n之后' }])
})

test('变量结算后的普通模板快照仍显示预设调查和选项，不把提示词隐藏结果作为原文', () => {
  const source = '正文\n<dream_big_discuss>公开理解</dream_big_discuss>\n<dream_option>下一步</dream_option>\n<card-status/>'
  const presetRegexScripts = [
    script('模型隐藏', '/<(dream_big_discuss|dream_option)>[\\s\\S]*?<\\/\\1>/g', '', { promptOnly: true }),
    script('调查', '/<dream_big_discuss>([\\s\\S]*?)<\\/dream_big_discuss>/g', '<section class="discussion">$1</section>', { markdownOnly: true }),
    script('选项', '/<dream_option>([\\s\\S]*?)<\\/dream_option>/g', '<section class="options">$1</section>', { markdownOnly: true })
  ]
  const global = script('全局一次', '/公开/g', '公开公开', { markdownOnly: true })
  const card = script('卡片状态', '/<card-status\\/>/g', '<aside class="status">状态</aside>', { markdownOnly: true })
  const options = { regexScripts: [global, ...presetRegexScripts, card], presetRegexScripts }
  const original = { role: 'assistant', turn: 2, sourceText: source, projectionText: source,
    text: projectReplyLayers(source, options).sessionText }
  const before = projectReplyHistory([original], options)
  const staleFormatting = projectReplyLayers(source, { regexScripts: [global, card] }).displayText
  const after = { ...original, mvu: { receipt: { status: 'updated' } }, variables: [{ hp: 8 }],
    tavernPluginData: { template_display: { source, swipe: 0, html: staleFormatting, formattingText: staleFormatting } } }
  assert.deepEqual(projectReplyHistory([after], options).projections, before.projections)
  assert.match(before.projections[0].text, /class="discussion"/)
  assert.match(before.projections[0].text, /class="options"/)
  assert.doesNotMatch(original.text, /公开理解|下一步/)
  assert.equal(after.sourceText, source)
  assert.equal(after.tavernPluginData.template_display.formattingText, staleFormatting)
})

test('真实 EJS 显示保持冻结，禁用或仅提示词预设不重建普通快照', () => {
  const source = '<dream_option>下一步</dream_option>'
  const render = script('选项', '/<dream_option>(.*?)<\\/dream_option>/g', '<section class="options">$1</section>', { markdownOnly: true })
  const message = { role: 'assistant', turn: 2, sourceText: source, projectionText: source, text: source,
    tavernPluginData: { template_display: { source, swipe: 0, html: '<section class="evaluated">历史模板结果</section>' } } }
  assert.match(projectReplyHistory([message], { regexScripts: [render], presetRegexScripts: [render] }).projections[0].text, /历史模板结果/)
  message.tavernPluginData.template_display.formattingText = '<section class="frozen">普通快照</section>'
  for (const inactive of [{ ...render, disabled: true }, { ...render, markdownOnly: false, promptOnly: true }]) {
    const result = projectReplyHistory([message], { regexScripts: [inactive], presetRegexScripts: [inactive] })
    assert.match(result.projections[0].text, /普通快照/)
  }
})
