import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const sec = (id, tier, dependsOn = []) => ({
  id, title: id, tier, files: [`sec/${id}.tex`], dependsOn, points: ['p'], evidence: ['results/a.csv'],
})
const bench = (id, contribution, kind, status = 'have') => ({
  id, contribution, kind, measures: 'm', metric: 'ms', workload: 'w', baseline: 'virtio', expect: 'e', status,
  evidence: status === 'have' ? `results/${id}.csv` : '',
})
const analysis = {
  problem: 'p', questions: [], gaps: ['no credit accounting'],
  stateOfTheArt: [{ work: 'virtio-vsock', cite: 'vsock19', does: 'd', lacks: 'l', verified: true }],
}
const contrib = id => ({ id, claim: `claim ${id}`, beyond: 'virtio-vsock' })
const story = (over = {}) => Object.assign({
  thesis: 't', hypothesis: 'h', scope: { in: ['KVM on x86-64'], out: ['other VMMs'] },
  nonClaims: ['zero overhead'], questions: [], contributions: [contrib('c1')],
  story: [{ beat: 'problem', says: 's' }, { beat: 'takeaway', says: 's' }],
}, over)
const SIMPLE = { name: 'SIMPLE', role: 'baseline', question: 'does plain virtio already suffice?' }
const FULL = { name: 'FULL', role: 'candidate', question: 'q' }
const evaluation = (benchmarks = [bench('copy-path', 'c1', 'micro'), bench('nginx', 'c1', 'macro')],
  configurations = [SIMPLE, FULL]) => ({
  questions: [{ id: 'RQ1', question: 'q', endpoint: 'e', control: 'c' }], configurations, benchmarks, threats: ['one host'],
})
const workplan = {
  packages: [{ id: 'W01', title: 'run nginx', owner: 'evaluation lead', effort: '2 days', dependsOn: [],
    addresses: ['nginx'], steps: ['s'], acceptance: 'results in the repo' }],
  checkpoint: { when: 'week 2', outcomes: [{ outcome: 'narrow', evidence: 'e', decision: 'd' }] },
  sequence: [{ period: 'days 1-2', work: 'W01', exit: 'baseline runs' }], firstAssignment: 'start W01',
}
const outline = (over = {}) => Object.assign({
  slug: 'vsock', main: 'main.tex', base: 'origin/main', gate: 'latexmk -pdf main.tex', terms: ['guest'], questions: [],
  sections: [sec('eval', 'argument'), sec('background', 'prose'), sec('bib', 'chore'), sec('intro', 'argument', ['eval'])],
}, over)
const pass = { pass: true, command: 'latexmk', pages: 12, failures: [] }
const fail = { pass: false, command: 'latexmk', failures: [{ check: 'undefined ref', output: 'fig:x' }] }
const none = { findings: [] }

// stories and evals are consumed in order: first call, then the revision.
function responder({ stories = [story()], evals = [evaluation()], plan = outline(),
  critique = { verdict: 'ok', issues: [] }, gates = [pass], findings = {}, refute = () => false,
  draft = () => ({ done: true, commits: ['abc'], missing: [] }) } = {}) {
  let g = 0
  return ({ label, prompt }) => {
    if (label.startsWith('recon-')) return { findings: ['f'], files: ['main.tex'] }
    if (label === 'analysis') return analysis
    if (label === 'story') return stories[0]
    if (label === 'story-revise') return stories[stories.length - 1]
    if (label === 'evaluation') return evals[0]
    if (label === 'evaluation-revise') return evals[evals.length - 1]
    if (label === 'critique') return critique
    if (label === 'workplan') return workplan
    if (label === 'outline') return plan
    if (label === 'write-plan') return '/repo/.git/harness/vsock/plan.md'
    if (label === 'frame') return { branch: 'harness/vsock', tip: 'f00' }
    if (label.startsWith('section-')) return draft(label.slice(8))
    if (label.startsWith('integrate-')) {
      const ids = [...prompt.matchAll(/"id": "([\w-]+)"/g)].map(m => m[1])
      return { tip: 't' + label.slice(10), integrated: ids, failed: [], gatePass: true }
    }
    if (label.startsWith('gate-')) return gates[Math.min(g++, gates.length - 1)]
    const lens = label.match(/^(story|evidence|citations|style)-(\d+)$/)
    if (lens) return (findings[lens[1]] || (() => none))(Number(lens[2]))
    if (label.startsWith('skeptic-')) return { refuted: refute(prompt), reason: 'r' }
    if (label.startsWith('fix-')) return 'fixed'
    if (label === 'report') return '/repo/.git/harness/vsock/REPORT.md'
    throw new Error('unexpected ' + label)
  }
}

