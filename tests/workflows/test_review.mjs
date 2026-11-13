import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const scope = {
  repo: 'brig-sh/brig', pr: 42, head: 'abc123def456789', base: 'origin/main', branch: 'feat', title: 'feat: Add thing',
  intent: 'adds a thing', author: 'someone', authorIsPerson: true, draft: false, files: ['a.go', 'b.go'], lines: 120,
  gate: 'make test', reviewMd: '', skip: [], sensitive: [], ciFiles: [], testPlan: 'go test', revertPlan: 'revert',
}
const bug = (file, summary, kind = 'bug', severity = 'important') =>
  ({ file, line: 1, summary, scenario: 's', evidence: 'e', severity, kind })
const roundOf = label => Number((label.match(/-r(\d+)$/) || [])[1])

function responder({ scope: sc = scope, tier = 'medium', needsPerson = false, finds = () => ({ findings: [] }),
  security = () => ({ findings: [] }), vote = () => true, fix = null, posted = { posted: true, url: 'u' } }) {
  return ({ label, prompt }) => {
    if (label === 'scope') return sc
    if (label === 'tier') return { tier, reason: 'r', blastRadius: 'b' }
    if (label === 'second-opinion') return { needsPerson, reason: 'r' }
    const f = label.match(/^finder-(\d+)-r(\d+)$/)
    if (f) return finds(Number(f[1]), Number(f[2]))
    if (label.startsWith('security-')) return security(roundOf(label))
    if (label.startsWith('merge-')) {
      const all = JSON.parse(prompt.slice(prompt.indexOf('Findings:\n') + 10))
      const seen = {}
      all.forEach(x => {
        const k = x.file + x.summary
        seen[k] = Object.assign({}, x, { reports: ((seen[k] || {}).reports || 0) + 1 })
      })
      return { findings: Object.values(seen), droppedAsRepeat: 0 }
    }
    const v = label.match(/^vote-(\d+)-(\w+)-r(\d+)$/)
    if (v) return { real: vote(prompt, v[2]), reason: 'r', severity: 'important' }
    if (label.startsWith('fix-')) return fix(roundOf(label), prompt)
    if (label === 'report') return { path: '/tmp/r.md', summary: 'x' }
    if (label === 'post') return posted
    throw new Error('unexpected ' + label)
  }
}

// 1. clean PR: models per stage, standard shape, nothing to vote on, no post, one round
{
  const { result, calls } = await run('review', '42', responder({}))
  assert.equal(result.status, 'needs-human') // medium tier: one person still reads it
  assert.equal(result.summary, '0 open findings: nothing to fix')
  assert.equal(result.humanApprovals, 1)
  assert.equal(result.round, 1)
  assert.equal(modelOf(calls, 'scope'), 'sonnet')
  assert.equal(modelOf(calls, 'tier'), 'sonnet')
  assert.equal(modelOf(calls, 'second-opinion'), 'opus')
  assert.equal(byLabel(calls, /^finder-/).length, 4)
  assert.equal(modelOf(calls, 'finder-0-r1'), 'opus')
  assert.equal(modelOf(calls, 'security-r1'), 'opus')
  assert.equal(byLabel(calls, /^merge-/).length, 0) // nothing to merge
  assert.equal(byLabel(calls, /^vote-/).length, 0)
  assert.equal(byLabel(calls, /^fix-/).length, 0)
  assert.equal(modelOf(calls, 'report'), 'haiku')
  assert.equal(byLabel(calls, /^post$/).length, 0)
  console.log('ok   review: clean PR, models per stage, nothing posted')
}

// 2. low tier with nothing to fix is mergeable without a person
{
  const { result } = await run('review', '42', responder({ tier: 'low' }))
  assert.equal(result.status, 'clean')
  assert.equal(result.humanApprovals, 0)
  console.log('ok   review: low-risk clean change needs no human approval')
}

// 3. a CI workflow file forces the high tier regardless of the classifier
{
  const sc = Object.assign({}, scope, { ciFiles: ['.github/workflows/release.yml'] })
  const { result } = await run('review', '42', responder({ scope: sc, tier: 'low' }))
  assert.equal(result.tier, 'high')
  assert.equal(result.humanApprovals, 2)
  assert.equal(result.needsPerson, true)
  console.log('ok   review: CI workflow files force two human approvals')
}

