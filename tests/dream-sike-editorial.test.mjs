import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkDreamSikeDraft, dreamSikeTurnIdentity, inspectDreamSikeDraft, patchDreamSikeDraft,
  putDreamSikeDraft, readyDreamSikeDraft
} from '../tavern-plugin/lib/domain/dream-sike-draft.js'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'

function fixture() {
  const chat = {
    id: 'editorial-chat', sessionId: 'editorial-session', playPresetId: 'dream-sike-dsh', mode: 'story',
    runtimePresetSnapshot: {
      presetPath: 'presets/editorial.json', presetName: '合成文风预设', digest: 'source-one',
      front: { entries: [{ id: 'style', name: '节制叙述', enabled: true, content: '保持克制的叙述，以动作表现迟疑，避免直接解释人物全部心理。' }], text: '保持克制的叙述，以动作表现迟疑，避免直接解释人物全部心理。' }
    },
    timeline: { branchId: 'editorial-branch', revision: 1, operations: {
      body: { id: 'body', kind: 'body', status: 'running', turn: 2, basedOn: { branchId: 'editorial-branch', revision: 1 } }
    } }
  }
  return { chat, identity: dreamSikeTurnIdentity(chat, chat.sessionId, 2) }
}

function review() {
  return {
    character: { status: 'pass', evidence: '林然只接过封信，符合档案员审慎的行为约束。' },
    knowledge: { status: 'pass', evidence: '封信未拆开，林然没有陈述信件内容或发信人。' },
    style: { status: 'pass', evidence: '以停顿和递信动作呈现迟疑，没有直接解释全部心理。' },
    continuity: { status: 'pass', evidence: '交接仍发生在当前档案室，未跳跃至明日送信。' },
    playerAgency: { status: 'pass', evidence: '结尾停在林然询问收件人，保留玩家下一步回应。' },
    format: { status: 'pass', evidence: '正文只有叙事和对话，没有内部推理或变量协议。' }
  }
}

const BODY = '林然接过封信，指尖停在封口旁。“交给谁？”'

test('启用源预设时协议通过仍必须有六维正文审阅', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  const checked = checkDreamSikeDraft(chat, identity, 1)
  assert.equal(checked.checks.editorial.required, true)
  assert.equal(checked.checks.editorial.passed, false)
  assert.equal(checked.checks.issues[0].code, 'editorial-missing')
  assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /六维正文审阅/)
})

test('完整可观察审阅绑定草稿版本和契约，允许零补丁', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  const findings = review()
  const checked = checkDreamSikeDraft(chat, identity, 1, { now: 100, review: findings })
  assert.deepEqual(checked.checks.issues, [])
  assert.equal(checked.checks.editorial.version, 1)
  assert.ok(checked.checks.editorial.contractDigest)
  assert.deepEqual(checked.checks.editorial.review, findings)
  findings.character.evidence = '外部修改不应影响持久审阅'
  assert.notEqual(chat.dreamSikeDraft.checks.editorial.review.character.evidence, findings.character.evidence)
  assert.equal(readyDreamSikeDraft(chat, identity, 1).status, 'ready')
  assert.equal(readyDreamSikeDraft(chat, identity, 1).revisionCount, 0)
})

test('revise 阻止确认，局部修订使旧审阅失效，重新审阅后可确认', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  const findings = review()
  findings.style = { status: 'revise', evidence: '指尖停顿不够具体，改为指尖停在封口的红蜡旁。' }
  assert.match(checkDreamSikeDraft(chat, identity, 1, { review: findings }).checks.issues[0].message, /红蜡/)
  assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /修订/)
  patchDreamSikeDraft(chat, identity, { expectedVersion: 1, find: '封口旁', replacement: '封口的红蜡旁' })
  assert.equal(chat.dreamSikeDraft.checks, null)
  assert.throws(() => readyDreamSikeDraft(chat, identity, 2), /先检查/)
  checkDreamSikeDraft(chat, identity, 2, { review: review() })
  assert.equal(readyDreamSikeDraft(chat, identity, 2).status, 'ready')
})

test('契约规则变更使已就绪检查失效，不能借幂等确认绕过', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  checkDreamSikeDraft(chat, identity, 1, { review: review() })
  readyDreamSikeDraft(chat, identity, 1)
  chat.runtimePresetSnapshot.front.entries[0].content += '避免使用抽象比喻。'
  chat.runtimePresetSnapshot.front.text += '避免使用抽象比喻。'
  chat.runtimePresetSnapshot.digest = 'source-two'
  assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /预设规则已变化/)
})

