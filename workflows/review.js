export const meta = {
  name: 'review',
  description: 'Review a PR the way the Claude Code team does: parallel finders, a vote per finding, a risk tier, a report; with fix:true it fixes and re-reviews until clean; posts only on post:true',
  whenToUse: 'A PR or branch someone else wrote, or your own before asking for a person. Args: PR number, branch, or {target, base, depth, fix, since, round, posted, post, models}. Writes ~/.claude/harness/reports/review-*.md. /review-sweep runs it over every open PR.',
  phases: [
    { title: 'Scope', detail: 'sonnet reads the diff, intent, CLAUDE.md and REVIEW.md; sets the risk tier' },
    { title: 'Find', detail: 'opus finders hunt bugs in parallel; a separate security lane' },
    { title: 'Vote', detail: 'sonnet voters with distinct lenses; a finding needs a majority' },
    { title: 'Fix', detail: 'fix:true only: sonnet fixes, opus on a repeat; then the new diff is re-reviewed' },
    { title: 'Report', detail: 'haiku writes the report; posts only when asked' },
  ],
}

// After https://claude.dev/blog/solving-code-review-at-anthropic/ :
// several agents look for bugs at once, a separate group votes on each
// finding, only agreed findings are posted, style and cleanup are dropped,
// findings are tagged Important / Nit / Pre-existing, the change sets the
// risk tier, an agent's approval never counts as a person's, the summary
// starts with a count, re-review is diff-only with no repeats, and after
// three rounds the author is asked to reconsider the approach.

const A = typeof args === 'string' || typeof args === 'number' ? { target: String(args) } : (args || {})
const M = Object.assign({
  scope: 'sonnet', tier: 'sonnet', second: 'opus', finder: 'opus', security: 'opus',
  merge: 'haiku', voter: 'sonnet', fix: 'sonnet', escalate: 'opus', report: 'haiku', post: 'haiku',
}, A.models || {})
const DEPTH = A.depth || 'standard'
const SHAPE = { quick: { finders: 2, voters: 1 }, standard: { finders: 4, voters: 3 }, deep: { finders: 6, voters: 5 } }[DEPTH]
if (!SHAPE) throw new Error(`depth must be quick, standard or deep, not ${DEPTH}`)
const ROUND_CAP = A.roundCap || 3
const FIX = !!A.fix

const HOLD = 'Stay local: do not push, open or edit PRs, post comments, or run gh write commands. ' +
  'Commit with the repo conventions and the commit rules you were given; never --no-verify.'

