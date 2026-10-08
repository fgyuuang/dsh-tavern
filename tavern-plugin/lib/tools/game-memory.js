import { defineTool } from '@deepseek-ai/dsh-tools'
import { GAME_MEMORY_READ_TOOL, readGameMemory } from '../domain/game-memory-task.js'
import { dshParameterFields } from '../domain/dsh-tool-schema.js'

export function registerGameMemoryTools({ tools, chatForSession, workspace }) {
  tools.register(defineTool({
    ...GAME_MEMORY_READ_TOOL,
    parameters: dshParameterFields(GAME_MEMORY_READ_TOOL.parameters),
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'json', required: true } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.report) }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const chat = await chatForSession(exec?.agent?.session?.id || '')
      return { report: await readGameMemory(workspace, chat, args) }
    }
  }))
}
