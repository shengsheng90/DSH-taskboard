import type { AutomationDecision, TaskPriority } from '../domain/index.js'

export const TASKBOARD_LOCALE_NS = 'taskboard'

const zh = {
  taskboard: '任务板', close: '关闭任务板', newTask: '新建任务', title: '标题', description: '描述', create: '创建',
  dashboard: '概览', board: '看板', list: '列表', gantt: '甘特', workflows: '工作流', other: '其他任务',
  backlog: '待批准', todo: '待办', in_progress: '进行中', in_review: '待评审', blocked: '已阻塞', done: '已完成', canceled: '已取消',
  empty: '暂无任务', noProject: '还没有项目，请先创建一个项目', refresh: '刷新', approve: '批准开工', accept: '验收完成', archive: '归档', restore: '恢复', save: '保存', closeDetail: '关闭详情', dismiss: '关闭',
  comment: '评论', addComment: '添加评论', project: '项目', addProject: '新建项目', projectName: '项目名称', projectKey: '项目代号',
  due: '截止', recentTasks: '最近任务', priority: '优先级', loading: '正在读取本地任务数据…', workflowNote: '保存的工作流会作为 Agent 执行指引加入任务上下文；节点不会由调度器自动运行。', search: '搜索任务', allStatuses: '全部状态', deleteProject: '删除项目', editProject: '编辑项目', newSession: '在新会话中打开', workspaceRequired: '请先为项目映射 Workspace', sessionTaskMustBeActive: '请先批准或恢复任务，再启动关联会话。',
  comments: '评论记录', activity: '活动', attachments: '附件', relations: '关系', sessions: '关联会话', automation: '自动化', enable: '启用', pause: '暂停', nextRun: '下次运行', lastDecision: '最近决策', addAutomation: '新建自动化', addWorkflow: '新建工作流', addStep: '添加步骤', designOnly: '仅设计', executable: '可执行', returnWork: '退回修改', openSession: '打开会话', storageHealth: '本地存储健康', healthy: '正常', degraded: '需处理', cleanupPending: '待清理附件', orphanedClaims: '孤儿认领', undo: '撤销上次编辑', today: '今天', showCompleted: '显示已完成', recurrence: '重复', noRecurrence: '不重复', interval: '间隔', until: '截止重复', write: '编写', preview: '预览', edit: '编辑', markdownToolbar: 'Markdown 工具栏', mdHeading: '标题', mdBold: '加粗', mdItalic: '斜体', mdQuote: '引用', mdCode: '代码', mdLink: '链接', mdBullet: '无序列表', mdNumber: '有序列表', descriptionPlaceholder: '使用 Markdown 编写任务详情', openIssue: '打开', closedIssue: '已关闭', opened: '创建了', commentPlaceholder: '使用 Markdown 编写评论', attachFiles: '粘贴、拖放或选择要附加的文件', noneYet: '暂无', noOne: '未指定', noDate: '无日期', targetDate: '目标日期', closeIssue: '关闭任务',
  labels: '标签', unlabeled: '未标签', addLabel: '新建标签', renameLabel: '重命名标签', deleteLabel: '删除标签', noLabels: '暂无标签', labelName: '标签名称', unlabeledTasks: '未标签任务', edited: '已编辑', workspaceId: 'Harness Workspace ID', blankGlobal: '留空表示全局项目', globalProject: '全局项目', workspace: 'Workspace', noProjectLabels: '无项目标签', tasksWord: '个任务', activeWord: '进行中', agentPreset: 'Agent 预设', modelRoute: '模型路由', reasoning: '推理强度', intervalSeconds: '间隔（秒）', workers: '工作器数', quota: '配额策略', pauseUncertain: '配额不确定时暂停', ignore: '忽略', autoPauseEmpty: '无任务时自动暂停', model: '模型', hostDefault: 'Host 默认', stayEnabled: '保持启用', status: '状态', ganttZoom: '甘特缩放', days30: '30 天', days90: '90 天', oneYear: '1 年', noDatedTasks: '暂无已排期任务', workflowName: '工作流名称', nodeKind: '节点类型', newTabName: '新标签页名称', triggerKind: '触发器类型', tab: '标签页', deleteWorkflow: '删除工作流', installedCapabilities: '已安装能力', skillDiscovery: 'Skill 发现', completeWord: '已完成', refreshing: '刷新中/不完整', skill: 'Skill', mcp: 'MCP', copy: '复制', trueLabel: '真', falseLabel: '假', assignee: '负责人', workflow: '工作流', developmentContext: '开发上下文', none: '无', branch: '分支', worktree: 'Worktree', worktreePath: 'Worktree 路径', start: '开始', daily: '每天', weekly: '每周', monthly: '每月', developmentRequired: '当前开发上下文需要分支和 Worktree 路径。', resume: '恢复', cancel: '取消', reopen: '重新打开', takeover: '强制接管', delete: '删除', confirm: '确认', reason: '原因', permanentlyDelete: '永久删除', participants: '参与者', creator: '创建者', actors: '操作者', attachComment: '附加到评论', relationKind: '关系类型', relatedTask: '关联任务', selectTask: '选择任务', add: '添加', bytes: '字节', current: '当前', offline: '离线',
  urgent: '紧急', high: '高', medium: '中', low: '低',
  enabled: '已启用', paused: '已暂停',
  more: '更多', moreRemaining: '还有 {count} 个', modify: '修改', runNow: '立即执行',
  recheckIntegrity: '重新校验', lastChecked: '上次校验', never: '尚未校验',
  tasksTruncated: '仅显示 {shown} / {total} 个任务，请用搜索或状态筛选缩小范围。',
  relationSourceUnloaded: '关系源任务未加载，请先用搜索定位该任务',
  showPreview: '预览', hidePreview: '收起预览', cleanupStalled: '清理失败已放弃',
  unsavedChanges: '未保存的修改', unsavedBody: '这个任务有未保存的修改，关闭后会丢失。', discardChanges: '放弃修改', keepEditing: '继续编辑',
  automationLog: '自动化运行日志',
  automationClaimed: '读取待办并开始执行 {task}',
  automationEmpty: '已检查待办，当前没有可执行的任务',
  automationFull: '工作器已满，本次未启动新任务',
  automationBlocked: '已检查待办，任务因依赖未完成而跳过',
  automationQuota: '配额不确定，已暂停新认领',
  automationError: '执行失败：{message}',
  openedMinutesAgo: '创建了 {count} 分钟前',
  openedHoursAgo: '创建了 {count} 小时前',
  openedDaysAgo: '创建了 {count} 天前',
  openedOnDate: '创建了 {date}',
} as const

