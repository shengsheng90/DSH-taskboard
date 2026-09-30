import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Config } from '../index.js';
import type { AutomationRule, AutomationRun, HumanActor, SavedWorkflow, TaskboardProject, TaskboardProjectId, TaskboardTask, TaskboardTaskId, TaskboardChangeWatchResult, TaskboardRemoteMutationRequest, TaskboardRemoteMutationResult, TaskDetail, TaskboardStorageHealth, WorkflowCatalogEntry } from '../domain/index.js';
import { SqliteTaskboardProvider } from '../sqlite/index.js';
import { WorkflowNodeRegistry } from '../workflow/index.js';
import { TaskboardAttachmentRoutes } from './attachments.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Native local Taskboard service and workflow-node registration seam. */
        taskboard: TaskboardService;
    }
}
export interface ResolvedTaskboardConfig {
    readonly databasePath: string;
    readonly attachmentRoot: string;
    readonly pageSize: number;
    readonly snapshotTaskLimit: number;
    readonly maxAttachmentBytes: number;
    readonly maxTaskAttachmentBytes: number;
    readonly allowedAttachmentTypes: readonly string[];
    readonly minAutomationIntervalMs: number;
    readonly maxProjectWorkers: number;
    readonly maxGlobalWorkers: number;
    readonly allowSharedWorktrees: boolean;
    readonly clientRefreshIntervalMs: number;
    readonly maxChangeWaiters: number;
    readonly maxChangeWatchMs: number;
    readonly defaultAgentPreset: string;
    readonly defaultModelRoute?: string;
}
/** Host-owned scheduler seam used by the human run-now intent. */
export interface TaskboardAutomationHost {
    runImmediate(ruleId: string): Promise<void>;
}
export interface TaskboardSnapshot {
    readonly schemaVersion: 1;
    readonly globalRevision: number;
    readonly projects: readonly TaskboardProject[];
    readonly tasks: readonly TaskboardTask[];
    /** Tasks matching the project in storage; greater than `tasks.length` when the page was cut. */
    readonly taskTotal: number;
    readonly tasksTruncated: boolean;
    readonly workflows: readonly SavedWorkflow[];
    readonly automations: readonly AutomationRule[];
    readonly automationRuns: readonly AutomationRun[];
    readonly workflowCatalog: readonly WorkflowCatalogEntry[];
    readonly workflowCapabilities: {
        readonly skills: readonly {
            readonly name: string;
            readonly description: string;
        }[];
        readonly mcpTools: readonly {
            readonly name: string;
            readonly description: string;
        }[];
        readonly skillDiscoveryComplete: boolean;
    };
    readonly refreshIntervalMs: number;
    readonly automationDefaults: {
        readonly agentPreset: string;
        readonly modelRoute?: string;
        readonly reasoning?: string;
        readonly minIntervalMs: number;
    };
    readonly storageHealth: TaskboardStorageHealth;
}
type RpcResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details: object;
    };
};
/** Read the Host's current model/reasoning so automation forms can prefill them. */
export declare function hostAutomationDefaults(ctx: Context): {
    readonly modelRoute?: string;
    readonly reasoning?: string;
};
/** Harness service facade around the SQLite provider and local Client RPC. */
export declare class TaskboardService extends TypertRemoteService {
    private readonly hostCtx;
    readonly config: ResolvedTaskboardConfig;
    readonly provider: SqliteTaskboardProvider;
    /** Annotated although TypeScript infers it: the Typert generator reads declaration text into
     *  `TYPERT.model`, and an inferred member emits a signature the Host catalog cannot resolve. */
    readonly workflowNodes: WorkflowNodeRegistry;
    readonly attachmentRoutes: TaskboardAttachmentRoutes;
    private workflowSkills;
    private workflowMcpTools;
    private skillDiscoveryComplete;
    private readonly changeWaiters;
    private lastRevision;
    private acceptingChangeWatches;
    private automationHost;
    constructor(ctx: Context, config: Config);
    bindAutomation(host: TaskboardAutomationHost): void;
    runAutomationNow(automationId: string): Promise<AutomationRule>;
    taskDetail(taskId: TaskboardTaskId): TaskDetail;
    snapshot(projectId?: TaskboardProjectId): TaskboardSnapshot;
    remoteSnapshot(projectId?: string): string;
    remoteTaskDetail(taskId: string): string;
    remoteMutate(request: TaskboardRemoteMutationRequest): Promise<TaskboardRemoteMutationResult>;
    /** Wait for a committed revision change without requiring a Harness event extension.
     *  `watcherId` identifies one long-poll loop. A client abort cannot reach the Host, so the
     *  abandoned waiter used to hold its slot for the full timeout; a fresh watch from the same
     *  watcher now settles the one it replaces. */
    watchChanges(afterRevision: number, timeoutMs: number, watcherId?: string): Promise<TaskboardChangeWatchResult>;
    private settleReplacedWatcher;
    /** Dispatch a loopback-authenticated direct UI intent.
     *  The Host error union cannot name a Taskboard code, so it rides in the message on this path. */
    dispatchHumanRpc(endpoint: string, payload: unknown, actor: HumanActor): RpcResult<unknown>;
    private dispatchHumanFailable;
    private dispatchAutomationRunNow;
    private dispatchAutomationRunNowFailable;
    private dispatchHuman;
    private taskId;
    private version;
    private workTarget;
    private freshClaim;
    private validateAutomation;
    private settleChangeWaiters;
}
export {};
//# sourceMappingURL=index.d.ts.map