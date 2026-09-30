import { TASK_STATUSES } from '../domain/index.js';
export const AUTOMATION_LOG_PREVIEW_LIMIT = 10;
export const BOARD_COLUMN_PAGE_SIZE = 15;
/** Keep the dashboard log short; the remainder opens in a dialog. */
export function previewAutomationRuns(runs, limit = AUTOMATION_LOG_PREVIEW_LIMIT) {
    return { preview: runs.slice(0, limit), remaining: Math.max(0, runs.length - limit) };
}
/** Authoritative board column order: manual `sortOrder` first, descending.
 *
 *  Descending keeps the newest card on top without a separate rule, because `createTask`
 *  assigns an increasing `sortOrder` per project. Ordering by anything else (`updatedAt`,
 *  for one) silently discards every drag-to-reorder write. */
export function boardColumnOrder(tasks) {
    return [...tasks].sort((left, right) => {
        if (right.sortOrder !== left.sortOrder)
            return right.sortOrder - left.sortOrder;
        if (right.createdAt !== left.createdAt)
            return right.createdAt - left.createdAt;
        return left.id.localeCompare(right.id);
    });
}
/** One page of a board column in manual order; later clicks reveal another page below. */
export function paginateBoardColumn(tasks, visibleCount = BOARD_COLUMN_PAGE_SIZE) {
    const ordered = boardColumnOrder(tasks);
    const limit = Math.max(0, visibleCount);
    return {
        visible: ordered.slice(0, limit),
        remaining: Math.max(0, ordered.length - limit),
    };
}
const BOARD_ORDER_STEP = 1000;
/** `sortOrder` that lands a card directly above `target`, or at the column end when dropped on
 *  empty space. Midpoints keep neighbouring cards untouched, so one drop is one write. */
export function boardDropSortOrder(column, draggedId, target) {
    const ordered = boardColumnOrder(column).filter(task => task.id !== draggedId);
    if (target === undefined) {
        const last = ordered[ordered.length - 1];
        return last === undefined ? undefined : last.sortOrder - BOARD_ORDER_STEP;
    }
    const at = ordered.findIndex(task => task.id === target.id);
    if (at < 0)
        return undefined;
    const below = ordered[at];
    const above = ordered[at - 1];
    return above === undefined ? below.sortOrder + BOARD_ORDER_STEP : (above.sortOrder + below.sortOrder) / 2;
}
/** Human quick-add from the web form: land in Backlog so drafts are not claimed. */
export function humanQuickCreateRequest(projectId, title) {
    return { projectId, title: title.trim(), creator: 'human:web-client', status: 'backlog' };
}
/** Content types the page can render inline; everything else is download-only. */
export function isPreviewableAttachment(contentType) {
    return /^image\/(gif|jpeg|png|webp)$/i.test(contentType.trim());
}
/** Empty descriptions open Write; saved Markdown opens Preview. */
export function descriptionComposerMode(description) {
    return description.trim() === '' ? 'write' : 'preview';
}
/** Accept a create mutation result only when it carries a task id. */
export function createdTaskId(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const id = value.id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
}
/** Fill empty automation model fields from Host defaults without overwriting an explicit rule. */
export function applyAutomationDefaults(config, defaults) {
    return {
        ...config,
        ...(config.modelRoute === undefined && defaults?.modelRoute !== undefined ? { modelRoute: defaults.modelRoute } : {}),
        ...(config.reasoning === undefined && defaults?.reasoning !== undefined ? { reasoning: defaults.reasoning } : {}),
    };
}
/** Classify bounded-snapshot revisions after events, reconnects, or a Host restart. */
export function classifyRevisionChange(previous, next) {
    if (previous === undefined)
        return 'initial';
    if (next === previous)
        return 'same';
    if (next < previous)
        return 'reset';
    return next === previous + 1 ? 'next' : 'gap';
}
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const STATUS_RANK = new Map(TASK_STATUSES.map((status, index) => [status, index]));
/** Rank one task for the list view. Priority and status are enums with a meaningful order, so
 *  comparing their raw strings put "high" before "low" before "urgent" -- alphabetical noise. */
