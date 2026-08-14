import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, RefObject } from 'react'
import type { ClientContext, ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  AutomationRule, SavedWorkflow, TaskboardProject, TaskboardTask, TaskDetail as TaskDetailData, WorkflowDocument,
} from '../domain/index.js'
import type { TaskboardSnapshot } from '../service/index.js'
import {
  addWorkflowTab, copyWorkflowNode, insertWorkflowNode, moveWorkflowNode, removeWorkflowNode, removeWorkflowTab,
} from '../workflow/index.js'
import { TaskboardClientController } from './controller.js'
import taskboardRemote from '../../generated/typert.remote-client.js'

export const inject = ['slots', 'connection', 'sessions', 'workspaces', 'conversation', 'remote']

interface InjectedProps {
  controller: TaskboardClientController
}

interface PageInjectedProps extends InjectedProps {
  workspaces: IWorkspaces
}

/** Narrow structural face used at the plugin boundary; the service is provided by dsh-client-ui-conversation. */
interface ConversationDraftPort {
  readonly input: { for(ctx: ClientContext): { setDraft(text: string): void } }
}

type NavProps = PropsRuntime<'sidebar.footer.action'> & InjectedProps
type PageProps = PropsRuntime<'shell.overlay'> & PageInjectedProps
type WorkspaceOption = IWorkspaces['list']['getSnapshot'] extends () => infer State
  ? State extends { items: readonly (infer Item)[] } ? Item : never
  : never

const copy = {
  zh: {
    taskboard: '任务板', close: '关闭任务板', newTask: '新建任务', title: '标题', description: '描述', create: '创建',
    dashboard: '概览', board: '看板', list: '列表', gantt: '甘特', workflows: '工作流', other: '其他任务',
    backlog: '待批准', todo: '待办', in_progress: '进行中', in_review: '待评审', blocked: '已阻塞', done: '已完成', canceled: '已取消',
    empty: '暂无任务', refresh: '刷新', approve: '批准开工', accept: '验收完成', archive: '归档', restore: '恢复', save: '保存',
    comment: '评论', addComment: '添加评论', project: '项目', addProject: '新建项目', projectName: '项目名称', projectKey: '项目代号',
    due: '截止', priority: '优先级', loading: '正在读取本地任务数据…', workflowNote: '保存的可视化工作流与能力目录将在这里显示。', search: '搜索任务', allStatuses: '全部状态', deleteProject: '删除项目', editProject: '编辑项目', newSession: '在新会话中打开', workspaceRequired: '请先为项目映射 Workspace',
    comments: '评论记录', activity: '活动', attachments: '附件', relations: '关系', sessions: '关联会话', automation: '自动化', enable: '启用', pause: '暂停', nextRun: '下次运行', lastDecision: '最近决策', addAutomation: '新建自动化', addWorkflow: '新建工作流', addStep: '添加步骤', designOnly: '仅设计', executable: '可执行', returnWork: '退回修改', openSession: '打开会话', storageHealth: '本地存储健康', healthy: '正常', degraded: '需处理', cleanupPending: '待清理附件', orphanedClaims: '孤儿认领', undo: '撤销上次编辑', today: '今天', showCompleted: '显示已完成', recurrence: '重复', noRecurrence: '不重复', interval: '间隔', until: '截止重复',
    labels: '标签', workspaceId: 'Harness Workspace ID', blankGlobal: '留空表示全局项目', globalProject: '全局项目', workspace: 'Workspace', noProjectLabels: '无项目标签', tasksWord: '个任务', activeWord: '进行中', agentPreset: 'Agent 预设', modelRoute: '模型路由', reasoning: '推理强度', intervalSeconds: '间隔（秒）', workers: '工作器数', quota: '配额策略', pauseUncertain: '配额不确定时暂停', ignore: '忽略', autoPauseEmpty: '无任务时自动暂停', model: '模型', hostDefault: 'Host 默认', stayEnabled: '保持启用', status: '状态', ganttZoom: '甘特缩放', days30: '30 天', days90: '90 天', oneYear: '1 年', noDatedTasks: '暂无已排期任务', workflowName: '工作流名称', nodeKind: '节点类型', newTabName: '新标签页名称', triggerKind: '触发器类型', tab: '标签页', deleteWorkflow: '删除工作流', installedCapabilities: '已安装能力', skillDiscovery: 'Skill 发现', completeWord: '已完成', refreshing: '刷新中/不完整', skill: 'Skill', mcp: 'MCP', copy: '复制', trueLabel: '真', falseLabel: '假', assignee: '负责人', workflow: '工作流', developmentContext: '开发上下文', none: '无', branch: '分支', worktree: 'Worktree', worktreePath: 'Worktree 路径', start: '开始', daily: '每天', weekly: '每周', monthly: '每月', developmentRequired: '当前开发上下文需要分支和 Worktree 路径。', resume: '恢复', cancel: '取消', reopen: '重新打开', takeover: '强制接管', delete: '删除', confirm: '确认', reason: '原因', permanentlyDelete: '永久删除', participants: '参与者', creator: '创建者', actors: '操作者', attachComment: '附加到评论', relationKind: '关系类型', relatedTask: '关联任务', selectTask: '选择任务', add: '添加', bytes: '字节', current: '当前', offline: '离线',
  },
  en: {
    taskboard: 'Taskboard', close: 'Close Taskboard', newTask: 'New task', title: 'Title', description: 'Description', create: 'Create',
    dashboard: 'Dashboard', board: 'Board', list: 'List', gantt: 'Gantt', workflows: 'Workflows', other: 'Other Tasks',
    backlog: 'Backlog', todo: 'Todo', in_progress: 'In progress', in_review: 'In review', blocked: 'Blocked', done: 'Done', canceled: 'Canceled',
    empty: 'No tasks', refresh: 'Refresh', approve: 'Approve for work', accept: 'Accept', archive: 'Archive', restore: 'Restore', save: 'Save',
    comment: 'Comment', addComment: 'Add comment', project: 'Project', addProject: 'New project', projectName: 'Project name', projectKey: 'Project key',
    due: 'Due', priority: 'Priority', loading: 'Reading local task data…', workflowNote: 'Saved visual workflows and the capability catalog appear here.', search: 'Search tasks', allStatuses: 'All statuses', deleteProject: 'Delete project', editProject: 'Edit project', newSession: 'Open in new session', workspaceRequired: 'Map a Workspace to this project first',
    comments: 'Comments', activity: 'Activity', attachments: 'Attachments', relations: 'Relations', sessions: 'Linked sessions', automation: 'Automation', enable: 'Enable', pause: 'Pause', nextRun: 'Next run', lastDecision: 'Last decision', addAutomation: 'New automation', addWorkflow: 'New workflow', addStep: 'Add step', designOnly: 'Design only', executable: 'Executable', returnWork: 'Return for rework', openSession: 'Open session', storageHealth: 'Local storage health', healthy: 'Healthy', degraded: 'Needs attention', cleanupPending: 'Pending attachment cleanup', orphanedClaims: 'Orphaned claims', undo: 'Undo last edit', today: 'Today', showCompleted: 'Show completed', recurrence: 'Recurrence', noRecurrence: 'None', interval: 'Interval', until: 'Repeat until',
    labels: 'Labels', workspaceId: 'Harness Workspace ID', blankGlobal: 'Blank = global project', globalProject: 'Global project', workspace: 'Workspace', noProjectLabels: 'No project labels', tasksWord: 'tasks', activeWord: 'active', agentPreset: 'Agent preset', modelRoute: 'Model route', reasoning: 'Reasoning', intervalSeconds: 'Interval (seconds)', workers: 'Workers', quota: 'Quota', pauseUncertain: 'Pause when uncertain', ignore: 'Ignore', autoPauseEmpty: 'Auto-pause when empty', model: 'Model', hostDefault: 'host default', stayEnabled: 'stay enabled', status: 'Status', ganttZoom: 'Gantt zoom', days30: '30 days', days90: '90 days', oneYear: '1 year', noDatedTasks: 'No dated tasks', workflowName: 'Workflow name', nodeKind: 'Node kind', newTabName: 'New tab name', triggerKind: 'Trigger kind', tab: 'Tab', deleteWorkflow: 'Delete workflow', installedCapabilities: 'Installed capabilities', skillDiscovery: 'Skill discovery', completeWord: 'complete', refreshing: 'refreshing/incomplete', skill: 'Skill', mcp: 'MCP', copy: 'Copy', trueLabel: 'True', falseLabel: 'False', assignee: 'Assignee', workflow: 'Workflow', developmentContext: 'Development context', none: 'None', branch: 'Branch', worktree: 'Worktree', worktreePath: 'Worktree path', start: 'Start', daily: 'daily', weekly: 'weekly', monthly: 'monthly', developmentRequired: 'Branch and worktree path are required for the selected development context.', resume: 'Resume', cancel: 'Cancel', reopen: 'Reopen', takeover: 'Force takeover', delete: 'Delete', confirm: 'Confirm', reason: 'reason', permanentlyDelete: 'Permanently delete', participants: 'Participants', creator: 'Creator', actors: 'Actors', attachComment: 'Attach to comment', relationKind: 'Relation kind', relatedTask: 'Related task', selectTask: 'Select task', add: 'Add', bytes: 'bytes', current: 'current', offline: 'offline',
  },
} as const

export function taskboardStrings(language: string) {
  return language.toLowerCase().startsWith('zh') ? copy.zh : copy.en
}

function strings() {
  return taskboardStrings(typeof navigator === 'undefined' ? 'en' : navigator.language)
}

export function TaskboardNavButton({ wide, controller }: NavProps) {
  const route = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const t = strings()
  return (
    <button type="button" className="dsh-taskboard-nav" aria-pressed={route.open} aria-label={t.taskboard} onClick={() => { route.open ? controller.close() : controller.open() }}>
      <span aria-hidden="true">▦</span>{wide && <span>{t.taskboard}</span>}
    </button>
  )
}

