import test from 'node:test'
import assert from 'node:assert/strict'
import { addEntry, createBoard, exportBoard, importBoard, showBoard } from '../board.js'

const timestamp = '2026-11-21 18:00:00'
const start = () => createBoard('Field guide', 'Draft ready', 'Readable map')

test('an intent links several facts to its conclusion and can only be concluded once', () => {
  const board = start()
  const observed = addEntry(board, { kind: 'fact', text: 'Printer available' }, timestamp)
  const plan = addEntry(observed, { kind: 'intent', text: 'Print a proof', from: ['origin', 'f001'] }, timestamp)
  const result = addEntry(plan, { kind: 'fact', intent: 'i001', text: 'Map legible' }, timestamp)
  assert.deepEqual(showBoard(result).intents[0].from, ['origin', 'f001'])
  assert.equal(showBoard(result).intents[0].to, 'f002')
  assert.equal(plan.intents[0].to, null)
  assert.throws(() => addEntry(result, { kind: 'fact', intent: 'i001', text: 'Again' }, timestamp), /already has a conclusion/)
  assert.equal(result.facts.length, 4)
  const reached = addEntry(result, { kind: 'goal', text: 'Proof passed', from: ['f002'] }, timestamp)
  assert.equal(showBoard(reached).counts.goalLinks, 1)
})

test('native Cairn YAML retains project settings, authors, timestamps, hints, and open intents', () => {
  const yaml = `project:
  title: Field guide
  origin: Draft ready
  goal: Readable map
  bootstrap_enabled: true
hints:
- content: Try recycled stock
  creator: editor
  created_at: '2026-11-20 08:00:00'
facts:
- id: origin
  description: Draft ready
- id: goal
  description: Readable map
- id: f003
  description: Printer available
intents:
- from: [origin, f003]
  to: null
  description: Print a proof
  creator: editor
  worker: null
  created_at: '2026-11-20 08:05:00'
  concluded_at: null
`
  const board = importBoard(yaml)
  assert.equal(board.hints[0].creator, 'editor')
  assert.equal(board.project.bootstrap_enabled, true)
  assert.deepEqual(importBoard(exportBoard(board)), board)
  assert.equal(showBoard(board).intents[0].id, 'i001')
  assert.doesNotMatch(exportBoard(board), /i001/)
  const observed = addEntry(board, { kind: 'fact', intent: 'i001', text: 'Readable map' }, timestamp)
  assert.equal(new Set(observed.facts.map(f => f.id)).size, observed.facts.length)
  assert.deepEqual(importBoard(exportBoard(observed)), observed)
})

test('invalid YAML and broken references leave a valid graph untouched', () => {
  const board = start()
  assert.throws(() => importBoard('project: [unfinished'), /Invalid Cairn YAML/)
  assert.throws(() => importBoard(exportBoard({ ...board, facts: [...board.facts, board.facts[0]] })), /unique ID/)
  assert.throws(() => addEntry(board, { kind: 'intent', from: ['f999'], text: 'Check' }, timestamp), /Unknown source fact/)
  assert.deepEqual(board, start())
})

test('paging keeps stable IDs and survives a YAML interchange', () => {
  let board = start()
  for (let i = 0; i < 13; i++) {
    board = addEntry(board, { kind: 'intent', text: 'Compare stock ' + i, from: ['origin'] }, timestamp)
  }
  const snapshot = showBoard(importBoard(exportBoard(board)), 2)
  assert.equal(snapshot.pages, 2)
  assert.equal(snapshot.intents[0].id, 'i013')
  assert.equal(snapshot.counts.openIntents, 13)
  assert.throws(() => showBoard(board, 3), /1 to 2/)
})