const en = {
  taskboard: 'Taskboard', close: 'Close Taskboard', newTask: 'New task', title: 'Title', description: 'Description', create: 'Create',
  dashboard: 'Dashboard', board: 'Board', list: 'List', gantt: 'Gantt', workflows: 'Workflows', other: 'Other Tasks',
  backlog: 'Backlog', todo: 'Todo', in_progress: 'In progress', in_review: 'In review', blocked: 'Blocked', done: 'Done', canceled: 'Canceled',
  empty: 'No tasks', noProject: 'No project yet — create one to start adding tasks', refresh: 'Refresh', approve: 'Approve for work', accept: 'Accept', archive: 'Archive', restore: 'Restore', save: 'Save', closeDetail: 'Close details', dismiss: 'Close',
  comment: 'Comment', addComment: 'Add comment', project: 'Project', addProject: 'New project', projectName: 'Project name', projectKey: 'Project key',
  due: 'Due', recentTasks: 'Recent tasks', priority: 'Priority', loading: 'Reading local task data…', workflowNote: 'Saved workflows are added to the Agent task context as execution guidance; the scheduler does not run nodes automatically.', search: 'Search tasks', allStatuses: 'All statuses', deleteProject: 'Delete project', editProject: 'Edit project', newSession: 'Open in new session', workspaceRequired: 'Map a Workspace to this project first', sessionTaskMustBeActive: 'Approve or resume the task before starting a linked Session.',
  comments: 'Comments', activity: 'Activity', attachments: 'Attachments', relations: 'Relations', sessions: 'Linked sessions', automation: 'Automation', enable: 'Enable', pause: 'Pause', nextRun: 'Next run', lastDecision: 'Last decision', addAutomation: 'New automation', addWorkflow: 'New workflow', addStep: 'Add step', designOnly: 'Design only', executable: 'Executable', returnWork: 'Return for rework', openSession: 'Open session', storageHealth: 'Local storage health', healthy: 'Healthy', degraded: 'Needs attention', cleanupPending: 'Pending attachment cleanup', orphanedClaims: 'Orphaned claims', undo: 'Undo last edit', today: 'Today', showCompleted: 'Show completed', recurrence: 'Recurrence', noRecurrence: 'None', interval: 'Interval', until: 'Repeat until', write: 'Write', preview: 'Preview', edit: 'Edit', markdownToolbar: 'Markdown toolbar', mdHeading: 'Heading', mdBold: 'Bold', mdItalic: 'Italic', mdQuote: 'Quote', mdCode: 'Code', mdLink: 'Link', mdBullet: 'Bullet list', mdNumber: 'Numbered list', descriptionPlaceholder: 'Write the task details in Markdown', openIssue: 'Open', closedIssue: 'Closed', opened: 'opened', commentPlaceholder: 'Use Markdown to format your comment', attachFiles: 'Paste, drop, or choose files to attach', noneYet: 'None yet', noOne: 'No one', noDate: 'No date', targetDate: 'Target date', closeIssue: 'Close issue',
  labels: 'Labels', unlabeled: 'No label', addLabel: 'New label', renameLabel: 'Rename label', deleteLabel: 'Delete label', noLabels: 'No labels yet', labelName: 'Label name', unlabeledTasks: 'Unlabeled tasks', edited: 'edited', workspaceId: 'Harness Workspace ID', blankGlobal: 'Blank = global project', globalProject: 'Global project', workspace: 'Workspace', noProjectLabels: 'No project labels', tasksWord: 'tasks', activeWord: 'active', agentPreset: 'Agent preset', modelRoute: 'Model route', reasoning: 'Reasoning', intervalSeconds: 'Interval (seconds)', workers: 'Workers', quota: 'Quota', pauseUncertain: 'Pause when uncertain', ignore: 'Ignore', autoPauseEmpty: 'Auto-pause when empty', model: 'Model', hostDefault: 'host default', stayEnabled: 'stay enabled', status: 'Status', ganttZoom: 'Gantt zoom', days30: '30 days', days90: '90 days', oneYear: '1 year', noDatedTasks: 'No dated tasks', workflowName: 'Workflow name', nodeKind: 'Node kind', newTabName: 'New tab name', triggerKind: 'Trigger kind', tab: 'Tab', deleteWorkflow: 'Delete workflow', installedCapabilities: 'Installed capabilities', skillDiscovery: 'Skill discovery', completeWord: 'complete', refreshing: 'refreshing/incomplete', skill: 'Skill', mcp: 'MCP', copy: 'Copy', trueLabel: 'True', falseLabel: 'False', assignee: 'Assignee', workflow: 'Workflow', developmentContext: 'Development context', none: 'None', branch: 'Branch', worktree: 'Worktree', worktreePath: 'Worktree path', start: 'Start', daily: 'daily', weekly: 'weekly', monthly: 'monthly', developmentRequired: 'Branch and worktree path are required for the selected development context.', resume: 'Resume', cancel: 'Cancel', reopen: 'Reopen', takeover: 'Force takeover', delete: 'Delete', confirm: 'Confirm', reason: 'reason', permanentlyDelete: 'Permanently delete', participants: 'Participants', creator: 'Creator', actors: 'Actors', attachComment: 'Attach to comment', relationKind: 'Relation kind', relatedTask: 'Related task', selectTask: 'Select task', add: 'Add', bytes: 'bytes', current: 'current', offline: 'offline',
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low',
  enabled: 'Enabled', paused: 'Paused',
  more: 'More', moreRemaining: '{count} more', modify: 'Modify', runNow: 'Run now',
  recheckIntegrity: 'Re-check', lastChecked: 'Last checked', never: 'not checked yet',
  tasksTruncated: 'Showing {shown} of {total} tasks. Narrow the view with search or the status filter.',
  relationSourceUnloaded: 'The source task is not loaded; find it with search first',
  showPreview: 'Preview', hidePreview: 'Hide preview', cleanupStalled: 'Cleanup gave up',
  unsavedChanges: 'Unsaved changes', unsavedBody: 'This task has unsaved edits. Closing now discards them.', discardChanges: 'Discard changes', keepEditing: 'Keep editing',
  automationLog: 'Automation run log',
  automationClaimed: 'Read Todo and started {task}',
  automationEmpty: 'Checked Todo; no eligible tasks to run',
  automationFull: 'Workers are busy; no new task was started',
  automationBlocked: 'Checked Todo; tasks are waiting on dependencies',
  automationQuota: 'Quota is uncertain; new claims are paused',
  automationError: 'Run failed: {message}',
  openedMinutesAgo: 'opened {count}m ago',
  openedHoursAgo: 'opened {count}h ago',
  openedDaysAgo: 'opened {count}d ago',
  openedOnDate: 'opened on {date}',
} as const satisfies Record<keyof typeof zh, string>

