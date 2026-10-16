export const meta = {
  name: 'build',
  description: 'Plan, skeleton, parallel implementation and verification of one change, on tiered models; ends with local commits',
  whenToUse: 'A feature or fix worth a plan. Args: string task, or {task, base, gate, maxRounds, stopAfterPlan, models}. Ends before push; run /ship after.',
  phases: [
    { title: 'Recon', detail: 'three sonnet readers map the repo for the task' },
    { title: 'Plan', detail: 'mythos plans, fable critiques, mythos revises once' },
    { title: 'Skeleton', detail: 'opus writes interfaces, stubs and the tests first' },
    { title: 'Build', detail: 'tasks in dependency waves, one worktree each, then integrate' },
    { title: 'Verify', detail: 'the /verify loop: gate, four review lenses, fixes' },
    { title: 'Land', detail: 'haiku autosquashes, cleans up and drafts the PR body' },
  ],
}

const A = typeof args === 'string' ? { task: args } : (args || {})
if (!A.task) throw new Error('build needs a task: pass args as a string or {task}')
const M = Object.assign({
  recon: 'sonnet', plan: 'claude-mythos-5-1', critic: 'fable', skeleton: 'opus',
  complex: 'opus', menial: 'sonnet', chore: 'haiku', integrate: 'sonnet', land: 'haiku',
}, A.models || {})

const HOLD = 'Stay local: do not push, open or edit PRs, post comments, or run gh write commands. ' +
  'Commit with the repo conventions and the commit rules you were given; never --no-verify.'

const RECON = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'string' }, description: 'facts with file paths' },
    files: { type: 'array', items: { type: 'string' } },
    commands: { type: 'array', items: { type: 'string' }, description: 'build/test/lint commands that work' },
    conventions: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'files'],
}
const TASK = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'short kebab id' },
    title: { type: 'string' },
    tier: { type: 'string', enum: ['skeleton', 'complex', 'menial', 'chore'] },
    files: { type: 'array', items: { type: 'string' }, description: 'files this task owns' },
    dependsOn: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    acceptance: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' }, description: 'tests this task adds or makes pass' },
  },
  required: ['id', 'title', 'tier', 'files', 'dependsOn', 'acceptance', 'tests'],
}
const PLAN = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: 'kebab-case, used in branch names' },
    summary: { type: 'string' },
    approach: { type: 'string' },
    base: { type: 'string' },
    gate: { type: 'string', description: 'one shell command that builds, lints and runs the tests' },
    interfaces: { type: 'array', items: { type: 'object', properties: {
      file: { type: 'string' }, name: { type: 'string' }, contract: { type: 'string' },
    }, required: ['file', 'name', 'contract'] } },
    tasks: { type: 'array', items: TASK },
    testPlan: { type: 'array', items: { type: 'string' } },
    criteria: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' }, description: 'only questions that block the work' },
  },
  required: ['slug', 'summary', 'base', 'gate', 'tasks', 'testPlan', 'criteria', 'questions'],
}
const CRITIQUE = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'revise'] },
    issues: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['major', 'minor'] }, issue: { type: 'string' }, fix: { type: 'string' },
    }, required: ['severity', 'issue', 'fix'] } },
  },
  required: ['verdict', 'issues'],
}
const SKELETON = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, tip: { type: 'string', description: 'full sha of HEAD' },
    commits: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['branch', 'tip', 'commits'],
}
const TASK_RESULT = {
  type: 'object',
  properties: {
    done: { type: 'boolean' }, branch: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' }, description: 'full shas, oldest first' },
    files: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['done', 'commits'],
}
const INTEGRATED = {
  type: 'object',
  properties: {
    tip: { type: 'string' },
    integrated: { type: 'array', items: { type: 'string' } },
    failed: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, reason: { type: 'string' },
    }, required: ['id', 'reason'] } },
    gatePass: { type: 'boolean' },
  },
  required: ['tip', 'integrated', 'failed', 'gatePass'],
}
const LANDED = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' }, description: 'git log --oneline base..HEAD' },
    treeUnchanged: { type: 'boolean' },
    title: { type: 'string' }, bodyPath: { type: 'string' },
  },
  required: ['branch', 'commits', 'treeUnchanged', 'title', 'bodyPath'],
}

// Returns task waves in dependency order; tasks in one wave are independent.
function waves(tasks) {
  const ids = new Set(tasks.map(t => t.id))
  const done = new Set()
  const out = []
  let left = tasks.slice()
  while (left.length) {
    const ready = left.filter(t => (t.dependsOn || []).every(d => done.has(d) || !ids.has(d)))
    if (!ready.length) {
      log(`dependency cycle among ${left.map(t => t.id).join(', ')}; running them as one serial wave`)
      out.push({ serial: true, tasks: left })
      break
    }
    out.push({ serial: false, tasks: ready })
    ready.forEach(t => done.add(t.id))
    left = left.filter(t => !done.has(t.id))
  }
  return out
}

