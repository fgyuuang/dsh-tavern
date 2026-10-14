import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAssistantReply } from '../tavern-plugin/lib/domain/session-reply-projection.js'
function fixture(content) {
  const original={seq:0,type:'assistant/message',data:{turn:1,step:3,message:{id:'original',role:'assistant',source:{kind:'model'},content}}}
  const session={id:'s',events:[original],surface:{nodes:[0]},append(type,data,intent){
    const event={seq:this.events.length,type,data,...intent};this.events.push(event)
    if(intent.surfaceOp==='append')this.surface.nodes.push(event.seq);else this.surface.nodes=[event.seq]
    return event
  }}
  return {session,result:{index:0,event:original,text:content.filter(b=>b.type==='text').map(b=>b.text).join('')}}
}
test('工具调用事件完整保留，正式正文追加一次，重复投影不重复写入', () => {
  const h=fixture([{type:'tool-call',id:'ready',name:'sike_ready_draft',arguments:'{"expectedVersion":1}'}])
  const before=structuredClone(h.session.events[0])
  const first=projectAssistantReply(h.session,h.result,'正式正文')
  assert.equal(projectAssistantReply(h.session,h.result,'正式正文'),first)
  assert.deepEqual(h.session.events[0],before);assert.deepEqual(h.session.surface.nodes,[0,1])
  assert.throws(()=>projectAssistantReply(h.session,h.result,'不同正文'),/不同内容/)
  assert.equal(h.session.events.length,2)
})
test('普通模型完成提示依旧在原位置替换为正式正文', () => {
  const h=fixture([{type:'text',text:'完成。'}])
  const replacement=projectAssistantReply(h.session,h.result,'正式正文')
  assert.equal(replacement.surfaceOp.op,'replace');assert.deepEqual(h.session.surface.nodes,[1])
  assert.deepEqual(replacement.sourceEventSeqs,[0])
})
