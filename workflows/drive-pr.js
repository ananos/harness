export const meta = {
  name: 'drive-pr',
  description: 'Drive one change to ready-for-ack: scope, implement, gate, review, fix in a loop; stops before any push',
  whenToUse: 'A scoped change in the current repo or worktree that should end as clean local commits plus a drafted PR body. Pass the task as args (string, or {task, maxRounds, gate}).',
  phases: [
    { title: 'Scope', detail: 'read the repo map, fix acceptance criteria and the gate command' },
    { title: 'Implement', detail: 'one agent writes the change as local commits' },
    { title: 'Gate', detail: 'run the repo gate, collect failures with remediation' },
    { title: 'Review', detail: 'three lenses, each blocking finding checked by a skeptic' },
    { title: 'Fix', detail: 'address gate failures and confirmed findings as fixup! commits' },
    { title: 'Finalize', detail: 'autosquash, verify the tree, draft the PR body; no push' },
  ],
}

const A = typeof args === 'string' ? { task: args } : (args || {})
if (!A.task) throw new Error('drive-pr needs a task: pass args as a string or {task}')
const MAX = A.maxRounds || 3

const HOLD = [
  'Stay local. Do not push, open or edit PRs, post comments or reviews, or run gh write commands;',
  'the outward-action guard refuses them and you must not work around it.',
  'Commit with the repo conventions (the commit-msg hook enforces them; never --no-verify).',
].join(' ')

const SCOPE = {
  type: 'object',
  properties: {
    base: { type: 'string', description: 'base ref to diff against, e.g. origin/main' },
    gate: { type: 'string', description: 'single shell command that is the repo gate' },
    criteria: { type: 'array', items: { type: 'string' }, description: 'testable acceptance criteria' },
    files: { type: 'array', items: { type: 'string' } },
    conventions: { type: 'array', items: { type: 'string' }, description: 'repo rules that apply to this change, with their source file' },
    blocker: { type: 'string', description: 'empty unless a person must decide something before work starts' },
  },
  required: ['base', 'gate', 'criteria', 'blocker'],
}
const GATE = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    command: { type: 'string' },
    failures: { type: 'array', items: { type: 'object', properties: {
      check: { type: 'string' }, output: { type: 'string' }, remediation: { type: 'string' },
    }, required: ['check', 'output'] } },
  },
  required: ['pass', 'command', 'failures'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      file: { type: 'string' }, line: { type: 'integer' },
      summary: { type: 'string' },
      scenario: { type: 'string', description: 'concrete input or state that produces the wrong result' },
      blocking: { type: 'boolean' },
      human: { type: 'boolean', description: 'true when this is a judgement call (provenance, token or permission policy, public API) a person must make' },
    }, required: ['file', 'summary', 'scenario', 'blocking', 'human'] } },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}
const FINAL = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' }, description: 'git log --oneline base..HEAD' },
    treeUnchanged: { type: 'boolean', description: 'git diff --quiet <pre-squash tip> HEAD succeeded' },
    title: { type: 'string' },
    bodyPath: { type: 'string' },
    template: { type: 'string', description: 'PR template used, or none' },
  },
  required: ['branch', 'commits', 'treeUnchanged', 'title', 'bodyPath'],
}

const LENSES = [
  { name: 'correctness', prompt: 'bugs a test or user would hit: wrong logic, unhandled errors, races, resource leaks, regressions in callers. Each finding needs a concrete failing scenario.' },
  { name: 'claims', prompt: 'statements that do not match the code: commit messages, code comments, docs, README, CLI help, test names. A correct change with a false claim attached is a blocking finding.' },
  { name: 'conventions', prompt: 'the repo rules from AGENTS.md, CONTRIBUTING and the PR template, plus tests for new behaviour. Mark provenance, token-scope, permission and public-API decisions as human=true.' },
]

phase('Scope')
const scope = await agent(
  `You are scoping one change before implementation.\n\nTask: ${A.task}\n\n` +
  'Read AGENTS.md (or CLAUDE.md), CONTRIBUTING and any docs it points to that bear on the task. ' +
  'Pick the gate: prefer `make agent-gate`; otherwise the narrowest command set that builds, lints and tests what this task touches, joined with &&. ' +
  (A.gate ? `The caller set the gate to: ${A.gate}. ` : '') +
  'Base is the upstream default branch merge-base (usually origin/main). ' +
  'Write acceptance criteria a reviewer can check. Set blocker only when the task cannot start without a decision from a person.',
  { schema: SCOPE })
if (!scope) throw new Error('scope agent returned nothing')
if (scope.blocker) return { status: 'needs-human', question: scope.blocker, scope }
const gateCmd = A.gate || scope.gate
log(`gate: ${gateCmd}; base: ${scope.base}; ${scope.criteria.length} criteria`)