// 4. style dropped before voting; duplicates merged; majority vote decides; no fix without fix:true
{
  const finds = i => ({ findings: [
    bug('a.go', 'real bug'),
    bug('b.go', 'rename var', 'style'),
    i === 0 ? bug('c.go', 'false alarm') : bug('d.go', 'old bug', 'bug', 'pre-existing'),
  ] })
  const security = () => ({ findings: [bug('s.go', 'token in log', 'security')] })
  const { result, calls } = await run('review', { target: '42', depth: 'standard' },
    responder({ finds, security, vote: p => !/false alarm/.test(p) }))
  assert.equal(result.dropped.nonBug, 4)
  const votes = byLabel(calls, /^vote-/)
  assert.ok(votes.every(c => !/rename var/.test(c.prompt)))
  assert.equal(modelOf(calls, 'merge-r1'), 'haiku')
  assert.equal(modelOf(calls, votes[0].label), 'sonnet')
  assert.equal(votes.length, 12) // 4 distinct candidates x 3 voters
  assert.equal(result.rejected, 1)
  assert.equal(result.findings.length, 3)
  assert.ok(result.findings.every(f => f.summary !== 'false alarm'))
  assert.equal(result.status, 'findings')
  assert.equal(byLabel(calls, /^fix-/).length, 0)
  assert.equal(result.round, 1)
  assert.match(calls.find(c => c.label === 'report').prompt, /3 open findings, 3 important/)
  console.log('ok   review: drops non-bugs, merges duplicates, majority vote, no fix unless asked')
}

// 5. depth shapes the fleet; quick = 2 finders, 1 voter
{
  const { calls } = await run('review', { target: 'my-branch', depth: 'quick' },
    responder({ finds: () => ({ findings: [bug('a.go', 'x')] }) }))
  assert.equal(byLabel(calls, /^finder-/).length, 2)
  assert.equal(byLabel(calls, /^vote-/).length, 1)
  console.log('ok   review: quick depth runs two finders and one voter')
}

// 6. posting happens only with post:true, an open PR and a person as author; one COMMENT review
{
  const r = responder({ finds: () => ({ findings: [bug('a.go', 'x')] }) })
  const a = await run('review', { target: '42', post: true }, r)
  assert.equal(a.result.posted, true)
  const post = a.calls.find(c => c.label === 'post')
  assert.equal(post.opts.model, 'haiku')
  assert.match(post.prompt, /event COMMENT, never APPROVE/)
  const b = await run('review', { target: '42' }, r)
  assert.equal(b.result.posted, false)
  const noPr = await run('review', { target: 'br', post: true },
    responder({ scope: Object.assign({}, scope, { pr: 0 }), finds: () => ({ findings: [bug('a.go', 'x')] }) }))
  assert.equal(byLabel(noPr.calls, /^post$/).length, 0)
  const bot = await run('review', { target: '42', post: true },
    responder({ scope: Object.assign({}, scope, { author: 'app/renovate', authorIsPerson: false }), finds: () => ({ findings: [bug('a.go', 'x')] }) }))
  assert.equal(byLabel(bot.calls, /^post$/).length, 0)
  assert.match(bot.calls.find(c => c.label === 'report').prompt, /not a person/)
  const clean = await run('review', { target: '42', post: true }, responder({}))
  assert.equal(byLabel(clean.calls, /^post$/).length, 0)
  console.log('ok   review: posts only on post:true, open PR, person author, something to say')
}

// 7. later rounds: diff-only since a sha, earlier postings handed to merge, round cap
{
  const { result, calls } = await run('review',
    { target: '42', since: 'deadbeef', round: 3, posted: ['a.go:1: old'] },
    responder({ finds: () => ({ findings: [bug('a.go', 'x')] }) }))
  assert.match(calls.find(c => c.label === 'finder-0-r3').prompt, /git diff deadbeef\.\.\.abc123def456789/)
  assert.match(calls.find(c => c.label === 'merge-r3').prompt, /already posted/)
  assert.equal(result.reconsider, true) // third manual round with an important finding left: ask to reconsider
  assert.match(calls.find(c => c.label === 'report').prompt, /reconsider the approach/)
  assert.deepEqual(result.postedKeys, ['a.go:1: old', 'a.go:1: x'])
  const r2 = await run('review', { target: '42', since: 'deadbeef', round: 2 },
    responder({ finds: () => ({ findings: [bug('a.go', 'x')] }) }))
  assert.equal(r2.result.reconsider, false)
  console.log('ok   review: diff-only re-review, no repeats, round cap on manual rounds')
}

// 7b. later rounds see what earlier rounds asked for; a finding against that is a design disagreement, a nit for a person
{
  const sc = Object.assign({}, scope, { priorFindings: ['receiver.py:296: the cap check and the create are not atomic; take a lock'] })
  const finds = () => ({ findings: [
    bug('receiver.py', 'the lock serializes every delivery', 'design'),
    bug('receiver.py', 'ignores the return value of create'),
  ] })
  const { result, calls } = await run('review', { target: '42', since: 'deadbeef', round: 2 }, responder({ scope: sc, finds }))
  assert.match(calls.find(c => c.label === 'finder-0-r2').prompt, /Earlier rounds asked for these changes/)
  assert.match(calls.find(c => c.label === 'finder-0-r2').prompt, /take a lock/)
  assert.match(calls.find(c => c.label === 'tier').prompt, /kind=design/)
  assert.match(byLabel(calls, /^vote-/)[0].prompt, /block the merge on this alone/)
  const design = result.findings.find(f => f.kind === 'design')
  assert.equal(design.severity, 'nit')
  assert.match(design.summary, /^Design disagreement with an earlier round: the lock/)
  assert.equal(result.findings.find(f => f.kind === 'bug').severity, 'important')
  assert.match(calls.find(c => c.label === 'report').prompt, /2 open findings, 1 important/)
  const first = await run('review', '42', responder({ finds }))
  assert.doesNotMatch(first.calls.find(c => c.label === 'finder-0-r1').prompt, /Earlier rounds/)
  assert.match(first.calls.find(c => c.label === 'scope').prompt, /priorFindings: empty/)
  console.log('ok   review: later rounds carry the earlier findings; disagreeing with one is a design nit')
}

