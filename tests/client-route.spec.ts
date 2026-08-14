import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyRevisionChange, decodeTaskboardHash, encodeTaskboardRoute, renderTaskSessionDraft, restoreRecentProject, TaskboardClientController } from '../src/client/controller.js'
import { taskboardStrings } from '../src/client/index.js'

test('Taskboard deep links preserve project, view, and task identity', () => {
  const route = { open: true, projectId: 'project/a', view: 'gantt' as const, taskId: 'task 42' }
  const hash = encodeTaskboardRoute(route)
  assert.equal(hash, '#taskboard/project%2Fa/gantt/task%2042')
  assert.deepEqual(decodeTaskboardHash(hash), route)
})

test('unknown views fall back to board and unrelated hashes close the page', () => {
  assert.deepEqual(decodeTaskboardHash('#taskboard/-/unknown'), { open: true, view: 'board' })
  assert.deepEqual(decodeTaskboardHash('#session/one'), { open: false, view: 'board' })
})

test('recent project restores a project-less Taskboard route without overriding explicit deep links', () => {
  assert.deepEqual(restoreRecentProject({ open: true, view: 'dashboard' }, 'project-recent'), {
    open: true, view: 'dashboard', projectId: 'project-recent',
  })
  assert.deepEqual(restoreRecentProject({ open: true, view: 'board', projectId: 'project-explicit' }, 'project-recent'), {
    open: true, view: 'board', projectId: 'project-explicit',
  })
  assert.deepEqual(restoreRecentProject({ open: false, view: 'board' }, 'project-recent'), { open: false, view: 'board' })
})

test('new Session draft carries the exact task identity, current facts, and human review gate', () => {
  const draft = renderTaskSessionDraft({
    task: {
      id: 'task-opaque' as never, projectId: 'project-one' as never, identifier: 'DSH-7', title: 'Native conversation',
      description: 'Implement the Session handoff.', status: 'todo', priority: 'high', labels: ['client'], sortOrder: 1,
      creator: 'human', developmentContext: { kind: 'worktree', path: '/work/task', branch: 'task/session' },
      version: 4, createdAt: 1, updatedAt: 1,
    },
    comments: [{ id: 'comment-one' as never, taskId: 'task-opaque' as never, body: 'Preserve the draft.', authorId: 'human', version: 1, createdAt: 1, updatedAt: 1 }],
    activities: [], relations: [],
    attachments: [{ id: 'attachment-one' as never, taskId: 'task-opaque' as never, filename: 'spec.md', contentType: 'text/markdown', byteSize: 12, createdAt: 1 }],
    claims: [], globalRevision: 8,
  })
  assert.match(draft, /Task DSH-7/)
  assert.match(draft, /Opaque task id: task-opaque/)
  assert.match(draft, /Current task revision: 4/)
  assert.match(draft, /Preserve the draft/)
  assert.match(draft, /Worktree \/work\/task, branch task\/session/)
  assert.match(draft, /attachment-one: spec\.md/)
  assert.match(draft, /Never accept it as done/)
})

test('snapshot revisions distinguish contiguous updates, missed-event gaps, and Host resets', () => {
  assert.equal(classifyRevisionChange(undefined, 4), 'initial')
  assert.equal(classifyRevisionChange(4, 4), 'same')
  assert.equal(classifyRevisionChange(4, 5), 'next')
  assert.equal(classifyRevisionChange(5, 9), 'gap')
  assert.equal(classifyRevisionChange(9, 2), 'reset')
})

test('client change watch uses the plugin Remote carrier and preserves revision results', async () => {
  let request: { endpoint: string; payloadJson: string } | undefined
  const controller = new TaskboardClientController(
    { hostDescription: { subscribe: () => () => undefined } } as never,
    {
      mutate: (value: { endpoint: string; payloadJson: string }) => {
        request = value
        return Promise.resolve({
          ok: true,
          value: { ok: true, valueJson: JSON.stringify({ globalRevision: 7, changed: true }) },
        })
      },
    } as never,
  )
  assert.deepEqual(await controller.watchChanges(6), { globalRevision: 7, changed: true })
  assert.equal(request?.endpoint, 'changes.watch')
  assert.deepEqual(JSON.parse(request?.payloadJson ?? 'null'), { afterRevision: 6, timeoutMs: 10_000 })
})

test('explicit new Session creation carries an unsent task draft and returns the native Session id', async () => {
  let captured: { workspaceId: string; draft: string } | undefined
  const controller = new TaskboardClientController(
    { hostDescription: { subscribe: () => () => undefined } } as never,
    {} as never,
    undefined,
    (workspaceId, draft) => { captured = { workspaceId, draft }; return Promise.resolve('session-native') },
  )
  const sessionId = await controller.openNewSession('workspace-one', {
    task: {
      id: 'task-one' as never, projectId: 'project-one' as never, identifier: 'DSH-9', title: 'Handoff', description: '',
      status: 'todo', priority: 'medium', labels: [], sortOrder: 1, creator: 'human', version: 2, createdAt: 1, updatedAt: 1,
    },
    comments: [], activities: [], relations: [], attachments: [], claims: [], globalRevision: 2,
  })
  assert.equal(sessionId, 'session-native')
  assert.equal(captured?.workspaceId, 'workspace-one')
  assert.match(captured?.draft ?? '', /Opaque task id: task-one/)
})

test('client copy selects complete Chinese and English labels from the browser language', () => {
  const zh = taskboardStrings('zh-CN')
  const en = taskboardStrings('en-US')
  assert.equal(zh.newSession, '在新会话中打开')
  assert.equal(zh.developmentContext, '开发上下文')
  assert.equal(zh.pauseUncertain, '配额不确定时暂停')
  assert.equal(en.newSession, 'Open in new session')
  assert.equal(en.developmentContext, 'Development context')
})

test('client reconnect subscription uses the public Host-description generation and unwinds cleanly', () => {
  let listener: (() => void) | undefined
  let disposed = 0
  const controller = new TaskboardClientController({
    hostDescription: {
      subscribe: (next: () => void) => { listener = next; return () => { disposed += 1 } },
    },
  } as never, {} as never)
  let invalidations = 0
  const unsubscribe = controller.subscribeConnection(() => { invalidations += 1 })
  listener?.()
  listener?.()
  assert.equal(invalidations, 2)
  unsubscribe()
  assert.equal(disposed, 1)
})
