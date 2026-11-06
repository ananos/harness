import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const pr = (number, head, extra = {}) => Object.assign(
  { number, head, author: 'someone', draft: false, title: 't', lastHead: '', lastRound: 0, posted: [] }, extra)

function responder(collected) {
  return ({ label }) => {
    if (label === 'collect') return Object.assign({ today: '2026-11-06', skippedBots: [], skippedMerged: [] }, collected)
    if (label === 'record') return { statePath: 's.json', digestPath: 'd.md', firstLine: 'x' }
    throw new Error('unexpected ' + label)
  }
}
const child = calls => ({ review: async a => { calls.push(a); return {
  status: 'findings', summary: '1 open finding, 1 important', tier: 'medium', humanApprovals: 1, needsPerson: true,
  head: a.target === 7 ? 'h7' : 'hx', round: a.round, findings: [], fixed: [], forPerson: [], posted: !!a.post,
  postedKeys: (a.posted || []).concat(['k']), report: 'r.md',
} } })

// 1. only PRs with a new head are reviewed; state feeds since, round and posted; models
{
  const kids = []
  const { result, calls, workflows } = await run('review-sweep', 'brig-sh/brig', responder({
    prs: [pr(7, 'h7new', { lastHead: 'h7old', lastRound: 2, posted: ['a:1: x'] }), pr(8, 'same', { lastHead: 'same', lastRound: 1 }), pr(9, 'h9')],
    skippedBots: ['app/renovate#10'],
  }), child(kids))
  assert.equal(modelOf(calls, 'collect'), 'haiku')
  assert.equal(modelOf(calls, 'record'), 'haiku')
  assert.equal(workflows.length, 2)
  assert.deepEqual(kids.map(k => k.target).sort(), [7, 9])
  const seven = kids.find(k => k.target === 7)
  assert.equal(seven.since, 'h7old')
  assert.equal(seven.round, 3)
  assert.deepEqual(seven.posted, ['a:1: x'])
  assert.equal(seven.post, false)
  assert.equal(seven.fix, false)
  const nine = kids.find(k => k.target === 9)
  assert.equal(nine.since, undefined)
  assert.equal(nine.round, 1)
  assert.deepEqual(result.unchanged, [8])
  assert.deepEqual(result.skippedBots, ['app/renovate#10'])
  assert.deepEqual(result.needsPerson.sort(), [7, 9])
  assert.match(calls.find(c => c.label === 'record').prompt, /2 PRs reviewed, 1 unchanged, 1 by bots skipped/)
  assert.match(calls.find(c => c.label === 'collect').prompt, /gh api users\/<login>/)
  console.log('ok   review-sweep: reviews new heads only, threads state into each review')
}

// 2. post and fix pass through, but never for a draft
{
  const kids = []
  await run('review-sweep', { repo: 'brig-sh/brig', post: true, fix: true, depth: 'deep' }, responder({
    prs: [pr(1, 'a'), pr(2, 'b', { draft: true })],
  }), child(kids))
  const one = kids.find(k => k.target === 1), two = kids.find(k => k.target === 2)
  assert.equal(one.post, true); assert.equal(one.fix, true); assert.equal(one.depth, 'deep')
  assert.equal(two.post, false); assert.equal(two.fix, false)
  console.log('ok   review-sweep: post and fix pass through, drafts are read-only')
}

// 3. drafts:false skips drafts entirely; a child failure does not sink the sweep
{
  const kids = []
  const { result } = await run('review-sweep', { repo: 'x/y', drafts: false }, responder({
    prs: [pr(1, 'a'), pr(2, 'b', { draft: true })],
  }), { review: async a => { kids.push(a); throw new Error('boom') } })
  assert.deepEqual(kids.map(k => k.target), [1])
  assert.deepEqual(result.reviewed, [])
  console.log('ok   review-sweep: drafts:false skips drafts; a failing review is dropped, not fatal')
}

// 4. needs a repo
{
  await assert.rejects(run('review-sweep', {}, responder({ prs: [] })), /needs a repo/)
  console.log('ok   review-sweep: rejects a missing repo')
}