function useFrameInset(ref: RefObject<HTMLDivElement | null>, active: boolean): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    if (!active || ref.current === null) return
    const frame = ref.current.parentElement?.parentElement
    if (frame === null || frame === undefined) return
    const measure = (): void => {
      const first = getComputedStyle(frame).gridTemplateColumns.split(' ')[0]
      const parsed = Number.parseFloat(first ?? '0')
      setInset(Number.isFinite(parsed) ? parsed : 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => { observer.disconnect() }
  }, [active, ref])
  return inset
}

export function TaskboardPage({ controller, workspaces }: PageProps) {
  const route = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const workspaceState = useSyncExternalStore(
    workspaces.list.subscribe,
    workspaces.list.getSnapshot,
    workspaces.list.getSnapshot,
  )
  const root = useRef<HTMLDivElement>(null)
  const inset = useFrameInset(root, route.open)
  const [snapshot, setSnapshot] = useState<TaskboardSnapshot>()
  const [detail, setDetail] = useState<TaskDetailData>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [undo, setUndo] = useState<{ endpoint: string; payload: Record<string, unknown> }>()
  const t = strings()

  useEffect(() => {
    if (!route.open) return
    const abort = new AbortController()
    setBusy(true)
    controller.snapshot(route.projectId, abort.signal).then(next => {
      controller.recordSnapshotRevision(next.globalRevision)
      setSnapshot(next)
      setError(undefined)
      if (route.projectId === undefined && next.projects[0] !== undefined) controller.select(next.projects[0].id, route.view)
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (!abort.signal.aborted) setBusy(false) })
    return () => { abort.abort() }
  }, [controller, refreshKey, route.open, route.projectId, route.view])

  useEffect(() => {
    if (!route.open || route.taskId === undefined) { setDetail(undefined); return }
    const abort = new AbortController()
    controller.detail(route.taskId, abort.signal).then(value => {
      if (!abort.signal.aborted) setDetail(value)
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { abort.abort() }
  }, [controller, refreshKey, route.open, route.taskId])

  useEffect(() => {
    if (!route.open) return
    return controller.subscribeConnection(() => { setRefreshKey(value => value + 1) })
  }, [controller, route.open])

  useEffect(() => {
    if (!route.open || snapshot === undefined) return
    const timer = window.setInterval(() => { setRefreshKey(value => value + 1) }, snapshot.refreshIntervalMs)
    return () => { window.clearInterval(timer) }
  }, [route.open, snapshot?.refreshIntervalMs])

  useEffect(() => {
    if (!route.open || snapshot === undefined) return
    const abort = new AbortController()
    const watch = async (): Promise<void> => {
      let revision = snapshot.globalRevision
      while (!abort.signal.aborted) {
        const result = await controller.watchChanges(revision, abort.signal)
        if (abort.signal.aborted) return
        if (result.changed || result.globalRevision !== revision) {
          setRefreshKey(value => value + 1)
          return
        }
        revision = result.globalRevision
      }
    }
    void watch().catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { abort.abort() }
  }, [controller, route.open, snapshot?.globalRevision])

  useEffect(() => {
    if (!route.open) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') controller.close() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [controller, route.open])

  if (!route.open) return null
  const selected = snapshot?.projects.find(project => project.id === route.projectId) ?? snapshot?.projects[0]
  const tasks = snapshot?.tasks ?? []
  const visibleTasks = tasks.filter(task => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false
    const needle = query.trim().toLocaleLowerCase()
    return needle === ''
      || `${task.identifier} ${task.title} ${task.description} ${task.labels.join(' ')}`.toLocaleLowerCase().includes(needle)
  })
  const selectedTask = tasks.find(task => task.id === route.taskId)
  const refresh = (): void => { setRefreshKey(value => value + 1) }
  const mutate = async (endpoint: string, payload: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    try {
      const prior = endpoint === 'task.update' && typeof payload['taskId'] === 'string'
        ? tasks.find(task => task.id === payload['taskId'])
        : undefined
      const request = payload['request'] as Record<string, unknown> | undefined
      const value = await controller.mutate(endpoint, payload)
      if (prior !== undefined && request !== undefined && typeof value === 'object' && value !== null && 'version' in value) {
        const inverse: Record<string, unknown> = {}
        for (const key of Object.keys(request)) inverse[key] = (prior as unknown as Record<string, unknown>)[key] ?? null
        setUndo({ endpoint: 'task.update', payload: { taskId: prior.id, expectedVersion: Number((value as { version: unknown }).version), request: inverse } })
      } else if ((endpoint === 'task.archive' || endpoint === 'task.restore') && typeof value === 'object' && value !== null && 'version' in value && typeof payload['taskId'] === 'string') {
        setUndo({
          endpoint: endpoint === 'task.archive' ? 'task.restore' : 'task.archive',
          payload: { taskId: payload['taskId'], expectedVersion: Number((value as { version: unknown }).version) },
        })
      }
      setError(undefined); refresh()
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      if (message.includes('TASK_STALE_VERSION')) refresh()
    }
    finally { setBusy(false) }
  }
  const performUndo = async (): Promise<void> => {
    if (undo === undefined) return
    setBusy(true)
    try { await controller.mutate(undo.endpoint, undo.payload); setUndo(undefined); setError(undefined); refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return (
    <div ref={root} className="dsh-taskboard-page" style={{ left: inset }} role="main" aria-label={t.taskboard}>
      <style>{STYLES}</style>
      <header className="dsh-taskboard-header">
        <div className="dsh-taskboard-brand"><span aria-hidden="true">▦</span><strong>{t.taskboard}</strong></div>
        <select aria-label={t.project} value={selected?.id ?? ''} onChange={event => { controller.select(event.target.value || undefined, route.view) }}>
          {snapshot?.projects.map(project => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
        </select>
        <ProjectCreate controller={controller} refresh={refresh} workspaces={workspaceState.items} />
        {selected !== undefined && <ProjectActions project={selected} controller={controller} refresh={refresh} workspaces={workspaceState.items} />}
        <button type="button" onClick={refresh}>{t.refresh}</button>
        <button type="button" aria-label={t.close} onClick={() => { controller.close() }}>×</button>
      </header>
      <div className="dsh-taskboard-filters">
        <input aria-label={t.search} placeholder={t.search} value={query} onChange={event => { setQuery(event.target.value) }} />
        <select aria-label={t.allStatuses} value={statusFilter} onChange={event => { setStatusFilter(event.target.value) }}>
          <option value="all">{t.allStatuses}</option>
          {(['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'] as const).map(status => <option key={status} value={status}>{t[status]}</option>)}
        </select>
        <button type="button" disabled={undo === undefined || busy} onClick={() => { void performUndo() }}>{t.undo}</button>
      </div>
      <nav className="dsh-taskboard-tabs" aria-label={t.taskboard}>
        {(['dashboard', 'board', 'list', 'gantt', 'workflows'] as const).map(view => (
          <button key={view} type="button" aria-current={route.view === view ? 'page' : undefined} onClick={() => { controller.select(selected?.id, view) }}>{t[view]}</button>
        ))}
      </nav>
      {error !== undefined && <div className="dsh-taskboard-error" role="alert">{error}</div>}
      {busy && snapshot === undefined
        ? <div className="dsh-taskboard-loading">{t.loading}</div>
        : <div className="dsh-taskboard-content">
          <main className="dsh-taskboard-view">
            <TaskCreate project={selected} mutate={mutate} />
            {route.view === 'dashboard' && <Dashboard tasks={visibleTasks} automations={snapshot?.automations ?? []} project={selected} defaults={snapshot?.automationDefaults} storage={snapshot?.storageHealth} mutate={mutate} open={task => { controller.select(selected?.id, route.view, task.id) }} />}
            {route.view === 'board' && <Board tasks={visibleTasks} open={task => { controller.select(selected?.id, route.view, task.id) }} mutate={mutate} />}
            {route.view === 'list' && <ListView tasks={visibleTasks} open={task => { controller.select(selected?.id, route.view, task.id) }} />}
            {route.view === 'gantt' && <Gantt tasks={visibleTasks} open={task => { controller.select(selected?.id, route.view, task.id) }} />}
            {route.view === 'workflows' && <WorkflowEditor project={selected} workflows={snapshot?.workflows ?? []} catalog={snapshot?.workflowCatalog ?? []} capabilities={snapshot?.workflowCapabilities} mutate={mutate} />}
          </main>
          {selectedTask !== undefined && <TaskDetail project={selected} task={selectedTask} tasks={tasks} workflows={snapshot?.workflows ?? []} detail={detail} mutate={mutate} upload={async (file, commentId) => { setBusy(true); try { await controller.uploadAttachment(selectedTask.id, selectedTask.version, file, commentId); refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }} download={(id, filename) => controller.downloadAttachment(id, filename)} openSession={sessionId => { controller.openSession(sessionId) }} openNewSession={async () => { if (selected?.workspaceId === undefined || detail === undefined) return; setBusy(true); try { await controller.openNewSession(selected.workspaceId, detail) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }} close={() => { controller.select(selected?.id, route.view) }} />}
        </div>}
    </div>
  )
}

function ProjectCreate({ controller, refresh, workspaces }: {
  controller: TaskboardClientController
  refresh: () => void
  workspaces: readonly WorkspaceOption[]
}) {
  const t = strings()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [labels, setLabels] = useState('')
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || key.trim() === '') return
    const project = await controller.mutate('project.create', {
      request: {
        key: key.trim(), name: name.trim(),
        ...(workspaceId.trim() === '' ? {} : { workspaceId: workspaceId.trim() }),
        labels: labels.split(',').map(value => value.trim()).filter(Boolean),
      },
    }) as TaskboardProject
    setOpen(false); setName(''); setKey(''); setWorkspaceId(''); setLabels('')
    controller.select(project.id, 'board')
    refresh()
  }
  return <div className="dsh-taskboard-popover"><button type="button" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>＋ {t.addProject}</button>{open && <form onSubmit={event => { void create(event) }}><label>{t.projectName}<input autoFocus value={name} onChange={event => { const value = event.target.value; setName(value); if (key === '') setKey(value.replaceAll(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()) }} /></label><label>{t.projectKey}<input value={key} onChange={event => { setKey(event.target.value.toUpperCase()) }} /></label><label>{t.workspaceId}<select value={workspaceId} onChange={event => { setWorkspaceId(event.target.value) }}><option value="">{t.blankGlobal}</option>{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title} · {item.path}</option>)}</select></label><label>{t.labels}<input value={labels} onChange={event => { setLabels(event.target.value) }} placeholder="local, release" /></label><div><button type="submit" disabled={name.trim() === '' || key.trim() === ''}>{t.create}</button><button type="button" onClick={() => { setOpen(false) }}>{t.close}</button></div></form>}</div>
}

function ProjectActions({ project, controller, refresh, workspaces }: {
  project: TaskboardProject
  controller: TaskboardClientController
  refresh: () => void
  workspaces: readonly WorkspaceOption[]
}) {
  const t = strings()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState(project.name)
  const [workspace, setWorkspace] = useState(project.workspaceId ?? '')
  const [labels, setLabels] = useState(project.labels.join(', '))
  useEffect(() => { setName(project.name); setWorkspace(project.workspaceId ?? ''); setLabels(project.labels.join(', ')) }, [project])
  const edit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '') return
    await controller.mutate('project.update', {
      projectId: project.id,
      expectedVersion: project.version,
      request: { name: name.trim(), workspaceId: workspace.trim() || null, labels: labels.split(',').map(value => value.trim()).filter(Boolean) },
    })
    setEditing(false)
    refresh()
  }
  const remove = async (): Promise<void> => {
    await controller.mutate('project.delete', { projectId: project.id, expectedVersion: project.version })
    setConfirmDelete(false)
    controller.select(undefined, 'dashboard')
    refresh()
  }
  return <><div className="dsh-taskboard-popover"><button type="button" aria-expanded={editing} onClick={() => { setEditing(value => !value); setConfirmDelete(false) }}>{t.editProject}</button>{editing && <form onSubmit={event => { void edit(event) }}><label>{t.projectName}<input autoFocus value={name} onChange={event => { setName(event.target.value) }} /></label><label>{t.workspaceId}<select value={workspace} onChange={event => { setWorkspace(event.target.value) }}><option value="">{t.blankGlobal}</option>{project.workspaceId !== undefined && !workspaces.some(item => item.workspaceId === project.workspaceId) && <option value={project.workspaceId}>{project.workspaceId}</option>}{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title} · {item.path}</option>)}</select></label><label>{t.labels}<input value={labels} onChange={event => { setLabels(event.target.value) }} /></label><div><button type="submit">{t.save}</button><button type="button" onClick={() => { setEditing(false) }}>{t.close}</button></div></form>}</div><div className="dsh-taskboard-popover"><button type="button" aria-expanded={confirmDelete} onClick={() => { setConfirmDelete(value => !value); setEditing(false) }}>{t.deleteProject}</button>{confirmDelete && <div className="dsh-taskboard-confirm" role="alert"><span>{t.deleteProject}: {project.key} · {project.name}?</span><button type="button" onClick={() => { void remove() }}>{t.deleteProject}</button><button type="button" onClick={() => { setConfirmDelete(false) }}>{t.close}</button></div>}</div></>
}

function TaskCreate({ project, mutate }: { project: TaskboardProject | undefined; mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const t = strings()
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (project === undefined || title.trim() === '') return
    void mutate('task.create', { request: { projectId: project.id, title: title.trim(), creator: 'human:web-client' } }).then(() => { setTitle('') })
  }
  return <form className="dsh-taskboard-create" onSubmit={submit}><input value={title} onChange={event => { setTitle(event.target.value) }} placeholder={t.newTask} aria-label={t.title} /><button type="submit" disabled={project === undefined}>{t.create}</button></form>
}

function Dashboard({ tasks, automations, project, defaults, storage, mutate, open }: {
  tasks: readonly TaskboardTask[]
  automations: readonly AutomationRule[]
  project: TaskboardProject | undefined
  defaults: TaskboardSnapshot['automationDefaults'] | undefined
  storage: TaskboardSnapshot['storageHealth'] | undefined
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<void>
  open: (task: TaskboardTask) => void
}) {
  const t = strings()
  const counts = useMemo(() => Object.fromEntries(tasks.map(task => task.status).map(status => [status, tasks.filter(task => task.status === status).length])), [tasks])
  const [adding, setAdding] = useState(false)
  const [agentPreset, setAgentPreset] = useState(defaults?.agentPreset ?? 'standard')
  const [modelRoute, setModelRoute] = useState(defaults?.modelRoute ?? '')
  const [reasoning, setReasoning] = useState('')
  const minimumIntervalSeconds = Math.ceil((defaults?.minIntervalMs ?? 30_000) / 1000)
  const [intervalSeconds, setIntervalSeconds] = useState(minimumIntervalSeconds)
  const [concurrencyLimit, setConcurrencyLimit] = useState(1)
  const [quotaPolicy, setQuotaPolicy] = useState<'pause-on-uncertain' | 'ignore'>('pause-on-uncertain')
  const [autoPauseOnEmpty, setAutoPauseOnEmpty] = useState(false)
  const dueTasks = useMemo(() => [...tasks]
    .filter(task => task.dueDate !== undefined && task.status !== 'done' && task.status !== 'canceled')
    .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)))
    .slice(0, 8), [tasks])
  const add = (event: FormEvent): void => {
    event.preventDefault()
    if (project === undefined || agentPreset.trim() === '') return
    void mutate('automation.create', {
      projectId: project.id,
      config: {
        intervalMs: Math.max(minimumIntervalSeconds, intervalSeconds) * 1000, agentPreset: agentPreset.trim(), concurrencyLimit, quotaPolicy, autoPauseOnEmpty,
        ...(modelRoute.trim() === '' ? {} : { modelRoute: modelRoute.trim() }),
        ...(reasoning.trim() === '' ? {} : { reasoning: reasoning.trim() }),
      },
    }).then(() => { setAdding(false) })
  }
  return <><div className="dsh-taskboard-dashboard">{(['todo', 'in_progress', 'in_review', 'blocked'] as const).map(status => <div key={status}><strong>{counts[status] ?? 0}</strong><span>{t[status]}</span></div>)}</div><section className="dsh-taskboard-summary"><h2>{project?.key ?? '—'} · {project?.name ?? t.project}</h2><span>{project?.workspaceId === undefined ? t.globalProject : `${t.workspace}: ${project.workspaceId}`}</span><span>{project?.labels.length === 0 ? t.noProjectLabels : `${t.labels}: ${project?.labels.join(', ')}`}</span><span>{tasks.length} {t.tasksWord} · {counts['in_progress'] ?? 0} {t.activeWord} · {counts['in_review'] ?? 0} {t.in_review}</span></section><section className="dsh-taskboard-due"><h2>{t.due}</h2>{dueTasks.length === 0 ? <p>{t.empty}</p> : dueTasks.map(task => <button type="button" key={task.id} onClick={() => { open(task) }}><strong>{task.identifier} · {task.title}</strong><span>{task.dueDate} · {t[task.status]}</span></button>)}</section>{storage !== undefined && <section className="dsh-taskboard-storage" data-status={storage.status}><header><h2>{t.storageHealth}</h2><strong>{storage.status === 'ok' ? t.healthy : t.degraded}</strong></header><span>SQLite: {storage.integrity} · schema v{storage.schemaVersion} · revision {storage.globalRevision}</span><span>{storage.taskCount} {t.tasksWord} · {storage.attachmentCount} {t.attachments} · {storage.attachmentBytes} {t.bytes}</span><span>{t.cleanupPending}: {storage.cleanupPending} · {t.orphanedClaims}: {storage.orphanedClaims}</span></section>}<section className="dsh-taskboard-automation"><header><h2>{t.automation}</h2><button type="button" aria-expanded={adding} onClick={() => { setAdding(value => !value) }}>＋ {t.addAutomation}</button></header>{adding && <form className="dsh-taskboard-automation-form" onSubmit={add}><label>{t.agentPreset}<input value={agentPreset} onChange={event => { setAgentPreset(event.target.value) }} /></label><label>{t.modelRoute}<input value={modelRoute} onChange={event => { setModelRoute(event.target.value) }} /></label><label>{t.reasoning}<input value={reasoning} onChange={event => { setReasoning(event.target.value) }} /></label><label>{t.intervalSeconds}<input type="number" min={minimumIntervalSeconds} value={intervalSeconds} onChange={event => { setIntervalSeconds(Math.max(minimumIntervalSeconds, Number(event.target.value) || minimumIntervalSeconds)) }} /></label><label>{t.workers}<input type="number" min="1" value={concurrencyLimit} onChange={event => { setConcurrencyLimit(Math.max(1, Number(event.target.value) || 1)) }} /></label><label>{t.quota}<select value={quotaPolicy} onChange={event => { setQuotaPolicy(event.target.value as typeof quotaPolicy) }}><option value="pause-on-uncertain">{t.pauseUncertain}</option><option value="ignore">{t.ignore}</option></select></label><label><input type="checkbox" checked={autoPauseOnEmpty} onChange={event => { setAutoPauseOnEmpty(event.target.checked) }} />{t.autoPauseEmpty}</label><button type="submit">{t.create}</button><button type="button" onClick={() => { setAdding(false) }}>{t.close}</button></form>}{automations.length === 0 ? <p>{t.empty}</p> : automations.map(rule => <AutomationEditor key={rule.id} rule={rule} minimumIntervalSeconds={minimumIntervalSeconds} mutate={mutate} />)}</section></>
}

