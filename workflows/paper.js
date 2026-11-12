export const meta = {
  name: 'paper',
  description: 'Research plan for a paper in a git repo (topic analysis, story, contributions, evaluation plan, work packages), then parallel section drafts and reviewer-lens checks, on tiered models; ends with local commits',
  whenToUse: 'A paper or deliverable kept as LaTeX/Markdown in git. Args: string task, or {task, venue, main, gate, base, voice, maxContributions, maxRounds, stopAfterPlan, draftWithoutResults, models}. Stops at the plan while results are owed. Never pushes or submits.',
  phases: [
    { title: 'Recon', detail: 'three sonnet readers map the venue rules, the draft and the evidence' },
    { title: 'Analysis', detail: 'fable analyzes the topic: the problem, the state of the art, the gaps' },
    { title: 'Story', detail: 'mythos writes the thesis, the hypothesis, the scope and a short list of contributions' },
    { title: 'Evaluation', detail: 'mythos plans research questions, baselines, and micro and macro benchmarks per contribution' },
    { title: 'Critique', detail: 'opus reads all three as a PC member; major issues get one revision' },
    { title: 'Plan', detail: 'opus writes work packages, the checkpoint and the sequence for the evidence still owed' },
    { title: 'Outline', detail: 'opus turns the story and the evaluation plan into section tasks' },
    { title: 'Frame', detail: 'sonnet creates the branch, section files and shared macros' },
    { title: 'Draft', detail: 'sections in dependency waves, one worktree each, then integrate' },
    { title: 'Gate', detail: 'haiku builds the paper and reports errors' },
    { title: 'Review', detail: 'four reviewer lenses, each blocking finding checked by a skeptic' },
    { title: 'Fix', detail: 'sonnet fixes; opus takes over a finding that survives a round' },
    { title: 'Report', detail: 'haiku writes what is left for the author' },
  ],
}

const A = typeof args === 'string' ? { task: args } : (args || {})
if (!A.task) throw new Error('paper needs a task: pass args as a string or {task}')
const M = Object.assign({
  recon: 'sonnet', analysis: 'fable', story: 'claude-mythos-5-1', evaluation: 'claude-mythos-5-1',
  critic: 'opus', workplan: 'opus', outline: 'opus', frame: 'sonnet',
  argument: 'opus', prose: 'sonnet', chore: 'haiku', integrate: 'sonnet',
  gate: 'haiku', review: 'opus', lens: 'sonnet', skeptic: 'sonnet',
  fix: 'sonnet', escalate: 'opus', report: 'haiku',
}, A.models || {})
const MAX = A.maxRounds || 3
const MAXC = A.maxContributions || 4
const VOICE = A.voice === undefined ? 'ananos-academic' : A.voice

const HOLD = 'Stay local: do not push, open or edit PRs, post comments, submit anything, or run gh write commands. ' +
  'Commit with the repo conventions and the commit rules you were given; never --no-verify.'
// A writer that lacks a number or a reference must leave a marker. A person fills it in.
const HONEST = 'Never invent a number, a result, a quote or a reference. Every figure in the text must come from a file in this repo, ' +
  'and every \\cite key must exist in the bibliography. Where the evidence is missing, write a visible TODO marker ' +
  '(\\todo{...} if the preamble defines it, otherwise "TODO(author): ...") and list it in `missing`.'
const STYLE = VOICE
  ? `If a skill named \`${VOICE}\` is available, load it and follow it for all prose. `
  : ''

