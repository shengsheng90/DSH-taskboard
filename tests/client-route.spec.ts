import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAutomationDefaults, boardColumnOrder, BOARD_COLUMN_PAGE_SIZE, classifyRevisionChange, createdTaskId, decodeTaskboardHash, descriptionComposerMode, encodeTaskboardRoute, boardDropIntent, humanQuickCreateRequest, paginateBoardColumn, previewAutomationRuns, projectLabelCatalog, renderTaskSessionDraft, sortTaskList, restoreRecentProject, TaskboardClientController, tasksForLabel } from '../src/client/controller.js'
import { taskboardStrings } from '../src/client/index.js'
import { bindTaskboardLocale, currentTaskboardLanguage, formatAutomationLog, priorityLabel } from '../src/client/locales.js'

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

test('labels view round-trips in the Taskboard hash and groups tasks by catalog label', () => {
  const route = { open: true, projectId: 'project-one', view: 'labels' as const }
  assert.equal(encodeTaskboardRoute(route), '#taskboard/project-one/labels')
  assert.deepEqual(decodeTaskboardHash('#taskboard/project-one/labels'), route)
  const tasks = [
    { labels: ['bug', 'ui'] },
    { labels: ['ui'] },
    { labels: [] },
  ]
  assert.deepEqual(projectLabelCatalog(['release'], tasks), ['release', 'bug', 'ui'])
  assert.equal(tasksForLabel(tasks, 'ui').length, 2)
  assert.equal(tasksForLabel(tasks, undefined).length, 1)
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
    activities: [],
    activityTotal: 0,
    relations: [],
    attachments: [{ id: 'attachment-one' as never, taskId: 'task-opaque' as never, filename: 'spec.md', contentType: 'text/markdown', byteSize: 12, createdAt: 1 }],
    claims: [], globalRevision: 8,
  })
  assert.match(draft, /Task DSH-7/)
  assert.match(draft, /Opaque task id: task-opaque/)
  assert.match(draft, /Current task revision: 4/)
  assert.match(draft, /Preserve the draft/)
  assert.match(draft, /Worktree \/work\/task, branch task\/session/)
  assert.match(draft, /attachment-one: spec\.md/)
  assert.match(draft, /Never modify the task description/)
  assert.match(draft, /Never accept it as done/)
})

test('board drops move status across columns and reorder inside one column', () => {
  const dragged = { id: 't1', status: 'todo' as const, version: 4 }
  // Column is ordered by descending sortOrder, so t3 renders above t2 above t1.
  const todo = [
    { id: 't3', sortOrder: 3000, createdAt: 3 },
    { id: 't2', sortOrder: 2000, createdAt: 2 },
    { id: 't1', sortOrder: 1000, createdAt: 1 },
  ]

  // Dropping on empty space in another column appends to that column's end.
  assert.deepEqual(boardDropIntent(dragged, 'in_progress', []), {
    kind: 'move', taskId: 't1', expectedVersion: 4, status: 'in_progress',
  })
  assert.deepEqual(boardDropIntent(dragged, 'in_progress', [{ id: 'p1', sortOrder: 500, createdAt: 9 }]), {
    kind: 'move', taskId: 't1', expectedVersion: 4, status: 'in_progress', sortOrder: -500,
  })

  // Dropping on a card lands directly above it, midway between it and the card above.
  assert.deepEqual(boardDropIntent(dragged, 'todo', todo, { id: 't2' }), {
    kind: 'reorder', taskId: 't1', expectedVersion: 4, sortOrder: 2500,
  })
  // Dropping on the topmost card moves above every sibling.
  assert.deepEqual(boardDropIntent(dragged, 'todo', todo, { id: 't3' }), {
    kind: 'reorder', taskId: 't1', expectedVersion: 4, sortOrder: 4000,
  })
  // Dropping on empty space in the card's own column moves it to the end (regression: was a no-op).
  assert.deepEqual(boardDropIntent(dragged, 'todo', todo), {
    kind: 'reorder', taskId: 't1', expectedVersion: 4, sortOrder: 1000,
  })

  assert.equal(boardDropIntent(dragged, 'todo', todo, { id: 't1' }).kind, 'none')
  assert.equal(boardDropIntent({ ...dragged, archivedAt: 1 }, 'in_review', []).kind, 'none')
  assert.equal(boardDropIntent(undefined, 'todo', todo, { id: 't2' }).kind, 'none')
  // An unknown target cannot be positioned; the drop is refused rather than guessed.
  assert.equal(boardDropIntent(dragged, 'todo', todo, { id: 'missing' }).kind, 'none')
})

