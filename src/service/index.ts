import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { Config } from '../index.js'
import {
  AutomationId, ProjectId, TaskId, TaskboardError, parseTaskStatus,
} from '../domain/index.js'
import type {
  AutomationRule, AutomationRuleConfig, AutomationRun, AutomationState, CreateProjectRequest, CreateTaskRequest, HumanActor,
  FreshClaimRequest, RelationKind, SavedWorkflow, TaskboardProject, TaskboardProjectId, TaskboardTask, TaskboardTaskId,
  TaskboardChangeWatchResult, TaskboardRemoteMutationRequest, TaskboardRemoteMutationResult, TaskboardSessionRuntime, TaskDetail,
  TaskboardStorageHealth, UpdateProjectRequest, UpdateTaskRequest,
  WorkflowCatalogEntry, WorkflowDocument,
} from '../domain/index.js'
import { SqliteTaskboardProvider } from '../sqlite/index.js'
import { WorkflowNodeRegistry } from '../workflow/index.js'
import { TaskboardAttachmentRoutes } from './attachments.js'
import type {} from '@deepseek-ai/dsh-host-webserver'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Native local Taskboard service and workflow-node registration seam. */
    taskboard: TaskboardService
  }
}

export interface ResolvedTaskboardConfig {
  readonly databasePath: string
  readonly attachmentRoot: string
  readonly pageSize: number
  readonly snapshotTaskLimit: number
  readonly maxAttachmentBytes: number
  readonly maxTaskAttachmentBytes: number
  readonly allowedAttachmentTypes: readonly string[]
  readonly minAutomationIntervalMs: number
  readonly maxProjectWorkers: number
  readonly maxGlobalWorkers: number
  readonly allowSharedWorktrees: boolean
  readonly clientRefreshIntervalMs: number
  readonly maxChangeWaiters: number
  readonly maxChangeWatchMs: number
  readonly defaultAgentPreset: string
  readonly defaultModelRoute?: string
}

/** Host-owned scheduler seam used by the human run-now intent. */
export interface TaskboardAutomationHost {
  runImmediate(ruleId: string): Promise<void>
}

export interface TaskboardSnapshot {
  readonly schemaVersion: 1
  readonly globalRevision: number
  readonly projects: readonly TaskboardProject[]
  readonly tasks: readonly TaskboardTask[]
  /** Tasks matching the project in storage; greater than `tasks.length` when the page was cut. */
  readonly taskTotal: number
  readonly tasksTruncated: boolean
  readonly workflows: readonly SavedWorkflow[]
  readonly automations: readonly AutomationRule[]
  readonly automationRuns: readonly AutomationRun[]
  readonly workflowCatalog: readonly WorkflowCatalogEntry[]
  readonly workflowCapabilities: {
    readonly skills: readonly { readonly name: string; readonly description: string }[]
    readonly mcpTools: readonly { readonly name: string; readonly description: string }[]
    readonly skillDiscoveryComplete: boolean
  }
  readonly refreshIntervalMs: number
  readonly automationDefaults: {
    readonly agentPreset: string
    readonly modelRoute?: string
    readonly reasoning?: string
    readonly minIntervalMs: number
  }
  readonly storageHealth: TaskboardStorageHealth
}

type RpcPayload = Record<string, unknown>

function record(value: unknown, label: string): RpcPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TaskboardError(`${label} must be an object`, 'TASK_INVALID_INPUT')
  }
  return value as RpcPayload
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TaskboardError(`${label} must be a non-empty string`, 'TASK_INVALID_INPUT')
  }
  return value
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TaskboardError(`${label} must be a positive integer`, 'TASK_INVALID_INPUT')
  }
  return value as number
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TaskboardError(`${label} must be a finite number`, 'TASK_INVALID_INPUT')
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TaskboardError(`${label} must be a non-negative integer`, 'TASK_INVALID_INPUT')
  }
  return value as number
}

function human(actorId: string): HumanActor {
  return { kind: 'human', actorId }
}

/** Read the Host's current model/reasoning so automation forms can prefill them. */
export function hostAutomationDefaults(ctx: Context): { readonly modelRoute?: string; readonly reasoning?: string } {
  try {
    const selected = ctx.get('agentDefaultModel') as undefined | {
      currentSelection(): { provider?: string; model?: string; reasoningEffort?: unknown }
    }
    const current = selected?.currentSelection()
    const provider = typeof current?.provider === 'string' ? current.provider.trim() : ''
    const model = typeof current?.model === 'string' ? current.model.trim() : ''
    const reasoning = current?.reasoningEffort
    return {
      ...(provider.length > 0 && model.length > 0 ? { modelRoute: `${provider}:${model}` } : {}),
      ...(typeof reasoning === 'string' && reasoning.trim() !== '' ? { reasoning: reasoning.trim() } : {}),
    }
  } catch {
    return {}
  }
}

