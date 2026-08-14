import type {
  TaskboardActivityId, TaskboardAttachmentId, TaskboardClaimId, TaskboardCommentId, TaskboardProjectId,
  TaskboardRelationId, TaskboardTaskId, TaskboardWorkflowId,
} from './ids.js'

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'] as const
export type TaskStatus = typeof TASK_STATUSES[number]
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'
export type RelationKind = 'parent' | 'blocks' | 'related'
export type ClaimState = 'active' | 'orphaned' | 'released' | 'submitted' | 'reclaimed'

export interface HumanActor {
  readonly kind: 'human'
  readonly actorId: string
}

export interface AgentActor {
  readonly kind: 'agent'
  readonly actorId: string
  readonly sessionId: string
  readonly agentId: string
}

export interface AutomationActor {
  readonly kind: 'automation'
  readonly actorId: string
  readonly automationId: string
  readonly sessionId: string
  readonly agentId: string
}

export type TaskboardActor = HumanActor | AgentActor | AutomationActor

export interface DevelopmentContextBranch {
  readonly kind: 'branch'
  readonly branch: string
}

export interface DevelopmentContextWorktree {
  readonly kind: 'worktree'
  readonly path: string
  readonly branch: string
}

export type DevelopmentContext = DevelopmentContextBranch | DevelopmentContextWorktree

export interface RecurrenceRule {
  readonly frequency: 'daily' | 'weekly' | 'monthly'
  readonly interval: number
  readonly until?: string
}

export interface TaskboardProject {
  readonly id: TaskboardProjectId
  readonly key: string
  readonly name: string
  readonly workspaceId?: string
  readonly labels: readonly string[]
  readonly nextIssueNumber: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly version: number
}