phase('Recon')
const LOOKS = [
  { name: 'layout', prompt: 'repo layout, AGENTS.md/CLAUDE.md/CONTRIBUTING rules, commit style from `git log -20`, the PR template' },
  { name: 'code', prompt: 'the code the task touches: entry points, the closest existing feature to copy patterns from, callers that could break' },
  { name: 'tests', prompt: 'how to build, lint and test fast; the test layout and helpers; what CI runs (.github/workflows); a gate command that works now (run it)' },
]
const recon = (await parallel(LOOKS.map(l => () => agent(
  `Task: ${A.task}\n\nMap this for a planner: ${l.prompt}. Read, and run read-only commands. Do not change files. ` +
  'Report facts with file paths, not advice.',
  { label: `recon-${l.name}`, schema: RECON, model: M.recon })))).filter(Boolean)

phase('Plan')
const planPrompt =
  `Plan this change so other agents can implement it without asking questions.\n\nTask: ${A.task}\n\n` +
  'Repo map from three readers:\n' + JSON.stringify(recon, null, 1) + '\n\n' +
  'Rules for the plan:\n' +
  '- Interfaces, types and test scaffolding are one task with tier "skeleton". Every other task builds on it.\n' +
  '- Tasks that share a wave (no dependency between them) must own disjoint files. If two tasks need one file, add a dependency.\n' +
  '- Each task names its files, steps, acceptance criteria and the tests that prove it.\n' +
  '- tier "complex" for design-heavy work, "menial" for mechanical work against a fixed interface, "chore" for docs, config and renames.\n' +
  '- The gate is one command that exists in this repo today' + (A.gate ? ` (the caller set it to: ${A.gate})` : '') + '.\n' +
  '- Base is the upstream default branch' + (A.base ? ` (the caller set it to: ${A.base})` : ' (usually origin/main)') + '.\n' +
  '- questions holds only what blocks the work. Make a reasonable call on everything else and note it in risks.\n' +
  'Read the code to check your assumptions. Do not change files.'
let plan = await agent(planPrompt, { label: 'plan', schema: PLAN, model: M.plan, effort: 'high' })
if (!plan) throw new Error('planner returned nothing')

const critique = await agent(
  `Critique this plan against the actual repo. Check that the files exist, waves own disjoint files, every criterion has a test, ` +
  `the gate runs, and nothing depends on a wrong assumption about the code. Do not change files.\n\nTask: ${A.task}\n\nPlan:\n` +
  JSON.stringify(plan, null, 1),
  { label: 'critique', schema: CRITIQUE, model: M.critic, effort: 'high' })
const major = critique ? critique.issues.filter(i => i.severity === 'major') : []
if (critique && critique.verdict === 'revise' && major.length) {
  log(`critic raised ${major.length} major issues; revising once`)
  const revised = await agent(
    planPrompt + '\n\nYour previous plan:\n' + JSON.stringify(plan, null, 1) +
    '\n\nA reviewer raised these issues; address every major one:\n' + JSON.stringify(critique.issues, null, 1),
    { label: 'plan-revise', schema: PLAN, model: M.plan, effort: 'high' })
  if (revised) plan = revised
}

const planFile = await agent(
  'Write this plan as Markdown (summary, approach, interfaces, tasks with files/acceptance/tests, test plan, criteria, risks, questions) to ' +
  `\`$(git rev-parse --git-common-dir)/harness/${plan.slug}/plan.md\`, and the raw JSON next to it as plan.json. ` +
  'Create the directory. Change nothing else. Return the absolute path of plan.md only.\n\n' + JSON.stringify(plan, null, 1),
  { label: 'write-plan', model: M.chore, effort: 'low' })

if (plan.questions.length || A.stopAfterPlan) {
  return {
    status: plan.questions.length ? 'needs-human' : 'planned',
    questions: plan.questions, plan: planFile, critique,
    next: 'Answer the questions (or edit plan.json) and rerun /build with the answers in the task.',
  }
}

phase('Skeleton')
const skeletonTasks = plan.tasks.filter(t => t.tier === 'skeleton')
const skel = await agent(
  `Plan:\n${JSON.stringify(plan, null, 1)}\n\n` +
  `Create branch \`harness/${plan.slug}\` from \`${plan.base}\` (if you are already on a feature branch for this task, stay on it). ` +
  'Implement the skeleton: the interfaces, types, module wiring and stubs, plus the tests from the test plan. ' +
  'Tests for unimplemented behavior may fail; the project must still build. ' +
  (skeletonTasks.length ? 'Skeleton tasks:\n' + JSON.stringify(skeletonTasks, null, 1) + '\n' : '') +
  `Commit as one or two logical commits. ${HOLD} Return the branch, the full sha of HEAD and the commits.`,
  { label: 'skeleton', schema: SKELETON, model: M.skeleton, effort: 'high' })
