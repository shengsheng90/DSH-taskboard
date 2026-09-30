import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TASK_STATUSES } from '../domain/index.js';
import { addWorkflowTab, copyWorkflowNode, insertWorkflowNode, moveWorkflowNode, removeWorkflowNode, removeWorkflowTab, } from '../workflow/index.js';
import { applyAutomationDefaults, BOARD_COLUMN_PAGE_SIZE, boardDropIntent, createdTaskId, descriptionComposerMode, humanQuickCreateRequest, isPreviewableAttachment, observeSnapshot, paginateBoardColumn, previewAutomationRuns, projectLabelCatalog, sortTaskList, TaskboardClientController, tasksForLabel } from './controller.js';
import { PopoverShell, useExclusivePopover } from './popover.js';
import { applyMarkdownEdit, parseMarkdown } from './markdown.js';
import { bindTaskboardLocale, currentTaskboardLanguage, formatAutomationLog, formatOpenedAt, interpolate, priorityLabel, subscribeTaskboardLocale, TASKBOARD_LOCALE_NS, taskboardLocales, taskboardStrings, } from './locales.js';
import taskboardRemote from '../../generated/typert.remote-client.js';
export { bindTaskboardLocale, taskboardStrings } from './locales.js';
export const inject = ['slots', 'connection', 'sessions', 'workspaces', 'uiWorkspace', 'conversation', 'remote', 'locale'];
/** A disposed automation Agent becomes a persisted cold Session. Refresh the native list before
 *  selecting it: sessions.open intentionally rejects ids absent from the current list snapshot. */
export async function openTaskSession(navigator, sessionId) {
    if (navigator.list.getSnapshot().byId[sessionId] === undefined)
        await navigator.refresh();
    if (navigator.list.getSnapshot().byId[sessionId] === undefined) {
        throw new Error(`Session ${sessionId} is unavailable`);
    }
    navigator.open(sessionId);
}
function useStrings() {
    return taskboardStrings(useSyncExternalStore(subscribeTaskboardLocale, currentTaskboardLanguage, currentTaskboardLanguage));
}
/** Kanban glyph in the DSH filled-outline family (same optical weight as the settings gear). */
function TaskboardIcon({ size }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", children: [_jsx("path", { fillRule: "evenodd", clipRule: "evenodd", d: "M3.2 1.05H12.8A2.15 2.15 0 0 1 14.95 3.2V12.8A2.15 2.15 0 0 1 12.8 14.95H3.2A2.15 2.15 0 0 1 1.05 12.8V3.2A2.15 2.15 0 0 1 3.2 1.05ZM3.2 2.37H12.8A0.83 0.83 0 0 1 13.63 3.2V12.8A0.83 0.83 0 0 1 12.8 13.63H3.2A0.83 0.83 0 0 1 2.37 12.8V3.2A0.83 0.83 0 0 1 3.2 2.37Z", fill: "currentColor" }), _jsx("path", { d: "M4.56 3.52A0.64 0.64 0 0 1 5.2 4.16V11.84A0.64 0.64 0 0 1 4.56 12.48 0.64 0.64 0 0 1 3.92 11.84V4.16A0.64 0.64 0 0 1 4.56 3.52Z", fill: "currentColor" }), _jsx("path", { d: "M8 3.52A0.64 0.64 0 0 1 8.64 4.16V7.18A0.64 0.64 0 0 1 8 7.82 0.64 0.64 0 0 1 7.36 7.18V4.16A0.64 0.64 0 0 1 8 3.52Z", fill: "currentColor" }), _jsx("path", { d: "M11.44 3.52A0.64 0.64 0 0 1 12.08 4.16V9.33A0.64 0.64 0 0 1 11.44 9.97 0.64 0.64 0 0 1 10.8 9.33V4.16A0.64 0.64 0 0 1 11.44 3.52Z", fill: "currentColor" })] }));
}
/** Filled floppy-disk glyph so the primary Save action stays recognizable at small sizes. */
function SaveIcon({ size }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "currentColor", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", children: _jsx("path", { d: "M2.2 2.35c0-.58.47-1.05 1.05-1.05h7.15L14 3.9v9.75c0 .58-.47 1.05-1.05 1.05H3.25c-.58 0-1.05-.47-1.05-1.05V2.35Zm2.2.7v3.45h6.05V3.05H4.4Zm1.2.9h1.35v1.7H5.6V3.95ZM3.7 9.2v3.55h8.6V9.2H3.7Z" }) }));
}
/** 14px stroke X matching the Harness settings/modal close glyph. */
function CloseIcon({ size }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", children: _jsx("path", { d: "M4 4l8 8M12 4l-8 8", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }) }));
}
/** Downward chevron used as the board-column lazy-load affordance. */
function MoreIcon({ size }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", children: _jsx("path", { d: "M3.2 6.2L8 11l4.8-4.8", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function actorName(value) {
    return value.split(/[:/]/).pop() || value;
}
function actorInitial(value) {
    return (actorName(value).trim().slice(0, 1) || '?').toUpperCase();
}
function isClosedStatus(status) {
    return status === 'done' || status === 'canceled';
}
/** Backoff before the change poll is retried, and the idle delay before a truncated project's
 *  search reaches SQLite. */
const WATCH_RETRY_MS = 2_000;
const SEARCH_DEBOUNCE_MS = 250;
function pause(ms, signal) {
    return new Promise(resolve => {
        const timer = window.setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
        function onAbort() { window.clearTimeout(timer); resolve(); }
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
const MARKDOWN_TOOLBAR = [
    { action: 'heading', label: 'mdHeading', glyph: 'H' },
    { action: 'bold', label: 'mdBold', glyph: 'B' },
    { action: 'italic', label: 'mdItalic', glyph: 'I' },
    { action: 'quote', label: 'mdQuote', glyph: '“' },
    { action: 'code', label: 'mdCode', glyph: '</>' },
    { action: 'link', label: 'mdLink', glyph: '[]' },
    { action: 'ul', label: 'mdBullet', glyph: '•' },
    { action: 'ol', label: 'mdNumber', glyph: '1.' },
];
function ComposerTabs({ mode, onChange }) {
    const t = useStrings();
    return (_jsxs("div", { className: "dsh-taskboard-composer-tabs", children: [_jsx("button", { type: "button", "aria-current": mode === 'write' ? 'page' : undefined, onClick: () => { onChange('write'); }, children: t.write }), _jsx("button", { type: "button", "aria-current": mode === 'preview' ? 'page' : undefined, onClick: () => { onChange('preview'); }, children: t.preview })] }));
}
function MarkdownComposer({ value, onChange, mode, onModeChange, placeholder, emptyPreview, }) {
    const t = useStrings();
    const textareaRef = useRef(null);
    const run = (action) => {
        const field = textareaRef.current;
        const next = applyMarkdownEdit(value, field?.selectionStart ?? value.length, field?.selectionEnd ?? value.length, action);
        onChange(next.value);
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(next.selectionStart, next.selectionEnd);
        });
    };
    const onKeyDown = (event) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey)
            return;
        const key = event.key.toLowerCase();
        const action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : key === 'e' ? 'code' : undefined;
        if (action === undefined)
            return;
        event.preventDefault();
        run(action);
    };
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "dsh-taskboard-composer-bar", children: [_jsx(ComposerTabs, { mode: mode, onChange: onModeChange }), mode === 'write' && (_jsx("div", { className: "dsh-taskboard-md-tools", role: "toolbar", "aria-label": t.markdownToolbar, children: MARKDOWN_TOOLBAR.map(item => (_jsx("button", { type: "button", title: t[item.label], "aria-label": t[item.label], onClick: () => { run(item.action); }, children: item.glyph }, item.action))) }))] }), mode === 'write'
                ? _jsx("textarea", { ref: textareaRef, value: value, placeholder: placeholder, onChange: event => { onChange(event.target.value); }, onKeyDown: onKeyDown })
                : _jsx("div", { className: "dsh-taskboard-composer-preview", children: value.trim() === '' ? emptyPreview : _jsx(MarkdownText, { value: value }) })] }));
}
/** Attachment row with an inline preview for image types; other types stay download-only. */
function AttachmentRow({ attachment, download, preview, remove, showMeta = false }) {
    const t = useStrings();
    const [url, setUrl] = useState();
    const previewable = isPreviewableAttachment(attachment.contentType);
    return (_jsxs("article", { className: "dsh-taskboard-attachment-row", children: [_jsxs("div", { children: [_jsx("button", { type: "button", className: "dsh-taskboard-link", onClick: () => { void download(attachment.id, attachment.filename); }, children: attachment.filename }), showMeta && _jsxs("small", { children: [attachment.contentType, " \u00B7 ", attachment.byteSize, " ", t.bytes] }), previewable && _jsx("button", { type: "button", className: "dsh-taskboard-link", "aria-expanded": url !== undefined, onClick: () => {
                            if (url !== undefined) {
                                setUrl(undefined);
                                return;
                            }
                            // Each ticket is single-use, so a fresh one is minted every time the preview reopens.
                            void preview(attachment.id).then(setUrl);
                        }, children: url === undefined ? t.showPreview : t.hidePreview }), _jsx("button", { type: "button", onClick: remove, children: t.delete })] }), url !== undefined && _jsx("img", { src: url, alt: attachment.filename })] }));
}
function MetaField({ label, children, nested = false }) {
    return (_jsxs("div", { className: nested ? 'dsh-taskboard-meta-field dsh-taskboard-meta-nested' : 'dsh-taskboard-meta-field', children: [_jsx("span", { children: label }), _jsx("div", { children: children })] }));
}
/** Sidebar foot styles must live on the nav itself: the page style tag unmounts when the overlay is closed.
 *  Wide geometry matches Host Settings: 34px row, full column width, 12px radius, icon+label left-aligned.
 *  Pressed/hover fill is the only selected chrome; do not restore native button padding or grey inset. */
