import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { normalizeResourcePath } from './file-resources.js'

const FILE = 'card-projects.json'
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

function cardPath(value) {
  if (typeof value !== 'string') throw new Error('人物卡项目路径不合法')
  const normalized = normalizeResourcePath(value, 'card')
  if (!normalized.startsWith('cards/')) throw new Error('人物卡项目路径不合法')
  return normalized
}

function titleOf(value, resourcePath) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : path.posix.basename(resourcePath, path.posix.extname(resourcePath))
}

function normalize(value) {
  const projects = {}
  const paths = {}
  for (const [key, project] of Object.entries(value?.projects || {})) {
    if (!key.startsWith('project-') || project?.id !== key) continue
    projects[key] = {
      id: key,
      title: typeof project.title === 'string' ? project.title : '',
      cardPath: null,
      createdAt: Number.isFinite(project.createdAt) ? project.createdAt : 0
    }
  }
  for (const [resourcePath, projectId] of Object.entries(value?.paths || {})) {
    if (!own(projects, projectId) || projects[projectId].cardPath !== null) continue
    let normalized
    try { normalized = cardPath(resourcePath) } catch { continue }
    if (own(paths, normalized)) continue
    paths[normalized] = projectId
    projects[projectId].cardPath = normalized
  }
  return { version: 1, projects, paths }
}

/** Stable local project identities; story state remains isolated in each chat. */
export function createCardProjects({ store, id = randomUUID }) {
  const read = async () => normalize(await store.readJson(FILE))

  function create(state, resourcePath, title) {
    const projectId = 'project-' + id()
    if (own(state.projects, projectId)) throw new Error('人物卡项目标识重复')
    const project = { id: projectId, title: titleOf(title, resourcePath), cardPath: resourcePath, createdAt: Date.now() }
    state.projects[projectId] = project
    state.paths[resourcePath] = projectId
    return project
  }

  async function ensure(resourcePath, title) {
    const normalized = cardPath(resourcePath)
    const state = await store.updateJson(FILE, current => {
      const next = normalize(current)
      if (!own(next.paths, normalized)) create(next, normalized, title)
      return next
    })
    return { ...state.projects[state.paths[normalized]] }
  }

  /** Read-only; with no filter, includes projects whose card was removed. */
  async function list(cards) {
    const filter = cards === undefined ? null : new Set(cards.map(item => cardPath(typeof item === 'string' ? item : item.path)))
    const state = await read()
    return Object.values(state.projects)
      .filter(project => filter === null || filter.has(project.cardPath))
      .map(project => ({ ...project }))
  }

  async function movePath(from, to) {
    const source = cardPath(from)
    const destination = to === null || to === undefined ? null : cardPath(to)
    let result = null
    await store.updateJson(FILE, current => {
      const state = normalize(current)
      const projectId = state.paths[source]
      if (!projectId) {
        // Resource rename recovery may replay an already completed move.
        if (destination && own(state.paths, destination)) result = { ...state.projects[state.paths[destination]] }
        return state
      }
      if (destination && own(state.paths, destination) && state.paths[destination] !== projectId) {
        throw new Error('目标人物卡已绑定其他项目')
      }
      if (source !== destination) {
        delete state.paths[source]
        if (destination) state.paths[destination] = projectId
        state.projects[projectId].cardPath = destination
      }
      result = { ...state.projects[projectId] }
      return state
    })
    return result
  }

  async function projectRows(rows, pathField, titleField) {
    const prepared = rows.map(row => ({ row, path: row[pathField] ? cardPath(row[pathField]) : null }))
    let state = await read()
    const needsBinding = prepared.some(({ row, path }) => path && !own(state.projects, row.projectId) && !own(state.paths, path))
    if (needsBinding) {
      state = await store.updateJson(FILE, current => {
        const next = normalize(current)
        for (const { row, path } of prepared) {
          if (path && !own(next.projects, row.projectId) && !own(next.paths, path)) create(next, path, row[titleField])
        }
        return next
      })
    }
    return prepared.map(({ row, path }) => {
      const projectId = own(state.projects, row.projectId) ? row.projectId : path && state.paths[path]
      const result = { ...row }
      if (projectId) result.projectId = projectId
      else delete result.projectId
      return result
    })
  }

  return Object.freeze({
    read,
    ensure,
    list,
    movePath,
    projectSessions: sessions => projectRows(sessions, 'cardPath', 'cardName'),
    projectCards: cards => projectRows(cards, 'path', 'name')
  })
}
