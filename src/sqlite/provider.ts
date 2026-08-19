import { randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import {
  ActivityId, AttachmentId, AutomationId, ClaimId, CommentId, ProjectId, RelationId, TaskId, TaskboardError, WorkflowId,
  parseTaskStatus, requireHuman, requireStatus,
} from '../domain/index.js'
import type {
  ClaimTaskRequest, CreateAttachmentRequest, CreateProjectRequest, CreateTaskRequest, DevelopmentContext,
  FreshClaimRequest, RecurrenceRule, RelationKind, TaskDetail, TaskListFilter, TaskPriority,
  TaskStatus, TaskboardActivity, TaskboardActor, TaskboardAttachment, TaskboardClaim, TaskboardClaimId, TaskboardComment,
  TaskboardChangeEvent, TaskboardProject, TaskboardProjectId, TaskboardRelation, TaskboardTask,
  TaskboardStorageHealth, TaskboardTaskId, UpdateProjectRequest, UpdateTaskRequest, WorkflowDocument, SavedWorkflow,
  AutomationActor, AutomationDecision, AutomationRule, AutomationRuleConfig, AutomationRun, AutomationState,
  TaskboardAutomationId,
} from '../domain/index.js'
import { openTaskboardDatabase, TASKBOARD_SCHEMA_VERSION } from './schema.js'

type Row = Record<string, unknown>
type SqlValue = string | number | bigint | Uint8Array | null

export interface TaskboardAttachmentOptions {
  readonly root: string
  readonly maxAttachmentBytes: number
  readonly maxTaskAttachmentBytes: number
  readonly allowedContentTypes: readonly string[]
  readonly allowSharedWorktrees: boolean
}

const DEFAULT_ATTACHMENT_OPTIONS: TaskboardAttachmentOptions = {
  root: '.dsh/taskboard-attachments',
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxTaskAttachmentBytes: 100 * 1024 * 1024,
  allowedContentTypes: [
    'application/json', 'application/octet-stream', 'application/pdf', 'application/zip',
    'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/markdown', 'text/plain',
  ],
  allowSharedWorktrees: false,
}

const INLINE_CONTENT_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

function now(): number {
  return Date.now()
}

function requiredText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TaskboardError(`${label} must be a non-empty string`, 'TASK_INVALID_INPUT', { label })
  }
  return value.trim()
}

function rewriteLabels(labels: readonly string[], from: string, to: string | undefined): string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const label of labels) {
    const mapped = label === from ? to : label
    if (mapped === undefined || mapped === '' || seen.has(mapped)) continue
    seen.add(mapped)
    next.push(mapped)
  }
  return next
}

function projectKey(value: string): string {
  const key = requiredText(value, 'project key').toUpperCase()
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
    throw new TaskboardError('project key must contain 2-10 uppercase letters or digits and begin with a letter', 'TASK_INVALID_INPUT')
  }
  return key
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

function parseJson<T>(value: unknown, label: string): T {
  if (typeof value !== 'string') throw new TaskboardError(`${label} is not stored as JSON`, 'TASK_INVALID_INPUT')
  try {
    return JSON.parse(value) as T
  } catch (cause) {
    throw new TaskboardError(`${label} contains invalid JSON`, 'TASK_INVALID_INPUT', { cause: String(cause) })
  }
}

