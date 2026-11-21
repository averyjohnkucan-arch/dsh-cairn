import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
  addEntry, boardSchema, createBoard, entryReceipt, exportBoard, importBoard,
  pageInfo, pageSize, showBoard,
} from './board.js'

export const name = 'dsh-cairn-board'
export const inject = ['tools', 'storageDomain']

const boardFields = {
  list: ['page'], create: ['board', 'title', 'origin', 'goal'], show: ['board', 'page'],
  import: ['board', 'yaml'], export: ['board'],
}
const entryFields = {
  fact: ['board', 'text', 'intent'], hint: ['board', 'text'],
  intent: ['board', 'text', 'from'], goal: ['board', 'text', 'from'],
}

function checkAction(args, selector, fields) {
  const action = args?.[selector]
  if (typeof action !== 'string' || !Object.hasOwn(fields, action)) {
    throw new Error('Choose ' + selector + ' from ' + Object.keys(fields).join(', ') + '.')
  }
  const extra = Object.keys(args).find(key => key !== selector && !fields[action].includes(key))
  if (extra) throw new Error('Field ' + extra + ' does not apply to ' + action + '.')
}

function textField(args, key) {
  if (typeof args[key] !== 'string' || !args[key].trim()) throw new Error('Supply nonempty ' + key + '.')
  return args[key].trim()
}

function boardName(args) {
  const slug = textField(args, 'board')
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    throw new Error('Use 1–64 lowercase letters, digits, or hyphens for the board name. Start with a letter or digit.')
  }
  return slug
}

function workspacePrefix(exec) {
  const header = exec.agent?.session?.header
  if (!header?.id) throw new Error('Open a DSH chat to use a Cairn board.')
  const scope = header.cwd ? ['cwd', resolve(header.cwd)] : ['session', header.id]
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex') + '_'
}

const string = description => ({ type: 'string', description })
const slugProperty = string('Short board name, such as booklet. Use lowercase letters, digits, and hyphens.')

function parameters(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false }
}

const output = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, result) {
    return [{ type: 'text', text: result.yaml ?? result.message ?? JSON.stringify(result, null, 2) }]
  },
}

function callCard(title, args) {
  return { card: 'generic', title: args?.board ? title + ' · ' + args.board : title, kind: 'other' }
}

function boardTool(boards) {
  const creating = new Set()
  const titles = { list: 'List Cairn boards', show: 'Show Cairn board', create: 'Create Cairn board', import: 'Import Cairn board', export: 'Export Cairn board' }
  return {
    name: 'cairn_board',
    description: 'Manage Cairn project boards shared by chats in this working directory. Show a board to see fact and intent IDs for cairn_entry.',
    parameters: parameters({
      action: { type: 'string', enum: Object.keys(boardFields) },
      board: slugProperty, title: string('Project title for create.'),
      origin: string('Starting facts or situation for create.'), goal: string('Success condition for create.'),
      yaml: string('Contents of a Cairn project YAML export to import into a new board.'),
      page: { type: 'integer', description: 'One-based page for list or show. Defaults to 1.' },
    }, ['action']),
    output,
    presentCall: args => callCard(titles[args?.action] ?? 'Cairn boards', args),
    async execute(args, exec) {
      checkAction(args, 'action', boardFields)
      const prefix = workspacePrefix(exec)
      if (args.action === 'list') {
        const names = Array.from(boards.keys()).filter(key => key.startsWith(prefix)).sort()
        const { page, pages } = pageInfo(args.page ?? 1, names.length)
        const items = names.slice((page - 1) * pageSize, page * pageSize).map(key => ({
          board: key.slice(prefix.length), title: boards.get(key).project.title,
        }))
        if (names.length === 0) return { boards: [], page, pages, message: 'No Cairn boards here yet. Create one with a board name, title, origin, and goal.' }
        return { boards: items, page, pages, total: names.length }
      }
      const board = boardName(args)
      const key = prefix + board
      const current = boards.get(key)
      if (args.action === 'create' || args.action === 'import') {
        if (current || creating.has(key)) throw new Error('Board ' + board + ' already exists. Show it or choose a new name.')
        const data = args.action === 'import' ? importBoard(args.yaml) :
          createBoard(textField(args, 'title'), textField(args, 'origin'), textField(args, 'goal'))
        // Reserve the name until the initial put is durable. Later writes use atomic table.update.
        creating.add(key)
        try { await boards.put(key, data) } finally { creating.delete(key) }
        const verb = args.action === 'import' ? 'Imported' : 'Created'
        return { board, message: verb + ' ' + board + '. Use show to see its facts, intents, and hints.' }
      }
      if (!current) throw missingBoard(board)
      if (args.action === 'export') return { board, yaml: exportBoard(current) }
      return { board, ...showBoard(current, args.page ?? 1) }
    },
  }
}

function missingBoard(board) {
  return new Error('Board ' + board + ' was not found here. List the boards in this working directory.')
}

function entryTool(boards) {
  const titles = { fact: 'Record Cairn fact', hint: 'Add Cairn hint', intent: 'Propose Cairn step', goal: 'Record goal evidence' }
  return {
    name: 'cairn_entry',
    description: 'Record a fact, hint, proposed step (intent), or evidence that a goal was reached. Proposed steps are entries on the board.',
    parameters: parameters({
      board: slugProperty, kind: { type: 'string', enum: Object.keys(entryFields) },
      text: string('Observation, hint, proposed step, or explanation of how the facts establish the goal.'),
      from: { type: 'array', items: { type: 'string' }, description: 'One or more source fact IDs for intent or goal. The starting fact is origin.' },
      intent: string('For a fact, optional open intent ID to conclude with this observation.'),
    }, ['board', 'kind', 'text']),
    output,
    presentCall: args => callCard(titles[args?.kind] ?? 'Update Cairn board', args),
    async execute(args, exec) {
      checkAction(args, 'kind', entryFields)
      const board = boardName(args)
      const key = workspacePrefix(exec) + board
      if (!boards.get(key)) throw missingBoard(board)
      const entry = { ...args, text: textField(args, 'text') }
      if (args.intent !== undefined) entry.intent = textField(args, 'intent')
      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
      const next = await boards.update(key, current => addEntry(current, entry, timestamp))
      return { board, ...entryReceipt(next, entry) }
    },
  }
}

export async function apply(ctx) {
  let boards
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({
      name: 'cairn_boards', version: 1, layout: 'per-record', tables: { boards: { valueSchema: boardSchema } },
    })
    boards = domain.table('boards')
    return () => domain.close()
  })
  ctx.effect(() => ctx.tools.register(boardTool(boards)))
  ctx.effect(() => ctx.tools.register(entryTool(boards)))
}
