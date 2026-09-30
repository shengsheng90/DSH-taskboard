import type { DatabaseSync } from 'node:sqlite';
import type { ClaimTaskRequest, CreateAttachmentRequest, CreateProjectRequest, CreateTaskRequest, FreshClaimRequest, RelationKind, TaskDetail, TaskListFilter, TaskStatus, TaskboardActor, TaskboardAttachment, TaskboardClaim, TaskboardComment, TaskboardChangeEvent, TaskboardProject, TaskboardProjectId, TaskboardRelation, TaskboardTask, TaskboardStorageHealth, TaskboardTaskId, UpdateProjectRequest, UpdateTaskRequest, WorkflowDocument, SavedWorkflow, AutomationActor, AutomationDecision, AutomationRule, AutomationRuleConfig, AutomationRun, AutomationState, TaskboardAutomationId } from '../domain/index.js';
export interface TaskboardAttachmentOptions {
    readonly root: string;
    readonly maxAttachmentBytes: number;
    readonly maxTaskAttachmentBytes: number;
    readonly allowedContentTypes: readonly string[];
    readonly allowSharedWorktrees: boolean;
}
/** Hard ceiling for one task page; callers ask for less and learn the total from countTasks. */
export declare const TASK_PAGE_LIMIT = 2000;
/** Newest activity rows returned by default; the log itself is unbounded per task. */
export declare const DEFAULT_ACTIVITY_LIMIT = 50;
/** Give up retrying one undeletable attachment file after this many attempts. */
export declare const ATTACHMENT_CLEANUP_MAX_ATTEMPTS = 10;
/** Local transactional Taskboard authority backed by one SQLite database. */
export declare class SqliteTaskboardProvider {
    readonly db: DatabaseSync;
    readonly attachmentOptions: TaskboardAttachmentOptions;
    private readonly changeListeners;
    private integrity;
    private integrityCheckedAt;
    private readonly statements;
    private transactionActivities;
    constructor(path: string, attachmentOptions?: Partial<TaskboardAttachmentOptions>);
    close(): void;
    /** Compile once and reuse; every statement here is fully materialized before it is reused. */
    private sql;
    /** Subscribe to detached invalidations published only after an authoritative commit. */
    subscribe(listener: (event: TaskboardChangeEvent) => void): () => void;
    globalRevision(): number;
    createProject(request: CreateProjectRequest, actor: TaskboardActor): TaskboardProject;
    getProject(projectId: TaskboardProjectId): TaskboardProject;
    listProjects(): TaskboardProject[];
    updateProject(projectId: TaskboardProjectId, expectedVersion: number, request: UpdateProjectRequest, actor: TaskboardActor): TaskboardProject;
    deleteProject(projectId: TaskboardProjectId, expectedVersion: number, actor: TaskboardActor): void;
    createTask(request: CreateTaskRequest, actor: TaskboardActor): TaskboardTask;
    getTask(taskIdOrIdentifier: TaskboardTaskId | string): TaskboardTask;
    /** `activityLimit` bounds the oldest-first activity log, which grows without limit per task.
     *  Pass 0 to omit it entirely; callers that do not render or read history should. */
    getTaskDetail(taskId: TaskboardTaskId, options?: {
        readonly activityLimit?: number;
    }): TaskDetail;
    private taskFilterSql;
    /** Total tasks matching a filter, so a bounded page can report what it left out. */
    countTasks(filter: TaskListFilter): number;
    listTasks(filter: TaskListFilter): TaskboardTask[];
    updateTask(taskId: TaskboardTaskId, expectedVersion: number, request: UpdateTaskRequest, actor: TaskboardActor): TaskboardTask;
    approve(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask;
    claim(taskId: TaskboardTaskId, request: ClaimTaskRequest, actor: TaskboardActor): {
        task: TaskboardTask;
        claim: TaskboardClaim;
    };
    /** Bind a human-created native Session to a task before the Session starts working.
     *
     * The browser is allowed to initiate this association, but the resulting claim is owned by the
     * Session's Agent id. That keeps model tools and Goal lifecycle events subject to the same
     * ownership checks as an automation-created worker. */
    bindHumanSession(taskId: TaskboardTaskId, expectedVersion: number, request: FreshClaimRequest, actor: TaskboardActor): {
        task: TaskboardTask;
        claim: TaskboardClaim;
    };
    submitReview(taskId: TaskboardTaskId, expectedVersion: number, verification: string, resultComment: string, actor: TaskboardActor): TaskboardTask;
    returnForRework(taskId: TaskboardTaskId, expectedVersion: number, target: 'todo' | 'in_progress', comment: string, actor: TaskboardActor, freshClaim?: FreshClaimRequest): TaskboardTask;
    accept(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask;
    /** Human board/detail status move; releases an in-progress claim when leaving that column. */
    moveStatus(taskId: TaskboardTaskId, expectedVersion: number, status: TaskStatus, actor: TaskboardActor, sortOrder?: number): TaskboardTask;
    block(taskId: TaskboardTaskId, expectedVersion: number, reason: string, actor: TaskboardActor): TaskboardTask;
    resume(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor, target?: 'todo' | 'in_progress', freshClaim?: FreshClaimRequest): TaskboardTask;
    cancel(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask;
    reopen(taskId: TaskboardTaskId, expectedVersion: number, reason: string, actor: TaskboardActor): TaskboardTask;
    releaseClaim(taskId: TaskboardTaskId, expectedVersion: number, reason: string, actor: TaskboardActor): TaskboardTask;
    /** Human-only explicit takeover releases an existing active/orphaned owner back to todo. */
    forceTakeover(taskId: TaskboardTaskId, expectedVersion: number, reason: string, actor: TaskboardActor): TaskboardTask;
    archive(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask;
    restore(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): TaskboardTask;
    /** Persist attachment bytes before publishing their authoritative database row. */
    createAttachment(taskId: TaskboardTaskId, expectedVersion: number, request: CreateAttachmentRequest, actor: TaskboardActor): {
        readonly attachment: TaskboardAttachment;
        readonly task: TaskboardTask;
    };
    listAttachments(taskId: TaskboardTaskId): TaskboardAttachment[];
    getAttachment(attachmentId: string): TaskboardAttachment;
    /** Read bytes with headers that prevent MIME sniffing and active-content inline rendering. */
    readAttachment(attachmentId: string, disposition?: 'attachment' | 'inline'): {
        readonly attachment: TaskboardAttachment;
        readonly bytes: Uint8Array;
        readonly headers: Readonly<Record<string, string>>;
    };
    /** Host-internal resolution for streaming a download without loading the file into memory.
     *  The path never crosses the Client boundary; only the route handler consumes it. */
    openAttachment(attachmentId: string, disposition?: 'attachment' | 'inline'): {
        readonly attachment: TaskboardAttachment;
        readonly path: string;
        readonly headers: Readonly<Record<string, string>>;
    };
    deleteAttachment(taskId: TaskboardTaskId, attachmentId: string, expectedVersion: number, actor: TaskboardActor): TaskboardTask;
    deleteTask(taskId: TaskboardTaskId, expectedVersion: number, actor: TaskboardActor): void;
    comment(taskId: TaskboardTaskId, expectedVersion: number, body: string, actor: TaskboardActor): TaskboardComment;
    updateComment(taskId: TaskboardTaskId, expectedVersion: number, commentId: string, body: string, actor: TaskboardActor): TaskboardComment;
    deleteComment(taskId: TaskboardTaskId, expectedVersion: number, commentId: string, actor: TaskboardActor): TaskboardTask;
    renameProjectLabel(projectId: TaskboardProjectId, expectedVersion: number, from: string, to: string, actor: TaskboardActor): TaskboardProject;
    removeProjectLabel(projectId: TaskboardProjectId, expectedVersion: number, label: string, actor: TaskboardActor): TaskboardProject;
    addRelation(sourceTaskId: TaskboardTaskId, expectedSourceVersion: number, targetTaskId: TaskboardTaskId, kind: RelationKind, actor: TaskboardActor): TaskboardRelation;
    removeRelation(relationId: string, expectedSourceVersion: number, actor: TaskboardActor): TaskboardTask;
    markOrphanedClaims(liveSessionIds: ReadonlySet<string>): number;
    listClaims(states?: readonly TaskboardClaim['state'][]): TaskboardClaim[];
    reclaimOrphanedClaim(taskId: TaskboardTaskId, expectedVersion: number, actor: AutomationActor): {
        task: TaskboardTask;
        claim: TaskboardClaim;
    };
    createWorkflow(projectId: TaskboardProjectId, name: string, document: WorkflowDocument, actor: TaskboardActor): SavedWorkflow;
    getWorkflow(workflowId: string): SavedWorkflow;
    listWorkflows(projectId: TaskboardProjectId): SavedWorkflow[];
    updateWorkflow(workflowId: string, expectedVersion: number, name: string, document: WorkflowDocument, actor: TaskboardActor): SavedWorkflow;
    deleteWorkflow(workflowId: string, expectedVersion: number, actor: TaskboardActor): void;
    createAutomation(projectId: TaskboardProjectId, config: AutomationRuleConfig, actor: TaskboardActor): AutomationRule;
    getAutomation(automationId: TaskboardAutomationId | string): AutomationRule;
    listAutomations(projectId?: TaskboardProjectId): AutomationRule[];
    /** `limit` is annotated for the Typert generator's declaration reader, not for inference. */
    listAutomationRuns(projectId: TaskboardProjectId, limit?: number): AutomationRun[];
    updateAutomation(automationId: TaskboardAutomationId, expectedVersion: number, update: {
        readonly config?: AutomationRuleConfig;
        readonly state?: AutomationState;
    }, actor: TaskboardActor): AutomationRule;
    recordAutomationDecision(automationId: TaskboardAutomationId, expectedVersion: number, decision: AutomationDecision, nextEligibleAt: number | undefined, state?: AutomationState): AutomationRule;
    private transition;
    private mutableTask;
    private expectVersion;
    private writeStatus;
    private bumpTaskVersion;
    private activeClaimRow;
    private activeClaim;
    private claimById;
    private insertFreshClaim;
    private assertOwningClaim;
    private getComment;
    private replaceProjectLabel;
    private insertComment;
    private activity;
    private bumpRevision;
    private wouldCreateParentCycle;
    /** Reject a second owner on an exclusive branch or worktree.
     *  Two rows can hold one context: a live claim, and a task a human moved into `in_progress`
     *  without any claim at all. Both used to be invisible to every path except `claim()`. */
    private assertDevelopmentContextFree;
    private validateDevelopmentContext;
    private validateTaskFields;
    private validateDate;
    private validateAutomationConfig;
    private validateAttachmentOptions;
    private safeFilename;
    private contentType;
    private newStorageKey;
    private storagePath;
    private persistAttachmentBytes;
    private queueAttachmentCleanup;
    /** Retry bounded, durable deletion work left by row publication or authoritative deletion.
     *  Entries that keep failing stop being retried past ATTACHMENT_CLEANUP_MAX_ATTEMPTS; they stay
     *  in the table for inspection but no longer hold storage health at 'degraded' forever.
     *  `limit` is annotated for the Typert generator's declaration reader, not for inference. */
    retryAttachmentCleanup(limit?: number): {
        readonly removed: number;
        readonly pending: number;
        readonly stalled: number;
    };
    /** Run the full-database integrity scan. It reads every page, so it never runs on the snapshot path. */
    refreshIntegrity(): string;
    /** Bounded, path-free health projection. `integrity` is the last scan result, not a fresh scan. */
    storageHealth(): TaskboardStorageHealth;
    private transaction;
    private publish;
    private rollback;
}
//# sourceMappingURL=provider.d.ts.map