const RECON = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'string' }, description: 'facts with file paths' },
    files: { type: 'array', items: { type: 'string' } },
    commands: { type: 'array', items: { type: 'string' }, description: 'build commands that work' },
    rules: { type: 'array', items: { type: 'string' }, description: 'venue and repo rules: page limit, template, anonymity' },
  },
  required: ['findings', 'files'],
}
const ANALYSIS = {
  type: 'object',
  properties: {
    problem: { type: 'string', description: 'the problem, who has it and why it matters now' },
    stateOfTheArt: { type: 'array', items: { type: 'object', properties: {
      work: { type: 'string' }, cite: { type: 'string', description: 'bibliography key, or empty if the repo has none' },
      does: { type: 'string' }, lacks: { type: 'string' },
      verified: { type: 'boolean', description: 'true only if you read the work or its bibliography entry in this run' },
    }, required: ['work', 'does', 'lacks', 'verified'] } },
    gaps: { type: 'array', items: { type: 'string' }, description: 'what no prior work does, each tied to the works that come closest' },
    questions: { type: 'array', items: { type: 'string' }, description: 'only questions that block the work' },
  },
  required: ['problem', 'stateOfTheArt', 'gaps', 'questions'],
}
const STORY = {
  type: 'object',
  properties: {
    thesis: { type: 'string', description: 'the one claim the paper defends' },
    hypothesis: { type: 'string', description: 'what the evaluation must show for the thesis to hold, stated so a result can refute it' },
    scope: { type: 'object', properties: {
      in: { type: 'array', items: { type: 'string' } }, out: { type: 'array', items: { type: 'string' } },
    }, required: ['in', 'out'], description: 'the configuration the paper covers, and what it leaves to other work' },
    nonClaims: { type: 'array', items: { type: 'string' }, description: 'what the paper must not claim or imply' },
    fallback: { type: 'string', description: 'the narrower paper that remains if the main result fails' },
    decisiveFigure: { type: 'string', description: 'the one figure that carries the claim: axes, systems compared, conditions' },
    story: { type: 'array', items: { type: 'object', properties: {
      beat: { type: 'string', enum: ['problem', 'gap', 'insight', 'design', 'evidence', 'takeaway'] },
      says: { type: 'string' },
    }, required: ['beat', 'says'] }, description: 'the argument end to end, each beat following from the one before' },
    contributions: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string', description: 'short kebab id' }, claim: { type: 'string' },
      beyond: { type: 'string', description: 'the gap it closes and the prior work it goes past' },
    }, required: ['id', 'claim', 'beyond'] } },
    questions: { type: 'array', items: { type: 'string' }, description: 'only questions that block the work' },
  },
  required: ['thesis', 'hypothesis', 'scope', 'nonClaims', 'story', 'contributions', 'questions'],
}
const EVALPLAN = {
  type: 'object',
  properties: {
    questions: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string', description: 'RQ1, RQ2, ...' }, question: { type: 'string' },
      endpoint: { type: 'string', description: 'the primary measurement that answers it' },
      control: { type: 'string', description: 'the control or reference the answer needs' },
    }, required: ['id', 'question', 'endpoint', 'control'] } },
    configurations: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, role: { type: 'string', enum: ['baseline', 'candidate', 'ablation'] },
      question: { type: 'string', description: 'what comparing against it answers' },
    }, required: ['name', 'role', 'question'] } },
    benchmarks: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string', description: 'short kebab id' },
      contribution: { type: 'string', description: 'id of the contribution it proves' },
      rq: { type: 'string', description: 'id of the research question it answers' },
      gate: { type: 'string', description: 'the target that decides whether the claim stays, set before the result is seen' },
      kind: { type: 'string', enum: ['micro', 'macro'] },
      measures: { type: 'string' }, metric: { type: 'string' }, workload: { type: 'string' },
      baseline: { type: 'string', description: 'the prior system or configuration it is compared against' },
      expect: { type: 'string', description: 'the result that would prove the claim, and the one that would refute it' },
      status: { type: 'string', enum: ['have', 'to-run'] },
      evidence: { type: 'string', description: 'repo path of the results when status is have' },
    }, required: ['id', 'contribution', 'kind', 'measures', 'metric', 'baseline', 'expect', 'status'] } },
    threats: { type: 'array', items: { type: 'string' }, description: 'threats to validity' },
  },
  required: ['questions', 'configurations', 'benchmarks', 'threats'],
}
const WORKPLAN = {
  type: 'object',
  properties: {
    packages: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string', description: 'W01, W02, ...' }, title: { type: 'string' },
      owner: { type: 'string', description: 'a role, not a name' }, effort: { type: 'string' },
      dependsOn: { type: 'array', items: { type: 'string' } },
      addresses: { type: 'array', items: { type: 'string' }, description: 'contribution, question and benchmark ids' },
      steps: { type: 'array', items: { type: 'string' } },
      acceptance: { type: 'string', description: 'the evidence that closes the package' },
    }, required: ['id', 'title', 'owner', 'effort', 'dependsOn', 'addresses', 'steps', 'acceptance'] } },
    checkpoint: { type: 'object', properties: {
      when: { type: 'string' },
      outcomes: { type: 'array', items: { type: 'object', properties: {
        outcome: { type: 'string', enum: ['continue', 'narrow', 'defer'] },
        evidence: { type: 'string' }, decision: { type: 'string' },
      }, required: ['outcome', 'evidence', 'decision'] } },
    }, required: ['when', 'outcomes'] },
    sequence: { type: 'array', items: { type: 'object', properties: {
      period: { type: 'string' }, work: { type: 'string' }, exit: { type: 'string', description: 'the evidence that ends the period' },
    }, required: ['period', 'work', 'exit'] } },
    nonGoals: { type: 'array', items: { type: 'string' }, description: 'work this paper does not take on' },
    firstAssignment: { type: 'string' },
  },
  required: ['packages', 'checkpoint', 'sequence', 'firstAssignment'],
}
const CRITIQUE = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'revise'] },
    issues: { type: 'array', items: { type: 'object', properties: {
      stage: { type: 'string', enum: ['analysis', 'story', 'evaluation'] },
      severity: { type: 'string', enum: ['major', 'minor'] }, issue: { type: 'string' }, fix: { type: 'string' },
    }, required: ['stage', 'severity', 'issue', 'fix'] } },
  },
  required: ['verdict', 'issues'],
}
const SECTION = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'short kebab id' },
    title: { type: 'string' },
    tier: { type: 'string', enum: ['argument', 'prose', 'chore'] },
    files: { type: 'array', items: { type: 'string' }, description: 'files this task owns' },
    dependsOn: { type: 'array', items: { type: 'string' } },
    points: { type: 'array', items: { type: 'string' }, description: 'what the section must say, in order' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'repo paths, benchmark ids and cite keys the points rest on' },
    budget: { type: 'string', description: 'length target, e.g. "1.5 pages"' },
  },
  required: ['id', 'title', 'tier', 'files', 'dependsOn', 'points', 'evidence'],
}
const OUTLINE = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: 'kebab-case, used in branch names' },
    venue: { type: 'string' }, main: { type: 'string', description: 'the root source file' },
    base: { type: 'string' },
    gate: { type: 'string', description: 'one shell command that builds the paper and fails on errors' },
    terms: { type: 'array', items: { type: 'string' }, description: 'names and notation every section must use the same way' },
    sections: { type: 'array', items: SECTION },
    corrections: { type: 'array', items: { type: 'object', properties: {
      issue: { type: 'string', description: 'what the current text says or implies' }, revision: { type: 'string' },
    }, required: ['issue', 'revision'] }, description: 'claims in the existing text that the plan no longer supports' },
    risks: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' }, description: 'only questions that block the work' },
  },
  required: ['slug', 'main', 'base', 'gate', 'sections', 'questions'],
}
const FRAME = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, tip: { type: 'string', description: 'full sha of HEAD' },
    notes: { type: 'string' },
  },
  required: ['branch', 'tip'],
}
const DRAFT = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    commits: { type: 'array', items: { type: 'string' }, description: 'full shas, oldest first' },
    missing: { type: 'array', items: { type: 'string' }, description: 'evidence the text needs and the repo lacks' },
    notes: { type: 'string' },
  },
  required: ['done', 'commits', 'missing'],
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
const GATE = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' }, command: { type: 'string' },
    pages: { type: 'integer' },
    failures: { type: 'array', items: { type: 'object', properties: {
      check: { type: 'string' }, output: { type: 'string' },
    }, required: ['check', 'output'] } },
  },
  required: ['pass', 'command', 'failures'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      file: { type: 'string' }, line: { type: 'integer' }, summary: { type: 'string' },
      quote: { type: 'string', description: 'the sentence at fault, verbatim' },
      blocking: { type: 'boolean' },
      human: { type: 'boolean', description: 'needs the author: a new experiment, a missing result, a reference to check, a claim only they can back' },
    }, required: ['file', 'summary', 'quote', 'blocking', 'human'] } },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

