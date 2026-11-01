// Copied into an isolated consumer profile by smoke-package.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '@shengsheng/dsh-taskboard'
import { TYPERT } from '@shengsheng/dsh-taskboard/typert'
import remote from '@shengsheng/dsh-taskboard/remote'
import { runTaskboardCli } from '@shengsheng/dsh-taskboard/cli'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const ctx = new Context()
let cliOutput
const cliDiagnostics = []
assert.equal(runTaskboardCli(['project', 'list', '--database', ':memory:', '--attachment-root', resolve('cli-attachments')], {
  stdout: value => { cliOutput = JSON.parse(value) },
  stderr: value => { cliDiagnostics.push(value) },
}), 0)
assert.deepEqual(cliOutput.value, [])
const service = new plugin.TaskboardService(ctx, { databasePath: ':memory:', attachmentRoot: resolve('attachments') })
try {
  const result = service.dispatchHumanRpc('project.create', { request: { key: 'PKG', name: 'Installed package' } }, { kind: 'human', actorId: 'smoke' })
  assert.equal(result.ok, true)
  assert.equal(service.snapshot().projects[0].name, 'Installed package')
  for (const descriptors of [TYPERT.invocations, remote.descriptors]) {
    assert.equal(descriptors.length, 3)
    for (const descriptor of descriptors) {
      const codec = descriptor.result
      assert.equal(typeof codec.create, 'function')
      assert.equal(codec.schema, codec.create())
    }
  }
  const require = createRequire(import.meta.url)
  // Exercise the actual new Host Session shape, not a mock with the removed events field.
  const session = Session.create(SessionId('taskboard-smoke-session'))
  if (!('events' in session)) {
    const runtimeRequire = createRequire(require.resolve('@deepseek-ai/dsh-session'))
    const { SessionProjectionRegistry } = await import(runtimeRequire.resolve('@deepseek-ai/dsh-session-projection'))
    const { z } = await import(runtimeRequire.resolve('zod'))
    const registry = new SessionProjectionRegistry(ctx)
    const schema = z.array(z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) })).nullable()
    registry.register({
      key: 'todos', stateVersion: 1, stateSchema: schema, init: () => null,
      apply: (state, event) => event.type === 'todo/write' ? event.data.todos : state,
      wire: { viewSchema: schema, view: state => state },
    })
    const project = service.snapshot().projects[0]
    let task = service.provider.createTask({ projectId: project.id, title: 'Native todo projection', creator: 'smoke', status: 'todo' }, { kind: 'human', actorId: 'smoke' })
    task = service.provider.claim(task.id, { expectedVersion: task.version, sessionId: session.id, agentId: session.id }, {
      kind: 'agent', actorId: session.id, sessionId: session.id, agentId: session.id,
    }).task
    ctx.provide('agents', { get: () => ({ status: 'running', session }) })
    const todos = [{ content: 'Verify native progress', status: 'in_progress' }]
    session.append('todo/write', { todos })
    assert.deepEqual(service.taskDetail(task.id).sessionRuntime[0].todos, todos)
    console.log('Native Session todo projection smoke passed')
  }
  let registered
  vm.runInNewContext(readFileSync(require.resolve('@shengsheng/dsh-taskboard/client'), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { registered = value } } },
  })
  assert.equal(registered.id, '@shengsheng/dsh-taskboard')
  assert.equal(typeof registered.factory, 'function')
} finally {
  await ctx.fiber.dispose()
}
console.log('Installed Host, SQLite, legacy/factory codecs, and browser bundle smoke passed')