test('a reordered card keeps its dropped position instead of jumping to the top of the column', () => {
  // Regression: the column was ordered by updatedAt, so writing sortOrder bumped updated_at and
  // sent the card straight to the top no matter where it was dropped.
  const column = [
    { id: 'a', sortOrder: 3000, createdAt: 1 },
    { id: 'b', sortOrder: 2000, createdAt: 2 },
    { id: 'c', sortOrder: 1000, createdAt: 3 },
  ]
  assert.deepEqual(boardColumnOrder(column).map(task => task.id), ['a', 'b', 'c'])

  const intent = boardDropIntent({ id: 'c', status: 'todo', version: 1 }, 'todo', column, { id: 'b' })
  assert.equal(intent.kind, 'reorder')
  const moved = column.map(task => task.id === 'c' && intent.kind === 'reorder' ? { ...task, sortOrder: intent.sortOrder } : task)
  assert.deepEqual(boardColumnOrder(moved).map(task => task.id), ['a', 'c', 'b'])
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
  const payload = JSON.parse(request?.payloadJson ?? 'null') as { afterRevision: number; timeoutMs: number; watcherId: string }
  assert.equal(payload.afterRevision, 6)
  assert.equal(payload.timeoutMs, 10_000)
  // The watcher id lets the Host release the waiter this page abandons on abort, so it has to be
  // present and stable for the life of the controller.
  assert.equal(typeof payload.watcherId, 'string')
  assert.ok(payload.watcherId.length > 0)
  await controller.watchChanges(7)
  assert.equal((JSON.parse(request?.payloadJson ?? 'null') as { watcherId: string }).watcherId, payload.watcherId)
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
    comments: [], activities: [], activityTotal: 0, relations: [], attachments: [], claims: [], globalRevision: 2,
  })
  assert.equal(sessionId, 'session-native')
  assert.equal(captured?.workspaceId, 'workspace-one')
  assert.match(captured?.draft ?? '', /Opaque task id: task-one/)
})