// Returns the issues code can check: too many contributions, no baseline
// configuration, and a contribution without both a micro and a macro benchmark.
function unproven(story, evalPlan) {
  const out = []
  if (!evalPlan.configurations.some(c => c.role === 'baseline')) {
    out.push({ stage: 'evaluation', severity: 'major', issue: 'the evaluation has no baseline configuration',
      fix: 'add the simplest system that could explain away the result, under the same policy, data and budget' })
  }
  if (story.contributions.length > MAXC) {
    out.push({ stage: 'story', severity: 'major', fix: 'merge or drop the weakest',
      issue: `${story.contributions.length} contributions; the limit is ${MAXC}` })
  }
  story.contributions.forEach(c => ['micro', 'macro'].forEach(kind => {
    if (!evalPlan.benchmarks.some(b => b.contribution === c.id && b.kind === kind)) {
      out.push({ stage: 'evaluation', severity: 'major', issue: `contribution ${c.id} has no ${kind} benchmark`,
        fix: `add a ${kind} benchmark that proves it, or drop the contribution` })
    }
  }))
  return out
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
  { name: 'venue', prompt: 'the rules the paper must meet: the venue' + (A.venue ? ` (${A.venue})` : '') + ', its template and class file, page limit, anonymity, anything in AGENTS.md/CLAUDE.md/README, and the commit style from `git log -20`' },
  { name: 'draft', prompt: 'the text as it stands: the root file' + (A.main ? ` (${A.main})` : '') + ', every file it includes, what each section already argues, the terms and notation in use, TODO markers' },
  { name: 'evidence', prompt: 'what the text can rest on: the system the paper describes, result files, plots and the scripts that make them, the numbers they hold, the bibliography and its keys; and a build command that works now (run it)' },
]
const recon = (await parallel(LOOKS.map(l => () => agent(
  `Task: ${A.task}\n\nMap this for a planner: ${l.prompt}. Read, and run read-only commands. Do not change files. ` +
  'Report facts with file paths, not advice.',
  { label: `recon-${l.name}`, schema: RECON, model: M.recon })))).filter(Boolean)
