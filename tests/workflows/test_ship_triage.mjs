import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const preOk = { ok: true, branch: 'feat/x', base: 'main', title: 'feat: Add x', bodyPath: '/b.md', existingPr: 0, problems: [] }

function shipResponder({ pre = preOk, checks = { state: 'pass', failed: [] }, kind = 'real' } = {}) {
  return ({ label }) => {
    if (label === 'preflight') return pre
    if (label === 'push') return { pushed: true, pr: 7, url: 'https://x/7' }
    if (label === 'ci-watch') return checks
    if (label.startsWith('triage-')) return { kind, evidence: 'log', rerun: kind !== 'real' }
    throw new Error('unexpected ' + label)
  }
}

// ship 1: haiku everywhere; draft PR, no reviewers, never merge or ready
{
  const { result, calls } = await run('ship', 'feat/x', shipResponder())
  assert.equal(result.status, 'green')
  for (const c of calls) assert.equal(c.opts.model, 'haiku', c.label)
  const push = calls.find(c => c.label === 'push').prompt
  assert.match(push, /gh pr create --draft/)
  assert.match(push, /Never force/)
  assert.doesNotMatch(push, /--reviewer|gh pr merge|gh pr ready/)
  console.log('ok   ship: haiku, draft PR without reviewers, no force/merge')
}

// ship 2: failed preflight never pushes
{
  const { result, calls } = await run('ship', 'feat/x', shipResponder({ pre: Object.assign({}, preOk, { ok: false, problems: ['behind and already pushed'] }) }))
  assert.equal(result.status, 'needs-human')
  assert.equal(byLabel(calls, /^push$/).length, 0)
  console.log('ok   ship: failed preflight stops before push')
}

// ship 3: an existing PR is reused
{
  const { calls } = await run('ship', 'feat/x', shipResponder({ pre: Object.assign({}, preOk, { existingPr: 7 }) }))
  assert.doesNotMatch(calls.find(c => c.label === 'push').prompt, /gh pr create/)
  console.log('ok   ship: existing PR reused, not duplicated')
}

// ship 4: watch=false stops after the push
{
  const { result, calls } = await run('ship', { branch: 'feat/x', watch: false }, shipResponder())
  assert.equal(result.status, 'pushed')
  assert.equal(byLabel(calls, /^ci-watch$/).length, 0)
  console.log('ok   ship: watch=false skips CI')
}

// ship 5: failures are triaged; reruns only when asked
{
  const checks = { state: 'fail', failed: [{ name: 'test', runId: '11' }, { name: 'lint', runId: '12' }] }
  const r1 = await run('ship', 'feat/x', shipResponder({ checks, kind: 'flake' }))
  assert.equal(r1.result.status, 'ci-flaky')
  assert.ok(byLabel(r1.calls, /^triage-/).every(c => /Do not rerun/.test(c.prompt)))
  const r2 = await run('ship', { branch: 'feat/x', rerunFlakes: true }, shipResponder({ checks, kind: 'real' }))
  assert.equal(r2.result.status, 'ci-failed')
  assert.ok(byLabel(r2.calls, /^triage-/).every(c => /gh run rerun 1[12] --failed/.test(c.prompt)))
  console.log('ok   ship: CI failures triaged; reruns only with rerunFlakes')
}

function triageResponder({ issues = [{ number: 1, title: 'crash', author: 'papazof' }, { number: 2, title: 'q', author: 'cmainas' }] } = {}) {
  return ({ label, prompt }) => {
    if (label === 'collect') return { labels: ['bug', 'question'], issues, skippedBots: ['dependabot[bot]'] }
    if (label.startsWith('issue-')) {
      const n = Number(label.slice(6))
      return { number: n, type: n === 1 ? 'bug' : 'question', impact: 'P2', labels: n === 1 ? ['bug'] : [], duplicateOf: 0, missing: [], summary: 's' }
    }
    if (label === 'report') return '/r.md'
    if (label === 'apply-labels') return 'added'
    throw new Error('unexpected ' + label)
  }
}

// triage 1: report only by default; classification on haiku; people only
{
  const { result, calls } = await run('triage', 'brig-sh/brig', triageResponder())
  assert.equal(result.issues, 2)
  assert.equal(byLabel(calls, /^apply-labels$/).length, 0)
  assert.ok(byLabel(calls, /^issue-/).every(c => c.opts.model === 'haiku'))
  assert.equal(modelOf(calls, 'report'), 'sonnet')
  assert.match(calls[0].prompt, /--jq .type` must print User/)
  console.log('ok   triage: report only by default, haiku per issue, people only')
}

// triage 2: apply adds labels only, for issues that have some
{
  const { calls } = await run('triage', { repo: 'brig-sh/brig', apply: true }, triageResponder())
  const p = calls.find(c => c.label === 'apply-labels').prompt
  assert.match(p, /Add labels only/)
  assert.match(p, /"number": 1/)
  assert.doesNotMatch(p, /"number": 2/)
  console.log('ok   triage: apply adds existing labels only')
}

// triage 3: no issues -> no classification
{
  const { result, calls } = await run('triage', 'brig-sh/brig', triageResponder({ issues: [] }))
  assert.equal(result.status, 'empty')
  assert.equal(byLabel(calls, /^issue-/).length, 0)
  console.log('ok   triage: empty repo stops after collect')
}
