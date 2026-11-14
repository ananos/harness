import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const basePlan = (over = {}) => Object.assign({
  slug: 'add-x', summary: 's', approach: 'a', base: 'origin/main', gate: 'make test',
  interfaces: [],
  tasks: [
    { id: 'skel', title: 'skeleton', tier: 'skeleton', files: ['x.go'], dependsOn: [], acceptance: [], tests: [] },
    { id: 'a', title: 'a', tier: 'complex', files: ['a.go'], dependsOn: ['skel'], acceptance: ['a'], tests: ['TestA'] },
    { id: 'b', title: 'b', tier: 'menial', files: ['b.go'], dependsOn: [], acceptance: ['b'], tests: ['TestB'] },
    { id: 'c', title: 'c', tier: 'chore', files: ['README.md'], dependsOn: ['a'], acceptance: ['c'], tests: [] },
  ],
  testPlan: ['TestA', 'TestB'], criteria: ['x works'], risks: [], questions: [],
}, over)

function responder(opts = {}) {
  let integ = 0
  return ({ label, prompt }) => {
    if (label.startsWith('recon-')) return { findings: ['f'], files: ['x.go'] }
    if (label === 'plan') return opts.plan || basePlan()
    if (label === 'plan-revise') return basePlan({ slug: 'revised' })
    if (label === 'critique') return opts.critique || { verdict: 'ok', issues: [] }
    if (label === 'write-plan') return '/repo/.git/harness/add-x/plan.md'
    if (label === 'skeleton') return { branch: 'harness/add-x', tip: 'sha-skel', commits: ['c1'] }
    if (label.startsWith('task-')) {
      const id = label.slice(5)
      if (opts.fail && opts.fail.includes(id)) return { done: false, commits: [], notes: 'stuck' }
      return { done: true, branch: `harness/add-x/${id}`, commits: [`sha-${id}`] }
    }
    if (label.startsWith('integrate-')) {
      integ++
      const ids = JSON.parse(prompt.slice(prompt.indexOf('['), prompt.lastIndexOf(']') + 1)).map(r => r.id)
      return { tip: `sha-int-${integ}`, integrated: ids, failed: [], gatePass: true }
    }
    if (label === 'land') return { branch: 'harness/add-x', commits: ['abc feat: Add x'], treeUnchanged: true, title: 'feat: Add x', bodyPath: '/b' }
    throw new Error('unexpected agent ' + label)
  }
}
const verifyClean = () => ({ status: 'clean', rounds: 1, unresolved: [], forPerson: [] })

// 1. models are routed by stage and tier
{
  const { result, calls, workflows } = await run('build', 'add x', responder(), { verify: verifyClean })
  assert.equal(result.status, 'ready-to-ship')
  assert.deepEqual(byLabel(calls, /^recon-/).map(c => c.opts.model), ['sonnet', 'sonnet', 'sonnet'])
  assert.equal(modelOf(calls, 'plan'), 'claude-mythos-5-1')
  assert.equal(modelOf(calls, 'critique'), 'fable')
  assert.equal(modelOf(calls, 'write-plan'), 'haiku')
  assert.equal(modelOf(calls, 'skeleton'), 'opus')
  assert.equal(modelOf(calls, 'task-a'), 'opus')
  assert.equal(modelOf(calls, 'task-b'), 'sonnet')
  assert.equal(modelOf(calls, 'task-c'), 'haiku')
  assert.equal(modelOf(calls, 'integrate-1'), 'sonnet')
  assert.equal(modelOf(calls, 'land'), 'haiku')
  assert.equal(byLabel(calls, /^task-skel$/).length, 0)
  assert.ok(byLabel(calls, /^task-/).every(c => c.opts.isolation === 'worktree'))
  assert.equal(workflows.length, 1)
  assert.equal(workflows[0].name, 'verify')
  assert.equal(workflows[0].args.gate, 'make test')
  assert.deepEqual(workflows[0].args.criteria, ['x works'])
  console.log('ok   build: models routed by stage and tier; verify gets the plan gate')
}

// 2. waves follow dependencies and later waves start from the integrated tip
{
  const { calls } = await run('build', 'add x', responder(), { verify: verifyClean })
  const order = calls.map(c => c.label).filter(l => /^(task|integrate)-/.test(l))
  assert.deepEqual(order, ['task-a', 'task-b', 'integrate-1', 'task-c', 'integrate-2'])
  assert.match(calls.find(c => c.label === 'task-a').prompt, /checkout -B harness\/add-x\/a sha-skel/)
  assert.match(calls.find(c => c.label === 'task-c').prompt, /checkout -B harness\/add-x\/c sha-int-1/)
  console.log('ok   build: dependency waves, each from the integrated tip')
}