const map = 'Repo map from three readers:\n' + JSON.stringify(recon, null, 1)

phase('Analysis')
const analysis = await agent(
  `Analyze the topic of this paper before anyone plans it.\n\nTask: ${A.task}\n\n${map}\n\n` +
  'State the problem, who has it and why it matters now. Then the state of the art: each relevant work, what it does and what it lacks. ' +
  'Start from the bibliography and the related work in the repo; search further if you have the tools. ' +
  'Set verified=false on any work you did not read in this run, and leave cite empty when the bibliography has no key for it. ' +
  'Then the gaps: what no prior work does. Say how close the nearest work comes to each, and name the simpler ' +
  'alternative most likely to explain away a result in each gap. Do not change files.',
  { label: 'analysis', schema: ANALYSIS, model: M.analysis, effort: 'high' })
if (!analysis) throw new Error('analysis returned nothing')

phase('Story')
const storyPrompt =
  `Write the story of this paper.\n\nTask: ${A.task}\n\nTopic analysis:\n${JSON.stringify(analysis, null, 1)}\n\n${map}\n\n` +
  'Rules:\n' +
  '- The thesis is one sentence a reader could disagree with.\n' +
  '- The hypothesis is what the evaluation must show for the thesis to hold. It is tested, and it does not go in the abstract before the result exists.\n' +
  '- scope names the one configuration the paper covers and what it leaves out. nonClaims lists what the text must not claim or imply.\n' +
  '- fallback is the narrower paper that remains if the main result fails. decisiveFigure is the one figure that carries the claim.\n' +
  '- Contributions are conditional on their evidence. A paper that proves two is better than one that claims three.\n' +
  '- The story runs end to end: problem, gap, insight, design, evidence, takeaway. Each beat follows from the one before. ' +
  'Cut a beat that does not serve the thesis.\n' +
  `- At most ${MAXC} contributions. Each one closes a gap from the analysis and names the prior work it goes past. ` +
  'Engineering effort and a restatement of the design are not contributions.\n' +
  '- Claim only what the system in this repo does. questions holds only what blocks the work.\n' +
  'Read the sources to check your assumptions. Do not change files.'
let story = await agent(storyPrompt, { label: 'story', schema: STORY, model: M.story, effort: 'high' })
if (!story) throw new Error('story returned nothing')

phase('Evaluation')
const evalPrompt = s =>
  `Plan the evaluation that proves each contribution of this paper.\n\nTask: ${A.task}\n\nThesis: ${s.thesis}\n` +
  `Contributions:\n${JSON.stringify(s.contributions, null, 1)}\n\n` +
  `State of the art:\n${JSON.stringify(analysis.stateOfTheArt, null, 1)}\n\n${map}\n\n` +
  `Hypothesis: ${s.hypothesis}\nScope:\n${JSON.stringify(s.scope, null, 1)}\n\n` +
  'Rules:\n' +
  '- Start from three to five research questions. Each has one primary endpoint and the control its answer needs.\n' +
  '- Name the configurations compared. One is the baseline most likely to explain away the result: the simplest system, ' +
  'given the same policy, data and resource budget. Each ablation removes one component and answers one question.\n' +
  '- Every contribution gets at least one micro benchmark and one macro benchmark, each tied to a research question.\n' +
  '- gate is the target that decides whether the claim stays. Set it before the result is seen. It is a decision gate for the authors, not a promise.\n' +
  '- Report negative cases and unsupported cases; an aggregate must not hide them.\n' +
  '- A micro benchmark isolates the mechanism: one operation or one path, against the closest baseline, with the cost broken down.\n' +
  '- A macro benchmark shows the end-to-end effect: a real application or a standard suite under a realistic load, ' +
  'against the systems a reader would use today.\n' +
  '- Each benchmark names its metric, workload and baseline, the result that would prove the claim and the one that would refute it.\n' +
  '- status is "have" only when the results are in the repo (give the path), otherwise "to-run".\n' +
  '- List the threats to validity.\n' +
  'Open the result files and scripts to check what exists. Do not change files.'
