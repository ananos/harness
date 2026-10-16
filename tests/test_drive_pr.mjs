// Control-flow test for workflows/drive-pr.js with stubbed agents.
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const src = readFileSync(new URL('../workflows/drive-pr.js', import.meta.url), 'utf8')
  .replace(/^export const meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', src)

function harness(script) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || opts.phase || 'agent'
    calls.push(label)
    return script(label, prompt, opts)
  }
  const parallel = async thunks => Promise.all(thunks.map(t => t().catch(() => null)))
  return { calls, run: a => body(a, agent, parallel, null, () => {}, () => {}) }
}

const scope = { base: 'origin/main', gate: 'make agent-gate', criteria: ['x works'], blocker: '' }
const fin = { branch: 'feat/x', commits: ['abc fix: Add x'], treeUnchanged: true, title: 'fix: Add x', bodyPath: '.git/drive-pr/PR_BODY.md' }
const noFindings = { findings: [] }

// 1. gate fails once, then passes: one fix round, ready-for-ack, no push step.
{
  let gates = 0
  const h = harness((label, prompt, opts) => {
    if (opts.schema && opts.schema.required.includes('blocker')) return scope
    if (label.startsWith('gate-')) return ++gates === 1
      ? { pass: false, command: 'make agent-gate', failures: [{ check: 'test', output: 'boom' }] }
      : { pass: true, command: 'make agent-gate', failures: [] }
    if (/^(correctness|claims|conventions)-/.test(label)) return noFindings
    if (opts.schema && opts.schema.required.includes('treeUnchanged')) return fin
    return 'ok'
  })
  const r = await h.run('add x')
  assert.equal(r.status, 'ready-for-ack')
  assert.equal(r.rounds, 2)
  assert.deepEqual(h.calls.filter(c => c.startsWith('fix-')), ['fix-1'])
  assert.match(r.next, /\+push/)
  console.log('ok   gate fail then pass -> one fix round, ready-for-ack')
}

// 2. a refuted finding does not block; a confirmed one forces a fix round.
{
  let reviewRound = 0
  const h = harness((label, prompt, opts) => {
    if (opts.schema && opts.schema.required.includes('blocker')) return scope
    if (label.startsWith('gate-')) return { pass: true, command: 'g', failures: [] }
    if (label.startsWith('correctness-')) {
      reviewRound++
      return reviewRound === 1
        ? { findings: [
          { file: 'a.go', line: 1, summary: 'real bug', scenario: 's', blocking: true, human: false },
          { file: 'b.go', line: 2, summary: 'false alarm', scenario: 's', blocking: true, human: false }] }
        : noFindings
    }
    if (/^(claims|conventions)-/.test(label)) return noFindings
    if (label.startsWith('verify-')) return { refuted: /false alarm/.test(prompt), reason: 'checked' }
    if (opts.schema && opts.schema.required.includes('treeUnchanged')) return fin
    return 'ok'
  })
  const r = await h.run({ task: 'add x' })
  assert.equal(r.status, 'ready-for-ack')
  assert.equal(r.rounds, 2)
  console.log('ok   refuted finding ignored, confirmed finding fixed')
}

// 3. never converges: stops at maxRounds with needs-human and the findings.
{
  const h = harness((label, prompt, opts) => {
    if (opts.schema && opts.schema.required.includes('blocker')) return scope
    if (label.startsWith('gate-')) return { pass: false, command: 'g', failures: [{ check: 't', output: 'x' }] }
    if (/^(correctness|claims|conventions)-/.test(label)) return noFindings
    if (opts.schema && opts.schema.required.includes('treeUnchanged')) return fin
    return 'ok'
  })
  const r = await h.run({ task: 'add x', maxRounds: 2 })
  assert.equal(r.status, 'needs-human')
  assert.equal(r.rounds, 2)
  assert.deepEqual(h.calls.filter(c => c.startsWith('fix-')), ['fix-1'])
  console.log('ok   non-converging run stops at maxRounds as needs-human')
}

// 4. scope blocker returns before any implementation.
{
  const h = harness((label, prompt, opts) =>
    opts.schema && opts.schema.required.includes('blocker') ? { ...scope, blocker: 'which API?' } : 'ok')
  const r = await h.run('add x')
  assert.equal(r.status, 'needs-human')
  assert.equal(h.calls.includes('implement'), false)
  console.log('ok   scope blocker stops before implement')
}

// 5. human-judgement findings are escalated, not fixed by agents.
{
  const h = harness((label, prompt, opts) => {
    if (opts.schema && opts.schema.required.includes('blocker')) return scope
    if (label.startsWith('gate-')) return { pass: true, command: 'g', failures: [] }
    if (label.startsWith('conventions-')) return { findings: [
      { file: '.github/workflows/release.yml', line: 9, summary: 'token scope widened', scenario: 's', blocking: true, human: true }] }
    if (/^(correctness|claims)-/.test(label)) return noFindings
    if (opts.schema && opts.schema.required.includes('treeUnchanged')) return fin
    return 'ok'
  })
  const r = await h.run('add x')
  assert.equal(r.forPerson.length, 1)
  assert.equal(h.calls.some(c => c.startsWith('fix-')), false)
  console.log('ok   human-judgement finding escalated, not auto-fixed')
}

// 6. every agent prompt that can touch the repo forbids outward actions.
{
  const prompts = []
  const h = harness((label, prompt, opts) => {
    prompts.push([label, prompt])
    if (opts.schema && opts.schema.required.includes('blocker')) return scope
    if (label.startsWith('gate-')) return { pass: false, command: 'g', failures: [{ check: 't', output: 'x' }] }
    if (/^(correctness|claims|conventions)-/.test(label)) return noFindings
    if (opts.schema && opts.schema.required.includes('treeUnchanged')) return fin
    return 'ok'
  })
  await h.run({ task: 'add x', maxRounds: 2 })
  for (const [label, p] of prompts.filter(([l]) => /^(implement|fix-|Finalize)/.test(l) || l === 'agent')) {
    if (label === 'agent' && !/Finalize the branch/.test(p)) continue
    assert.match(p, /Do not push/, label)
  }
  console.log('ok   writer prompts carry the stay-local rule')
}
