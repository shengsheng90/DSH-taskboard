import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TaskboardService } from '../src/service/index.js'

const config = {
  databasePath: ':memory:',
  attachmentRoot: '.dsh/test-attachments',
}

test('service exposes one authoritative snapshot and loopback human intents', () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, config)
  try {
    const projectResult = service.dispatchHumanRpc('project.create', {
      request: { key: 'DSH', name: 'Harness' },
    }, { kind: 'human', actorId: 'test-human' })
    assert.equal(projectResult.ok, true)
    if (!projectResult.ok) return
    const project = projectResult.value as { id: string }

    const taskResult = service.dispatchHumanRpc('task.create', {
      request: { projectId: project.id, title: 'Native page', creator: 'test-human' },
    }, { kind: 'human', actorId: 'test-human' })
    assert.equal(taskResult.ok, true)

    const snapshot = service.snapshot(project.id as never)
    assert.equal(snapshot.schemaVersion, 1)
    assert.equal(snapshot.projects.length, 1)
    assert.equal(snapshot.tasks[0]?.identifier, 'DSH-1')
    assert.equal(snapshot.globalRevision, 2)
  } finally {
    service.provider.close()
  }
})

test('service long-poll wakes only for committed revisions and times out boundedly', async () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, config)
  try {
    const initial = service.provider.globalRevision()
    const waiting = service.watchChanges(initial, 1_000)
    const secondClient = service.watchChanges(initial, 1_000)
    service.provider.createProject({ key: 'DSH', name: 'Harness' }, { kind: 'human', actorId: 'human' })
    assert.deepEqual(await waiting, { globalRevision: initial + 1, changed: true })
    assert.deepEqual(await secondClient, { globalRevision: initial + 1, changed: true })
    assert.deepEqual(await service.watchChanges(initial + 1, 5), {
      globalRevision: initial + 1,
      changed: false,
    })
    const project = service.provider.listProjects()[0]!
    const task = service.provider.createTask({ projectId: project.id, title: 'No rollback event', creator: 'human' }, { kind: 'human', actorId: 'human' })
    const afterTask = service.provider.globalRevision()
    const rollbackWait = service.watchChanges(afterTask, 5)
    assert.throws(
      () => service.provider.updateTask(task.id, task.version + 1, { title: 'Stale' }, { kind: 'human', actorId: 'human' }),
      /version is stale/,
    )
    assert.deepEqual(await rollbackWait, { globalRevision: afterTask, changed: false })

    const carried = await service.remoteMutate({
      endpoint: 'changes.watch',
      payloadJson: JSON.stringify({ afterRevision: initial, timeoutMs: 1_000 }),
    })
    assert.equal(carried.ok, true)
    assert.deepEqual(JSON.parse(carried.valueJson ?? 'null'), {
      globalRevision: afterTask,
      changed: true,
    })
  } finally {
    service.provider.close()
  }
})

test('service unload settles pending change watches before closing SQLite', async () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, { ...config, maxChangeWaiters: 1 })
  const revision = service.provider.globalRevision()
  const waiting = service.watchChanges(revision, 30_000)
  assert.throws(
    () => service.watchChanges(revision, 30_000),
    /too many concurrent Taskboard change watches/,
  )
  await ctx.fiber.dispose()
  assert.deepEqual(await waiting, { globalRevision: revision, changed: false })
})

test('human lifecycle RPC can establish a fresh direct rework claim', () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, config)
  const human = { kind: 'human', actorId: 'human' } as const
  const agent = { kind: 'agent', actorId: 'agent-1', sessionId: 'session-1', agentId: 'agent-1' } as const
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    let task = service.provider.createTask({ projectId: project.id, title: 'Rework', creator: 'human', status: 'todo' }, human)
    task = service.provider.claim(task.id, {
      expectedVersion: task.version, sessionId: agent.sessionId, agentId: agent.agentId,
    }, agent).task
    task = service.provider.submitReview(task.id, task.version, 'verified', 'first pass', agent)
    const result = service.dispatchHumanRpc('task.return', {
      taskId: task.id,
      expectedVersion: task.version,
      target: 'in_progress',
      comment: 'Continue in the selected Session',
      freshClaim: { sessionId: 'session-2', agentId: 'agent-2' },
    }, human)
    assert.equal(result.ok, true)
    assert.equal(service.provider.getTask(task.id).status, 'in_progress')
    assert.equal(service.provider.getTaskDetail(task.id).activeClaim?.sessionId, 'session-2')
  } finally {
    service.provider.close()
  }
})

test('RPC returns stable domain codes without throwing transport failures', () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, config)
  try {
    const result = service.dispatchHumanRpc('task.accept', {
      taskId: 'missing', expectedVersion: 1,
    }, { kind: 'human', actorId: 'test-human' })
    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'internal',
        message: 'TASK_NOT_FOUND: task missing was not found',
        details: {},
      },
    })
  } finally {
    service.provider.close()
  }
})

test('task detail projects live Agent status and durable todo progress without changing SQLite authority', () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, config)
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, { kind: 'human', actorId: 'human' })
    let task = service.provider.createTask({ projectId: project.id, title: 'Live status', creator: 'human', status: 'todo' }, { kind: 'human', actorId: 'human' })
    task = service.provider.claim(task.id, { expectedVersion: task.version, sessionId: 'session-live', agentId: 'session-live' }, {
      kind: 'agent', actorId: 'session-live', sessionId: 'session-live', agentId: 'session-live',
    }).task
    ctx.provide('agents', {
      get: () => ({
        status: 'running',
        session: { events: [{ type: 'todo/write', data: { todos: [{ content: 'Run verification', status: 'in_progress' }] } }] },
      }),
    } as never)
    assert.deepEqual(service.taskDetail(task.id).sessionRuntime, [{
      sessionId: 'session-live', status: 'running', current: true,
      todos: [{ content: 'Run verification', status: 'in_progress' }],
    }])
  } finally {
    service.provider.close()
  }
})

test('snapshot discovers installed Skill and MCP capabilities without claiming they are executable', async () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, config)
  try {
    ctx.provide('skills' as never, {
      snapshot: () => Promise.resolve({
        complete: true,
        skills: [{ name: 'manage-taskboard', description: 'Manage native tasks' }],
      }),
    } as never)
    ctx.provide('tools', {
      schemas: () => [
        { name: 'mcp__github__get_issue', description: 'Get issue' },
        { name: 'taskboard_get', description: 'Get task' },
      ],
    } as never)
    await Promise.resolve()
    await Promise.resolve()
    const snapshot = service.snapshot()
    assert.deepEqual(snapshot.workflowCapabilities, {
      skills: [{ name: 'manage-taskboard', description: 'Manage native tasks' }],
      mcpTools: [{ name: 'mcp__github__get_issue', description: 'Get issue' }],
      skillDiscoveryComplete: true,
    })
    assert.equal(snapshot.workflowCatalog.find(entry => entry.kind === 'skill')?.execution, 'design-only')
  } finally {
    service.provider.close()
  }
})
