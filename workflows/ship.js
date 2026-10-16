export const meta = {
  name: 'ship',
  description: 'Push a finished branch, open it as a draft PR, watch CI and triage failures (haiku)',
  whenToUse: 'After /build or /verify. Running it is the ack to push and open a draft PR. Args: branch name, or {branch, base, title, body, watch, rerunFlakes, models}.',
  phases: [
    { title: 'Preflight', detail: 'clean tree, rebased on base, commit rules, PR body found' },
    { title: 'Push', detail: 'push without force, open a draft PR with no reviewers' },
    { title: 'CI', detail: 'wait for checks, then classify each failure' },
  ],
}

const A = typeof args === 'string' ? { branch: args } : (args || {})
const M = Object.assign({ preflight: 'haiku', push: 'haiku', ci: 'haiku', triage: 'haiku' }, A.models || {})
const WATCH = A.watch !== false

const PRE = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' }, branch: { type: 'string' }, base: { type: 'string' },
    title: { type: 'string' }, bodyPath: { type: 'string' },
    existingPr: { type: 'integer', description: '0 when there is none' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'branch', 'base', 'title', 'bodyPath', 'existingPr', 'problems'],
}
const PUSHED = {
  type: 'object',
  properties: {
    pushed: { type: 'boolean' }, pr: { type: 'integer' }, url: { type: 'string' }, error: { type: 'string' },
  },
  required: ['pushed', 'pr', 'url'],
}
const CHECKS = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['pass', 'fail', 'pending', 'none'] },
    failed: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, runId: { type: 'string' }, url: { type: 'string' },
    }, required: ['name', 'runId'] } },
  },
  required: ['state', 'failed'],
}
const TRIAGE = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['real', 'flake', 'infra'] },
    evidence: { type: 'string', description: 'the log lines that decide it' },
    files: { type: 'array', items: { type: 'string' } },
    rerun: { type: 'boolean' },
  },
  required: ['kind', 'evidence', 'rerun'],
}

phase('Preflight')
const pre = await agent(
  'Check that a branch is ready to push. Change nothing except a rebase of unpushed commits.\n' +
  `Branch: ${A.branch || 'the current branch'}. Base: ${A.base || 'the upstream default branch'}.\n` +
  '- The working tree is clean.\n' +
  '- `git fetch origin`. If the branch is behind origin/<base> and has never been pushed, rebase it onto origin/<base>. ' +
  'If it was pushed already and needs a rebase, report that as a problem: a force-push needs a person.\n' +
  '- Every commit since base follows the repo conventions and your commit rules (sign-off, no bot co-author).\n' +
  `- PR title and body: ${A.body ? 'body file ' + A.body : 'use `$(git rev-parse --git-common-dir)/harness/<slug>/PR_BODY.md` for this branch if it exists, otherwise draft one from the PR template and the commits into that path'}` +
  `${A.title ? '; title: ' + A.title : '; title = the main commit subject'}.\n` +
  '- Look up an existing PR for the branch with `gh pr view --json number`.\n' +
  'ok=false if any problem remains.',
  { label: 'preflight', schema: PRE, model: M.preflight, effort: 'low' })
if (!pre) throw new Error('preflight returned nothing')
if (!pre.ok) return { status: 'needs-human', problems: pre.problems, branch: pre.branch }

phase('Push')
const pushed = await agent(
  `Run \`git push -u origin ${pre.branch}\`. Never force; if the push is rejected, stop and report the error.\n` +
  (pre.existingPr
    ? `PR #${pre.existingPr} exists already; do not create another. Report its number and URL.`
    : `Then \`gh pr create --draft --base ${pre.base} --head ${pre.branch} --title ${JSON.stringify(pre.title)} --body-file ${JSON.stringify(pre.bodyPath)}\`. ` +
      'Add no reviewers, assignees or labels.') +
  ' Do not mark the PR ready, merge it, or comment on it.',
  { label: 'push', schema: PUSHED, model: M.push, effort: 'low' })
if (!pushed || !pushed.pushed) return { status: 'needs-human', problems: [(pushed && pushed.error) || 'push failed'] }
log(`pushed ${pre.branch}; draft PR #${pushed.pr} ${pushed.url}`)
if (!WATCH) return { status: 'pushed', pr: pushed.pr, url: pushed.url }

phase('CI')
const checks = await agent(
  `Wait for the checks on PR #${pushed.pr} to finish. Poll \`gh pr checks ${pushed.pr}\` every 60 seconds ` +
  '(use the Monitor tool or a background command, not a blocking sleep), for at most 45 minutes. ' +
  'Report the final state and, for each failed check, its name, run id and URL. Do not rerun anything.',
  { label: 'ci-watch', schema: CHECKS, model: M.ci, effort: 'low' })
if (!checks) throw new Error('ci watch returned nothing')
if (checks.state !== 'fail') return { status: checks.state === 'pass' ? 'green' : checks.state, pr: pushed.pr, url: pushed.url }

const triaged = await parallel(checks.failed.map((f, i) => () => agent(
  `CI check "${f.name}" failed on PR #${pushed.pr} (run ${f.runId}). Read \`gh run view ${f.runId} --log-failed\` (the tail is enough) ` +
  'and the PR diff. Decide whether it is real (the change broke it), flake (timing, retry passes elsewhere) or infra (runner, network, quota). ' +
  'Quote the deciding log lines. Set rerun=true only for flake or infra.' +
  (A.rerunFlakes ? ` If rerun=true, run \`gh run rerun ${f.runId} --failed\`.` : ' Do not rerun.'),
  { phase: 'CI', label: `triage-${i}`, schema: TRIAGE, model: M.triage })
  .then(t => Object.assign({ check: f.name, url: f.url }, t || { kind: 'unknown' }))))

const real = triaged.filter(t => t.kind === 'real')
return {
  status: real.length ? 'ci-failed' : 'ci-flaky',
  pr: pushed.pr, url: pushed.url, failures: triaged,
  next: real.length ? 'Fix with /verify on the branch, then /ship again (it reuses the PR).'
    : (A.rerunFlakes ? 'Reruns started; check the PR later.' : 'Rerun with {rerunFlakes: true} or by hand.'),
}