let evalPlan = await agent(evalPrompt(story), { label: 'evaluation', schema: EVALPLAN, model: M.evaluation, effort: 'high' })
if (!evalPlan) throw new Error('evaluation plan returned nothing')

phase('Critique')
const critique = await agent(
  'Read this as a skeptical program committee member, against the actual repo. Check that the analysis misses no close prior work, ' +
  'the story holds from problem to takeaway, the hypothesis can be refuted, each contribution goes past the state of the art, ' +
  'the baseline is the strongest simple alternative and gets the same inputs, and each benchmark would convince you ' +
  `of its contribution. Name the strongest reason to reject. Do not change files.\n\nTask: ${A.task}\n\n` +
  JSON.stringify({ analysis, story, evaluation: evalPlan }, null, 1),
  { label: 'critique', schema: CRITIQUE, model: M.critic, effort: 'high' })
const major = (critique ? critique.issues.filter(i => i.severity === 'major') : []).concat(unproven(story, evalPlan))
if (major.length) {
  log(`${major.length} major issues; revising once`)
  const issues = '\n\nA reviewer raised these issues; address every major one:\n' + JSON.stringify(major, null, 1)
  if (major.some(i => i.stage !== 'evaluation')) {
    const s = await agent(storyPrompt + '\n\nYour previous story:\n' + JSON.stringify(story, null, 1) + issues,
      { label: 'story-revise', schema: STORY, model: M.story, effort: 'high' })
    if (s) story = s
  }
  // The evaluation plan follows the contributions, so it is redone after any revision.
  const e = await agent(evalPrompt(story) + '\n\nYour previous plan:\n' + JSON.stringify(evalPlan, null, 1) + issues,
    { label: 'evaluation-revise', schema: EVALPLAN, model: M.evaluation, effort: 'high' })
  if (e) evalPlan = e
}
const gaps = unproven(story, evalPlan).map(i => i.issue)
const toRun = evalPlan.benchmarks.filter(b => b.status === 'to-run')

phase('Plan')
const work = await agent(
  `Plan the work this paper still needs, for the people who will do it.\n\nTask: ${A.task}\n\n` +
  JSON.stringify({ story, evaluation: evalPlan }, null, 1) + `\n\n${map}\n\n` +
  'Rules:\n' +
  '- One work package per piece of owed evidence or mechanism: every benchmark with status "to-run", every baseline that does not run yet, ' +
  'the reproducible configuration, the artifact, and the rewrite. Skip a package whose evidence is already in the repo.\n' +
  '- Each package has an owner role, an effort estimate, its dependencies, the ids it addresses, concrete steps, and an acceptance ' +
  'condition stated as evidence. A package that cannot meet it narrows the claim; say which claim.\n' +
  '- The checkpoint comes before the expensive work. It has three outcomes (continue, narrow to the fallback, defer), each with the evidence that selects it.\n' +
  '- sequence orders the packages along the critical path, each period ending in exit evidence. firstAssignment is what starts today.\n' +
  '- nonGoals lists the work this paper does not take on.\n' +
  '- Paths, commands and targets you propose are proposals. Mark them as such unless they exist in the repo.\n' +
  'Do not change files.',
  { label: 'workplan', schema: WORKPLAN, model: M.workplan, effort: 'high' })
if (!work) throw new Error('work plan returned nothing')