function resolveAutomationDefaults(
  config: ResolvedTaskboardConfig,
  host: { readonly modelRoute?: string; readonly reasoning?: string },
): TaskboardSnapshot['automationDefaults'] {
  const modelRoute = config.defaultModelRoute ?? host.modelRoute
  return {
    agentPreset: config.defaultAgentPreset,
    minIntervalMs: config.minAutomationIntervalMs,
    ...(modelRoute === undefined ? {} : { modelRoute }),
    ...(host.reasoning === undefined ? {} : { reasoning: host.reasoning }),
  }
}

function resolved(config: Config): ResolvedTaskboardConfig {
  const databasePath = config.databasePath === ':memory:' ? ':memory:' : resolve(config.databasePath)
  const attachmentRoot = resolve(config.attachmentRoot)
  const maxAttachmentBytes = config.maxAttachmentBytes ?? 25 * 1024 * 1024
  const maxTaskAttachmentBytes = config.maxTaskAttachmentBytes ?? 100 * 1024 * 1024
  if (maxTaskAttachmentBytes < maxAttachmentBytes) {
    throw new Error('taskboard maxTaskAttachmentBytes must be at least maxAttachmentBytes')
  }
  const defaultAgentPreset = (config.defaultAgentPreset ?? 'standard').trim()
  if (defaultAgentPreset.length === 0) throw new Error('taskboard defaultAgentPreset must be non-empty')
  if (config.defaultModelRoute !== undefined && !/^[^:/\s]+[:/][^:/\s]+$/.test(config.defaultModelRoute)) {
    throw new Error('taskboard defaultModelRoute must be provider:model or provider/model')
  }
  return {
    databasePath,
    attachmentRoot,
    pageSize: config.pageSize ?? 100,
    snapshotTaskLimit: config.snapshotTaskLimit ?? 1_000,
    maxAttachmentBytes,
    maxTaskAttachmentBytes,
    allowedAttachmentTypes: config.allowedAttachmentTypes ?? [
      'application/json', 'application/octet-stream', 'application/pdf', 'application/zip',
      'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/markdown', 'text/plain',
    ],
    minAutomationIntervalMs: config.minAutomationIntervalMs ?? 30_000,
    maxProjectWorkers: config.maxProjectWorkers ?? 2,
    maxGlobalWorkers: config.maxGlobalWorkers ?? 4,
    allowSharedWorktrees: config.allowSharedWorktrees ?? false,
    clientRefreshIntervalMs: config.clientRefreshIntervalMs ?? 15_000,
    maxChangeWaiters: config.maxChangeWaiters ?? 128,
    maxChangeWatchMs: config.maxChangeWatchMs ?? 30_000,
    defaultAgentPreset,
    ...(config.defaultModelRoute === undefined ? {} : { defaultModelRoute: config.defaultModelRoute }),
  }
}

