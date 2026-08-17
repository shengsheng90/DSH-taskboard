import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TaskboardSnapshot } from '../service/index.js'
import type {
  TaskStatus, TaskboardChangeWatchResult, TaskboardRemoteMutationRequest, TaskboardRemoteMutationResult, TaskDetail,
} from '../domain/index.js'

export type TaskboardView = 'dashboard' | 'board' | 'list' | 'labels' | 'gantt' | 'workflows'

export interface TaskboardRoute {
  readonly open: boolean
  readonly projectId?: string
  readonly view: TaskboardView
  readonly taskId?: string
}

export type RevisionChange = 'initial' | 'same' | 'next' | 'gap' | 'reset'

export const AUTOMATION_LOG_PREVIEW_LIMIT = 10
export const BOARD_COLUMN_PAGE_SIZE = 15

/** Keep the dashboard log short; the remainder opens in a dialog. */
export function previewAutomationRuns<T>(runs: readonly T[], limit = AUTOMATION_LOG_PREVIEW_LIMIT): {
  readonly preview: readonly T[]
  readonly remaining: number
} {
  return { preview: runs.slice(0, limit), remaining: Math.max(0, runs.length - limit) }
}

/** Newest-first page of one board column; later clicks reveal another page of older cards. */
export function paginateBoardColumn<T extends { readonly updatedAt: number; readonly createdAt: number; readonly id: string }>(
  tasks: readonly T[],
  visibleCount = BOARD_COLUMN_PAGE_SIZE,
): { readonly visible: readonly T[]; readonly remaining: number } {
  const ordered = [...tasks].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
    return left.id.localeCompare(right.id)
  })
  const limit = Math.max(0, visibleCount)
  return {
    visible: ordered.slice(0, limit),
    remaining: Math.max(0, ordered.length - limit),
  }
}

/** Human quick-add from the web form: land in Todo so Overview and the board can show it. */
export function humanQuickCreateRequest(projectId: string, title: string): {
  readonly projectId: string
  readonly title: string
  readonly creator: 'human:web-client'
  readonly status: 'todo'
} {
  return { projectId, title: title.trim(), creator: 'human:web-client', status: 'todo' }
}

/** Accept a create mutation result only when it carries a task id. */
export function createdTaskId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Fill empty automation model fields from Host defaults without overwriting an explicit rule. */
export function applyAutomationDefaults<T>(
  config: T & { readonly modelRoute?: string; readonly reasoning?: string },
  defaults: { readonly modelRoute?: string; readonly reasoning?: string } | undefined,
): T & { readonly modelRoute?: string; readonly reasoning?: string } {
  return {
    ...config,
    ...(config.modelRoute === undefined && defaults?.modelRoute !== undefined ? { modelRoute: defaults.modelRoute } : {}),
    ...(config.reasoning === undefined && defaults?.reasoning !== undefined ? { reasoning: defaults.reasoning } : {}),
  }
}

/** Classify bounded-snapshot revisions after events, reconnects, or a Host restart. */
export function classifyRevisionChange(previous: number | undefined, next: number): RevisionChange {
  if (previous === undefined) return 'initial'
  if (next === previous) return 'same'
  if (next < previous) return 'reset'
  return next === previous + 1 ? 'next' : 'gap'
}

export type BoardDropIntent =
  | { readonly kind: 'none' }
  | { readonly kind: 'reorder'; readonly taskId: string; readonly expectedVersion: number; readonly sortOrder: number }
  | { readonly kind: 'move'; readonly taskId: string; readonly expectedVersion: number; readonly status: TaskStatus; readonly sortOrder?: number }

/** Map a board drop onto reorder-within-column or a human status move. */
export function boardDropIntent(
  dragged: { readonly id: string; readonly status: TaskStatus; readonly version: number; readonly archivedAt?: number } | undefined,
  targetStatus: TaskStatus,
  target?: { readonly id: string; readonly sortOrder: number },
): BoardDropIntent {
  if (dragged === undefined || dragged.archivedAt !== undefined) return { kind: 'none' }
  if (target !== undefined && dragged.id === target.id) return { kind: 'none' }
  if (dragged.status === targetStatus) {
    if (target === undefined) return { kind: 'none' }
    return { kind: 'reorder', taskId: dragged.id, expectedVersion: dragged.version, sortOrder: target.sortOrder - 0.5 }
  }
  return {
    kind: 'move',
    taskId: dragged.id,
    expectedVersion: dragged.version,
    status: targetStatus,
    ...(target === undefined ? {} : { sortOrder: target.sortOrder - 0.5 }),
  }
}

/** Labels present on the project catalog or any task, in first-seen order. */
export function projectLabelCatalog(projectLabels: readonly string[], tasks: readonly { readonly labels: readonly string[] }[]): string[] {
  const seen = new Set<string>()
  const catalog: string[] = []
  for (const label of [...projectLabels, ...tasks.flatMap(task => task.labels)]) {
    const name = label.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    catalog.push(name)
  }
  return catalog
}

