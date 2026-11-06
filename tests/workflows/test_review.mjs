import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const scope = {
  repo: 'brig-sh/brig', pr: 42, head: 'abc123def456789', base: 'origin/main', title: 'feat: Add thing',
  intent: 'adds a thing', author: 'someone', files: ['a.go', 'b.go'], lines: 120,
  reviewMd: '', skip: [], sensitive: [], ciFiles: [], testPlan: 'go test', revertPlan: 'revert',
}
const bug = (file, summary, kind = 'bug', severity = 'important') =>
  ({ file, line: 1, summary, scenario: 's', evidence: 'e', severity, kind })

function responder({ scope: sc = scope, tier = 'medium', needsPerson = false, finds = () => ({ findings: [] }),
  security = { findings: [] }, merge = null, vote = () => true, posted = { posted: true, url: 'u' } }) {
  return ({ label, prompt }) => {
    if (label === 'scope') return sc
    if (label === 'tier') return { tier, reason: 'r', blastRadius: 'b' }
    if (label === 'second-opinion') return { needsPerson, reason: 'r' }
    const f = label.match(/^finder-(\d+)$/)
    if (f) return finds(Number(f[1]))
    if (label === 'security') return security
    if (label === 'merge') {
      if (merge) return merge
      const all = JSON.parse(prompt.slice(prompt.indexOf('Findings:\n') + 10))
      const seen = {}
      all.forEach(x => {
        const k = x.file + x.summary
        seen[k] = Object.assign({}, x, { reports: ((seen[k] || {}).reports || 0) + 1 })
      })
      return { findings: Object.values(seen), droppedAsRepeat: 0 }
    }
    const v = label.match(/^vote-(\d+)-(\w+)$/)
    if (v) return { real: vote(prompt, v[2]), reason: 'r', severity: 'important' }
    if (label === 'report') return { path: '/tmp/r.md', summary: 'x' }
    if (label === 'post') return posted
    throw new Error('unexpected ' + label)
  }
}

// 1. clean PR: models per stage, standard shape, nothing to vote on, no post
{
  const { result, calls } = await run('review', '42', responder({}))
  assert.equal(result.status, 'needs-human') // medium tier: one person still reads it
  assert.equal(result.summary, '0 findings: nothing to fix')
  assert.equal(result.humanApprovals, 1)
  assert.equal(modelOf(calls, 'scope'), 'sonnet')
  assert.equal(modelOf(calls, 'tier'), 'sonnet')
  assert.equal(modelOf(calls, 'second-opinion'), 'opus')
  assert.equal(byLabel(calls, /^finder-/).length, 4)
  assert.equal(modelOf(calls, 'finder-0'), 'opus')
  assert.equal(modelOf(calls, 'security'), 'opus')
  assert.equal(byLabel(calls, /^merge$/).length, 0) // nothing to merge
  assert.equal(byLabel(calls, /^vote-/).length, 0)
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

// 4. style dropped before voting; duplicates merged; majority vote decides
{
  const finds = i => ({ findings: [
    bug('a.go', 'real bug'),
    bug('b.go', 'rename var', 'style'),
    i === 0 ? bug('c.go', 'false alarm') : bug('d.go', 'old bug', 'bug', 'pre-existing'),
  ] })
  const security = { findings: [bug('s.go', 'token in log', 'security')] }
  const { result, calls } = await run('review', { target: '42', depth: 'standard' },
    responder({ finds, security, vote: p => !/false alarm/.test(p) }))
  assert.equal(result.dropped.nonBug, 4)
  const votes = byLabel(calls, /^vote-/)
  assert.ok(votes.every(c => !/rename var/.test(c.prompt)))
  assert.equal(modelOf(calls, 'merge'), 'haiku')
  assert.equal(modelOf(calls, votes[0].label), 'sonnet')
  assert.equal(votes.length, 12) // 4 distinct candidates x 3 voters
  assert.equal(result.rejected, 1)
  assert.equal(result.findings.length, 3)
  assert.ok(result.findings.every(f => f.summary !== 'false alarm'))
  assert.equal(result.status, 'findings')
  assert.match(calls.find(c => c.label === 'report').prompt, /3 findings, 3 important/)
  console.log('ok   review: drops non-bugs, merges duplicates, majority vote, rejected listed')
}

// 5. depth shapes the fleet; quick = 2 finders, 1 voter
{
  const { calls } = await run('review', { target: 'my-branch', depth: 'quick' },
    responder({ finds: () => ({ findings: [bug('a.go', 'x')] }) }))
  assert.equal(byLabel(calls, /^finder-/).length, 2)
  assert.equal(byLabel(calls, /^vote-/).length, 1)
  console.log('ok   review: quick depth runs two finders and one voter')
}

// 6. posting happens only with post:true and an open PR, as one COMMENT review
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
    responder({ scope: Object.assign({}, scope, { pr: 0 }) }))
  assert.equal(byLabel(noPr.calls, /^post$/).length, 0)
  console.log('ok   review: posts only on post:true with an open PR, never approves')
}

// 7. later rounds: diff-only since a sha, earlier postings handed to merge, round cap
{
  const { result, calls } = await run('review',
    { target: '42', since: 'deadbeef', round: 3, posted: ['a.go:1: old'] },
    responder({ finds: () => ({ findings: [bug('a.go', 'x')] }) }))
  assert.match(calls.find(c => c.label === 'finder-0').prompt, /git diff deadbeef\.\.\.abc123def456789/)
  assert.match(calls.find(c => c.label === 'merge').prompt, /already posted/)
  assert.equal(result.reconsider, true)
  assert.match(calls.find(c => c.label === 'report').prompt, /reconsider the approach/)
  console.log('ok   review: diff-only re-review, no repeats, round cap')
}

// 8. bad depth is an error
{
  await assert.rejects(run('review', { target: '42', depth: 'max' }, responder({})), /depth must be/)
  console.log('ok   review: rejects an unknown depth')
}