function sortValue(task, key) {
    if (key === 'priority')
        return PRIORITY_RANK[task.priority] ?? Number.MAX_SAFE_INTEGER;
    if (key === 'status')
        return STATUS_RANK.get(task.status) ?? Number.MAX_SAFE_INTEGER;
    // Undated tasks sort last in both directions rather than leading the ascending page.
    if (key === 'dueDate')
        return task.dueDate ?? '\uffff';
    return key === 'title' ? task.title : task.identifier;
}
/** Order the list view by one column, in the requested direction. */
export function sortTaskList(tasks, key, direction = 'asc') {
    const sign = direction === 'asc' ? 1 : -1;
    return [...tasks].sort((left, right) => {
        const a = sortValue(left, key);
        const b = sortValue(right, key);
        if (typeof a === 'number' && typeof b === 'number') {
            if (a !== b)
                return (a - b) * sign;
        }
        else if (a !== b) {
            return String(a).localeCompare(String(b), undefined, { numeric: true }) * sign;
        }
        // Stable, direction-independent tiebreak so equal rows never shuffle between renders.
        return left.identifier.localeCompare(right.identifier, undefined, { numeric: true });
    });
}
/** Map a board drop onto reorder-within-column or a human status move.
 *
 *  `column` is every task already in the destination column, so a drop on empty space can
 *  append to the end instead of being discarded. */
