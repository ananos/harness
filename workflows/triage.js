export const meta = {
  name: 'triage',
  description: 'Classify open GitHub issues from people (not bots) and write a triage report; optionally apply labels (haiku)',
  whenToUse: 'Args: "owner/repo", or {repo, limit, all, apply, models}. Writes ~/.claude/harness/reports/triage-*.md. Never comments or closes; apply=true only adds existing labels.',
  phases: [
    { title: 'Collect', detail: 'issues by people, and the repo label set' },
    { title: 'Classify', detail: 'one haiku per issue: type, impact, labels, duplicates, missing info' },
    { title: 'Report', detail: 'sonnet writes the report; haiku applies labels if asked' },
  ],
}

const A = typeof args === 'string' ? { repo: args } : (args || {})
if (!A.repo) throw new Error('triage needs a repo: "owner/repo" or {repo}')
const M = Object.assign({ collect: 'haiku', classify: 'haiku', report: 'sonnet', apply: 'haiku' }, A.models || {})
const LIMIT = A.limit || 30

const COLLECTED = {
  type: 'object',
  properties: {
    labels: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'object', properties: {
      number: { type: 'integer' }, title: { type: 'string' }, author: { type: 'string' },
      labels: { type: 'array', items: { type: 'string' } }, body: { type: 'string', description: 'first 1500 chars' },
    }, required: ['number', 'title', 'author'] } },
    skippedBots: { type: 'array', items: { type: 'string' } },
  },
  required: ['labels', 'issues', 'skippedBots'],
}
const CLASS = {
  type: 'object',
  properties: {
    number: { type: 'integer' },
    type: { type: 'string', enum: ['bug', 'feature', 'question', 'docs', 'chore', 'duplicate', 'support'] },
    area: { type: 'string' },
    impact: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: 'impact if left unfixed, not timing' },
    labels: { type: 'array', items: { type: 'string' }, description: 'only labels that exist in the repo' },
    duplicateOf: { type: 'integer', description: '0 when none' },
    missing: { type: 'array', items: { type: 'string' }, description: 'information a maintainer needs from the reporter' },
    summary: { type: 'string', description: 'one sentence' },
  },
  required: ['number', 'type', 'impact', 'labels', 'duplicateOf', 'missing', 'summary'],
}

phase('Collect')
const got = await agent(
  `List open issues in ${A.repo}: \`gh issue list -R ${A.repo} --state open --limit ${LIMIT} --json number,title,author,labels,body\`` +
  (A.all ? '.' : ', keeping only issues with no labels.') +
  ' Keep only issues whose author is a person: `gh api users/<login> --jq .type` must print User. List the others as skippedBots. ' +
  `Also list the repo labels: \`gh label list -R ${A.repo} --limit 200 --json name\`. Read only.`,
  { label: 'collect', schema: COLLECTED, model: M.collect, effort: 'low' })
if (!got) throw new Error('collect returned nothing')
log(`${got.issues.length} issues from people, ${got.skippedBots.length} bot issues skipped`)
if (!got.issues.length) return { status: 'empty', repo: A.repo, skippedBots: got.skippedBots }

phase('Classify')
const classes = (await pipeline(got.issues, issue => agent(
  `Triage issue #${issue.number} in ${A.repo}.\nTitle: ${issue.title}\nAuthor: ${issue.author}\nBody:\n${issue.body || '(empty)'}\n\n` +
  `Existing labels in the repo: ${got.labels.join(', ')}\n` +
  `Search for duplicates with \`gh search issues --repo ${A.repo} "<key terms>" --state all --limit 5\`. ` +
  'Impact means how bad it is if left unfixed (P0 data loss/security/outage ... P3 cosmetic), not when to do it. ' +
  'Pick labels only from the existing set. Read only.',
  { phase: 'Classify', label: `issue-${issue.number}`, schema: CLASS, model: M.classify, effort: 'low' })
)).filter(Boolean)

phase('Report')
const report = await agent(
  `Write a triage report for ${A.repo} as Markdown to \`~/.claude/harness/reports/triage-${A.repo.replace('/', '-')}-$(date +%Y-%m-%d).md\` ` +
  '(create the directory). Group by impact, then type. One line per issue: number with link, summary, proposed labels, duplicate, missing info. ' +
  'End with the skipped bot issues. Return the absolute path only. Read GitHub only; post nothing.\n\n' +
  JSON.stringify({ classes, skippedBots: got.skippedBots }, null, 1),
  { label: 'report', model: M.report, effort: 'low' })

let applied = null
if (A.apply) {
  const todo = classes.filter(c => c.labels.length).map(c => ({ number: c.number, labels: c.labels }))
  applied = await agent(
    `Add these labels in ${A.repo} with \`gh issue edit <n> -R ${A.repo} --add-label <a,b>\`, one issue at a time:\n` +
    JSON.stringify(todo, null, 1) + '\nAdd labels only: do not remove labels, comment, assign, or close. Report what you changed.',
    { label: 'apply-labels', model: M.apply, effort: 'low' })
}

return { status: 'done', repo: A.repo, report, issues: classes.length, applied }