const SCOPE = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name, or the directory name when there is no GitHub remote' },
    pr: { type: 'integer', description: '0 when the target is not an open PR' },
    head: { type: 'string', description: 'the reviewed commit sha' },
    base: { type: 'string' },
    branch: { type: 'string', description: 'the head branch name' },
    title: { type: 'string' },
    intent: { type: 'string', description: 'what the PR says it does and how it was tested, in a paragraph' },
    author: { type: 'string' },
    authorIsPerson: { type: 'boolean', description: 'gh api users/<login> says type User; false for bots and apps' },
    draft: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' } },
    lines: { type: 'integer', description: 'added plus removed' },
    gate: { type: 'string', description: 'one command that builds, lints and tests what the PR touches; empty if none is known' },
    reviewMd: { type: 'string', description: 'contents of REVIEW.md files that cover the touched paths, or empty' },
    skip: { type: 'array', items: { type: 'string' }, description: 'paths REVIEW.md says to skip' },
    sensitive: { type: 'array', items: { type: 'string' }, description: 'touched paths that REVIEW.md, CODEOWNERS or CLAUDE.md mark sensitive' },
    ciFiles: { type: 'array', items: { type: 'string' }, description: 'touched CI workflow files' },
    testPlan: { type: 'string', description: 'the Testing section of the PR body, or empty' },
    revertPlan: { type: 'string', description: 'the How to revert section of the PR body, or empty' },
  },
  required: ['repo', 'pr', 'head', 'base', 'title', 'intent', 'author', 'authorIsPerson', 'files', 'lines', 'sensitive', 'ciFiles'],
}
const TIER = {
  type: 'object',
  properties: {
    tier: { type: 'string', enum: ['low', 'medium', 'high'] },
    reason: { type: 'string' },
    blastRadius: { type: 'string', description: 'what breaks for whom if this change is wrong' },
  },
  required: ['tier', 'reason', 'blastRadius'],
}
const SECOND = {
  type: 'object',
  properties: {
    needsPerson: { type: 'boolean', description: 'true when a person must read this regardless of the tier' },
    reason: { type: 'string' },
  },
  required: ['needsPerson', 'reason'],
}
const FINDING = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    line: { type: 'integer' },
    summary: { type: 'string', description: 'the defect in one sentence' },
    scenario: { type: 'string', description: 'concrete input or state that produces the wrong result' },
    evidence: { type: 'string', description: 'the lines of code that show it, quoted' },
    severity: { type: 'string', enum: ['important', 'nit', 'pre-existing'] },
    kind: { type: 'string', enum: ['bug', 'security', 'style', 'diagnostics', 'cleanup'] },
    classOf: { type: 'string', description: 'the class of bug, so the author fixes every instance; empty when it is a one-off' },
  },
  required: ['file', 'summary', 'scenario', 'evidence', 'severity', 'kind'],
}
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: FINDING } }, required: ['findings'] }
const MERGED = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: Object.assign({}, FINDING, {
      properties: Object.assign({}, FINDING.properties, {
        reports: { type: 'integer', description: 'how many finders reported it' },
      }),
    }) },
    droppedAsRepeat: { type: 'integer' },
  },
  required: ['findings', 'droppedAsRepeat'],
}
const VOTE = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only when you confirmed the scenario fails' },
    reason: { type: 'string' },
    severity: { type: 'string', enum: ['important', 'nit', 'pre-existing'], description: 'your own tag for it' },
  },
  required: ['real', 'reason', 'severity'],
}
const FIXED = {
  type: 'object',
  properties: {
    head: { type: 'string', description: 'the new tip sha after the fix commits' },
    fixed: { type: 'array', items: { type: 'string' }, description: 'keys of the findings fixed, as given' },
    skipped: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string' }, reason: { type: 'string' },
    }, required: ['key', 'reason'] }, description: 'findings left for a person, with why' },
    gatePass: { type: 'boolean' },
  },
  required: ['head', 'fixed', 'skipped', 'gatePass'],
}
const WRITTEN = {
  type: 'object',
  properties: { path: { type: 'string' }, summary: { type: 'string', description: 'the first line of the report' } },
  required: ['path', 'summary'],
}
const POSTED_OUT = {
  type: 'object',
  properties: { posted: { type: 'boolean' }, url: { type: 'string' }, error: { type: 'string' } },
  required: ['posted', 'url'],
}

const key = f => `${f.file}:${f.line || '?'}: ${f.summary}`
const target = A.target || 'the current branch'

phase('Scope')
const scope = await agent(
  `Scope a code review. Target: ${target}${A.base ? `, base ${A.base}` : ''}. Change nothing.\n` +
  '- If the target is a PR number or an open PR exists for the branch, read its title, body, author, draft state and head with `gh pr view --json`. Otherwise use the branch and its upstream default base.\n' +
  '- authorIsPerson: `gh api users/<login> --jq .type` is `User`. Bots, apps and organizations are not people.\n' +
  '- Diff against the merge-base with the base. List the files and count the changed lines.\n' +
  '- Read CLAUDE.md or AGENTS.md at the root. Find every REVIEW.md whose directory contains a touched file and return its contents.\n' +
  '- gate: `make agent-gate` if it exists, else the build, lint and test commands for what the PR touches joined with &&, else empty.\n' +
  '- A touched path is sensitive when REVIEW.md, CODEOWNERS or CLAUDE.md say so, or when it is auth, billing, tokens, secrets, the updater, release or install scripts. Any file under .github/workflows is a CI file.\n' +
  '- Pull the Testing and How to revert sections from the PR body when they exist.',
  { label: 'scope', schema: SCOPE, model: M.scope, effort: 'low' })