export const taskboardLocales = { zh, en } as const
export type TaskboardCopy = { readonly [K in keyof typeof zh]: string }
export type TaskboardLocaleId = keyof typeof taskboardLocales
export type TaskboardCopyKey = keyof TaskboardCopy

const PRIORITIES = new Set<TaskPriority>(['urgent', 'high', 'medium', 'low', 'none'])

/** Pick zh when the Harness/browser tag is Chinese; otherwise English. */
export function resolveTaskboardLocale(language: string): TaskboardLocaleId {
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function taskboardStrings(language: string): TaskboardCopy {
  return taskboardLocales[resolveTaskboardLocale(language)]
}

export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

export function priorityLabel(t: TaskboardCopy, priority: TaskPriority): string {
  return PRIORITIES.has(priority) ? t[priority] : priority
}

export function formatOpenedAt(createdAt: number, t: TaskboardCopy): string {
  const elapsed = Math.max(0, Date.now() - createdAt)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsed < hour) return interpolate(t.openedMinutesAgo, { count: Math.max(1, Math.round(elapsed / minute)) })
  if (elapsed < day) return interpolate(t.openedHoursAgo, { count: Math.max(1, Math.round(elapsed / hour)) })
  if (elapsed < 30 * day) return interpolate(t.openedDaysAgo, { count: Math.max(1, Math.round(elapsed / day)) })
  return interpolate(t.openedOnDate, { date: new Date(createdAt).toLocaleDateString() })
}

