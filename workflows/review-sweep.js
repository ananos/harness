export const meta = {
  name: 'review-sweep',
  description: 'Run /review over every open PR by a person on a repo, re-reviewing only new heads, with state so no finding is posted twice; posts only on post:true',
  whenToUse: 'The scheduled form of /review: `bin/review-watch` runs it from launchd. Args: "owner/repo", or {repo, post, fix, depth, drafts, limit, models}. State in ~/.claude/harness/reports/review-state-<repo>.json, digest beside it.',
  phases: [
    { title: 'Collect', detail: 'haiku lists open PRs by people and reads the state file' },
    { title: 'Review', detail: 'one /review per PR with a new head' },
    { title: 'Record', detail: 'haiku writes the state file and the digest' },
  ],
}

const A = typeof args === 'string' ? { repo: args } : (args || {})
if (!A.repo) throw new Error('review-sweep needs a repo: "owner/repo" or {repo}')
const M = Object.assign({ collect: 'haiku', record: 'haiku' }, A.models || {})
const LIMIT = A.limit || 20
const slug = A.repo.replace(/[^\w.-]+/g, '-')
const STATE = `~/.claude/harness/reports/review-state-${slug}.json`

const COLLECTED = {
  type: 'object',
  properties: {
    today: { type: 'string', description: 'YYYY-MM-DD from `date`' },
    prs: { type: 'array', items: { type: 'object', properties: {
      number: { type: 'integer' }, head: { type: 'string' }, author: { type: 'string' },
      draft: { type: 'boolean' }, title: { type: 'string' },
      lastHead: { type: 'string', description: 'from the state file, or empty' },
      lastRound: { type: 'integer', description: 'from the state file, or 0' },
      posted: { type: 'array', items: { type: 'string' }, description: 'postedKeys from the state file' },
      status: { type: 'string', description: 'from the state file, or empty' },
    }, required: ['number', 'head', 'author', 'draft', 'title', 'lastHead', 'lastRound', 'posted'] } },
    skippedBots: { type: 'array', items: { type: 'string' }, description: 'login#number for PRs by bots or apps' },
    skippedMerged: { type: 'array', items: { type: 'integer' }, description: 'PR numbers in the state file that are no longer open' },
  },
  required: ['today', 'prs', 'skippedBots', 'skippedMerged'],
}
const RECORDED = {
  type: 'object',
  properties: { statePath: { type: 'string' }, digestPath: { type: 'string' }, firstLine: { type: 'string' } },
  required: ['statePath', 'digestPath', 'firstLine'],
}

phase('Collect')
const c = await agent(
  `Collect the open PRs of ${A.repo} for review. Change nothing on GitHub.\n` +
  `- \`gh pr list --repo ${A.repo} --state open --limit ${LIMIT} --json number,headRefOid,author,isDraft,title\`.\n` +
  '- Keep only PRs whose author is a person: `gh api users/<login> --jq .type` is `User`. Apps (login starting app/), bots and organizations go to skippedBots. Cache lookups per login within this run.\n' +
  `- Read ${STATE} if it exists: an object keyed by PR number with head, round, posted, status. Fill lastHead, lastRound and posted from it; PR numbers in the file that are no longer open go to skippedMerged.\n` +
  '- today from `date +%Y-%m-%d`.',
  { label: 'collect', schema: COLLECTED, model: M.collect, effort: 'low' })
if (!c) throw new Error('collect agent returned nothing')
const due = c.prs.filter(p => p.head !== p.lastHead && (A.drafts !== false || !p.draft))
log(`${c.prs.length} open PRs by people, ${due.length} with a new head, ${c.skippedBots.length} by bots skipped`)

phase('Review')
const results = await pipeline(due, async (p) => {
  const r = await workflow('review', {
    target: p.number, depth: A.depth || 'standard', fix: !!A.fix && !p.draft, post: !!A.post && !p.draft,
    since: p.lastHead || undefined, round: p.lastRound + 1, posted: p.posted, models: A.models,
  })
  return Object.assign({ number: p.number, author: p.author, title: p.title, draft: p.draft }, r || { error: 'review returned nothing' })
})
const done = results.filter(Boolean)
const unchanged = c.prs.filter(p => due.indexOf(p) < 0)

phase('Record')
const rec = await agent(
  `Write two files and return their paths. No em-dashes, no arrows.\n` +
  `1. ${STATE}: JSON keyed by PR number. For each reviewed PR below set head, round, posted (its postedKeys), status, summary, tier. ` +
  `Keep the existing entries for these unchanged PRs: ${JSON.stringify(unchanged.map(p => p.number))}. Drop ${JSON.stringify(c.skippedMerged)}.\n` +
  `2. ~/.claude/harness/reports/review-sweep-${slug}-${c.today}.md: first line is a count, "${done.length} PR${done.length === 1 ? '' : 's'} reviewed, ${unchanged.length} unchanged, ${c.skippedBots.length} by bots skipped" for ${A.repo} on ${c.today}. ` +
  'Then one line per reviewed PR: number, author, summary, tier, human approvals, posted or not, report path; then PRs that need a person first; then the unchanged and skipped lists.\n\n' +
  `Reviewed:\n${JSON.stringify(done.map(r => ({ number: r.number, author: r.author, title: r.title, draft: r.draft, head: r.head, round: r.round, status: r.status,
    summary: r.summary, tier: r.tier, humanApprovals: r.humanApprovals, needsPerson: r.needsPerson, reconsider: r.reconsider,
    posted: r.posted, postedKeys: r.postedKeys, report: r.report, forPerson: (r.forPerson || []).length, error: r.error })), null, 1)}`,
  { label: 'record', schema: RECORDED, model: M.record, effort: 'low' })

return {
  repo: A.repo,
  reviewed: done.map(r => ({ number: r.number, status: r.status, summary: r.summary, tier: r.tier, posted: r.posted, report: r.report })),
  unchanged: unchanged.map(p => p.number),
  skippedBots: c.skippedBots,
  needsPerson: done.filter(r => r.needsPerson || (r.forPerson || []).length).map(r => r.number),
  state: rec && rec.statePath,
  digest: rec && rec.digestPath,
}