// 7c. important needs a majority of confirming voters who would block the merge on it alone
{
  const finds = () => ({ findings: [bug('a.go', 'theoretical race'), bug('b.go', 'drops every request')] })
  const respond = responder({ finds })
  const { result } = await run('review', '42', ({ label, prompt }) => {
    const v = label.match(/^vote-/)
    if (v) return { real: true, reason: 'r', severity: 'important', blocking: /drops every request/.test(prompt) }
    return respond({ label, prompt })
  })
  const by = Object.fromEntries(result.findings.map(f => [f.file, f.severity]))
  assert.deepEqual(by, { 'a.go': 'nit', 'b.go': 'important' })
  console.log('ok   review: important only when the voters would block on it')
}

// 8. fix loop: fixer runs on important findings, the new diff is re-reviewed, converges
{
  const finds = (i, r) => ({ findings: r === 1 ? [bug('a.go', 'bug one'), bug('b.go', 'bug two')] : [] })
  const fix = (r) => ({ head: 'fffff' + r, fixed: ['a.go:1: bug one', 'b.go:1: bug two'], skipped: [], gatePass: true })
  const { result, calls } = await run('review', { target: '42', fix: true, depth: 'quick' }, responder({ finds, fix, tier: 'low' }))
  assert.equal(result.status, 'clean')
  assert.equal(result.round, 2)
  assert.equal(result.head, 'fffff1')
  assert.deepEqual(result.fixed, ['a.go:1: bug one', 'b.go:1: bug two'])
  assert.equal(result.findings.length, 0)
  const fixes = byLabel(calls, /^fix-/)
  assert.equal(fixes.length, 1)
  assert.equal(fixes[0].opts.model, 'sonnet')
  assert.match(fixes[0].prompt, /make test/)
  assert.match(fixes[0].prompt, /do not push/)
  const r2 = calls.find(c => c.label === 'finder-0-r2')
  assert.match(r2.prompt, /git diff abc123def456789\.\.\.fffff1/)
  assert.equal(byLabel(calls, /^merge-r2$/).length, 0) // round 2 found nothing
  assert.match(result.summary, /0 open findings: nothing to fix, 2 fixed by the agent/)
  console.log('ok   review: fix loop fixes, re-reviews the new diff, converges')
}

// 9. fix loop: a finding that survives escalates the fixer; skipped findings go to a person; round cap asks to reconsider
{
  const finds = () => ({ findings: [bug('a.go', 'stubborn'), bug('z.go', 'design call')] })
  const fix = (r, prompt) => ({ head: 'eeee' + r, fixed: ['a.go:1: stubborn'],
    skipped: [{ key: 'z.go:1: design call', reason: 'needs a decision' }], gatePass: r !== 2 })
  const { result, calls } = await run('review', { target: '42', fix: true, depth: 'quick' }, responder({ finds, fix }))
  const fixes = byLabel(calls, /^fix-/)
  assert.deepEqual(fixes.map(c => c.label), ['fix-r1', 'fix-r2-escalated'])
  assert.deepEqual(fixes.map(c => c.opts.model), ['sonnet', 'opus'])
  assert.equal(result.round, 3)
  assert.equal(result.reconsider, true)
  assert.equal(result.status, 'findings')
  assert.ok(result.forPerson.length >= 1)
  assert.equal(result.forPerson[0].reason, 'needs a decision')
  assert.match(calls.find(c => c.label === 'report').prompt, /reconsider the approach/)
  assert.match(calls.find(c => c.label === 'report').prompt, /Left for a person/)
  console.log('ok   review: escalates a repeat, hands design calls to a person, stops at the round cap')
}

// 10. fix loop never posts on a bot PR and never pushes; a failed gate blocks clean
{
  const finds = (i, r) => ({ findings: r === 1 ? [bug('a.go', 'x')] : [] })
  const fix = (r) => ({ head: 'ddd' + r, fixed: ['a.go:1: x'], skipped: [], gatePass: false })
  const { result, calls } = await run('review', { target: '42', fix: true, depth: 'quick', post: true }, responder({ finds, fix, tier: 'low' }))
  assert.equal(result.gatePass, false)
  assert.notEqual(result.status, 'clean')
  assert.ok(calls.every(c => !/git push/.test(c.prompt)))
  assert.match(calls.find(c => c.label === 'report').prompt, /gate FAILED/)
  console.log('ok   review: a failing gate after fixes is never clean')
}

// 11. bad depth is an error
{
  await assert.rejects(run('review', { target: '42', depth: 'max' }, responder({})), /depth must be/)
  console.log('ok   review: rejects an unknown depth')
}