export function formatAutomationLog(t: TaskboardCopy, decision: AutomationDecision, taskLabel?: string): string {
  if (decision.kind === 'claimed') return interpolate(t.automationClaimed, { task: taskLabel ?? decision.taskId ?? '—' })
  if (decision.kind === 'dependency-blocked') return t.automationBlocked
  if (decision.kind === 'quota-paused') return t.automationQuota
  if (decision.kind === 'error') return interpolate(t.automationError, { message: decision.message })
  return decision.message.includes('concurrency') ? t.automationFull : t.automationEmpty
}

export interface TaskboardLocaleSource {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => { readonly active: string }
}

export interface TaskboardLocaleRuntime extends TaskboardLocaleSource {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
}

let localeSource: TaskboardLocaleSource | undefined
const localeListeners = new Set<() => void>()

function notifyLocaleListeners(): void {
  for (const listener of [...localeListeners]) listener()
}

/** Bind the Harness locale service so the native page follows its language. */
export function bindTaskboardLocale(source?: TaskboardLocaleSource): () => void {
  localeSource = source
  notifyLocaleListeners()
  const off = source?.subscribe(notifyLocaleListeners)
  return () => {
    off?.()
    if (localeSource === source) localeSource = undefined
  }
}

export function browserLanguage(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language
}

export function currentTaskboardLanguage(): string {
  return localeSource?.getSnapshot().active ?? browserLanguage()
}

export function subscribeTaskboardLocale(listener: () => void): () => void {
  localeListeners.add(listener)
  return () => { localeListeners.delete(listener) }
}
