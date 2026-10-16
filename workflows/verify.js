export const meta = {
  name: 'verify',
  description: 'Gate and review the current branch, fix until clean or maxRounds; local only',
  whenToUse: 'A branch with commits that should end tested and reviewed. Standalone, or called by /build. Args: string task, or {task, base, gate, criteria, testPlan, maxRounds, models}.',
  phases: [
    { title: 'Scope', detail: 'standalone only: base, gate and criteria from the branch' },
    { title: 'Gate', detail: 'haiku runs the gate and reports failures' },
    { title: 'Review', detail: 'four lenses, each blocking finding checked by a skeptic' },
    { title: 'Fix', detail: 'sonnet fixes; opus takes over a failure that survives a round' },
  ],
}

const A = typeof args === 'string' ? { task: args } : (args || {})
const M = Object.assign({
  scope: 'sonnet', gate: 'haiku', review: 'opus', lens: 'sonnet',
  skeptic: 'sonnet', fix: 'sonnet', escalate: 'opus',
}, A.models || {})
const MAX = A.maxRounds || 3

const HOLD = 'Stay local: do not push, open or edit PRs, post comments, or run gh write commands. ' +
  'Commit with the repo conventions and the commit rules you were given; never --no-verify.'

const SCOPE = {
  type: 'object',
  properties: {
    base: { type: 'string' }, gate: { type: 'string' },
    criteria: { type: 'array', items: { type: 'string' } },
  },
  required: ['base', 'gate', 'criteria'],
}
const GATE = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' }, command: { type: 'string' },
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
      file: { type: 'string' }, line: { type: 'integer' }, summary: { type: 'string' },
      scenario: { type: 'string', description: 'concrete input or state that produces the wrong result' },
      blocking: { type: 'boolean' },
      human: { type: 'boolean', description: 'a judgement call (provenance, token or permission policy, public API) a person must make' },
    }, required: ['file', 'summary', 'scenario', 'blocking', 'human'] } },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

let scope = { base: A.base, gate: A.gate, criteria: A.criteria || [] }
if (!scope.base || !scope.gate) {
  phase('Scope')
  const s = await agent(
    'Scope a verification pass over the current branch. Read AGENTS.md (or CLAUDE.md) and CONTRIBUTING. ' +
    'Base is the merge-base with the upstream default branch (usually origin/main). ' +
    'The gate is `make agent-gate` if it exists, otherwise the build, lint and test commands for what the branch touches, joined with &&. ' +
    'Criteria come from the task below, the commit messages, and an open PR body if there is one.' +
    (A.task ? `\n\nTask: ${A.task}` : ''),
    { label: 'scope', schema: SCOPE, model: M.scope, effort: 'low' })
  if (!s) throw new Error('scope agent returned nothing')
  scope = { base: scope.base || s.base, gate: scope.gate || s.gate, criteria: scope.criteria.length ? scope.criteria : s.criteria }
}

const brief = [
  A.task ? `Task: ${A.task}` : '',
  scope.criteria.length ? 'Acceptance criteria:\n' + scope.criteria.map(c => `- ${c}`).join('\n') : '',
  A.testPlan && A.testPlan.length ? 'Test plan:\n' + A.testPlan.map(t => `- ${t}`).join('\n') : '',
].filter(Boolean).join('\n\n')

const LENSES = [
  { name: 'correctness', model: M.review, prompt: 'bugs a test or user would hit: wrong logic, unhandled errors, races, leaks, regressions in callers. Each finding needs a concrete failing scenario.' },
  { name: 'acceptance', model: M.review, prompt: 'every acceptance criterion and test-plan item is implemented and covered by a test that runs in the gate. A criterion without a passing test is a blocking finding; name the criterion.' },
  { name: 'claims', model: M.lens, prompt: 'statements that do not match the code: commit messages, comments, docs, README, CLI help, test names. A false claim on correct code is a blocking finding.' },
  { name: 'conventions', model: M.lens, prompt: 'repo rules from AGENTS.md, CONTRIBUTING and the PR template, and the commit rules you were given. Mark provenance, token-scope, permission and public-API decisions as human=true.' },
]

let round = 0
let last = null
let prevKeys = []
const escalate = []
while (round < MAX) {
  round++
  const gate = await agent(
    `Run \`${scope.gate}\` from the repo root and report the result. Do not change files. ` +
    'For each failure give the failing check, the trimmed output, and the remediation if the tool printed one.',
    { phase: 'Gate', label: `gate-${round}`, schema: GATE, model: M.gate, effort: 'low' })

  const reviews = await parallel(LENSES.map(l => () => agent(
    `${brief}\n\nReview \`git diff ${scope.base}...HEAD\` and \`git log ${scope.base}..HEAD\` through one lens: ` +
    `${l.name}: ${l.prompt}\nReport only findings tied to a file and line. blocking=true only for defects. Do not change files.`,
    { phase: 'Review', label: `${l.name}-${round}`, schema: FINDINGS, model: l.model })))
  const all = reviews.filter(Boolean).flatMap(r => r.findings)
  all.filter(f => f.human).forEach(f => escalate.push(f))
  const blocking = all.filter(f => f.blocking && !f.human)

  const checked = await parallel(blocking.map((f, i) => () => agent(
    `A reviewer claims this defect on the branch (diff against ${scope.base}):\n` +
    `${f.file}:${f.line || '?'}: ${f.summary}\nScenario: ${f.scenario}\n\n` +
    'Try to refute it by reading the code and, where cheap, running it. Set refuted=true unless you confirmed the scenario fails. Do not change files.',
    { phase: 'Review', label: `skeptic-${round}-${i}`, schema: VERDICT, model: M.skeptic, effort: 'medium' })
    .then(v => (v && !v.refuted ? Object.assign({}, f, { note: v.reason }) : null))))
  const confirmed = checked.filter(Boolean)
  last = { round, gate, confirmed }
  log(`round ${round}: gate ${gate && gate.pass ? 'pass' : 'FAIL'}, ${confirmed.length} confirmed of ${blocking.length}, ${escalate.length} for a person`)

  if (gate && gate.pass && confirmed.length === 0) break
  if (round === MAX) break

  const keys = ((gate && gate.failures) || []).map(f => 'gate:' + f.check)
    .concat(confirmed.map(f => f.file + ':' + f.summary))
  const repeat = keys.some(k => prevKeys.indexOf(k) >= 0)
  prevKeys = keys
  await agent(
    `${brief}\n\nFix the following. Commit each fix as \`git commit --fixup=<sha>\` against the commit it corrects. ` +
    `Re-run \`${scope.gate}\` before you finish. ${HOLD}\n\n` +
    'Gate failures:\n' + JSON.stringify((gate && gate.failures) || [], null, 1) +
    '\n\nConfirmed findings:\n' + JSON.stringify(confirmed, null, 1),
    { phase: 'Fix', label: `fix-${round}${repeat ? '-escalated' : ''}`, model: repeat ? M.escalate : M.fix })
}

const clean = !!(last && last.gate && last.gate.pass && last.confirmed.length === 0)
return {
  status: clean ? 'clean' : 'needs-human',
  rounds: round,
  base: scope.base,
  gate: last && last.gate,
  unresolved: last ? last.confirmed : [],
  forPerson: escalate,
}