test('client copy selects complete Chinese and English labels from the Harness language', () => {
  const zh = taskboardStrings('zh-CN')
  const en = taskboardStrings('en-US')
  assert.equal(zh.closeDetail, '关闭详情')
  assert.equal(zh.dismiss, '关闭')
  assert.equal(zh.cancel, '取消')
  assert.equal(zh.save, '保存')
  assert.equal(zh.newSession, '在新会话中打开')
  assert.equal(zh.write, '编写')
  assert.equal(zh.descriptionPlaceholder, '使用 Markdown 编写任务详情')
  assert.equal(zh.markdownToolbar, 'Markdown 工具栏')
  assert.equal(zh.openIssue, '打开')
  assert.equal(zh.closeIssue, '关闭任务')
  assert.equal(zh.urgent, '紧急')
  assert.equal(zh.high, '高')
  assert.equal(zh.medium, '中')
  assert.equal(zh.low, '低')
  assert.equal(zh.none, '无')
  assert.equal(zh.automationLog, '自动化运行日志')
  assert.equal(zh.more, '更多')
  assert.equal(zh.moreRemaining, '还有 {count} 个')
  assert.equal(zh.modify, '修改')
  assert.equal(zh.runNow, '立即执行')
  assert.equal(zh.recentTasks, '最近任务')
  assert.equal(en.closeDetail, 'Close details')
  assert.equal(en.dismiss, 'Close')
  assert.equal(en.cancel, 'Cancel')
  assert.equal(en.save, 'Save')
  assert.equal(en.write, 'Write')
  assert.equal(en.preview, 'Preview')
  assert.equal(en.edit, 'Edit')
  assert.equal(en.mdBold, 'Bold')
  assert.equal(zh.edit, '编辑')
  assert.equal(en.openIssue, 'Open')
  assert.equal(en.closeIssue, 'Close issue')
  assert.equal(en.targetDate, 'Target date')
  assert.equal(en.urgent, 'Urgent')
  assert.equal(en.automationLog, 'Automation run log')
  assert.equal(en.more, 'More')
  assert.equal(en.moreRemaining, '{count} more')
  assert.equal(en.modify, 'Modify')
  assert.equal(en.runNow, 'Run now')
  assert.equal(zh.unlabeled, '未标签')
  assert.equal(zh.addLabel, '新建标签')
  assert.equal(zh.edited, '已编辑')
  assert.equal(en.unlabeled, 'No label')
  assert.equal(en.renameLabel, 'Rename label')
  assert.equal(en.edited, 'edited')
  assert.equal(zh.developmentContext, '开发上下文')
  assert.equal(zh.pauseUncertain, '配额不确定时暂停')
  assert.equal(en.newSession, 'Open in new session')
  assert.equal(en.developmentContext, 'Development context')
  assert.equal(priorityLabel(zh, 'urgent'), '紧急')
  assert.equal(priorityLabel(en, 'medium'), 'Medium')
  assert.equal(formatAutomationLog(zh, { kind: 'claimed', taskId: 't1', message: 'worker started for DSH-2', at: 1 }, 'DSH-2 · Wire'), '读取待办并开始执行 DSH-2 · Wire')
  assert.equal(formatAutomationLog(zh, { kind: 'empty', message: 'no eligible todo tasks', at: 1 }), '已检查待办，当前没有可执行的任务')
  assert.equal(formatAutomationLog(en, { kind: 'empty', message: 'worker concurrency is currently full', at: 1 }), 'Workers are busy; no new task was started')
})

test('empty task descriptions open the write tab and saved Markdown opens preview', () => {
  assert.equal(descriptionComposerMode(''), 'write')
  assert.equal(descriptionComposerMode('   \n\t  '), 'write')
  assert.equal(descriptionComposerMode('Fill in the size.'), 'preview')
  assert.equal(descriptionComposerMode('  already written  '), 'preview')
})

test('human quick-add creates a Backlog task and only treats a mutation result with an id as success', () => {
  assert.deepEqual(humanQuickCreateRequest('project-one', '  Wire the form  '), {
    projectId: 'project-one',
    title: 'Wire the form',
    creator: 'human:web-client',
    status: 'backlog',
  })
  assert.equal(createdTaskId({ id: 'task-created', title: 'Wire the form' }), 'task-created')
  assert.equal(createdTaskId({ title: 'missing id' }), undefined)
  assert.equal(createdTaskId(undefined), undefined)
})

test('board columns page through manual order, newest first by default', () => {
  // createTask assigns an increasing sortOrder per project, so descending order still puts the
  // newest card on top -- without discarding manual drag-to-reorder writes.
  const tasks = Array.from({ length: 18 }, (_, index) => ({
    id: `task-${String(index).padStart(2, '0')}`,
    createdAt: index,
    sortOrder: (index + 1) * 1000,
  }))
  const first = paginateBoardColumn(tasks)
  assert.equal(BOARD_COLUMN_PAGE_SIZE, 15)
  assert.equal(first.visible.length, 15)
  assert.equal(first.remaining, 3)
  assert.deepEqual(first.visible.map(task => task.id), [
    'task-17', 'task-16', 'task-15', 'task-14', 'task-13', 'task-12', 'task-11', 'task-10',
    'task-09', 'task-08', 'task-07', 'task-06', 'task-05', 'task-04', 'task-03',
  ])
  const second = paginateBoardColumn(tasks, BOARD_COLUMN_PAGE_SIZE * 2)
  assert.equal(second.visible.length, 18)
  assert.equal(second.remaining, 0)
  assert.deepEqual(second.visible.slice(15).map(task => task.id), ['task-02', 'task-01', 'task-00'])

  // A manual reorder wins over creation order.
  const reordered = tasks.map(task => task.id === 'task-00' ? { ...task, sortOrder: 99_000 } : task)
  assert.equal(paginateBoardColumn(reordered).visible[0]?.id, 'task-00')
  assert.equal(paginateBoardColumn(tasks.slice(0, 3)).remaining, 0)
})