phase('Outline')
const plan = await agent(
  `Turn this story and evaluation plan into section tasks other agents can draft without asking questions.\n\nTask: ${A.task}\n\n` +
  JSON.stringify({ story, evaluation: evalPlan }, null, 1) + `\n\n${map}\n\n` +
  'Rules for the outline:\n' +
  '- One task per section file. Tasks that share a wave (no dependency between them) must own disjoint files.\n' +
  '- A section that summarizes others (abstract, introduction, conclusion) depends on them.\n' +
  '- Each task lists its points in order and the evidence for each: a repo path, a benchmark id or a cite key that exists today.\n' +
  '- The evaluation section is organized by research question and reports every benchmark of the plan, micro before macro.\n' +
  '- Give every section a page budget; the budgets add up to the venue limit. The first two pages carry the problem, the insight, ' +
  'the scope and the decisive figure.\n' +
  '- corrections lists each claim in the existing text that the plan no longer supports, with its revision.\n' +
  '- tier "argument" for sections that carry the claim (introduction, design, evaluation, discussion), ' +
  '"prose" for sections written against settled content (background, implementation, related work), ' +
  '"chore" for bibliography, captions, tables and formatting.\n' +
  '- terms lists the names and notation all sections share.\n' +
  '- The gate is one command that builds the paper today and fails on errors' + (A.gate ? ` (the caller set it to: ${A.gate})` : '') + '.\n' +
  '- Base is the upstream default branch' + (A.base ? ` (the caller set it to: ${A.base})` : ' (usually origin/main)') + '.\n' +
  'Do not change files.',
  { label: 'outline', schema: OUTLINE, model: M.outline })
if (!plan) throw new Error('outline returned nothing')

const dir = `$(git rev-parse --git-common-dir)/harness/${plan.slug}`
const planFile = await agent(
  `Write this research plan as Markdown to \`${dir}/plan.md\`, and the raw JSON next to it as plan.json. Numbered sections, in this order: ` +
  '1 recommendation (thesis, hypothesis, scope, what the paper must not claim, fallback); 2 topic analysis and state of the art; ' +
  '3 checkpoint (a table: outcome, evidence required, decision); 4 research questions (a table: question, primary endpoint, control); ' +
  '5 contributions, each with the prior work it goes past; 6 evaluation (a table of configurations, then benchmarks per contribution ' +
  'with kind, metric, baseline, gate and status); 7 work packages, one subsection each with owner, effort, dependencies, steps and acceptance; ' +
  '8 manuscript (decisive figure, a table of sections with page budgets, a table of corrections); 9 sequence (a table: period, work, exit evidence) ' +
  'and non-goals; 10 first assignment; then open questions. ' +
  'Create the directory. Change nothing else. Return the absolute path of plan.md only.\n\n' +
  JSON.stringify({ analysis, story, evaluation: evalPlan, work, outline: plan }, null, 1),
  { label: 'write-plan', model: M.chore, effort: 'low' })

const questions = analysis.questions.concat(story.questions, plan.questions, gaps)
const owed = toRun.length && !A.draftWithoutResults
if (questions.length || owed || A.stopAfterPlan) {
  return {
    status: questions.length ? 'needs-human' : owed ? 'evidence-owed' : 'planned',
    questions, toRun: toRun.map(b => b.id), firstAssignment: work.firstAssignment, plan: planFile, critique,
    next: questions.length ? 'Answer the questions (or edit plan.json) and rerun /paper with the answers in the task.'
      : owed ? 'Run the work packages for the benchmarks in toRun and commit the results, then rerun /paper. ' +
        'Pass {"draftWithoutResults": true} to draft now with TODO markers.'
        : 'Read the plan, then rerun /paper without stopAfterPlan.',
  }
}

phase('Frame')
const frame = await agent(
  `Outline:\n${JSON.stringify(plan, null, 1)}\n\n` +
  `Create branch \`harness/${plan.slug}\` from \`${plan.base}\` (if you are already on a feature branch for this task, stay on it). ` +
  `Make \`${plan.main}\` include every section file the outline names, creating the missing ones with a heading and nothing else. ` +
  'Add macros for the shared terms where the preamble has a place for them. Leave existing text alone. ' +
  `The paper must still build with \`${plan.gate}\`. Commit as one commit. ${HOLD} Return the branch and the full sha of HEAD.`,
  { label: 'frame', schema: FRAME, model: M.frame })
if (!frame) throw new Error('frame agent returned nothing')
let tip = frame.tip

