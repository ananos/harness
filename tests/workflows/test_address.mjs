import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const thread = (id, over = {}) => Object.assign({ id, commentId: 100 + Number(id.slice(1)), path: 'a.go', line: 3, author: 'ananos', bot: true, key: `a.go:3: x${id}`, body: 'ananos: fix x' }, over)
const scope = {
  repo: 'brig-sh/hull', pr: 42, base: 'main', branch: 'feat/x', head: 'aaaaaaa111', author: 'someone', sameRepo: true,
  commits: [{ sha: 'c1c1c1c', subject: 'feat: one' }, { sha: 'c2c2c2c', subject: 'feat: two' }],
  threads: [thread('t1'), thread('t2', { path: 'b.go', line: 9, bot: false, author: 'pmoust', body: 'pmoust: rename this' }), thread('t3', { path: 'c.go', line: 1 })],
}
const plan = {
  changes: [
    { id: 'A', threads: ['t1'], summary: 'fix x', files: ['a.go'], commit: 'c1c1c1c', skip: false, reason: '' },
    { id: 'B', threads: ['t2'], summary: 'rename', files: ['b.go', 'b_test.go'], commit: '', skip: false, reason: '' },
    { id: 'C', threads: ['t3'], summary: 'design call', files: ['c.go'], commit: 'c2c2c2c', skip: true, reason: 'changes the public API; needs a decision' },
  ],
}
function responder(over = {}) {
  const o = Object.assign({ scope, plan, fold: { ok: true, head: 'bbbbbbb222', conflict: '', gatePass: true, gateTail: '' },
    push: { pushed: true, head: 'bbbbbbb222', replies: 3, summaryUrl: 'https://x/r/1', error: '' }, stack: { rebased: [{ pr: 43, head: 'ddddddd' }], failed: [] } }, over)
  return ({ label }) => {
    if (label === 'gather') return o.scope
    if (label === 'plan') return o.plan
    if (label.startsWith('work-')) return { id: label.slice(5), done: true, fixup: 'f' + label.slice(5), note: `did ${label.slice(5)}` }
    if (label === 'fold') return o.fold
    if (label === 'push') return o.push
    if (label === 'stack') return o.stack
    throw new Error('unexpected ' + label)
  }
}

// 1. the default is local: gather, plan, one work agent per change in order, fold; no push, no post
{
  const { result, calls } = await run('address', '42', responder())
  assert.deepEqual(calls.map(c => c.label), ['gather', 'plan', 'work-A', 'work-B', 'fold'])
  assert.equal(result.status, 'folded')
  assert.equal(result.pushed, false)
  assert.equal(modelOf(calls, 'gather'), 'sonnet')
  assert.equal(modelOf(calls, 'plan'), 'sonnet')
  assert.equal(modelOf(calls, 'work-A'), 'sonnet')
  assert.equal(modelOf(calls, 'work-B'), 'opus')    // two files: the wider model
  assert.equal(modelOf(calls, 'fold'), 'haiku')
  assert.match(calls.find(c => c.label === 'work-A').prompt, /the plan expected c1c1c1c/)
  assert.match(calls.find(c => c.label === 'work-A').prompt, /newest PR commit among them/)
  assert.match(calls.find(c => c.label === 'work-B').prompt, /plain fix commit/)
  assert.match(calls.find(c => c.label === 'fold').prompt, /run the autosquash once more/)
  assert.match(calls.find(c => c.label === 'fold').prompt, /GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin\/main/)
  assert.match(calls.find(c => c.label === 'fold').prompt, /git diff --quiet "\$pre" HEAD/)
  for (const c of calls) assert.doesNotMatch(c.prompt, /git push/)
  assert.deepEqual(result.replies.map(r => r.body), ['Done in bbbbbbb: did A', 'Done in bbbbbbb: did B', 'Not changed: changes the public API; needs a decision'])
  assert.equal(result.skipped.length, 1)
  console.log('ok   address: local by default; one work agent per change, fixup into the blamed commit, autosquash, no push')
}