function AutomationEditor({ rule, minimumIntervalSeconds, mutate }: { rule: AutomationRule; minimumIntervalSeconds: number; mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<void> }) {
  const t = strings()
  const [editing, setEditing] = useState(false)
  const [config, setConfig] = useState(rule.config)
  useEffect(() => { setConfig(rule.config) }, [rule.version])
  const update = (next: AutomationRule['config']): void => { setConfig(next) }
  const setOptional = (key: 'modelRoute' | 'reasoning', value: string): void => {
    const { modelRoute, reasoning, ...required } = config
    update({ ...required, ...(key === 'modelRoute' && value !== '' ? { modelRoute: value } : {}), ...(key === 'reasoning' && value !== '' ? { reasoning: value } : {}), ...(key !== 'modelRoute' && modelRoute !== undefined ? { modelRoute } : {}), ...(key !== 'reasoning' && reasoning !== undefined ? { reasoning } : {}) })
  }
  return <article><div><strong>{rule.config.agentPreset}</strong><span>{rule.state} · {rule.config.concurrencyLimit} {t.workers} · {rule.config.intervalMs / 1000}s</span></div><div><small>{t.nextRun}: {rule.nextEligibleAt === undefined ? '—' : new Date(rule.nextEligibleAt).toLocaleString()}</small><small>{t.lastDecision}: {rule.lastDecision?.kind ?? '—'} · {rule.lastDecision?.message ?? '—'}</small><small>{t.model}: {rule.config.modelRoute ?? t.hostDefault} · {t.reasoning}: {rule.config.reasoning ?? t.hostDefault} · {t.quota}: {rule.config.quotaPolicy} · {t.empty}: {rule.config.autoPauseOnEmpty ? t.pause : t.stayEnabled}</small></div><div><button type="button" onClick={() => { void mutate('automation.update', { automationId: rule.id, expectedVersion: rule.version, update: { state: rule.state === 'enabled' ? 'paused' : 'enabled' } }) }}>{rule.state === 'enabled' ? t.pause : t.enable}</button><button type="button" aria-expanded={editing} onClick={() => { setEditing(value => !value) }}>{t.save}</button></div>{editing && <form className="dsh-taskboard-automation-form" onSubmit={event => { event.preventDefault(); void mutate('automation.update', { automationId: rule.id, expectedVersion: rule.version, update: { config } }).then(() => { setEditing(false) }) }}><label>{t.agentPreset}<input value={config.agentPreset} onChange={event => { update({ ...config, agentPreset: event.target.value }) }} /></label><label>{t.modelRoute}<input value={config.modelRoute ?? ''} onChange={event => { setOptional('modelRoute', event.target.value.trim()) }} /></label><label>{t.reasoning}<input value={config.reasoning ?? ''} onChange={event => { setOptional('reasoning', event.target.value.trim()) }} /></label><label>{t.intervalSeconds}<input type="number" min={minimumIntervalSeconds} value={config.intervalMs / 1000} onChange={event => { update({ ...config, intervalMs: Math.max(minimumIntervalSeconds, Number(event.target.value) || minimumIntervalSeconds) * 1000 }) }} /></label><label>{t.workers}<input type="number" min="1" value={config.concurrencyLimit} onChange={event => { update({ ...config, concurrencyLimit: Math.max(1, Number(event.target.value) || 1) }) }} /></label><label>{t.quota}<select value={config.quotaPolicy} onChange={event => { update({ ...config, quotaPolicy: event.target.value as AutomationRule['config']['quotaPolicy'] }) }}><option value="pause-on-uncertain">{t.pauseUncertain}</option><option value="ignore">{t.ignore}</option></select></label><label><input type="checkbox" checked={config.autoPauseOnEmpty} onChange={event => { update({ ...config, autoPauseOnEmpty: event.target.checked }) }} />{t.autoPauseEmpty}</label><button type="submit" disabled={config.agentPreset.trim() === ''}>{t.save}</button><button type="button" onClick={() => { setEditing(false); setConfig(rule.config) }}>{t.close}</button></form>}</article>
}

