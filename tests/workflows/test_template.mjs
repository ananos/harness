import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../../templates/workflow.js', import.meta.url), 'utf8')
  .replace(/^export const meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', src)

const calls = []
const agent = async (prompt, opts) => {
  calls.push(opts)
  if (opts.label === 'gather') return { items: ['a', 'b'] }
  if (opts.label.startsWith('work-')) return { item: 'x', done: true }
  return { ok: true, reason: 'r' }
}
const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
  let r = item
  for (const s of stages) r = await s(r, item, i)
  return r
}))
const r = await body('input', agent, null, pipeline, () => {}, () => {})
assert.equal(r.status, 'done')
assert.deepEqual(calls.map(c => c.model), ['haiku', 'sonnet', 'sonnet', 'opus', 'opus'])
console.log('ok   template: runs, routes gather/work/check to haiku/sonnet/opus')