const NAV_STYLES = `
.dsh-taskboard-nav{-webkit-appearance:none;appearance:none;flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:none;border-radius:12px;background:transparent;box-shadow:none;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;font:inherit;font-size:14px;line-height:22px;overflow:hidden}.dsh-taskboard-nav:hover,.dsh-taskboard-nav[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}.dsh-taskboard-nav-rail{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}.dsh-taskboard-nav-label{overflow:hidden;white-space:nowrap}
`;
export function TaskboardNavButton({ wide, controller }) {
    const route = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const t = useStrings();
    return (_jsxs(_Fragment, { children: [_jsx("style", { children: NAV_STYLES }), _jsxs("button", { type: "button", className: wide ? 'dsh-taskboard-nav' : 'dsh-taskboard-nav dsh-taskboard-nav-rail', "aria-pressed": route.open, "aria-label": t.taskboard, onClick: () => { route.open ? controller.close() : controller.open(); }, children: [_jsx(TaskboardIcon, { size: wide ? 16 : 18 }), wide && _jsx("span", { className: "dsh-taskboard-nav-label", children: t.taskboard })] })] }));
}
/** Resolve the sidebar/detail column widths so the page fills only the center column. */
function useFrameInsets(ref, active) {
    const [insets, setInsets] = useState({ left: 0, right: 0 });
    useEffect(() => {
        if (!active || ref.current === null)
            return;
        // DOM: page → [data-slot] anchor (display:contents) → shell.overlay layer → grid frame.
        const frame = ref.current.parentElement?.parentElement?.parentElement;
        if (frame === null || frame === undefined)
            return;
        const measure = () => {
            const tracks = getComputedStyle(frame).gridTemplateColumns.split(' ');
            const left = Number.parseFloat(tracks[0] ?? '0');
            const right = Number.parseFloat(tracks[tracks.length - 1] ?? '0');
            setInsets({
                left: Number.isFinite(left) ? left : 0,
                right: Number.isFinite(right) ? right : 0,
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(frame);
        return () => { observer.disconnect(); };
    }, [active, ref]);
    return insets;
}
export function TaskboardPage({ controller, workspaces }) {
    const route = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const workspaceList = useMemo(() => observeSnapshot(workspaces.list), [workspaces]);
    const workspaceState = useSyncExternalStore(workspaceList.subscribe, workspaceList.getSnapshot, workspaceList.getSnapshot);
    const root = useRef(null);
    const insets = useFrameInsets(root, route.open);
    const [snapshot, setSnapshot] = useState();
    const [detail, setDetail] = useState();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState();
    const [refreshKey, setRefreshKey] = useState(0);
    const [query, setQuery] = useState('');
    /** Matches from SQLite for a project whose snapshot was truncated; the in-memory filter below
     *  can only ever see the rows the snapshot carried. */
    const [searchHits, setSearchHits] = useState([]);
    const [statusFilter, setStatusFilter] = useState('all');
    const [logOpen, setLogOpen] = useState(false);
    const [undo, setUndo] = useState();
    /** Newest globalRevision already rendered; the change poll uses it to skip redundant refetches. */
    const loadedRevision = useRef(0);
    /** Serializes writes so a double-click cannot duplicate a task or race the expected version. */
    const inFlight = useRef(false);
    /** Set by the open task dialog; title/description/meta edits live in local state until Save. */
    const detailDirty = useRef(false);
    const [discardPrompt, setDiscardPrompt] = useState(false);
    const t = useStrings();
    // route.view is deliberately absent: every view renders the same snapshot, so switching tabs
    // must not refetch it.
    useEffect(() => {
        if (!route.open)
            return;
        const abort = new AbortController();
        setBusy(true);
        controller.snapshot(route.projectId, abort.signal).then(next => {
            controller.recordSnapshotRevision(next.globalRevision);
            loadedRevision.current = next.globalRevision;
            setSnapshot(next);
            setError(undefined);
            if (route.projectId === undefined && next.projects[0] !== undefined)
                controller.select(next.projects[0].id, route.view);
        }).catch((cause) => {
            if (!abort.signal.aborted)
                setError(cause instanceof Error ? cause.message : String(cause));
        }).finally(() => { if (!abort.signal.aborted)
            setBusy(false); });
        return () => { abort.abort(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controller, refreshKey, route.open, route.projectId]);
    useEffect(() => {
        if (!route.open || route.taskId === undefined) {
            setDetail(undefined);
            return;
        }
        const abort = new AbortController();
        controller.detail(route.taskId, abort.signal).then(value => {
            if (!abort.signal.aborted)
                setDetail(value);
        }).catch((cause) => {
            if (!abort.signal.aborted)
                setError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => { abort.abort(); };
    }, [controller, refreshKey, route.open, route.taskId]);
    useEffect(() => {
        if (!route.open)
            return;
        return controller.subscribeConnection(() => { setRefreshKey(value => value + 1); });
    }, [controller, route.open]);
    useEffect(() => {
        if (!route.open || snapshot === undefined)
            return;
        const timer = window.setInterval(() => { setRefreshKey(value => value + 1); }, snapshot.refreshIntervalMs);
        return () => { window.clearInterval(timer); };
    }, [route.open, snapshot?.refreshIntervalMs]);
    useEffect(() => {
        if (!route.open || snapshot === undefined)
            return;
        const abort = new AbortController();
        const watch = async () => {
            let revision = snapshot.globalRevision;
            while (!abort.signal.aborted) {
                let result;
                try {
                    result = await controller.watchChanges(revision, abort.signal);
                }
                catch (cause) {
                    if (abort.signal.aborted)
                        return;
                    setError(cause instanceof Error ? cause.message : String(cause));
                    // Leaving the loop here left the page on the 15s periodic refetch until the revision
                    // happened to move, which is exactly when it could not move on its own.
                    await pause(WATCH_RETRY_MS, abort.signal);
                    continue;
                }
                if (abort.signal.aborted)
                    return;
                if (result.changed || result.globalRevision !== revision) {
                    // A local mutation already refreshes on its own. Without this guard its committed
                    // revision wakes the poll too and the same snapshot is fetched a second time.
                    if (result.globalRevision > loadedRevision.current)
                        setRefreshKey(value => value + 1);
                    return;
                }
                revision = result.globalRevision;
            }
        };
        void watch();
        return () => { abort.abort(); };
    }, [controller, route.open, snapshot?.globalRevision]);
    // Only a truncated project needs SQLite: otherwise the snapshot already holds every task the
    // in-memory filter below could match.
    useEffect(() => {
        const needle = query.trim();
        const projectId = route.projectId;
        if (!route.open || snapshot?.tasksTruncated !== true || needle === '' || projectId === undefined) {
            setSearchHits([]);
            return;
        }
        const abort = new AbortController();
        const timer = window.setTimeout(() => {
            controller.searchTasks(projectId, needle, abort.signal).then(hits => {
                if (!abort.signal.aborted)
                    setSearchHits(hits);
            }, () => { });
        }, SEARCH_DEBOUNCE_MS);
        return () => { abort.abort(); window.clearTimeout(timer); };
    }, [controller, query, route.open, route.projectId, snapshot?.tasksTruncated, refreshKey]);
    useEffect(() => {
        if (!route.open)
            return;
        const onKey = (event) => {
            if (event.key !== 'Escape')
                return;
            if (discardPrompt) {
                event.preventDefault();
                setDiscardPrompt(false);
                return;
            }
            if (logOpen) {
                event.preventDefault();
                setLogOpen(false);
                return;
            }
            if (route.taskId !== undefined) {
                event.preventDefault();
                // Escape used to discard unsaved title/description edits without a word.
                if (detailDirty.current)
                    setDiscardPrompt(true);
                else
                    controller.select(route.projectId, route.view);
                return;
            }
            controller.close();
        };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); };
    }, [controller, discardPrompt, logOpen, route.open, route.projectId, route.taskId, route.view]);
    if (!route.open)
        return null;
    const selected = snapshot?.projects.find(project => project.id === route.projectId) ?? snapshot?.projects[0];
    const tasks = snapshot?.tasks ?? [];
    const searchable = searchHits.length === 0
        ? tasks
        : [...tasks, ...searchHits.filter(hit => !tasks.some(task => task.id === hit.id))];
    const visibleTasks = searchable.filter(task => {
        if (statusFilter !== 'all' && task.status !== statusFilter)
            return false;
        const needle = query.trim().toLocaleLowerCase();
        return needle === ''
            || `${task.identifier} ${task.title} ${task.description} ${task.labels.join(' ')}`.toLocaleLowerCase().includes(needle);
    });
    // A deep link can name a task the snapshot never carried. The detail fetch is keyed on
    // route.taskId alone, so open the dialog on whichever of the two resolved it.
    const selectedTask = tasks.find(task => task.id === route.taskId)
        ?? (detail !== undefined && detail.task.id === route.taskId ? detail.task : undefined);
    const refresh = () => { setRefreshKey(value => value + 1); };
    const closeDetail = () => {
        detailDirty.current = false;
        setDiscardPrompt(false);
        controller.select(selected?.id, route.view);
    };
    /** Every path that closes the task dialog goes through here so unsaved edits are never dropped. */
    const requestCloseDetail = () => {
        if (detailDirty.current)
            setDiscardPrompt(true);
        else
            closeDetail();
    };
    const mutate = async (endpoint, payload) => {
        // One in-flight write at a time. Without this a double-click either creates a duplicate task
        // (task.create carries no expected version) or fails the second attempt on a stale version.
        if (inFlight.current)
            return undefined;
        inFlight.current = true;
        setBusy(true);
        try {
            const prior = endpoint === 'task.update' && typeof payload['taskId'] === 'string'
                ? tasks.find(task => task.id === payload['taskId'])
                : undefined;
            const request = payload['request'];
            const value = await controller.mutate(endpoint, payload);
            if (prior !== undefined && request !== undefined && typeof value === 'object' && value !== null && 'version' in value) {
                const inverse = {};
                for (const key of Object.keys(request))
                    inverse[key] = prior[key] ?? null;
                setUndo({ endpoint: 'task.update', payload: { taskId: prior.id, expectedVersion: Number(value.version), request: inverse } });
            }
            else if ((endpoint === 'task.archive' || endpoint === 'task.restore') && typeof value === 'object' && value !== null && 'version' in value && typeof payload['taskId'] === 'string') {
                setUndo({
                    endpoint: endpoint === 'task.archive' ? 'task.restore' : 'task.archive',
                    payload: { taskId: payload['taskId'], expectedVersion: Number(value.version) },
                });
            }
            if (endpoint === 'task.create' && createdTaskId(value) !== undefined) {
                const created = value;
                setSnapshot(prev => {
                    if (prev === undefined || prev.tasks.some(task => task.id === created.id))
                        return prev;
                    return { ...prev, tasks: [created, ...prev.tasks] };
                });
            }
            setError(undefined);
            refresh();
            return value;
        }
        catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            setError(message);
            if (message.includes('TASK_STALE_VERSION'))
                refresh();
            return undefined;
        }
        finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    const performUndo = async () => {
        if (undo === undefined || inFlight.current)
            return;
        inFlight.current = true;
        setBusy(true);
        try {
            // Re-read the version at click time: any write since the undo was recorded moved it on, and
            // replaying the captured one only produced a stale-version error.
            const current = tasks.find(task => task.id === undo.payload['taskId']);
            const payload = current === undefined ? undo.payload : { ...undo.payload, expectedVersion: current.version };
            await controller.mutate(undo.endpoint, payload);
            setUndo(undefined);
            setError(undefined);
            refresh();
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    return (_jsxs("div", { ref: root, className: "dsh-taskboard-page", style: { left: insets.left, right: insets.right }, role: "main", "aria-label": t.taskboard, children: [_jsx("style", { children: STYLES }), _jsxs("header", { className: "dsh-taskboard-header", children: [_jsxs("div", { className: "dsh-taskboard-brand", children: [_jsx(TaskboardIcon, { size: 16 }), _jsx("strong", { children: t.taskboard })] }), _jsx("select", { "aria-label": t.project, value: selected?.id ?? '', onChange: event => { controller.select(event.target.value || undefined, route.view); }, children: snapshot?.projects.map(project => _jsxs("option", { value: project.id, children: [project.key, " \u00B7 ", project.name] }, project.id)) }), _jsx(ProjectCreate, { controller: controller, refresh: refresh, workspaces: workspaceState.items }), selected !== undefined && _jsx(ProjectActions, { project: selected, controller: controller, refresh: refresh, workspaces: workspaceState.items }), _jsx("button", { type: "button", onClick: refresh, children: t.refresh }), selected !== undefined && _jsx(AutomationActions, { project: selected, automations: snapshot?.automations ?? [], defaults: snapshot?.automationDefaults, mutate: mutate }), _jsx("button", { type: "button", className: "dsh-taskboard-icon-close", "aria-label": t.close, onClick: () => { controller.close(); }, children: _jsx(CloseIcon, { size: 14 }) })] }), _jsxs("div", { className: "dsh-taskboard-filters", children: [_jsx("input", { "aria-label": t.search, placeholder: t.search, value: query, onChange: event => { setQuery(event.target.value); } }), _jsxs("select", { "aria-label": t.allStatuses, value: statusFilter, onChange: event => { setStatusFilter(event.target.value); }, children: [_jsx("option", { value: "all", children: t.allStatuses }), ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'].map(status => _jsx("option", { value: status, children: t[status] }, status))] }), _jsx("button", { type: "button", disabled: undo === undefined || busy, onClick: () => { void performUndo(); }, children: t.undo })] }), _jsx("nav", { className: "dsh-taskboard-tabs", "aria-label": t.taskboard, children: ['dashboard', 'board', 'list', 'labels', 'gantt', 'workflows'].map(view => (_jsx("button", { type: "button", "aria-current": route.view === view ? 'page' : undefined, onClick: () => { controller.select(selected?.id, view); }, children: t[view] }, view))) }), error !== undefined && _jsxs("div", { className: "dsh-taskboard-error", role: "alert", children: [_jsx("span", { children: error }), _jsx("button", { type: "button", "aria-label": t.dismiss, onClick: () => { setError(undefined); }, children: _jsx(CloseIcon, { size: 12 }) })] }), snapshot?.tasksTruncated === true && _jsx("div", { className: "dsh-taskboard-notice", role: "status", children: interpolate(t.tasksTruncated, { shown: snapshot.tasks.length, total: snapshot.taskTotal }) }), busy && snapshot === undefined
                ? _jsx("div", { className: "dsh-taskboard-loading", children: t.loading })
                : _jsx("div", { className: "dsh-taskboard-content", children: _jsx("main", { className: "dsh-taskboard-view", children: selected === undefined
                            ? _jsxs("div", { className: "dsh-taskboard-empty", children: [_jsx("p", { children: t.noProject }), _jsx(ProjectCreate, { controller: controller, refresh: refresh, workspaces: workspaceState.items })] })
                            : _jsxs(_Fragment, { children: [_jsx(TaskCreate, { project: selected, mutate: mutate, onCreated: taskId => { controller.select(selected.id, route.view, taskId); } }), route.view === 'dashboard' && _jsx(Dashboard, { tasks: visibleTasks, runs: snapshot?.automationRuns ?? [], project: selected, storage: snapshot?.storageHealth, open: task => { controller.select(selected?.id, route.view, task.id); }, openLog: () => { setLogOpen(true); }, mutate: mutate }), route.view === 'board' && _jsx(Board, { tasks: visibleTasks, open: task => { controller.select(selected?.id, route.view, task.id); }, mutate: mutate }, selected?.id ?? 'none'), route.view === 'list' && _jsx(ListView, { tasks: visibleTasks, open: task => { controller.select(selected?.id, route.view, task.id); } }), route.view === 'labels' && _jsx(LabelsView, { project: selected, tasks: visibleTasks, open: task => { controller.select(selected?.id, route.view, task.id); }, mutate: mutate }), route.view === 'gantt' && _jsx(Gantt, { tasks: visibleTasks, open: task => { controller.select(selected?.id, route.view, task.id); } }), route.view === 'workflows' && _jsx(WorkflowEditor, { project: selected, workflows: snapshot?.workflows ?? [], catalog: snapshot?.workflowCatalog ?? [], capabilities: snapshot?.workflowCapabilities, mutate: mutate })] }) }) }), logOpen && _jsx(AutomationLogDialog, { runs: snapshot?.automationRuns ?? [], tasks: tasks, close: () => { setLogOpen(false); } }), discardPrompt && _jsx("div", { className: "dsh-taskboard-dialog-backdrop", onClick: event => { if (event.target === event.currentTarget)
                    setDiscardPrompt(false); }, children: _jsxs("div", { className: "dsh-taskboard-discard-dialog", role: "alertdialog", "aria-modal": "true", "aria-label": t.unsavedChanges, children: [_jsx("h2", { children: t.unsavedChanges }), _jsx("p", { children: t.unsavedBody }), _jsxs("div", { children: [_jsx("button", { type: "button", autoFocus: true, onClick: () => { setDiscardPrompt(false); }, children: t.keepEditing }), _jsx("button", { type: "button", onClick: closeDetail, children: t.discardChanges })] })] }) }), selectedTask !== undefined && _jsx(TaskDetail, { project: selected, task: selectedTask, tasks: tasks, workflows: snapshot?.workflows ?? [], detail: detail, mutate: mutate, upload: async (file, commentId) => { setBusy(true); try {
                    await controller.uploadAttachment(selectedTask.id, detail?.task.version ?? selectedTask.version, file, commentId);
                    refresh();
                }
                catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
                finally {
                    setBusy(false);
                } }, download: (id, filename) => controller.downloadAttachment(id, filename), preview: id => controller.previewAttachmentUrl(id), openSession: async (sessionId) => { setBusy(true); try {
                    await controller.openSession(sessionId);
                }
                catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
                finally {
                    setBusy(false);
                } }, openNewSession: async () => { if (selected?.workspaceId === undefined || detail === undefined)
                    return; setBusy(true); try {
                    await controller.openNewSession(selected.workspaceId, detail);
                }
                catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
                finally {
                    setBusy(false);
                } }, close: requestCloseDetail, onDirtyChange: value => { detailDirty.current = value; } }, selectedTask.id)] }));
}
function ProjectCreate({ controller, refresh, workspaces }) {
    const t = useStrings();
    const popover = useExclusivePopover();
    const [name, setName] = useState('');
    const [key, setKey] = useState('');
    const [workspaceId, setWorkspaceId] = useState('');
    const [labels, setLabels] = useState('');
    const close = () => { popover.setOpen(false); };
    const create = async (event) => {
        event.preventDefault();
        if (name.trim() === '' || key.trim() === '')
            return;
        const project = await controller.mutate('project.create', {
            request: {
                key: key.trim(), name: name.trim(),
                ...(workspaceId.trim() === '' ? {} : { workspaceId: workspaceId.trim() }),
                labels: labels.split(',').map(value => value.trim()).filter(Boolean),
            },
        });
        close();
        setName('');
        setKey('');
        setWorkspaceId('');
        setLabels('');
        controller.select(project.id, 'board');
        refresh();
    };
    return (_jsx(PopoverShell, { open: popover.open, onToggle: popover.toggle, onDismiss: close, label: `＋ ${t.addProject}`, children: _jsxs("form", { onSubmit: event => { void create(event); }, children: [_jsxs("label", { children: [t.projectName, _jsx("input", { autoFocus: true, value: name, onChange: event => { const value = event.target.value; setName(value); if (key === '')
                                setKey(value.replaceAll(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()); } })] }), _jsxs("label", { children: [t.projectKey, _jsx("input", { value: key, onChange: event => { setKey(event.target.value.toUpperCase()); } })] }), _jsxs("label", { children: [t.workspaceId, _jsxs("select", { value: workspaceId, onChange: event => { setWorkspaceId(event.target.value); }, children: [_jsx("option", { value: "", children: t.blankGlobal }), workspaces.map(item => _jsxs("option", { value: item.workspaceId, children: [item.title, " \u00B7 ", item.path] }, item.workspaceId))] })] }), _jsxs("label", { children: [t.labels, _jsx("input", { value: labels, onChange: event => { setLabels(event.target.value); }, placeholder: "local, release" })] }), _jsxs("div", { children: [_jsx("button", { type: "submit", disabled: name.trim() === '' || key.trim() === '', children: t.create }), _jsx("button", { type: "button", onClick: close, children: t.cancel })] })] }) }));
}
function ProjectActions({ project, controller, refresh, workspaces }) {
    const t = useStrings();
    const editPopover = useExclusivePopover();
    const deletePopover = useExclusivePopover();
    const [name, setName] = useState(project.name);
    const [workspace, setWorkspace] = useState(project.workspaceId ?? '');
    const [labels, setLabels] = useState(project.labels.join(', '));
    useEffect(() => { setName(project.name); setWorkspace(project.workspaceId ?? ''); setLabels(project.labels.join(', ')); }, [project]);
    const edit = async (event) => {
        event.preventDefault();
        if (name.trim() === '')
            return;
        await controller.mutate('project.update', {
            projectId: project.id,
            expectedVersion: project.version,
            request: { name: name.trim(), workspaceId: workspace.trim() || null, labels: labels.split(',').map(value => value.trim()).filter(Boolean) },
        });
        editPopover.setOpen(false);
        refresh();
    };
    const remove = async () => {
        await controller.mutate('project.delete', { projectId: project.id, expectedVersion: project.version });
        deletePopover.setOpen(false);
        controller.select(undefined, 'dashboard');
        refresh();
    };
    return (_jsxs(_Fragment, { children: [_jsx(PopoverShell, { open: editPopover.open, onToggle: editPopover.toggle, onDismiss: () => { editPopover.setOpen(false); }, label: t.editProject, children: _jsxs("form", { onSubmit: event => { void edit(event); }, children: [_jsxs("label", { children: [t.projectName, _jsx("input", { autoFocus: true, value: name, onChange: event => { setName(event.target.value); } })] }), _jsxs("label", { children: [t.workspaceId, _jsxs("select", { value: workspace, onChange: event => { setWorkspace(event.target.value); }, children: [_jsx("option", { value: "", children: t.blankGlobal }), project.workspaceId !== undefined && !workspaces.some(item => item.workspaceId === project.workspaceId) && _jsx("option", { value: project.workspaceId, children: project.workspaceId }), workspaces.map(item => _jsxs("option", { value: item.workspaceId, children: [item.title, " \u00B7 ", item.path] }, item.workspaceId))] })] }), _jsxs("label", { children: [t.labels, _jsx("input", { value: labels, onChange: event => { setLabels(event.target.value); } })] }), _jsxs("div", { children: [_jsx("button", { type: "submit", children: t.save }), _jsx("button", { type: "button", onClick: () => { editPopover.setOpen(false); }, children: t.cancel })] })] }) }), _jsx(PopoverShell, { open: deletePopover.open, onToggle: deletePopover.toggle, onDismiss: () => { deletePopover.setOpen(false); }, label: t.deleteProject, children: _jsxs("div", { className: "dsh-taskboard-confirm", role: "alert", children: [_jsxs("span", { children: [t.deleteProject, ": ", project.key, " \u00B7 ", project.name, "?"] }), _jsx("button", { type: "button", onClick: () => { void remove(); }, children: t.deleteProject }), _jsx("button", { type: "button", onClick: () => { deletePopover.setOpen(false); }, children: t.cancel })] }) })] }));
}
function TaskCreate({ project, mutate, onCreated }) {
    const [title, setTitle] = useState('');
    const t = useStrings();
    const submit = (event) => {
        event.preventDefault();
        if (project === undefined || title.trim() === '')
            return;
        void mutate('task.create', { request: humanQuickCreateRequest(project.id, title) }).then(value => {
            const taskId = createdTaskId(value);
            if (taskId === undefined)
                return;
            setTitle('');
            onCreated(taskId);
        });
    };
    return _jsxs("form", { className: "dsh-taskboard-create", onSubmit: submit, children: [_jsx("input", { value: title, onChange: event => { setTitle(event.target.value); }, placeholder: t.newTask, "aria-label": t.title }), _jsx("button", { type: "submit", disabled: project === undefined, children: t.create })] });
}
/** The integrity scan reads every database page, so it is an explicit action, never part of a refresh. */
function StorageHealthPanel({ storage, mutate }) {
    const t = useStrings();
    const [checking, setChecking] = useState(false);
    return (_jsxs("section", { className: "dsh-taskboard-storage", "data-status": storage.status, children: [_jsxs("header", { children: [_jsx("h2", { children: t.storageHealth }), _jsxs("div", { className: "dsh-taskboard-storage-actions", children: [_jsx("strong", { children: storage.status === 'ok' ? t.healthy : t.degraded }), _jsx("button", { type: "button", disabled: checking, onClick: () => {
                                    setChecking(true);
                                    void mutate('storage.check-integrity', {}).finally(() => { setChecking(false); });
                                }, children: t.recheckIntegrity })] })] }), _jsxs("span", { children: ["SQLite: ", storage.integrity, " \u00B7 schema v", storage.schemaVersion, " \u00B7 revision ", storage.globalRevision] }), _jsxs("span", { children: [storage.taskCount, " ", t.tasksWord, " \u00B7 ", storage.attachmentCount, " ", t.attachments, " \u00B7 ", storage.attachmentBytes, " ", t.bytes] }), _jsxs("span", { children: [t.cleanupPending, ": ", storage.cleanupPending, " \u00B7 ", t.cleanupStalled, ": ", storage.cleanupStalled, " \u00B7 ", t.orphanedClaims, ": ", storage.orphanedClaims] }), _jsxs("span", { children: [t.lastChecked, ": ", storage.integrityCheckedAt === 0 ? t.never : new Date(storage.integrityCheckedAt).toLocaleString()] })] }));
}
function Dashboard({ tasks, runs, project, storage, open, openLog, mutate }) {
    const t = useStrings();
    const counts = useMemo(() => {
        const tally = {};
        for (const task of tasks)
            tally[task.status] = (tally[task.status] ?? 0) + 1;
        return tally;
    }, [tasks]);
    const dueTasks = useMemo(() => [...tasks]
        .filter(task => task.dueDate !== undefined && task.status !== 'done' && task.status !== 'canceled')
        .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)))
        .slice(0, 8), [tasks]);
    const recentTasks = useMemo(() => [...tasks]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 8), [tasks]);
    return _jsxs(_Fragment, { children: [_jsx("div", { className: "dsh-taskboard-dashboard", children: ['todo', 'in_progress', 'in_review', 'blocked'].map(status => _jsxs("div", { children: [_jsx("strong", { children: counts[status] ?? 0 }), _jsx("span", { children: t[status] })] }, status)) }), _jsxs("section", { className: "dsh-taskboard-summary", children: [_jsxs("h2", { children: [project?.key ?? '—', " \u00B7 ", project?.name ?? t.project] }), _jsx("span", { children: project?.workspaceId === undefined ? t.globalProject : `${t.workspace}: ${project.workspaceId}` }), _jsx("span", { children: project?.labels.length === 0 ? t.noProjectLabels : `${t.labels}: ${project?.labels.join(', ')}` }), _jsxs("span", { children: [tasks.length, " ", t.tasksWord, " \u00B7 ", counts['in_progress'] ?? 0, " ", t.activeWord, " \u00B7 ", counts['in_review'] ?? 0, " ", t.in_review] })] }), _jsxs("section", { className: "dsh-taskboard-due", children: [_jsx("h2", { children: t.recentTasks }), recentTasks.length === 0 ? _jsx("p", { children: t.empty }) : recentTasks.map(task => _jsxs("button", { type: "button", onClick: () => { open(task); }, children: [_jsxs("strong", { children: [task.identifier, " \u00B7 ", task.title] }), _jsx("span", { children: t[task.status] })] }, task.id))] }), _jsxs("section", { className: "dsh-taskboard-due", children: [_jsx("h2", { children: t.due }), dueTasks.length === 0 ? _jsx("p", { children: t.empty }) : dueTasks.map(task => _jsxs("button", { type: "button", onClick: () => { open(task); }, children: [_jsxs("strong", { children: [task.identifier, " \u00B7 ", task.title] }), _jsxs("span", { children: [task.dueDate, " \u00B7 ", t[task.status]] })] }, task.id))] }), storage !== undefined && _jsx(StorageHealthPanel, { storage: storage, mutate: mutate }), _jsx(AutomationLog, { runs: runs, tasks: tasks, openLog: openLog })] });
}
function AutomationActions({ project, automations, defaults, mutate }) {
    const t = useStrings();
    const popover = useExclusivePopover();
    const [adding, setAdding] = useState(false);
    const [agentPreset, setAgentPreset] = useState(defaults?.agentPreset ?? 'standard');
    const [modelRoute, setModelRoute] = useState(defaults?.modelRoute ?? '');
    const [reasoning, setReasoning] = useState(defaults?.reasoning ?? '');
    const minimumIntervalSeconds = Math.ceil((defaults?.minIntervalMs ?? 30_000) / 1000);
    const [intervalSeconds, setIntervalSeconds] = useState(minimumIntervalSeconds);
    const [concurrencyLimit, setConcurrencyLimit] = useState(1);
    const [quotaPolicy, setQuotaPolicy] = useState('ignore');
    const [autoPauseOnEmpty, setAutoPauseOnEmpty] = useState(false);
    useEffect(() => {
        setAgentPreset(defaults?.agentPreset ?? 'standard');
        setModelRoute(defaults?.modelRoute ?? '');
        setReasoning(defaults?.reasoning ?? '');
    }, [defaults?.agentPreset, defaults?.modelRoute, defaults?.reasoning]);
    useEffect(() => { if (!popover.open)
        setAdding(false); }, [popover.open]);
    const closeMenu = () => { setAdding(false); popover.setOpen(false); };
    const add = (event) => {
        event.preventDefault();
        if (agentPreset.trim() === '')
            return;
        void mutate('automation.create', {
            projectId: project.id,
            config: {
                intervalMs: Math.max(minimumIntervalSeconds, intervalSeconds) * 1000, agentPreset: agentPreset.trim(), concurrencyLimit, quotaPolicy, autoPauseOnEmpty,
                ...(modelRoute.trim() === '' ? {} : { modelRoute: modelRoute.trim() }),
                ...(reasoning.trim() === '' ? {} : { reasoning: reasoning.trim() }),
            },
        }).then(() => { setAdding(false); });
    };
    return (_jsx(PopoverShell, { open: popover.open, onToggle: () => { if (popover.open)
            closeMenu();
        else
            popover.setOpen(true); }, onDismiss: closeMenu, onEscape: () => { if (adding)
            setAdding(false);
        else
            closeMenu(); }, label: t.automation, children: _jsxs("div", { className: "dsh-taskboard-automation-menu", children: [_jsxs("header", { children: [_jsx("h2", { children: t.automation }), _jsxs("div", { className: "dsh-taskboard-popover-actions", children: [_jsxs("button", { type: "button", "aria-expanded": adding, onClick: () => { setAdding(value => !value); }, children: ["\uFF0B ", t.addAutomation] }), _jsx("button", { type: "button", className: "dsh-taskboard-popover-close", "aria-label": t.dismiss, onClick: closeMenu, children: _jsx(CloseIcon, { size: 14 }) })] })] }), adding && _jsxs("form", { className: "dsh-taskboard-automation-form", onSubmit: add, children: [_jsxs("label", { children: [t.agentPreset, _jsx("input", { value: agentPreset, onChange: event => { setAgentPreset(event.target.value); } })] }), _jsxs("label", { children: [t.modelRoute, _jsx("input", { value: modelRoute, onChange: event => { setModelRoute(event.target.value); } })] }), _jsxs("label", { children: [t.reasoning, _jsx("input", { value: reasoning, onChange: event => { setReasoning(event.target.value); } })] }), _jsxs("label", { children: [t.intervalSeconds, _jsx("input", { type: "number", min: minimumIntervalSeconds, value: intervalSeconds, onChange: event => { setIntervalSeconds(Math.max(minimumIntervalSeconds, Number(event.target.value) || minimumIntervalSeconds)); } })] }), _jsxs("label", { children: [t.workers, _jsx("input", { type: "number", min: "1", value: concurrencyLimit, onChange: event => { setConcurrencyLimit(Math.max(1, Number(event.target.value) || 1)); } })] }), _jsxs("label", { children: [t.quota, _jsxs("select", { value: quotaPolicy, onChange: event => { setQuotaPolicy(event.target.value); }, children: [_jsx("option", { value: "pause-on-uncertain", children: t.pauseUncertain }), _jsx("option", { value: "ignore", children: t.ignore })] })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: autoPauseOnEmpty, onChange: event => { setAutoPauseOnEmpty(event.target.checked); } }), t.autoPauseEmpty] }), _jsx("button", { type: "submit", children: t.create }), _jsx("button", { type: "button", onClick: () => { setAdding(false); }, children: t.cancel })] }), automations.length === 0 ? _jsx("p", { children: t.empty }) : automations.map(rule => _jsx(AutomationEditor, { rule: rule, defaults: defaults, minimumIntervalSeconds: minimumIntervalSeconds, mutate: mutate }, rule.id))] }) }));
}
function automationRunLabel(run, tasks) {
    const task = run.decision.taskId === undefined ? undefined : tasks.find(item => item.id === run.decision.taskId);
    return task === undefined ? run.decision.taskId : `${task.identifier} · ${task.title}`;
}
function AutomationLogItems({ runs, tasks }) {
    const t = useStrings();
    return _jsx("ol", { children: runs.map(run => (_jsxs("li", { "data-kind": run.decision.kind, children: [_jsx("time", { dateTime: new Date(run.createdAt).toISOString(), children: new Date(run.createdAt).toLocaleString() }), _jsx("span", { children: formatAutomationLog(t, run.decision, automationRunLabel(run, tasks)) })] }, run.id))) });
}
function AutomationLog({ runs, tasks, openLog }) {
    const t = useStrings();
    const { preview, remaining } = previewAutomationRuns(runs);
    return _jsxs("section", { className: "dsh-taskboard-log", children: [_jsxs("header", { children: [_jsx("h2", { children: t.automationLog }), remaining > 0 && _jsx("button", { type: "button", className: "dsh-taskboard-link", onClick: openLog, children: t.more })] }), runs.length === 0 ? _jsx("p", { children: t.empty }) : _jsx(AutomationLogItems, { runs: preview, tasks: tasks })] });
}
function AutomationLogDialog({ runs, tasks, close }) {
    const t = useStrings();
    const titleId = useId();
    const dialogRef = useRef(null);
    useEffect(() => { dialogRef.current?.focus(); }, []);
    return (_jsx("div", { className: "dsh-taskboard-dialog-backdrop", onClick: event => { if (event.target === event.currentTarget)
            close(); }, children: _jsxs("div", { ref: dialogRef, className: "dsh-taskboard-log-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabIndex: -1, children: [_jsxs("header", { children: [_jsx("h2", { id: titleId, children: t.automationLog }), _jsx("button", { type: "button", className: "dsh-taskboard-detail-close", "aria-label": t.closeDetail, onClick: close, children: _jsx(CloseIcon, { size: 14 }) })] }), runs.length === 0 ? _jsx("p", { children: t.empty }) : _jsx(AutomationLogItems, { runs: runs, tasks: tasks })] }) }));
}
function AutomationEditor({ rule, defaults, minimumIntervalSeconds, mutate }) {
    const t = useStrings();
    const [editing, setEditing] = useState(false);
    const [config, setConfig] = useState(() => applyAutomationDefaults(rule.config, defaults));
    useEffect(() => { setConfig(applyAutomationDefaults(rule.config, defaults)); }, [rule.version, defaults?.modelRoute, defaults?.reasoning]);
    const update = (next) => { setConfig(next); };
    const setOptional = (key, value) => {
        const { modelRoute, reasoning, ...required } = config;
        update({ ...required, ...(key === 'modelRoute' && value !== '' ? { modelRoute: value } : {}), ...(key === 'reasoning' && value !== '' ? { reasoning: value } : {}), ...(key !== 'modelRoute' && modelRoute !== undefined ? { modelRoute } : {}), ...(key !== 'reasoning' && reasoning !== undefined ? { reasoning } : {}) });
    };
    return _jsxs("article", { children: [_jsxs("div", { children: [_jsx("strong", { children: rule.config.agentPreset }), _jsxs("span", { children: [rule.state === 'enabled' ? t.enabled : t.paused, " \u00B7 ", rule.config.concurrencyLimit, " ", t.workers, " \u00B7 ", rule.config.intervalMs / 1000, "s"] })] }), _jsxs("div", { children: [_jsxs("small", { children: [t.nextRun, ": ", rule.nextEligibleAt === undefined ? '—' : new Date(rule.nextEligibleAt).toLocaleString()] }), _jsxs("small", { children: [t.lastDecision, ": ", rule.lastDecision === undefined ? '—' : formatAutomationLog(t, rule.lastDecision)] }), _jsxs("small", { children: [t.model, ": ", rule.config.modelRoute ?? defaults?.modelRoute ?? t.hostDefault, " \u00B7 ", t.reasoning, ": ", rule.config.reasoning ?? defaults?.reasoning ?? t.hostDefault, " \u00B7 ", t.quota, ": ", rule.config.quotaPolicy, " \u00B7 ", t.empty, ": ", rule.config.autoPauseOnEmpty ? t.pause : t.stayEnabled] })] }), _jsxs("div", { children: [_jsx("button", { type: "button", onClick: () => { void mutate('automation.run-now', { automationId: rule.id }); }, children: t.runNow }), _jsx("button", { type: "button", onClick: () => { void mutate('automation.update', { automationId: rule.id, expectedVersion: rule.version, update: { state: rule.state === 'enabled' ? 'paused' : 'enabled' } }); }, children: rule.state === 'enabled' ? t.pause : t.enable }), _jsx("button", { type: "button", "aria-expanded": editing, onClick: () => { setEditing(value => !value); }, children: t.modify })] }), editing && _jsxs("form", { className: "dsh-taskboard-automation-form", onSubmit: event => { event.preventDefault(); void mutate('automation.update', { automationId: rule.id, expectedVersion: rule.version, update: { config } }).then(() => { setEditing(false); }); }, children: [_jsxs("label", { children: [t.agentPreset, _jsx("input", { value: config.agentPreset, onChange: event => { update({ ...config, agentPreset: event.target.value }); } })] }), _jsxs("label", { children: [t.modelRoute, _jsx("input", { value: config.modelRoute ?? '', onChange: event => { setOptional('modelRoute', event.target.value.trim()); } })] }), _jsxs("label", { children: [t.reasoning, _jsx("input", { value: config.reasoning ?? '', onChange: event => { setOptional('reasoning', event.target.value.trim()); } })] }), _jsxs("label", { children: [t.intervalSeconds, _jsx("input", { type: "number", min: minimumIntervalSeconds, value: config.intervalMs / 1000, onChange: event => { update({ ...config, intervalMs: Math.max(minimumIntervalSeconds, Number(event.target.value) || minimumIntervalSeconds) * 1000 }); } })] }), _jsxs("label", { children: [t.workers, _jsx("input", { type: "number", min: "1", value: config.concurrencyLimit, onChange: event => { update({ ...config, concurrencyLimit: Math.max(1, Number(event.target.value) || 1) }); } })] }), _jsxs("label", { children: [t.quota, _jsxs("select", { value: config.quotaPolicy, onChange: event => { update({ ...config, quotaPolicy: event.target.value }); }, children: [_jsx("option", { value: "pause-on-uncertain", children: t.pauseUncertain }), _jsx("option", { value: "ignore", children: t.ignore })] })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: config.autoPauseOnEmpty, onChange: event => { update({ ...config, autoPauseOnEmpty: event.target.checked }); } }), t.autoPauseEmpty] }), _jsx("button", { type: "submit", disabled: config.agentPreset.trim() === '', children: t.save }), _jsx("button", { type: "button", onClick: () => { setEditing(false); setConfig(applyAutomationDefaults(rule.config, defaults)); }, children: t.cancel })] })] });
}
function Board({ tasks, open, mutate }) {
    const t = useStrings();
    const [draggedId, setDraggedId] = useState();
    const draggingRef = useRef(false);
    const dragged = tasks.find(task => task.id === draggedId);
    const applyDrop = (status, target) => {
        const column = tasks.filter(task => task.status === status && task.archivedAt === undefined);
        const intent = boardDropIntent(dragged, status, column, target);
        setDraggedId(undefined);
        if (intent.kind === 'reorder') {
            void mutate('task.update', {
                taskId: intent.taskId,
                expectedVersion: intent.expectedVersion,
                request: { sortOrder: intent.sortOrder },
            });
        }
        else if (intent.kind === 'move') {
            void mutate('task.move', {
                taskId: intent.taskId,
                expectedVersion: intent.expectedVersion,
                status: intent.status,
                ...(intent.sortOrder === undefined ? {} : { sortOrder: intent.sortOrder }),
            });
        }
    };
    const archived = tasks.filter(task => task.archivedAt !== undefined);
    return _jsxs(_Fragment, { children: [_jsx("div", { className: "dsh-taskboard-board", children: TASK_STATUSES.map(status => (_jsx(BoardColumn, { status: status, tasks: tasks, open: open, applyDrop: applyDrop, draggingRef: draggingRef, setDraggedId: setDraggedId }, status))) }), archived.length > 0 && _jsxs("section", { className: "dsh-taskboard-other", children: [_jsx("h2", { children: t.other }), archived.map(task => _jsx(TaskCard, { task: task, open: open }, task.id))] })] });
}
function BoardColumn({ status, tasks, open, applyDrop, draggingRef, setDraggedId }) {
    const t = useStrings();
    const [visibleCount, setVisibleCount] = useState(BOARD_COLUMN_PAGE_SIZE);
    const columnTasks = useMemo(() => tasks.filter(task => task.status === status && task.archivedAt === undefined), [tasks, status]);
    const { visible, remaining } = paginateBoardColumn(columnTasks, visibleCount);
    return (_jsxs("section", { "data-status": status, onDragOver: event => { event.preventDefault(); }, onDrop: event => { event.preventDefault(); applyDrop(status); }, children: [_jsxs("h2", { children: [_jsx("i", { className: "dsh-taskboard-status-dot", "data-status": status }), _jsx("span", { children: t[status] }), _jsx("small", { children: columnTasks.length })] }), visible.map(task => (_jsx(TaskCard, { task: task, open: candidate => { if (!draggingRef.current)
                    open(candidate); }, drag: {
                    start: () => { draggingRef.current = true; setDraggedId(task.id); },
                    drop: () => { applyDrop(status, task); },
                    end: () => { setDraggedId(undefined); window.setTimeout(() => { draggingRef.current = false; }, 0); },
                } }, task.id))), remaining > 0 && (_jsxs("button", { type: "button", className: "dsh-taskboard-more", "aria-label": `${t.more} · ${interpolate(t.moreRemaining, { count: remaining })}`, onClick: () => { setVisibleCount(count => count + BOARD_COLUMN_PAGE_SIZE); }, children: [_jsx(MoreIcon, { size: 16 }), _jsx("span", { className: "dsh-taskboard-more-label", children: t.more })] }))] }));
}
function TaskCard({ task, open, drag }) {
    const t = useStrings();
    return _jsxs("button", { type: "button", draggable: drag !== undefined, className: "dsh-taskboard-card", "data-status": task.status, onDragStart: drag?.start, onDragEnd: drag?.end, onDragOver: event => { if (drag !== undefined) {
            event.preventDefault();
            event.stopPropagation();
        } }, onDrop: event => { if (drag === undefined)
            return; event.preventDefault(); event.stopPropagation(); drag.drop(); }, onClick: () => { open(task); }, children: [_jsxs("small", { children: [task.identifier, " \u00B7 v", task.version] }), _jsx("strong", { children: task.title }), _jsxs("span", { children: [priorityLabel(t, task.priority), task.dueDate === undefined ? '' : ` · ${task.dueDate}`] })] });
}
function ListView({ tasks, open }) {
    const t = useStrings();
    const [sort, setSort] = useState('identifier');
    const [direction, setDirection] = useState('asc');
    const ordered = useMemo(() => sortTaskList(tasks, sort, direction), [tasks, sort, direction]);
    const heading = (key, label) => (_jsx("th", { "aria-sort": sort === key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none', children: _jsxs("button", { type: "button", onClick: () => {
                if (sort === key)
                    setDirection(current => current === 'asc' ? 'desc' : 'asc');
                else {
                    setSort(key);
                    setDirection('asc');
                }
            }, children: [label, sort === key ? (direction === 'asc' ? ' ↑' : ' ↓') : ''] }) }));
    return _jsx("div", { className: "dsh-taskboard-table-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [heading('identifier', 'ID'), heading('title', t.title), heading('status', t.status), heading('priority', t.priority), heading('dueDate', t.due)] }) }), _jsx("tbody", { children: ordered.map(task => _jsxs("tr", { children: [_jsx("td", { children: _jsx("button", { type: "button", className: "dsh-taskboard-row-open", onClick: () => { open(task); }, children: task.identifier }) }), _jsx("td", { children: task.title }), _jsx("td", { children: t[task.status] }), _jsx("td", { children: priorityLabel(t, task.priority) }), _jsx("td", { children: task.dueDate ?? '—' })] }, task.id)) })] }) });
}
function LabelsView({ project, tasks, open, mutate }) {
    const t = useStrings();
    const catalog = projectLabelCatalog(project.labels, tasks);
    const unlabeled = tasksForLabel(tasks, undefined);
    const [selected, setSelected] = useState(catalog[0]);
    const [draft, setDraft] = useState('');
    const [rename, setRename] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    useEffect(() => {
        if (selected !== undefined && !catalog.includes(selected))
            setSelected(catalog[0]);
    }, [catalog, selected]);
    useEffect(() => { setRename(selected ?? ''); setConfirmDelete(false); }, [selected]);
    const selectedTasks = tasksForLabel(tasks, selected);
    const add = (event) => {
        event.preventDefault();
        const name = draft.trim();
        if (name === '' || catalog.includes(name))
            return;
        void mutate('project.update', {
            projectId: project.id,
            expectedVersion: project.version,
            request: { labels: [...project.labels, name] },
        }).then(() => { setDraft(''); setSelected(name); });
    };
    const saveRename = () => {
        const name = rename.trim();
        if (selected === undefined || name === '' || name === selected)
            return;
        void mutate('project.rename-label', {
            projectId: project.id, expectedVersion: project.version, from: selected, to: name,
        }).then(() => { setSelected(name); });
    };
    const remove = () => {
        if (selected === undefined)
            return;
        void mutate('project.remove-label', {
            projectId: project.id, expectedVersion: project.version, label: selected,
        }).then(() => { setConfirmDelete(false); setSelected(undefined); });
    };
    return (_jsxs("div", { className: "dsh-taskboard-labels", children: [_jsxs("aside", { children: [_jsxs("form", { className: "dsh-taskboard-workflow-create", onSubmit: add, children: [_jsx("input", { "aria-label": t.labelName, value: draft, onChange: event => { setDraft(event.target.value); }, placeholder: t.addLabel }), _jsxs("button", { type: "submit", disabled: draft.trim() === '', children: ["\uFF0B ", t.addLabel] })] }), catalog.map(label => (_jsxs("button", { type: "button", className: label === selected ? 'active' : '', onClick: () => { setSelected(label); }, children: [_jsx("strong", { children: label }), _jsx("small", { children: tasksForLabel(tasks, label).length })] }, label))), _jsxs("button", { type: "button", className: selected === undefined ? 'active' : '', onClick: () => { setSelected(undefined); }, children: [_jsx("strong", { children: t.unlabeled }), _jsx("small", { children: unlabeled.length })] })] }), _jsxs("section", { children: [selected === undefined
                        ? _jsx("header", { children: _jsx("h2", { children: t.unlabeledTasks }) })
                        : _jsxs("header", { children: [_jsx("input", { "aria-label": t.renameLabel, value: rename, onChange: event => { setRename(event.target.value); } }), _jsx("button", { type: "button", disabled: rename.trim() === '' || rename.trim() === selected, onClick: saveRename, children: t.save }), _jsx("button", { type: "button", "aria-expanded": confirmDelete, onClick: () => { setConfirmDelete(value => !value); }, children: t.deleteLabel }), confirmDelete && _jsxs("div", { className: "dsh-taskboard-confirm", role: "alert", children: [_jsxs("span", { children: [t.deleteLabel, " \u201C", selected, "\u201D?"] }), _jsx("button", { type: "button", onClick: remove, children: t.delete }), _jsx("button", { type: "button", onClick: () => { setConfirmDelete(false); }, children: t.close })] })] }), selectedTasks.length === 0
                        ? _jsx("div", { className: "dsh-taskboard-empty", children: selected === undefined && catalog.length === 0 ? t.noLabels : t.empty })
                        : selectedTasks.map(task => _jsx(TaskCard, { task: task, open: open }, task.id))] })] }));
}
function Gantt({ tasks, open }) {
    const t = useStrings();
    const [zoom, setZoom] = useState('quarter');
    const [showCompleted, setShowCompleted] = useState(false);
    const [anchor, setAnchor] = useState(() => Date.now());
    const rows = useRef(null);
    // The bars are a percentage of the middle grid column, so the "today" line has to be placed in
    // that column's own pixels. Anchoring it to 50% of the whole component dropped it between the
    // title column and the track.
    const [todayLeft, setTodayLeft] = useState();
    const days = zoom === 'month' ? 30 : zoom === 'quarter' ? 90 : 365;
    const start = anchor - ((days / 2) * 86_400_000);
    // Task dates are calendar days validated in UTC by the provider. Parsing them at local midnight
    // shifted every bar a day west of UTC.
    const point = (value, fallback) => value === undefined ? fallback : new Date(`${value}T00:00:00Z`).getTime();
    const end = start + (days * 86_400_000);
    const dated = tasks.filter(task => {
        if (task.startDate === undefined && task.dueDate === undefined)
            return false;
        if (!showCompleted && task.status === 'done')
            return false;
        // A task entirely outside the window used to be clamped to the left edge, drawing a bar that
        // looked like work happening now. Leave it out of the window instead.
        const taskStart = point(task.startDate, point(task.dueDate, anchor));
        const taskEnd = Math.max(point(task.dueDate, taskStart + 86_400_000), taskStart + 86_400_000);
        return taskEnd >= start && taskStart <= end;
    });
    useEffect(() => {
        const container = rows.current;
        if (container === null)
            return;
        const measure = () => {
            const track = container.querySelector('.dsh-taskboard-gantt-track');
            if (track === null) {
                setTodayLeft(undefined);
                return;
            }
            const trackBox = track.getBoundingClientRect();
            const containerBox = container.getBoundingClientRect();
            setTodayLeft(trackBox.left - containerBox.left + (trackBox.width / 2));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => { observer.disconnect(); };
    }, [dated.length, zoom]);
    return _jsxs("div", { className: "dsh-taskboard-gantt", children: [_jsxs("header", { children: [_jsx("button", { type: "button", onClick: () => { setAnchor(Date.now()); }, children: t.today }), _jsxs("select", { "aria-label": t.ganttZoom, value: zoom, onChange: event => { setZoom(event.target.value); }, children: [_jsx("option", { value: "month", children: t.days30 }), _jsx("option", { value: "quarter", children: t.days90 }), _jsx("option", { value: "year", children: t.oneYear })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: showCompleted, onChange: event => { setShowCompleted(event.target.checked); } }), t.showCompleted] })] }), _jsxs("div", { className: "dsh-taskboard-gantt-rows", ref: rows, children: [todayLeft !== undefined && _jsx("div", { className: "dsh-taskboard-today", style: { left: `${String(todayLeft)}px` }, "aria-hidden": "true" }), dated.length === 0 ? _jsx("div", { className: "dsh-taskboard-empty", children: t.noDatedTasks }) : dated.map(task => {
                        const taskStart = point(task.startDate, point(task.dueDate, anchor));
                        const taskEnd = point(task.dueDate, taskStart + 86_400_000);
                        const left = Math.max(0, Math.min(100, ((taskStart - start) / (days * 86_400_000)) * 100));
                        const width = Math.max(1.5, Math.min(100 - left, ((Math.max(taskEnd, taskStart + 86_400_000) - taskStart) / (days * 86_400_000)) * 100));
                        const repeat = task.recurrence === undefined ? '' : ` · ${task.recurrence.frequency}/${task.recurrence.interval}${task.recurrence.until === undefined ? '' : ` until ${task.recurrence.until}`}`;
                        return _jsxs("button", { type: "button", onClick: () => { open(task); }, children: [_jsxs("span", { children: [task.identifier, " \u00B7 ", task.title] }), _jsx("span", { className: "dsh-taskboard-gantt-track", children: _jsx("i", { style: { left: `${left}%`, width: `${width}%` } }) }), _jsxs("small", { children: [task.startDate ?? '…', " \u2192 ", task.dueDate ?? '…', repeat] })] }, task.id);
                    })] })] });
}
function WorkflowEditor({ project, workflows, catalog, capabilities, mutate }) {
    const t = useStrings();
    const [selectedId, setSelectedId] = useState();
    const selected = workflows.find(item => item.id === selectedId) ?? workflows[0];
    const [name, setName] = useState('');
    const [document, setDocument] = useState();
    const stepEntries = catalog.filter(item => item.category !== 'trigger');
    const triggerEntries = catalog.filter(item => item.category === 'trigger');
    const [newWorkflowName, setNewWorkflowName] = useState('');
    const [nodeKind, setNodeKind] = useState('tests');
    const [newTabName, setNewTabName] = useState('');
    const [triggerKind, setTriggerKind] = useState('issue-trigger');
    const [confirmDelete, setConfirmDelete] = useState(false);
    useEffect(() => {
        setSelectedId(selected?.id);
        setName(selected?.name ?? '');
        setDocument(selected?.document);
    }, [selected?.id, selected?.name, selected?.version]);
    const create = (event) => {
        event.preventDefault();
        if (project === undefined || newWorkflowName.trim() === '')
            return;
        const trigger = catalog.find(item => item.kind === 'issue-trigger' && item.category === 'trigger');
        if (trigger === undefined)
            return;
        void mutate('workflow.create', {
            projectId: project.id,
            name: newWorkflowName.trim(),
            document: { tabs: [{ id: 'main', name: 'Main', trigger: { id: 'trigger', kind: trigger.kind, execution: trigger.execution, config: {} }, steps: [] }] },
        }).then(() => { setNewWorkflowName(''); });
    };
    const addStep = () => {
        if (document === undefined)
            return;
        const entry = catalog.find(item => item.kind === nodeKind);
        if (entry === undefined || entry.category === 'trigger')
            return;
        const first = document.tabs[0];
        if (first === undefined)
            return;
        const node = { id: `${nodeKind}-${Date.now()}`, kind: nodeKind, execution: entry.execution, config: {} };
        setDocument(insertWorkflowNode(document, first.id, node));
    };
    const addTab = () => {
        if (document === undefined || newTabName.trim() === '')
            return;
        const entry = catalog.find(item => item.kind === triggerKind && item.category === 'trigger');
        if (entry === undefined)
            return;
        const suffix = Date.now();
        setDocument(addWorkflowTab(document, { id: `tab-${suffix}`, name: newTabName.trim(), trigger: { id: `trigger-${suffix}`, kind: triggerKind, execution: entry.execution, config: {} }, steps: [] }));
        setNewTabName('');
    };
    const editNode = (action, tabId, nodeId) => {
        if (document === undefined)
            return;
        if (action === 'up' || action === 'down')
            setDocument(moveWorkflowNode(document, nodeId, action === 'up' ? -1 : 1));
        else if (action === 'copy') {
            const suffix = Date.now();
            setDocument(copyWorkflowNode(document, nodeId, source => `${source}-copy-${suffix}`));
        }
        else if (action === 'delete')
            setDocument(removeWorkflowNode(document, nodeId));
        else {
            const entry = catalog.find(item => item.kind === nodeKind && item.category !== 'trigger');
            if (entry === undefined)
                return;
            setDocument(insertWorkflowNode(document, tabId, { id: `${nodeKind}-${Date.now()}`, kind: nodeKind, execution: entry.execution, config: {} }, nodeId, action === 'true' ? 'trueBranch' : 'falseBranch'));
        }
    };
    const addCapability = (kind, target) => {
        if (document === undefined || document.tabs[0] === undefined)
            return;
        const entry = catalog.find(item => item.kind === kind);
        if (entry === undefined)
            return;
        setDocument(insertWorkflowNode(document, document.tabs[0].id, {
            id: `${kind}-${Date.now()}`, kind, execution: entry.execution, config: { target },
        }));
    };
    return _jsxs("div", { className: "dsh-taskboard-workflows", children: [_jsxs("aside", { children: [_jsxs("form", { className: "dsh-taskboard-workflow-create", onSubmit: create, children: [_jsx("input", { "aria-label": t.workflowName, value: newWorkflowName, onChange: event => { setNewWorkflowName(event.target.value); }, placeholder: t.workflowName }), _jsxs("button", { type: "submit", disabled: project === undefined || newWorkflowName.trim() === '', children: ["\uFF0B ", t.addWorkflow] })] }), workflows.map(item => _jsxs("button", { type: "button", className: item.id === selected?.id ? 'active' : '', onClick: () => { setSelectedId(item.id); }, children: [_jsx("strong", { children: item.name }), _jsxs("small", { children: ["v", item.version] })] }, item.id))] }), _jsx("section", { children: selected === undefined || document === undefined ? _jsx("div", { className: "dsh-taskboard-empty", children: t.workflowNote }) : _jsxs(_Fragment, { children: [_jsxs("header", { children: [_jsx("input", { "aria-label": t.workflowName, value: name, onChange: event => { setName(event.target.value); } }), _jsx("select", { "aria-label": t.nodeKind, value: nodeKind, onChange: event => { setNodeKind(event.target.value); }, children: stepEntries.map(item => _jsx("option", { value: item.kind, children: item.kind }, item.kind)) }), _jsxs("button", { type: "button", onClick: addStep, children: ["\uFF0B ", t.addStep] }), _jsx("input", { "aria-label": t.newTabName, value: newTabName, onChange: event => { setNewTabName(event.target.value); }, placeholder: t.newTabName }), _jsx("select", { "aria-label": t.triggerKind, value: triggerKind, onChange: event => { setTriggerKind(event.target.value); }, children: triggerEntries.map(item => _jsx("option", { value: item.kind, children: item.kind }, item.kind)) }), _jsxs("button", { type: "button", disabled: newTabName.trim() === '', onClick: addTab, children: ["\uFF0B ", t.tab] }), _jsx("button", { type: "button", onClick: () => { void mutate('workflow.update', { workflowId: selected.id, expectedVersion: selected.version, name, document }); }, children: t.save }), _jsx("button", { type: "button", "aria-expanded": confirmDelete, onClick: () => { setConfirmDelete(value => !value); }, children: "\u00D7" }), confirmDelete && _jsxs("div", { className: "dsh-taskboard-confirm", role: "alert", children: [_jsxs("span", { children: [t.deleteWorkflow, "?"] }), _jsx("button", { type: "button", onClick: () => { void mutate('workflow.delete', { workflowId: selected.id, expectedVersion: selected.version }); setConfirmDelete(false); }, children: t.delete }), _jsx("button", { type: "button", onClick: () => { setConfirmDelete(false); }, children: t.close })] })] }), _jsx("div", { className: "dsh-taskboard-workflow-tabs", children: document.tabs.map(tab => _jsxs("article", { children: [_jsxs("header", { children: [_jsx("h3", { children: tab.name }), _jsxs("button", { type: "button", disabled: document.tabs.length <= 1, onClick: () => { setDocument(removeWorkflowTab(document, tab.id)); }, children: ["\u00D7 ", t.tab] })] }), _jsx(WorkflowNodeCard, { node: tab.trigger, tabId: tab.id, edit: editNode, trigger: true }), _jsx("div", { className: "dsh-taskboard-flow-line" }), tab.steps.map(node => _jsx(WorkflowNodeCard, { node: node, tabId: tab.id, edit: editNode }, node.id))] }, tab.id)) }), _jsx("footer", { children: catalog.map(item => _jsxs("span", { "data-execution": item.execution, children: [item.kind, " \u00B7 ", item.execution === 'executable' ? t.executable : t.designOnly] }, item.kind)) }), _jsxs("section", { className: "dsh-taskboard-capabilities", children: [_jsx("h3", { children: t.installedCapabilities }), _jsxs("small", { children: [t.skillDiscovery, ": ", capabilities?.skillDiscoveryComplete === true ? t.completeWord : t.refreshing] }), _jsx("div", { children: capabilities?.skills.map(skill => _jsxs("button", { type: "button", title: skill.description, onClick: () => { addCapability('skill', skill.name); }, children: ["\uFF0B ", t.skill, " \u00B7 ", skill.name] }, `skill-${skill.name}`)) }), _jsx("div", { children: capabilities?.mcpTools.map(tool => _jsxs("button", { type: "button", title: tool.description, onClick: () => { addCapability('mcp', tool.name); }, children: ["\uFF0B ", t.mcp, " \u00B7 ", tool.name] }, `mcp-${tool.name}`)) })] })] }) })] });
}
function WorkflowNodeCard({ node, tabId, edit, trigger = false }) {
    const t = useStrings();
    return _jsxs("div", { className: "dsh-taskboard-workflow-node", "data-execution": node.execution, children: [_jsx("strong", { children: node.kind }), _jsx("small", { children: node.execution === 'executable' ? t.executable : t.designOnly }), !trigger && _jsxs("div", { className: "dsh-taskboard-workflow-node-actions", children: [_jsx("button", { type: "button", onClick: () => { edit('up', tabId, node.id); }, children: "\u2191" }), _jsx("button", { type: "button", onClick: () => { edit('down', tabId, node.id); }, children: "\u2193" }), _jsx("button", { type: "button", onClick: () => { edit('copy', tabId, node.id); }, children: t.copy }), _jsx("button", { type: "button", onClick: () => { edit('delete', tabId, node.id); }, children: "\u00D7" }), node.kind === 'condition' && _jsxs(_Fragment, { children: [_jsxs("button", { type: "button", onClick: () => { edit('true', tabId, node.id); }, children: ["\uFF0B ", t.trueLabel] }), _jsxs("button", { type: "button", onClick: () => { edit('false', tabId, node.id); }, children: ["\uFF0B ", t.falseLabel] })] })] }), node.steps?.map(child => _jsx(WorkflowNodeCard, { node: child, tabId: tabId, edit: edit }, child.id)), (node.trueBranch !== undefined || node.falseBranch !== undefined) && _jsxs("div", { className: "dsh-taskboard-branches", children: [_jsxs("section", { children: [_jsx("b", { children: t.trueLabel }), node.trueBranch?.map(child => _jsx(WorkflowNodeCard, { node: child, tabId: tabId, edit: edit }, child.id))] }), _jsxs("section", { children: [_jsx("b", { children: t.falseLabel }), node.falseBranch?.map(child => _jsx(WorkflowNodeCard, { node: child, tabId: tabId, edit: edit }, child.id))] })] })] });
}
function TaskDetail({ project, task, tasks, workflows, detail, mutate, upload, download, preview, openSession, openNewSession, close, onDirtyChange }) {
    const t = useStrings();
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description);
    const [priority, setPriority] = useState(task.priority);
    const [labels, setLabels] = useState(task.labels.join(', '));
    const [startDate, setStartDate] = useState(task.startDate ?? '');
    const [dueDate, setDueDate] = useState(task.dueDate ?? '');
    const [recurrence, setRecurrence] = useState(task.recurrence?.frequency ?? '');
    const [recurrenceInterval, setRecurrenceInterval] = useState(String(task.recurrence?.interval ?? 1));
    const [recurrenceUntil, setRecurrenceUntil] = useState(task.recurrence?.until ?? '');
    const [assignee, setAssignee] = useState(task.assignee ?? '');
    const [workflowId, setWorkflowId] = useState(task.workflowId ?? '');
    const [developmentKind, setDevelopmentKind] = useState(task.developmentContext?.kind ?? '');
    const [developmentBranch, setDevelopmentBranch] = useState(task.developmentContext?.branch ?? '');
    const [worktreePath, setWorktreePath] = useState(task.developmentContext?.kind === 'worktree' ? task.developmentContext.path : '');
    const [comment, setComment] = useState('');
    const [descriptionMode, setDescriptionMode] = useState(descriptionComposerMode(task.description));
    const [editingDescription, setEditingDescription] = useState(true);
    const [commentMode, setCommentMode] = useState('write');
    const [editingCommentId, setEditingCommentId] = useState();
    const [editCommentBody, setEditCommentBody] = useState('');
    const [editCommentMode, setEditCommentMode] = useState('write');
    const [deletingCommentId, setDeletingCommentId] = useState();
    const [relationKind, setRelationKind] = useState('related');
    const [relationTarget, setRelationTarget] = useState('');
    const [pendingAction, setPendingAction] = useState('');
    const [actionReason, setActionReason] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const titleId = useId();
    const dialogRef = useRef(null);
    const developmentInvalid = developmentKind === 'branch'
        ? developmentBranch.trim() === ''
        : developmentKind === 'worktree' && (developmentBranch.trim() === '' || worktreePath.trim() === '');
    const dirty = title !== task.title
        || description !== task.description
        || priority !== task.priority
        || labels !== task.labels.join(', ')
        || (assignee.trim() || '') !== (task.assignee ?? '')
        || (workflowId || '') !== (task.workflowId ?? '')
        || developmentKind !== (task.developmentContext?.kind ?? '')
        || developmentBranch !== (task.developmentContext?.branch ?? '')
        || worktreePath !== (task.developmentContext?.kind === 'worktree' ? task.developmentContext.path : '')
        || startDate !== (task.startDate ?? '')
        || dueDate !== (task.dueDate ?? '')
        || recurrence !== (task.recurrence?.frequency ?? '')
        || (recurrence !== '' && recurrenceInterval !== String(task.recurrence?.interval ?? 1))
        || (recurrence !== '' && recurrenceUntil !== (task.recurrence?.until ?? ''));
    const currentVersion = detail?.task.version ?? task.version;
    // Report upward so Escape and the backdrop can confirm before discarding these local edits.
    useEffect(() => {
        onDirtyChange(dirty);
        return () => { onDirtyChange(false); };
    }, [dirty, onDirtyChange]);
    useEffect(() => {
        setTitle(task.title);
        setDescription(task.description);
        setPriority(task.priority);
        setLabels(task.labels.join(', '));
        setStartDate(task.startDate ?? '');
        setDueDate(task.dueDate ?? '');
        setRecurrence(task.recurrence?.frequency ?? '');
        setRecurrenceInterval(String(task.recurrence?.interval ?? 1));
        setRecurrenceUntil(task.recurrence?.until ?? '');
        setAssignee(task.assignee ?? '');
        setWorkflowId(task.workflowId ?? '');
        setDevelopmentKind(task.developmentContext?.kind ?? '');
        setDevelopmentBranch(task.developmentContext?.branch ?? '');
        setWorktreePath(task.developmentContext?.kind === 'worktree' ? task.developmentContext.path : '');
        setComment('');
        setPendingAction('');
        setActionReason('');
        setConfirmDelete(false);
        setDescriptionMode(descriptionComposerMode(task.description));
        setEditingDescription(true);
        setCommentMode('write');
        setEditingCommentId(undefined);
        setEditCommentBody('');
        setDeletingCommentId(undefined);
    }, [task.id]);
    useEffect(() => { dialogRef.current?.focus(); }, [task.id]);
    const save = () => {
        void mutate('task.update', {
            taskId: task.id,
            expectedVersion: currentVersion,
            request: {
                title, description, priority,
                labels: labels.split(',').map(value => value.trim()).filter(Boolean),
                assignee: assignee.trim() || null,
                workflowId: workflowId || null,
                developmentContext: developmentKind === ''
                    ? null
                    : developmentKind === 'branch'
                        ? { kind: 'branch', branch: developmentBranch.trim() }
                        : { kind: 'worktree', branch: developmentBranch.trim(), path: worktreePath.trim() },
                startDate: startDate || null,
                dueDate: dueDate || null,
                recurrence: recurrence === ''
                    ? null
                    : { frequency: recurrence, interval: Math.max(1, Number.parseInt(recurrenceInterval, 10) || 1), ...(recurrenceUntil === '' ? {} : { until: recurrenceUntil }) },
            },
        });
    };
    const runReasonAction = () => {
        const reason = actionReason.trim();
        if (reason === '' || pendingAction === '')
            return;
        const endpoint = pendingAction === 'return' ? 'task.return' : pendingAction === 'block' ? 'task.block' : pendingAction === 'reopen' ? 'task.reopen' : 'task.force-takeover';
        const reasonKey = pendingAction === 'return' ? 'comment' : 'reason';
        void mutate(endpoint, { taskId: task.id, expectedVersion: currentVersion, [reasonKey]: reason }).then(() => { setPendingAction(''); setActionReason(''); });
    };
    const taskLabel = (id) => {
        const match = tasks.find(item => item.id === id);
        return match === undefined ? id : `${match.identifier} · ${match.title}`;
    };
    const relationLabel = (relation) => {
        if (relation.kind === 'related')
            return `related · ${taskLabel(relation.sourceTaskId === task.id ? relation.targetTaskId : relation.sourceTaskId)}`;
        if (relation.kind === 'parent')
            return relation.sourceTaskId === task.id ? `parent of · ${taskLabel(relation.targetTaskId)}` : `child of · ${taskLabel(relation.sourceTaskId)}`;
        return relation.sourceTaskId === task.id ? `blocks · ${taskLabel(relation.targetTaskId)}` : `blocked by · ${taskLabel(relation.sourceTaskId)}`;
    };
    const saveDisabled = title.trim() === '' || developmentInvalid;
    const closed = isClosedStatus(task.status);
    const taskAttachments = detail?.attachments.filter(item => item.commentId === undefined) ?? [];
    const submitComment = () => {
        if (comment.trim() === '')
            return;
        void mutate('task.comment', { taskId: task.id, expectedVersion: currentVersion, body: comment.trim() }).then(() => { setComment(''); setCommentMode('write'); });
    };
    return (_jsx("div", { className: "dsh-taskboard-dialog-backdrop", onClick: event => { if (event.target === event.currentTarget)
            close(); }, children: _jsxs("div", { ref: dialogRef, className: "dsh-taskboard-detail", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabIndex: -1, children: [_jsxs("header", { className: "dsh-taskboard-detail-header", children: [_jsxs("div", { className: "dsh-taskboard-detail-heading", children: [_jsxs("div", { className: "dsh-taskboard-detail-meta", children: [_jsxs("span", { className: "dsh-taskboard-issue-badge", "data-closed": closed ? 'true' : undefined, children: [_jsx("i", { className: "dsh-taskboard-status-dot", "data-status": task.status }), closed ? t.closedIssue : t.openIssue] }), _jsxs("span", { className: "dsh-taskboard-detail-path", children: [project?.key ?? t.project, " \u00B7 ", task.identifier] }), _jsxs("small", { children: ["v", task.version, " \u00B7 ", t[task.status]] })] }), _jsx("input", { id: titleId, className: "dsh-taskboard-detail-title", value: title, "aria-label": t.title, onChange: event => { setTitle(event.target.value); } }), _jsxs("div", { className: "dsh-taskboard-detail-author", children: [_jsx("span", { className: "dsh-taskboard-avatar", "aria-hidden": "true", children: actorInitial(task.creator) }), _jsxs("span", { children: [_jsx("strong", { children: actorName(task.creator) }), " ", formatOpenedAt(task.createdAt, t)] })] })] }), _jsxs("div", { className: "dsh-taskboard-detail-toolbar", children: [_jsxs("button", { type: "button", className: "dsh-taskboard-save", "data-dirty": dirty ? 'true' : undefined, disabled: saveDisabled, title: developmentInvalid ? t.developmentRequired : undefined, onClick: save, children: [_jsx(SaveIcon, { size: 16 }), _jsx("span", { children: t.save })] }), _jsx("button", { type: "button", className: "dsh-taskboard-detail-close", "aria-label": t.closeDetail, onClick: close, children: _jsx(CloseIcon, { size: 14 }) })] })] }), _jsxs("div", { className: "dsh-taskboard-detail-columns", children: [_jsxs("div", { className: "dsh-taskboard-detail-main", children: [_jsx("section", { className: "dsh-taskboard-body", "aria-label": t.description, children: editingDescription
                                        ? _jsxs(_Fragment, { children: [_jsx(MarkdownComposer, { value: description, onChange: setDescription, mode: descriptionMode, onModeChange: setDescriptionMode, placeholder: t.descriptionPlaceholder, emptyPreview: _jsx("p", { children: t.empty }) }), _jsx("footer", { children: _jsx("button", { type: "button", className: "dsh-taskboard-link", onClick: () => { setEditingDescription(false); setDescriptionMode('preview'); }, children: t.preview }) })] })
                                        : _jsxs(_Fragment, { children: [_jsx("div", { className: "dsh-taskboard-body-content", children: description.trim() === '' ? _jsx("p", { className: "dsh-taskboard-muted", children: t.empty }) : _jsx(MarkdownText, { value: description }) }), _jsx("footer", { children: _jsx("button", { type: "button", className: "dsh-taskboard-link", onClick: () => { setEditingDescription(true); setDescriptionMode('write'); }, children: t.edit }) })] }) }), _jsxs("div", { className: "dsh-taskboard-detail-feed", children: [taskAttachments.length > 0 && _jsx("section", { className: "dsh-taskboard-timeline-block", "aria-label": t.attachments, children: taskAttachments.map(item => _jsx(AttachmentRow, { attachment: item, download: download, preview: preview, showMeta: true, remove: () => { void mutate('attachment.delete', { taskId: task.id, expectedVersion: currentVersion, attachmentId: item.id }); } }, item.id)) }), _jsx("ol", { className: "dsh-taskboard-timeline", children: (detail?.comments ?? []).map(item => _jsxs("li", { className: "dsh-taskboard-timeline-comment", children: [_jsx("span", { className: "dsh-taskboard-avatar", "aria-hidden": "true", children: actorInitial(item.authorId) }), _jsxs("article", { children: [_jsxs("header", { children: [_jsxs("span", { children: [_jsx("strong", { children: actorName(item.authorId) }), _jsxs("small", { children: [new Date(item.createdAt).toLocaleString(), item.updatedAt !== item.createdAt ? ` · ${t.edited}` : ''] })] }), deletingCommentId === item.id
                                                                        ? _jsxs("span", { className: "dsh-taskboard-comment-actions", role: "alert", children: [_jsxs("span", { children: [t.delete, "?"] }), _jsx("button", { type: "button", className: "dsh-taskboard-save", onClick: () => { void mutate('comment.delete', { taskId: task.id, expectedVersion: currentVersion, commentId: item.id }).then(value => { if (value !== undefined)
                                                                                        setDeletingCommentId(undefined); }); }, children: t.delete }), _jsx("button", { type: "button", onClick: () => { setDeletingCommentId(undefined); }, children: t.cancel })] })
                                                                        : _jsxs("span", { className: "dsh-taskboard-comment-actions", children: [_jsx("button", { type: "button", className: "dsh-taskboard-link", onClick: () => { setEditingCommentId(item.id); setEditCommentBody(item.body); setEditCommentMode('write'); setDeletingCommentId(undefined); }, children: t.edit }), _jsx("button", { type: "button", className: "dsh-taskboard-link", onClick: () => { setDeletingCommentId(item.id); setEditingCommentId(undefined); }, children: t.delete })] })] }), editingCommentId === item.id
                                                                ? _jsxs(_Fragment, { children: [_jsx(MarkdownComposer, { value: editCommentBody, onChange: setEditCommentBody, mode: editCommentMode, onModeChange: setEditCommentMode, placeholder: t.commentPlaceholder, emptyPreview: _jsx("p", { children: t.commentPlaceholder }) }), _jsxs("footer", { children: [_jsx("button", { type: "button", className: "dsh-taskboard-save", disabled: editCommentBody.trim() === '', onClick: () => {
                                                                                        void mutate('comment.update', { taskId: task.id, expectedVersion: currentVersion, commentId: item.id, body: editCommentBody.trim() })
                                                                                            .then(value => { if (value !== undefined) {
                                                                                            setEditingCommentId(undefined);
                                                                                            setEditCommentBody('');
                                                                                        } });
                                                                                    }, children: t.save }), _jsx("button", { type: "button", onClick: () => { setEditingCommentId(undefined); setEditCommentBody(''); }, children: t.cancel })] })] })
                                                                : _jsx(MarkdownText, { value: item.body }), _jsxs("label", { className: "dsh-taskboard-file-label", children: [t.attachComment, _jsx("input", { type: "file", onChange: event => { const file = event.target.files?.[0]; if (file !== undefined)
                                                                            void upload(file, item.id); event.target.value = ''; } })] }), detail?.attachments.filter(attachment => attachment.commentId === item.id).map(attachment => _jsx(AttachmentRow, { attachment: attachment, download: download, preview: preview, remove: () => { void mutate('attachment.delete', { taskId: task.id, expectedVersion: currentVersion, attachmentId: attachment.id }); } }, attachment.id))] })] }, item.id)) })] }), pendingAction !== '' && _jsxs("div", { className: "dsh-taskboard-reason", children: [_jsxs("label", { children: [t.reason, _jsx("textarea", { autoFocus: true, value: actionReason, onChange: event => { setActionReason(event.target.value); } })] }), _jsx("button", { type: "button", className: "dsh-taskboard-save", disabled: actionReason.trim() === '', onClick: runReasonAction, children: t.confirm }), _jsx("button", { type: "button", onClick: () => { setPendingAction(''); setActionReason(''); }, children: t.close })] }), confirmDelete && _jsxs("div", { className: "dsh-taskboard-confirm", role: "alert", children: [_jsxs("span", { children: [t.permanentlyDelete, " ", task.identifier, "?"] }), _jsx("button", { type: "button", onClick: () => { void mutate('task.delete', { taskId: task.id, expectedVersion: currentVersion }); setConfirmDelete(false); }, children: t.delete }), _jsx("button", { type: "button", onClick: () => { setConfirmDelete(false); }, children: t.close })] }), _jsxs("section", { className: "dsh-taskboard-composer", "aria-label": t.addComment, children: [_jsx("h3", { children: t.addComment }), _jsx(MarkdownComposer, { value: comment, onChange: setComment, mode: commentMode, onModeChange: setCommentMode, placeholder: t.commentPlaceholder, emptyPreview: _jsx("p", { children: t.commentPlaceholder }) }), _jsxs("footer", { children: [_jsxs("label", { className: "dsh-taskboard-file-label", children: [t.attachFiles, _jsx("input", { type: "file", onChange: event => { const file = event.target.files?.[0]; if (file !== undefined)
                                                                void upload(file); event.target.value = ''; } })] }), _jsxs("div", { className: "dsh-taskboard-composer-actions", children: [task.status === 'backlog' && _jsx("button", { type: "button", onClick: () => { void mutate('task.approve', { taskId: task.id, expectedVersion: currentVersion }); }, children: t.approve }), task.status === 'in_review' && _jsx("button", { type: "button", onClick: () => { void mutate('task.accept', { taskId: task.id, expectedVersion: currentVersion }); }, children: t.accept }), task.status === 'blocked' && _jsx("button", { type: "button", onClick: () => { void mutate('task.resume', { taskId: task.id, expectedVersion: currentVersion }); }, children: t.resume }), (task.status === 'todo' || task.status === 'in_progress') && _jsx("button", { type: "button", onClick: () => { void mutate('task.cancel', { taskId: task.id, expectedVersion: currentVersion }); }, children: t.closeIssue }), (task.status === 'done' || task.status === 'canceled') && _jsx("button", { type: "button", onClick: () => { setPendingAction('reopen'); }, children: t.reopen }), _jsx("button", { type: "button", className: "dsh-taskboard-save", disabled: comment.trim() === '', onClick: submitComment, children: t.comment })] })] })] })] }), _jsxs("aside", { className: "dsh-taskboard-detail-side", children: [_jsx(MetaField, { label: t.assignee, children: _jsx("input", { value: assignee, placeholder: t.noOne, onChange: event => { setAssignee(event.target.value); } }) }), _jsx(MetaField, { label: t.labels, children: _jsx("input", { value: labels, onChange: event => { setLabels(event.target.value); }, placeholder: "local, release" }) }), _jsxs("section", { className: "dsh-taskboard-meta-project", children: [_jsx("h3", { children: t.project }), _jsx("p", { children: project === undefined ? t.none : `${project.key} · ${project.name}` }), _jsx(MetaField, { nested: true, label: t.status, children: _jsx("select", { "aria-label": t.status, value: task.status, onChange: event => {
                                                    const status = event.target.value;
                                                    if (status === task.status)
                                                        return;
                                                    void mutate('task.move', { taskId: task.id, expectedVersion: currentVersion, status });
                                                }, children: TASK_STATUSES.map(status => _jsx("option", { value: status, children: t[status] }, status)) }) }), _jsx(MetaField, { nested: true, label: t.priority, children: _jsx("select", { value: priority, onChange: event => { setPriority(event.target.value); }, children: ['urgent', 'high', 'medium', 'low', 'none'].map(value => _jsx("option", { value: value, children: priorityLabel(t, value) }, value)) }) }), _jsx(MetaField, { nested: true, label: t.workflow, children: _jsxs("select", { value: workflowId, onChange: event => { setWorkflowId(event.target.value); }, children: [_jsx("option", { value: "", children: t.none }), workflows.map(item => _jsx("option", { value: item.id, children: item.name }, item.id))] }) }), _jsx(MetaField, { nested: true, label: t.start, children: _jsx("input", { type: "date", value: startDate, onChange: event => { setStartDate(event.target.value); } }) }), _jsx(MetaField, { nested: true, label: t.targetDate, children: _jsx("input", { type: "date", value: dueDate, onChange: event => { setDueDate(event.target.value); } }) }), _jsxs(MetaField, { nested: true, label: t.recurrence, children: [_jsxs("select", { value: recurrence, onChange: event => { setRecurrence(event.target.value); }, children: [_jsx("option", { value: "", children: t.noRecurrence }), _jsx("option", { value: "daily", children: t.daily }), _jsx("option", { value: "weekly", children: t.weekly }), _jsx("option", { value: "monthly", children: t.monthly })] }), recurrence !== '' && _jsxs(_Fragment, { children: [_jsx("input", { type: "number", min: "1", "aria-label": t.interval, value: recurrenceInterval, onChange: event => { setRecurrenceInterval(event.target.value); } }), _jsx("input", { type: "date", "aria-label": t.until, value: recurrenceUntil, onChange: event => { setRecurrenceUntil(event.target.value); } })] })] })] }), _jsxs(MetaField, { label: t.relations, children: [_jsxs("div", { className: "dsh-taskboard-relation-create", children: [_jsxs("select", { "aria-label": t.relationKind, value: relationKind, onChange: event => { setRelationKind(event.target.value); }, children: [_jsx("option", { value: "parent", children: "parent" }), _jsx("option", { value: "blocks", children: "blocks" }), _jsx("option", { value: "related", children: "related" })] }), _jsxs("select", { "aria-label": t.relatedTask, value: relationTarget, onChange: event => { setRelationTarget(event.target.value); }, children: [_jsx("option", { value: "", children: t.selectTask }), tasks.filter(item => item.id !== task.id && item.projectId === task.projectId).map(item => _jsxs("option", { value: item.id, children: [item.identifier, " \u00B7 ", item.title] }, item.id))] }), _jsx("button", { type: "button", disabled: relationTarget === '', onClick: () => { void mutate('task.relation', { taskId: task.id, expectedVersion: currentVersion, targetTaskId: relationTarget, kind: relationKind }).then(() => { setRelationTarget(''); }); }, children: t.add })] }), detail === undefined || detail.relations.length === 0 ? _jsx("p", { className: "dsh-taskboard-muted", children: t.noneYet }) : detail.relations.map(item => {
                                            // removeRelation checks the source task's version. For an outgoing relation that
                                            // is this task, so prefer the detail version over the snapshot page, which may not
                                            // contain the source at all.
                                            const sourceVersion = item.sourceTaskId === task.id
                                                ? currentVersion
                                                : tasks.find(candidate => candidate.id === item.sourceTaskId)?.version;
                                            return _jsxs("article", { className: "dsh-taskboard-side-item", children: [_jsx("strong", { children: relationLabel(item) }), _jsx("button", { type: "button", disabled: sourceVersion === undefined, title: sourceVersion === undefined ? t.relationSourceUnloaded : undefined, onClick: () => { if (sourceVersion !== undefined)
                                                            void mutate('relation.delete', { relationId: item.id, expectedVersion: sourceVersion }); }, children: t.delete })] }, item.id);
                                        })] }), _jsxs(MetaField, { label: t.developmentContext, children: [_jsxs("select", { value: developmentKind, onChange: event => { setDevelopmentKind(event.target.value); }, children: [_jsx("option", { value: "", children: t.none }), _jsx("option", { value: "branch", children: t.branch }), _jsx("option", { value: "worktree", children: t.worktree })] }), developmentKind !== '' && _jsx("input", { value: developmentBranch, "aria-label": t.branch, placeholder: t.branch, onChange: event => { setDevelopmentBranch(event.target.value); } }), developmentKind === 'worktree' && _jsx("input", { value: worktreePath, "aria-label": t.worktreePath, placeholder: t.worktreePath, onChange: event => { setWorktreePath(event.target.value); } })] }), _jsxs(MetaField, { label: t.sessions, children: [_jsx("button", { type: "button", disabled: project?.workspaceId === undefined || (task.status !== 'todo' && task.status !== 'in_progress'), title: project?.workspaceId === undefined ? t.workspaceRequired : task.status !== 'todo' && task.status !== 'in_progress' ? t.sessionTaskMustBeActive : undefined, onClick: () => { void openNewSession(); }, children: t.newSession }), detail === undefined || detail.claims.length === 0 ? _jsx("p", { className: "dsh-taskboard-muted", children: t.noneYet }) : detail.claims.map(item => {
                                            const runtime = detail.sessionRuntime?.find(value => value.sessionId === item.sessionId);
                                            return _jsxs("article", { className: "dsh-taskboard-side-item", children: [_jsxs("button", { type: "button", className: "dsh-taskboard-link", onClick: () => { void openSession(item.sessionId); }, children: [t.openSession, ": ", item.sessionId] }), _jsxs("small", { children: [item.state, " \u00B7 ", runtime?.status ?? t.offline, runtime?.current === true ? ` · ${t.current}` : ''] })] }, item.id);
                                        })] }), _jsxs("div", { className: "dsh-taskboard-actions", children: [task.status === 'in_review' && _jsx("button", { type: "button", onClick: () => { setPendingAction('return'); }, children: t.returnWork }), (task.status === 'todo' || task.status === 'in_progress') && _jsx("button", { type: "button", onClick: () => { setPendingAction('block'); }, children: t.blocked }), ['backlog', 'in_review', 'blocked'].includes(task.status) && _jsx("button", { type: "button", onClick: () => { void mutate('task.cancel', { taskId: task.id, expectedVersion: currentVersion }); }, children: t.closeIssue }), detail?.activeClaim !== undefined && _jsx("button", { type: "button", onClick: () => { setPendingAction('takeover'); }, children: t.takeover }), task.archivedAt === undefined ? _jsx("button", { type: "button", onClick: () => { void mutate('task.archive', { taskId: task.id, expectedVersion: currentVersion }); }, children: t.archive }) : _jsx("button", { type: "button", onClick: () => { void mutate('task.restore', { taskId: task.id, expectedVersion: currentVersion }); }, children: t.restore }), task.archivedAt !== undefined && _jsx("button", { type: "button", "aria-expanded": confirmDelete, onClick: () => { setConfirmDelete(value => !value); }, children: t.delete })] })] })] })] }) }));
}
function MarkdownText({ value }) {
    const blocks = useMemo(() => parseMarkdown(value), [value]);
    return _jsx("div", { className: "dsh-taskboard-markdown", children: blocks.map((block, index) => _jsx(MarkdownBlockView, { block: block }, index)) });
}
function MarkdownBlockView({ block }) {
    if (block.type === 'heading') {
        const children = _jsx(MarkdownInlines, { nodes: block.children });
        if (block.level === 1)
            return _jsx("h1", { children: children });
        if (block.level === 2)
            return _jsx("h2", { children: children });
        if (block.level === 3)
            return _jsx("h3", { children: children });
        return _jsx("h4", { children: children });
    }
    if (block.type === 'paragraph')
        return _jsx("p", { children: _jsx(MarkdownInlines, { nodes: block.children }) });
    if (block.type === 'code')
        return _jsx("pre", { children: _jsx("code", { children: block.value }) });
    if (block.type === 'blockquote')
        return _jsx("blockquote", { children: block.children.map((child, index) => _jsx(MarkdownBlockView, { block: child }, index)) });
    if (block.type === 'list') {
        const items = block.items.map((item, index) => _jsx("li", { children: _jsx(MarkdownInlines, { nodes: item }) }, index));
        return block.ordered ? _jsx("ol", { children: items }) : _jsx("ul", { children: items });
    }
    return _jsx("hr", {});
}
function MarkdownInlines({ nodes }) {
    return nodes.map((node, index) => {
        if (node.type === 'text')
            return _jsx("span", { children: node.value }, index);
        if (node.type === 'code')
            return _jsx("code", { children: node.value }, index);
        if (node.type === 'strong')
            return _jsx("strong", { children: _jsx(MarkdownInlines, { nodes: node.children }) }, index);
        if (node.type === 'em')
            return _jsx("em", { children: _jsx(MarkdownInlines, { nodes: node.children }) }, index);
        if (node.type === 'del')
            return _jsx("del", { children: _jsx(MarkdownInlines, { nodes: node.children }) }, index);
        if (node.type === 'image')
            return _jsx("img", { src: node.src, alt: node.alt }, index);
        const external = /^https?:/i.test(node.href);
        return _jsx("a", { href: node.href, ...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {}), children: _jsx(MarkdownInlines, { nodes: node.children }) }, index);
    });
}
/** Browser plugin registration; generated Remote contribution and both slots unwind together. */
export async function apply(ctx) {
    const connection = ctx.get('connection');
    const remote = ctx.get('remote');
    const locale = ctx.get('locale');
    const unbindLocale = bindTaskboardLocale(locale);
    const unregisterCopy = locale.register(TASKBOARD_LOCALE_NS, taskboardLocales);
    const unmountRemote = await remote.$mount(taskboardRemote);
    ctx.inject(['remote.taskboard', 'uiWorkspace'], (remoteCtx) => {
        const sessions = remoteCtx.get('sessions');
        const workspaces = remoteCtx.get('workspaces');
        const uiWorkspace = remoteCtx.get('uiWorkspace');
        const conversation = remoteCtx.get('conversation');
        const mountedRemote = remoteCtx.get('remote');
        const sessionNavigator = {
            list: { getSnapshot: () => sessions.list.getSnapshot() },
            refresh: () => sessions.refresh(),
            open: sessionId => { sessions.open(sessionId); },
        };
        const controller = new TaskboardClientController(connection, mountedRemote.taskboard, sessionId => openTaskSession(sessionNavigator, sessionId), async (workspaceId, draft) => {
            const sessionId = await uiWorkspace.connectWorkspace(workspaceId);
            const scoped = sessions.scope(sessionId);
            if (scoped === undefined)
                throw new Error(`Unable to resolve the new Session ${sessionId}`);
            conversation.input.for(scoped).setDraft(draft);
            sessions.open(sessionId);
            return sessionId;
        });
        // Close the page when the user navigates to another Session: the shell's
        // session navigation is store-based (not hash-based), so it never clears
        // the Taskboard hash on its own.
        const sessionList = sessions.list;
        let previousSession = sessionList.getSnapshot().current;
        const offSessions = sessionList.subscribe(() => {
            const next = sessionList.getSnapshot().current;
            if (next !== previousSession) {
                previousSession = next;
                if (controller.getSnapshot().open)
                    controller.close();
            }
        });
        remoteCtx.effect(() => () => { controller.dispose(); offSessions(); }, 'taskboard client controller');
        const slots = remoteCtx.get('slots');
        const Nav = (props) => _jsx(TaskboardNavButton, { ...props, controller: controller });
        const Page = (props) => _jsx(TaskboardPage, { ...props, controller: controller, workspaces: workspaces });
        slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'taskboard.navigation' }, Nav));
        slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'taskboard.page' }, Page));
    });
    return async () => {
        unbindLocale();
        unregisterCopy();
        await unmountRemote();
    };
}
const STYLES = `
${NAV_STYLES}
.dsh-taskboard-page{position:absolute;top:0;bottom:0;z-index:1;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:14px/22px system-ui,sans-serif;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#d4d4d4);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#c4c4c4)}
.dsh-taskboard-page button,.dsh-taskboard-page input,.dsh-taskboard-page textarea,.dsh-taskboard-page select{font:inherit;color:inherit}.dsh-taskboard-page button{cursor:pointer}.dsh-taskboard-page button:disabled{cursor:not-allowed;opacity:.4}
.dsh-taskboard-page input,.dsh-taskboard-page textarea,.dsh-taskboard-page select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff)}.dsh-taskboard-page input,.dsh-taskboard-page select{height:34px;padding:0 12px}.dsh-taskboard-page textarea{padding:8px 12px;min-height:90px;resize:vertical;line-height:22px}.dsh-taskboard-page input:focus,.dsh-taskboard-page textarea:focus,.dsh-taskboard-page select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#0f1115)}.dsh-taskboard-page input::placeholder,.dsh-taskboard-page textarea::placeholder{color:var(--dsw-alias-label-dimmed,#e1e5ee)}
.dsh-taskboard-header{flex:none;min-height:54px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-brand{display:flex;gap:8px;align-items:center;margin-right:auto;font-size:16px;line-height:24px;font-weight:500}
.dsh-taskboard-header button,.dsh-taskboard-filters button,.dsh-taskboard-create button,.dsh-taskboard-gantt>header button,.dsh-taskboard-automation-menu button,.dsh-taskboard-popover>button,.dsh-taskboard-workflows>section>header button,.dsh-taskboard-labels>section>header button,.dsh-taskboard-workflow-create button,.dsh-taskboard-capabilities button,.dsh-taskboard-detail button,.dsh-taskboard-composer-actions button,.dsh-taskboard-actions button,.dsh-taskboard-reason button,.dsh-taskboard-confirm button,.dsh-taskboard-relation-create button{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:18px;background:transparent}.dsh-taskboard-header button.dsh-taskboard-icon-close{width:28px;height:28px;min-width:28px;min-height:28px;padding:0;border:0;border-radius:28px}.dsh-taskboard-header button:hover:not(:disabled),.dsh-taskboard-filters button:hover:not(:disabled),.dsh-taskboard-create button:hover:not(:disabled),.dsh-taskboard-gantt>header button:hover:not(:disabled),.dsh-taskboard-automation-menu button:hover:not(:disabled),.dsh-taskboard-popover>button:hover:not(:disabled),.dsh-taskboard-workflows>section>header button:hover:not(:disabled),.dsh-taskboard-labels>section>header button:hover:not(:disabled),.dsh-taskboard-workflow-create button:hover:not(:disabled),.dsh-taskboard-capabilities button:hover:not(:disabled),.dsh-taskboard-detail button:hover:not(:disabled),.dsh-taskboard-composer-actions button:hover:not(:disabled),.dsh-taskboard-actions button:hover:not(:disabled),.dsh-taskboard-reason button:hover:not(:disabled),.dsh-taskboard-confirm button:hover:not(:disabled),.dsh-taskboard-relation-create button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dsh-taskboard-header select,.dsh-taskboard-filters select,.dsh-taskboard-gantt>header select{height:36px;border-radius:18px}
.dsh-taskboard-filters{display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-filters input{flex:1;min-width:120px}
.dsh-taskboard-tabs{display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-tabs button{height:40px;padding:9px 16px 9px 12px;border:0;border-radius:12px;background:transparent}.dsh-taskboard-tabs button:hover{background:var(--dsw-specific-sidebar-nav-item-hover,#f1f3f5)}.dsh-taskboard-tabs button[aria-current=page]{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}
.dsh-taskboard-error{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 16px;background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05));color:var(--dsw-alias-state-error-primary,#ec1313)}.dsh-taskboard-error button{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:11px;background:transparent;color:inherit;cursor:pointer}.dsh-taskboard-error button:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.12))}.dsh-taskboard-notice{padding:8px 16px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7);color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-discard-dialog{width:min(400px,calc(100vw - 32px));padding:20px;border-radius:14px;background:var(--dsw-specific-menu,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.18))}.dsh-taskboard-discard-dialog h2{margin:0 0 8px;font-size:15px;font-weight:600}.dsh-taskboard-discard-dialog p{margin:0 0 16px;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-discard-dialog div{display:flex;justify-content:flex-end;gap:8px}.dsh-taskboard-discard-dialog button{min-height:34px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:17px;background:transparent;font:inherit;cursor:pointer}.dsh-taskboard-discard-dialog button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}.dsh-taskboard-attachment-row>div{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.dsh-taskboard-attachment-row img{display:block;max-width:100%;max-height:320px;margin-top:8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04));border-radius:8px}.dsh-taskboard-loading,.dsh-taskboard-empty{padding:32px;text-align:center;color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-content{display:flex;flex:1;min-height:0}.dsh-taskboard-view{flex:1;min-width:0;overflow:auto;padding:16px 24px 24px}
.dsh-taskboard-create{display:flex;gap:8px;margin-bottom:16px}.dsh-taskboard-create input{flex:1}
.dsh-taskboard-dashboard{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px}.dsh-taskboard-dashboard div{display:flex;flex-direction:column;padding:20px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff)}.dsh-taskboard-dashboard strong{font-size:30px;line-height:38px;font-weight:500}.dsh-taskboard-dashboard span{color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,1fr);gap:12px;overflow-x:auto;overscroll-behavior-x:contain;align-items:start}.dsh-taskboard-board section,.dsh-taskboard-other{min-width:0;padding:12px;border-radius:12px;background:var(--dsw-specific-sidebar-fill,#f9fafb)}.dsh-taskboard-board h2,.dsh-taskboard-other h2{display:flex;align-items:center;gap:8px;font-size:14px;line-height:22px;font-weight:500;margin:0 0 10px}.dsh-taskboard-board h2 small,.dsh-taskboard-other h2 small{margin-left:auto;color:var(--dsw-alias-label-tertiary,#81858c);font-weight:400}
.dsh-taskboard-status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;color:var(--dsw-alias-label-tertiary,#81858c)}.dsh-taskboard-status-dot[data-status=todo],.dsh-taskboard-status-dot[data-status=done]{color:var(--dsw-alias-state-success-primary,#22c55e)}.dsh-taskboard-status-dot[data-status=in_progress]{color:var(--dsw-alias-state-warn-primary,#f59e0b)}.dsh-taskboard-status-dot[data-status=in_review]{color:var(--dsw-alias-state-business-primary,#4176e6)}.dsh-taskboard-status-dot[data-status=blocked]{color:var(--dsw-alias-state-error-primary,#ec1313)}.dsh-taskboard-status-dot[data-status=canceled]{color:var(--dsw-alias-label-caption,#adb2b8)}.dsh-taskboard-status-dot[data-status=backlog]{color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-taskboard-card{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-bottom:8px;padding:12px 14px;text-align:left;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);min-height:0}.dsh-taskboard-card:hover{border-color:var(--dsw-alias-label-dimmed,#e1e5ee);background:var(--dsw-alias-bg-layer-2,#fff)}.dsh-taskboard-card strong{font-weight:500}.dsh-taskboard-card small,.dsh-taskboard-card span{color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-more{width:100%;display:flex;align-items:center;justify-content:center;gap:4px;min-height:32px;margin-top:4px;padding:6px 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-tertiary,#81858c)}.dsh-taskboard-more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-more-label{font-size:12px;line-height:18px}.dsh-taskboard-other{margin-top:14px}.dsh-taskboard-other .dsh-taskboard-card{display:inline-flex;width:min(280px,100%);margin-right:8px}
.dsh-taskboard-table-wrap{overflow:auto}.dsh-taskboard-table-wrap table{width:100%;border-collapse:collapse}.dsh-taskboard-table-wrap th,.dsh-taskboard-table-wrap td{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04));text-align:left}.dsh-taskboard-row-open{padding:0;border:0;background:transparent;color:var(--dsw-alias-link,#2563eb);font:inherit;text-align:left;cursor:pointer}.dsh-taskboard-row-open:hover{text-decoration:underline}.dsh-taskboard-table-wrap tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}.dsh-taskboard-table-wrap th button{border:0;background:transparent;font-weight:500;min-height:0;padding:0;border-radius:0}
.dsh-taskboard-gantt{display:flex;flex-direction:column;gap:8px}.dsh-taskboard-gantt>header{display:flex;align-items:center;gap:10px}.dsh-taskboard-gantt>header label{display:flex;align-items:center;gap:5px}.dsh-taskboard-gantt-rows{position:relative;display:flex;flex-direction:column}.dsh-taskboard-gantt-rows>button{display:grid;grid-template-columns:220px 1fr minmax(180px,auto);gap:12px;align-items:center;text-align:left;border:0;background:transparent;min-height:0;padding:8px 0;border-radius:0}.dsh-taskboard-gantt-rows>button:hover{background:transparent}.dsh-taskboard-gantt-track{position:relative;display:block;height:16px;border-radius:8px;background:var(--dsw-specific-sidebar-fill,#f9fafb);overflow:hidden}.dsh-taskboard-gantt-track i{position:absolute;top:2px;display:block;height:12px;border-radius:6px;background:var(--dsw-alias-state-business-primary,#4176e6)}.dsh-taskboard-today{position:absolute;top:0;bottom:0;width:1px;background:var(--dsw-alias-state-error-primary,#ec1313);opacity:.45;pointer-events:none}.dsh-taskboard-gantt small{color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-dialog-backdrop{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:var(--dsw-mask-blur,blur(2px))}
.dsh-taskboard-detail{width:min(1120px,100%);height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;padding:0;border:1px solid var(--dsw-alias-border-inverted,transparent);border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08));--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#d4d4d4);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#c4c4c4)}.dsh-taskboard-detail:focus{outline:none}
.dsh-taskboard-detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex:none;padding:20px 16px 12px 24px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-detail-heading{min-width:0;flex:1;display:flex;flex-direction:column;gap:8px}.dsh-taskboard-detail-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.dsh-taskboard-detail-path{font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-detail-meta small{color:var(--dsw-alias-label-tertiary,#81858c)}.dsh-taskboard-detail input.dsh-taskboard-detail-title{width:100%;height:auto;min-height:36px;padding:4px 0;border:0;border-radius:0;background:transparent;font-size:20px;line-height:28px;font-weight:500}.dsh-taskboard-detail input.dsh-taskboard-detail-title:focus{border:0;box-shadow:none;outline:none}.dsh-taskboard-detail-author{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-detail-author strong{color:var(--dsw-alias-label-primary,#0f1115);font-weight:500}.dsh-taskboard-detail-toolbar{display:flex;align-items:center;gap:8px;flex:none}
.dsh-taskboard-issue-badge,.dsh-taskboard-status-pill,.dsh-taskboard-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:12px;font-size:12px;line-height:18px;background:var(--dsw-alias-state-success-tertiary,#e6faed);color:var(--dsw-alias-state-success-primary,#22c55e)}.dsh-taskboard-issue-badge[data-closed=true]{background:var(--dsw-alias-button-ghost-active-fill,#ebeef2);color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-status-pill{background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-pill{background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-pill-row{display:flex;flex-wrap:wrap;gap:6px}.dsh-taskboard-avatar{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-button-ghost-active-fill,#ebeef2);color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;font-weight:500}.dsh-taskboard-muted{color:var(--dsw-alias-label-tertiary,#81858c);font-size:13px}
.dsh-taskboard-save{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border:0;border-radius:18px;background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:500}.dsh-taskboard-detail button.dsh-taskboard-save{border:0;background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}.dsh-taskboard-save svg{flex:none}.dsh-taskboard-save:hover:not(:disabled),.dsh-taskboard-detail button.dsh-taskboard-save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#43454a)}.dsh-taskboard-save[data-dirty=true]{box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-hover-accent,rgba(38,49,72,.14))}.dsh-taskboard-detail-close{width:28px;height:28px;min-height:28px;min-width:28px;padding:0;border:0;border-radius:28px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-detail button.dsh-taskboard-detail-close{width:28px;min-width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:28px}.dsh-taskboard-detail button.dsh-taskboard-detail-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dsh-taskboard-detail-columns{display:grid;grid-template-columns:minmax(0,1fr) 296px;flex:1;min-height:0}.dsh-taskboard-detail-main{overflow:hidden;padding:16px 24px 24px;display:flex;flex-direction:column;gap:16px}.dsh-taskboard-detail-main>.dsh-taskboard-body{flex:none;max-height:40%;overflow:auto}.dsh-taskboard-detail-feed{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px}.dsh-taskboard-detail-main>.dsh-taskboard-composer,.dsh-taskboard-detail-main>.dsh-taskboard-reason,.dsh-taskboard-detail-main>.dsh-taskboard-confirm{flex:none}.dsh-taskboard-detail-main>.dsh-taskboard-composer{max-height:42%;overflow:auto}.dsh-taskboard-detail-side{overflow:auto;padding:4px 16px 24px;border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}
.dsh-taskboard-body,.dsh-taskboard-composer{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);overflow:hidden}.dsh-taskboard-body-content{padding:16px 16px 8px;min-height:72px}.dsh-taskboard-body>footer,.dsh-taskboard-composer>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-composer h3{margin:0;padding:12px 14px 0;font-size:14px;line-height:22px;font-weight:500}.dsh-taskboard-composer-bar{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:4px 8px;padding:8px 8px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-composer-tabs{display:flex;gap:0}.dsh-taskboard-composer-tabs button{height:32px;min-height:32px;padding:0 12px;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-detail .dsh-taskboard-composer-tabs button{min-height:32px;border-radius:8px 8px 0 0}.dsh-taskboard-composer-tabs button[aria-current=page]{background:var(--dsw-alias-bg-layer-3,#fff);border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1));color:var(--dsw-alias-label-primary,#0f1115);margin-bottom:-1px}.dsh-taskboard-md-tools{display:flex;flex-wrap:wrap;gap:2px;padding:0 4px 6px}.dsh-taskboard-detail .dsh-taskboard-md-tools button{width:auto;min-width:28px;height:28px;min-height:28px;padding:0 6px;border:0;border-radius:6px;background:transparent;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-detail .dsh-taskboard-md-tools button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-composer textarea,.dsh-taskboard-body textarea,.dsh-taskboard-composer-preview{margin:0;border:0;border-radius:0;min-height:120px;background:transparent}.dsh-taskboard-composer textarea:focus,.dsh-taskboard-body textarea:focus{border:0}.dsh-taskboard-composer-preview{padding:12px 14px}.dsh-taskboard-composer>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-composer-actions{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}.dsh-taskboard-file-label{position:relative;display:inline-flex;align-items:center;gap:6px;margin:0;color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;cursor:pointer}.dsh-taskboard-file-label input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.dsh-taskboard-timeline{list-style:none;margin:0;padding:0 0 0 14px;display:flex;flex-direction:column;gap:14px;border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-timeline-comment,.dsh-taskboard-timeline-event{position:relative;display:flex;gap:10px;padding-left:18px}.dsh-taskboard-timeline-comment .dsh-taskboard-avatar,.dsh-taskboard-timeline-mark{position:absolute;left:-15px;top:0}.dsh-taskboard-timeline-mark{width:10px;height:10px;margin-top:6px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3,rgba(0,0,0,.12))}.dsh-taskboard-timeline-comment article{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff)}.dsh-taskboard-timeline-comment article>header{display:flex;align-items:center;gap:8px;margin-bottom:6px;justify-content:space-between;flex-wrap:wrap}.dsh-taskboard-comment-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap}.dsh-taskboard-detail .dsh-taskboard-comment-actions button:not(.dsh-taskboard-link){min-height:28px;height:28px;padding:0 10px;border-radius:14px;font-size:12px}.dsh-taskboard-timeline-comment article>footer{display:flex;gap:8px;margin-top:8px}.dsh-taskboard-timeline-event p{margin:0;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-timeline-event small,.dsh-taskboard-timeline-comment small{margin-left:8px;color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-taskboard-actions{display:flex;flex-wrap:wrap;gap:6px;margin:0}.dsh-taskboard-link{border:0;background:transparent;min-height:0;padding:0;border-radius:0;color:var(--dsw-alias-state-business-primary,#4176e6);text-align:left}.dsh-taskboard-detail button.dsh-taskboard-link{border:0;background:transparent;min-height:0;padding:0;border-radius:0;color:var(--dsw-alias-state-business-primary,#4176e6)}.dsh-taskboard-attachment-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-taskboard-attachment-row small{color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-taskboard-meta-field{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-meta-field>span{font-size:12px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-meta-field>div{display:flex;flex-direction:column;gap:6px}.dsh-taskboard-meta-project{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-meta-project h3{margin:0 0 4px;font-size:12px;line-height:16px;font-weight:500}.dsh-taskboard-meta-project>p{margin:0 0 8px;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-meta-nested{padding:8px 0;border-bottom:0}.dsh-taskboard-meta-nested+.dsh-taskboard-meta-nested{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-detail-side input,.dsh-taskboard-detail-side select{height:32px;border-color:transparent;background:transparent;padding-left:8px}.dsh-taskboard-detail-side input:hover,.dsh-taskboard-detail-side select:hover,.dsh-taskboard-detail-side input:focus,.dsh-taskboard-detail-side select:focus{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,#fff)}.dsh-taskboard-detail-side .dsh-taskboard-actions{flex-direction:column;align-items:stretch;padding-top:12px}.dsh-taskboard-detail-side .dsh-taskboard-actions button{width:100%}.dsh-taskboard-side-item{display:flex;flex-direction:column;gap:4px;align-items:flex-start}.dsh-taskboard-side-item small{color:var(--dsw-alias-label-tertiary,#81858c);overflow-wrap:anywhere}
.dsh-taskboard-automation-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:12;display:flex;flex-direction:column;gap:8px;width:min(520px,calc(100vw - 32px));max-height:min(70vh,640px);overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-inverted,transparent);border-radius:12px;background:var(--dsw-specific-menu,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08))}.dsh-taskboard-automation-menu>header{display:flex;align-items:center;justify-content:space-between;gap:12px}.dsh-taskboard-popover-actions{display:flex;align-items:center;gap:6px}.dsh-taskboard-automation-menu button.dsh-taskboard-popover-close{width:28px;height:28px;min-width:28px;min-height:28px;padding:0;border:0;border-radius:28px}.dsh-taskboard-automation-menu h2{margin:0;font-size:14px;line-height:22px;font-weight:500}.dsh-taskboard-automation-menu article{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-automation-menu article>div{display:flex;flex:1;flex-direction:column}.dsh-taskboard-automation-menu article>div:last-of-type{display:flex;flex:0 0 auto;flex-direction:row;gap:6px}.dsh-taskboard-automation-menu article small,.dsh-taskboard-automation-menu article span,.dsh-taskboard-automation-menu>p{color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-log{display:flex;flex-direction:column;gap:6px;margin-top:18px;padding:14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px}.dsh-taskboard-log header{display:flex;align-items:center;justify-content:space-between}.dsh-taskboard-log h2{margin:0;font-size:16px;line-height:24px;font-weight:500}.dsh-taskboard-log>p{margin:0;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-log ol,.dsh-taskboard-log-dialog ol{list-style:none;margin:0;padding:0}.dsh-taskboard-log li,.dsh-taskboard-log-dialog li{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-log li:first-child,.dsh-taskboard-log-dialog li:first-child{border-top:0}.dsh-taskboard-log time,.dsh-taskboard-log-dialog time{color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;line-height:18px}.dsh-taskboard-log span,.dsh-taskboard-log-dialog span{color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-log li[data-kind=claimed] span,.dsh-taskboard-log-dialog li[data-kind=claimed] span{color:var(--dsw-alias-state-success-primary,#22c55e)}.dsh-taskboard-log li[data-kind=error] span,.dsh-taskboard-log li[data-kind=quota-paused] span,.dsh-taskboard-log-dialog li[data-kind=error] span,.dsh-taskboard-log-dialog li[data-kind=quota-paused] span{color:var(--dsw-alias-state-error-primary,#ec1313)}.dsh-taskboard-log-dialog{width:min(720px,100%);max-height:min(80vh,720px);display:flex;flex-direction:column;overflow:hidden;border-radius:16px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08))}.dsh-taskboard-log-dialog header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:16px 16px 12px 20px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-log-dialog h2{margin:0;font-size:16px;line-height:24px;font-weight:500}.dsh-taskboard-log-dialog ol{overflow:auto;padding:0 20px 16px}.dsh-taskboard-log-dialog>p{margin:0;padding:16px 20px;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-log header .dsh-taskboard-link{min-height:0;padding:0}.dsh-taskboard-log-dialog button.dsh-taskboard-detail-close{width:28px;min-width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:28px}
.dsh-taskboard-storage{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px;padding:12px;border:1px solid var(--dsw-alias-state-success-primary,#22c55e);border-radius:12px;background:var(--dsw-alias-state-success-tertiary,#e6faed)}.dsh-taskboard-storage[data-status=degraded]{border-color:var(--dsw-alias-state-warn-primary,#f59e0b);background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}.dsh-taskboard-storage header{display:flex;flex:1 0 100%;align-items:center;justify-content:space-between}.dsh-taskboard-storage-actions{display:flex;align-items:center;gap:10px}.dsh-taskboard-storage-actions button{min-height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:14px;background:transparent;font:inherit;cursor:pointer}.dsh-taskboard-storage-actions button:disabled{opacity:.5;cursor:default}.dsh-taskboard-storage h2{margin:0;font-size:14px;font-weight:500}.dsh-taskboard-storage span{color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-workflows,.dsh-taskboard-labels{display:grid;grid-template-columns:190px 1fr;min-height:420px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;overflow:hidden}.dsh-taskboard-workflows>aside,.dsh-taskboard-labels>aside{display:flex;flex-direction:column;gap:6px;padding:10px;background:var(--dsw-specific-sidebar-fill,#f9fafb)}.dsh-taskboard-workflows>aside button,.dsh-taskboard-labels>aside button{display:flex;justify-content:space-between;padding:9px 12px;border:1px solid transparent;border-radius:12px;background:transparent;text-align:left;min-height:40px}.dsh-taskboard-workflows>aside button.active,.dsh-taskboard-labels>aside button.active{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}.dsh-taskboard-workflows>section,.dsh-taskboard-labels>section{padding:14px;overflow:auto}.dsh-taskboard-workflows>section>header,.dsh-taskboard-labels>section>header{display:flex;gap:8px;position:relative;flex-wrap:wrap}.dsh-taskboard-workflows>section>header input,.dsh-taskboard-labels>section>header input{flex:1;min-width:120px}.dsh-taskboard-labels>section h2{margin:0;font-size:16px;line-height:24px;font-weight:500}.dsh-taskboard-workflow-tabs{display:flex;gap:20px;padding:20px 0}.dsh-taskboard-workflow-tabs>article{min-width:240px}.dsh-taskboard-workflow-tabs>article>header{display:flex;align-items:center;justify-content:space-between}.dsh-taskboard-workflow-node{margin:8px 0;padding:11px;border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b);border-radius:12px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}.dsh-taskboard-workflow-node[data-execution=executable]{border-color:var(--dsw-alias-state-success-primary,#22c55e);background:var(--dsw-alias-state-success-tertiary,#e6faed)}.dsh-taskboard-workflow-node>small{display:block;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-flow-line{height:20px;margin-left:28px;border-left:2px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12))}.dsh-taskboard-branches{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.dsh-taskboard-workflows footer{display:flex;flex-wrap:wrap;gap:5px}.dsh-taskboard-workflows footer span{padding:3px 6px;border-radius:12px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7);font-size:11px}.dsh-taskboard-workflows footer span[data-execution=executable]{background:var(--dsw-alias-state-success-tertiary,#e6faed)}
.dsh-taskboard-workflow-node-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}.dsh-taskboard-workflow-node-actions button{padding:2px 8px;min-height:22px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:11px;background:transparent;font-size:11px}
.dsh-taskboard-capabilities{margin-top:14px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-capabilities h3{margin:0 0 5px;font-weight:500}.dsh-taskboard-capabilities>div{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.dsh-taskboard-markdown{overflow-wrap:anywhere}.dsh-taskboard-markdown h1,.dsh-taskboard-markdown h2,.dsh-taskboard-markdown h3,.dsh-taskboard-markdown h4{margin:16px 0 8px;font-weight:600;line-height:1.35}.dsh-taskboard-markdown h1:first-child,.dsh-taskboard-markdown h2:first-child,.dsh-taskboard-markdown h3:first-child,.dsh-taskboard-markdown h4:first-child{margin-top:0}.dsh-taskboard-markdown h1{font-size:22px;line-height:30px}.dsh-taskboard-markdown h2{font-size:18px;line-height:26px}.dsh-taskboard-markdown h3{font-size:16px;line-height:24px}.dsh-taskboard-markdown h4{font-size:14px;line-height:22px}.dsh-taskboard-markdown p{margin:0 0 8px;white-space:pre-wrap}.dsh-taskboard-markdown p:last-child{margin-bottom:0}.dsh-taskboard-markdown ul,.dsh-taskboard-markdown ol{margin:0 0 8px;padding-left:1.4em}.dsh-taskboard-markdown li{margin:2px 0;white-space:pre-wrap}.dsh-taskboard-markdown blockquote{margin:0 0 8px;padding:0 12px;border-left:3px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-markdown a{color:var(--dsw-alias-state-business-primary,#4176e6)}.dsh-taskboard-markdown img{display:block;max-width:100%;height:auto;margin:8px 0;border-radius:8px}.dsh-taskboard-markdown code{padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-code-block,#f9fafb);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.dsh-taskboard-markdown pre{overflow:auto;padding:8px;border-radius:8px;background:var(--dsw-alias-markdown-code-block,#f9fafb)}.dsh-taskboard-markdown pre code{padding:0;background:transparent}.dsh-taskboard-markdown hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));margin:12px 0}
.dsh-taskboard-popover{position:relative}.dsh-taskboard-popover>form,.dsh-taskboard-confirm{position:absolute;top:calc(100% + 6px);right:0;z-index:12;display:flex;flex-direction:column;gap:8px;width:280px;padding:12px;border:1px solid var(--dsw-alias-border-inverted,transparent);border-radius:12px;background:var(--dsw-specific-menu,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08))}.dsh-taskboard-popover form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-popover form div,.dsh-taskboard-inline-form{display:flex;gap:7px}.dsh-taskboard-confirm{position:relative;top:auto;right:auto;width:auto;margin:8px 0}.dsh-taskboard-popover>.dsh-taskboard-confirm{position:absolute;top:calc(100% + 6px);right:0;z-index:12;width:280px;margin:0}.dsh-taskboard-reason{padding:12px;border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b);border-radius:12px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}.dsh-taskboard-reason label{display:flex;flex-direction:column;gap:6px}.dsh-taskboard-relation-create{display:grid;grid-template-columns:1fr;gap:6px}.dsh-taskboard-inline-form{align-items:end;padding:10px 0}.dsh-taskboard-inline-form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-workflow-create{display:flex;flex-direction:column;gap:5px}.dsh-taskboard-workflow-create input{min-width:0}
.dsh-taskboard-summary,.dsh-taskboard-due{display:flex;flex-direction:column;gap:6px;margin-top:14px;padding:14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px}.dsh-taskboard-summary h2,.dsh-taskboard-due h2{margin:0;font-size:16px;line-height:24px;font-weight:500}.dsh-taskboard-due button{display:flex;justify-content:space-between;gap:12px;padding:8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:0;background:transparent;text-align:left;min-height:0}.dsh-taskboard-automation-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;flex:1 0 100%;padding:10px 0}.dsh-taskboard-automation-form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-automation-form label:has(input[type="checkbox"]){flex-direction:row;align-items:center}
@media(max-width:900px){.dsh-taskboard-dashboard{grid-template-columns:repeat(2,1fr)}.dsh-taskboard-board{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:1fr;overflow-x:visible}.dsh-taskboard-dialog-backdrop{padding:12px}.dsh-taskboard-detail{height:min(100%,calc(100vh - 24px));border-radius:16px}.dsh-taskboard-detail-columns{grid-template-columns:1fr}.dsh-taskboard-detail-side{border-left:0;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-header{gap:5px}.dsh-taskboard-gantt button{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.dsh-taskboard-page *{scroll-behavior:auto!important;transition:none!important}}
`;
//# sourceMappingURL=index.js.map