import { parseDocument, stringify } from 'yaml'
import { z } from 'zod'

const nonblank = z.string().refine(value => value.trim().length > 0, 'Expected nonempty text')
const fact = z.object({ id: nonblank, description: nonblank })
const hint = z.object({ content: nonblank, creator: nonblank, created_at: nonblank })
const intent = z.object({
  from: z.array(nonblank).min(1),
  to: nonblank.nullable(),
  description: nonblank,
  creator: nonblank,
  worker: nonblank.nullable().default(null),
  created_at: nonblank,
  concluded_at: nonblank.nullable().default(null),
})

export const boardSchema = z.object({
  project: z.object({
    title: nonblank, origin: nonblank, goal: nonblank,
    bootstrap_enabled: z.boolean().default(false),
  }),
  facts: z.array(fact),
  hints: z.array(hint).default([]),
  intents: z.array(intent).default([]),
}).superRefine((board, ctx) => {
  const facts = new Map(board.facts.map(item => [item.id, item.description]))
  const issue = message => ctx.addIssue({ code: 'custom', message })
  if (facts.size !== board.facts.length) issue('Each fact must have a unique ID.')
  for (const id of ['origin', 'goal']) {
    if (facts.get(id) !== board.project[id]) issue('Fact ' + id + ' must match project.' + id + '.')
  }
  for (const [index, edge] of board.intents.entries()) {
    const refs = edge.to === null ? edge.from : [...edge.from, edge.to]
    const missing = refs.find(id => !facts.has(id))
    if (missing !== undefined) issue('Intent ' + (index + 1) + ' refers to unknown fact ' + missing + '.')
  }
})

export function createBoard(title, origin, goal) {
  return {
    project: { title, origin, goal, bootstrap_enabled: false },
    facts: [{ id: 'origin', description: origin }, { id: 'goal', description: goal }],
    hints: [], intents: [],
  }
}

export function importBoard(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Supply the contents of a Cairn YAML export.')
  if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) throw new Error('Cairn YAML imports support up to 1 MiB.')
  const doc = parseDocument(source, { schema: 'core', prettyErrors: false, stringKeys: true })
  const problem = doc.errors[0] ?? doc.warnings[0]
  if (problem) throw new Error('Invalid Cairn YAML. ' + problem.message)
  const result = boardSchema.safeParse(doc.toJS({ maxAliasCount: 32 }))
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error('Invalid Cairn board at ' + (first.path.join('.') || 'root') + '. ' + first.message)
  }
  return result.data
}

export function exportBoard(board) {
  const { project, facts, hints, intents } = board
  return stringify({
    project, ...(hints.length ? { hints } : {}), facts, ...(intents.length ? { intents } : {}),
  }, { lineWidth: 0, aliasDuplicateObjects: false })
}

export const pageSize = 12

export function pageInfo(page, total) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) {
    throw new Error('Choose a page from 1 to ' + pages + '.')
  }
  return { page, pages }
}

const intentId = number => 'i' + String(number).padStart(3, '0')

export function showBoard(board, page = 1) {
  const { project, facts, intents, hints } = board
  const paging = pageInfo(page, Math.max(facts.length, intents.length, hints.length))
  const start = (page - 1) * pageSize
  const excerpt = items => items.slice(start, start + pageSize)
  return {
    project, ...paging,
    counts: {
      facts: facts.length, intents: intents.length, openIntents: intents.filter(i => i.to === null).length,
      hints: hints.length, goalLinks: intents.filter(i => i.to === 'goal').length,
    },
    facts: excerpt(facts),
    intents: excerpt(intents).map((edge, i) => ({ id: intentId(start + i + 1), ...edge })),
    hints: excerpt(hints),
  }
}

function sourceFacts(board, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('Supply at least one source fact ID in from.')
  const known = new Set(board.facts.map(item => item.id))
  for (const id of ids) {
    if (!known.has(id)) throw new Error('Unknown source fact ' + id + '. Show the board to see its IDs.')
  }
  return [...new Set(ids)]
}

function nextFactId(facts) {
  const known = new Set(facts.map(item => item.id))
  let number = facts.length - 1
  while (known.has('f' + String(number).padStart(3, '0'))) number++
  return 'f' + String(number).padStart(3, '0')
}

// Table.update calls this transform against the most recent durable board.
export function addEntry(board, args, timestamp) {
  const { kind, text } = args
  const actor = 'dsh'
  if (kind === 'hint') {
    const hint = { content: text, creator: actor, created_at: timestamp }
    return { ...board, hints: [...board.hints, hint] }
  }
  if (kind === 'intent' || kind === 'goal') {
    const reached = kind === 'goal'
    const edge = {
      from: sourceFacts(board, args.from), to: reached ? 'goal' : null, description: text,
      creator: actor, worker: reached ? actor : null, created_at: timestamp, concluded_at: reached ? timestamp : null,
    }
    return { ...board, intents: [...board.intents, edge] }
  }
  if (kind !== 'fact') throw new Error('Unknown entry kind.')
  const fact = { id: nextFactId(board.facts), description: text }
  const facts = [...board.facts, fact]
  if (!args.intent) return { ...board, facts }
  const index = board.intents.findIndex((_, i) => intentId(i + 1) === args.intent)
  if (index < 0) throw new Error('Unknown intent ' + args.intent + '. Show the board to see its IDs.')
  if (board.intents[index].to !== null) throw new Error('Intent ' + args.intent + ' already has a conclusion.')
  const intents = board.intents.slice()
  intents[index] = { ...intents[index], to: fact.id, worker: actor, concluded_at: timestamp }
  return { ...board, facts, intents }
}

export function entryReceipt(board, args) {
  switch (args.kind) {
    case 'fact': return { fact: board.facts.at(-1).id, ...(args.intent ? { concluded: args.intent } : {}) }
    case 'hint': return { hint: board.hints.length }
    case 'intent': return { intent: intentId(board.intents.length) }
    case 'goal': return { intent: intentId(board.intents.length), to: 'goal' }
  }
}