// 2. push:true pushes with a lease on the starting head, replies with the exact bodies, posts one summary, then rebases the stack
{
  const { result, calls } = await run('address', { target: 42, push: true, gate: 'make test', voice: 'ananos' }, responder())
  assert.deepEqual(calls.map(c => c.label), ['gather', 'plan', 'work-A', 'work-B', 'fold', 'push', 'stack'])
  assert.equal(result.status, 'pushed')
  const push = calls.find(c => c.label === 'push').prompt
  assert.match(push, /git push --force-with-lease=feat\/x:aaaaaaa111 origin HEAD:feat\/x/)
  assert.match(push, /comments\/<commentId>\/replies/)
  assert.match(push, /"body": "Done in bbbbbbb: did A"/)
  assert.match(push, /"body": "Not changed: changes the public API; needs a decision"/)
  assert.match(push, /event COMMENT/)
  assert.match(push, /load the `ananos` skill/)
  assert.doesNotMatch(push, /resolveReviewThread/)
  assert.match(calls.find(c => c.label === 'fold').prompt, /Run `make test`/)
  const stack = calls.find(c => c.label === 'stack').prompt
  assert.match(stack, /git rebase --onto bbbbbbb222 aaaaaaa111 origin\/<headRefName>/)
  assert.match(stack, /--force-with-lease=<headRefName>:<headRefOid>/)
  assert.equal(modelOf(calls, 'push'), 'haiku')
  assert.equal(modelOf(calls, 'stack'), 'haiku')
  assert.deepEqual(result.stack.rebased, [{ pr: 43, head: 'ddddddd' }])
  console.log('ok   address: push:true pushes with a lease, replies verbatim, one summary in the voice, rebases the stack')
}

// 3. resolve:true resolves the threads; reply:false posts nothing; stack:false skips the rebase
{
  const a = await run('address', { target: 42, push: true, resolve: true }, responder())
  assert.match(a.calls.find(c => c.label === 'push').prompt, /resolveReviewThread/)
  const b = await run('address', { target: 42, push: true, reply: false, stack: false }, responder())
  assert.match(b.calls.find(c => c.label === 'push').prompt, /Post nothing/)
  assert.equal(byLabel(b.calls, /^stack$/).length, 0)
  console.log('ok   address: resolve, reply and stack switches')
}

// 4. a conflict or a failing gate stops before any push; a fork is never pushed; a rejected push reports
{
  const conflict = await run('address', { target: 42, push: true }, responder({ fold: { ok: false, head: 'aaaaaaa111', conflict: 'a.go hunk @@ -1', gatePass: true, gateTail: '' } }))
  assert.equal(conflict.result.status, 'needs-human')
  assert.equal(byLabel(conflict.calls, /^push$/).length, 0)
  assert.match(conflict.result.problems[0], /rebase conflict: a\.go/)
  const gate = await run('address', { target: 42, push: true }, responder({ fold: { ok: true, head: 'bbbbbbb222', conflict: '', gatePass: false, gateTail: 'FAIL x' } }))
  assert.equal(gate.result.status, 'needs-human')
  assert.equal(byLabel(gate.calls, /^push$/).length, 0)
  const fork = await run('address', { target: 42, push: true }, responder({ scope: Object.assign({}, scope, { sameRepo: false }) }))
  assert.equal(fork.result.status, 'needs-human')
  assert.equal(byLabel(fork.calls, /^push$/).length, 0)
  const rejected = await run('address', { target: 42, push: true }, responder({ push: { pushed: false, head: '', replies: 0, summaryUrl: '', error: 'stale info' } }))
  assert.equal(rejected.result.status, 'needs-human')
  assert.equal(byLabel(rejected.calls, /^stack$/).length, 0)
  console.log('ok   address: conflict, failing gate, fork and a rejected push all stop short')
}

// 5. threads filter reaches the gather; no threads or nothing changed end early; a work agent that changes nothing answers the thread with its note
{
  const bot = await run('address', { target: 42, threads: 'bot' }, responder({ scope: Object.assign({}, scope, { threads: [] }) }))
  assert.match(bot.calls.find(c => c.label === 'gather').prompt, /whose first comment starts with `<!-- finding:`/)
  assert.equal(bot.result.status, 'nothing-to-address')
  assert.equal(bot.calls.length, 1)
  const none = await run('address', '42', ({ label }) => label === 'gather' ? scope : label === 'plan' ? plan : label.startsWith('work-') ? { id: label.slice(5), done: false, fixup: '', note: 'already handled at line 7' } : null)
  assert.equal(none.result.status, 'nothing-changed')
  assert.equal(byLabel(none.calls, /^fold$/).length, 0)
  console.log('ok   address: thread filter, empty and no-change endings')
}