phase('Draft')
const failed = []
const missing = toRun.map(b => ({ section: 'evaluation', missing: `benchmark ${b.id} (${b.kind}, proves ${b.contribution}) has no results yet` }))
const planWaves = waves(plan.sections)
for (let w = 0; w < planWaves.length; w++) {
  const wave = planWaves[w]
  const runTask = t => agent(
    'You are one of several agents drafting a paper in parallel. You work in your own git worktree.\n' +
    `First run \`git checkout -B harness/${plan.slug}/${t.id} ${tip}\` (that commit holds the frame and earlier waves).\n\n` +
    `Thesis: ${story.thesis}\nStory:\n${JSON.stringify(story.story, null, 1)}\n` +
    `Scope:\n${JSON.stringify(story.scope, null, 1)}\nThe text must not claim or imply:\n${JSON.stringify(story.nonClaims, null, 1)}\n` +
    `Corrections to the existing text:\n${JSON.stringify(plan.corrections || [], null, 1)}\n` +
    `Contributions:\n${JSON.stringify(story.contributions, null, 1)}\n` +
    `Evaluation plan:\n${JSON.stringify(evalPlan.benchmarks, null, 1)}\n` +
    `Shared terms:\n${JSON.stringify(plan.terms || [], null, 1)}\n\nYour section:\n${JSON.stringify(t, null, 1)}\n\n` +
    'Read the sections you depend on and the evidence files before you write. Touch only the files your task owns and report any extra file. ' +
    `${STYLE}${HONEST} Check that \`${plan.gate}\` still builds. Commit as one logical commit. ${HOLD} ` +
    'Return done, the full commit shas and what is missing.',
    { phase: 'Draft', label: `section-${t.id}`, schema: DRAFT, model: M[t.tier] || M.prose, isolation: 'worktree' })

  let results = []
  if (wave.serial) {
    for (const t of wave.tasks) results.push(await runTask(t))
  } else {
    results = await parallel(wave.tasks.map(t => () => runTask(t)))
  }
  const ready = []
  wave.tasks.forEach((t, i) => {
    const r = results[i]
    if (r) r.missing.forEach(m => missing.push({ section: t.id, missing: m }))
    if (r && r.done && r.commits.length) ready.push({ id: t.id, commits: r.commits })
    else failed.push({ id: t.id, reason: (r && r.notes) || 'agent returned nothing' })
  })
  if (!ready.length) { log(`wave ${w + 1}: nothing to integrate`); continue }

  const integ = await agent(
    `On branch \`${frame.branch}\` in the main checkout (HEAD should be ${tip}), cherry-pick these section commits in order:\n` +
    JSON.stringify(ready, null, 1) + '\n' +
    'Resolve conflicts by keeping both sections\' text. Then run `' + plan.gate + '`. ' +
    'If integration broke the build (a duplicate label, a macro defined twice), fix it in a separate commit. ' +
    `${HOLD} Return the new HEAD sha, the integrated ids, the ids you could not integrate with the reason, and whether the gate passed.`,
    { phase: 'Draft', label: `integrate-${w + 1}`, schema: INTEGRATED, model: M.integrate })
  if (!integ) throw new Error(`integration of wave ${w + 1} returned nothing`)
  tip = integ.tip
  integ.failed.forEach(f => failed.push(f))
  log(`wave ${w + 1}/${planWaves.length}: ${integ.integrated.length} integrated, gate ${integ.gatePass ? 'pass' : 'FAIL'}`)
}

const brief = `Task: ${A.task}\n\nThesis: ${story.thesis}\n\nStory:\n` + story.story.map(b => `- ${b.beat}: ${b.says}`).join('\n') +
  '\n\nContributions, each with the benchmarks that must prove it:\n' +
  story.contributions.map(c => `- ${c.id}: ${c.claim} (beyond: ${c.beyond}); ` +
    evalPlan.benchmarks.filter(b => b.contribution === c.id).map(b => `${b.kind} ${b.id}`).join(', ')).join('\n') +
  '\n\nConfigurations compared: ' + evalPlan.configurations.map(c => `${c.name} (${c.role})`).join(', ') +
  '\n\nThe text must not claim or imply:\n' + story.nonClaims.map(c => `- ${c}`).join('\n') +
  (failed.length ? '\n\nThese sections did not land and are still owed: ' + JSON.stringify(failed) : '')

const LENSES = [
  { name: 'story', model: M.review, prompt: 'read as a program committee member, start to end. Does each section advance the thesis, and does the text follow the story beats in order? Is each contribution stated the same way in the abstract, introduction and conclusion, set against the prior work it goes past, and proven in the evaluation by its micro and its macro benchmark? Can a reader name the contribution and its limits from the first two pages? Report each break in the argument, each unsupported or overstated claim, each sentence that states or implies a listed non-claim, and the strongest reason to reject.' },
  { name: 'evidence', model: M.review, prompt: 'trace every number, comparison and factual statement to a file in the repo (data, plot, script) or a citation. A figure in the text that differs from the data, or has no source, is a blocking finding. A benchmark without its baseline, metric or workload stated is one too, and so is a number that does not name the configuration it was measured on, or a headline that mixes configurations. Open the data files and compare.' },
  { name: 'citations', model: M.lens, prompt: 'every \\cite key exists in the bibliography, every entry is cited, and each sentence claims no more about a cited work than its bibliography entry supports. A reference that someone must look up is human=true; never propose a reference you cannot find in the repo.' },
  { name: 'style', model: M.lens, prompt: 'venue rules (page limit, template, anonymity), one name per concept across sections, undefined terms and acronyms, dangling \\ref, leftover TODO markers' + (VOICE ? `, and the rules of the \`${VOICE}\` skill if it is available` : '') + '.' },
]