/** Tasks that carry `label`, or unlabeled tasks when `label` is undefined. */
export function tasksForLabel<T extends { readonly labels: readonly string[] }>(tasks: readonly T[], label: string | undefined): T[] {
  return tasks.filter(task => label === undefined ? task.labels.length === 0 : task.labels.includes(label))
}

const VIEWS = new Set<TaskboardView>(['dashboard', 'board', 'list', 'labels', 'gantt', 'workflows'])
const RECENT_PROJECT_KEY = 'dsh-taskboard.recent-project'

/** Restore only an open project-less route; explicit deep links always win. */
export function restoreRecentProject(route: TaskboardRoute, recent: string | null): TaskboardRoute {
  return !route.open || route.projectId !== undefined || recent === null || recent === '' ? route : { ...route, projectId: recent }
}

/** Render the unsent native-conversation draft created only on explicit user request. */
export function renderTaskSessionDraft(detail: TaskDetail): string {
  const { task } = detail
  const comments = detail.comments.length === 0
    ? '- None'
    : detail.comments.map(item => `- ${item.authorId}: ${item.body}`).join('\n')
  const relations = detail.relations.length === 0
    ? '- None'
    : detail.relations.map(item => {
        const direction = item.sourceTaskId === task.id ? 'outgoing' : 'incoming'
        const other = item.sourceTaskId === task.id ? item.targetTaskId : item.sourceTaskId
        return `- ${item.kind} (${direction}): ${other}`
      }).join('\n')
  const attachments = detail.attachments.length === 0
    ? '- None'
    : detail.attachments.map(item => `- ${item.id}: ${item.filename} (${item.contentType}, ${item.byteSize} bytes)`).join('\n')
  const development = task.developmentContext === undefined
    ? 'Project workspace'
    : task.developmentContext.kind === 'branch'
      ? `Branch ${task.developmentContext.branch}`
      : `Worktree ${task.developmentContext.path}, branch ${task.developmentContext.branch}`
  return [
    `Work on Task ${task.identifier}.`,
    `Opaque task id: ${task.id}`,
    `Current task revision: ${task.version}`,
    '',
    `Title: ${task.title}`,
    '',
    'Description and acceptance details:',
    task.description || '(No description supplied.)',
    '',
    'Current comments:', comments,
    '',
    'Relations and dependency state:', relations,
    '',
    `Development context: ${development}`,
    '',
    'Attachment references:', attachments,
    '',
    'Use taskboard_get with the exact opaque id before any write. Claim only if eligible, verify the work, and submit it for human review. Never modify the task description; write the final result as a comment. Never accept it as done.',
  ].join('\n')
}

/** Generated Taskboard Remote namespace consumed by the native page. */
export interface TaskboardRemoteNamespace {
  snapshot(projectId?: string): Promise<RemoteResult<string>>
  taskDetail(taskId: string): Promise<RemoteResult<string>>
  mutate(request: TaskboardRemoteMutationRequest): Promise<RemoteResult<TaskboardRemoteMutationResult>>
}

/** Decode one refresh-safe Taskboard hash without consulting browser state. */
export function decodeTaskboardHash(hash: string): TaskboardRoute {
  if (!hash.startsWith('#taskboard')) return { open: false, view: 'board' }
  const [, projectId, rawView, taskId] = hash.slice(1).split('/')
  const view = VIEWS.has(rawView as TaskboardView) ? rawView as TaskboardView : 'board'
  return {
    open: true,
    ...(projectId === undefined || projectId === '-' ? {} : { projectId: decodeURIComponent(projectId) }),
    view,
    ...(taskId === undefined ? {} : { taskId: decodeURIComponent(taskId) }),
  }
}

function parseRoute(): TaskboardRoute {
  const route = decodeTaskboardHash(typeof location === 'undefined' ? '' : location.hash)
  if (!route.open || route.projectId !== undefined || typeof localStorage === 'undefined') return route
  try {
    return restoreRecentProject(route, localStorage.getItem(RECENT_PROJECT_KEY))
  } catch {
    return route
  }
}

/** Encode one open page route for deep-link and refresh restoration. */
export function encodeTaskboardRoute(route: TaskboardRoute): string {
  const project = encodeURIComponent(route.projectId ?? '-')
  const task = route.taskId === undefined ? '' : `/${encodeURIComponent(route.taskId)}`
  return `#taskboard/${project}/${route.view}${task}`
}

/** Browser-local page state and route codec; business state always comes from the Host. */
export class TaskboardClientController {
  private route = parseRoute()
  private listeners = new Set<() => void>()
  private globalRevision: number | undefined

  constructor(
    readonly connection: ConnectionHandle,
    private readonly remote: TaskboardRemoteNamespace,
    private readonly selectSession?: (sessionId: string) => void,
    private readonly createTaskSession?: (workspaceId: string, draft: string) => Promise<string>,
  ) {
    if (typeof window !== 'undefined') window.addEventListener('hashchange', this.onRoute)
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): TaskboardRoute => this.route