if (!scope) throw new Error('scope agent returned nothing')

const briefFor = (since, head) =>
  `PR: ${scope.title} (${scope.repo}${scope.pr ? ' #' + scope.pr : ''}, ${head})\n` +
  `Intent: ${scope.intent}\n` +
  (scope.testPlan ? `Tested: ${scope.testPlan}\n` : 'Tested: the PR does not say.\n') +
  `Full diff: \`git diff ${scope.base}...${head}\` (${scope.lines} lines over ${scope.files.length} files)\n` +
  (since ? `New in this round: \`git diff ${since}...${head}\`. Review only the new commits, but read the rest of the PR and the repo for context.\n` : '') +
  (scope.reviewMd ? `\nREVIEW.md for these paths:\n${scope.reviewMd}\n` : '') +
  (scope.skip && scope.skip.length ? `Skip: ${scope.skip.join(', ')}\n` : '')

// The change sets the tier, not the author. A second, different model asks
// whether a person is needed anyway.
const brief0 = briefFor(A.since, scope.head)
const [tier, second] = await parallel([
  () => agent(
    `${brief0}\nSet the risk tier of this change from the change alone, never from who wrote it.\n` +
    '- low: docs, copy, internal-only features, additive changes behind a flag.\n' +
    '- medium: ordinary product changes, and sensitive areas such as caching, the updater, system prompts.\n' +
    '- high: auth, billing, tokens and secrets, release and install paths, CI workflow files, and anything the repo marks as always-two-person.\n' +
    `Touched sensitive paths: ${JSON.stringify(scope.sensitive)}. Touched CI files: ${JSON.stringify(scope.ciFiles)}. Read the diff; do not change files.`,
    { label: 'tier', schema: TIER, model: M.tier, effort: 'low' }),
  () => agent(
    `${brief0}\nIndependently of any risk tier: does this change need a person to read it regardless of what automated review says? ` +
    'Yes when it sets a pattern others will copy, changes an interface other code depends on, touches a path the repo marks sensitive, or the stated test plan could not catch the ways it fails. Read the diff; do not change files.',
    { label: 'second-opinion', schema: SECOND, model: M.second, effort: 'low' }),
])
let risk = (tier && tier.tier) || 'medium'
if (scope.ciFiles.length || scope.sensitive.length) risk = 'high'
const needsPerson = risk !== 'low' || !!(second && second.needsPerson)
const approvals = { low: 0, medium: 1, high: 2 }[risk]
log(`${scope.repo}${scope.pr ? ' #' + scope.pr : ''}: ${scope.lines} lines, tier ${risk}, ${approvals} human approval(s) required`)

const ANGLES = [
  'Does the change solve the problem it states? Compare the intent with what the code does; for a bug fix, find the root cause and check the fix addresses it rather than a symptom.',
  'Does it fit the system? Follow every caller and callee of the changed code across the repo; find a contract, invariant or assumption it breaks.',
  'Does it break something else? Error paths, concurrency, resource lifetimes, partial failure, retries, and inputs the tests do not use.',
  'Is it tested for the ways it can fail? Compare the stated test plan with the failure modes of the code; name the untested one with the highest blast radius.',
  'Read it as the on-call engineer who will be paged: what would the first incident from this change look like, and which line causes it?',
  'Read every changed line of configuration, build, packaging and workflow: what does it misroute, mis-pin or expose?',
]
const HOLD_FIND = 'Report only findings with a file, a line and quoted evidence; never a guess from a name. ' +
  'Tag severity: important for a defect the change introduces, nit for a small one, pre-existing for one that was already there. ' +
  'Tag kind honestly; style, diagnostics and cleanup are dropped later, so do not dress them up as bugs. ' +
  'Return an empty list when there is nothing to find. Do not change files.'
