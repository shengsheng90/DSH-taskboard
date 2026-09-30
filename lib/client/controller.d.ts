import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { TaskboardSnapshot } from '../service/index.js';
import type { TaskStatus, TaskboardChangeWatchResult, TaskboardRemoteMutationRequest, TaskboardRemoteMutationResult, TaskboardTask, TaskDetail } from '../domain/index.js';
export type TaskboardView = 'dashboard' | 'board' | 'list' | 'labels' | 'gantt' | 'workflows';
export interface TaskboardRoute {
    readonly open: boolean;
    readonly projectId?: string;
    readonly view: TaskboardView;
    readonly taskId?: string;
}
export type RevisionChange = 'initial' | 'same' | 'next' | 'gap' | 'reset';
export declare const AUTOMATION_LOG_PREVIEW_LIMIT = 10;
export declare const BOARD_COLUMN_PAGE_SIZE = 15;
/** Keep the dashboard log short; the remainder opens in a dialog. */
export declare function previewAutomationRuns<T>(runs: readonly T[], limit?: number): {
    readonly preview: readonly T[];
    readonly remaining: number;
};
export interface BoardOrderedTask {
    readonly sortOrder: number;
    readonly createdAt: number;
    readonly id: string;
}
/** Authoritative board column order: manual `sortOrder` first, descending.
 *
 *  Descending keeps the newest card on top without a separate rule, because `createTask`
 *  assigns an increasing `sortOrder` per project. Ordering by anything else (`updatedAt`,
 *  for one) silently discards every drag-to-reorder write. */
export declare function boardColumnOrder<T extends BoardOrderedTask>(tasks: readonly T[]): T[];
/** One page of a board column in manual order; later clicks reveal another page below. */
export declare function paginateBoardColumn<T extends BoardOrderedTask>(tasks: readonly T[], visibleCount?: number): {
    readonly visible: readonly T[];
    readonly remaining: number;
};
/** `sortOrder` that lands a card directly above `target`, or at the column end when dropped on
 *  empty space. Midpoints keep neighbouring cards untouched, so one drop is one write. */
export declare function boardDropSortOrder(column: readonly BoardOrderedTask[], draggedId: string, target?: {
    readonly id: string;
}): number | undefined;
/** Human quick-add from the web form: land in Backlog so drafts are not claimed. */
export declare function humanQuickCreateRequest(projectId: string, title: string): {
    readonly projectId: string;
    readonly title: string;
    readonly creator: 'human:web-client';
    readonly status: 'backlog';
};
/** Content types the page can render inline; everything else is download-only. */
export declare function isPreviewableAttachment(contentType: string): boolean;
/** Empty descriptions open Write; saved Markdown opens Preview. */
export declare function descriptionComposerMode(description: string): 'write' | 'preview';
/** Accept a create mutation result only when it carries a task id. */
export declare function createdTaskId(value: unknown): string | undefined;
/** Fill empty automation model fields from Host defaults without overwriting an explicit rule. */
export declare function applyAutomationDefaults<T>(config: T & {
    readonly modelRoute?: string;
    readonly reasoning?: string;
}, defaults: {
    readonly modelRoute?: string;
    readonly reasoning?: string;
} | undefined): T & {
    readonly modelRoute?: string;
    readonly reasoning?: string;
};
/** Classify bounded-snapshot revisions after events, reconnects, or a Host restart. */
export declare function classifyRevisionChange(previous: number | undefined, next: number): RevisionChange;
export type TaskListSortKey = 'identifier' | 'title' | 'status' | 'priority' | 'dueDate';
export interface TaskListSortable {
    readonly identifier: string;
    readonly title: string;
    readonly status: string;
    readonly priority: string;
    readonly dueDate?: string;
}
/** Order the list view by one column, in the requested direction. */
export declare function sortTaskList<T extends TaskListSortable>(tasks: readonly T[], key: TaskListSortKey, direction?: 'asc' | 'desc'): T[];
export type BoardDropIntent = {
    readonly kind: 'none';
} | {
    readonly kind: 'reorder';
    readonly taskId: string;
    readonly expectedVersion: number;
    readonly sortOrder: number;
} | {
    readonly kind: 'move';
    readonly taskId: string;
    readonly expectedVersion: number;
    readonly status: TaskStatus;
    readonly sortOrder?: number;
};
/** Map a board drop onto reorder-within-column or a human status move.
 *
 *  `column` is every task already in the destination column, so a drop on empty space can
 *  append to the end instead of being discarded. */