  open(): void {
    this.navigate({ ...this.route, open: true })
  }

  close(): void {
    if (typeof history !== 'undefined') history.pushState(null, '', `${location.pathname}${location.search}`)
    this.route = { open: false, view: this.route.view, ...(this.route.projectId === undefined ? {} : { projectId: this.route.projectId }) }
    this.publish()
  }

  select(projectId: string | undefined, view: TaskboardView = this.route.view, taskId?: string): void {
    if (typeof localStorage !== 'undefined') {
      try {
        if (projectId === undefined) localStorage.removeItem(RECENT_PROJECT_KEY)
        else localStorage.setItem(RECENT_PROJECT_KEY, projectId)
      } catch { /* route state remains authoritative when storage is unavailable */ }
    }
    this.navigate({ open: true, view, ...(projectId === undefined ? {} : { projectId }), ...(taskId === undefined ? {} : { taskId }) })
  }

  async snapshot(projectId?: string, signal?: AbortSignal): Promise<TaskboardSnapshot> {
    signal?.throwIfAborted()
    const result = await this.remote.snapshot(projectId)
    if (!result.ok) throw new Error(result.error.message)
    return JSON.parse(result.value) as TaskboardSnapshot
  }

  async detail(taskId: string, signal?: AbortSignal): Promise<TaskDetail> {
    signal?.throwIfAborted()
    const result = await this.remote.taskDetail(taskId)
    if (!result.ok) throw new Error(result.error.message)
    return JSON.parse(result.value) as TaskDetail
  }

  subscribeConnection(listener: () => void): () => void {
    return this.connection.hostDescription.subscribe(listener)
  }

  recordSnapshotRevision(revision: number): RevisionChange {
    const change = classifyRevisionChange(this.globalRevision, revision)
    this.globalRevision = revision
    return change
  }

  openSession(sessionId: string): void {
    this.selectSession?.(sessionId)
    this.close()
  }

  async openNewSession(workspaceId: string, detail: TaskDetail): Promise<string> {
    if (this.createTaskSession === undefined) throw new Error('native Session creation is unavailable')
    const sessionId = await this.createTaskSession(workspaceId, renderTaskSessionDraft(detail))
    this.close()
    return sessionId
  }

  async mutate(endpoint: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted()
    const carried = await this.remote.mutate({ endpoint, payloadJson: JSON.stringify(payload) })
    if (!carried.ok) throw new Error(carried.error.message)
    if (!carried.value.ok) throw new Error(`${carried.value.errorCode ?? 'taskboard'}: ${carried.value.errorMessage ?? 'mutation failed'}`)
    return JSON.parse(carried.value.valueJson ?? 'null') as unknown
  }

  async watchChanges(afterRevision: number, signal?: AbortSignal): Promise<TaskboardChangeWatchResult> {
    signal?.throwIfAborted()
    const carried = await this.remote.mutate({
      endpoint: 'changes.watch',
      payloadJson: JSON.stringify({ afterRevision, timeoutMs: 10_000 }),
    })
    signal?.throwIfAborted()
    if (!carried.ok) throw new Error(carried.error.message)
    if (!carried.value.ok) {
      throw new Error(`${carried.value.errorCode ?? 'taskboard'}: ${carried.value.errorMessage ?? 'change watch failed'}`)
    }
    return JSON.parse(carried.value.valueJson ?? 'null') as TaskboardChangeWatchResult
  }

  async uploadAttachment(taskId: string, expectedVersion: number, file: File, commentId?: string, signal?: AbortSignal): Promise<void> {
    const ticket = await this.mutate('attachment.upload-ticket', {
      taskId, expectedVersion, filename: file.name, contentType: file.type || 'application/octet-stream',
      ...(commentId === undefined ? {} : { commentId }),
    }, signal) as { url: string; method: 'PUT' }
    const response = await fetch(ticket.url, { method: ticket.method, body: file, ...(signal === undefined ? {} : { signal }), headers: { 'content-type': 'application/octet-stream' } })
    if (!response.ok) throw new Error(`attachment upload failed (${response.status}): ${await response.text()}`)
  }

  async downloadAttachment(attachmentId: string, filename: string): Promise<void> {
    const ticket = await this.mutate('attachment.download-ticket', { attachmentId, disposition: 'attachment' }) as { url: string }
    const anchor = document.createElement('a')
    anchor.href = ticket.url
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }

  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', this.onRoute)
    this.listeners.clear()
  }

  private readonly onRoute = (): void => {
    this.route = parseRoute()
    this.publish()
  }

  private navigate(route: TaskboardRoute): void {
    const hash = encodeTaskboardRoute(route)
    if (typeof history !== 'undefined') history.pushState(null, '', hash)
    this.route = route
    this.publish()
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