const LENSES = [
  { name: 'refute', prompt: 'Try to refute it: read the code and, where cheap, run it. Set real=false unless you confirmed the scenario fails.' },
  { name: 'reproduce', prompt: 'Try to reproduce it: write out the exact call or input, follow the code path line by line, and say where the wrong result appears. Set real=false if you cannot.' },
  { name: 'intent', prompt: 'Judge it against the stated intent and test plan: is this a defect the author would want fixed before merge, or intentional? Set real=false when it is intentional or harmless.' },
  { name: 'blast', prompt: 'Judge its blast radius: who is affected, how often, and how would it be noticed? Set real=false when no user or operator would ever observe it.' },
  { name: 'history', prompt: 'Use git blame and log: did this PR introduce the defect, or was it already there? Set real=true only if the defect exists; set severity=pre-existing when it predates the PR.' },
]
const NEEDED = Math.floor(SHAPE.voters / 2) + 1
const rank = { important: 0, nit: 1, 'pre-existing': 2 }

// One review pass over the diff since `since` at `head`: find, merge, vote.
async function pass(round, since, head, posted) {
  const brief = briefFor(since, head)
  const tag = `r${round}`
  const finders = ANGLES.slice(0, SHAPE.finders).map((angle, i) => () => agent(
    `${brief}\nHunt for bugs in this change from one angle:\n${angle}\n${HOLD_FIND}`,
    { phase: 'Find', label: `finder-${i}-${tag}`, schema: FINDINGS, model: M.finder }))
  const securityLane = () => agent(
    `${brief}\nSecurity review of this change: injection, path and symlink traversal, authn and authz gaps, secrets in code or logs, ` +
    'unsafe deserialization, SSRF, TOCTOU, privilege and token scope widening, unsafe defaults, supply-chain changes (new dependencies, pins, workflow permissions). ' +
    `Set kind=security on every finding. ${HOLD_FIND}`,
    { phase: 'Find', label: `security-${tag}`, schema: FINDINGS, model: M.security })
  // Barrier: dedup needs every finder's list at once.
  const found = (await parallel(finders.concat([securityLane]))).filter(Boolean).flatMap(r => r.findings)
  const kept = found.filter(f => f.kind === 'bug' || f.kind === 'security')

  let merged = { findings: [], droppedAsRepeat: 0 }
  if (kept.length) {
    merged = await agent(
      'Merge duplicate findings from independent reviewers into one list. Two findings are the same when they describe the same defect, ' +
      'even if the line differs by a few or the words differ. Keep the clearest summary and the strongest evidence; set reports to how many reported it.\n' +
      (posted.length ? `Drop any finding already posted in an earlier round (count them in droppedAsRepeat):\n${JSON.stringify(posted, null, 1)}\n` : '') +
      `Findings:\n${JSON.stringify(kept, null, 1)}`,
      { phase: 'Find', label: `merge-${tag}`, schema: MERGED, model: M.merge, effort: 'low' }) || merged
  }
  log(`round ${round}: ${found.length} raw, ${found.length - kept.length} non-bug dropped, ${merged.droppedAsRepeat} repeats dropped, ${merged.findings.length} to vote on`)

  const voted = await pipeline(merged.findings,
    (f, _, i) => parallel(LENSES.slice(0, SHAPE.voters).map(l => () => agent(
      `${brief}\nAn independent reviewer claims this defect:\n${key(f)}\n` +
      `Scenario: ${f.scenario}\nEvidence:\n${f.evidence}\n\n${l.prompt} Do not change files.`,
      { phase: 'Vote', label: `vote-${i}-${l.name}-${tag}`, schema: VOTE, model: M.voter, effort: 'medium' })))
      .then(votes => {
        const v = votes.filter(Boolean)
        const yes = v.filter(x => x.real)
        const pre = yes.some(x => x.severity === 'pre-existing')
        return Object.assign({}, f, {
          round, votes: yes.length, of: v.length, agreed: yes.length >= NEEDED,
          severity: pre ? 'pre-existing' : (yes.filter(x => x.severity === 'important').length > yes.length / 2 ? 'important' : f.severity),
          reasons: v.map(x => x.reason),
        })
      }))
  const all = voted.filter(Boolean)
  return {
    agreed: all.filter(f => f.agreed).sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.votes - a.votes)),
    rejected: all.filter(f => !f.agreed),
    dropped: { nonBug: found.length - kept.length, repeats: merged.droppedAsRepeat },
  }
}