function Board({ tasks, open, mutate }: {
  tasks: readonly TaskboardTask[]
  open: (task: TaskboardTask) => void
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<void>
}) {
  const t = strings()
  const [draggedId, setDraggedId] = useState<string>()
  const columns = ['todo', 'in_progress', 'in_review'] as const
  const other = tasks.filter(task => !columns.includes(task.status as never) || task.archivedAt !== undefined)
  const reorder = (target: TaskboardTask): void => {
    const dragged = tasks.find(task => task.id === draggedId)
    setDraggedId(undefined)
    if (dragged === undefined || dragged.id === target.id || dragged.status !== target.status) return
    void mutate('task.update', {
      taskId: dragged.id,
      expectedVersion: dragged.version,
      request: { sortOrder: target.sortOrder - 0.5 },
    })
  }
  return <><div className="dsh-taskboard-board">{columns.map(status => <section key={status}><h2>{t[status]} <small>{tasks.filter(task => task.status === status && task.archivedAt === undefined).length}</small></h2>{tasks.filter(task => task.status === status && task.archivedAt === undefined).map(task => <TaskCard key={task.id} task={task} open={open} drag={{ start: () => { setDraggedId(task.id) }, drop: () => { reorder(task) } }} />)}</section>)}</div><section className="dsh-taskboard-other"><h2>{t.other}</h2>{other.length === 0 ? <p>{t.empty}</p> : other.map(task => <TaskCard key={task.id} task={task} open={open} />)}</section></>
}

function TaskCard({ task, open, drag }: {
  task: TaskboardTask
  open: (task: TaskboardTask) => void
  drag?: { start: () => void; drop: () => void }
}) {
  return <button type="button" draggable={drag !== undefined} className="dsh-taskboard-card" onDragStart={drag?.start} onDragOver={event => { if (drag !== undefined) event.preventDefault() }} onDrop={drag?.drop} onClick={() => { open(task) }}><small>{task.identifier} · v{task.version}</small><strong>{task.title}</strong><span>{task.priority}{task.dueDate === undefined ? '' : ` · ${task.dueDate}`}</span></button>
}

function ListView({ tasks, open }: { tasks: readonly TaskboardTask[]; open: (task: TaskboardTask) => void }) {
  const t = strings()
  const [sort, setSort] = useState<'identifier' | 'title' | 'status' | 'priority' | 'dueDate'>('identifier')
  const ordered = [...tasks].sort((left, right) => String(left[sort] ?? '').localeCompare(String(right[sort] ?? ''), undefined, { numeric: true }))
  const heading = (key: typeof sort, label: string) => <button type="button" onClick={() => { setSort(key) }}>{label}{sort === key ? ' ↑' : ''}</button>
  return <div className="dsh-taskboard-table-wrap"><table><thead><tr><th>{heading('identifier', 'ID')}</th><th>{heading('title', t.title)}</th><th>{heading('status', t.status)}</th><th>{heading('priority', t.priority)}</th><th>{heading('dueDate', t.due)}</th></tr></thead><tbody>{ordered.map(task => <tr key={task.id} tabIndex={0} onClick={() => { open(task) }} onKeyDown={event => { if (event.key === 'Enter') open(task) }}><td>{task.identifier}</td><td>{task.title}</td><td>{t[task.status]}</td><td>{task.priority}</td><td>{task.dueDate ?? '—'}</td></tr>)}</tbody></table></div>
}

function Gantt({ tasks, open }: { tasks: readonly TaskboardTask[]; open: (task: TaskboardTask) => void }) {
  const t = strings()
  const [zoom, setZoom] = useState<'month' | 'quarter' | 'year'>('quarter')
  const [showCompleted, setShowCompleted] = useState(false)
  const [anchor, setAnchor] = useState(() => Date.now())
  const days = zoom === 'month' ? 30 : zoom === 'quarter' ? 90 : 365
  const start = anchor - ((days / 2) * 86_400_000)
  const dated = tasks.filter(task => (task.startDate !== undefined || task.dueDate !== undefined) && (showCompleted || task.status !== 'done'))
  const point = (value: string | undefined, fallback: number): number => value === undefined ? fallback : new Date(`${value}T00:00:00`).getTime()
  return <div className="dsh-taskboard-gantt"><header><button type="button" onClick={() => { setAnchor(Date.now()) }}>{t.today}</button><select aria-label={t.ganttZoom} value={zoom} onChange={event => { setZoom(event.target.value as typeof zoom) }}><option value="month">{t.days30}</option><option value="quarter">{t.days90}</option><option value="year">{t.oneYear}</option></select><label><input type="checkbox" checked={showCompleted} onChange={event => { setShowCompleted(event.target.checked) }} />{t.showCompleted}</label></header><div className="dsh-taskboard-today" style={{ left: '50%' }} aria-hidden="true" />{dated.length === 0 ? <div className="dsh-taskboard-empty">{t.noDatedTasks}</div> : dated.map(task => {
    const taskStart = point(task.startDate, point(task.dueDate, anchor))
    const taskEnd = point(task.dueDate, taskStart + 86_400_000)
    const left = Math.max(0, Math.min(100, ((taskStart - start) / (days * 86_400_000)) * 100))
    const width = Math.max(1.5, Math.min(100 - left, ((Math.max(taskEnd, taskStart + 86_400_000) - taskStart) / (days * 86_400_000)) * 100))
    const repeat = task.recurrence === undefined ? '' : ` · ${task.recurrence.frequency}/${task.recurrence.interval}${task.recurrence.until === undefined ? '' : ` until ${task.recurrence.until}`}`
    return <button type="button" key={task.id} onClick={() => { open(task) }}><span>{task.identifier} · {task.title}</span><span className="dsh-taskboard-gantt-track"><i style={{ left: `${left}%`, width: `${width}%` }} /></span><small>{task.startDate ?? '…'} → {task.dueDate ?? '…'}{repeat}</small></button>
  })}</div>
}

