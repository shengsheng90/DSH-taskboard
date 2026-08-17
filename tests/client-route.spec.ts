import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAutomationDefaults, BOARD_COLUMN_PAGE_SIZE, classifyRevisionChange, createdTaskId, decodeTaskboardHash, encodeTaskboardRoute, boardDropIntent, humanQuickCreateRequest, paginateBoardColumn, previewAutomationRuns, projectLabelCatalog, renderTaskSessionDraft, restoreRecentProject, TaskboardClientController, tasksForLabel } from '../src/client/controller.js'
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
  assert.match(draft, /Never modify the task description/)
  assert.match(draft, /Never accept it as done/)
})

test('board drops move status across columns and reorder inside one column', () => {
  const dragged = { id: 't1', status: 'todo' as const, version: 4 }
  assert.deepEqual(boardDropIntent(dragged, 'in_progress'), {
    kind: 'move', taskId: 't1', expectedVersion: 4, status: 'in_progress',
  })
  assert.deepEqual(boardDropIntent(dragged, 'todo', { id: 't2', sortOrder: 10 }), {
    kind: 'reorder', taskId: 't1', expectedVersion: 4, sortOrder: 9.5,
  })
  assert.equal(boardDropIntent(dragged, 'todo', { id: 't1', sortOrder: 10 }).kind, 'none')
  assert.equal(boardDropIntent({ ...dragged, archivedAt: 1 }, 'in_review').kind, 'none')
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

test('client copy selects complete Chinese and English labels from the Harness language', () => {
  const zh = taskboardStrings('zh-CN')
  const en = taskboardStrings('en-US')
  assert.equal(zh.closeDetail, '关闭详情')
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

test('human quick-add creates a Todo task and only treats a mutation result with an id as success', () => {
  assert.deepEqual(humanQuickCreateRequest('project-one', '  Wire the form  '), {
    projectId: 'project-one',
    title: 'Wire the form',
    creator: 'human:web-client',
    status: 'todo',
  })
  assert.equal(createdTaskId({ id: 'task-created', title: 'Wire the form' }), 'task-created')
  assert.equal(createdTaskId({ title: 'missing id' }), undefined)
  assert.equal(createdTaskId(undefined), undefined)
})

test('board columns show the newest page of tasks and reveal older cards on later pages', () => {
  const tasks = Array.from({ length: 18 }, (_, index) => ({
    id: `task-${String(index).padStart(2, '0')}`,
    createdAt: index,
    updatedAt: index === 0 ? 100 : index,
  }))
  const first = paginateBoardColumn(tasks)
  assert.equal(BOARD_COLUMN_PAGE_SIZE, 15)
  assert.equal(first.visible.length, 15)
  assert.equal(first.remaining, 3)
  assert.deepEqual(first.visible.map(task => task.id), [
    'task-00', 'task-17', 'task-16', 'task-15', 'task-14', 'task-13', 'task-12', 'task-11',
    'task-10', 'task-09', 'task-08', 'task-07', 'task-06', 'task-05', 'task-04',
  ])
  const second = paginateBoardColumn(tasks, BOARD_COLUMN_PAGE_SIZE * 2)
  assert.equal(second.visible.length, 18)
  assert.equal(second.remaining, 0)
  assert.deepEqual(second.visible.slice(15).map(task => task.id), ['task-03', 'task-02', 'task-01'])
  assert.deepEqual(paginateBoardColumn(tasks.slice(0, 3)).visible.map(task => task.id), ['task-00', 'task-02', 'task-01'])
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
