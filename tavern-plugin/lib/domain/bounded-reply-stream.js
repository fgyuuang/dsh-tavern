// Bounds only foreground Tavern single replies, never background/compaction.
// Abort the provider as well as the consumer, even if the provider ignores abort.
export async function* boundedReplyStream(open, signal, { totalMs = 480000, idleMs = 90000 } = {}) {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  let totalTimer, idleTimer, iterator
  let fail
  const failed = new Promise((_, reject) => { fail = reject })
  // Register a handler immediately so cancellation during a suspended yield is safe.
  failed.catch(() => {})
  function timeout(message) {
    const error = Object.assign(new Error(message), { code: 'TIMEOUT' })
    controller.abort(error)
    fail(error)
  }
  function aborted() { fail(combined.reason || new Error('回复已中断')) }
  combined.addEventListener('abort', aborted, { once: true })
  try {
    combined.throwIfAborted()
    totalTimer = setTimeout(() => timeout('本次正文生成已达到 8 分钟时限，收到的内容已保留，可继续本回合'), totalMs)
    iterator = open(combined)[Symbol.asyncIterator]()
    while (true) {
      const result = await Promise.race([iterator.next(), failed])
      if (result.done) break
      const chunk = result.value
      if (chunk?.type === 'text-delta' && chunk.text) {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => timeout('正文已连续 90 秒没有新增，收到的内容已保留，可继续本回合'), idleMs)
      }
      yield chunk
    }
  } finally {
    clearTimeout(totalTimer)
    clearTimeout(idleTimer)
    combined.removeEventListener('abort', aborted)
    if (!controller.signal.aborted) controller.abort()
    // Do not await a broken transport's return: it can hang just like next().
    if (iterator?.return) Promise.resolve(iterator.return()).catch(() => {})
  }
}