// 1. stage order and models on a clean run
{
  const { result, calls } = await run('paper', 'write the vsock paper', responder())
  assert.equal(result.status, 'ready-for-author')
  assert.equal(result.pages, 12)
  assert.deepEqual(calls.slice(3, 10).map(c => c.label),
    ['analysis', 'story', 'evaluation', 'critique', 'workplan', 'outline', 'write-plan'])
  for (const l of ['venue', 'draft', 'evidence']) assert.equal(modelOf(calls, `recon-${l}`), 'sonnet')
  assert.equal(modelOf(calls, 'analysis'), 'fable')
  assert.equal(modelOf(calls, 'story'), 'claude-mythos-5-1')
  assert.equal(modelOf(calls, 'evaluation'), 'claude-mythos-5-1')
  assert.equal(modelOf(calls, 'critique'), 'opus')
  assert.equal(modelOf(calls, 'workplan'), 'opus')
  assert.equal(modelOf(calls, 'outline'), 'opus')
  assert.equal(modelOf(calls, 'write-plan'), 'haiku')
  assert.equal(modelOf(calls, 'frame'), 'sonnet')
  assert.equal(modelOf(calls, 'section-eval'), 'opus')
  assert.equal(modelOf(calls, 'section-background'), 'sonnet')
  assert.equal(modelOf(calls, 'section-bib'), 'haiku')
  assert.equal(modelOf(calls, 'integrate-1'), 'sonnet')
  assert.equal(modelOf(calls, 'gate-1'), 'haiku')
  assert.equal(modelOf(calls, 'story-1'), 'opus')
  assert.equal(modelOf(calls, 'evidence-1'), 'opus')
  assert.equal(modelOf(calls, 'citations-1'), 'sonnet')
  assert.equal(modelOf(calls, 'style-1'), 'sonnet')
  assert.equal(modelOf(calls, 'report'), 'haiku')
  assert.equal(byLabel(calls, /-revise$|^fix-/).length, 0)
  console.log('ok   paper: analysis, story, evaluation, critique, plan, outline; models per stage')
}

// 2. each planning stage is given the one before it
{
  const { calls } = await run('paper', 't', responder())
  const prompt = l => calls.find(c => c.label === l).prompt
  assert.match(prompt('story'), /no credit accounting/)
  assert.match(prompt('evaluation'), /claim c1/)
  assert.match(prompt('evaluation'), /at least one micro benchmark and one macro benchmark/)
  assert.match(prompt('evaluation'), /Hypothesis: h/)
  assert.match(prompt('workplan'), /does plain virtio already suffice/)
  assert.match(prompt('outline'), /copy-path/)
  assert.match(prompt('write-plan'), /start W01/)
  assert.match(prompt('section-eval'), /copy-path/)
  assert.match(prompt('section-eval'), /must not claim or imply:[^]*zero overhead/)
  assert.match(prompt('story-1'), /c1: claim c1 \(beyond: virtio-vsock\); micro copy-path, macro nginx/)
  assert.match(prompt('story-1'), /SIMPLE \(baseline\), FULL \(candidate\)/)
  assert.match(prompt('story-1'), /- zero overhead/)
  console.log('ok   paper: each planning stage feeds the next; non-claims reach writers and reviewers')
}