/** Harness service facade around the SQLite provider and local Client RPC. */
export class TaskboardService extends TypertRemoteService {
  private readonly hostCtx: Context
  readonly config: ResolvedTaskboardConfig
  readonly provider: SqliteTaskboardProvider
  readonly workflowNodes = new WorkflowNodeRegistry()
  readonly attachmentRoutes: TaskboardAttachmentRoutes
  private workflowSkills: Array<{ name: string; description: string }> = []
  private workflowMcpTools: Array<{ name: string; description: string }> = []
  private skillDiscoveryComplete = false
  private readonly changeWaiters = new Set<{
    readonly afterRevision: number
    readonly timer: ReturnType<typeof setTimeout>
    readonly resolve: (result: TaskboardChangeWatchResult) => void
  }>()
  private lastRevision = 0
  private acceptingChangeWatches = true
  private automationHost: TaskboardAutomationHost | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'taskboard')
    this.hostCtx = ctx
    this.config = resolved(config)
    this.provider = new SqliteTaskboardProvider(this.config.databasePath, {
      root: this.config.attachmentRoot,
      maxAttachmentBytes: this.config.maxAttachmentBytes,
      maxTaskAttachmentBytes: this.config.maxTaskAttachmentBytes,
      allowedContentTypes: this.config.allowedAttachmentTypes,
      allowSharedWorktrees: this.config.allowSharedWorktrees,
    })
    this.lastRevision = this.provider.globalRevision()
    this.attachmentRoutes = new TaskboardAttachmentRoutes(this.provider)
    ctx.effect(() => () => { this.provider.close() }, 'taskboard: close SQLite authority')
    ctx.effect(() => {
      const dispose = this.provider.subscribe(event => {
        this.lastRevision = event.globalRevision
        this.settleChangeWaiters(event.globalRevision, true)
      })
      return () => {
        this.acceptingChangeWatches = false
        dispose()
        this.settleChangeWaiters(this.lastRevision, false)
      }
    }, 'taskboard: revision long-poll lifecycle')
    ctx.inject(['connection'], (connectionCtx) => {
      const handler: ConnectionRpcHandler = (endpoint, payload) => endpoint === 'automation.run-now'
        ? this.dispatchAutomationRunNow(payload)
        : Promise.resolve(this.dispatchHumanRpc(endpoint, payload, human('human:web-client')))
      connectionCtx.effect(
        () => connectionCtx.connection.rpc.handle(
          '/taskboard',
          handler,
          { authority: 'loopback' },
        ),
        'taskboard: loopback Client RPC',
      )
    })
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => this.attachmentRoutes.mount(webCtx.webServer), 'taskboard: attachment byte route')
    })
    ctx.inject(['skills'] as never, (skillCtx: Context) => {
      const skills = (skillCtx as Context & { skills: { snapshot(): Promise<{ skills: Array<{ name: string; description: string }>; complete: boolean }> } }).skills
      const refresh = (): void => {
        void skills.snapshot().then(result => {
          this.workflowSkills = result.skills.map(skill => ({ name: skill.name, description: skill.description }))
          this.skillDiscoveryComplete = result.complete
        }, () => { this.skillDiscoveryComplete = false })
      }
      refresh()
      skillCtx.on('skills/change' as never, refresh as never)
    })
    ctx.inject(['tools'], (toolCtx) => {
      const refresh = (): void => {
        this.workflowMcpTools = toolCtx.tools.schemas()
          .filter(schema => schema.name.startsWith('mcp__'))
          .map(schema => ({ name: schema.name, description: schema.description }))
      }
      refresh()
      toolCtx.on('tools/change', refresh)
    })
  }

  bindAutomation(host: TaskboardAutomationHost): void {
    this.automationHost = host
  }

  async runAutomationNow(automationId: string): Promise<AutomationRule> {
    this.provider.getAutomation(automationId)
    if (this.automationHost === undefined) {
      throw new TaskboardError('automation coordinator is not running', 'TASK_INVALID_INPUT')
    }
    await this.automationHost.runImmediate(automationId)
    return this.provider.getAutomation(automationId)
  }

  taskDetail(taskId: TaskboardTaskId): TaskDetail {
    const detail = this.provider.getTaskDetail(taskId)
    const agents = this.hostCtx.get('agents') as undefined | {
      get(id: string): undefined | {
        status: 'idle' | 'running'
        session: { events: ReadonlyArray<{ type: string; data: unknown }> }
      }
    }
    const sessionRuntime = detail.claims.map(claim => {
      const agent = agents?.get(claim.sessionId)
      const todoEvent = agent?.session.events.findLast(event => event.type === 'todo/write')
      const todos: TaskboardSessionRuntime['todos'] = todoEvent === undefined
        ? []
        : ((todoEvent.data as { todos?: TaskboardSessionRuntime['todos'] }).todos ?? [])
      const status: TaskboardSessionRuntime['status'] = agent?.status ?? 'offline'
      return {
        sessionId: claim.sessionId,
        status,
        current: detail.activeClaim?.id === claim.id,
        todos,
      }
    })
    return { ...detail, sessionRuntime }
  }

  snapshot(projectId?: TaskboardProjectId): TaskboardSnapshot {
    const projects = this.provider.listProjects()
    // A projectId that no longer exists (deleted elsewhere, or a stale deep link) must not fail
    // the whole snapshot -- fall back to the first project so the page stays usable.
    const requested = projectId !== undefined && projects.some(project => project.id === projectId) ? projectId : undefined
    const selected = requested ?? projects[0]?.id
    const filter = { includeArchived: true } as const
    const tasks = selected === undefined
      ? []
      : this.provider.listTasks({ projectId: selected, ...filter, limit: this.config.snapshotTaskLimit })
    const taskTotal = selected === undefined ? 0 : this.provider.countTasks({ projectId: selected, ...filter })
    return {
      schemaVersion: 1,
      globalRevision: this.provider.globalRevision(),
      projects,
      tasks,
      taskTotal,
      tasksTruncated: taskTotal > tasks.length,
      workflows: selected === undefined ? [] : this.provider.listWorkflows(selected),
      automations: selected === undefined ? [] : this.provider.listAutomations(selected),
      automationRuns: selected === undefined ? [] : this.provider.listAutomationRuns(selected),
      workflowCatalog: this.workflowNodes.catalog(),
      workflowCapabilities: {
        skills: this.workflowSkills,
        mcpTools: this.workflowMcpTools,
        skillDiscoveryComplete: this.skillDiscoveryComplete,
      },
      refreshIntervalMs: this.config.clientRefreshIntervalMs,
      automationDefaults: resolveAutomationDefaults(this.config, hostAutomationDefaults(this.hostCtx)),
      storageHealth: this.provider.storageHealth(),
    }
  }

  @Remote('snapshot')
  remoteSnapshot(projectId?: string): string {
    return JSON.stringify(this.snapshot(projectId === undefined ? undefined : ProjectId(projectId)))
  }

  @Remote('taskDetail')
  remoteTaskDetail(taskId: string): string {
    return JSON.stringify(this.taskDetail(TaskId(taskId)))
  }

  @Remote('mutate')
  async remoteMutate(request: TaskboardRemoteMutationRequest): Promise<TaskboardRemoteMutationResult> {
    let payload: unknown
    try {
      payload = JSON.parse(request.payloadJson) as unknown
    } catch (_invalidJson) {
      return { ok: false, errorCode: 'invalid-json', errorMessage: 'payloadJson must contain one JSON object' }
    }
    if (request.endpoint === 'changes.watch') {
      try {
        const input = record(payload, 'RPC payload')
        const result = await this.watchChanges(
          nonNegativeInteger(input['afterRevision'], 'afterRevision'),
          integer(input['timeoutMs'], 'timeoutMs'),
        )
        return { ok: true, valueJson: JSON.stringify(result) }
      } catch (error) {
        const message = error instanceof TaskboardError ? error.message : error instanceof Error ? error.message : String(error)
        return { ok: false, errorCode: error instanceof TaskboardError ? error.code : 'internal', errorMessage: message }
      }
    }
    if (request.endpoint === 'automation.run-now') {
      const result = await this.dispatchAutomationRunNow(payload)
      if (!result.ok) return { ok: false, errorCode: result.error.code, errorMessage: result.error.message }
      return { ok: true, valueJson: JSON.stringify(result.value ?? null) }
    }
    const result = this.dispatchHumanRpc(request.endpoint, payload, human('human:web-client'))
    if (!result.ok) return { ok: false, errorCode: result.error.code, errorMessage: result.error.message }
    return { ok: true, valueJson: JSON.stringify(result.value ?? null) }
  }

  /** Wait for a committed revision change without requiring a Harness event extension. */
  watchChanges(afterRevision: number, timeoutMs: number): Promise<TaskboardChangeWatchResult> {
    const boundedTimeout = Math.min(Math.max(timeoutMs, 1), this.config.maxChangeWatchMs)
    const current = this.provider.globalRevision()
    this.lastRevision = current
    if (!this.acceptingChangeWatches || current !== afterRevision) {
      return Promise.resolve({ globalRevision: current, changed: current !== afterRevision })
    }
    if (this.changeWaiters.size >= this.config.maxChangeWaiters) {
      throw new TaskboardError('too many concurrent Taskboard change watches', 'TASK_INVALID_INPUT')
    }
    return new Promise(resolve => {
      const waiter = {
        afterRevision,
        timer: setTimeout(() => {
          this.changeWaiters.delete(waiter)
          const globalRevision = this.provider.globalRevision()
          this.lastRevision = globalRevision
          resolve({ globalRevision, changed: globalRevision !== afterRevision })
        }, boundedTimeout),
        resolve,
      }
      this.changeWaiters.add(waiter)
    })
  }

  /** Dispatch a loopback-authenticated direct UI intent. */
  dispatchHumanRpc(endpoint: string, payload: unknown, actor: HumanActor): RpcResult<unknown> {
    try {
      const input = record(payload, 'RPC payload')
      const value = this.dispatchHuman(endpoint, input, actor)
      return { ok: true, value }
    } catch (error) {
      const message = error instanceof TaskboardError
        ? `${error.code}: ${error.message}`
        : error instanceof Error ? error.message : String(error)
      return { ok: false, error: { code: 'internal', message, details: {} } }
    }
  }

  private async dispatchAutomationRunNow(payload: unknown): Promise<RpcResult<unknown>> {
    try {
      const input = record(payload, 'RPC payload')
      const value = await this.runAutomationNow(string(input['automationId'], 'automationId'))
      return { ok: true, value }
    } catch (error) {
      const message = error instanceof TaskboardError
        ? `${error.code}: ${error.message}`
        : error instanceof Error ? error.message : String(error)
      return { ok: false, error: { code: 'internal', message, details: {} } }
    }
  }

  private dispatchHuman(endpoint: string, input: RpcPayload, actor: HumanActor): unknown {
    switch (endpoint) {
      case 'snapshot':
        return this.snapshot(input['projectId'] === undefined ? undefined : ProjectId(string(input['projectId'], 'projectId')))
      case 'project.create':
        return this.provider.createProject(record(input['request'], 'request') as unknown as CreateProjectRequest, actor)
      case 'project.update':
        return this.provider.updateProject(
          ProjectId(string(input['projectId'], 'projectId')), this.version(input),
          record(input['request'], 'request') as unknown as UpdateProjectRequest, actor,
        )
      case 'project.delete':
        return this.provider.deleteProject(
          ProjectId(string(input['projectId'], 'projectId')),
          integer(input['expectedVersion'], 'expectedVersion'),
          actor,
        )
      case 'task.create':
        return this.provider.createTask(record(input['request'], 'request') as unknown as CreateTaskRequest, actor)
      case 'task.detail':
        return this.taskDetail(this.taskId(input))
      case 'task.update':
        return this.provider.updateTask(
          TaskId(string(input['taskId'], 'taskId')),
          integer(input['expectedVersion'], 'expectedVersion'),
          record(input['request'], 'request') as unknown as UpdateTaskRequest,
          actor,
        )
      case 'task.approve':
        return this.provider.approve(this.taskId(input), this.version(input), actor)
      case 'task.accept':
        return this.provider.accept(this.taskId(input), this.version(input), actor)
      case 'task.move':
        return this.provider.moveStatus(
          this.taskId(input), this.version(input), parseTaskStatus(string(input['status'], 'status')), actor,
          input['sortOrder'] === undefined ? undefined : finiteNumber(input['sortOrder'], 'sortOrder'),
        )
      case 'task.return':
        return this.provider.returnForRework(
          this.taskId(input), this.version(input), this.workTarget(input),
          string(input['comment'], 'comment'), actor, this.freshClaim(input),
        )
      case 'task.block':
        return this.provider.block(this.taskId(input), this.version(input), string(input['reason'], 'reason'), actor)
      case 'task.resume':
        return this.provider.resume(
          this.taskId(input), this.version(input), actor, this.workTarget(input), this.freshClaim(input),
        )
      case 'task.cancel':
        return this.provider.cancel(this.taskId(input), this.version(input), actor)
      case 'task.reopen':
        return this.provider.reopen(this.taskId(input), this.version(input), string(input['reason'], 'reason'), actor)
      case 'task.archive':
        return this.provider.archive(this.taskId(input), this.version(input), actor)
      case 'task.restore':
        return this.provider.restore(this.taskId(input), this.version(input), actor)
      case 'task.force-takeover':
        return this.provider.forceTakeover(
          this.taskId(input), this.version(input), string(input['reason'], 'reason'), actor,
        )
      case 'task.delete':
        return this.provider.deleteTask(this.taskId(input), this.version(input), actor)
      case 'task.comment':
        return this.provider.comment(this.taskId(input), this.version(input), string(input['body'], 'body'), actor)
      case 'comment.update':
        return this.provider.updateComment(
          this.taskId(input), this.version(input), string(input['commentId'], 'commentId'), string(input['body'], 'body'), actor,
        )
      case 'comment.delete':
        return this.provider.deleteComment(
          this.taskId(input), this.version(input), string(input['commentId'], 'commentId'), actor,
        )
      case 'project.rename-label':
        return this.provider.renameProjectLabel(
          ProjectId(string(input['projectId'], 'projectId')), this.version(input),
          string(input['from'], 'from'), string(input['to'], 'to'), actor,
        )
      case 'project.remove-label':
        return this.provider.removeProjectLabel(
          ProjectId(string(input['projectId'], 'projectId')), this.version(input), string(input['label'], 'label'), actor,
        )
      case 'task.relation':
        return this.provider.addRelation(
          this.taskId(input), this.version(input), TaskId(string(input['targetTaskId'], 'targetTaskId')),
          string(input['kind'], 'kind') as RelationKind, actor,
        )
      case 'relation.delete':
        return this.provider.removeRelation(string(input['relationId'], 'relationId'), this.version(input), actor)
      case 'attachment.delete':
        return this.provider.deleteAttachment(
          this.taskId(input), string(input['attachmentId'], 'attachmentId'), this.version(input), actor,
        )
      case 'attachment.upload-ticket':
        return this.attachmentRoutes.issueUpload({
          taskId: string(input['taskId'], 'taskId'),
          expectedVersion: integer(input['expectedVersion'], 'expectedVersion'),
          filename: string(input['filename'], 'filename'),
          contentType: string(input['contentType'], 'contentType'),
          ...(input['commentId'] === undefined ? {} : { commentId: string(input['commentId'], 'commentId') }),
        }, actor)
      case 'attachment.download-ticket': {
        const disposition = input['disposition'] === 'inline' ? 'inline' : 'attachment'
        return this.attachmentRoutes.issueDownload(string(input['attachmentId'], 'attachmentId'), disposition)
      }
      case 'workflow.create': {
        const document = record(input['document'], 'document') as unknown as WorkflowDocument
        this.workflowNodes.validate(document)
        return this.provider.createWorkflow(ProjectId(string(input['projectId'], 'projectId')), string(input['name'], 'name'), document, actor)
      }
      case 'workflow.update': {
        const document = record(input['document'], 'document') as unknown as WorkflowDocument
        this.workflowNodes.validate(document)
        return this.provider.updateWorkflow(
          string(input['workflowId'], 'workflowId'), this.version(input), string(input['name'], 'name'), document, actor,
        )
      }
      case 'workflow.delete':
        return this.provider.deleteWorkflow(string(input['workflowId'], 'workflowId'), this.version(input), actor)
      case 'automation.create': {
        const config = record(input['config'], 'config') as unknown as AutomationRuleConfig
        this.validateAutomation(config)
        return this.provider.createAutomation(ProjectId(string(input['projectId'], 'projectId')), config, actor)
      }
      case 'storage.check-integrity':
        // The full-page scan is explicit: it must never ride along on the snapshot path.
        this.provider.refreshIntegrity()
        return this.provider.storageHealth()
      case 'automation.update': {
        const update = record(input['update'], 'update') as { config?: AutomationRuleConfig; state?: AutomationState }
        if (update.config !== undefined) this.validateAutomation(update.config)
        return this.provider.updateAutomation(
          AutomationId(string(input['automationId'], 'automationId')), this.version(input), update, actor,
        )
      }
      default:
        throw new TaskboardError(`unknown Taskboard endpoint ${endpoint}`, 'TASK_INVALID_INPUT')
    }
  }

  private taskId(input: RpcPayload): TaskboardTaskId {
    return TaskId(string(input['taskId'], 'taskId'))
  }

  private version(input: RpcPayload): number {
    return integer(input['expectedVersion'], 'expectedVersion')
  }

  private workTarget(input: RpcPayload): 'todo' | 'in_progress' {
    const target = input['target'] ?? 'todo'
    if (target !== 'todo' && target !== 'in_progress') {
      throw new TaskboardError('target must be todo or in_progress', 'TASK_INVALID_INPUT')
    }
    return target
  }

  private freshClaim(input: RpcPayload): FreshClaimRequest | undefined {
    if (input['freshClaim'] === undefined) return undefined
    const claim = record(input['freshClaim'], 'freshClaim')
    return {
      sessionId: string(claim['sessionId'], 'freshClaim.sessionId'),
      agentId: string(claim['agentId'], 'freshClaim.agentId'),
    }
  }

  private validateAutomation(config: AutomationRuleConfig): void {
    if (config.intervalMs < this.config.minAutomationIntervalMs) {
      throw new TaskboardError(
        `automation interval must be at least ${this.config.minAutomationIntervalMs}ms`,
        'TASK_INVALID_INPUT',
      )
    }
  }

  private settleChangeWaiters(globalRevision: number, changed: boolean): void {
    for (const waiter of [...this.changeWaiters]) {
      if (changed && waiter.afterRevision === globalRevision) continue
      this.changeWaiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.resolve({ globalRevision, changed: changed && waiter.afterRevision !== globalRevision })
    }
  }
}
