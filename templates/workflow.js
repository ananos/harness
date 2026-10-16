export const meta = {
  name: '__NAME__',
  description: 'One line shown in the permission dialog',
  whenToUse: 'When to reach for it, and the args it takes',
  phases: [
    { title: 'Gather', detail: 'cheap model collects the work list' },
    { title: 'Work', detail: 'one agent per item, on the tier the item needs' },
    { title: 'Check', detail: 'a different model verifies each result' },
  ],
}

// Args: a string, or an object. Keep the string form for the common case.
const A = typeof args === 'string' ? { input: args } : (args || {})
if (!A.input) throw new Error('__NAME__ needs input')

// One place for model routing; callers override with args.models.
const M = Object.assign({ gather: 'haiku', work: 'sonnet', check: 'opus' }, A.models || {})

const ITEMS = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'string' } } },
  required: ['items'],
}
const RESULT = {
  type: 'object',
  properties: { item: { type: 'string' }, done: { type: 'boolean' }, notes: { type: 'string' } },
  required: ['item', 'done'],
}
const VERDICT = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['ok', 'reason'],
}

phase('Gather')
const list = await agent(`List the items to work on for: ${A.input}. Read only.`,
  { label: 'gather', schema: ITEMS, model: M.gather, effort: 'low' })

// pipeline: each item goes Work -> Check on its own, no barrier between stages.
const results = await pipeline(list.items,
  (item, _, i) => agent(`Do the work for: ${item}. Stay local; do not push or post.`,
    { phase: 'Work', label: `work-${i}`, schema: RESULT, model: M.work }),
  (res, item, i) => agent(`Check this result for "${item}" and try to find what is wrong:\n${JSON.stringify(res)}`,
    { phase: 'Check', label: `check-${i}`, schema: VERDICT, model: M.check })
    .then(v => Object.assign({}, res, { verdict: v })))

const ok = results.filter(r => r && r.verdict && r.verdict.ok)
log(`${ok.length}/${list.items.length} items passed the check`)
return { status: ok.length === list.items.length ? 'done' : 'partial', results }