function optionalJson<T>(value: unknown, label: string): T | undefined {
  return value === null ? undefined : parseJson<T>(value, label)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function mapProject(row: Row): TaskboardProject {
  const workspaceId = optionalString(row['workspace_id'])
  return {
    id: ProjectId(String(row['id'])),
    key: String(row['key']),
    name: String(row['name']),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    labels: parseJson<string[]>(row['labels_json'], 'project labels'),
    nextIssueNumber: Number(row['next_issue_number']),
    version: Number(row['version']),
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  }
}

function mapTask(row: Row): TaskboardTask {
  const assignee = optionalString(row['assignee'])
  const startDate = optionalString(row['start_date'])
  const dueDate = optionalString(row['due_date'])
  const recurrence = optionalJson<RecurrenceRule>(row['recurrence_json'], 'task recurrence')
  const workflowId = optionalString(row['workflow_id'])
  const developmentContext = optionalJson<DevelopmentContext>(row['development_context_json'], 'development context')
  const source = optionalJson<Record<string, unknown>>(row['source_json'], 'task source')
  const archivedAt = optionalNumber(row['archived_at'])
  return {
    id: TaskId(String(row['id'])),
    projectId: ProjectId(String(row['project_id'])),
    identifier: String(row['identifier']),
    title: String(row['title']),
    description: String(row['description']),
    status: row['status'] as TaskStatus,
    priority: row['priority'] as TaskPriority,
    labels: parseJson<string[]>(row['labels_json'], 'task labels'),
    sortOrder: Number(row['sort_order']),
    ...(assignee === undefined ? {} : { assignee }),
    creator: String(row['creator']),
    ...(startDate === undefined ? {} : { startDate }),
    ...(dueDate === undefined ? {} : { dueDate }),
    ...(recurrence === undefined ? {} : { recurrence }),
    ...(workflowId === undefined ? {} : { workflowId: workflowId as TaskboardTask['workflowId'] & string }),
    ...(developmentContext === undefined ? {} : { developmentContext }),
    ...(source === undefined ? {} : { source }),
    ...(archivedAt === undefined ? {} : { archivedAt }),
    version: Number(row['version']),
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  }
}

function mapComment(row: Row): TaskboardComment {
  const sessionId = optionalString(row['session_id'])
  return {
    id: CommentId(String(row['id'])),
    taskId: TaskId(String(row['task_id'])),
    body: String(row['body']),
    authorId: String(row['author_id']),
    ...(sessionId === undefined ? {} : { sessionId }),
    version: Number(row['version']),
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  }
}

function mapRelation(row: Row): TaskboardRelation {
  return {
    id: RelationId(String(row['id'])),
    projectId: ProjectId(String(row['project_id'])),
    sourceTaskId: TaskId(String(row['source_task_id'])),
    targetTaskId: TaskId(String(row['target_task_id'])),
    kind: row['kind'] as RelationKind,
    actorId: String(row['actor_id']),
    createdAt: Number(row['created_at']),
  }
}

function mapClaim(row: Row): TaskboardClaim {
  const developmentContext = optionalJson<DevelopmentContext>(row['development_context_json'], 'claim development context')
  const automationId = optionalString(row['automation_id'])
  return {
    id: ClaimId(String(row['id'])),
    taskId: TaskId(String(row['task_id'])),
    sessionId: String(row['session_id']),
    agentId: String(row['agent_id']),
    ...(automationId === undefined ? {} : { automationId }),
    expectedTaskVersion: Number(row['expected_task_version']),
    state: row['state'] as TaskboardClaim['state'],
    ...(developmentContext === undefined ? {} : { developmentContext }),
    claimedAt: Number(row['claimed_at']),
    updatedAt: Number(row['updated_at']),
  }
}

function mapActivity(row: Row): TaskboardActivity {
  const before = optionalJson<unknown>(row['before_json'], 'activity before value')
  const after = optionalJson<unknown>(row['after_json'], 'activity after value')
  return {
    id: ActivityId(String(row['id'])),
    taskId: TaskId(String(row['task_id'])),
    kind: String(row['kind']),
    actorKind: row['actor_kind'] as TaskboardActor['kind'],
    actorId: String(row['actor_id']),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    createdAt: Number(row['created_at']),
  }
}

function mapAttachment(row: Row): TaskboardAttachment {
  const commentId = optionalString(row['comment_id'])
  return {
    id: AttachmentId(String(row['id'])),
    taskId: TaskId(String(row['task_id'])),
    ...(commentId === undefined ? {} : { commentId: CommentId(commentId) }),
    filename: String(row['filename']),
    contentType: String(row['content_type']),
    byteSize: Number(row['byte_size']),
    createdAt: Number(row['created_at']),
  }
}

function mapWorkflow(row: Row): SavedWorkflow {
  return {
    id: WorkflowId(String(row['id'])),
    projectId: ProjectId(String(row['project_id'])),
    name: String(row['name']),
    document: parseJson<WorkflowDocument>(row['document_json'], 'workflow document'),
    version: Number(row['version']),
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  }
}

function mapAutomation(row: Row): AutomationRule {
  const lastDecision = optionalJson<AutomationDecision>(row['last_decision_json'], 'automation decision')
  const nextEligibleAt = optionalNumber(row['next_eligible_at'])
  return {
    id: AutomationId(String(row['id'])),
    projectId: ProjectId(String(row['project_id'])),
    config: parseJson<AutomationRuleConfig>(row['config_json'], 'automation config'),
    state: row['state'] as AutomationState,
    version: Number(row['version']),
    ...(lastDecision === undefined ? {} : { lastDecision }),
    ...(nextEligibleAt === undefined ? {} : { nextEligibleAt }),
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  }
}

function mapAutomationRun(row: Row): AutomationRun {
  return {
    id: String(row['id']),
    ruleId: AutomationId(String(row['rule_id'])),
    decision: parseJson<AutomationDecision>(row['decision_json'], 'automation run'),
    createdAt: Number(row['created_at']),
  }
}

const AUTOMATION_RUN_KEEP = 80
const STATEMENT_CACHE_LIMIT = 256
/** Hard ceiling for one task page; callers ask for less and learn the total from countTasks. */
export const TASK_PAGE_LIMIT = 2_000

/** Local transactional Taskboard authority backed by one SQLite database. */
export class SqliteTaskboardProvider {
  readonly db: DatabaseSync
  readonly attachmentOptions: TaskboardAttachmentOptions
  private readonly changeListeners = new Set<(event: TaskboardChangeEvent) => void>()
  private integrity = 'unknown'
  private integrityCheckedAt = 0
  private readonly statements = new Map<string, StatementSync>()
  private transactionActivities: Array<{
    readonly taskId: TaskboardTaskId
    readonly activityKind: string
    readonly actorKind: TaskboardActor['kind']
    readonly actorId: string
  }> | undefined

  constructor(path: string, attachmentOptions?: Partial<TaskboardAttachmentOptions>) {
    this.db = openTaskboardDatabase(path)
    this.attachmentOptions = {
      ...DEFAULT_ATTACHMENT_OPTIONS,
      ...attachmentOptions,
      root: resolve(attachmentOptions?.root ?? DEFAULT_ATTACHMENT_OPTIONS.root),
      allowedContentTypes: [...(attachmentOptions?.allowedContentTypes ?? DEFAULT_ATTACHMENT_OPTIONS.allowedContentTypes)],
    }
    this.validateAttachmentOptions()
    this.refreshIntegrity()
    this.retryAttachmentCleanup()
  }

  close(): void {
    this.changeListeners.clear()
    this.statements.clear()
    this.db.close()
  }

  /** Compile once and reuse; every statement here is fully materialized before it is reused. */
  private sql(text: string): StatementSync {
    const cached = this.statements.get(text)
    if (cached !== undefined) return cached
    const statement = this.db.prepare(text)
    // Dynamic filter combinations are bounded, but never let the cache grow without limit.
    if (this.statements.size >= STATEMENT_CACHE_LIMIT) this.statements.clear()
    this.statements.set(text, statement)
    return statement
  }

  /** Subscribe to detached invalidations published only after an authoritative commit. */
  subscribe(listener: (event: TaskboardChangeEvent) => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  globalRevision(): number {
    const row = this.sql('SELECT global_revision FROM taskboard_meta WHERE singleton = 1').get() as Row
    return Number(row['global_revision'])
  }

  createProject(request: CreateProjectRequest, actor: TaskboardActor): TaskboardProject {
    requireHuman(actor, 'create project')
    const key = projectKey(request.key)
    const name = requiredText(request.name, 'project name')
    const timestamp = now()
    const projectId = ProjectId(id('project'))
    this.transaction(() => {
      this.sql(`
        INSERT INTO projects(id, key, name, workspace_id, labels_json, next_issue_number, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      `).run(projectId, key, name, request.workspaceId ?? null, json(request.labels ?? []), timestamp, timestamp)
      this.bumpRevision()
    })
    return this.getProject(projectId)
  }

  getProject(projectId: TaskboardProjectId): TaskboardProject {
    const row = this.sql('SELECT * FROM projects WHERE id = ?').get(projectId) as Row | undefined
    if (row === undefined) throw new TaskboardError(`project ${projectId} was not found`, 'PROJECT_NOT_FOUND', { projectId })
    return mapProject(row)
  }

  listProjects(): TaskboardProject[] {
    return (this.sql('SELECT * FROM projects ORDER BY created_at, id').all() as Row[]).map(mapProject)
  }

  updateProject(
    projectId: TaskboardProjectId,
    expectedVersion: number,
    request: UpdateProjectRequest,
    actor: TaskboardActor,
  ): TaskboardProject {
    requireHuman(actor, 'update project')
    return this.transaction(() => {
      const current = this.getProject(projectId)
      this.expectVersion(current.version, expectedVersion, 'project')
      const sets: string[] = []
      const values: SqlValue[] = []
      if (request.name !== undefined) { sets.push('name = ?'); values.push(requiredText(request.name, 'project name')) }
      if (request.workspaceId !== undefined) { sets.push('workspace_id = ?'); values.push(request.workspaceId === null ? null : requiredText(request.workspaceId, 'workspace id')) }
      if (request.labels !== undefined) { sets.push('labels_json = ?'); values.push(json(request.labels)) }
      if (sets.length === 0) throw new TaskboardError('project update contains no fields', 'TASK_INVALID_INPUT')
      const timestamp = now()
      this.sql(`UPDATE projects SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
        .run(...values, timestamp, projectId, expectedVersion)
      this.bumpRevision()
      return this.getProject(projectId)
    })
  }

  deleteProject(projectId: TaskboardProjectId, expectedVersion: number, actor: TaskboardActor): void {
    requireHuman(actor, 'delete project')
    this.transaction(() => {
      const project = this.getProject(projectId)
      this.expectVersion(project.version, expectedVersion, 'project')
      const row = this.sql('SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?').get(projectId) as Row
      if (Number(row['count']) !== 0) {
        throw new TaskboardError('project deletion requires an empty project', 'PROJECT_NOT_EMPTY', { projectId })
      }
      this.sql('DELETE FROM projects WHERE id = ?').run(projectId)
      this.bumpRevision()
    })
  }

  createTask(request: CreateTaskRequest, actor: TaskboardActor): TaskboardTask {
    const title = requiredText(request.title, 'task title')
    const creator = requiredText(request.creator, 'task creator')
    if (request.status === 'todo') requireHuman(actor, 'approve task at creation')
    this.validateDevelopmentContext(request.developmentContext)
    this.validateTaskFields(request)
    const taskId = TaskId(id('task'))
    this.transaction(() => {
      const project = this.getProject(request.projectId)
      const identifier = `${project.key}-${project.nextIssueNumber}`
      const timestamp = now()
      this.sql(`
        INSERT INTO tasks(
          id, project_id, identifier, title, description, status, priority, labels_json, sort_order,
          assignee, creator, start_date, due_date, recurrence_json, workflow_id,
          development_context_json, source_json, archived_at, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
      `).run(
        taskId, request.projectId, identifier, title, request.description ?? '', request.status ?? 'backlog',
        request.priority ?? 'none', json(request.labels ?? []), request.sortOrder ?? project.nextIssueNumber * 1000,
        request.assignee ?? null, creator, request.startDate ?? null, request.dueDate ?? null,
        request.recurrence === undefined ? null : json(request.recurrence), request.workflowId ?? null,
        request.developmentContext === undefined ? null : json(request.developmentContext),
        request.source === undefined ? null : json(request.source), timestamp, timestamp,
      )
      this.sql('UPDATE projects SET next_issue_number = next_issue_number + 1, version = version + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, request.projectId)
      this.activity(taskId, 'task.created', actor, undefined, { identifier, status: request.status ?? 'backlog' }, timestamp)
      this.bumpRevision()
    })
    return this.getTask(taskId)
  }

  getTask(taskIdOrIdentifier: TaskboardTaskId | string): TaskboardTask {
    const row = this.sql('SELECT * FROM tasks WHERE id = ? OR identifier = ?').get(taskIdOrIdentifier, taskIdOrIdentifier) as Row | undefined
    if (row === undefined) throw new TaskboardError(`task ${taskIdOrIdentifier} was not found`, 'TASK_NOT_FOUND', { taskId: taskIdOrIdentifier })
    return mapTask(row)
  }

  getTaskDetail(taskId: TaskboardTaskId): TaskDetail {
    const task = this.getTask(taskId)
    const comments = (this.sql('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at, rowid').all(taskId) as Row[]).map(mapComment)
    const activities = (this.sql('SELECT * FROM task_activities WHERE task_id = ? ORDER BY created_at, rowid').all(taskId) as Row[]).map(mapActivity)
    const relations = (this.sql('SELECT * FROM task_relations WHERE source_task_id = ? OR target_task_id = ? ORDER BY created_at, rowid').all(taskId, taskId) as Row[]).map(mapRelation)
    const attachments = (this.sql('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at, rowid').all(taskId) as Row[]).map(mapAttachment)
    const active = this.activeClaimRow(taskId)
    const claims = (this.sql('SELECT * FROM task_claims WHERE task_id = ? ORDER BY claimed_at, rowid').all(taskId) as Row[]).map(mapClaim)
    return {
      task,
      comments,
      activities,
      relations,
      attachments,
      ...(active === undefined ? {} : { activeClaim: mapClaim(active) }),
      claims,
      globalRevision: this.globalRevision(),
    }
  }

  private taskFilterSql(filter: TaskListFilter): { readonly where: string; readonly values: SqlValue[] } {
    this.getProject(filter.projectId)
    const clauses = ['project_id = ?']
    const values: SqlValue[] = [filter.projectId]
    if (filter.includeArchived !== true) clauses.push('archived_at IS NULL')
    if (filter.statuses !== undefined && filter.statuses.length > 0) {
      clauses.push(`status IN (${filter.statuses.map(() => '?').join(',')})`)
      values.push(...filter.statuses)
    }
    if (filter.search !== undefined && filter.search.trim().length > 0) {
      clauses.push("(identifier LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')")
      const escaped = filter.search.trim().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
      values.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`)
    }
    return { where: clauses.join(' AND '), values }
  }

  /** Total tasks matching a filter, so a bounded page can report what it left out. */
  countTasks(filter: TaskListFilter): number {
    const { where, values } = this.taskFilterSql(filter)
    const row = this.sql(`SELECT COUNT(*) AS count FROM tasks WHERE ${where}`).get(...values) as Row
    return Number(row['count'])
  }

  listTasks(filter: TaskListFilter): TaskboardTask[] {
    const { where, values } = this.taskFilterSql(filter)
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), TASK_PAGE_LIMIT)
    const offset = Math.max(filter.offset ?? 0, 0)
    const statement = this.sql(`
      SELECT * FROM tasks WHERE ${where}
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
      sort_order, created_at, id LIMIT ? OFFSET ?
    `)
    return (statement.all(...values, limit, offset) as Row[]).map(mapTask)
  }

  updateTask(taskId: TaskboardTaskId, expectedVersion: number, request: UpdateTaskRequest, actor: TaskboardActor): TaskboardTask {
    this.validateDevelopmentContext(request.developmentContext ?? undefined)
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      this.validateTaskFields(request, current.projectId)
      const sets: string[] = []
      const values: SqlValue[] = []
      const fields: Array<[keyof UpdateTaskRequest, string, (value: UpdateTaskRequest[keyof UpdateTaskRequest]) => SqlValue]> = [
        ['title', 'title', value => requiredText(String(value), 'task title')],
        ['description', 'description', value => String(value)],
        ['priority', 'priority', value => String(value)],
        ['labels', 'labels_json', value => json(value)],
        ['sortOrder', 'sort_order', value => Number(value)],
        ['assignee', 'assignee', value => value === null ? null : String(value)],
        ['startDate', 'start_date', value => value === null ? null : String(value)],
        ['dueDate', 'due_date', value => value === null ? null : String(value)],
        ['recurrence', 'recurrence_json', value => value === null ? null : json(value)],
        ['workflowId', 'workflow_id', value => value === null ? null : String(value)],
        ['developmentContext', 'development_context_json', value => value === null ? null : json(value)],
      ]
      for (const [key, column, encode] of fields) {
        if (request[key] !== undefined) {
          sets.push(`${column} = ?`)
          values.push(encode(request[key]))
        }
      }
      if (sets.length === 0) throw new TaskboardError('task update contains no fields', 'TASK_INVALID_INPUT')
      const timestamp = now()
      this.sql(`UPDATE tasks SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
        .run(...values, timestamp, taskId, expectedVersion)
      const updated = this.getTask(taskId)
      this.activity(taskId, 'task.updated', actor, current, updated, timestamp)
      this.bumpRevision()
      return updated
    })
  }

  approve(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask {
    requireHuman(actor, 'approve')
    return this.transition(taskId, expectedVersion, ['backlog'], 'todo', 'task.approved', actor)
  }

  claim(taskId: TaskboardTaskId, request: ClaimTaskRequest, actor: TaskboardActor): { task: TaskboardTask; claim: TaskboardClaim } {
    if (actor.kind === 'human') throw new TaskboardError('a task claim requires an Agent or automation owner', 'TASK_INVALID_INPUT')
    if (actor.sessionId !== request.sessionId || actor.agentId !== request.agentId) {
      throw new TaskboardError('claim owner does not match the acting Agent', 'TASK_FOREIGN_CLAIM')
    }
    return this.transaction(() => {
      const current = this.mutableTask(taskId, request.expectedVersion)
      requireStatus(current.status, ['todo'], 'claim')
      if (this.activeClaimRow(taskId) !== undefined) {
        throw new TaskboardError('task already has an active claim', 'TASK_ALREADY_CLAIMED', { taskId })
      }
      if (current.developmentContext !== undefined
        && !(current.developmentContext.kind === 'worktree' && this.attachmentOptions.allowSharedWorktrees)) {
        const conflict = this.sql(`
          SELECT tasks.identifier
          FROM task_claims claims JOIN tasks ON tasks.id = claims.task_id
          WHERE claims.state IN ('active','orphaned') AND claims.task_id <> ?
            AND claims.development_context_json = ?
          ORDER BY claims.claimed_at LIMIT 1
        `).get(taskId, json(current.developmentContext)) as Row | undefined
        if (conflict !== undefined) {
          throw new TaskboardError(
            `development context is already owned by ${String(conflict['identifier'])}`,
            'TASK_DEVELOPMENT_CONTEXT_BUSY',
            { task: conflict['identifier'] },
          )
        }
      }
      const dependency = this.sql(`
        SELECT dependency.identifier, dependency.status
        FROM task_relations relation
        JOIN tasks dependency ON dependency.id = relation.source_task_id
        WHERE relation.kind = 'blocks' AND relation.target_task_id = ? AND dependency.status <> 'done'
        ORDER BY dependency.identifier LIMIT 1
      `).get(taskId) as Row | undefined
      if (dependency !== undefined) {
        throw new TaskboardError(
          `task is blocked by unfinished dependency ${String(dependency['identifier'])}`,
          'TASK_DEPENDENCY_INCOMPLETE',
          { dependency: dependency['identifier'], status: dependency['status'] },
        )
      }
      const timestamp = now()
      const claimId = ClaimId(id('claim'))
      this.sql(`
        INSERT INTO task_claims(id, task_id, session_id, agent_id, automation_id, expected_task_version, state, development_context_json, claimed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(
        claimId, taskId, request.sessionId, request.agentId, actor.kind === 'automation' ? actor.automationId : null, request.expectedVersion,
        current.developmentContext === undefined ? null : json(current.developmentContext), timestamp, timestamp,
      )
      this.writeStatus(taskId, request.expectedVersion, 'in_progress', timestamp)
      const task = this.getTask(taskId)
      this.activity(taskId, 'task.claimed', actor, { status: current.status }, { status: task.status, claimId }, timestamp)
      this.bumpRevision()
      return { task, claim: mapClaim(this.claimById(claimId)) }
    })
  }

  submitReview(taskId: TaskboardTaskId, expectedVersion: number, verification: string, resultComment: string, actor: TaskboardActor): TaskboardTask {
    if (actor.kind === 'human') throw new TaskboardError('review submission requires the owning Agent', 'TASK_FOREIGN_CLAIM')
    const verificationText = requiredText(verification, 'verification')
    const commentText = requiredText(resultComment, 'result comment')
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      requireStatus(current.status, ['in_progress'], 'submit for review')
      const claim = this.assertOwningClaim(taskId, actor)
      const timestamp = now()
      this.insertComment(
        taskId,
        verificationText === 'Completed' ? commentText : `${commentText}\n\nVerification: ${verificationText}`,
        actor,
        timestamp,
      )
      this.sql("UPDATE task_claims SET state = 'submitted', updated_at = ? WHERE id = ?").run(timestamp, claim.id)
      this.writeStatus(taskId, expectedVersion, 'in_review', timestamp)
      this.activity(taskId, 'task.review-submitted', actor, { status: current.status }, { status: 'in_review', claimId: claim.id }, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  returnForRework(
    taskId: TaskboardTaskId,
    expectedVersion: number,
    target: 'todo' | 'in_progress',
    comment: string,
    actor: TaskboardActor,
    freshClaim?: FreshClaimRequest,
  ): TaskboardTask {
    requireHuman(actor, 'return for rework')
    const body = requiredText(comment, 'changed requirement comment')
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      requireStatus(current.status, ['in_review'], 'return for rework')
      if (target === 'in_progress' && freshClaim === undefined) {
        throw new TaskboardError('direct in-progress rework requires a fresh Agent claim', 'TASK_INVALID_INPUT')
      }
      const timestamp = now()
      this.insertComment(taskId, body, actor, timestamp)
      this.writeStatus(taskId, expectedVersion, target, timestamp)
      const claimId = freshClaim === undefined
        ? undefined
        : this.insertFreshClaim(taskId, expectedVersion, current.developmentContext, freshClaim, timestamp)
      this.activity(taskId, 'task.returned', actor, { status: current.status }, {
        status: target,
        ...(claimId === undefined ? {} : { claimId }),
      }, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  accept(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask {
    requireHuman(actor, 'accept')
    return this.transition(taskId, expectedVersion, ['in_review'], 'done', 'task.accepted', actor)
  }

  /** Human board/detail status move; releases an in-progress claim when leaving that column. */
  moveStatus(
    taskId: TaskboardTaskId,
    expectedVersion: number,
    status: TaskStatus,
    actor: TaskboardActor,
    sortOrder?: number,
  ): TaskboardTask {
    requireHuman(actor, 'move status')
    const target = parseTaskStatus(status)
    if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
      throw new TaskboardError('sort order must be a finite number', 'TASK_INVALID_INPUT')
    }
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      if (current.status === target && sortOrder === undefined) {
        throw new TaskboardError('task update contains no fields', 'TASK_INVALID_INPUT')
      }
      const timestamp = now()
      if (current.status === 'in_progress' && target !== 'in_progress') {
        this.sql("UPDATE task_claims SET state = 'released', updated_at = ? WHERE task_id = ? AND state IN ('active','orphaned')")
          .run(timestamp, taskId)
      }
      const result = sortOrder === undefined
        ? this.sql('UPDATE tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
          .run(target, timestamp, taskId, expectedVersion)
        : this.sql('UPDATE tasks SET status = ?, sort_order = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
          .run(target, sortOrder, timestamp, taskId, expectedVersion)
      if (result.changes !== 1) throw new TaskboardError('task version changed during transition', 'TASK_STALE_VERSION')
      this.activity(taskId, 'task.status-moved', actor, { status: current.status }, { status: target }, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  block(taskId: TaskboardTaskId, expectedVersion: number, reason: string, actor: TaskboardActor): TaskboardTask {
    const body = requiredText(reason, 'blocker reason')
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      requireStatus(current.status, ['todo', 'in_progress'], 'block')
      if (actor.kind !== 'human' && current.status === 'in_progress') this.assertOwningClaim(taskId, actor)
      const timestamp = now()
      this.insertComment(taskId, `Blocked: ${body}`, actor, timestamp)
      this.writeStatus(taskId, expectedVersion, 'blocked', timestamp)
      this.activity(taskId, 'task.blocked', actor, { status: current.status }, { status: 'blocked', reason: body }, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  resume(
    taskId: TaskboardTaskId,
    expectedVersion: number,
    actor: TaskboardActor,
    target: 'todo' | 'in_progress' = 'todo',
    freshClaim?: FreshClaimRequest,
  ): TaskboardTask {
    requireHuman(actor, 'resume')
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      requireStatus(current.status, ['blocked'], 'resume')
      if (target === 'in_progress' && freshClaim === undefined) {
        throw new TaskboardError('direct in-progress resume requires a fresh Agent claim', 'TASK_INVALID_INPUT')
      }
      const timestamp = now()
      this.sql("UPDATE task_claims SET state = 'released', updated_at = ? WHERE task_id = ? AND state IN ('active','orphaned')")
        .run(timestamp, taskId)
      this.writeStatus(taskId, expectedVersion, target, timestamp)
      const claimId = freshClaim === undefined
        ? undefined
        : this.insertFreshClaim(taskId, expectedVersion, current.developmentContext, freshClaim, timestamp)
      this.activity(taskId, 'task.resumed', actor, { status: current.status }, {
        status: target,
        ...(claimId === undefined ? {} : { claimId }),
      }, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  cancel(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask {
    requireHuman(actor, 'cancel')
    return this.transition(taskId, expectedVersion, ['backlog', 'todo', 'in_progress', 'in_review', 'blocked'], 'canceled', 'task.canceled', actor, true)
  }

  reopen(taskId: TaskboardTaskId, expectedVersion: number, reason: string, actor: TaskboardActor): TaskboardTask {
    requireHuman(actor, 'reopen')
    const body = requiredText(reason, 'reopen reason')
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      requireStatus(current.status, ['done', 'canceled'], 'reopen')
      const timestamp = now()
      this.insertComment(taskId, `Reopened: ${body}`, actor, timestamp)
      this.writeStatus(taskId, expectedVersion, 'todo', timestamp)
      this.activity(taskId, 'task.reopened', actor, { status: current.status }, { status: 'todo', reason: body }, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  releaseClaim(taskId: TaskboardTaskId, expectedVersion: number, reason: string, actor: TaskboardActor): TaskboardTask {
    const body = requiredText(reason, 'release reason')
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      requireStatus(current.status, ['in_progress', 'blocked'], 'release claim')
      const claim = actor.kind === 'human' ? this.activeClaim(taskId) : this.assertOwningClaim(taskId, actor)
      if (claim === undefined) throw new TaskboardError('task has no active claim', 'TASK_FOREIGN_CLAIM')
      const timestamp = now()
      this.sql("UPDATE task_claims SET state = 'released', updated_at = ? WHERE id = ?").run(timestamp, claim.id)
      this.insertComment(taskId, `Claim released: ${body}`, actor, timestamp)
      if (current.status === 'in_progress') this.writeStatus(taskId, expectedVersion, 'todo', timestamp)
      else this.bumpTaskVersion(taskId, expectedVersion, timestamp)
      this.activity(taskId, 'task.claim-released', actor, { claimId: claim.id }, { reason: body }, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  /** Human-only explicit takeover releases an existing active/orphaned owner back to todo. */
  forceTakeover(taskId: TaskboardTaskId, expectedVersion: number, reason: string, actor: TaskboardActor): TaskboardTask {
    requireHuman(actor, 'force takeover')
    return this.releaseClaim(taskId, expectedVersion, `Force takeover by ${actor.actorId}: ${requiredText(reason, 'takeover reason')}`, actor)
  }

  archive(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask {
    requireHuman(actor, 'archive')
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      if (this.activeClaimRow(taskId) !== undefined) throw new TaskboardError('cannot archive a task with an active claim', 'TASK_ACTIVE_CLAIM')
      const timestamp = now()
      this.sql('UPDATE tasks SET archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .run(timestamp, timestamp, taskId, expectedVersion)
      this.activity(taskId, 'task.archived', actor, current.archivedAt, timestamp, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  restore(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask {
    requireHuman(actor, 'restore')
    return this.transaction(() => {
      const current = this.getTask(taskId)
      this.expectVersion(current.version, expectedVersion, 'task')
      if (current.archivedAt === undefined) throw new TaskboardError('task is not archived', 'TASK_NOT_ARCHIVED')
      const timestamp = now()
      this.sql('UPDATE tasks SET archived_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .run(timestamp, taskId, expectedVersion)
      this.activity(taskId, 'task.restored', actor, current.archivedAt, undefined, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  /** Persist attachment bytes before publishing their authoritative database row. */
  createAttachment(
    taskId: TaskboardTaskId,
    expectedVersion: number,
    request: CreateAttachmentRequest,
    actor: TaskboardActor,
  ): { readonly attachment: TaskboardAttachment; readonly task: TaskboardTask } {
    this.mutableTask(taskId, expectedVersion)
    const filename = this.safeFilename(request.filename)
    const contentType = this.contentType(request.contentType)
    const bytes = request.bytes
    if (!(bytes instanceof Uint8Array)) {
      throw new TaskboardError('attachment bytes must be a Uint8Array', 'TASK_INVALID_INPUT')
    }
    if (bytes.byteLength > this.attachmentOptions.maxAttachmentBytes) {
      throw new TaskboardError('attachment exceeds the configured per-file limit', 'ATTACHMENT_SIZE_EXCEEDED', {
        actual: bytes.byteLength,
        limit: this.attachmentOptions.maxAttachmentBytes,
      })
    }
    const attachmentId = AttachmentId(id('attachment'))
    const storageKey = this.newStorageKey()
    this.persistAttachmentBytes(storageKey, bytes)
    try {
      return this.transaction(() => {
        this.mutableTask(taskId, expectedVersion)
        if (request.commentId !== undefined) {
          const comment = this.sql('SELECT task_id FROM comments WHERE id = ?').get(request.commentId) as Row | undefined
          if (comment === undefined || String(comment['task_id']) !== taskId) {
            throw new TaskboardError('attachment comment must belong to the same task', 'TASK_INVALID_INPUT')
          }
        }
        const total = this.sql('SELECT COALESCE(SUM(byte_size), 0) AS total FROM attachments WHERE task_id = ?').get(taskId) as Row
        if (Number(total['total']) + bytes.byteLength > this.attachmentOptions.maxTaskAttachmentBytes) {
          throw new TaskboardError('attachment exceeds the configured per-task total limit', 'ATTACHMENT_SIZE_EXCEEDED', {
            actual: Number(total['total']) + bytes.byteLength,
            limit: this.attachmentOptions.maxTaskAttachmentBytes,
          })
        }
        const timestamp = now()
        this.sql(`
          INSERT INTO attachments(id, task_id, comment_id, storage_key, filename, content_type, byte_size, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(attachmentId, taskId, request.commentId ?? null, storageKey, filename, contentType, bytes.byteLength, timestamp)
        this.bumpTaskVersion(taskId, expectedVersion, timestamp)
        this.activity(taskId, 'attachment.created', actor, undefined, { attachmentId, filename, contentType, byteSize: bytes.byteLength }, timestamp)
        this.bumpRevision()
        return { attachment: this.getAttachment(attachmentId), task: this.getTask(taskId) }
      })
    } catch (error) {
      this.queueAttachmentCleanup(storageKey, 'attachment row publication failed')
      this.retryAttachmentCleanup()
      throw error
    }
  }

  listAttachments(taskId: TaskboardTaskId): TaskboardAttachment[] {
    this.getTask(taskId)
    return (this.sql('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at, rowid').all(taskId) as Row[])
      .map(mapAttachment)
  }

  getAttachment(attachmentId: string): TaskboardAttachment {
    const row = this.sql('SELECT * FROM attachments WHERE id = ?').get(attachmentId) as Row | undefined
    if (row === undefined) throw new TaskboardError(`attachment ${attachmentId} was not found`, 'ATTACHMENT_NOT_FOUND')
    return mapAttachment(row)
  }

  /** Read bytes with headers that prevent MIME sniffing and active-content inline rendering. */
  readAttachment(
    attachmentId: string,
    disposition: 'attachment' | 'inline' = 'attachment',
  ): { readonly attachment: TaskboardAttachment; readonly bytes: Uint8Array; readonly headers: Readonly<Record<string, string>> } {
    const row = this.sql('SELECT * FROM attachments WHERE id = ?').get(attachmentId) as Row | undefined
    if (row === undefined) throw new TaskboardError(`attachment ${attachmentId} was not found`, 'ATTACHMENT_NOT_FOUND')
    const attachment = mapAttachment(row)
    const effectiveDisposition = disposition === 'inline' && INLINE_CONTENT_TYPES.has(attachment.contentType) ? 'inline' : 'attachment'
    try {
      const bytes = readFileSync(this.storagePath(String(row['storage_key'])))
      if (bytes.byteLength !== attachment.byteSize) throw new Error('stored byte length does not match authority row')
      return {
        attachment,
        bytes,
        headers: {
          'content-type': attachment.contentType,
          'content-length': String(attachment.byteSize),
          'content-disposition': `${effectiveDisposition}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      }
    } catch (cause) {
      throw new TaskboardError('attachment bytes are unavailable', 'ATTACHMENT_STORAGE_FAILURE', { cause: String(cause) })
    }
  }

  deleteAttachment(
    taskId: TaskboardTaskId,
    attachmentId: string,
    expectedVersion: number,
    actor: TaskboardActor,
  ): TaskboardTask {
    requireHuman(actor, 'delete attachment')
    const task = this.transaction(() => {
      this.mutableTask(taskId, expectedVersion)
      const row = this.sql('SELECT * FROM attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId) as Row | undefined
      if (row === undefined) throw new TaskboardError(`attachment ${attachmentId} was not found`, 'ATTACHMENT_NOT_FOUND')
      const timestamp = now()
      this.queueAttachmentCleanup(String(row['storage_key']), 'attachment deleted', timestamp)
      this.sql('DELETE FROM attachments WHERE id = ?').run(attachmentId)
      this.bumpTaskVersion(taskId, expectedVersion, timestamp)
      this.activity(taskId, 'attachment.deleted', actor, { attachmentId, filename: row['filename'] }, undefined, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
    this.retryAttachmentCleanup()
    return task
  }

  deleteTask(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): void {
    requireHuman(actor, 'delete')
    this.transaction(() => {
      const current = this.getTask(taskId)
      this.expectVersion(current.version, expectedVersion, 'task')
      if (current.archivedAt === undefined) throw new TaskboardError('only archived tasks can be permanently deleted', 'TASK_NOT_ARCHIVED')
      if (this.activeClaimRow(taskId) !== undefined) throw new TaskboardError('cannot delete a task with an active claim', 'TASK_ACTIVE_CLAIM')
      const timestamp = now()
      const attachments = this.sql('SELECT storage_key FROM attachments WHERE task_id = ?').all(taskId) as Row[]
      for (const attachment of attachments) {
        this.queueAttachmentCleanup(String(attachment['storage_key']), 'owning task deleted', timestamp)
      }
      this.sql('DELETE FROM tasks WHERE id = ? AND version = ?').run(taskId, expectedVersion)
      this.bumpRevision()
    })
    this.retryAttachmentCleanup()
  }

  comment(taskId: TaskboardTaskId, expectedVersion: number, body: string, actor: TaskboardActor): TaskboardComment {
    const content = requiredText(body, 'comment')
    return this.transaction(() => {
      this.mutableTask(taskId, expectedVersion)
      const timestamp = now()
      const comment = this.insertComment(taskId, content, actor, timestamp)
      this.bumpTaskVersion(taskId, expectedVersion, timestamp)
      this.activity(taskId, 'comment.created', actor, undefined, { commentId: comment.id }, timestamp)
      this.bumpRevision()
      return comment
    })
  }

  updateComment(
    taskId: TaskboardTaskId,
    expectedVersion: number,
    commentId: string,
    body: string,
    actor: TaskboardActor,
  ): TaskboardComment {
    requireHuman(actor, 'update comment')
    const content = requiredText(body, 'comment')
    return this.transaction(() => {
      this.mutableTask(taskId, expectedVersion)
      const current = this.getComment(commentId)
      if (current.taskId !== taskId) {
        throw new TaskboardError('comment must belong to the same task', 'TASK_INVALID_INPUT', { commentId, taskId })
      }
      const timestamp = now()
      const result = this.sql('UPDATE comments SET body = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .run(content, timestamp, commentId, current.version)
      if (result.changes !== 1) throw new TaskboardError('comment version changed during mutation', 'TASK_STALE_VERSION')
      this.bumpTaskVersion(taskId, expectedVersion, timestamp)
      this.activity(taskId, 'comment.updated', actor, { commentId, body: current.body }, { commentId, body: content }, timestamp)
      this.bumpRevision()
      return this.getComment(commentId)
    })
  }

  deleteComment(
    taskId: TaskboardTaskId,
    expectedVersion: number,
    commentId: string,
    actor: TaskboardActor,
  ): TaskboardTask {
    requireHuman(actor, 'delete comment')
    const task = this.transaction(() => {
      this.mutableTask(taskId, expectedVersion)
      const current = this.getComment(commentId)
      if (current.taskId !== taskId) {
        throw new TaskboardError('comment must belong to the same task', 'TASK_INVALID_INPUT', { commentId, taskId })
      }
      const timestamp = now()
      const attachments = this.sql('SELECT id, storage_key, filename FROM attachments WHERE comment_id = ?').all(commentId) as Row[]
      for (const attachment of attachments) {
        this.queueAttachmentCleanup(String(attachment['storage_key']), 'owning comment deleted', timestamp)
        this.sql('DELETE FROM attachments WHERE id = ?').run(String(attachment['id']))
      }
      this.sql('DELETE FROM comments WHERE id = ?').run(commentId)
      this.bumpTaskVersion(taskId, expectedVersion, timestamp)
      this.activity(taskId, 'comment.deleted', actor, { commentId, body: current.body }, undefined, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
    this.retryAttachmentCleanup()
    return task
  }

  renameProjectLabel(
    projectId: TaskboardProjectId,
    expectedVersion: number,
    from: string,
    to: string,
    actor: TaskboardActor,
  ): TaskboardProject {
    requireHuman(actor, 'rename project label')
    const source = requiredText(from, 'label')
    const target = requiredText(to, 'label')
    if (source === target) throw new TaskboardError('renamed label must change', 'TASK_INVALID_INPUT')
    return this.transaction(() => {
      const project = this.getProject(projectId)
      this.expectVersion(project.version, expectedVersion, 'project')
      const timestamp = now()
      this.replaceProjectLabel(project, source, target, actor, timestamp)
      return this.getProject(projectId)
    })
  }

  removeProjectLabel(
    projectId: TaskboardProjectId,
    expectedVersion: number,
    label: string,
    actor: TaskboardActor,
  ): TaskboardProject {
    requireHuman(actor, 'remove project label')
    const name = requiredText(label, 'label')
    return this.transaction(() => {
      const project = this.getProject(projectId)
      this.expectVersion(project.version, expectedVersion, 'project')
      const timestamp = now()
      this.replaceProjectLabel(project, name, undefined, actor, timestamp)
      return this.getProject(projectId)
    })
  }

  addRelation(sourceTaskId: TaskboardTaskId, expectedSourceVersion: number, targetTaskId: TaskboardTaskId, kind: RelationKind, actor: TaskboardActor): TaskboardRelation {
    if (sourceTaskId === targetTaskId) throw new TaskboardError('a task cannot relate to itself', 'TASK_RELATION_INVALID')
    return this.transaction(() => {
      const source = this.mutableTask(sourceTaskId, expectedSourceVersion)
      const target = this.getTask(targetTaskId)
      if (source.projectId !== target.projectId) throw new TaskboardError('relations require tasks in the same project', 'TASK_RELATION_INVALID')
      let storedSource = sourceTaskId
      let storedTarget = targetTaskId
      if (kind === 'related' && storedSource > storedTarget) [storedSource, storedTarget] = [storedTarget, storedSource]
      if (kind === 'parent' && this.wouldCreateParentCycle(storedSource, storedTarget)) {
        throw new TaskboardError('parent relation would create a cycle', 'TASK_PARENT_CYCLE')
      }
      const existing = this.sql('SELECT id FROM task_relations WHERE source_task_id = ? AND target_task_id = ? AND kind = ?')
        .get(storedSource, storedTarget, kind)
      if (existing !== undefined) throw new TaskboardError('relation already exists', 'TASK_RELATION_INVALID')
      const relationId = RelationId(id('relation'))
      const timestamp = now()
      try {
        this.sql(`
          INSERT INTO task_relations(id, project_id, source_task_id, target_task_id, kind, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(relationId, source.projectId, storedSource, storedTarget, kind, actor.actorId, timestamp)
      } catch (cause) {
        throw new TaskboardError('relation violates project relation rules', 'TASK_RELATION_INVALID', { cause: String(cause) })
      }
      this.activity(sourceTaskId, 'relation.created', actor, undefined, { relationId, kind, targetTaskId }, timestamp)
      this.bumpTaskVersion(sourceTaskId, expectedSourceVersion, timestamp)
      this.bumpRevision()
      const row = this.sql('SELECT * FROM task_relations WHERE id = ?').get(relationId) as Row
      return mapRelation(row)
    })
  }

  removeRelation(relationId: string, expectedSourceVersion: number, actor: TaskboardActor): TaskboardTask {
    return this.transaction(() => {
      const row = this.sql('SELECT * FROM task_relations WHERE id = ?').get(relationId) as Row | undefined
      if (row === undefined) throw new TaskboardError('relation was not found', 'TASK_RELATION_INVALID')
      const sourceTaskId = TaskId(String(row['source_task_id']))
      this.mutableTask(sourceTaskId, expectedSourceVersion)
      const timestamp = now()
      this.sql('DELETE FROM task_relations WHERE id = ?').run(relationId)
      this.bumpTaskVersion(sourceTaskId, expectedSourceVersion, timestamp)
      this.activity(sourceTaskId, 'relation.deleted', actor, {
        relationId,
        kind: row['kind'],
        targetTaskId: row['target_task_id'],
      }, undefined, timestamp)
      this.bumpRevision()
      return this.getTask(sourceTaskId)
    })
  }

  markOrphanedClaims(liveSessionIds: ReadonlySet<string>): number {
    return this.transaction(() => {
      const active = this.sql("SELECT * FROM task_claims WHERE state = 'active'").all() as Row[]
      let changed = 0
      const timestamp = now()
      for (const row of active) {
        if (liveSessionIds.has(String(row['session_id']))) continue
        this.sql("UPDATE task_claims SET state = 'orphaned', updated_at = ? WHERE id = ?").run(timestamp, row['id'] as string)
        changed += 1
      }
      if (changed > 0) this.bumpRevision()
      return changed
    })
  }

  listClaims(states?: readonly TaskboardClaim['state'][]): TaskboardClaim[] {
    if (states === undefined || states.length === 0) {
      return (this.sql('SELECT * FROM task_claims ORDER BY claimed_at, rowid').all() as Row[]).map(mapClaim)
    }
    const rows = this.sql(`SELECT * FROM task_claims WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY claimed_at, rowid`)
      .all(...states) as Row[]
    return rows.map(mapClaim)
  }

  reclaimOrphanedClaim(taskId: TaskboardTaskId, expectedVersion: number, actor: AutomationActor): { task: TaskboardTask; claim: TaskboardClaim } {
    return this.transaction(() => {
      const task = this.mutableTask(taskId, expectedVersion)
      requireStatus(task.status, ['in_progress', 'blocked'], 'reclaim orphaned task')
      const row = this.sql("SELECT * FROM task_claims WHERE task_id = ? AND state = 'orphaned' ORDER BY claimed_at DESC LIMIT 1")
        .get(taskId) as Row | undefined
      if (row === undefined
        || String(row['session_id']) !== actor.sessionId
        || String(row['agent_id']) !== actor.agentId
        || String(row['automation_id']) !== actor.automationId) {
        throw new TaskboardError('orphaned claim does not belong to this automation worker', 'TASK_FOREIGN_CLAIM')
      }
      const timestamp = now()
      this.sql("UPDATE task_claims SET state = 'active', updated_at = ? WHERE id = ? AND state = 'orphaned'")
        .run(timestamp, row['id'] as string)
      this.bumpTaskVersion(taskId, expectedVersion, timestamp)
      this.activity(taskId, 'task.claim-reclaimed', actor, { claimId: row['id'] }, { state: 'active' }, timestamp)
      this.bumpRevision()
      return { task: this.getTask(taskId), claim: mapClaim(this.claimById(String(row['id']))) }
    })
  }

  createWorkflow(projectId: TaskboardProjectId, name: string, document: WorkflowDocument, actor: TaskboardActor): SavedWorkflow {
    requireHuman(actor, 'create workflow')
    const workflowName = requiredText(name, 'workflow name')
    return this.transaction(() => {
      this.getProject(projectId)
      const workflowId = WorkflowId(id('workflow'))
      const timestamp = now()
      this.sql(`
        INSERT INTO workflow_workspaces(id, project_id, name, document_json, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(workflowId, projectId, workflowName, json(document), timestamp, timestamp)
      this.bumpRevision()
      return this.getWorkflow(workflowId)
    })
  }

  getWorkflow(workflowId: string): SavedWorkflow {
    const row = this.sql('SELECT * FROM workflow_workspaces WHERE id = ?').get(workflowId) as Row | undefined
    if (row === undefined) throw new TaskboardError(`workflow ${workflowId} was not found`, 'TASK_INVALID_INPUT')
    return mapWorkflow(row)
  }

  listWorkflows(projectId: TaskboardProjectId): SavedWorkflow[] {
    this.getProject(projectId)
    return (this.sql('SELECT * FROM workflow_workspaces WHERE project_id = ? ORDER BY created_at, rowid').all(projectId) as Row[]).map(mapWorkflow)
  }

  updateWorkflow(workflowId: string, expectedVersion: number, name: string, document: WorkflowDocument, actor: TaskboardActor): SavedWorkflow {
    requireHuman(actor, 'update workflow')
    return this.transaction(() => {
      const current = this.getWorkflow(workflowId)
      this.expectVersion(current.version, expectedVersion, 'workflow')
      const timestamp = now()
      this.sql(`
        UPDATE workflow_workspaces SET name = ?, document_json = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(requiredText(name, 'workflow name'), json(document), timestamp, workflowId, expectedVersion)
      this.bumpRevision()
      return this.getWorkflow(workflowId)
    })
  }

  deleteWorkflow(workflowId: string, expectedVersion: number, actor: TaskboardActor): void {
    requireHuman(actor, 'delete workflow')
    this.transaction(() => {
      const current = this.getWorkflow(workflowId)
      this.expectVersion(current.version, expectedVersion, 'workflow')
      const linked = this.sql('SELECT COUNT(*) AS count FROM tasks WHERE workflow_id = ?').get(workflowId) as Row
      if (Number(linked['count']) > 0) throw new TaskboardError('workflow is still linked to tasks', 'TASK_INVALID_INPUT')
      this.sql('DELETE FROM workflow_workspaces WHERE id = ? AND version = ?').run(workflowId, expectedVersion)
      this.bumpRevision()
    })
  }

  createAutomation(projectId: TaskboardProjectId, config: AutomationRuleConfig, actor: TaskboardActor): AutomationRule {
    requireHuman(actor, 'create automation')
    this.validateAutomationConfig(config)
    return this.transaction(() => {
      this.getProject(projectId)
      const automationId = AutomationId(id('automation'))
      const timestamp = now()
      this.sql(`
        INSERT INTO automation_rules(id, project_id, config_json, state, version, last_decision_json, next_eligible_at, created_at, updated_at)
        VALUES (?, ?, ?, 'paused', 1, NULL, NULL, ?, ?)
      `).run(automationId, projectId, json(config), timestamp, timestamp)
      this.bumpRevision()
      return this.getAutomation(automationId)
    })
  }

  getAutomation(automationId: TaskboardAutomationId | string): AutomationRule {
    const row = this.sql('SELECT * FROM automation_rules WHERE id = ?').get(automationId) as Row | undefined
    if (row === undefined) throw new TaskboardError(`automation ${automationId} was not found`, 'TASK_INVALID_INPUT')
    return mapAutomation(row)
  }

  listAutomations(projectId?: TaskboardProjectId): AutomationRule[] {
    const rows = projectId === undefined
      ? this.sql('SELECT * FROM automation_rules ORDER BY created_at, rowid').all()
      : this.sql('SELECT * FROM automation_rules WHERE project_id = ? ORDER BY created_at, rowid').all(projectId)
    return (rows as Row[]).map(mapAutomation)
  }

  listAutomationRuns(projectId: TaskboardProjectId, limit = 50): AutomationRun[] {
    const rows = this.sql(`
      SELECT r.id, r.rule_id, r.decision_json, r.created_at
      FROM automation_runs r
      INNER JOIN automation_rules a ON a.id = r.rule_id
      WHERE a.project_id = ?
      ORDER BY r.created_at DESC, r.rowid DESC
      LIMIT ?
    `).all(projectId, limit) as Row[]
    return rows.map(mapAutomationRun)
  }

  updateAutomation(
    automationId: TaskboardAutomationId,
    expectedVersion: number,
    update: { readonly config?: AutomationRuleConfig; readonly state?: AutomationState },
    actor: TaskboardActor,
  ): AutomationRule {
    requireHuman(actor, 'update automation')
    return this.transaction(() => {
      const current = this.getAutomation(automationId)
      this.expectVersion(current.version, expectedVersion, 'automation')
      const config = update.config ?? current.config
      const state = update.state ?? current.state
      this.validateAutomationConfig(config)
      const timestamp = now()
      const nextEligible = state === 'enabled' ? timestamp : null
      this.sql(`
        UPDATE automation_rules SET config_json = ?, state = ?, next_eligible_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(json(config), state, nextEligible, timestamp, automationId, expectedVersion)
      this.bumpRevision()
      return this.getAutomation(automationId)
    })
  }

  recordAutomationDecision(
    automationId: TaskboardAutomationId,
    expectedVersion: number,
    decision: AutomationDecision,
    nextEligibleAt: number | undefined,
    state?: AutomationState,
  ): AutomationRule {
    return this.transaction(() => {
      const current = this.getAutomation(automationId)
      this.expectVersion(current.version, expectedVersion, 'automation')
      const timestamp = now()
      this.sql(`
        UPDATE automation_rules SET last_decision_json = ?, next_eligible_at = ?, state = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(json(decision), nextEligibleAt ?? null, state ?? current.state, timestamp, automationId, expectedVersion)
      this.sql('INSERT INTO automation_runs(id, rule_id, decision_json, created_at) VALUES (?, ?, ?, ?)')
        .run(id('automation-run'), automationId, json(decision), timestamp)
      const keep = this.sql(
        'SELECT id FROM automation_runs WHERE rule_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      ).all(automationId, AUTOMATION_RUN_KEEP) as Array<{ id: string }>
      if (keep.length >= AUTOMATION_RUN_KEEP) {
        this.sql(`DELETE FROM automation_runs WHERE rule_id = ? AND id NOT IN (${keep.map(() => '?').join(',')})`)
          .run(automationId, ...keep.map(row => row.id))
      }
      this.bumpRevision()
      return this.getAutomation(automationId)
    })
  }

  private transition(
    taskId: TaskboardTaskId,
    expectedVersion: number,
    allowed: readonly TaskStatus[],
    target: TaskStatus,
    activity: string,
    actor: TaskboardActor,
    retireClaim = false,
  ): TaskboardTask {
    return this.transaction(() => {
      const current = this.mutableTask(taskId, expectedVersion)
      requireStatus(current.status, allowed, activity)
      const timestamp = now()
      if (retireClaim) this.sql("UPDATE task_claims SET state = 'released', updated_at = ? WHERE task_id = ? AND state IN ('active','orphaned')").run(timestamp, taskId)
      this.writeStatus(taskId, expectedVersion, target, timestamp)
      this.activity(taskId, activity, actor, { status: current.status }, { status: target }, timestamp)
      this.bumpRevision()
      return this.getTask(taskId)
    })
  }

  private mutableTask(taskId: TaskboardTaskId, expectedVersion: number): TaskboardTask {
    const task = this.getTask(taskId)
    this.expectVersion(task.version, expectedVersion, 'task')
    if (task.archivedAt !== undefined) throw new TaskboardError('archived tasks are read-only', 'TASK_ARCHIVED')
    return task
  }

  private expectVersion(actual: number, expected: number, subject: string): void {
    if (!Number.isSafeInteger(expected) || expected < 1 || actual !== expected) {
      throw new TaskboardError(
        `${subject} version is stale: expected ${expected}, current ${actual}`,
        'TASK_STALE_VERSION',
        { expected, actual, subject },
      )
    }
  }

  private writeStatus(taskId: TaskboardTaskId, expectedVersion: number, status: TaskStatus, timestamp: number): void {
    const result = this.sql('UPDATE tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run(status, timestamp, taskId, expectedVersion)
    if (result.changes !== 1) throw new TaskboardError('task version changed during transition', 'TASK_STALE_VERSION')
  }

  private bumpTaskVersion(taskId: TaskboardTaskId, expectedVersion: number, timestamp: number): void {
    const result = this.sql('UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run(timestamp, taskId, expectedVersion)
    if (result.changes !== 1) throw new TaskboardError('task version changed during mutation', 'TASK_STALE_VERSION')
  }

  private activeClaimRow(taskId: TaskboardTaskId): Row | undefined {
    return this.sql("SELECT * FROM task_claims WHERE task_id = ? AND state IN ('active','orphaned') ORDER BY claimed_at DESC LIMIT 1")
      .get(taskId) as Row | undefined
  }

  private activeClaim(taskId: TaskboardTaskId): TaskboardClaim | undefined {
    const row = this.activeClaimRow(taskId)
    return row === undefined ? undefined : mapClaim(row)
  }

  private claimById(claimId: string): Row {
    const row = this.sql('SELECT * FROM task_claims WHERE id = ?').get(claimId) as Row | undefined
    if (row === undefined) throw new TaskboardError('claim was not found after creation', 'TASK_FOREIGN_CLAIM')
    return row
  }

  private insertFreshClaim(
    taskId: TaskboardTaskId,
    expectedTaskVersion: number,
    developmentContext: DevelopmentContext | undefined,
    request: FreshClaimRequest,
    timestamp: number,
  ): TaskboardClaimId {
    const sessionId = requiredText(request.sessionId, 'fresh claim Session id')
    const agentId = requiredText(request.agentId, 'fresh claim Agent id')
    if (this.activeClaimRow(taskId) !== undefined) {
      throw new TaskboardError('task already has an active claim', 'TASK_ALREADY_CLAIMED', { taskId })
    }
    const claimId = ClaimId(id('claim'))
    this.sql(`
      INSERT INTO task_claims(id, task_id, session_id, agent_id, automation_id, expected_task_version, state, development_context_json, claimed_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?)
    `).run(
      claimId, taskId, sessionId, agentId, expectedTaskVersion,
      developmentContext === undefined ? null : json(developmentContext), timestamp, timestamp,
    )
    return claimId
  }

  private assertOwningClaim(taskId: TaskboardTaskId, actor: Exclude<TaskboardActor, { kind: 'human' }>): TaskboardClaim {
    const claim = this.activeClaim(taskId)
    if (claim === undefined || claim.state !== 'active' || claim.sessionId !== actor.sessionId || claim.agentId !== actor.agentId) {
      throw new TaskboardError('task is claimed by another Session or has no active owner', 'TASK_FOREIGN_CLAIM', { taskId })
    }
    return claim
  }

  private getComment(commentId: string): TaskboardComment {
    const row = this.sql('SELECT * FROM comments WHERE id = ?').get(commentId) as Row | undefined
    if (row === undefined) throw new TaskboardError(`comment ${commentId} was not found`, 'COMMENT_NOT_FOUND', { commentId })
    return mapComment(row)
  }

  private replaceProjectLabel(
    project: TaskboardProject,
    from: string,
    to: string | undefined,
    actor: TaskboardActor,
    timestamp: number,
  ): void {
    const nextProjectLabels = rewriteLabels(project.labels, from, to)
    this.sql('UPDATE projects SET labels_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run(json(nextProjectLabels), timestamp, project.id, project.version)
    const rows = this.sql('SELECT id, labels_json FROM tasks WHERE project_id = ?').all(project.id) as Row[]
    for (const row of rows) {
      const labels = parseJson<string[]>(row['labels_json'], 'task labels')
      const next = rewriteLabels(labels, from, to)
      if (labels.length === next.length && labels.every((label, index) => label === next[index])) continue
      const taskId = TaskId(String(row['id']))
      this.sql('UPDATE tasks SET labels_json = ?, version = version + 1, updated_at = ? WHERE id = ?')
        .run(json(next), timestamp, taskId)
      this.activity(taskId, 'task.updated', actor, { labels }, { labels: next }, timestamp)
    }
    this.bumpRevision()
  }

  private insertComment(taskId: TaskboardTaskId, body: string, actor: TaskboardActor, timestamp: number): TaskboardComment {
    const commentId = CommentId(id('comment'))
    const sessionId = actor.kind === 'human' ? null : actor.sessionId
    this.sql(`
      INSERT INTO comments(id, task_id, body, author_id, session_id, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(commentId, taskId, body, actor.actorId, sessionId, timestamp, timestamp)
    const row = this.sql('SELECT * FROM comments WHERE id = ?').get(commentId) as Row
    return mapComment(row)
  }

  private activity(taskId: TaskboardTaskId, kind: string, actor: TaskboardActor, before: unknown, after: unknown, timestamp: number): void {
    this.sql(`
      INSERT INTO task_activities(id, task_id, kind, actor_kind, actor_id, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ActivityId(id('activity')), taskId, kind, actor.kind, actor.actorId,
      before === undefined ? null : json(before), after === undefined ? null : json(after), timestamp,
    )
    this.transactionActivities?.push({
      taskId,
      activityKind: kind,
      actorKind: actor.kind,
      actorId: actor.actorId,
    })
  }

  private bumpRevision(): void {
    this.sql('UPDATE taskboard_meta SET global_revision = global_revision + 1 WHERE singleton = 1').run()
  }

  private wouldCreateParentCycle(child: TaskboardTaskId, parent: TaskboardTaskId): boolean {
    let cursor: TaskboardTaskId | undefined = parent
    const visited = new Set<string>()
    while (cursor !== undefined) {
      if (cursor === child) return true
      if (visited.has(cursor)) return true
      visited.add(cursor)
      const row = this.sql("SELECT target_task_id FROM task_relations WHERE source_task_id = ? AND kind = 'parent'").get(cursor) as Row | undefined
      cursor = row === undefined ? undefined : TaskId(String(row['target_task_id']))
    }
    return false
  }

  private validateDevelopmentContext(context: DevelopmentContext | null | undefined): void {
    if (context === undefined || context === null) return
    if (context.kind !== 'branch' && context.kind !== 'worktree') {
      throw new TaskboardError('development context kind must be branch or worktree', 'TASK_INVALID_INPUT')
    }
    requiredText(context.branch, 'development branch')
    if (context.kind === 'worktree') requiredText(context.path, 'worktree path')
  }

  private validateTaskFields(request: CreateTaskRequest | UpdateTaskRequest, projectId?: TaskboardProjectId): void {
    const priorities = new Set<TaskPriority>(['urgent', 'high', 'medium', 'low', 'none'])
    if (request.priority !== undefined && !priorities.has(request.priority)) {
      throw new TaskboardError(`unknown task priority ${String(request.priority)}`, 'TASK_INVALID_INPUT')
    }
    if (request.labels !== undefined && request.labels.some(label => typeof label !== 'string' || label.trim().length === 0)) {
      throw new TaskboardError('task labels must be non-empty strings', 'TASK_INVALID_INPUT')
    }
    if (request.sortOrder !== undefined && !Number.isFinite(request.sortOrder)) {
      throw new TaskboardError('task sortOrder must be finite', 'TASK_INVALID_INPUT')
    }
    for (const [label, value] of [['start date', request.startDate], ['due date', request.dueDate]] as const) {
      if (value !== undefined && value !== null) this.validateDate(value, label)
    }
    if (request.recurrence !== undefined && request.recurrence !== null) {
      if (!['daily', 'weekly', 'monthly'].includes(request.recurrence.frequency)
        || !Number.isSafeInteger(request.recurrence.interval) || request.recurrence.interval < 1) {
        throw new TaskboardError('task recurrence frequency or interval is invalid', 'TASK_INVALID_INPUT')
      }
      if (request.recurrence.until !== undefined) this.validateDate(request.recurrence.until, 'recurrence until')
    }
    if (request.workflowId !== undefined && request.workflowId !== null) {
      const workflow = this.getWorkflow(String(request.workflowId))
      const expectedProject = projectId ?? ('projectId' in request ? request.projectId : undefined)
      if (expectedProject !== undefined && workflow.projectId !== expectedProject) {
        throw new TaskboardError('task workflow must belong to the same project', 'TASK_INVALID_INPUT')
      }
    }
  }

  private validateDate(value: string, label: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TaskboardError(`${label} must use YYYY-MM-DD`, 'TASK_INVALID_INPUT')
    const date = new Date(`${value}T00:00:00Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new TaskboardError(`${label} is not a calendar date`, 'TASK_INVALID_INPUT')
    }
  }

  private validateAutomationConfig(config: AutomationRuleConfig): void {
    if (!Number.isSafeInteger(config.intervalMs) || config.intervalMs < 1_000
      || !Number.isSafeInteger(config.concurrencyLimit) || config.concurrencyLimit < 1
      || config.agentPreset.trim().length === 0) {
      throw new TaskboardError('automation interval, concurrency, or Agent preset is invalid', 'TASK_INVALID_INPUT')
    }
  }

  private validateAttachmentOptions(): void {
    const options = this.attachmentOptions
    if (!isAbsolute(options.root)
      || !Number.isSafeInteger(options.maxAttachmentBytes) || options.maxAttachmentBytes < 1
      || !Number.isSafeInteger(options.maxTaskAttachmentBytes) || options.maxTaskAttachmentBytes < options.maxAttachmentBytes
      || options.allowedContentTypes.length === 0) {
      throw new TaskboardError('attachment storage configuration is invalid', 'TASK_INVALID_INPUT')
    }
    for (const value of options.allowedContentTypes) this.contentType(value, false)
  }

  private safeFilename(value: string): string {
    const filename = requiredText(value, 'attachment filename')
      .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
      .slice(0, 255)
    if (filename === '.' || filename === '..') {
      throw new TaskboardError('attachment filename is invalid', 'TASK_INVALID_INPUT')
    }
    return filename
  }

  private contentType(value: string, enforceAllowlist = true): string {
    const contentType = requiredText(value, 'attachment content type').toLowerCase()
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)) {
      throw new TaskboardError('attachment content type must be a bare MIME type', 'TASK_INVALID_INPUT')
    }
    if (enforceAllowlist && !this.attachmentOptions.allowedContentTypes.includes(contentType)) {
      throw new TaskboardError(`attachment content type ${contentType} is not allowed`, 'ATTACHMENT_TYPE_NOT_ALLOWED', { contentType })
    }
    return contentType
  }

  private newStorageKey(): string {
    const value = randomUUID()
    return `${value.slice(0, 2)}/${value}.blob`
  }

  private storagePath(storageKey: string): string {
    if (!/^[a-f0-9]{2}\/[a-f0-9-]{36}\.blob$/.test(storageKey)) {
      throw new TaskboardError('attachment storage key is invalid', 'ATTACHMENT_STORAGE_FAILURE')
    }
    const path = resolve(this.attachmentOptions.root, storageKey)
    const fromRoot = relative(this.attachmentOptions.root, path)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new TaskboardError('attachment storage path escaped its root', 'ATTACHMENT_STORAGE_FAILURE')
    }
    return path
  }

  private persistAttachmentBytes(storageKey: string, bytes: Uint8Array): void {
    const path = this.storagePath(storageKey)
    const temporary = `${path}.${randomUUID()}.pending`
    mkdirSync(dirname(path), { recursive: true })
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      let offset = 0
      while (offset < bytes.byteLength) offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset)
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      renameSync(temporary, path)
    } catch (cause) {
      if (descriptor !== undefined) closeSync(descriptor)
      try { unlinkSync(temporary) } catch (_missingTemporary) { /* best effort */ }
      throw new TaskboardError('could not persist attachment bytes', 'ATTACHMENT_STORAGE_FAILURE', { cause: String(cause) })
    }
  }

  private queueAttachmentCleanup(storageKey: string, reason: string, timestamp = now()): void {
    this.sql(`
      INSERT INTO attachment_cleanup(storage_key, reason, attempts, created_at, updated_at)
      VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(storage_key) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at
    `).run(storageKey, reason, timestamp, timestamp)
  }

  /** Retry bounded, durable deletion work left by row publication or authoritative deletion. */
  retryAttachmentCleanup(limit = 100): { readonly removed: number; readonly pending: number } {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 1_000)
    const rows = this.sql('SELECT storage_key FROM attachment_cleanup ORDER BY created_at, storage_key LIMIT ?').all(bounded) as Row[]
    let removed = 0
    for (const row of rows) {
      const storageKey = String(row['storage_key'])
      try {
        const path = this.storagePath(storageKey)
        if (existsSync(path)) unlinkSync(path)
        this.sql('DELETE FROM attachment_cleanup WHERE storage_key = ?').run(storageKey)
        removed += 1
      } catch (_cause) {
        this.sql('UPDATE attachment_cleanup SET attempts = attempts + 1, updated_at = ? WHERE storage_key = ?')
          .run(now(), storageKey)
      }
    }
    const pending = this.sql('SELECT COUNT(*) AS count FROM attachment_cleanup').get() as Row
    return { removed, pending: Number(pending['count']) }
  }

  /** Run the full-database integrity scan. It reads every page, so it never runs on the snapshot path. */
  refreshIntegrity(): string {
    const row = this.db.prepare('PRAGMA quick_check(1)').get() as Row | undefined
    this.integrity = String(row?.['quick_check'] ?? 'unknown')
    this.integrityCheckedAt = now()
    return this.integrity
  }

  /** Bounded, path-free health projection. `integrity` is the last scan result, not a fresh scan. */
  storageHealth(): TaskboardStorageHealth {
    const integrity = this.integrity
    const counts = this.sql(`
      SELECT
        (SELECT COUNT(*) FROM projects) AS project_count,
        (SELECT COUNT(*) FROM tasks) AS task_count,
        (SELECT COUNT(*) FROM attachments) AS attachment_count,
        (SELECT COALESCE(SUM(byte_size), 0) FROM attachments) AS attachment_bytes,
        (SELECT COUNT(*) FROM attachment_cleanup) AS cleanup_pending,
        (SELECT COUNT(*) FROM task_claims WHERE state = 'orphaned') AS orphaned_claims
    `).get() as Row
    const cleanupPending = Number(counts['cleanup_pending'])
    return {
      status: integrity === 'ok' && cleanupPending === 0 ? 'ok' : 'degraded',
      integrity,
      integrityCheckedAt: this.integrityCheckedAt,
      schemaVersion: TASKBOARD_SCHEMA_VERSION,
      globalRevision: this.globalRevision(),
      projectCount: Number(counts['project_count']),
      taskCount: Number(counts['task_count']),
      attachmentCount: Number(counts['attachment_count']),
      attachmentBytes: Number(counts['attachment_bytes']),
      cleanupPending,
      orphanedClaims: Number(counts['orphaned_claims']),
    }
  }

  private transaction<T>(operation: () => T): T {
    const revisionBefore = this.globalRevision()
    const activities: NonNullable<SqliteTaskboardProvider['transactionActivities']> = []
    this.transactionActivities = activities
    this.db.exec('BEGIN IMMEDIATE')
    let result: T
    try {
      result = operation()
      this.db.exec('COMMIT')
    } catch (error) {
      this.transactionActivities = undefined
      this.rollback()
      throw error
    }
    this.transactionActivities = undefined
    const globalRevision = this.globalRevision()
    if (globalRevision !== revisionBefore) {
      const events: TaskboardChangeEvent[] = activities.length === 0
        ? [{ type: 'taskboard/changed', globalRevision }]
        : activities.map(activity => {
          let taskVersion: number | undefined
          try { taskVersion = this.getTask(activity.taskId).version } catch (_deletedTask) { /* id-only invalidation */ }
          return {
            type: 'taskboard/changed', globalRevision,
            taskId: activity.taskId,
            ...(taskVersion === undefined ? {} : { taskVersion }),
            activityKind: activity.activityKind,
            actorKind: activity.actorKind,
            actorId: activity.actorId,
          }
        })
      for (const event of events) this.publish(event)
    }
    return result
  }

  private publish(event: TaskboardChangeEvent): void {
    for (const listener of [...this.changeListeners]) {
      try { listener(event) } catch (_subscriberFailure) { /* committed state cannot be rolled back by observers */ }
    }
  }

  private rollback(): void {
    try {
      this.db.exec('ROLLBACK')
    } catch (_transactionAlreadyClosed) {
      // A failed SQLite statement may close the transaction itself.
    }
  }
}