test('dashboard automation log keeps the newest ten entries and fills empty model fields from Host defaults', () => {
  const runs = Array.from({ length: 12 }, (_, index) => ({ id: `run-${index}` }))
  assert.deepEqual(previewAutomationRuns(runs), {
    preview: runs.slice(0, 10),
    remaining: 2,
  })
  assert.deepEqual(previewAutomationRuns(runs.slice(0, 3)), { preview: runs.slice(0, 3), remaining: 0 })
  const emptyConfig = { intervalMs: 30_000, agentPreset: 'standard' }
  assert.deepEqual(
    applyAutomationDefaults(emptyConfig, {
      modelRoute: 'deepseek-official:deepseek-v4-flash',
      reasoning: 'low',
    }),
    {
      intervalMs: 30_000,
      agentPreset: 'standard',
      modelRoute: 'deepseek-official:deepseek-v4-flash',
      reasoning: 'low',
    },
  )
  assert.deepEqual(
    applyAutomationDefaults({ modelRoute: 'acme:large', reasoning: 'high' }, {
      modelRoute: 'deepseek-official:deepseek-v4-flash',
      reasoning: 'low',
    }),
    { modelRoute: 'acme:large', reasoning: 'high' },
  )
})

test('client locale binding follows the Harness language source', () => {
  let active = 'en'
  const listeners = new Set<() => void>()
  const unbind = bindTaskboardLocale({
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => ({ active }),
  })
  try {
    assert.equal(currentTaskboardLanguage(), 'en')
    active = 'zh'
    for (const listener of listeners) listener()
    assert.equal(currentTaskboardLanguage(), 'zh')
    assert.equal(taskboardStrings(currentTaskboardLanguage()).priority, '优先级')
  } finally {
    unbind()
  }
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

test('list view sorts enums by their real order, not alphabetically', () => {
  const task = (identifier: string, priority: string, status: string, dueDate?: string) =>
    ({ identifier, title: identifier, priority, status, ...(dueDate === undefined ? {} : { dueDate }) })
  const tasks = [
    task('DSH-1', 'none', 'done'),
    task('DSH-2', 'urgent', 'backlog'),
    task('DSH-3', 'low', 'in_review'),
    task('DSH-4', 'high', 'todo'),
    task('DSH-5', 'medium', 'in_progress'),
  ]

  // Alphabetically this was high, low, medium, none, urgent -- meaningless as a priority order.
  assert.deepEqual(sortTaskList(tasks, 'priority').map(item => item.priority), ['urgent', 'high', 'medium', 'low', 'none'])
  assert.deepEqual(sortTaskList(tasks, 'priority', 'desc').map(item => item.priority), ['none', 'low', 'medium', 'high', 'urgent'])
  assert.deepEqual(
    sortTaskList(tasks, 'status').map(item => item.status),
    ['backlog', 'todo', 'in_progress', 'in_review', 'done'],
  )

  // Identifiers compare numerically, so DSH-10 follows DSH-9.
  const many = [task('DSH-10', 'none', 'todo'), task('DSH-9', 'none', 'todo'), task('DSH-1', 'none', 'todo')]
  assert.deepEqual(sortTaskList(many, 'identifier').map(item => item.identifier), ['DSH-1', 'DSH-9', 'DSH-10'])

  // Undated tasks sort last ascending rather than leading the page.
  const dated = [task('DSH-1', 'none', 'todo'), task('DSH-2', 'none', 'todo', '2026-01-05'), task('DSH-3', 'none', 'todo', '2026-01-01')]
  assert.deepEqual(sortTaskList(dated, 'dueDate').map(item => item.identifier), ['DSH-3', 'DSH-2', 'DSH-1'])
})
