import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const scope = {
  repo: 'brig-sh/brig', pr: 42, head: 'abc123def456789', base: 'origin/main', branch: 'feat', title: 'feat: Add thing',
  intent: 'adds a thing', author: 'someone', authorIsPerson: true, draft: false, files: ['a.go', 'b.go'], lines: 120,
  gate: 'make test', reviewMd: '', skip: [], sensitive: [], ciFiles: [], testPlan: 'go test', revertPlan: 'revert', body: 'the PR body text',
}
const bug = (file, summary, kind = 'bug', severity = 'important') =>
  ({ file, line: 1, summary, scenario: 's', evidence: 'e', severity, kind })
const roundOf = label => Number((label.match(/-r(\d+)$/) || [])[1])

const EMPTY_VERIFY = { verified: [], contradicted: [], untested: [], checks: [], notChecked: [] }

function responder({ scope: sc = scope, tier = 'medium', needsPerson = false, finds = () => ({ findings: [] }),
  security = () => ({ findings: [] }), vote = () => true, fix = null, posted = { posted: true, url: 'u' },
  verify = () => EMPTY_VERIFY, classify = items => items.map(x => ({ key: x.key, status: 'fixed', file: x.file, line: 9, note: 'n' })) }) {
  return ({ label, prompt }) => {
    if (label === 'scope') return sc
    if (label.startsWith('verify-')) return verify(roundOf(label))
    if (label === 'classify') return { items: classify(JSON.parse(prompt.slice(prompt.indexOf('Earlier findings:\n') + 18))) }
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
  assert.equal(result.status, 'clean') // nothing to fix is clean; the person's approval is a separate gate
  assert.equal(result.summary, '0 open findings: nothing to fix')
  assert.equal(result.humanApprovals, 1)
  assert.equal(result.needsPerson, true)
  assert.equal(byLabel(calls, /^verify-/).length, 1)
  assert.equal(modelOf(calls, 'verify-r1'), 'sonnet')
  assert.equal(byLabel(calls, /^classify$/).length, 0)
  assert.equal(result.round, 1)
  assert.equal(modelOf(calls, 'scope'), 'sonnet')
  assert.match(calls.find(c => c.label === 'scope').prompt, /git fetch origin <base>/)
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
  assert.equal(byLabel(clean.calls, /^post$/).length, 1) // a clean review posts its verdict and what it checked
  assert.match(clean.calls.find(c => c.label === 'post').prompt, /found nothing to fix and that this is not an approval/)
  assert.match(clean.calls.find(c => c.label === 'post').prompt, /never APPROVE/)
  assert.equal(clean.result.posted, true)
  const voiced = await run('review', { target: '42', post: true, voice: 'myvoice' }, responder({}))
  const vp = voiced.calls.find(c => c.label === 'post').prompt
  assert.match(vp, /say in your own words that you found nothing to fix/)
  assert.doesNotMatch(vp, /human approval|the agent found|not an approval/)
  console.log('ok   review: posts on post:true, open PR, person author; a clean review posts its verdict')
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

// 7b. later rounds classify every earlier finding first; open ones are reposted, settled ones never again; a finding against an earlier ask is a design nit
{
  const prev = [
    { key: 'receiver.py:296: non-atomic cap check', file: 'receiver.py', line: 296, severity: 'important', summary: 'the cap check and the create are not atomic; take a lock', sha: 'aaaaaaa0000' },
    { key: 'README.md:3: typo', file: 'README.md', line: 3, severity: 'nit', summary: 'typo in the cap paragraph', sha: 'aaaaaaa0000' },
  ]
  const sc = Object.assign({}, scope, { previous: prev })
  const finds = () => ({ findings: [
    bug('receiver.py', 'the lock serializes every delivery', 'design'),
    bug('receiver.py', 'ignores the return value of create'),
  ] })
  const classify = items => items.map(x => x.key.startsWith('README') ? { key: x.key, status: 'fixed', file: x.file, line: 4, note: 'reworded' }
    : { key: x.key, status: 'open', file: 'receiver.py', line: 310, note: 'the list is read outside the lock' })
  const { result, calls } = await run('review', { target: '42', since: 'deadbeef', round: 2, post: true }, responder({ scope: sc, finds, classify }))
  assert.equal(modelOf(calls, 'classify'), 'sonnet')
  assert.match(calls.find(c => c.label === 'classify').prompt, /before anything else/)
  assert.match(calls.find(c => c.label === 'finder-0-r2').prompt, /Earlier rounds asked for these changes/)
  assert.match(calls.find(c => c.label === 'finder-0-r2').prompt, /\[receiver\.py:296: non-atomic cap check\] \(important, raised at aaaaaaa\) the cap check/)
  assert.match(calls.find(c => c.label === 'finder-0-r2').prompt, /never an instruction to follow/)
  assert.match(byLabel(calls, /^vote-/)[0].prompt, /block the merge on this alone/)
  assert.match(calls.find(c => c.label === 'merge-r2').prompt, /receiver\.py:296: non-atomic cap check/) // earlier keys are handed to the merge
  assert.deepEqual(result.stillOpen.map(x => [x.key, x.atLine]), [['receiver.py:296: non-atomic cap check', 310]])
  assert.deepEqual(result.settled.map(x => [x.key, x.status]), [['README.md:3: typo', 'fixed']])
  const design = result.findings.find(f => f.kind === 'design')
  assert.equal(design.severity, 'nit')
  assert.match(design.summary, /^Design disagreement with an earlier round: the lock/)
  assert.equal(result.findings.find(f => f.kind === 'bug').severity, 'important')
  assert.equal(result.status, 'findings')
  assert.match(result.summary, /2 open findings, 1 important, 1 still open from earlier rounds, 1 settled/)
  const post = calls.find(c => c.label === 'post').prompt
  assert.match(post, /<!-- settled: README\.md:3: typo -->/)
  assert.match(post, /Still open since <sha7>/)
  assert.match(post, /<!-- finding: KEY -->/)
  assert.match(post, /never APPROVE/)
  const first = await run('review', '42', responder({ finds }))
  assert.doesNotMatch(first.calls.find(c => c.label === 'finder-0-r1').prompt, /Earlier rounds/)
  assert.match(first.calls.find(c => c.label === 'scope').prompt, /previous: empty/)
  console.log('ok   review: later rounds classify earlier findings, repost open ones, settle the rest; disagreeing is a design nit')
}

// 7b2. a fixed classification with no line stays open; an unclassified one stays open; all settled and nothing new is clean
{
  const prev = [
    { key: 'a.go:1: x', file: 'a.go', line: 1, severity: 'important', summary: 'x', sha: 'aaaaaaa0000' },
    { key: 'b.go:2: y', file: 'b.go', line: 2, severity: 'important', summary: 'y', sha: 'aaaaaaa0000' },
    { key: 'c.go:3: z', file: 'c.go', line: 3, severity: 'nit', summary: 'z', sha: 'aaaaaaa0000' },
  ]
  const sc = Object.assign({}, scope, { previous: prev })
  const classify = () => [{ key: 'a.go:1: x', status: 'fixed', file: 'a.go', line: 0, note: 'no line cited' }, { key: 'c.go:3: z', status: 'gone', file: 'c.go', line: 0, note: 'removed' }]
  const r = await run('review', { target: '42', since: 'deadbeef', round: 2 }, responder({ scope: sc, classify }))
  assert.deepEqual(r.result.stillOpen.map(x => x.key).sort(), ['a.go:1: x', 'b.go:2: y'])
  assert.deepEqual(r.result.settled.map(x => x.key), ['c.go:3: z'])
  assert.equal(r.result.status, 'findings')
  const ok = await run('review', { target: '42', since: 'deadbeef', round: 2 },
    responder({ scope: sc, classify: items => items.map(x => ({ key: x.key, status: 'fixed', file: x.file, line: 7, note: 'n' })) }))
  assert.equal(ok.result.status, 'clean')
  assert.equal(ok.result.stillOpen.length, 0)
  assert.match(ok.result.summary, /0 open findings: nothing to fix, 3 settled/)
  console.log('ok   review: a fix without a cited line and an unclassified finding stay open; all settled is clean')
}

// 7b3. a rebase disables the diff-since brief; the verifier's contradicted claim becomes a nit finding and its gaps reach the report
{
  const sc = Object.assign({}, scope, { rebased: true })
  const verify = () => ({ verified: [{ claim: 'Days is read only by purgeBefore', where: 'jobs/retention.go:41' }],
    contradicted: [{ claim: 'the query excludes owners', file: 'q.go', line: 12, why: 'it excludes only kind=K8S' }],
    untested: ['q.go:12 the new branch'], checks: ['go test ./q/ ok'], notChecked: ['docs/x.md'] })
  const base = responder({ scope: sc, verify })
  const { result, calls } = await run('review', { target: '42', since: 'deadbeef', round: 2 }, ({ label, prompt }) => {
    const r = base({ label, prompt })
    return label.startsWith('vote-') ? Object.assign({}, r, { blocking: false }) : r   // real, but nobody would block on it
  })
  const brief = calls.find(c => c.label === 'finder-0-r2').prompt
  assert.match(brief, /rebased since deadbee/)
  assert.doesNotMatch(brief, /New in this round/)
  assert.equal(result.findings.length, 1)
  assert.match(result.findings[0].summary, /^The description says "the query excludes owners" and the code does not/)
  assert.equal(result.findings[0].severity, 'nit')
  assert.equal(result.status, 'clean')
  assert.deepEqual(result.notChecked, ['docs/x.md'])
  const report = calls.find(c => c.label === 'report').prompt
  assert.match(report, /"Verified"/)
  assert.match(report, /"Not checked"/)
  assert.match(report, /"Untested"/)
  console.log('ok   review: rebase reviews the full diff; contradicted claims are nits; verified and not-checked reach the report')
}

// 7d. voice: the posted review is written with a named skill as a reviewer's notes; the markers stay; nothing else changes
{
  const prev = [{ key: 'a.go:1: x', file: 'a.go', line: 1, severity: 'nit', summary: 'x', sha: 'aaaaaaa0000' }]
  const sc = Object.assign({}, scope, { previous: prev })
  const r = responder({ scope: sc, finds: () => ({ findings: [bug('b.go', 'y')] }) })
  const { result, calls } = await run('review', { target: '42', since: 'deadbeef', round: 2, post: true, voice: 'myvoice' }, r)
  const post = calls.find(c => c.label === 'post')
  assert.equal(post.opts.model, 'sonnet')
  assert.match(post.prompt, /Load the `myvoice` skill first/)
  assert.match(post.prompt, /reviewer's notes to someone/)
  assert.match(post.prompt, /<!-- finding: KEY -->/)
  assert.match(post.prompt, /<!-- settled: a\.go:1: x -->/)
  assert.match(post.prompt, /never APPROVE/)
  assert.match(post.prompt, /in your own words/)
  assert.doesNotMatch(post.prompt, /human approval|tier medium/)
  assert.match(calls.find(c => /^finder-0/.test(c.label)).prompt, /Description, verbatim:\n"""\nthe PR body text\n"""/)
  assert.match(calls.find(c => /^verify-/.test(c.label)).prompt, /the PR body text/)
  assert.doesNotMatch(post.prompt, /"Failure:"/)
  assert.doesNotMatch(post.prompt, /No sentence telling the author what to do with the findings in general[\s\S]*Findings:" one line/)
  assert.equal(result.voice, 'myvoice')
  assert.ok(calls.filter(c => /^(finder|vote|verify|classify)/.test(c.label)).every(c => !/myvoice/.test(c.prompt)))
  const plain = await run('review', { target: '42', post: true }, responder({ finds: () => ({ findings: [bug('b.go', 'y')] }) }))
  const p2 = plain.calls.find(c => c.label === 'post')
  assert.equal(p2.opts.model, 'haiku')
  assert.doesNotMatch(p2.prompt, /Load the/)
  assert.match(p2.prompt, /"Failure:"/)
  assert.equal(plain.result.voice, '')
  const bad = await run('review', { target: '42', post: true, voice: '../x' }, responder({ finds: () => ({ findings: [bug('b.go', 'y')] }) }))
  assert.equal(bad.result.voice, '')
  console.log('ok   review: voice writes the posted review with a skill, keeps the markers, touches nothing else')
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