export function boardDropIntent(dragged, targetStatus, column = [], target) {
    if (dragged === undefined || dragged.archivedAt !== undefined)
        return { kind: 'none' };
    if (target !== undefined && dragged.id === target.id)
        return { kind: 'none' };
    const sortOrder = boardDropSortOrder(column, dragged.id, target);
    if (dragged.status === targetStatus) {
        if (sortOrder === undefined)
            return { kind: 'none' };
        return { kind: 'reorder', taskId: dragged.id, expectedVersion: dragged.version, sortOrder };
    }
    return {
        kind: 'move',
        taskId: dragged.id,
        expectedVersion: dragged.version,
        status: targetStatus,
        ...(sortOrder === undefined ? {} : { sortOrder }),
    };
}
/** Labels present on the project catalog or any task, in first-seen order. */
export function projectLabelCatalog(projectLabels, tasks) {
    const seen = new Set();
    const catalog = [];
    for (const label of [...projectLabels, ...tasks.flatMap(task => task.labels)]) {
        const name = label.trim();
        if (name === '' || seen.has(name))
            continue;
        seen.add(name);
        catalog.push(name);
    }
    return catalog;
}
/** Tasks that carry `label`, or unlabeled tasks when `label` is undefined. */
export function tasksForLabel(tasks, label) {
    return tasks.filter(task => label === undefined ? task.labels.length === 0 : task.labels.includes(label));
}
const VIEWS = new Set(['dashboard', 'board', 'list', 'labels', 'gantt', 'workflows']);
const RECENT_PROJECT_KEY = 'dsh-taskboard.recent-project';
/** Restore only an open project-less route; explicit deep links always win. */
export function restoreRecentProject(route, recent) {
    return !route.open || route.projectId !== undefined || recent === null || recent === '' ? route : { ...route, projectId: recent };
}
/** Render the unsent native-conversation draft created only on explicit user request. */
export function renderTaskSessionDraft(detail) {
    const { task } = detail;
    const comments = detail.comments.length === 0
        ? '- None'
        : detail.comments.map(item => `- ${item.authorId}: ${item.body}`).join('\n');
    const relations = detail.relations.length === 0
        ? '- None'
        : detail.relations.map(item => {
            const direction = item.sourceTaskId === task.id ? 'outgoing' : 'incoming';
            const other = item.sourceTaskId === task.id ? item.targetTaskId : item.sourceTaskId;
            return `- ${item.kind} (${direction}): ${other}`;
        }).join('\n');
    const attachments = detail.attachments.length === 0
        ? '- None'
        : detail.attachments.map(item => `- ${item.id}: ${item.filename} (${item.contentType}, ${item.byteSize} bytes)`).join('\n');
    const development = task.developmentContext === undefined
        ? 'Project workspace'
        : task.developmentContext.kind === 'branch'
            ? `Branch ${task.developmentContext.branch}`
            : `Worktree ${task.developmentContext.path}, branch ${task.developmentContext.branch}`;
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
    ].join('\n');
}
/** Decode one refresh-safe Taskboard hash without consulting browser state. */
export function decodeTaskboardHash(hash) {
    if (!hash.startsWith('#taskboard'))
        return { open: false, view: 'board' };
    const [, projectId, rawView, taskId] = hash.slice(1).split('/');
    const view = VIEWS.has(rawView) ? rawView : 'board';
    return {
        open: true,
        ...(projectId === undefined || projectId === '-' ? {} : { projectId: decodeURIComponent(projectId) }),
        view,
        ...(taskId === undefined ? {} : { taskId: decodeURIComponent(taskId) }),
    };
}
function parseRoute() {
    const route = decodeTaskboardHash(typeof location === 'undefined' ? '' : location.hash);
    if (!route.open || route.projectId !== undefined || typeof localStorage === 'undefined')
        return route;
    try {
        return restoreRecentProject(route, localStorage.getItem(RECENT_PROJECT_KEY));
    }
    catch {
        return route;
    }
}
/** Encode one open page route for deep-link and refresh restoration. */
export function encodeTaskboardRoute(route) {
    const project = encodeURIComponent(route.projectId ?? '-');
    const task = route.taskId === undefined ? '' : `/${encodeURIComponent(route.taskId)}`;
    return `#taskboard/${project}/${route.view}${task}`;
}
function watcherId() {
    const random = globalThis.crypto;
    return random?.randomUUID?.() ?? `watcher-${String(Math.trunc(Math.random() * 1e12))}`;
}
/** Bind an observable so `useSyncExternalStore` can take the methods without losing `this`. */
export function observeSnapshot(source) {
    return {
        subscribe: listener => source.subscribe(listener),
        getSnapshot: () => source.getSnapshot(),
    };
}
/** Browser-local page state and route codec; business state always comes from the Host. */
export class TaskboardClientController {
    connection;
    remote;
    selectSession;
    createTaskSession;
    route = parseRoute();
    listeners = new Set();
    globalRevision;
    /** Identifies this page's long-poll loop so the Host can release a waiter this page abandoned:
     *  an abort is local and never reaches the Host, so the old waiter held its slot until timeout. */
    watcherId = watcherId();
    constructor(connection, remote, selectSession, createTaskSession) {
        this.connection = connection;
        this.remote = remote;
        this.selectSession = selectSession;
        this.createTaskSession = createTaskSession;
        if (typeof window !== 'undefined')
            window.addEventListener('hashchange', this.onRoute);
    }
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    getSnapshot = () => this.route;
    open() {
        this.navigate({ ...this.route, open: true });
    }
    close() {
        if (typeof history !== 'undefined')
            history.pushState(null, '', `${location.pathname}${location.search}`);
        this.route = { open: false, view: this.route.view, ...(this.route.projectId === undefined ? {} : { projectId: this.route.projectId }) };
        this.publish();
    }
    select(projectId, view = this.route.view, taskId) {
        if (typeof localStorage !== 'undefined') {
            try {
                if (projectId === undefined)
                    localStorage.removeItem(RECENT_PROJECT_KEY);
                else
                    localStorage.setItem(RECENT_PROJECT_KEY, projectId);
            }
            catch { /* route state remains authoritative when storage is unavailable */ }
        }
        this.navigate({ open: true, view, ...(projectId === undefined ? {} : { projectId }), ...(taskId === undefined ? {} : { taskId }) });
    }
    async snapshot(projectId, signal) {
        signal?.throwIfAborted();
        const result = await this.remote.snapshot(projectId);
        if (!result.ok)
            throw new Error(result.error.message);
        return JSON.parse(result.value);
    }
    async detail(taskId, signal) {
        signal?.throwIfAborted();
        const result = await this.remote.taskDetail(taskId);
        if (!result.ok)
            throw new Error(result.error.message);
        return JSON.parse(result.value);
    }
    subscribeConnection(listener) {
        return this.connection.generation.subscribe(listener);
    }
    recordSnapshotRevision(revision) {
        const change = classifyRevisionChange(this.globalRevision, revision);
        this.globalRevision = revision;
        return change;
    }
    async openSession(sessionId) {
        if (this.selectSession === undefined)
            throw new Error('native Session navigation is unavailable');
        await this.selectSession(sessionId);
        this.close();
    }
    async openNewSession(workspaceId, detail) {
        if (this.createTaskSession === undefined)
            throw new Error('native Session creation is unavailable');
        const sessionId = await this.createTaskSession(workspaceId, renderTaskSessionDraft(detail));
        await this.mutate('task.bind-session', {
            taskId: detail.task.id,
            expectedVersion: detail.task.version,
            sessionId,
            agentId: sessionId,
        });
        this.close();
        return sessionId;
    }
    async mutate(endpoint, payload, signal) {
        signal?.throwIfAborted();
        const result = await this.connection.rpc.call('/taskboard', endpoint, payload, signal);
        if (!result.ok)
            throw new Error(`${result.error.code}: ${result.error.message}`);
        return result.value;
    }
    /** Search the whole project in SQLite. The board can only filter the tasks a snapshot carried. */
    async searchTasks(projectId, search, signal) {
        return await this.mutate('task.search', { projectId, search }, signal);
    }
    async watchChanges(afterRevision, signal) {
        signal?.throwIfAborted();
        const carried = await this.remote.mutate({
            endpoint: 'changes.watch',
            payloadJson: JSON.stringify({ afterRevision, timeoutMs: 10_000, watcherId: this.watcherId }),
        });
        signal?.throwIfAborted();
        if (!carried.ok)
            throw new Error(carried.error.message);
        if (!carried.value.ok) {
            throw new Error(`${carried.value.errorCode ?? 'taskboard'}: ${carried.value.errorMessage ?? 'change watch failed'}`);
        }
        return JSON.parse(carried.value.valueJson ?? 'null');
    }
    async uploadAttachment(taskId, expectedVersion, file, commentId, signal) {
        const ticket = await this.mutate('attachment.upload-ticket', {
            taskId, expectedVersion, filename: file.name, contentType: file.type || 'application/octet-stream',
            ...(commentId === undefined ? {} : { commentId }),
        }, signal);
        const response = await fetch(ticket.url, { method: ticket.method, body: file, ...(signal === undefined ? {} : { signal }), headers: { 'content-type': 'application/octet-stream' } });
        if (!response.ok)
            throw new Error(`attachment upload failed (${response.status}): ${await response.text()}`);
    }
    async downloadAttachment(attachmentId, filename) {
        const ticket = await this.mutate('attachment.download-ticket', { attachmentId, disposition: 'attachment' });
        const anchor = document.createElement('a');
        anchor.href = ticket.url;
        anchor.download = filename;
        anchor.rel = 'noopener';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
    }
    /** One-time inline URL for previewing an attachment in place; the ticket expires after one GET. */
    async previewAttachmentUrl(attachmentId) {
        const ticket = await this.mutate('attachment.download-ticket', { attachmentId, disposition: 'inline' });
        return ticket.url;
    }
    dispose() {
        if (typeof window !== 'undefined')
            window.removeEventListener('hashchange', this.onRoute);
        this.listeners.clear();
    }
    onRoute = () => {
        this.route = parseRoute();
        this.publish();
    };
    navigate(route) {
        const hash = encodeTaskboardRoute(route);
        // Re-selecting the same view used to push a duplicate entry, so Back had to be pressed once
        // per click to leave the page.
        if (typeof history !== 'undefined' && hash !== location.hash)
            history.pushState(null, '', hash);
        this.route = route;
        this.publish();
    }
    publish() {
        for (const listener of [...this.listeners])
            listener();
    }
}
//# sourceMappingURL=controller.js.map