function WorkflowEditor({ project, workflows, catalog, capabilities, mutate }: {
  project: TaskboardProject | undefined
  workflows: readonly SavedWorkflow[]
  catalog: TaskboardSnapshot['workflowCatalog']
  capabilities: TaskboardSnapshot['workflowCapabilities'] | undefined
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<void>
}) {
  const t = strings()
  const [selectedId, setSelectedId] = useState<string>()
  const selected = workflows.find(item => item.id === selectedId) ?? workflows[0]
  const [name, setName] = useState('')
  const [document, setDocument] = useState<WorkflowDocument>()
  const stepEntries = catalog.filter(item => item.category !== 'trigger')
  const triggerEntries = catalog.filter(item => item.category === 'trigger')
  const [newWorkflowName, setNewWorkflowName] = useState('')
  const [nodeKind, setNodeKind] = useState('tests')
  const [newTabName, setNewTabName] = useState('')
  const [triggerKind, setTriggerKind] = useState('issue-trigger')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    setSelectedId(selected?.id)
    setName(selected?.name ?? '')
    setDocument(selected?.document)
  }, [selected?.id, selected?.name, selected?.version])
  const create = (event: FormEvent): void => {
    event.preventDefault()
    if (project === undefined || newWorkflowName.trim() === '') return
    const trigger = catalog.find(item => item.kind === 'issue-trigger' && item.category === 'trigger')
    if (trigger === undefined) return
    void mutate('workflow.create', {
      projectId: project.id,
      name: newWorkflowName.trim(),
      document: { tabs: [{ id: 'main', name: 'Main', trigger: { id: 'trigger', kind: trigger.kind, execution: trigger.execution, config: {} }, steps: [] }] },
    }).then(() => { setNewWorkflowName('') })
  }
  const addStep = (): void => {
    if (document === undefined) return
    const entry = catalog.find(item => item.kind === nodeKind)
    if (entry === undefined || entry.category === 'trigger') return
    const first = document.tabs[0]
    if (first === undefined) return
    const node = { id: `${nodeKind}-${Date.now()}`, kind: nodeKind, execution: entry.execution, config: {} } as const
    setDocument(insertWorkflowNode(document, first.id, node))
  }
  const addTab = (): void => {
    if (document === undefined || newTabName.trim() === '') return
    const entry = catalog.find(item => item.kind === triggerKind && item.category === 'trigger')
    if (entry === undefined) return
    const suffix = Date.now()
    setDocument(addWorkflowTab(document, { id: `tab-${suffix}`, name: newTabName.trim(), trigger: { id: `trigger-${suffix}`, kind: triggerKind, execution: entry.execution, config: {} }, steps: [] }))
    setNewTabName('')
  }
  const editNode = (action: 'up' | 'down' | 'copy' | 'delete' | 'true' | 'false', tabId: string, nodeId: string): void => {
    if (document === undefined) return
    if (action === 'up' || action === 'down') setDocument(moveWorkflowNode(document, nodeId, action === 'up' ? -1 : 1))
    else if (action === 'copy') {
      const suffix = Date.now()
      setDocument(copyWorkflowNode(document, nodeId, source => `${source}-copy-${suffix}`))
    } else if (action === 'delete') setDocument(removeWorkflowNode(document, nodeId))
    else {
      const entry = catalog.find(item => item.kind === nodeKind && item.category !== 'trigger')
      if (entry === undefined) return
      setDocument(insertWorkflowNode(document, tabId, { id: `${nodeKind}-${Date.now()}`, kind: nodeKind, execution: entry.execution, config: {} }, nodeId, action === 'true' ? 'trueBranch' : 'falseBranch'))
    }
  }
  const addCapability = (kind: 'skill' | 'mcp', target: string): void => {
    if (document === undefined || document.tabs[0] === undefined) return
    const entry = catalog.find(item => item.kind === kind)
    if (entry === undefined) return
    setDocument(insertWorkflowNode(document, document.tabs[0].id, {
      id: `${kind}-${Date.now()}`, kind, execution: entry.execution, config: { target },
    }))
  }
  return <div className="dsh-taskboard-workflows"><aside><form className="dsh-taskboard-workflow-create" onSubmit={create}><input aria-label="Workflow name" value={newWorkflowName} onChange={event => { setNewWorkflowName(event.target.value) }} placeholder="Workflow name" /><button type="submit" disabled={project === undefined || newWorkflowName.trim() === ''}>＋ {t.addWorkflow}</button></form>{workflows.map(item => <button type="button" className={item.id === selected?.id ? 'active' : ''} key={item.id} onClick={() => { setSelectedId(item.id) }}><strong>{item.name}</strong><small>v{item.version}</small></button>)}</aside><section>{selected === undefined || document === undefined ? <div className="dsh-taskboard-empty">{t.workflowNote}</div> : <><header><input aria-label="Saved workflow name" value={name} onChange={event => { setName(event.target.value) }} /><select aria-label="Node kind" value={nodeKind} onChange={event => { setNodeKind(event.target.value) }}>{stepEntries.map(item => <option key={item.kind} value={item.kind}>{item.kind}</option>)}</select><button type="button" onClick={addStep}>＋ {t.addStep}</button><input aria-label="New tab name" value={newTabName} onChange={event => { setNewTabName(event.target.value) }} placeholder="Tab name" /><select aria-label="Trigger kind" value={triggerKind} onChange={event => { setTriggerKind(event.target.value) }}>{triggerEntries.map(item => <option key={item.kind} value={item.kind}>{item.kind}</option>)}</select><button type="button" disabled={newTabName.trim() === ''} onClick={addTab}>＋ Tab</button><button type="button" onClick={() => { void mutate('workflow.update', { workflowId: selected.id, expectedVersion: selected.version, name, document }) }}>{t.save}</button><button type="button" aria-expanded={confirmDelete} onClick={() => { setConfirmDelete(value => !value) }}>×</button>{confirmDelete && <div className="dsh-taskboard-confirm" role="alert"><span>Delete workflow?</span><button type="button" onClick={() => { void mutate('workflow.delete', { workflowId: selected.id, expectedVersion: selected.version }); setConfirmDelete(false) }}>Delete</button><button type="button" onClick={() => { setConfirmDelete(false) }}>{t.close}</button></div>}</header><div className="dsh-taskboard-workflow-tabs">{document.tabs.map(tab => <article key={tab.id}><header><h3>{tab.name}</h3><button type="button" disabled={document.tabs.length <= 1} onClick={() => { setDocument(removeWorkflowTab(document, tab.id)) }}>× Tab</button></header><WorkflowNodeCard node={tab.trigger} tabId={tab.id} edit={editNode} trigger /><div className="dsh-taskboard-flow-line" />{tab.steps.map(node => <WorkflowNodeCard key={node.id} node={node} tabId={tab.id} edit={editNode} />)}</article>)}</div><footer>{catalog.map(item => <span key={item.kind} data-execution={item.execution}>{item.kind} · {item.execution === 'executable' ? t.executable : t.designOnly}</span>)}</footer><section className="dsh-taskboard-capabilities"><h3>Installed capabilities</h3><small>Skill discovery: {capabilities?.skillDiscoveryComplete === true ? 'complete' : 'refreshing/incomplete'}</small><div>{capabilities?.skills.map(skill => <button type="button" key={`skill-${skill.name}`} title={skill.description} onClick={() => { addCapability('skill', skill.name) }}>＋ Skill · {skill.name}</button>)}</div><div>{capabilities?.mcpTools.map(tool => <button type="button" key={`mcp-${tool.name}`} title={tool.description} onClick={() => { addCapability('mcp', tool.name) }}>＋ MCP · {tool.name}</button>)}</div></section></>}</section></div>
}

function WorkflowNodeCard({ node, tabId, edit, trigger = false }: { node: WorkflowDocument['tabs'][number]['trigger']; tabId: string; edit: (action: 'up' | 'down' | 'copy' | 'delete' | 'true' | 'false', tabId: string, nodeId: string) => void; trigger?: boolean }) {
  const t = strings()
  return <div className="dsh-taskboard-workflow-node" data-execution={node.execution}><strong>{node.kind}</strong><small>{node.execution === 'executable' ? t.executable : t.designOnly}</small>{!trigger && <div className="dsh-taskboard-workflow-node-actions"><button type="button" onClick={() => { edit('up', tabId, node.id) }}>↑</button><button type="button" onClick={() => { edit('down', tabId, node.id) }}>↓</button><button type="button" onClick={() => { edit('copy', tabId, node.id) }}>Copy</button><button type="button" onClick={() => { edit('delete', tabId, node.id) }}>×</button>{node.kind === 'condition' && <><button type="button" onClick={() => { edit('true', tabId, node.id) }}>＋ True</button><button type="button" onClick={() => { edit('false', tabId, node.id) }}>＋ False</button></>}</div>}{node.steps?.map(child => <WorkflowNodeCard key={child.id} node={child} tabId={tabId} edit={edit} />)}{(node.trueBranch !== undefined || node.falseBranch !== undefined) && <div className="dsh-taskboard-branches"><section><b>True</b>{node.trueBranch?.map(child => <WorkflowNodeCard key={child.id} node={child} tabId={tabId} edit={edit} />)}</section><section><b>False</b>{node.falseBranch?.map(child => <WorkflowNodeCard key={child.id} node={child} tabId={tabId} edit={edit} />)}</section></div>}</div>
}

