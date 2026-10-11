import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { helperClient } from './fixtures/helper-host-harness.mjs'

// Exercise maintained source even before rebuilding the generated client.
const installFrameHostComposer = vm.runInNewContext(
  readFileSync(new URL('../tavern-plugin/src/client/modules/frame-lifecycle.js', import.meta.url), 'utf8') + '\n' +
  readFileSync(new URL('../tavern-plugin/src/client/legacy-composer.js', import.meta.url), 'utf8') + '\ninstallFrameHostComposer'
)

function mount(send, managed = false, draft) {
  const nodes = []
  function element() {
    return { value: '', append(...items) { nodes.push(...items) }, setAttribute() {}, addEventListener(name, fn) { this[name] = fn } }
  }
  const document = { body: element(), createElement: element, getElementById(id) { return nodes.find(n => n.id === id) } }
  const html = helperClient.buildTavernFrameDocument({ token: 'send', content: '<p>opening</p>', helperContext: { messages: [] } })
  const source = html.match(/<script data-dsh-tavern-legacy-composer>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(source)
  vm.runInNewContext(source, { document, window: managed ? { submitTavernInput: send, triggerSlash: draft } : { triggerSlash: send }, console: { error() {} } })
  return { nodes, area: document.getElementById('send_textarea'), button: document.getElementById('send_but') }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
test('模块内兼容输入即使有独立发送 API 仍同步 draft，不触发发送', async () => {
  const sends = [], drafts = []
  const { area } = mount(text => sends.push(text), true, command => { drafts.push(command); return Promise.resolve() })
  area.value = '模块交互后的输入'; area.input(); await tick()
  assert.deepEqual(drafts, ['/setinput 模块交互后的输入'])
  assert.deepEqual(sends, [])
})

test('failed legacy send retains payload, displays failure and permits retry', async () => {
  const { nodes, area, button } = mount(() => Promise.reject(new Error('发送失败')))
  area.value = '开始故事'; button.click(); await tick()
  assert.equal(area.value, '开始故事')
  assert.equal(button.disabled, false)
  assert.ok(nodes.some(n => /开局消息发送失败/.test(n.textContent)))
})

test('parent composer routes to the focused card, survives replacement and releases owners', async () => {
  const nodes = [], calls = [], errors = [];
  function element() { return { value: '', append(...items) { nodes.push(...items) }, remove() { this.removed = true }, addEventListener(name, fn) { this[name] = fn } } }
  const doc = { body: element(), createElement: element, getElementById: id => nodes.find(n => n.id === id) };
  const a = {}, b = {};
  let finish;
  const releaseA = installFrameHostComposer(doc, n => n === a, text => { calls.push(['A', text]); return new Promise(r => { finish = r }) }, e => errors.push(e.message));
  const releaseB = installFrameHostComposer(doc, n => n === b, text => { calls.push(['B', text]); throw new Error('失败可重试') }, e => errors.push(e.message));
  const area = doc.getElementById('send_textarea'), button = doc.getElementById('send_but');
  doc.activeElement = a; area.value = '开始\n姓名 | /trigger'; button.click(); button.click();
  doc.activeElement = b; await tick();
  assert.deepEqual(calls, [['A', '开始\n姓名 | /trigger']]);
  finish(); await tick();
  area.value = 'B 的开局'; button.click(); await tick();
  assert.deepEqual(errors, ['失败可重试']); assert.equal(area.value, 'B 的开局');
  button.click(); await tick(); assert.equal(calls.length, 3);
  releaseB(); assert.throws(() => button.click(), /无法确定/);
  doc.activeElement = a; area.value = '已经卸载'; button.click(); releaseA(); await tick();
  assert.equal(calls.length, 3); assert.ok(errors.includes('卡片已关闭，请重新打开'));
});

function hostHarness() {
  const nodes = [], controls = [];
  function element() {
    const node = { value: '', append(...items) { nodes.push(...items) }, remove() { this.removed = true },
      addEventListener(name, fn) { this[name] = fn } };
    controls.push(node); return node;
  }
  const doc = { body: element(), createElement: element, getElementById: id => nodes.find(n => n.id === id) };
  return { doc, controls, area: () => doc.getElementById('send_textarea'), button: () => doc.getElementById('send_but') };
}

test('card input updates only its native draft, preserves multiline text and never submits', async () => {
  const { doc, controls, area, button } = hostHarness(), calls = [], errors = [];
  const frame = {};
  const release = installFrameHostComposer(doc, n => n === frame, text => { calls.push(['send', text]); },
    e => errors.push(e.message), text => { calls.push(['draft', text]); });
  doc.activeElement = frame;
  const text = '  场景\n姓名 | /trigger\n';
  area().value = text; area().input(); await tick();
  assert.equal(controls[1].hidden, true);
  assert.deepEqual(calls, [['draft', text]]);
  assert.equal(area().value, text);
  assert.deepEqual(errors, []);
  button().click(); await tick();
  assert.deepEqual(calls, [['draft', text], ['send', text.trim()]]);
  release();
});

test('queued draft captures its frame and does not route through another focused card', async () => {
  const { doc, area } = hostHarness(), drafts = [], errors = [];
  const a = {}, b = {};
  const releaseA = installFrameHostComposer(doc, n => n === a, () => {}, e => errors.push(e.message), text => drafts.push(['A', text]));
  const releaseB = installFrameHostComposer(doc, n => n === b, () => {}, e => errors.push(e.message), text => drafts.push(['B', text]));
  doc.activeElement = a; area().value = 'A 的输入'; area().input();
  doc.activeElement = b; await tick();
  assert.deepEqual(drafts, [['A', 'A 的输入']]);
  area().value = 'B 的输入'; area().input(); await tick();
  assert.deepEqual(drafts, [['A', 'A 的输入'], ['B', 'B 的输入']]);
  assert.deepEqual(errors, []); releaseA(); releaseB();
});

test('released or obsolete frame rejects deferred input without updating another Session', async () => {
  const { doc, area } = hostHarness(), drafts = [], errors = [];
  const frame = {}; let current = true;
  const release = installFrameHostComposer(doc, n => current && n === frame, () => {}, e => errors.push(e.message), text => drafts.push(text));
  doc.activeElement = frame; area().value = '旧文档'; area().input(); current = false; await tick();
  assert.deepEqual(drafts, []); assert.ok(errors.includes('卡片已关闭，请重新打开'));
  current = true; area().value = '已解绑'; area().input(); release(); await tick();
  assert.deepEqual(drafts, []); assert.equal(errors.filter(e => e === '卡片已关闭，请重新打开').length, 2);
});

test('rapid input keeps the latest draft and preview controls never target an active Session', async () => {
  const { doc, area } = hostHarness(), drafts = [], errors = [];
  const frame = {};
  const release = installFrameHostComposer(doc, n => n === frame, () => {}, e => errors.push(e.message), text => drafts.push(text));
  doc.activeElement = frame; area().value = '旧输入'; area().input(); area().value = ''; area().input(); await tick();
  assert.deepEqual(drafts, ['']); release();
  const preview = hostHarness();
  const releasePreview = installFrameHostComposer(preview.doc, n => n === frame, () => drafts.push('submitted'), e => errors.push(e.message));
  preview.doc.activeElement = frame; preview.area().value = '准备页文字'; preview.area().input(); await tick();
  assert.deepEqual(drafts, ['']); assert.equal(preview.area().value, '准备页文字');
  assert.deepEqual(errors, []); releasePreview();
});

test('unidentified input reports failure and never guesses a Session', async () => {
  const { doc, area } = hostHarness(), drafts = [], errors = [];
  const frame = {};
  const release = installFrameHostComposer(doc, n => n === frame, () => {}, e => errors.push(e.message), text => drafts.push(text));
  doc.activeElement = {}; area().value = '无归属'; area().input(); await tick();
  assert.deepEqual(drafts, []); assert.ok(errors.some(e => e.includes('无法确定输入文字所属'))); release();
});
