import assert from 'node:assert/strict'
import test from 'node:test'
import { ProjectId, TaskId, type TaskDetail } from '../src/domain/index.js'
import { TaskboardClientController } from '../src/client/controller.js'
import { prepareTaskSession } from '../src/client/index.js'

const detail: TaskDetail = {
  task: {
    id: TaskId('task-one'), projectId: ProjectId('project-one'), identifier: 'REV-1',
    title: 'Handoff', description: '', status: 'todo', priority: 'medium', labels: [],
    sortOrder: 1, creator: 'human', version: 2, createdAt: 1, updatedAt: 1,
  },
  comments: [], activities: [], activityTotal: 0, relations: [], attachments: [], claims: [], globalRevision: 2,
}

test('0.2.1 retains a new scope until ready, binds the task, then navigates and releases', async () => {
  const calls: string[] = []
  const scoped = {}
  let ready!: (binding: { ctx: unknown }) => void
  const sessions = {
    scope: () => { throw new Error('Unretained scope must not be borrowed') },
    retain: (id: string, options: { source: string }) => {
      assert.equal(id, 'session-new')
      assert.equal(options.source, 'controllerOperation')
      calls.push('retain')
      return { ready: new Promise<{ ctx: unknown }>(resolve => { ready = resolve }), release: () => { calls.push('release') } }
    },
  }
  const workspace = {
    connectWorkspace: async (id: string) => { assert.equal(id, 'workspace-one'); calls.push('create'); return 'session-new' },
    openSession: (id: string) => { assert.equal(id, 'session-new'); calls.push('open') },
  }
  const conversation = { input: { for: (ctx: unknown) => {
    assert.equal(ctx, scoped)
    return { setDraft: (draft: string) => { assert.match(draft, /Opaque task id: task-one/); calls.push('draft') } }
  } } }
  const controller = new TaskboardClientController({ rpc: { call: async (_channel: string, endpoint: string, payload: unknown) => {
    assert.equal(endpoint, 'task.bind-session')
    assert.deepEqual(payload, { taskId: 'task-one', expectedVersion: 2, sessionId: 'session-new', agentId: 'session-new' })
    calls.push('bind')
    return { ok: true, value: {} }
  } } } as never, {} as never, undefined,
  (id, draft) => prepareTaskSession(sessions, workspace, conversation, id, draft))
  controller.open()
  const pending = controller.openNewSession('workspace-one', detail)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['create', 'retain'])
  assert.equal(controller.getSnapshot().open, true)
  ready({ ctx: scoped })
  assert.equal(await pending, 'session-new')
  assert.deepEqual(calls, ['create', 'retain', 'draft', 'bind', 'open', 'release'])
  assert.equal(controller.getSnapshot().open, false)
})

test('failed binding releases the scope and keeps the taskboard open without navigating', async () => {
  const calls: string[] = []
  const controller = new TaskboardClientController({ rpc: { call: async () => ({
    ok: false, error: { code: 'TASK_VERSION_CONFLICT', message: 'Task changed' },
  }) } } as never, {} as never, undefined, async () => ({
    sessionId: 'session-new', open: () => { calls.push('open') }, release: () => { calls.push('release') },
  }))
  controller.open()
  await assert.rejects(controller.openNewSession('workspace-one', detail), /TASK_VERSION_CONFLICT/)
  assert.deepEqual(calls, ['release'])
  assert.equal(controller.getSnapshot().open, true)
})

test('scope opening and draft failures release ownership and propagate the error', async () => {
  for (const failure of ['ready', 'draft']) {
    let released = 0
    let opened = false
    const sessions = {
      scope: () => undefined,
      retain: () => ({
        ready: failure === 'ready' ? Promise.reject(new Error('opening failed')) : Promise.resolve({ ctx: {} }),
        release: () => { released++ },
      }),
    }
    await assert.rejects(prepareTaskSession(sessions, {
      connectWorkspace: async () => 'session-new', openSession: () => { opened = true },
    }, { input: { for: () => ({ setDraft: () => { throw new Error('draft failed') } }) } }, 'workspace-one', 'draft'),
    failure === 'ready' ? /opening failed/ : /draft failed/)
    assert.equal(released, 1)
    assert.equal(opened, false)
  }
})

test('navigation failure after a successful bind still releases ownership and leaves the board open', async () => {
  let released = 0
  let bound = false
  const controller = new TaskboardClientController({ rpc: { call: async () => {
    bound = true
    return { ok: true, value: {} }
  } } } as never, {} as never, undefined, async () => ({
    sessionId: 'session-new',
    open: () => { assert.equal(bound, true); throw new Error('navigation failed') },
    release: () => { released++ },
  }))
  controller.open()
  await assert.rejects(controller.openNewSession('workspace-one', detail), /navigation failed/)
  assert.equal(released, 1)
  assert.equal(controller.getSnapshot().open, true)
})

test('legacy Harness drafts use the catalog scope and still navigate through uiWorkspace', async () => {
  const calls: string[] = []
  const scoped = {}
  const session = await prepareTaskSession({ scope: () => scoped }, {
    connectWorkspace: async () => 'session-old', openSession: id => { calls.push(`open:${id}`) },
  }, { input: { for: ctx => {
    assert.equal(ctx, scoped)
    return { setDraft: draft => { calls.push(draft) } }
  } } }, 'workspace-one', 'unsent draft')
  assert.deepEqual(calls, ['unsent draft'])
  session.open()
  session.release()
  assert.deepEqual(calls, ['unsent draft', 'open:session-old'])
})