function TaskDetail({ project, task, tasks, workflows, detail, mutate, upload, download, openSession, openNewSession, close }: { project: TaskboardProject | undefined; task: TaskboardTask; tasks: readonly TaskboardTask[]; workflows: readonly SavedWorkflow[]; detail: TaskDetailData | undefined; mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<void>; upload: (file: File, commentId?: string) => Promise<void>; download: (attachmentId: string, filename: string) => Promise<void>; openSession: (sessionId: string) => void; openNewSession: () => Promise<void>; close: () => void }) {
  const t = strings()
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [priority, setPriority] = useState(task.priority)
  const [labels, setLabels] = useState(task.labels.join(', '))
  const [startDate, setStartDate] = useState(task.startDate ?? '')
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [recurrence, setRecurrence] = useState<'' | 'daily' | 'weekly' | 'monthly'>(task.recurrence?.frequency ?? '')
  const [recurrenceInterval, setRecurrenceInterval] = useState(String(task.recurrence?.interval ?? 1))
  const [recurrenceUntil, setRecurrenceUntil] = useState(task.recurrence?.until ?? '')
  const [assignee, setAssignee] = useState(task.assignee ?? '')
  const [workflowId, setWorkflowId] = useState(task.workflowId ?? '')
  const [developmentKind, setDevelopmentKind] = useState<'' | 'branch' | 'worktree'>(task.developmentContext?.kind ?? '')
  const [developmentBranch, setDevelopmentBranch] = useState(task.developmentContext?.branch ?? '')
  const [worktreePath, setWorktreePath] = useState(task.developmentContext?.kind === 'worktree' ? task.developmentContext.path : '')
  const [comment, setComment] = useState('')
  const [relationKind, setRelationKind] = useState<'parent' | 'blocks' | 'related'>('related')
  const [relationTarget, setRelationTarget] = useState('')
  const [pendingAction, setPendingAction] = useState<'' | 'return' | 'block' | 'reopen' | 'takeover'>('')
  const [actionReason, setActionReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const developmentInvalid = developmentKind === 'branch'
    ? developmentBranch.trim() === ''
    : developmentKind === 'worktree' && (developmentBranch.trim() === '' || worktreePath.trim() === '')
  useEffect(() => {
    setTitle(task.title); setDescription(task.description); setPriority(task.priority); setLabels(task.labels.join(', '))
    setStartDate(task.startDate ?? ''); setDueDate(task.dueDate ?? ''); setRecurrence(task.recurrence?.frequency ?? '')
    setRecurrenceInterval(String(task.recurrence?.interval ?? 1)); setRecurrenceUntil(task.recurrence?.until ?? ''); setAssignee(task.assignee ?? '')
    setWorkflowId(task.workflowId ?? ''); setDevelopmentKind(task.developmentContext?.kind ?? ''); setDevelopmentBranch(task.developmentContext?.branch ?? '')
    setWorktreePath(task.developmentContext?.kind === 'worktree' ? task.developmentContext.path : '')
    setComment(''); setPendingAction(''); setActionReason(''); setConfirmDelete(false)
  }, [task])
  const runReasonAction = (): void => {
    const reason = actionReason.trim()
    if (reason === '' || pendingAction === '') return
    const endpoint = pendingAction === 'return' ? 'task.return' : pendingAction === 'block' ? 'task.block' : pendingAction === 'reopen' ? 'task.reopen' : 'task.force-takeover'
    const reasonKey = pendingAction === 'return' ? 'comment' : 'reason'
    void mutate(endpoint, { taskId: task.id, expectedVersion: task.version, [reasonKey]: reason }).then(() => { setPendingAction(''); setActionReason('') })
  }
  const taskLabel = (id: string): string => {
    const match = tasks.find(item => item.id === id)
    return match === undefined ? id : `${match.identifier} · ${match.title}`
  }
  const relationLabel = (relation: TaskDetailData['relations'][number]): string => {
    if (relation.kind === 'related') return `related · ${taskLabel(relation.sourceTaskId === task.id ? relation.targetTaskId : relation.sourceTaskId)}`
    if (relation.kind === 'parent') return relation.sourceTaskId === task.id ? `parent of · ${taskLabel(relation.targetTaskId)}` : `child of · ${taskLabel(relation.sourceTaskId)}`
    return relation.sourceTaskId === task.id ? `blocks · ${taskLabel(relation.targetTaskId)}` : `blocked by · ${taskLabel(relation.sourceTaskId)}`
  }
  return <aside className="dsh-taskboard-detail" aria-label={task.identifier}>
    <header><div><small>{task.identifier} · v{task.version}</small><h2>{task.title}</h2></div><button type="button" onClick={close}>×</button></header>
    <label>{t.title}<input value={title} onChange={event => { setTitle(event.target.value) }} /></label>
    <label>{t.description}<textarea value={description} onChange={event => { setDescription(event.target.value) }} /></label>
    <MarkdownText value={description} />
    <label>{t.priority}<select value={priority} onChange={event => { setPriority(event.target.value as TaskboardTask['priority']) }}>{(['urgent', 'high', 'medium', 'low', 'none'] as const).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <label>{t.labels}<input value={labels} onChange={event => { setLabels(event.target.value) }} /></label>
    <label>{t.assignee}<input value={assignee} onChange={event => { setAssignee(event.target.value) }} /></label>
    <label>{t.workflow}<select value={workflowId} onChange={event => { setWorkflowId(event.target.value) }}><option value="">—</option>{workflows.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>{t.developmentContext}<select value={developmentKind} onChange={event => { setDevelopmentKind(event.target.value as typeof developmentKind) }}><option value="">{t.none}</option><option value="branch">{t.branch}</option><option value="worktree">{t.worktree}</option></select></label>
    {developmentKind !== '' && <label>{t.branch}<input value={developmentBranch} onChange={event => { setDevelopmentBranch(event.target.value) }} /></label>}
    {developmentKind === 'worktree' && <label>{t.worktreePath}<input value={worktreePath} onChange={event => { setWorktreePath(event.target.value) }} /></label>}
    <label>{t.start}<input type="date" value={startDate} onChange={event => { setStartDate(event.target.value) }} /></label>
    <label>{t.due}<input type="date" value={dueDate} onChange={event => { setDueDate(event.target.value) }} /></label>
    <label>{t.recurrence}<select value={recurrence} onChange={event => { setRecurrence(event.target.value as typeof recurrence) }}><option value="">{t.noRecurrence}</option><option value="daily">{t.daily}</option><option value="weekly">{t.weekly}</option><option value="monthly">{t.monthly}</option></select></label>
    {recurrence !== '' && <><label>{t.interval}<input type="number" min="1" value={recurrenceInterval} onChange={event => { setRecurrenceInterval(event.target.value) }} /></label><label>{t.until}<input type="date" value={recurrenceUntil} onChange={event => { setRecurrenceUntil(event.target.value) }} /></label></>}
    <button type="button" disabled={title.trim() === '' || developmentInvalid} title={developmentInvalid ? t.developmentRequired : undefined} onClick={() => { void mutate('task.update', { taskId: task.id, expectedVersion: task.version, request: { title, description, priority, labels: labels.split(',').map(value => value.trim()).filter(Boolean), assignee: assignee.trim() || null, workflowId: workflowId || null, developmentContext: developmentKind === '' ? null : developmentKind === 'branch' ? { kind: 'branch', branch: developmentBranch.trim() } : { kind: 'worktree', branch: developmentBranch.trim(), path: worktreePath.trim() }, startDate: startDate || null, dueDate: dueDate || null, recurrence: recurrence === '' ? null : { frequency: recurrence, interval: Math.max(1, Number.parseInt(recurrenceInterval, 10) || 1), ...(recurrenceUntil === '' ? {} : { until: recurrenceUntil }) } } }) }}>{t.save}</button>
    <div className="dsh-taskboard-actions">
      {task.status === 'backlog' && <button type="button" onClick={() => { void mutate('task.approve', { taskId: task.id, expectedVersion: task.version }) }}>{t.approve}</button>}
      {task.status === 'in_review' && <><button type="button" onClick={() => { void mutate('task.accept', { taskId: task.id, expectedVersion: task.version }) }}>{t.accept}</button><button type="button" onClick={() => { setPendingAction('return') }}>{t.returnWork}</button></>}
      {(task.status === 'todo' || task.status === 'in_progress') && <button type="button" onClick={() => { setPendingAction('block') }}>{t.blocked}</button>}
      {task.status === 'blocked' && <button type="button" onClick={() => { void mutate('task.resume', { taskId: task.id, expectedVersion: task.version }) }}>{t.resume}</button>}
      {(['backlog', 'todo', 'in_progress', 'in_review', 'blocked'] as const).includes(task.status as never) && <button type="button" onClick={() => { void mutate('task.cancel', { taskId: task.id, expectedVersion: task.version }) }}>{t.cancel}</button>}
      {(task.status === 'done' || task.status === 'canceled') && <button type="button" onClick={() => { setPendingAction('reopen') }}>{t.reopen}</button>}
      {detail?.activeClaim !== undefined && <button type="button" onClick={() => { setPendingAction('takeover') }}>{t.takeover}</button>}
      {task.archivedAt === undefined ? <button type="button" onClick={() => { void mutate('task.archive', { taskId: task.id, expectedVersion: task.version }) }}>{t.archive}</button> : <button type="button" onClick={() => { void mutate('task.restore', { taskId: task.id, expectedVersion: task.version }) }}>{t.restore}</button>}
      {task.archivedAt !== undefined && <button type="button" aria-expanded={confirmDelete} onClick={() => { setConfirmDelete(value => !value) }}>{t.delete}</button>}
    </div>
    {pendingAction !== '' && <div className="dsh-taskboard-reason"><label>{t.reason}<textarea autoFocus value={actionReason} onChange={event => { setActionReason(event.target.value) }} /></label><button type="button" disabled={actionReason.trim() === ''} onClick={runReasonAction}>{t.confirm}</button><button type="button" onClick={() => { setPendingAction(''); setActionReason('') }}>{t.close}</button></div>}
    {confirmDelete && <div className="dsh-taskboard-confirm" role="alert"><span>{t.permanentlyDelete} {task.identifier}?</span><button type="button" onClick={() => { void mutate('task.delete', { taskId: task.id, expectedVersion: task.version }); setConfirmDelete(false) }}>{t.delete}</button><button type="button" onClick={() => { setConfirmDelete(false) }}>{t.close}</button></div>}
    <label>{t.comment}<textarea value={comment} onChange={event => { setComment(event.target.value) }} /></label>
    <button type="button" disabled={comment.trim() === ''} onClick={() => { void mutate('task.comment', { taskId: task.id, expectedVersion: task.version, body: comment.trim() }).then(() => { setComment('') }) }}>{t.addComment}</button>
    <label>{t.attachments}<input type="file" onChange={event => { const file = event.target.files?.[0]; if (file !== undefined) void upload(file); event.target.value = '' }} /></label>
    {detail !== undefined && <div className="dsh-taskboard-detail-sections">
      <section><h3>{t.participants}</h3><p>{t.creator}: {task.creator}</p><p>{t.assignee}: {task.assignee ?? '—'}</p><p>{t.actors}: {[...new Set(detail.activities.map(item => item.actorId))].join(', ') || '—'}</p></section>
      <section><h3>{t.comments}</h3>{detail.comments.length === 0 ? <p>{t.empty}</p> : detail.comments.map(item => <article key={item.id}><strong>{item.authorId}</strong><MarkdownText value={item.body} /><label>{t.attachComment}<input type="file" onChange={event => { const file = event.target.files?.[0]; if (file !== undefined) void upload(file, item.id); event.target.value = '' }} /></label>{detail.attachments.filter(attachment => attachment.commentId === item.id).map(attachment => <span key={attachment.id}><button type="button" onClick={() => { void download(attachment.id, attachment.filename) }}>{attachment.filename}</button><button type="button" onClick={() => { void mutate('attachment.delete', { taskId: task.id, expectedVersion: task.version, attachmentId: attachment.id }) }}>{t.delete}</button></span>)}</article>)}</section>
      <section><h3>{t.attachments}</h3>{detail.attachments.filter(item => item.commentId === undefined).length === 0 ? <p>{t.empty}</p> : detail.attachments.filter(item => item.commentId === undefined).map(item => <article key={item.id}><button type="button" onClick={() => { void download(item.id, item.filename) }}>{item.filename}</button><small>{item.contentType} · {item.byteSize} {t.bytes}</small><button type="button" onClick={() => { void mutate('attachment.delete', { taskId: task.id, expectedVersion: task.version, attachmentId: item.id }) }}>{t.delete}</button></article>)}</section>
      <section><h3>{t.relations}</h3><div className="dsh-taskboard-relation-create"><select aria-label={t.relationKind} value={relationKind} onChange={event => { setRelationKind(event.target.value as typeof relationKind) }}><option value="parent">parent</option><option value="blocks">blocks</option><option value="related">related</option></select><select aria-label={t.relatedTask} value={relationTarget} onChange={event => { setRelationTarget(event.target.value) }}><option value="">{t.selectTask}</option>{tasks.filter(item => item.id !== task.id && item.projectId === task.projectId).map(item => <option key={item.id} value={item.id}>{item.identifier} · {item.title}</option>)}</select><button type="button" disabled={relationTarget === ''} onClick={() => { void mutate('task.relation', { taskId: task.id, expectedVersion: task.version, targetTaskId: relationTarget, kind: relationKind }).then(() => { setRelationTarget('') }) }}>{t.add}</button></div>{detail.relations.length === 0 ? <p>{t.empty}</p> : detail.relations.map(item => { const sourceVersion = tasks.find(candidate => candidate.id === item.sourceTaskId)?.version; return <article key={item.id}><strong>{relationLabel(item)}</strong><small>{item.sourceTaskId} → {item.targetTaskId}</small><button type="button" disabled={sourceVersion === undefined} onClick={() => { if (sourceVersion !== undefined) void mutate('relation.delete', { relationId: item.id, expectedVersion: sourceVersion }) }}>{t.delete}</button></article> })}</section>
      <section><h3>{t.sessions}</h3><button type="button" disabled={project?.workspaceId === undefined} title={project?.workspaceId === undefined ? t.workspaceRequired : undefined} onClick={() => { void openNewSession() }}>{t.newSession}</button>{detail.claims.length === 0 ? <p>{t.empty}</p> : detail.claims.map(item => {
        const runtime = detail.sessionRuntime?.find(value => value.sessionId === item.sessionId)
        return <article key={item.id}><button type="button" onClick={() => { openSession(item.sessionId) }}>{t.openSession}: {item.sessionId}</button><small>{item.state} · {runtime?.status ?? t.offline}{runtime?.current === true ? ` · ${t.current}` : ''}</small>{(runtime?.todos ?? []).map((todo, index) => <span key={`${todo.content}-${index}`}>{todo.status}: {todo.content}</span>)}</article>
      })}</section>
      <section><h3>{t.activity}</h3>{detail.activities.map(item => <article key={item.id}><strong>{item.kind}</strong><small>{item.actorId} · {new Date(item.createdAt).toLocaleString()}</small></article>)}</section>
    </div>}
  </aside>
}

function MarkdownText({ value }: { value: string }) {
  const blocks = value.split(/\n{2,}/).filter(Boolean)
  return <div className="dsh-taskboard-markdown">{blocks.map((block, index) => {
    const lines = block.split('\n')
    if (lines.every(line => /^[-*] /.test(line))) return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{line.slice(2)}</li>)}</ul>
    if (block.startsWith('```') && block.endsWith('```')) return <pre key={index}><code>{block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre>
    return <p key={index}>{block}</p>
  })}</div>
}

/** Browser plugin registration; generated Remote contribution and both slots unwind together. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const remote = ctx.get('remote') as unknown as TypertClientRemote
  const unmountRemote = await remote.$mount(taskboardRemote)
  ctx.inject(['remote.taskboard'], (remoteCtx) => {
    const sessions = remoteCtx.get('sessions') as unknown as ISessions
    const workspaces = remoteCtx.get('workspaces') as unknown as IWorkspaces
    const conversation = remoteCtx.get('conversation') as unknown as ConversationDraftPort
    const mountedRemote = remoteCtx.get('remote') as unknown as TypertClientRemote
    const controller = new TaskboardClientController(
      connection,
      mountedRemote.taskboard,
      sessionId => { sessions.open(sessionId as never) },
      async (workspaceId, draft) => {
        const sessionId = await workspaces.connectWorkspace(workspaceId as never)
        const scoped = sessions.scope(sessionId)
        if (scoped === undefined) throw new Error(`Unable to resolve the new Session ${sessionId}`)
        conversation.input.for(scoped).setDraft(draft)
        sessions.open(sessionId)
        return sessionId
      },
    )
    remoteCtx.effect(() => () => { controller.dispose() }, 'taskboard client controller')
    const Nav = (props: PropsRuntime<'sidebar.footer.action'>) => <TaskboardNavButton {...props} controller={controller} />
    const Page = (props: PropsRuntime<'shell.overlay'>) => <TaskboardPage {...props} controller={controller} workspaces={workspaces} />
    remoteCtx.slots.inject('sidebar.footer.action', () => remoteCtx.slots.register({ name: 'sidebar.footer.action', id: 'taskboard.navigation' }, Nav))
    remoteCtx.slots.inject('shell.overlay', () => remoteCtx.slots.register({ name: 'shell.overlay', id: 'taskboard.page' }, Page))
  })
  return unmountRemote
}

const STYLES = `
.dsh-taskboard-nav{width:100%;min-height:36px;display:flex;align-items:center;gap:8px;padding:7px 10px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary,#222);cursor:pointer;font:inherit}.dsh-taskboard-nav:hover,.dsh-taskboard-nav[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,#e8e8e8)}
.dsh-taskboard-filters{display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#ddd)}.dsh-taskboard-filters input{flex:1;min-width:120px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;background:transparent}.dsh-taskboard-filters select{padding:7px 9px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;background:transparent}
.dsh-taskboard-page{position:absolute;top:0;right:0;bottom:0;z-index:1;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#171717);font:14px/1.45 system-ui,sans-serif;border-left:1px solid var(--dsw-alias-border-l1,#ddd)}
.dsh-taskboard-page button,.dsh-taskboard-page input,.dsh-taskboard-page textarea,.dsh-taskboard-page select{font:inherit;color:inherit}.dsh-taskboard-page button{cursor:pointer}.dsh-taskboard-header{height:58px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#ddd)}.dsh-taskboard-brand{display:flex;gap:8px;align-items:center;margin-right:auto;font-size:16px}.dsh-taskboard-header button,.dsh-taskboard-header select,.dsh-taskboard-tabs button,.dsh-taskboard-create button,.dsh-taskboard-detail button{border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;background:var(--dsw-alias-button-elevated-fill,#f7f7f7);padding:7px 10px}.dsh-taskboard-tabs{display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#ddd)}.dsh-taskboard-tabs button[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover,#e7efff);border-color:#6186d8}.dsh-taskboard-error{padding:8px 16px;background:#b4231820;color:#b42318}.dsh-taskboard-loading,.dsh-taskboard-empty{padding:32px;text-align:center;color:var(--dsw-alias-label-secondary,#666)}.dsh-taskboard-content{display:flex;flex:1;min-height:0}.dsh-taskboard-view{flex:1;min-width:0;overflow:auto;padding:16px}.dsh-taskboard-create{display:flex;gap:8px;margin-bottom:16px}.dsh-taskboard-create input{flex:1;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;background:transparent}.dsh-taskboard-dashboard{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px}.dsh-taskboard-dashboard div{display:flex;flex-direction:column;padding:20px;border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:12px}.dsh-taskboard-dashboard strong{font-size:30px}.dsh-taskboard-dashboard span{color:var(--dsw-alias-label-secondary,#666)}.dsh-taskboard-board{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:12px}.dsh-taskboard-board section,.dsh-taskboard-other{min-width:0;padding:10px;border-radius:12px;background:var(--dsw-specific-sidebar-fill,#f6f6f6)}.dsh-taskboard-board h2,.dsh-taskboard-other h2{font-size:14px;margin:0 0 10px}.dsh-taskboard-card{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:5px;margin-bottom:8px;padding:10px;text-align:left;border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:9px;background:var(--dsw-alias-bg-base,#fff)}.dsh-taskboard-card:hover{border-color:#6186d8}.dsh-taskboard-card small,.dsh-taskboard-card span{color:var(--dsw-alias-label-secondary,#666)}.dsh-taskboard-other{margin-top:14px}.dsh-taskboard-other .dsh-taskboard-card{display:inline-flex;width:min(280px,100%);margin-right:8px}.dsh-taskboard-table-wrap{overflow:auto}.dsh-taskboard-table-wrap table{width:100%;border-collapse:collapse}.dsh-taskboard-table-wrap th,.dsh-taskboard-table-wrap td{padding:10px;border-bottom:1px solid var(--dsw-alias-border-l1,#ddd);text-align:left}.dsh-taskboard-table-wrap tbody tr{cursor:pointer}.dsh-taskboard-table-wrap tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover,#eee)}.dsh-taskboard-gantt{position:relative;display:flex;flex-direction:column;gap:8px}.dsh-taskboard-gantt>header{display:flex;align-items:center;gap:10px}.dsh-taskboard-gantt>header label{display:flex;align-items:center;gap:5px}.dsh-taskboard-gantt>button{display:grid;grid-template-columns:220px 1fr minmax(180px,auto);gap:12px;align-items:center;text-align:left;border:0;background:transparent}.dsh-taskboard-gantt-track{position:relative;display:block;height:16px;border-radius:8px;background:var(--dsw-specific-sidebar-fill,#eee);overflow:hidden}.dsh-taskboard-gantt-track i{position:absolute;top:2px;display:block;height:12px;border-radius:6px;background:#5b7fc7}.dsh-taskboard-today{position:absolute;top:42px;bottom:0;width:1px;background:#cf222e55;pointer-events:none}.dsh-taskboard-gantt small{color:var(--dsw-alias-label-secondary,#666)}.dsh-taskboard-detail{width:min(380px,42vw);box-sizing:border-box;overflow:auto;padding:16px;border-left:1px solid var(--dsw-alias-border-l1,#ddd);background:var(--dsw-specific-sidebar-fill,#fafafa)}.dsh-taskboard-detail header{display:flex;justify-content:space-between}.dsh-taskboard-detail h2{margin:4px 0 16px}.dsh-taskboard-detail label{display:flex;flex-direction:column;gap:5px;margin:12px 0;color:var(--dsw-alias-label-secondary,#666)}.dsh-taskboard-detail input,.dsh-taskboard-detail textarea,.dsh-taskboard-detail select{padding:8px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;background:var(--dsw-alias-bg-base,#fff)}.dsh-taskboard-detail textarea{min-height:90px;resize:vertical}.dsh-taskboard-actions{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.dsh-taskboard-automation{margin-top:18px}.dsh-taskboard-automation>header,.dsh-taskboard-automation article{display:flex;align-items:center;gap:12px}.dsh-taskboard-automation>header{justify-content:space-between}.dsh-taskboard-automation article{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1,#ddd)}.dsh-taskboard-automation article>div{display:flex;flex:1;flex-direction:column}.dsh-taskboard-automation article small,.dsh-taskboard-automation article span{color:var(--dsw-alias-label-secondary,#666)}
.dsh-taskboard-storage{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px;padding:12px;border:1px solid #1a7f3770;border-radius:10px;background:#dafbe160}.dsh-taskboard-storage[data-status=degraded]{border-color:#9a6700;background:#fff8c570}.dsh-taskboard-storage header{display:flex;flex:1 0 100%;align-items:center;justify-content:space-between}.dsh-taskboard-storage h2{margin:0;font-size:14px}.dsh-taskboard-storage span{color:var(--dsw-alias-label-secondary,#666)}
.dsh-taskboard-workflows{display:grid;grid-template-columns:190px 1fr;min-height:420px;border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:12px;overflow:hidden}.dsh-taskboard-workflows>aside{display:flex;flex-direction:column;gap:6px;padding:10px;background:var(--dsw-specific-sidebar-fill,#f6f6f6)}.dsh-taskboard-workflows>aside button{display:flex;justify-content:space-between;padding:9px;border:1px solid transparent;border-radius:7px;background:transparent;text-align:left}.dsh-taskboard-workflows>aside button.active{border-color:#6186d8;background:var(--dsw-alias-bg-base,#fff)}.dsh-taskboard-workflows>section{padding:14px;overflow:auto}.dsh-taskboard-workflows>section>header{display:flex;gap:8px}.dsh-taskboard-workflows>section>header input{flex:1;padding:8px}.dsh-taskboard-workflow-tabs{display:flex;gap:20px;padding:20px 0}.dsh-taskboard-workflow-tabs>article{min-width:240px}.dsh-taskboard-workflow-node{margin:8px 0;padding:11px;border:2px solid #9a6700;border-radius:10px;background:#fff8c5}.dsh-taskboard-workflow-node[data-execution=executable]{border-color:#1a7f37;background:#dafbe1}.dsh-taskboard-workflow-node>small{display:block;color:var(--dsw-alias-label-secondary,#666)}.dsh-taskboard-flow-line{height:20px;margin-left:28px;border-left:2px solid #aaa}.dsh-taskboard-branches{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.dsh-taskboard-workflows footer{display:flex;flex-wrap:wrap;gap:5px}.dsh-taskboard-workflows footer span{padding:3px 6px;border-radius:5px;background:#fff8c5;font-size:11px}.dsh-taskboard-workflows footer span[data-execution=executable]{background:#dafbe1}
.dsh-taskboard-workflow-tabs>article>header{display:flex;align-items:center;justify-content:space-between}.dsh-taskboard-workflow-node-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}.dsh-taskboard-workflow-node-actions button{padding:2px 5px;border:1px solid #9a670080;border-radius:4px;background:transparent;font-size:11px}
.dsh-taskboard-capabilities{margin-top:14px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,#ddd)}.dsh-taskboard-capabilities h3{margin:0 0 5px}.dsh-taskboard-capabilities>div{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.dsh-taskboard-capabilities button{padding:4px 7px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:6px;background:transparent}
.dsh-taskboard-detail-sections{margin-top:18px}.dsh-taskboard-detail-sections section{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1,#ddd)}.dsh-taskboard-detail-sections h3{margin:0 0 8px;font-size:13px}.dsh-taskboard-detail-sections article{display:flex;flex-direction:column;padding:7px 0}.dsh-taskboard-detail-sections article p{margin:3px 0;white-space:pre-wrap}.dsh-taskboard-detail-sections small{color:var(--dsw-alias-label-secondary,#666);overflow-wrap:anywhere}.dsh-taskboard-detail-sections section>button{display:block;width:100%;margin:4px 0;text-align:left;overflow-wrap:anywhere}
.dsh-taskboard-markdown{overflow-wrap:anywhere}.dsh-taskboard-markdown p{white-space:pre-wrap}.dsh-taskboard-markdown pre{overflow:auto;padding:8px;border-radius:6px;background:#0000000d}.dsh-taskboard-table-wrap th button{border:0;background:transparent;font-weight:700;cursor:pointer}
.dsh-taskboard-popover{position:relative}.dsh-taskboard-popover>form,.dsh-taskboard-confirm{position:absolute;top:calc(100% + 6px);right:0;z-index:10;display:flex;flex-direction:column;gap:8px;width:280px;padding:12px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:10px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 8px 24px #0002}.dsh-taskboard-popover form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-popover form input,.dsh-taskboard-popover form select{padding:7px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:7px;background:var(--dsw-alias-bg-base,#fff)}.dsh-taskboard-popover form div,.dsh-taskboard-inline-form{display:flex;gap:7px}.dsh-taskboard-confirm{position:relative;top:auto;right:auto;width:auto;margin:8px 0}.dsh-taskboard-reason{padding:10px;border:1px solid #9a670080;border-radius:8px;background:#fff8c560}.dsh-taskboard-relation-create{display:grid;grid-template-columns:auto 1fr auto;gap:5px}.dsh-taskboard-inline-form{align-items:end;padding:10px 0}.dsh-taskboard-inline-form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-workflows>section>header{position:relative;flex-wrap:wrap}.dsh-taskboard-workflows>section>header input{min-width:120px}.dsh-taskboard-workflow-create{display:flex;flex-direction:column;gap:5px}.dsh-taskboard-workflow-create input{min-width:0;padding:7px}.dsh-taskboard-detail-sections article>span{display:flex;align-items:center;gap:5px}.dsh-taskboard-detail-sections article>span button:first-child{flex:1;text-align:left}
.dsh-taskboard-summary,.dsh-taskboard-due{display:flex;flex-direction:column;gap:6px;margin-top:14px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px}.dsh-taskboard-summary h2,.dsh-taskboard-due h2{margin:0}.dsh-taskboard-due button{display:flex;justify-content:space-between;gap:12px;padding:8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);background:transparent;text-align:left}.dsh-taskboard-automation-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;flex:1 0 100%;padding:10px 0}.dsh-taskboard-automation-form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-automation-form label:has(input[type="checkbox"]){flex-direction:row;align-items:center}.dsh-taskboard-automation article{flex-wrap:wrap}.dsh-taskboard-automation article>div:last-of-type{display:flex;flex:0 0 auto;flex-direction:row;gap:6px}
@media(max-width:900px){.dsh-taskboard-page{left:0!important}.dsh-taskboard-dashboard{grid-template-columns:repeat(2,1fr)}.dsh-taskboard-board{grid-template-columns:1fr}.dsh-taskboard-detail{position:absolute;inset:58px 0 0 auto;width:min(440px,100%);z-index:3}.dsh-taskboard-header{gap:5px}.dsh-taskboard-header button{padding:6px}.dsh-taskboard-gantt button{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.dsh-taskboard-page *{scroll-behavior:auto!important;transition:none!important}}
`