export interface TaskboardTask {
  readonly id: TaskboardTaskId
  readonly projectId: TaskboardProjectId
  readonly identifier: string
  readonly title: string
  readonly description: string
  readonly status: TaskStatus
  readonly priority: TaskPriority
  readonly labels: readonly string[]
  readonly sortOrder: number
  readonly assignee?: string
  readonly creator: string
  readonly startDate?: string
  readonly dueDate?: string
  readonly recurrence?: RecurrenceRule
  readonly workflowId?: TaskboardWorkflowId
  readonly developmentContext?: DevelopmentContext
  readonly source?: Readonly<Record<string, unknown>>
  readonly archivedAt?: number
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface TaskboardComment {
  readonly id: TaskboardCommentId
  readonly taskId: TaskboardTaskId
  readonly body: string
  readonly authorId: string
  readonly sessionId?: string
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface TaskboardRelation {
  readonly id: TaskboardRelationId
  readonly projectId: TaskboardProjectId
  readonly sourceTaskId: TaskboardTaskId
  readonly targetTaskId: TaskboardTaskId
  readonly kind: RelationKind
  readonly createdAt: number
  readonly actorId: string
}

export interface TaskboardClaim {
  readonly id: TaskboardClaimId
  readonly taskId: TaskboardTaskId
  readonly sessionId: string
  readonly agentId: string
  readonly automationId?: string
  readonly expectedTaskVersion: number
  readonly state: ClaimState
  readonly developmentContext?: DevelopmentContext
  readonly claimedAt: number
  readonly updatedAt: number
}

export interface TaskboardActivity {
  readonly id: TaskboardActivityId
  readonly taskId: TaskboardTaskId
  readonly kind: string
  readonly actorKind: TaskboardActor['kind']
  readonly actorId: string
  readonly before?: unknown
  readonly after?: unknown
  readonly createdAt: number
}

export interface TaskboardAttachment {
  readonly id: TaskboardAttachmentId
  readonly taskId: TaskboardTaskId
  readonly commentId?: TaskboardCommentId
  readonly filename: string
  readonly contentType: string
  readonly byteSize: number
  readonly createdAt: number
}

export interface CreateAttachmentRequest {
  readonly filename: string
  readonly contentType: string
  readonly bytes: Uint8Array
  readonly commentId?: TaskboardCommentId
}

export interface CreateProjectRequest {
  readonly key: string
  readonly name: string
  readonly workspaceId?: string
  readonly labels?: readonly string[]
}

export interface UpdateProjectRequest {
  readonly name?: string
  readonly workspaceId?: string | null
  readonly labels?: readonly string[]
}

export interface CreateTaskRequest {
  readonly projectId: TaskboardProjectId
  readonly title: string
  readonly description?: string
  readonly status?: 'backlog' | 'todo'
  readonly priority?: TaskPriority
  readonly labels?: readonly string[]
  readonly sortOrder?: number
  readonly assignee?: string
  readonly creator: string
  readonly startDate?: string
  readonly dueDate?: string
  readonly recurrence?: RecurrenceRule
  readonly workflowId?: TaskboardWorkflowId
  readonly developmentContext?: DevelopmentContext
  readonly source?: Readonly<Record<string, unknown>>
}

export interface UpdateTaskRequest {
  readonly title?: string
  readonly description?: string
  readonly priority?: TaskPriority
  readonly labels?: readonly string[]
  readonly sortOrder?: number
  readonly assignee?: string | null
  readonly startDate?: string | null
  readonly dueDate?: string | null
  readonly recurrence?: RecurrenceRule | null
  readonly workflowId?: TaskboardWorkflowId | null
  readonly developmentContext?: DevelopmentContext | null
}

export interface ClaimTaskRequest {
  readonly expectedVersion: number
  readonly sessionId: string
  readonly agentId: string
}

/** Human-selected owner used when rework or resume starts immediately. */
export interface FreshClaimRequest {
  readonly sessionId: string
  readonly agentId: string
}

export interface TaskDetail {
  readonly task: TaskboardTask
  readonly comments: readonly TaskboardComment[]
  readonly activities: readonly TaskboardActivity[]
  readonly relations: readonly TaskboardRelation[]
  readonly attachments: readonly TaskboardAttachment[]
  readonly activeClaim?: TaskboardClaim
  readonly claims: readonly TaskboardClaim[]
  /** Live Harness projection; absent at the SQLite boundary and rebuilt by the Host service. */
  readonly sessionRuntime?: readonly TaskboardSessionRuntime[]
  readonly globalRevision: number
}

export interface TaskboardSessionRuntime {
  readonly sessionId: string
  readonly status: 'idle' | 'running' | 'offline'
  readonly current: boolean
  readonly todos: readonly {
    readonly content: string
    readonly status: 'pending' | 'in_progress' | 'completed'
  }[]
}

export interface TaskboardStorageHealth {
  readonly status: 'ok' | 'degraded'
  readonly integrity: string
  readonly schemaVersion: number
  readonly globalRevision: number
  readonly projectCount: number
  readonly taskCount: number
  readonly attachmentCount: number
  readonly attachmentBytes: number
  readonly cleanupPending: number
  readonly orphanedClaims: number
}

/** Detached post-commit invalidation event; it never exposes storage handles or Host paths. */
export interface TaskboardChangeEvent {
  readonly type: 'taskboard/changed'
  readonly globalRevision: number
  readonly taskId?: TaskboardTaskId
  readonly taskVersion?: number
  readonly activityKind?: string
  readonly actorKind?: TaskboardActor['kind']
  readonly actorId?: string
}

/** Bounded long-poll result carried through the plugin's existing Typert Remote. */
export interface TaskboardChangeWatchResult {
  readonly globalRevision: number
  readonly changed: boolean
}

export interface TaskListFilter {
  readonly projectId: TaskboardProjectId
  readonly statuses?: readonly TaskStatus[]
  readonly includeArchived?: boolean
  readonly search?: string
  readonly limit?: number
  readonly offset?: number
}

/** JSON-text mutation carrier used by generated Typert clients. */
export interface TaskboardRemoteMutationRequest {
  readonly endpoint: string
  readonly payloadJson: string
}

/** Stable JSON-text mutation response with transport errors kept explicit. */
export interface TaskboardRemoteMutationResult {
  readonly ok: boolean
  readonly valueJson?: string
  readonly errorCode?: string
  readonly errorMessage?: string
}