test('缺失维度、空泛结果、额外推理和过长依据均不能通过审阅', () => {
  for (const mutate of [
    value => { delete value.style },
    value => { value.style.evidence = '全部检查通过，没有问题' },
    value => { value.style.evidence = '符合要求' },
    value => { value.style.evidence = '字'.repeat(501) },
    value => { value.style.evidence = '<think>完整的内部思考在这里</think>' },
    value => { value.style.evidence = '<redemption_chain>旧卡完整思考过程</redemption_chain>' },
    value => { value.privateReasoning = '不接受额外推理字段' },
    value => { value.style.chain = '不接受维度内额外字段' }
  ]) {
    const { chat, identity } = fixture()
    putDreamSikeDraft(chat, identity, BODY)
    const value = review()
    mutate(value)
    const checked = checkDreamSikeDraft(chat, identity, 1, { review: value })
    assert.equal(checked.checks.editorial.passed, false)
    assert.ok(checked.checks.issues.length)
    assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /六维正文审阅/)
  }
})

test('重新检查已就绪草稿发现问题时恢复待修订状态', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  checkDreamSikeDraft(chat, identity, 1, { review: review() })
  readyDreamSikeDraft(chat, identity, 1)
  assert.equal(checkDreamSikeDraft(chat, identity, 1).status, 'draft')
})

test('无原始写作规则时保留既有确定性检查路径', () => {
  const { chat, identity } = fixture()
  delete chat.runtimePresetSnapshot
  putDreamSikeDraft(chat, identity, BODY)
  assert.deepEqual(checkDreamSikeDraft(chat, identity, 1, 50).checks, { version: 1, issues: [], checkedAt: 50 })
  assert.equal(readyDreamSikeDraft(chat, identity, 1).status, 'ready')
})

test('六维审阅全部 pass 也不能覆盖源预设的确定性格式缺陷', () => {
  const { chat, identity } = fixture()
  chat.runtimePresetSnapshot.front.entries.push({
    id: 'cb7fb49f-4496-4ca2-b2d2-39aed039ae5d', name: 'DREAM_PLOT', enabled: true,
    content: '采用 dream_plot、dream_body、dream_after_format 的文档外壳。'
  })
  putDreamSikeDraft(chat, identity, BODY)
  const checked = checkDreamSikeDraft(chat, identity, 1, { review: review() })
  assert.equal(checked.checks.editorial.passed, true)
  assert.ok(checked.checks.issues.some(item => item.code === 'preset-dream_plot'))
  assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /格式或协议/)
  patchDreamSikeDraft(chat, identity, {
    expectedVersion: 1, find: BODY,
    replacement: '<dream_plot><dream_body>' + BODY + '</dream_body><dream_after_format></dream_after_format></dream_plot>'
  })
  assert.deepEqual(checkDreamSikeDraft(chat, identity, 2, { review: review() }).checks.issues, [])
  assert.equal(readyDreamSikeDraft(chat, identity, 2).status, 'ready')
})

test('源预设旧思考协议标签和代码块不能进入正文，HTML 与可见外壳可保留', () => {
  for (const text of ['<redemption_chain>内部推理</redemption_chain>', '```redemption_chain\n内部推理\n```', '<thought_of_chain>内部推理</thought_of_chain>', '<thinking_step>内部推理</thinking_step>', '```thinking_step\n内部推理\n```', '```thought_of_chain\n内部推理\n```']) {
    assert.ok(inspectDreamSikeDraft(text).some(item => item.code === 'private-protocol'))
  }
  assert.deepEqual(inspectDreamSikeDraft('<dream_plot><dream_body><div>正文</div></dream_body><dream_after_format></dream_after_format></dream_plot>'), [])
})

test('原生工具向 Agent 暴露契约与审阅结构，审阅缺失反馈能引导修订', async () => {
  const { chat } = fixture()
  const registered = new Map()
  registerDreamSikeTools({
    tools: { register(tool) { registered.set(tool.name, tool) } },
    chatForSession: async () => chat,
    updateChat: async (_id, mutation) => mutation(chat),
    activeTurnOf: () => 2
  })
  const exec = { agent: { session: { id: chat.sessionId } } }
  const read = await registered.get('sike_read_turn').execute({}, exec)
  const report = JSON.parse(read.report)
  assert.equal(report.editorialRequired, true)
  assert.ok(report.presetContract.digest)
  assert.match(report.next, /六维/)
  assert.ok(registered.get('sike_check_draft').parameters.properties.review)
  await registered.get('sike_put_draft').execute({ text: BODY }, exec)
  const missing = await registered.get('sike_check_draft').execute({ expectedVersion: 1 }, exec)
  assert.match(missing.report, /六个检查维度/)
  const checked = await registered.get('sike_check_draft').execute({ expectedVersion: 1, review: review() }, exec)
  assert.match(checked.report, /Agent 判断/)
  assert.equal((await registered.get('sike_ready_draft').execute({ expectedVersion: 1 }, exec)).draft.status, 'ready')
})
