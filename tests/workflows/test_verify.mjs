import { strict as assert } from 'node:assert'
import { run, byLabel, modelOf } from './stub.mjs'

const pass = { pass: true, command: 'make test', failures: [] }
const fail = { pass: false, command: 'make test', failures: [{ check: 'TestA', output: 'boom' }] }
const none = { findings: [] }

function responder({ gates, findings = {}, refute = () => false }) {
  let g = 0
  return ({ label, prompt }) => {
    if (label === 'scope') return { base: 'origin/main', gate: 'make test', criteria: ['c'] }
    if (label.startsWith('gate-')) return gates[Math.min(g++, gates.length - 1)]
    const lens = label.match(/^(correctness|acceptance|claims|conventions)-(\d+)$/)
    if (lens) return (findings[lens[1]] || (() => none))(Number(lens[2]))
    if (label.startsWith('skeptic-')) return { refuted: refute(prompt), reason: 'r' }
    if (label.startsWith('fix-')) return 'fixed'
    throw new Error('unexpected ' + label)
  }
}
const given = { task: 't', base: 'origin/main', gate: 'make test', criteria: ['c'] }

// 1. models per stage; no scope agent when base and gate are given
{
  const { result, calls } = await run('verify', given, responder({ gates: [pass] }))
  assert.equal(result.status, 'clean')
  assert.equal(byLabel(calls, /^scope$/).length, 0)
  assert.equal(modelOf(calls, 'gate-1'), 'haiku')
  assert.equal(modelOf(calls, 'correctness-1'), 'opus')
  assert.equal(modelOf(calls, 'acceptance-1'), 'opus')
  assert.equal(modelOf(calls, 'claims-1'), 'sonnet')
  assert.equal(modelOf(calls, 'conventions-1'), 'sonnet')
  console.log('ok   verify: models per stage, clean on the first round')
}

// 2. standalone run scopes first
{
  const { calls } = await run('verify', 'check my branch', responder({ gates: [pass] }))
  assert.equal(calls[0].label, 'scope')
  assert.equal(calls[0].opts.model, 'sonnet')
  console.log('ok   verify: standalone run scopes base and gate first')
}

// 3. a failure that survives a fix round escalates to opus
{
  const { result, calls } = await run('verify', given, responder({ gates: [fail, fail, pass] }))
  assert.equal(result.status, 'clean')
  const fixes = byLabel(calls, /^fix-/)
  assert.deepEqual(fixes.map(c => c.label), ['fix-1', 'fix-2-escalated'])
  assert.deepEqual(fixes.map(c => c.opts.model), ['sonnet', 'opus'])
  console.log('ok   verify: repeated failure escalates the fixer to opus')
}

// 4. refuted findings do not block; confirmed ones do
{
  const findings = { correctness: r => r === 1 ? { findings: [
    { file: 'a', line: 1, summary: 'real', scenario: 's', blocking: true, human: false },
    { file: 'b', line: 2, summary: 'false alarm', scenario: 's', blocking: true, human: false }] } : none }
  const { result, calls } = await run('verify', given,
    responder({ gates: [pass], findings, refute: p => /false alarm/.test(p) }))
  assert.equal(result.status, 'clean')
  assert.equal(byLabel(calls, /^fix-/).length, 1)
  assert.match(calls.find(c => c.label === 'fix-1').prompt, /real/)
  assert.doesNotMatch(calls.find(c => c.label === 'fix-1').prompt, /false alarm/)
  console.log('ok   verify: only skeptic-confirmed findings reach the fixer')
}

// 5. judgement calls go to a person, not a fixer; never converging -> needs-human
{
  const findings = { conventions: () => ({ findings: [
    { file: '.github/workflows/release.yml', line: 3, summary: 'token scope', scenario: 's', blocking: true, human: true }] }) }
  const { result, calls } = await run('verify', Object.assign({ maxRounds: 2 }, given),
    responder({ gates: [fail], findings }))
  assert.equal(result.status, 'needs-human')
  assert.equal(result.rounds, 2)
  assert.ok(result.forPerson.length >= 1)
  assert.doesNotMatch(calls.find(c => c.label.startsWith('fix-')).prompt, /token scope/)
  console.log('ok   verify: judgement calls escalated; stops at maxRounds')
}