let round = 0
let last = null
let prevKeys = []
const escalate = []
while (round < MAX) {
  round++
  const gate = await agent(
    `Run \`${plan.gate}\` from the repo root and report the result. Do not change files. ` +
    'Report each error, undefined reference or citation and the page count. A page count over the venue limit is a failure.',
    { phase: 'Gate', label: `gate-${round}`, schema: GATE, model: M.gate, effort: 'low' })

  const reviews = await parallel(LENSES.map(l => () => agent(
    `${brief}\n\nReview the paper rooted at \`${plan.main}\` (changes: \`git diff ${plan.base}...HEAD\`) through one lens: ` +
    `${l.name}: ${l.prompt}\nReport only findings tied to a file and a quoted sentence. blocking=true only for defects a reviewer ` +
    'would hold against the paper. Do not change files.',
    { phase: 'Review', label: `${l.name}-${round}`, schema: FINDINGS, model: l.model })))
  const all = reviews.filter(Boolean).flatMap(r => r.findings)
  all.filter(f => f.human).forEach(f => escalate.push(f))
  const blocking = all.filter(f => f.blocking && !f.human)

  const checked = await parallel(blocking.map((f, i) => () => agent(
    'A reviewer claims this defect in the paper:\n' +
    `${f.file}:${f.line || '?'}: ${f.summary}\nSentence: ${f.quote}\n\n` +
    'Try to refute it by reading the text and the evidence it cites. Set refuted=true unless you confirmed the defect. Do not change files.',
    { phase: 'Review', label: `skeptic-${round}-${i}`, schema: VERDICT, model: M.skeptic, effort: 'medium' })
    .then(v => (v && !v.refuted ? Object.assign({}, f, { note: v.reason }) : null))))
  const confirmed = checked.filter(Boolean)
  last = { round, gate, confirmed }
  log(`round ${round}: gate ${gate && gate.pass ? 'pass' : 'FAIL'}, ${confirmed.length} confirmed of ${blocking.length}, ${escalate.length} for the author`)

  if (gate && gate.pass && confirmed.length === 0) break
  if (round === MAX) break

  const keys = ((gate && gate.failures) || []).map(f => 'gate:' + f.check)
    .concat(confirmed.map(f => f.file + ':' + f.summary))
  const repeat = keys.some(k => prevKeys.indexOf(k) >= 0)
  prevKeys = keys
  await agent(
    `${brief}\n\nFix the following in the text, one commit per finding. Change the claim to match the evidence, never the reverse. ` +
    `${STYLE}${HONEST} Re-run \`${plan.gate}\` before you finish. ${HOLD}\n\n` +
    'Gate failures:\n' + JSON.stringify((gate && gate.failures) || [], null, 1) +
    '\n\nConfirmed findings:\n' + JSON.stringify(confirmed, null, 1),
    { phase: 'Fix', label: `fix-${round}${repeat ? '-escalated' : ''}`, model: repeat ? M.escalate : M.fix })
}

const clean = !!(last && last.gate && last.gate.pass && last.confirmed.length === 0)
const left = { failed, missing, unresolved: last ? last.confirmed : [], forAuthor: escalate }
const ready = clean && !failed.length && !missing.length && !escalate.length

phase('Report')
const report = await agent(
  `Write this as Markdown to \`${dir}/REPORT.md\`. The first line is a count of what is left for the author, or says plainly that ` +
  'nothing is. Then one section each for sections that did not land, missing evidence (benchmarks to run first), unresolved findings ' +
  `and findings for the author, with file and line. Remove every \`git worktree list\` entry on a \`harness/${plan.slug}/*\` branch, ` +
  'then those branches. Change nothing else. Return the absolute path of REPORT.md only.\n\n' + JSON.stringify(left, null, 1),
  { label: 'report', model: M.report, effort: 'low' })

return Object.assign({
  status: ready ? 'ready-for-author' : 'needs-human',
  branch: frame.branch,
  rounds: round,
  pages: last && last.gate && last.gate.pages,
  plan: planFile,
  report,
  next: ready ? 'Read the branch. Submitting stays with you.'
    : 'Read the report: run the benchmarks that have no results, fill in the missing evidence and decide the findings marked for the author, then rerun /paper.',
}, left)
