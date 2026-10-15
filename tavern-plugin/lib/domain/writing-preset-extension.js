// Public v1 boundary for writing-preset plugins. Runtime state and atomic writes
// remain owned by Tavern; plugins never read its files or call private HTTP RPC.
const METHODS = new Set([
  'listPlayPresets', 'listPresets', 'applyPlayPreset', 'applyConversationPreset',
  'getGenerationMode', 'setGenerationMode', 'getConversationPresetSettings', 'updateConversationPresetSettings',
  'getDreamSikeExecutionPolicy', 'setDreamSikeExecutionPolicy', 'getGlobalAgentPresetSettings',
  'updateGlobalAgentPresetSettings', 'setDefaultPlayPreset', 'getDraftView', 'resumeDreamSikeDraft',
  'getInterruptedReply', 'replayTurn'
])

export function createWritingPresetExtension({ dispatch, readView }) {
  return Object.freeze({ version: 1,
    async request(method, args = {}) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('预设请求参数必须是对象')
      if (method === 'getSession') {
        if (typeof args.sessionId !== 'string' || !args.sessionId) throw new TypeError('缺少游玩会话编号')
        return { view: await readView(args.sessionId) }
      }
      if (!METHODS.has(method)) throw new Error('预设插件不支持此操作：' + String(method))
      return await dispatch(method, structuredClone(args))
    }
  })
}