// Rounds. Without fix, exactly one pass. With fix, a fixer applies the
// important findings as fixup commits and the new diff is re-reviewed,
// until clean, a finding survives for a person, or the round cap.
let round = A.round || 1
let since = A.since || null
let head = scope.head
const posted = (A.posted || []).slice()
const open = []        // agreed findings still open
const fixed = []       // keys the fixer closed
const forPerson = []   // findings the fixer would not touch
const rejected = []
const dropped = { nonBug: 0, repeats: 0 }
let repeatKeys = []
let lastGate = null
let reconsider = false
while (true) {
  const r = await pass(round, since, head, posted)
  rejected.push(...r.rejected)
  dropped.nonBug += r.dropped.nonBug
  dropped.repeats += r.dropped.repeats
  const important = r.agreed.filter(f => f.severity === 'important')
  const minor = r.agreed.filter(f => f.severity !== 'important')
  log(`round ${round}: ${r.agreed.length} agreed by ${NEEDED}/${SHAPE.voters} voters, ${important.length} important`)
  open.push(...minor)
  if (!FIX || important.length === 0) { open.push(...important); break }
  if (round >= ROUND_CAP) { open.push(...important); reconsider = true; break }

  const keys = important.map(key)
  const repeat = keys.some(k => repeatKeys.indexOf(k) >= 0)
  repeatKeys = keys
  const fx = await agent(
    `${briefFor(since, head)}\nFix the findings below on the current branch (${scope.branch || 'HEAD'}, tip ${head}). ` +
    'Commit each fix as `git commit --fixup=<sha>` against the commit it corrects when the PR is yours to rewrite, otherwise as a plain fix commit. ' +
    'When a finding names a class of bug, fix every instance in the PR. ' +
    'Leave a finding alone and list it in skipped when fixing it needs a design decision, changes a public interface or a sensitive path, or you cannot confirm the fix is right. ' +
    (scope.gate ? `Run \`${scope.gate}\` before you finish and report whether it passes. ` : 'Run the tests for the files you touched and report whether they pass. ') +
    `Return the new tip sha. ${HOLD}\n\nFindings:\n${JSON.stringify(important, null, 1)}`,
    { phase: 'Fix', label: `fix-r${round}${repeat ? '-escalated' : ''}`, schema: FIXED, model: repeat ? M.escalate : M.fix })
  if (!fx) { open.push(...important); break }
  lastGate = fx.gatePass
  fixed.push(...fx.fixed)
  const skipped = fx.skipped.map(s => s.key)
  important.filter(f => skipped.indexOf(key(f)) >= 0).forEach(f => forPerson.push(Object.assign({}, f, {
    reason: (fx.skipped.find(s => s.key === key(f)) || {}).reason,
  })))
  posted.push(...keys)
  log(`round ${round}: fixed ${fx.fixed.length}, left ${fx.skipped.length} for a person, gate ${fx.gatePass ? 'pass' : 'FAIL'}, tip ${fx.head}`)
  if (fx.head === head && fx.fixed.length === 0) break   // nothing changed, no point re-reviewing
  since = head
  head = fx.head
  round++
}

phase('Report')
const important = open.filter(f => f.severity === 'important')
const summary = `${open.length} open finding${open.length === 1 ? '' : 's'}` +
  (open.length ? `, ${important.length} important` : ': nothing to fix') +
  (fixed.length ? `, ${fixed.length} fixed by the agent` : '') +
  (forPerson.length ? `, ${forPerson.length} left for a person` : '')