// 3. sections draft in dependency waves, each in a worktree from the wave's tip
{
  const { calls } = await run('paper', 't', responder())
  const order = calls.map(c => c.label).filter(l => /^(section|integrate)-/.test(l))
  assert.deepEqual(order.slice(0, 3).sort(), ['section-background', 'section-bib', 'section-eval'])
  assert.deepEqual(order.slice(3), ['integrate-1', 'section-intro', 'integrate-2'])
  byLabel(calls, /^section-/).forEach(c => assert.equal(c.opts.isolation, 'worktree'))
  assert.match(calls.find(c => c.label === 'section-eval').prompt, /checkout -B harness\/vsock\/eval f00/)
  assert.match(calls.find(c => c.label === 'section-intro').prompt, /checkout -B harness\/vsock\/intro t1/)
  console.log('ok   paper: dependency waves, worktree per section')
}

// 4. critique: a story issue revises story and evaluation; an evaluation issue only the plan; minor ones nothing
{
  const issue = (stage, severity) => ({ verdict: 'revise', issues: [{ stage, severity, issue: 'i', fix: 'f' }] })
  const labels = r => byLabel(r.calls, /-revise$/).map(c => c.label)
  assert.deepEqual(labels(await run('paper', 't', responder({ critique: issue('story', 'major') }))),
    ['story-revise', 'evaluation-revise'])
  assert.deepEqual(labels(await run('paper', 't', responder({ critique: issue('analysis', 'major') }))),
    ['story-revise', 'evaluation-revise'])
  assert.deepEqual(labels(await run('paper', 't', responder({ critique: issue('evaluation', 'major') }))),
    ['evaluation-revise'])
  assert.deepEqual(labels(await run('paper', 't', responder({ critique: issue('story', 'minor') }))), [])
  console.log('ok   paper: major critique revises the affected stages once')
}

// 5. a contribution without a micro and a macro benchmark forces a revision, then stops the run
{
  const microOnly = evaluation([bench('copy-path', 'c1', 'micro')])
  const fixed = await run('paper', 't', responder({ evals: [microOnly, evaluation()] }))
  assert.deepEqual(byLabel(fixed.calls, /-revise$/).map(c => c.label), ['evaluation-revise'])
  assert.match(fixed.calls.find(c => c.label === 'evaluation-revise').prompt, /contribution c1 has no macro benchmark/)
  assert.equal(fixed.result.status, 'ready-for-author')

  const stuck = await run('paper', 't', responder({ evals: [microOnly] }))
  assert.equal(stuck.result.status, 'needs-human')
  assert.deepEqual(stuck.result.questions, ['contribution c1 has no macro benchmark'])
  assert.equal(byLabel(stuck.calls, /^(frame|section-|gate-)/).length, 0)

  const noBase = evaluation(undefined, [FULL])
  const b = await run('paper', 't', responder({ evals: [noBase, evaluation()] }))
  assert.match(b.calls.find(c => c.label === 'evaluation-revise').prompt, /no baseline configuration/)
  console.log('ok   paper: every contribution needs a micro and a macro benchmark; the evaluation needs a baseline')
}

// 6. the contribution list stays short
{
  const five = story({ contributions: ['a', 'b', 'c', 'd', 'e'].map(contrib) })
  const { calls } = await run('paper', 't', responder({ stories: [five, story()] }))
  assert.match(calls.find(c => c.label === 'story-revise').prompt, /5 contributions; the limit is 4/)
  const two = story({ contributions: ['a', 'b'].map(contrib) })
  const b = await run('paper', { task: 't', maxContributions: 1 }, responder({ stories: [two, story()] }))
  assert.match(b.calls.find(c => c.label === 'story-revise').prompt, /2 contributions; the limit is 1/)
  console.log('ok   paper: more contributions than the limit forces a revision')
}

// 7. blocking questions and stopAfterPlan stop before anything is written
{
  const q = await run('paper', 't', responder({ stories: [story({ questions: ['which baseline?'] })] }))
  assert.equal(q.result.status, 'needs-human')
  assert.deepEqual(q.result.questions, ['which baseline?'])
  const s = await run('paper', { task: 't', stopAfterPlan: true }, responder())
  assert.equal(s.result.status, 'planned')
  assert.equal(s.result.plan, '/repo/.git/harness/vsock/plan.md')
  // results still owed: the run ends with the plan and the first assignment
  const evals = [evaluation([bench('copy-path', 'c1', 'micro'), bench('nginx', 'c1', 'macro', 'to-run')])]
  const o = await run('paper', 't', responder({ evals }))
  assert.equal(o.result.status, 'evidence-owed')
  assert.deepEqual(o.result.toRun, ['nginx'])
  assert.equal(o.result.firstAssignment, 'start W01')
  for (const r of [q, s, o]) assert.equal(byLabel(r.calls, /^(frame|section-|gate-)/).length, 0)
  console.log('ok   paper: questions, owed results and stopAfterPlan stop at the plan')
}

