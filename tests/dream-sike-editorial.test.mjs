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

test('六维审阅是可选优化，缺失时保留备注但完整正文可确认', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  const checked = checkDreamSikeDraft(chat, identity, 1)
  assert.equal(checked.checks.editorial.required, false)
  assert.equal(checked.checks.editorial.passed, true)
  assert.deepEqual(checked.checks.issues, [])
  assert.ok(checked.checks.editorial.notes.length)
  assert.equal(readyDreamSikeDraft(chat, identity, 1).status, 'ready')
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

test('revise 记录可选优化依据，主动局部修订仍使旧检查失效', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  const findings = review()
  findings.style = { status: 'revise', evidence: '指尖停顿不够具体，改为指尖停在封口的红蜡旁。' }
  assert.match(checkDreamSikeDraft(chat, identity, 1, { review: findings }).checks.editorial.notes[0], /红蜡/)
  assert.equal(readyDreamSikeDraft(structuredClone(chat), identity, 1).status, 'ready')
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

test('缺失维度或无效审阅不阻断正文，无效和私有依据不进入审阅记录', () => {
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
    assert.equal(checked.checks.editorial.passed, true)
    assert.deepEqual(checked.checks.issues, [])
    assert.ok(checked.checks.editorial.notes.length)
    assert.doesNotMatch(JSON.stringify(checked.checks.editorial.review), /完整的内部思考|旧卡完整思考|privateReasoning|"chain"/)
    assert.equal(readyDreamSikeDraft(chat, identity, 1).status, 'ready')
  }
})

test('重新检查省略可选审阅时仍可使用已通过的正文', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  checkDreamSikeDraft(chat, identity, 1, { review: review() })
  readyDreamSikeDraft(chat, identity, 1)
  assert.equal(checkDreamSikeDraft(chat, identity, 1).status, 'ready')
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

test('原生工具暴露契约与可选审阅，省略回执即可一次保存确认正文', async () => {
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
  assert.match(report.next, /review和brief可省略/)
  assert.equal(registered.get('sike_check_draft').parameters.properties.review.type, undefined, 'native json schema must admit optional metadata for host validation')
  await registered.get('sike_put_draft').execute({ text: BODY }, exec)
  const missing = await registered.get('sike_check_draft').execute({ expectedVersion: 1 }, exec)
  assert.equal(missing.draft.status, 'ready')
  const checked = await registered.get('sike_check_draft').execute({ expectedVersion: 1, review: review() }, exec)
  assert.match(checked.report, /已检查确认/)
  assert.equal((await registered.get('sike_ready_draft').execute({ expectedVersion: 1 }, exec)).draft.status, 'ready')
})

// The editor reviews freshly written prose, so it keeps returning revise. Without a bounded
// budget the draft could never be confirmed and every turn would die at the step cap.
test('修订预算用尽后保留审稿记录但不再阻断确认', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  const findings = review()
  findings.style = { status: 'revise', evidence: '迟疑被直接解释了，应改成停顿与递信动作。' }

  const first = checkDreamSikeDraft(chat, identity, 1, { now: 100, review: findings })
  assert.equal(first.checks.editorial.passed, true)
  assert.deepEqual(first.checks.issues, [])
  assert.ok(first.checks.editorial.notes.some(note => note.includes('迟疑')))

  chat.dreamSikeDraft.revisionCount = 2
  const second = checkDreamSikeDraft(chat, identity, 1, { now: 200, review: findings })
  assert.equal(second.checks.editorial.passed, true)
  assert.deepEqual(second.checks.issues, [])
  assert.equal(second.checks.editorial.rounds, 2)
  assert.ok(second.checks.editorial.notes.some(note => /节制叙述|迟疑/.test(note)), '修订记录应保留在检查结果中')
  assert.equal(readyDreamSikeDraft(chat, identity, 1).status, 'ready')
})

// Review metadata is advisory; actual body/protocol structure is tested independently above.
test('审阅元数据结构缺陷仅记录备注，正文结构检查仍独立执行', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, BODY)
  chat.dreamSikeDraft.editorialRounds = 5
  const broken = review()
  broken.character = { status: 'pass', evidence: '通过' }
  const checked = checkDreamSikeDraft(chat, identity, 1, { now: 100, review: broken })
  assert.equal(checked.checks.editorial.passed, true)
  assert.deepEqual(checked.checks.issues, [])
  assert.ok(checked.checks.editorial.notes.some(note => note.includes('角色行为')))
  assert.equal(readyDreamSikeDraft(chat, identity, 1).status, 'ready')
})
