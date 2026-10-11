// Protocol markers identify serialized reasoning, not its semantic contents.
export function hasPrivateWritingProtocol(text) {
  return /<\/?(?:think|simple_thinking|dream_self_check|redemption_chain|thought_of_chain|thinking_step)(?:\s[^>]*)?>|```(?:thought|analysis|reasoning|redemption_chain|thought_of_chain|thinking_step)\b/i.test(typeof text === 'string' ? text : '')
}