const brief = [
  `Task: ${A.task}`,
  'Acceptance criteria:', ...scope.criteria.map(c => `- ${c}`),
  scope.conventions && scope.conventions.length ? 'Repo rules:\n' + scope.conventions.map(c => `- ${c}`).join('\n') : '',
].filter(Boolean).join('\n')

phase('Implement')
await agent(
  `${brief}\n\nImplement this. Add or update tests for new behaviour. Run \`${gateCmd}\` before you finish. ` +
  `Land the work as the fewest logical commits. ${HOLD}`,
  { label: 'implement' })

let round = 0
let last = null
const escalate = []
while (round < MAX) {
  round++
  const gate = await agent(
    `Run \`${gateCmd}\` from the repo root and report the result. Do not change any files. ` +
    'For each failure give the failing check, the relevant output (trimmed), and the remediation if the tool printed one.',
    { phase: 'Gate', label: `gate-${round}`, schema: GATE, effort: 'low' })

  const reviews = await parallel(LENSES.map(l => () => agent(
    `${brief}\n\nReview \`git diff ${scope.base}...HEAD\` and the commit messages in \`git log ${scope.base}..HEAD\` ` +
    `through one lens only: ${l.name}: ${l.prompt}\nReport only findings you can tie to a file and line. ` +
    'blocking=true only for defects; style preferences are not findings. Do not change any files.',
    { phase: 'Review', label: `${l.name}-${round}`, schema: FINDINGS })))
  const all = reviews.filter(Boolean).flatMap(r => r.findings)
  all.filter(f => f.human).forEach(f => escalate.push(f))
  const blocking = all.filter(f => f.blocking && !f.human)

  const checked = await parallel(blocking.map((f, i) => () => agent(
    `A reviewer claims this defect in the current branch (diff against ${scope.base}):\n` +
    `${f.file}:${f.line || '?'}: ${f.summary}\nScenario: ${f.scenario}\n\n` +
    'Try to refute it by reading the code and, where cheap, running it. Set refuted=true unless you confirmed the scenario fails. Do not change any files.',
    { phase: 'Review', label: `verify-${round}-${i}`, schema: VERDICT, effort: 'medium' })
    .then(v => (v && !v.refuted ? { ...f, note: v.reason } : null))))
  const confirmed = checked.filter(Boolean)
  const dropped = blocking.length - confirmed.length
  last = { round, gate, confirmed }
  log(`round ${round}: gate ${gate && gate.pass ? 'pass' : 'FAIL'}, ${confirmed.length} confirmed (${dropped} refuted), ${escalate.length} for a person`)

  if (gate && gate.pass && confirmed.length === 0) break
  if (round === MAX) break

  await agent(
    `${brief}\n\nFix the following. Commit each fix as \`git commit --fixup=<sha>\` against the commit it corrects. ${HOLD}\n\n` +
    'Gate failures:\n' + JSON.stringify((gate && gate.failures) || [], null, 1) +
    '\n\nConfirmed review findings:\n' + JSON.stringify(confirmed, null, 1),
    { phase: 'Fix', label: `fix-${round}` })
}

const clean = !!(last && last.gate && last.gate.pass && last.confirmed.length === 0)

phase('Finalize')
const fin = await agent(
  `Finalize the branch for review. Base: ${scope.base}.\n` +
  '1. Record the tip: `pre=$(git rev-parse HEAD)`. Squash fixups non-interactively: ' +
  `\`GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash ${scope.base}\`. Then check \`git diff --quiet "$pre" HEAD\` (the tree must be identical).\n` +
  '2. Read the PR template (.github/PULL_REQUEST_TEMPLATE.md, .github/pull_request_template.md, or docs/pull_request_template.md). ' +
  'Draft a title (the conventional-commit subject of the main commit) and a body that fills every template section; strike through checklist items that do not apply instead of deleting them. ' +
  'No assistant footer. Write the body to `$(git rev-parse --git-dir)/drive-pr/PR_BODY.md`.\n' +
  `3. ${HOLD}`,
  { schema: FINAL })

return {
  status: clean ? 'ready-for-ack' : 'needs-human',
  rounds: round,
  gate: last && last.gate,
  unresolved: last ? last.confirmed : [],
  forPerson: escalate,
  branch: fin && fin.branch,
  commits: fin && fin.commits,
  treeUnchanged: fin && fin.treeUnchanged,
  title: fin && fin.title,
  body: fin && fin.bodyPath,
  next: clean
    ? 'Reply +push to push the branch, then +post to open it with gh pr create --draft --body-file <body>.'
    : 'Read unresolved/forPerson, then rerun drive-pr or take over.',
}