export declare function boardDropIntent(dragged: {
    readonly id: string;
    readonly status: TaskStatus;
    readonly version: number;
    readonly archivedAt?: number;
} | undefined, targetStatus: TaskStatus, column?: readonly BoardOrderedTask[], target?: {
    readonly id: string;
}): BoardDropIntent;
/** Labels present on the project catalog or any task, in first-seen order. */
export declare function projectLabelCatalog(projectLabels: readonly string[], tasks: readonly {
    readonly labels: readonly string[];
}[]): string[];
/** Tasks that carry `label`, or unlabeled tasks when `label` is undefined. */
export declare function tasksForLabel<T extends {
    readonly labels: readonly string[];
}>(tasks: readonly T[], label: string | undefined): T[];
/** Restore only an open project-less route; explicit deep links always win. */
export declare function restoreRecentProject(route: TaskboardRoute, recent: string | null): TaskboardRoute;
/** Render the unsent native-conversation draft created only on explicit user request. */
export declare function renderTaskSessionDraft(detail: TaskDetail): string;
/** Generated Taskboard Remote namespace consumed by the native page. */
export interface TaskboardRemoteNamespace {
    snapshot(projectId?: string): Promise<RemoteResult<string>>;
    taskDetail(taskId: string): Promise<RemoteResult<string>>;
    mutate(request: TaskboardRemoteMutationRequest): Promise<RemoteResult<TaskboardRemoteMutationResult>>;
}
/** Decode one refresh-safe Taskboard hash without consulting browser state. */
export declare function decodeTaskboardHash(hash: string): TaskboardRoute;
/** Encode one open page route for deep-link and refresh restoration. */
export declare function encodeTaskboardRoute(route: TaskboardRoute): string;
/** Connection face used by the page after Harness 0.1.2: generation invalidation plus the dedicated RPC channel. */
export interface TaskboardConnection {
    readonly generation: {
        subscribe(listener: () => void): () => void;
    };
    readonly rpc: {
        call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
            ok: true;
            value: unknown;
        } | {
            ok: false;
            error: {
                code: string;
                message: string;
            };
        }>;
    };
}
/** Bind an observable so `useSyncExternalStore` can take the methods without losing `this`. */
export declare function observeSnapshot<T>(source: {
    subscribe(listener: () => void): () => void;
    getSnapshot(): T;
}): {
    subscribe(listener: () => void): () => void;
    getSnapshot(): T;
};
/** Browser-local page state and route codec; business state always comes from the Host. */
export declare class TaskboardClientController {
    readonly connection: TaskboardConnection;
    private readonly remote;
    private readonly selectSession?;
    private readonly createTaskSession?;
    private route;
    private listeners;
    private globalRevision;
    /** Identifies this page's long-poll loop so the Host can release a waiter this page abandoned:
     *  an abort is local and never reaches the Host, so the old waiter held its slot until timeout. */
    private readonly watcherId;
    constructor(connection: TaskboardConnection, remote: TaskboardRemoteNamespace, selectSession?: ((sessionId: string) => void | Promise<void>) | undefined, createTaskSession?: ((workspaceId: string, draft: string) => Promise<string>) | undefined);
    readonly subscribe: (listener: () => void) => (() => void);
    readonly getSnapshot: () => TaskboardRoute;
    open(): void;
    close(): void;
    select(projectId: string | undefined, view?: TaskboardView, taskId?: string): void;
    snapshot(projectId?: string, signal?: AbortSignal): Promise<TaskboardSnapshot>;
    detail(taskId: string, signal?: AbortSignal): Promise<TaskDetail>;
    subscribeConnection(listener: () => void): () => void;
    recordSnapshotRevision(revision: number): RevisionChange;
    openSession(sessionId: string): Promise<void>;
    openNewSession(workspaceId: string, detail: TaskDetail): Promise<string>;
    mutate(endpoint: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
    /** Search the whole project in SQLite. The board can only filter the tasks a snapshot carried. */
    searchTasks(projectId: string, search: string, signal?: AbortSignal): Promise<TaskboardTask[]>;
    watchChanges(afterRevision: number, signal?: AbortSignal): Promise<TaskboardChangeWatchResult>;
    uploadAttachment(taskId: string, expectedVersion: number, file: File, commentId?: string, signal?: AbortSignal): Promise<void>;
    downloadAttachment(attachmentId: string, filename: string): Promise<void>;
    /** One-time inline URL for previewing an attachment in place; the ticket expires after one GET. */
    previewAttachmentUrl(attachmentId: string): Promise<string>;
    dispose(): void;
    private readonly onRoute;
    private navigate;
    private publish;
}
//# sourceMappingURL=controller.d.ts.map