// 3. a critique with major issues triggers one revision, and the revision is used
{
  const critique = { verdict: 'revise', issues: [{ severity: 'major', issue: 'files overlap', fix: 'add dep' }] }
  const { calls } = await run('build', 'add x', responder({ critique }), { verify: verifyClean })
  assert.equal(byLabel(calls, /^plan-revise$/).length, 1)
  assert.match(calls.find(c => c.label === 'skeleton').prompt, /harness\/revised/)
  assert.equal(modelOf(calls, 'plan-revise'), 'claude-mythos-5-1')
  console.log('ok   build: major critique -> one revision, revised plan used')
}

// 4. minor-only critique does not revise
{
  const critique = { verdict: 'revise', issues: [{ severity: 'minor', issue: 'naming', fix: 'rename' }] }
  const { calls } = await run('build', 'add x', responder({ critique }), { verify: verifyClean })
  assert.equal(byLabel(calls, /^plan-revise$/).length, 0)
  console.log('ok   build: minor-only critique keeps the plan')
}

// 5. blocking questions stop before any code is written
{
  const { result, calls } = await run('build', 'add x', responder({ plan: basePlan({ questions: ['which API?'] }) }))
  assert.equal(result.status, 'needs-human')
  assert.deepEqual(result.questions, ['which API?'])
  assert.equal(byLabel(calls, /^(skeleton|task-)/).length, 0)
  console.log('ok   build: blocking questions stop before the skeleton')
}

// 6. stopAfterPlan returns the plan
{
  const { result, calls } = await run('build', { task: 'add x', stopAfterPlan: true }, responder())
  assert.equal(result.status, 'planned')
  assert.equal(result.plan, '/repo/.git/harness/add-x/plan.md')
  assert.equal(byLabel(calls, /^skeleton$/).length, 0)
  console.log('ok   build: stopAfterPlan returns after writing the plan')
}

// 7. a failed task is handed to verify instead of vanishing
{
  const { result, workflows } = await run('build', 'add x', responder({ fail: ['b'] }), { verify: verifyClean })
  assert.deepEqual(result.failedTasks.map(f => f.id), ['b'])
  assert.match(workflows[0].args.task, /did not land/)
  console.log('ok   build: failed tasks are passed on to verify')
}

// 8. model overrides apply
{
  const { calls, workflows } = await run('build', { task: 'add x', models: { plan: 'opus', menial: 'haiku' } },
    responder(), { verify: verifyClean })
  assert.equal(modelOf(calls, 'plan'), 'opus')
  assert.equal(modelOf(calls, 'task-b'), 'haiku')
  assert.deepEqual(workflows[0].args.models, { plan: 'opus', menial: 'haiku' })
  console.log('ok   build: args.models overrides the defaults')
}

// 9. a dependency cycle runs serially instead of hanging
{
  const plan = basePlan({ tasks: [
    { id: 'p', title: 'p', tier: 'menial', files: ['p'], dependsOn: ['q'], acceptance: [], tests: [] },
    { id: 'q', title: 'q', tier: 'menial', files: ['q'], dependsOn: ['p'], acceptance: [], tests: [] },
  ] })
  const { calls } = await run('build', 'add x', responder({ plan }), { verify: verifyClean })
  assert.deepEqual(byLabel(calls, /^task-/).map(c => c.label), ['task-p', 'task-q'])
  console.log('ok   build: dependency cycle runs as one serial wave')
}

// 10. writers are told to stay local
{
  const { calls } = await run('build', 'add x', responder(), { verify: verifyClean })
  for (const c of byLabel(calls, /^(skeleton|task-|integrate-|land)/)) assert.match(c.prompt, /Stay local/, c.label)
  console.log('ok   build: every writing agent carries the stay-local rule')
}

// remote tasks: with HARNESS_TASK_RUNNER set, a wave's tasks are driven by a small dispatch agent that runs the command; nothing else changes
{
  process.env.HARNESS_TASK_RUNNER = '/usr/local/bin/task-run'
  try {
    const { calls } = await run('build', { task: 'x' }, responder(), { verify: verifyClean })
    const a = calls.find(c => c.label === 'task-a')
    assert.equal(a.opts.model, 'haiku')
    assert.equal(a.opts.isolation, undefined)
    assert.match(a.prompt, /\/usr\/local\/bin\/task-run run --id a --tip \\S+ --model opus --prompt-file \/tmp\/task-a\.prompt --schema-file \/tmp\/task-a\.schema/)
    assert.match(a.prompt, /do not implement it yourself/)
    assert.match(a.prompt, /Prompt:\nYou are one of several agents implementing a plan in parallel/)
    assert.ok(byLabel(calls, /^integrate-/).length >= 1)
  } finally {
    delete process.env.HARNESS_TASK_RUNNER
  }
  console.log('ok   build: HARNESS_TASK_RUNNER sends a wave\'s tasks to a remote runner through a dispatch agent')
}
