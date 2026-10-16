// Runs a workflow script with stubbed hooks and records every agent call.
import { readFileSync } from 'node:fs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

export function load(name) {
  const src = readFileSync(new URL(`../../workflows/${name}.js`, import.meta.url), 'utf8')
    .replace(/^export const meta/m, 'const meta')
  return new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', src)
}

// respond(call) returns the agent's result; call = {label, prompt, opts}.
export function run(name, args, respond, children = {}) {
  const calls = []
  const workflows = []
  const agent = async (prompt, opts = {}) => {
    const call = { label: opts.label || opts.phase || 'agent', prompt, opts }
    calls.push(call)
    return respond(call)
  }
  const parallel = thunks => Promise.all(thunks.map(t => t().catch(() => null)))
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let r = item
    for (const s of stages) {
      try { r = await s(r, item, i) } catch (e) { return null }
    }
    return r
  }))
  const workflow = async (n, a) => {
    workflows.push({ name: n, args: a })
    if (!children[n]) throw new Error(`unknown workflow ${n}`)
    return children[n](a)
  }
  const body = load(name)
  return body(args, agent, parallel, pipeline, () => {}, () => {}, workflow)
    .then(result => ({ result, calls, workflows }))
}

export const byLabel = (calls, re) => calls.filter(c => re.test(c.label))
export const modelOf = (calls, label) => (calls.find(c => c.label === label) || {}).opts?.model