// 8. writers are told not to invent; a benchmark to run and missing evidence block ready-for-author
{
  const evals = [evaluation([bench('copy-path', 'c1', 'micro'), bench('nginx', 'c1', 'macro', 'to-run')])]
  const draft = id => ({ done: true, commits: ['abc'], missing: id === 'eval' ? ['p99 latency for the baseline'] : [] })
  const { result, calls } = await run('paper', { task: 't', draftWithoutResults: true }, responder({ evals, draft }))
  assert.equal(result.status, 'needs-human')
  assert.deepEqual(result.missing, [
    { section: 'evaluation', missing: 'benchmark nginx (macro, proves c1) has no results yet' },
    { section: 'eval', missing: 'p99 latency for the baseline' }])
  byLabel(calls, /^section-/).forEach(c => assert.match(c.prompt, /Never invent a number/))
  assert.match(calls.find(c => c.label === 'report').prompt, /p99 latency/)
  console.log('ok   paper: missing results are reported, not written around')
}

// 9. only skeptic-confirmed findings reach the fixer; author calls never do
{
  const findings = {
    evidence: r => r === 1 ? { findings: [
      { file: 'sec/eval.tex', line: 4, summary: 'text says 3x, data says 2.1x', quote: 'q', blocking: true, human: false },
      { file: 'sec/eval.tex', line: 9, summary: 'false alarm', quote: 'q', blocking: true, human: false }] } : none,
    citations: r => r === 1 ? { findings: [
      { file: 'sec/intro.tex', line: 2, summary: 'check what smith24 measured', quote: 'q', blocking: true, human: true }] } : none,
  }
  const { result, calls } = await run('paper', 't',
    responder({ findings, refute: p => /false alarm/.test(p) }))
  const fixes = byLabel(calls, /^fix-/)
  assert.equal(fixes.length, 1)
  assert.match(fixes[0].prompt, /data says 2\.1x/)
  assert.doesNotMatch(fixes[0].prompt, /false alarm|smith24/)
  assert.equal(result.status, 'needs-human')
  assert.equal(result.forAuthor.length, 1)
  assert.equal(result.unresolved.length, 0)
  console.log('ok   paper: skeptic filters findings; author calls are escalated')
}

// 10. a failure that survives a fix round escalates; the loop stops at maxRounds
{
  const a = await run('paper', 't', responder({ gates: [fail, fail, pass] }))
  const fixes = byLabel(a.calls, /^fix-/)
  assert.deepEqual(fixes.map(c => c.label), ['fix-1', 'fix-2-escalated'])
  assert.deepEqual(fixes.map(c => c.opts.model), ['sonnet', 'opus'])
  assert.equal(a.result.status, 'ready-for-author')
  const b = await run('paper', { task: 't', maxRounds: 2 }, responder({ gates: [fail] }))
  assert.equal(b.result.status, 'needs-human')
  assert.equal(b.result.rounds, 2)
  console.log('ok   paper: repeated failure escalates the fixer; stops at maxRounds')
}

// 11. args: models override, voice skill on by default and off with null
{
  const a = await run('paper', { task: 't', models: { argument: 'sonnet', analysis: 'opus' } }, responder())
  assert.equal(modelOf(a.calls, 'section-eval'), 'sonnet')
  assert.equal(modelOf(a.calls, 'analysis'), 'opus')
  assert.match(a.calls.find(c => c.label === 'section-eval').prompt, /ananos-academic/)
  const b = await run('paper', { task: 't', voice: null }, responder())
  assert.doesNotMatch(b.calls.find(c => c.label === 'section-eval').prompt, /ananos-academic/)
  await assert.rejects(run('paper', {}, responder()), /needs a task/)
  console.log('ok   paper: models and voice overrides; a task is required')
}