const mergeable = important.length === 0 && forPerson.length === 0 && (lastGate !== false) && approvals === 0
const slug = scope.repo.replace(/[^\w.-]+/g, '-')
const report = await agent(
  `Write the review report to ~/.claude/harness/reports/review-${slug}-${scope.pr || scope.head.slice(0, 12)}-round${round}.md ` +
  '(create the directory if needed) and return its path and first line. Markdown, no em-dashes, no arrows.\n' +
  `- First line: "${summary}" for ${scope.repo}${scope.pr ? ' #' + scope.pr : ''} at ${head}` + (A.since || fixed.length ? ` (round ${round}, since ${A.since || scope.head})` : '') + '.\n' +
  `- Then: risk tier ${risk} (${tier ? tier.reason : 'default'}; blast radius: ${tier ? tier.blastRadius : 'unknown'}), ` +
  `${approvals} human approval(s) required, agent findings never count as an approval. Second opinion: ${second ? second.reason : 'none'}.\n` +
  (scope.authorIsPerson ? '' : `- Author ${scope.author} is not a person; this review was not posted and must not be.\n`) +
  (scope.ciFiles.length ? `- CI workflow files touched (${scope.ciFiles.join(', ')}): a person must read them.\n` : '') +
  (scope.sensitive.length ? `- Sensitive paths touched: ${scope.sensitive.join(', ')}.\n` : '') +
  (scope.revertPlan ? '' : '- Note that the PR body has no revert plan.\n') +
  (reconsider ? `- Round ${round} of ${ROUND_CAP}: ask the author to step back and reconsider the approach instead of fixing one more line.\n` : '') +
  (lastGate === false ? '- The gate FAILED after the last fix round.\n' : '') +
  '- One section per open finding, sorted as given: severity tag in brackets, file:line, summary, scenario, evidence, votes, and the class of bug when set so the author fixes every instance.\n' +
  (fixed.length ? '- A section "Fixed by the agent" listing the fixed keys, one line each.\n' : '') +
  (forPerson.length ? '- A section "Left for a person" with the finding and the reason the fixer did not touch it.\n' : '') +
  '- A final short list of candidates the voters rejected, one line each, so a person can spot a wrong rejection.\n\n' +
  `Open findings:\n${JSON.stringify(open, null, 1)}\n\nFixed:\n${JSON.stringify(fixed)}\n\nLeft for a person:\n${JSON.stringify(forPerson, null, 1)}\n\n` +
  `Rejected:\n${JSON.stringify(rejected.map(f => ({ file: f.file, line: f.line, summary: f.summary, votes: `${f.votes}/${f.of}`, round: f.round })), null, 1)}`,
  { label: 'report', schema: WRITTEN, model: M.report, effort: 'low' })

// Posting is the only outward step. It needs an explicit post:true, an open
// PR, a person as author, and something to say.
let postResult = null
if (A.post && scope.pr && scope.authorIsPerson && (open.length || fixed.length)) {
  postResult = await agent(
    `Post the review to PR #${scope.pr} of ${scope.repo} as ONE review with inline comments and event COMMENT, never APPROVE or REQUEST_CHANGES: ` +
    `\`gh api repos/${scope.repo}/pulls/${scope.pr}/reviews\` with commit_id ${head}. ` +
    `Body: "${summary}" plus the tier line (tier ${risk}, ${approvals} human approval(s) required). ` +
    'One inline comment per open finding: "[Important]", "[Nit]" or "[Pre-existing]" prefix, summary, scenario, evidence, and the class of bug when set. ' +
    (fixed.length ? 'List the keys fixed by the agent in the body under "Fixed". ' : '') +
    (reconsider ? 'Say in the body that this is the third round and suggest the author reconsider the approach rather than fix one more line. ' : '') +
    'Say in the body that each finding is to be fixed or resolved with a reason. Post nothing else.\n' +
    `Open findings:\n${JSON.stringify(open, null, 1)}`,
    { label: 'post', schema: POSTED_OUT, model: M.post, effort: 'low' })
}

return {
  status: mergeable ? 'clean' : (important.length || forPerson.length ? 'findings' : 'needs-human'),
  summary,
  tier: risk,
  humanApprovals: approvals,
  needsPerson,
  author: scope.author,
  authorIsPerson: scope.authorIsPerson,
  draft: !!scope.draft,
  round,
  reconsider,
  head,
  gatePass: lastGate,
  findings: open,
  fixed,
  forPerson,
  rejected: rejected.length,
  dropped,
  report: report && report.path,
  posted: postResult ? postResult.posted : false,
  postedKeys: posted.concat(open.map(key)),
}