if (!skel) throw new Error('skeleton agent returned nothing')
let tip = skel.tip

phase('Build')
const failedTasks = []
const plan_waves = waves(plan.tasks.filter(t => t.tier !== 'skeleton'))
for (let w = 0; w < plan_waves.length; w++) {
  const wave = plan_waves[w]
  const runTask = t => agent(
    `You are one of several agents implementing a plan in parallel. You work in your own git worktree.\n` +
    `First run \`git checkout -B harness/${plan.slug}/${t.id} ${tip}\` (that commit holds the skeleton and earlier waves).\n\n` +
    `Plan summary: ${plan.summary}\nInterfaces:\n${JSON.stringify(plan.interfaces || [], null, 1)}\n\n` +
    `Your task:\n${JSON.stringify(t, null, 1)}\n\n` +
    'Touch only the files your task owns unless the build forces otherwise, and report any extra file. ' +
    `Make your tests pass and keep the others building. Run \`${plan.gate}\` or its narrowest relevant part. ` +
    `Commit as one logical commit. ${HOLD} Return done, the branch, and the full commit shas.`,
    { phase: 'Build', label: `task-${t.id}`, schema: TASK_RESULT, model: M[t.tier] || M.menial, isolation: 'worktree' })

  let results = []
  if (wave.serial) {
    for (const t of wave.tasks) results.push(await runTask(t))
  } else {
    results = await parallel(wave.tasks.map(t => () => runTask(t)))
  }
  const ready = []
  wave.tasks.forEach((t, i) => {
    const r = results[i]
    if (r && r.done && r.commits.length) ready.push({ id: t.id, commits: r.commits })
    else failedTasks.push({ id: t.id, reason: (r && r.notes) || 'agent returned nothing' })
  })
  if (!ready.length) { log(`wave ${w + 1}: nothing to integrate`); continue }

  const integ = await agent(
    `On branch \`${skel.branch}\` in the main checkout (HEAD should be ${tip}), cherry-pick these task commits in order:\n` +
    JSON.stringify(ready, null, 1) + '\n' +
    'Resolve conflicts by keeping both tasks\' intent. Then run `' + plan.gate + '`. ' +
    'If integration broke something the tasks did not, fix it in a separate commit. ' +
    `${HOLD} Return the new HEAD sha, the integrated ids, the ids you could not integrate with the reason, and whether the gate passed.`,
    { phase: 'Build', label: `integrate-${w + 1}`, schema: INTEGRATED, model: M.integrate })
  if (!integ) throw new Error(`integration of wave ${w + 1} returned nothing`)
  tip = integ.tip
  integ.failed.forEach(f => failedTasks.push(f))
  log(`wave ${w + 1}/${plan_waves.length}: ${integ.integrated.length} integrated, gate ${integ.gatePass ? 'pass' : 'FAIL'}`)
}

phase('Verify')
const ver = await workflow('verify', {
  task: A.task + (failedTasks.length ? '\n\nThese plan tasks did not land and must be completed: ' + JSON.stringify(failedTasks) : ''),
  base: plan.base, gate: plan.gate, criteria: plan.criteria, testPlan: plan.testPlan,
  maxRounds: A.maxRounds || 3, models: A.models,
})

phase('Land')
const landed = await agent(
  `Finalize branch \`${skel.branch}\`. Base: ${plan.base}.\n` +
  '1. `pre=$(git rev-parse HEAD)`, then squash fixups non-interactively: ' +
  `\`GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash ${plan.base}\`, then confirm \`git diff --quiet "$pre" HEAD\`.\n` +
  '2. Check each commit message against the repo conventions and your commit rules. Reword with ' +
  '`git rebase -i --exec` or `git commit --amend` only where one breaks them, and confirm the tree is unchanged again.\n' +
  `3. Remove the task worktrees and branches: every \`git worktree list\` entry on a \`harness/${plan.slug}/*\` branch, then those branches.\n` +
  '4. Draft a PR title (the main commit subject) and a body that fills every section of the repo PR template, if there is one ' +
  '(strike through checklist items that do not apply). No assistant footer. Write it to ' +
  `\`$(git rev-parse --git-common-dir)/harness/${plan.slug}/PR_BODY.md\`.\n${HOLD}`,
  { label: 'land', schema: LANDED, model: M.land })

const clean = !!(ver && ver.status === 'clean')
return {
  status: clean ? 'ready-to-ship' : 'needs-human',
  branch: landed && landed.branch,
  commits: landed && landed.commits,
  treeUnchanged: landed && landed.treeUnchanged,
  title: landed && landed.title,
  body: landed && landed.bodyPath,
  plan: planFile,
  failedTasks,
  verify: ver,
  next: clean ? 'Run /ship to push, open the draft PR and watch CI.'
    : 'Read verify.unresolved and verify.forPerson, then rerun /verify or take over.',
}
