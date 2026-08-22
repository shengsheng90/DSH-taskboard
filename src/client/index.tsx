import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react'
import type { ClientContext, ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  AutomationRule, AutomationRun, SavedWorkflow, TaskboardChangeWatchResult, TaskboardProject, TaskboardTask,
  TaskDetail as TaskDetailData, WorkflowDocument,
} from '../domain/index.js'
import { TASK_STATUSES } from '../domain/index.js'
import type { TaskboardSnapshot } from '../service/index.js'
import {
  addWorkflowTab, copyWorkflowNode, insertWorkflowNode, moveWorkflowNode, removeWorkflowNode, removeWorkflowTab,
} from '../workflow/index.js'
import { applyAutomationDefaults, BOARD_COLUMN_PAGE_SIZE, boardDropIntent, createdTaskId, descriptionComposerMode, humanQuickCreateRequest, isPreviewableAttachment, paginateBoardColumn, previewAutomationRuns, projectLabelCatalog, sortTaskList, TaskboardClientController, tasksForLabel, type TaskListSortKey } from './controller.js'
import { PopoverShell, useExclusivePopover } from './popover.js'
import { applyMarkdownEdit, parseMarkdown, type MarkdownBlock, type MarkdownEditAction, type MarkdownInline } from './markdown.js'
import {
  bindTaskboardLocale, currentTaskboardLanguage, formatAutomationLog, formatOpenedAt, interpolate, priorityLabel,
  subscribeTaskboardLocale, TASKBOARD_LOCALE_NS, taskboardLocales, taskboardStrings,
  type TaskboardCopy, type TaskboardLocaleRuntime,
} from './locales.js'
import taskboardRemote from '../../generated/typert.remote-client.js'

export { bindTaskboardLocale, taskboardStrings } from './locales.js'
export const inject = ['slots', 'connection', 'sessions', 'workspaces', 'conversation', 'remote', 'locale']

interface InjectedProps {
  controller: TaskboardClientController
}

interface PageInjectedProps extends InjectedProps {
  workspaces: IWorkspaces
}

interface TaskSessionNavigator {
  readonly list: { getSnapshot(): { readonly byId: Readonly<Record<string, unknown>> } }
  refresh(): Promise<void>
  open(sessionId: string): void
}

/** A disposed automation Agent becomes a persisted cold Session. Refresh the native list before
 *  selecting it: sessions.open intentionally rejects ids absent from the current list snapshot. */
export async function openTaskSession(navigator: TaskSessionNavigator, sessionId: string): Promise<void> {
  if (navigator.list.getSnapshot().byId[sessionId] === undefined) await navigator.refresh()
  if (navigator.list.getSnapshot().byId[sessionId] === undefined) {
    throw new Error(`Session ${sessionId} is unavailable`)
  }
  navigator.open(sessionId)
}

/** Narrow structural face used at the plugin boundary; the service is provided by dsh-client-ui-conversation. */
interface ConversationDraftPort {
  readonly input: { for(ctx: ClientContext): { setDraft(text: string): void } }
}

type NavProps = PropsRuntime<'sidebar.footer.action'> & InjectedProps
type PageProps = PropsRuntime<'shell.overlay'> & PageInjectedProps
type WorkspaceOption = IWorkspaces['list']['getSnapshot'] extends () => infer State
  ? State extends { items: readonly (infer Item)[] } ? Item : never
  : never

function useStrings(): TaskboardCopy {
  return taskboardStrings(useSyncExternalStore(subscribeTaskboardLocale, currentTaskboardLanguage, currentTaskboardLanguage))
}

/** Kanban glyph in the DSH filled-outline family (same optical weight as the settings gear). */
function TaskboardIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.2 1.05H12.8A2.15 2.15 0 0 1 14.95 3.2V12.8A2.15 2.15 0 0 1 12.8 14.95H3.2A2.15 2.15 0 0 1 1.05 12.8V3.2A2.15 2.15 0 0 1 3.2 1.05ZM3.2 2.37H12.8A0.83 0.83 0 0 1 13.63 3.2V12.8A0.83 0.83 0 0 1 12.8 13.63H3.2A0.83 0.83 0 0 1 2.37 12.8V3.2A0.83 0.83 0 0 1 3.2 2.37Z"
        fill="currentColor"
      />
      <path d="M4.56 3.52A0.64 0.64 0 0 1 5.2 4.16V11.84A0.64 0.64 0 0 1 4.56 12.48 0.64 0.64 0 0 1 3.92 11.84V4.16A0.64 0.64 0 0 1 4.56 3.52Z" fill="currentColor" />
      <path d="M8 3.52A0.64 0.64 0 0 1 8.64 4.16V7.18A0.64 0.64 0 0 1 8 7.82 0.64 0.64 0 0 1 7.36 7.18V4.16A0.64 0.64 0 0 1 8 3.52Z" fill="currentColor" />
      <path d="M11.44 3.52A0.64 0.64 0 0 1 12.08 4.16V9.33A0.64 0.64 0 0 1 11.44 9.97 0.64 0.64 0 0 1 10.8 9.33V4.16A0.64 0.64 0 0 1 11.44 3.52Z" fill="currentColor" />
    </svg>
  )
}

/** Filled floppy-disk glyph so the primary Save action stays recognizable at small sizes. */
function SaveIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2.2 2.35c0-.58.47-1.05 1.05-1.05h7.15L14 3.9v9.75c0 .58-.47 1.05-1.05 1.05H3.25c-.58 0-1.05-.47-1.05-1.05V2.35Zm2.2.7v3.45h6.05V3.05H4.4Zm1.2.9h1.35v1.7H5.6V3.95ZM3.7 9.2v3.55h8.6V9.2H3.7Z" />
    </svg>
  )
}

/** 14px stroke X matching the Harness settings/modal close glyph. */
function CloseIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Downward chevron used as the board-column lazy-load affordance. */
function MoreIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.2 6.2L8 11l4.8-4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function actorName(value: string): string {
  return value.split(/[:/]/).pop() || value
}

function actorInitial(value: string): string {
  return (actorName(value).trim().slice(0, 1) || '?').toUpperCase()
}

function isClosedStatus(status: TaskboardTask['status']): boolean {
  return status === 'done' || status === 'canceled'
}

/** Backoff before the change poll is retried, and the idle delay before a truncated project's
 *  search reaches SQLite. */
const WATCH_RETRY_MS = 2_000
const SEARCH_DEBOUNCE_MS = 250

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    function onAbort(): void { window.clearTimeout(timer); resolve() }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const MARKDOWN_TOOLBAR: readonly { action: MarkdownEditAction; label: 'mdHeading' | 'mdBold' | 'mdItalic' | 'mdQuote' | 'mdCode' | 'mdLink' | 'mdBullet' | 'mdNumber'; glyph: string }[] = [
  { action: 'heading', label: 'mdHeading', glyph: 'H' },
  { action: 'bold', label: 'mdBold', glyph: 'B' },
  { action: 'italic', label: 'mdItalic', glyph: 'I' },
  { action: 'quote', label: 'mdQuote', glyph: '“' },
  { action: 'code', label: 'mdCode', glyph: '</>' },
  { action: 'link', label: 'mdLink', glyph: '[]' },
  { action: 'ul', label: 'mdBullet', glyph: '•' },
  { action: 'ol', label: 'mdNumber', glyph: '1.' },
]

function ComposerTabs({ mode, onChange }: { mode: 'write' | 'preview'; onChange: (mode: 'write' | 'preview') => void }) {
  const t = useStrings()
  return (
    <div className="dsh-taskboard-composer-tabs">
      <button type="button" aria-current={mode === 'write' ? 'page' : undefined} onClick={() => { onChange('write') }}>{t.write}</button>
      <button type="button" aria-current={mode === 'preview' ? 'page' : undefined} onClick={() => { onChange('preview') }}>{t.preview}</button>
    </div>
  )
}

function MarkdownComposer({
  value, onChange, mode, onModeChange, placeholder, emptyPreview,
}: {
  value: string
  onChange: (value: string) => void
  mode: 'write' | 'preview'
  onModeChange: (mode: 'write' | 'preview') => void
  placeholder: string
  emptyPreview: ReactNode
}) {
  const t = useStrings()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const run = (action: MarkdownEditAction): void => {
    const field = textareaRef.current
    const next = applyMarkdownEdit(value, field?.selectionStart ?? value.length, field?.selectionEnd ?? value.length, action)
    onChange(next.value)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.selectionStart, next.selectionEnd)
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    const key = event.key.toLowerCase()
    const action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : key === 'e' ? 'code' : undefined
    if (action === undefined) return
    event.preventDefault()
    run(action)
  }
  return (
    <>
      <div className="dsh-taskboard-composer-bar">
        <ComposerTabs mode={mode} onChange={onModeChange} />
        {mode === 'write' && (
          <div className="dsh-taskboard-md-tools" role="toolbar" aria-label={t.markdownToolbar}>
            {MARKDOWN_TOOLBAR.map(item => (
              <button type="button" key={item.action} title={t[item.label]} aria-label={t[item.label]} onClick={() => { run(item.action) }}>{item.glyph}</button>
            ))}
          </div>
        )}
      </div>
      {mode === 'write'
        ? <textarea ref={textareaRef} value={value} placeholder={placeholder} onChange={event => { onChange(event.target.value) }} onKeyDown={onKeyDown} />
        : <div className="dsh-taskboard-composer-preview">{value.trim() === '' ? emptyPreview : <MarkdownText value={value} />}</div>}
    </>
  )
}

/** Attachment row with an inline preview for image types; other types stay download-only. */
function AttachmentRow({ attachment, download, preview, remove, showMeta = false }: {
  attachment: TaskDetailData['attachments'][number]
  download: (attachmentId: string, filename: string) => Promise<void>
  preview: (attachmentId: string) => Promise<string>
  remove: () => void
  showMeta?: boolean
}) {
  const t = useStrings()
  const [url, setUrl] = useState<string>()
  const previewable = isPreviewableAttachment(attachment.contentType)
  return (
    <article className="dsh-taskboard-attachment-row">
      <div>
        <button type="button" className="dsh-taskboard-link" onClick={() => { void download(attachment.id, attachment.filename) }}>{attachment.filename}</button>
        {showMeta && <small>{attachment.contentType} · {attachment.byteSize} {t.bytes}</small>}
        {previewable && <button type="button" className="dsh-taskboard-link" aria-expanded={url !== undefined} onClick={() => {
          if (url !== undefined) { setUrl(undefined); return }
          // Each ticket is single-use, so a fresh one is minted every time the preview reopens.
          void preview(attachment.id).then(setUrl)
        }}>{url === undefined ? t.showPreview : t.hidePreview}</button>}
        <button type="button" onClick={remove}>{t.delete}</button>
      </div>
      {url !== undefined && <img src={url} alt={attachment.filename} />}
    </article>
  )
}

function MetaField({ label, children, nested = false }: { label: string; children: ReactNode; nested?: boolean }) {
  return (
    <div className={nested ? 'dsh-taskboard-meta-field dsh-taskboard-meta-nested' : 'dsh-taskboard-meta-field'}>
      <span>{label}</span>
      <div>{children}</div>
    </div>
  )
}

/** Sidebar foot styles must live on the nav itself: the page style tag unmounts when the overlay is closed.
 *  Wide geometry matches Host Settings: 34px row, full column width, 12px radius, icon+label left-aligned.
 *  Pressed/hover fill is the only selected chrome; do not restore native button padding or grey inset. */
const NAV_STYLES = `
.dsh-taskboard-nav{-webkit-appearance:none;appearance:none;flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:none;border-radius:12px;background:transparent;box-shadow:none;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;font:inherit;font-size:14px;line-height:22px;overflow:hidden}.dsh-taskboard-nav:hover,.dsh-taskboard-nav[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}.dsh-taskboard-nav-rail{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}.dsh-taskboard-nav-label{overflow:hidden;white-space:nowrap}
`

export function TaskboardNavButton({ wide, controller }: NavProps) {
  const route = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const t = useStrings()
  return (
    <>
      <style>{NAV_STYLES}</style>
      <button type="button" className={wide ? 'dsh-taskboard-nav' : 'dsh-taskboard-nav dsh-taskboard-nav-rail'} aria-pressed={route.open} aria-label={t.taskboard} onClick={() => { route.open ? controller.close() : controller.open() }}>
        <TaskboardIcon size={wide ? 16 : 18} />{wide && <span className="dsh-taskboard-nav-label">{t.taskboard}</span>}
      </button>
    </>
  )
}

/** Resolve the sidebar/detail column widths so the page fills only the center column. */
function useFrameInsets(ref: RefObject<HTMLDivElement | null>, active: boolean): { left: number; right: number } {
  const [insets, setInsets] = useState({ left: 0, right: 0 })
  useEffect(() => {
    if (!active || ref.current === null) return
    // DOM: page → [data-slot] anchor (display:contents) → shell.overlay layer → grid frame.
    const frame = ref.current.parentElement?.parentElement?.parentElement
    if (frame === null || frame === undefined) return
    const measure = (): void => {
      const tracks = getComputedStyle(frame).gridTemplateColumns.split(' ')
      const left = Number.parseFloat(tracks[0] ?? '0')
      const right = Number.parseFloat(tracks[tracks.length - 1] ?? '0')
      setInsets({
        left: Number.isFinite(left) ? left : 0,
        right: Number.isFinite(right) ? right : 0,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => { observer.disconnect() }
  }, [active, ref])
  return insets
}

export function TaskboardPage({ controller, workspaces }: PageProps) {
  const route = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const workspaceState = useSyncExternalStore(
    workspaces.list.subscribe,
    workspaces.list.getSnapshot,
    workspaces.list.getSnapshot,
  )
  const root = useRef<HTMLDivElement>(null)
  const insets = useFrameInsets(root, route.open)
  const [snapshot, setSnapshot] = useState<TaskboardSnapshot>()
  const [detail, setDetail] = useState<TaskDetailData>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [query, setQuery] = useState('')
  /** Matches from SQLite for a project whose snapshot was truncated; the in-memory filter below
   *  can only ever see the rows the snapshot carried. */
  const [searchHits, setSearchHits] = useState<readonly TaskboardTask[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [logOpen, setLogOpen] = useState(false)
  const [undo, setUndo] = useState<{ endpoint: string; payload: Record<string, unknown> }>()
  /** Newest globalRevision already rendered; the change poll uses it to skip redundant refetches. */
  const loadedRevision = useRef(0)
  /** Serializes writes so a double-click cannot duplicate a task or race the expected version. */
  const inFlight = useRef(false)
  /** Set by the open task dialog; title/description/meta edits live in local state until Save. */
  const detailDirty = useRef(false)
  const [discardPrompt, setDiscardPrompt] = useState(false)
  const t = useStrings()

  // route.view is deliberately absent: every view renders the same snapshot, so switching tabs
  // must not refetch it.
  useEffect(() => {
    if (!route.open) return
    const abort = new AbortController()
    setBusy(true)
    controller.snapshot(route.projectId, abort.signal).then(next => {
      controller.recordSnapshotRevision(next.globalRevision)
      loadedRevision.current = next.globalRevision
      setSnapshot(next)
      setError(undefined)
      if (route.projectId === undefined && next.projects[0] !== undefined) controller.select(next.projects[0].id, route.view)
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (!abort.signal.aborted) setBusy(false) })
    return () => { abort.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, refreshKey, route.open, route.projectId])

  useEffect(() => {
    if (!route.open || route.taskId === undefined) { setDetail(undefined); return }
    const abort = new AbortController()
    controller.detail(route.taskId, abort.signal).then(value => {
      if (!abort.signal.aborted) setDetail(value)
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { abort.abort() }
  }, [controller, refreshKey, route.open, route.taskId])

  useEffect(() => {
    if (!route.open) return
    return controller.subscribeConnection(() => { setRefreshKey(value => value + 1) })
  }, [controller, route.open])

  useEffect(() => {
    if (!route.open || snapshot === undefined) return
    const timer = window.setInterval(() => { setRefreshKey(value => value + 1) }, snapshot.refreshIntervalMs)
    return () => { window.clearInterval(timer) }
  }, [route.open, snapshot?.refreshIntervalMs])

  useEffect(() => {
    if (!route.open || snapshot === undefined) return
    const abort = new AbortController()
    const watch = async (): Promise<void> => {
      let revision = snapshot.globalRevision
      while (!abort.signal.aborted) {
        let result: TaskboardChangeWatchResult
        try {
          result = await controller.watchChanges(revision, abort.signal)
        } catch (cause) {
          if (abort.signal.aborted) return
          setError(cause instanceof Error ? cause.message : String(cause))
          // Leaving the loop here left the page on the 15s periodic refetch until the revision
          // happened to move, which is exactly when it could not move on its own.
          await pause(WATCH_RETRY_MS, abort.signal)
          continue
        }
        if (abort.signal.aborted) return
        if (result.changed || result.globalRevision !== revision) {
          // A local mutation already refreshes on its own. Without this guard its committed
          // revision wakes the poll too and the same snapshot is fetched a second time.
          if (result.globalRevision > loadedRevision.current) setRefreshKey(value => value + 1)
          return
        }
        revision = result.globalRevision
      }
    }
    void watch()
    return () => { abort.abort() }
  }, [controller, route.open, snapshot?.globalRevision])

  // Only a truncated project needs SQLite: otherwise the snapshot already holds every task the
  // in-memory filter below could match.
  useEffect(() => {
    const needle = query.trim()
    const projectId = route.projectId
    if (!route.open || snapshot?.tasksTruncated !== true || needle === '' || projectId === undefined) {
      setSearchHits([])
      return
    }
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      controller.searchTasks(projectId, needle, abort.signal).then(hits => {
        if (!abort.signal.aborted) setSearchHits(hits)
      }, () => { /* the local filter still answers for everything the snapshot holds */ })
    }, SEARCH_DEBOUNCE_MS)
    return () => { abort.abort(); window.clearTimeout(timer) }
  }, [controller, query, route.open, route.projectId, snapshot?.tasksTruncated, refreshKey])

  useEffect(() => {
    if (!route.open) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (discardPrompt) {
        event.preventDefault()
        setDiscardPrompt(false)
        return
      }
      if (logOpen) {
        event.preventDefault()
        setLogOpen(false)
        return
      }
      if (route.taskId !== undefined) {
        event.preventDefault()
        // Escape used to discard unsaved title/description edits without a word.
        if (detailDirty.current) setDiscardPrompt(true)
        else controller.select(route.projectId, route.view)
        return
      }
      controller.close()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [controller, discardPrompt, logOpen, route.open, route.projectId, route.taskId, route.view])

  if (!route.open) return null
  const selected = snapshot?.projects.find(project => project.id === route.projectId) ?? snapshot?.projects[0]
  const tasks = snapshot?.tasks ?? []
  const searchable = searchHits.length === 0
    ? tasks
    : [...tasks, ...searchHits.filter(hit => !tasks.some(task => task.id === hit.id))]
  const visibleTasks = searchable.filter(task => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false
    const needle = query.trim().toLocaleLowerCase()
    return needle === ''
      || `${task.identifier} ${task.title} ${task.description} ${task.labels.join(' ')}`.toLocaleLowerCase().includes(needle)
  })
  // A deep link can name a task the snapshot never carried. The detail fetch is keyed on
  // route.taskId alone, so open the dialog on whichever of the two resolved it.
  const selectedTask = tasks.find(task => task.id === route.taskId)
    ?? (detail !== undefined && detail.task.id === route.taskId ? detail.task : undefined)
  const refresh = (): void => { setRefreshKey(value => value + 1) }
  const closeDetail = (): void => {
    detailDirty.current = false
    setDiscardPrompt(false)
    controller.select(selected?.id, route.view)
  }
  /** Every path that closes the task dialog goes through here so unsaved edits are never dropped. */
  const requestCloseDetail = (): void => {
    if (detailDirty.current) setDiscardPrompt(true)
    else closeDetail()
  }
  const mutate = async (endpoint: string, payload: Record<string, unknown>): Promise<unknown> => {
    // One in-flight write at a time. Without this a double-click either creates a duplicate task
    // (task.create carries no expected version) or fails the second attempt on a stale version.
    if (inFlight.current) return undefined
    inFlight.current = true
    setBusy(true)
    try {
      const prior = endpoint === 'task.update' && typeof payload['taskId'] === 'string'
        ? tasks.find(task => task.id === payload['taskId'])
        : undefined
      const request = payload['request'] as Record<string, unknown> | undefined
      const value = await controller.mutate(endpoint, payload)
      if (prior !== undefined && request !== undefined && typeof value === 'object' && value !== null && 'version' in value) {
        const inverse: Record<string, unknown> = {}
        for (const key of Object.keys(request)) inverse[key] = (prior as unknown as Record<string, unknown>)[key] ?? null
        setUndo({ endpoint: 'task.update', payload: { taskId: prior.id, expectedVersion: Number((value as { version: unknown }).version), request: inverse } })
      } else if ((endpoint === 'task.archive' || endpoint === 'task.restore') && typeof value === 'object' && value !== null && 'version' in value && typeof payload['taskId'] === 'string') {
        setUndo({
          endpoint: endpoint === 'task.archive' ? 'task.restore' : 'task.archive',
          payload: { taskId: payload['taskId'], expectedVersion: Number((value as { version: unknown }).version) },
        })
      }
      if (endpoint === 'task.create' && createdTaskId(value) !== undefined) {
        const created = value as TaskboardTask
        setSnapshot(prev => {
          if (prev === undefined || prev.tasks.some(task => task.id === created.id)) return prev
          return { ...prev, tasks: [created, ...prev.tasks] }
        })
      }
      setError(undefined); refresh()
      return value
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      if (message.includes('TASK_STALE_VERSION')) refresh()
      return undefined
    }
    finally { inFlight.current = false; setBusy(false) }
  }
  const performUndo = async (): Promise<void> => {
    if (undo === undefined || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      // Re-read the version at click time: any write since the undo was recorded moved it on, and
      // replaying the captured one only produced a stale-version error.
      const current = tasks.find(task => task.id === undo.payload['taskId'])
      const payload = current === undefined ? undo.payload : { ...undo.payload, expectedVersion: current.version }
      await controller.mutate(undo.endpoint, payload)
      setUndo(undefined); setError(undefined); refresh()
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { inFlight.current = false; setBusy(false) }
  }

  return (
    <div ref={root} className="dsh-taskboard-page" style={{ left: insets.left, right: insets.right }} role="main" aria-label={t.taskboard}>
      <style>{STYLES}</style>
      <header className="dsh-taskboard-header">
        <div className="dsh-taskboard-brand"><TaskboardIcon size={16} /><strong>{t.taskboard}</strong></div>
        <select aria-label={t.project} value={selected?.id ?? ''} onChange={event => { controller.select(event.target.value || undefined, route.view) }}>
          {snapshot?.projects.map(project => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
        </select>
        <ProjectCreate controller={controller} refresh={refresh} workspaces={workspaceState.items} />
        {selected !== undefined && <ProjectActions project={selected} controller={controller} refresh={refresh} workspaces={workspaceState.items} />}
        <button type="button" onClick={refresh}>{t.refresh}</button>
        {selected !== undefined && <AutomationActions project={selected} automations={snapshot?.automations ?? []} defaults={snapshot?.automationDefaults} mutate={mutate} />}
        <button type="button" className="dsh-taskboard-icon-close" aria-label={t.close} onClick={() => { controller.close() }}><CloseIcon size={14} /></button>
      </header>
      <div className="dsh-taskboard-filters">
        <input aria-label={t.search} placeholder={t.search} value={query} onChange={event => { setQuery(event.target.value) }} />
        <select aria-label={t.allStatuses} value={statusFilter} onChange={event => { setStatusFilter(event.target.value) }}>
          <option value="all">{t.allStatuses}</option>
          {(['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'] as const).map(status => <option key={status} value={status}>{t[status]}</option>)}
        </select>
        <button type="button" disabled={undo === undefined || busy} onClick={() => { void performUndo() }}>{t.undo}</button>
      </div>
      <nav className="dsh-taskboard-tabs" aria-label={t.taskboard}>
        {(['dashboard', 'board', 'list', 'labels', 'gantt', 'workflows'] as const).map(view => (
          <button key={view} type="button" aria-current={route.view === view ? 'page' : undefined} onClick={() => { controller.select(selected?.id, view) }}>{t[view]}</button>
        ))}
      </nav>
      {error !== undefined && <div className="dsh-taskboard-error" role="alert"><span>{error}</span><button type="button" aria-label={t.dismiss} onClick={() => { setError(undefined) }}><CloseIcon size={12} /></button></div>}
      {snapshot?.tasksTruncated === true && <div className="dsh-taskboard-notice" role="status">{interpolate(t.tasksTruncated, { shown: snapshot.tasks.length, total: snapshot.taskTotal })}</div>}
      {busy && snapshot === undefined
        ? <div className="dsh-taskboard-loading">{t.loading}</div>
        : <div className="dsh-taskboard-content">
          <main className="dsh-taskboard-view">
            {selected === undefined
              ? <div className="dsh-taskboard-empty"><p>{t.noProject}</p><ProjectCreate controller={controller} refresh={refresh} workspaces={workspaceState.items} /></div>
              : <>
                <TaskCreate project={selected} mutate={mutate} onCreated={taskId => { controller.select(selected.id, route.view, taskId) }} />
                {route.view === 'dashboard' && <Dashboard tasks={visibleTasks} runs={snapshot?.automationRuns ?? []} project={selected} storage={snapshot?.storageHealth} open={task => { controller.select(selected?.id, route.view, task.id) }} openLog={() => { setLogOpen(true) }} mutate={mutate} />}
                {route.view === 'board' && <Board key={selected?.id ?? 'none'} tasks={visibleTasks} open={task => { controller.select(selected?.id, route.view, task.id) }} mutate={mutate} />}
                {route.view === 'list' && <ListView tasks={visibleTasks} open={task => { controller.select(selected?.id, route.view, task.id) }} />}
                {route.view === 'labels' && <LabelsView project={selected} tasks={visibleTasks} open={task => { controller.select(selected?.id, route.view, task.id) }} mutate={mutate} />}
                {route.view === 'gantt' && <Gantt tasks={visibleTasks} open={task => { controller.select(selected?.id, route.view, task.id) }} />}
                {route.view === 'workflows' && <WorkflowEditor project={selected} workflows={snapshot?.workflows ?? []} catalog={snapshot?.workflowCatalog ?? []} capabilities={snapshot?.workflowCapabilities} mutate={mutate} />}
              </>}
          </main>
        </div>}
      {logOpen && <AutomationLogDialog runs={snapshot?.automationRuns ?? []} tasks={tasks} close={() => { setLogOpen(false) }} />}
      {discardPrompt && <div className="dsh-taskboard-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) setDiscardPrompt(false) }}>
        <div className="dsh-taskboard-discard-dialog" role="alertdialog" aria-modal="true" aria-label={t.unsavedChanges}>
          <h2>{t.unsavedChanges}</h2>
          <p>{t.unsavedBody}</p>
          <div>
            <button type="button" autoFocus onClick={() => { setDiscardPrompt(false) }}>{t.keepEditing}</button>
            <button type="button" onClick={closeDetail}>{t.discardChanges}</button>
          </div>
        </div>
      </div>}
      {selectedTask !== undefined && <TaskDetail key={selectedTask.id} project={selected} task={selectedTask} tasks={tasks} workflows={snapshot?.workflows ?? []} detail={detail} mutate={mutate} upload={async (file, commentId) => { setBusy(true); try { await controller.uploadAttachment(selectedTask.id, detail?.task.version ?? selectedTask.version, file, commentId); refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }} download={(id, filename) => controller.downloadAttachment(id, filename)} preview={id => controller.previewAttachmentUrl(id)} openSession={async sessionId => { setBusy(true); try { await controller.openSession(sessionId) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }} openNewSession={async () => { if (selected?.workspaceId === undefined || detail === undefined) return; setBusy(true); try { await controller.openNewSession(selected.workspaceId, detail) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }} close={requestCloseDetail} onDirtyChange={value => { detailDirty.current = value }} />}
    </div>
  )
}

function ProjectCreate({ controller, refresh, workspaces }: {
  controller: TaskboardClientController
  refresh: () => void
  workspaces: readonly WorkspaceOption[]
}) {
  const t = useStrings()
  const popover = useExclusivePopover()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [labels, setLabels] = useState('')
  const close = (): void => { popover.setOpen(false) }
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || key.trim() === '') return
    const project = await controller.mutate('project.create', {
      request: {
        key: key.trim(), name: name.trim(),
        ...(workspaceId.trim() === '' ? {} : { workspaceId: workspaceId.trim() }),
        labels: labels.split(',').map(value => value.trim()).filter(Boolean),
      },
    }) as TaskboardProject
    close(); setName(''); setKey(''); setWorkspaceId(''); setLabels('')
    controller.select(project.id, 'board')
    refresh()
  }
  return (
    <PopoverShell open={popover.open} onToggle={popover.toggle} onDismiss={close} label={`＋ ${t.addProject}`}>
      <form onSubmit={event => { void create(event) }}>
        <label>{t.projectName}<input autoFocus value={name} onChange={event => { const value = event.target.value; setName(value); if (key === '') setKey(value.replaceAll(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()) }} /></label>
        <label>{t.projectKey}<input value={key} onChange={event => { setKey(event.target.value.toUpperCase()) }} /></label>
        <label>{t.workspaceId}<select value={workspaceId} onChange={event => { setWorkspaceId(event.target.value) }}><option value="">{t.blankGlobal}</option>{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title} · {item.path}</option>)}</select></label>
        <label>{t.labels}<input value={labels} onChange={event => { setLabels(event.target.value) }} placeholder="local, release" /></label>
        <div>
          <button type="submit" disabled={name.trim() === '' || key.trim() === ''}>{t.create}</button>
          <button type="button" onClick={close}>{t.cancel}</button>
        </div>
      </form>
    </PopoverShell>
  )
}

function ProjectActions({ project, controller, refresh, workspaces }: {
  project: TaskboardProject
  controller: TaskboardClientController
  refresh: () => void
  workspaces: readonly WorkspaceOption[]
}) {
  const t = useStrings()
  const editPopover = useExclusivePopover()
  const deletePopover = useExclusivePopover()
  const [name, setName] = useState(project.name)
  const [workspace, setWorkspace] = useState(project.workspaceId ?? '')
  const [labels, setLabels] = useState(project.labels.join(', '))
  useEffect(() => { setName(project.name); setWorkspace(project.workspaceId ?? ''); setLabels(project.labels.join(', ')) }, [project])
  const edit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '') return
    await controller.mutate('project.update', {
      projectId: project.id,
      expectedVersion: project.version,
      request: { name: name.trim(), workspaceId: workspace.trim() || null, labels: labels.split(',').map(value => value.trim()).filter(Boolean) },
    })
    editPopover.setOpen(false)
    refresh()
  }
  const remove = async (): Promise<void> => {
    await controller.mutate('project.delete', { projectId: project.id, expectedVersion: project.version })
    deletePopover.setOpen(false)
    controller.select(undefined, 'dashboard')
    refresh()
  }
  return (
    <>
      <PopoverShell open={editPopover.open} onToggle={editPopover.toggle} onDismiss={() => { editPopover.setOpen(false) }} label={t.editProject}>
        <form onSubmit={event => { void edit(event) }}>
          <label>{t.projectName}<input autoFocus value={name} onChange={event => { setName(event.target.value) }} /></label>
          <label>{t.workspaceId}<select value={workspace} onChange={event => { setWorkspace(event.target.value) }}><option value="">{t.blankGlobal}</option>{project.workspaceId !== undefined && !workspaces.some(item => item.workspaceId === project.workspaceId) && <option value={project.workspaceId}>{project.workspaceId}</option>}{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title} · {item.path}</option>)}</select></label>
          <label>{t.labels}<input value={labels} onChange={event => { setLabels(event.target.value) }} /></label>
          <div>
            <button type="submit">{t.save}</button>
            <button type="button" onClick={() => { editPopover.setOpen(false) }}>{t.cancel}</button>
          </div>
        </form>
      </PopoverShell>
      <PopoverShell open={deletePopover.open} onToggle={deletePopover.toggle} onDismiss={() => { deletePopover.setOpen(false) }} label={t.deleteProject}>
        <div className="dsh-taskboard-confirm" role="alert">
          <span>{t.deleteProject}: {project.key} · {project.name}?</span>
          <button type="button" onClick={() => { void remove() }}>{t.deleteProject}</button>
          <button type="button" onClick={() => { deletePopover.setOpen(false) }}>{t.cancel}</button>
        </div>
      </PopoverShell>
    </>
  )
}

function TaskCreate({ project, mutate, onCreated }: {
  project: TaskboardProject | undefined
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>
  onCreated: (taskId: string) => void
}) {
  const [title, setTitle] = useState('')
  const t = useStrings()
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (project === undefined || title.trim() === '') return
    void mutate('task.create', { request: humanQuickCreateRequest(project.id, title) }).then(value => {
      const taskId = createdTaskId(value)
      if (taskId === undefined) return
      setTitle('')
      onCreated(taskId)
    })
  }
  return <form className="dsh-taskboard-create" onSubmit={submit}><input value={title} onChange={event => { setTitle(event.target.value) }} placeholder={t.newTask} aria-label={t.title} /><button type="submit" disabled={project === undefined}>{t.create}</button></form>
}

/** The integrity scan reads every database page, so it is an explicit action, never part of a refresh. */
function StorageHealthPanel({ storage, mutate }: {
  storage: TaskboardSnapshot['storageHealth']
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>
}) {
  const t = useStrings()
  const [checking, setChecking] = useState(false)
  return (
    <section className="dsh-taskboard-storage" data-status={storage.status}>
      <header>
        <h2>{t.storageHealth}</h2>
        <div className="dsh-taskboard-storage-actions">
          <strong>{storage.status === 'ok' ? t.healthy : t.degraded}</strong>
          <button type="button" disabled={checking} onClick={() => {
            setChecking(true)
            void mutate('storage.check-integrity', {}).finally(() => { setChecking(false) })
          }}>{t.recheckIntegrity}</button>
        </div>
      </header>
      <span>SQLite: {storage.integrity} · schema v{storage.schemaVersion} · revision {storage.globalRevision}</span>
      <span>{storage.taskCount} {t.tasksWord} · {storage.attachmentCount} {t.attachments} · {storage.attachmentBytes} {t.bytes}</span>
      <span>{t.cleanupPending}: {storage.cleanupPending} · {t.cleanupStalled}: {storage.cleanupStalled} · {t.orphanedClaims}: {storage.orphanedClaims}</span>
      <span>{t.lastChecked}: {storage.integrityCheckedAt === 0 ? t.never : new Date(storage.integrityCheckedAt).toLocaleString()}</span>
    </section>
  )
}

function Dashboard({ tasks, runs, project, storage, open, openLog, mutate }: {
  tasks: readonly TaskboardTask[]
  runs: readonly AutomationRun[]
  project: TaskboardProject | undefined
  storage: TaskboardSnapshot['storageHealth'] | undefined
  open: (task: TaskboardTask) => void
  openLog: () => void
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>
}) {
  const t = useStrings()
  const counts = useMemo(() => {
    const tally: Partial<Record<TaskboardTask['status'], number>> = {}
    for (const task of tasks) tally[task.status] = (tally[task.status] ?? 0) + 1
    return tally
  }, [tasks])
  const dueTasks = useMemo(() => [...tasks]
    .filter(task => task.dueDate !== undefined && task.status !== 'done' && task.status !== 'canceled')
    .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)))
    .slice(0, 8), [tasks])
  const recentTasks = useMemo(() => [...tasks]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 8), [tasks])
  return <><div className="dsh-taskboard-dashboard">{(['todo', 'in_progress', 'in_review', 'blocked'] as const).map(status => <div key={status}><strong>{counts[status] ?? 0}</strong><span>{t[status]}</span></div>)}</div><section className="dsh-taskboard-summary"><h2>{project?.key ?? '—'} · {project?.name ?? t.project}</h2><span>{project?.workspaceId === undefined ? t.globalProject : `${t.workspace}: ${project.workspaceId}`}</span><span>{project?.labels.length === 0 ? t.noProjectLabels : `${t.labels}: ${project?.labels.join(', ')}`}</span><span>{tasks.length} {t.tasksWord} · {counts['in_progress'] ?? 0} {t.activeWord} · {counts['in_review'] ?? 0} {t.in_review}</span></section><section className="dsh-taskboard-due"><h2>{t.recentTasks}</h2>{recentTasks.length === 0 ? <p>{t.empty}</p> : recentTasks.map(task => <button type="button" key={task.id} onClick={() => { open(task) }}><strong>{task.identifier} · {task.title}</strong><span>{t[task.status]}</span></button>)}</section><section className="dsh-taskboard-due"><h2>{t.due}</h2>{dueTasks.length === 0 ? <p>{t.empty}</p> : dueTasks.map(task => <button type="button" key={task.id} onClick={() => { open(task) }}><strong>{task.identifier} · {task.title}</strong><span>{task.dueDate} · {t[task.status]}</span></button>)}</section>{storage !== undefined && <StorageHealthPanel storage={storage} mutate={mutate} />}<AutomationLog runs={runs} tasks={tasks} openLog={openLog} /></>
}

function AutomationActions({ project, automations, defaults, mutate }: {
  project: TaskboardProject
  automations: readonly AutomationRule[]
  defaults: TaskboardSnapshot['automationDefaults'] | undefined
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>
}) {
  const t = useStrings()
  const popover = useExclusivePopover()
  const [adding, setAdding] = useState(false)
  const [agentPreset, setAgentPreset] = useState(defaults?.agentPreset ?? 'standard')
  const [modelRoute, setModelRoute] = useState(defaults?.modelRoute ?? '')
  const [reasoning, setReasoning] = useState(defaults?.reasoning ?? '')
  const minimumIntervalSeconds = Math.ceil((defaults?.minIntervalMs ?? 30_000) / 1000)
  const [intervalSeconds, setIntervalSeconds] = useState(minimumIntervalSeconds)
  const [concurrencyLimit, setConcurrencyLimit] = useState(1)
  const [quotaPolicy, setQuotaPolicy] = useState<'pause-on-uncertain' | 'ignore'>('ignore')
  const [autoPauseOnEmpty, setAutoPauseOnEmpty] = useState(false)
  useEffect(() => {
    setAgentPreset(defaults?.agentPreset ?? 'standard')
    setModelRoute(defaults?.modelRoute ?? '')
    setReasoning(defaults?.reasoning ?? '')
  }, [defaults?.agentPreset, defaults?.modelRoute, defaults?.reasoning])
  useEffect(() => { if (!popover.open) setAdding(false) }, [popover.open])
  const closeMenu = (): void => { setAdding(false); popover.setOpen(false) }
  const add = (event: FormEvent): void => {
    event.preventDefault()
    if (agentPreset.trim() === '') return
    void mutate('automation.create', {
      projectId: project.id,
      config: {
        intervalMs: Math.max(minimumIntervalSeconds, intervalSeconds) * 1000, agentPreset: agentPreset.trim(), concurrencyLimit, quotaPolicy, autoPauseOnEmpty,
        ...(modelRoute.trim() === '' ? {} : { modelRoute: modelRoute.trim() }),
        ...(reasoning.trim() === '' ? {} : { reasoning: reasoning.trim() }),
      },
    }).then(() => { setAdding(false) })
  }
  return (
    <PopoverShell
      open={popover.open}
      onToggle={() => { if (popover.open) closeMenu(); else popover.setOpen(true) }}
      onDismiss={closeMenu}
      onEscape={() => { if (adding) setAdding(false); else closeMenu() }}
      label={t.automation}
    >
      <div className="dsh-taskboard-automation-menu">
        <header>
          <h2>{t.automation}</h2>
          <div className="dsh-taskboard-popover-actions">
            <button type="button" aria-expanded={adding} onClick={() => { setAdding(value => !value) }}>＋ {t.addAutomation}</button>
            <button type="button" className="dsh-taskboard-popover-close" aria-label={t.dismiss} onClick={closeMenu}><CloseIcon size={14} /></button>
          </div>
        </header>
        {adding && <form className="dsh-taskboard-automation-form" onSubmit={add}><label>{t.agentPreset}<input value={agentPreset} onChange={event => { setAgentPreset(event.target.value) }} /></label><label>{t.modelRoute}<input value={modelRoute} onChange={event => { setModelRoute(event.target.value) }} /></label><label>{t.reasoning}<input value={reasoning} onChange={event => { setReasoning(event.target.value) }} /></label><label>{t.intervalSeconds}<input type="number" min={minimumIntervalSeconds} value={intervalSeconds} onChange={event => { setIntervalSeconds(Math.max(minimumIntervalSeconds, Number(event.target.value) || minimumIntervalSeconds)) }} /></label><label>{t.workers}<input type="number" min="1" value={concurrencyLimit} onChange={event => { setConcurrencyLimit(Math.max(1, Number(event.target.value) || 1)) }} /></label><label>{t.quota}<select value={quotaPolicy} onChange={event => { setQuotaPolicy(event.target.value as typeof quotaPolicy) }}><option value="pause-on-uncertain">{t.pauseUncertain}</option><option value="ignore">{t.ignore}</option></select></label><label><input type="checkbox" checked={autoPauseOnEmpty} onChange={event => { setAutoPauseOnEmpty(event.target.checked) }} />{t.autoPauseEmpty}</label><button type="submit">{t.create}</button><button type="button" onClick={() => { setAdding(false) }}>{t.cancel}</button></form>}
        {automations.length === 0 ? <p>{t.empty}</p> : automations.map(rule => <AutomationEditor key={rule.id} rule={rule} defaults={defaults} minimumIntervalSeconds={minimumIntervalSeconds} mutate={mutate} />)}
      </div>
    </PopoverShell>
  )
}

function automationRunLabel(run: AutomationRun, tasks: readonly TaskboardTask[]): string | undefined {
  const task = run.decision.taskId === undefined ? undefined : tasks.find(item => item.id === run.decision.taskId)
  return task === undefined ? run.decision.taskId : `${task.identifier} · ${task.title}`
}

function AutomationLogItems({ runs, tasks }: { runs: readonly AutomationRun[]; tasks: readonly TaskboardTask[] }) {
  const t = useStrings()
  return <ol>{runs.map(run => (
    <li key={run.id} data-kind={run.decision.kind}>
      <time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString()}</time>
      <span>{formatAutomationLog(t, run.decision, automationRunLabel(run, tasks))}</span>
    </li>
  ))}</ol>
}

function AutomationLog({ runs, tasks, openLog }: { runs: readonly AutomationRun[]; tasks: readonly TaskboardTask[]; openLog: () => void }) {
  const t = useStrings()
  const { preview, remaining } = previewAutomationRuns(runs)
  return <section className="dsh-taskboard-log"><header><h2>{t.automationLog}</h2>{remaining > 0 && <button type="button" className="dsh-taskboard-link" onClick={openLog}>{t.more}</button>}</header>{runs.length === 0 ? <p>{t.empty}</p> : <AutomationLogItems runs={preview} tasks={tasks} />}</section>
}

function AutomationLogDialog({ runs, tasks, close }: { runs: readonly AutomationRun[]; tasks: readonly TaskboardTask[]; close: () => void }) {
  const t = useStrings()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => { dialogRef.current?.focus() }, [])
  return (
    <div className="dsh-taskboard-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div ref={dialogRef} className="dsh-taskboard-log-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header>
          <h2 id={titleId}>{t.automationLog}</h2>
          <button type="button" className="dsh-taskboard-detail-close" aria-label={t.closeDetail} onClick={close}><CloseIcon size={14} /></button>
        </header>
        {runs.length === 0 ? <p>{t.empty}</p> : <AutomationLogItems runs={runs} tasks={tasks} />}
      </div>
    </div>
  )
}

function AutomationEditor({ rule, defaults, minimumIntervalSeconds, mutate }: {
  rule: AutomationRule
  defaults: TaskboardSnapshot['automationDefaults'] | undefined
  minimumIntervalSeconds: number
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>
}) {
  const t = useStrings()
  const [editing, setEditing] = useState(false)
  const [config, setConfig] = useState(() => applyAutomationDefaults(rule.config, defaults))
  useEffect(() => { setConfig(applyAutomationDefaults(rule.config, defaults)) }, [rule.version, defaults?.modelRoute, defaults?.reasoning])
  const update = (next: AutomationRule['config']): void => { setConfig(next) }
  const setOptional = (key: 'modelRoute' | 'reasoning', value: string): void => {
    const { modelRoute, reasoning, ...required } = config
    update({ ...required, ...(key === 'modelRoute' && value !== '' ? { modelRoute: value } : {}), ...(key === 'reasoning' && value !== '' ? { reasoning: value } : {}), ...(key !== 'modelRoute' && modelRoute !== undefined ? { modelRoute } : {}), ...(key !== 'reasoning' && reasoning !== undefined ? { reasoning } : {}) })
  }
  return <article><div><strong>{rule.config.agentPreset}</strong><span>{rule.state === 'enabled' ? t.enabled : t.paused} · {rule.config.concurrencyLimit} {t.workers} · {rule.config.intervalMs / 1000}s</span></div><div><small>{t.nextRun}: {rule.nextEligibleAt === undefined ? '—' : new Date(rule.nextEligibleAt).toLocaleString()}</small><small>{t.lastDecision}: {rule.lastDecision === undefined ? '—' : formatAutomationLog(t, rule.lastDecision)}</small><small>{t.model}: {rule.config.modelRoute ?? defaults?.modelRoute ?? t.hostDefault} · {t.reasoning}: {rule.config.reasoning ?? defaults?.reasoning ?? t.hostDefault} · {t.quota}: {rule.config.quotaPolicy} · {t.empty}: {rule.config.autoPauseOnEmpty ? t.pause : t.stayEnabled}</small></div><div><button type="button" onClick={() => { void mutate('automation.run-now', { automationId: rule.id }) }}>{t.runNow}</button><button type="button" onClick={() => { void mutate('automation.update', { automationId: rule.id, expectedVersion: rule.version, update: { state: rule.state === 'enabled' ? 'paused' : 'enabled' } }) }}>{rule.state === 'enabled' ? t.pause : t.enable}</button><button type="button" aria-expanded={editing} onClick={() => { setEditing(value => !value) }}>{t.modify}</button></div>{editing && <form className="dsh-taskboard-automation-form" onSubmit={event => { event.preventDefault(); void mutate('automation.update', { automationId: rule.id, expectedVersion: rule.version, update: { config } }).then(() => { setEditing(false) }) }}><label>{t.agentPreset}<input value={config.agentPreset} onChange={event => { update({ ...config, agentPreset: event.target.value }) }} /></label><label>{t.modelRoute}<input value={config.modelRoute ?? ''} onChange={event => { setOptional('modelRoute', event.target.value.trim()) }} /></label><label>{t.reasoning}<input value={config.reasoning ?? ''} onChange={event => { setOptional('reasoning', event.target.value.trim()) }} /></label><label>{t.intervalSeconds}<input type="number" min={minimumIntervalSeconds} value={config.intervalMs / 1000} onChange={event => { update({ ...config, intervalMs: Math.max(minimumIntervalSeconds, Number(event.target.value) || minimumIntervalSeconds) * 1000 }) }} /></label><label>{t.workers}<input type="number" min="1" value={config.concurrencyLimit} onChange={event => { update({ ...config, concurrencyLimit: Math.max(1, Number(event.target.value) || 1) }) }} /></label><label>{t.quota}<select value={config.quotaPolicy} onChange={event => { update({ ...config, quotaPolicy: event.target.value as AutomationRule['config']['quotaPolicy'] }) }}><option value="pause-on-uncertain">{t.pauseUncertain}</option><option value="ignore">{t.ignore}</option></select></label><label><input type="checkbox" checked={config.autoPauseOnEmpty} onChange={event => { update({ ...config, autoPauseOnEmpty: event.target.checked }) }} />{t.autoPauseEmpty}</label><button type="submit" disabled={config.agentPreset.trim() === ''}>{t.save}</button><button type="button" onClick={() => { setEditing(false); setConfig(applyAutomationDefaults(rule.config, defaults)) }}>{t.cancel}</button></form>}</article>
}

function Board({ tasks, open, mutate }: {
  tasks: readonly TaskboardTask[]
  open: (task: TaskboardTask) => void
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>
}) {
  const t = useStrings()
  const [draggedId, setDraggedId] = useState<string>()
  const draggingRef = useRef(false)
  const dragged = tasks.find(task => task.id === draggedId)
  const applyDrop = (status: typeof TASK_STATUSES[number], target?: TaskboardTask): void => {
    const column = tasks.filter(task => task.status === status && task.archivedAt === undefined)
    const intent = boardDropIntent(dragged, status, column, target)
    setDraggedId(undefined)
    if (intent.kind === 'reorder') {
      void mutate('task.update', {
        taskId: intent.taskId,
        expectedVersion: intent.expectedVersion,
        request: { sortOrder: intent.sortOrder },
      })
    } else if (intent.kind === 'move') {
      void mutate('task.move', {
        taskId: intent.taskId,
        expectedVersion: intent.expectedVersion,
        status: intent.status,
        ...(intent.sortOrder === undefined ? {} : { sortOrder: intent.sortOrder }),
      })
    }
  }
  const archived = tasks.filter(task => task.archivedAt !== undefined)
  return <>
    <div className="dsh-taskboard-board">
      {TASK_STATUSES.map(status => (
        <BoardColumn
          key={status}
          status={status}
          tasks={tasks}
          open={open}
          applyDrop={applyDrop}
          draggingRef={draggingRef}
          setDraggedId={setDraggedId}
        />
      ))}
    </div>
    {archived.length > 0 && <section className="dsh-taskboard-other"><h2>{t.other}</h2>{archived.map(task => <TaskCard key={task.id} task={task} open={open} />)}</section>}
  </>
}

function BoardColumn({ status, tasks, open, applyDrop, draggingRef, setDraggedId }: {
  status: typeof TASK_STATUSES[number]
  tasks: readonly TaskboardTask[]
  open: (task: TaskboardTask) => void
  applyDrop: (status: typeof TASK_STATUSES[number], target?: TaskboardTask) => void
  draggingRef: { current: boolean }
  setDraggedId: (id: string | undefined) => void
}) {
  const t = useStrings()
  const [visibleCount, setVisibleCount] = useState(BOARD_COLUMN_PAGE_SIZE)
  const columnTasks = useMemo(
    () => tasks.filter(task => task.status === status && task.archivedAt === undefined),
    [tasks, status],
  )
  const { visible, remaining } = paginateBoardColumn(columnTasks, visibleCount)
  return (
    <section
      data-status={status}
      onDragOver={event => { event.preventDefault() }}
      onDrop={event => { event.preventDefault(); applyDrop(status) }}
    >
      <h2>
        <i className="dsh-taskboard-status-dot" data-status={status} />
        <span>{t[status]}</span>
        <small>{columnTasks.length}</small>
      </h2>
      {visible.map(task => (
        <TaskCard
          key={task.id}
          task={task}
          open={candidate => { if (!draggingRef.current) open(candidate) }}
          drag={{
            start: () => { draggingRef.current = true; setDraggedId(task.id) },
            drop: () => { applyDrop(status, task) },
            end: () => { setDraggedId(undefined); window.setTimeout(() => { draggingRef.current = false }, 0) },
          }}
        />
      ))}
      {remaining > 0 && (
        <button
          type="button"
          className="dsh-taskboard-more"
          aria-label={`${t.more} · ${interpolate(t.moreRemaining, { count: remaining })}`}
          onClick={() => { setVisibleCount(count => count + BOARD_COLUMN_PAGE_SIZE) }}
        >
          <MoreIcon size={16} />
          <span className="dsh-taskboard-more-label">{t.more}</span>
        </button>
      )}
    </section>
  )
}

function TaskCard({ task, open, drag }: {
  task: TaskboardTask
  open: (task: TaskboardTask) => void
  drag?: { start: () => void; drop: () => void; end?: () => void }
}) {
  const t = useStrings()
  return <button type="button" draggable={drag !== undefined} className="dsh-taskboard-card" data-status={task.status} onDragStart={drag?.start} onDragEnd={drag?.end} onDragOver={event => { if (drag !== undefined) { event.preventDefault(); event.stopPropagation() } }} onDrop={event => { if (drag === undefined) return; event.preventDefault(); event.stopPropagation(); drag.drop() }} onClick={() => { open(task) }}><small>{task.identifier} · v{task.version}</small><strong>{task.title}</strong><span>{priorityLabel(t, task.priority)}{task.dueDate === undefined ? '' : ` · ${task.dueDate}`}</span></button>
}

function ListView({ tasks, open }: { tasks: readonly TaskboardTask[]; open: (task: TaskboardTask) => void }) {
  const t = useStrings()
  const [sort, setSort] = useState<TaskListSortKey>('identifier')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const ordered = useMemo(() => sortTaskList(tasks, sort, direction), [tasks, sort, direction])
  const heading = (key: TaskListSortKey, label: string) => (
    <th aria-sort={sort === key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => {
        if (sort === key) setDirection(current => current === 'asc' ? 'desc' : 'asc')
        else { setSort(key); setDirection('asc') }
      }}>{label}{sort === key ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}</button>
    </th>
  )
  return <div className="dsh-taskboard-table-wrap"><table><thead><tr>{heading('identifier', 'ID')}{heading('title', t.title)}{heading('status', t.status)}{heading('priority', t.priority)}{heading('dueDate', t.due)}</tr></thead><tbody>{ordered.map(task => <tr key={task.id}><td><button type="button" className="dsh-taskboard-row-open" onClick={() => { open(task) }}>{task.identifier}</button></td><td>{task.title}</td><td>{t[task.status]}</td><td>{priorityLabel(t, task.priority)}</td><td>{task.dueDate ?? '—'}</td></tr>)}</tbody></table></div>
}

function LabelsView({ project, tasks, open, mutate }: {
  project: TaskboardProject
  tasks: readonly TaskboardTask[]
  open: (task: TaskboardTask) => void
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>
}) {
  const t = useStrings()
  const catalog = projectLabelCatalog(project.labels, tasks)
  const unlabeled = tasksForLabel(tasks, undefined)
  const [selected, setSelected] = useState<string | undefined>(catalog[0])
  const [draft, setDraft] = useState('')
  const [rename, setRename] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    if (selected !== undefined && !catalog.includes(selected)) setSelected(catalog[0])
  }, [catalog, selected])
  useEffect(() => { setRename(selected ?? ''); setConfirmDelete(false) }, [selected])
  const selectedTasks = tasksForLabel(tasks, selected)
  const add = (event: FormEvent): void => {
    event.preventDefault()
    const name = draft.trim()
    if (name === '' || catalog.includes(name)) return
    void mutate('project.update', {
      projectId: project.id,
      expectedVersion: project.version,
      request: { labels: [...project.labels, name] },
    }).then(() => { setDraft(''); setSelected(name) })
  }
  const saveRename = (): void => {
    const name = rename.trim()
    if (selected === undefined || name === '' || name === selected) return
    void mutate('project.rename-label', {
      projectId: project.id, expectedVersion: project.version, from: selected, to: name,
    }).then(() => { setSelected(name) })
  }
  const remove = (): void => {
    if (selected === undefined) return
    void mutate('project.remove-label', {
      projectId: project.id, expectedVersion: project.version, label: selected,
    }).then(() => { setConfirmDelete(false); setSelected(undefined) })
  }
  return (
    <div className="dsh-taskboard-labels">
      <aside>
        <form className="dsh-taskboard-workflow-create" onSubmit={add}>
          <input aria-label={t.labelName} value={draft} onChange={event => { setDraft(event.target.value) }} placeholder={t.addLabel} />
          <button type="submit" disabled={draft.trim() === ''}>＋ {t.addLabel}</button>
        </form>
        {catalog.map(label => (
          <button type="button" className={label === selected ? 'active' : ''} key={label} onClick={() => { setSelected(label) }}>
            <strong>{label}</strong>
            <small>{tasksForLabel(tasks, label).length}</small>
          </button>
        ))}
        <button type="button" className={selected === undefined ? 'active' : ''} onClick={() => { setSelected(undefined) }}>
          <strong>{t.unlabeled}</strong>
          <small>{unlabeled.length}</small>
        </button>
      </aside>
      <section>
        {selected === undefined
          ? <header><h2>{t.unlabeledTasks}</h2></header>
          : <header>
              <input aria-label={t.renameLabel} value={rename} onChange={event => { setRename(event.target.value) }} />
              <button type="button" disabled={rename.trim() === '' || rename.trim() === selected} onClick={saveRename}>{t.save}</button>
              <button type="button" aria-expanded={confirmDelete} onClick={() => { setConfirmDelete(value => !value) }}>{t.deleteLabel}</button>
              {confirmDelete && <div className="dsh-taskboard-confirm" role="alert"><span>{t.deleteLabel} “{selected}”?</span><button type="button" onClick={remove}>{t.delete}</button><button type="button" onClick={() => { setConfirmDelete(false) }}>{t.close}</button></div>}
            </header>}
        {selectedTasks.length === 0
          ? <div className="dsh-taskboard-empty">{selected === undefined && catalog.length === 0 ? t.noLabels : t.empty}</div>
          : selectedTasks.map(task => <TaskCard key={task.id} task={task} open={open} />)}
      </section>
    </div>
  )
}

function Gantt({ tasks, open }: { tasks: readonly TaskboardTask[]; open: (task: TaskboardTask) => void }) {
  const t = useStrings()
  const [zoom, setZoom] = useState<'month' | 'quarter' | 'year'>('quarter')
  const [showCompleted, setShowCompleted] = useState(false)
  const [anchor, setAnchor] = useState(() => Date.now())
  const rows = useRef<HTMLDivElement>(null)
  // The bars are a percentage of the middle grid column, so the "today" line has to be placed in
  // that column's own pixels. Anchoring it to 50% of the whole component dropped it between the
  // title column and the track.
  const [todayLeft, setTodayLeft] = useState<number>()
  const days = zoom === 'month' ? 30 : zoom === 'quarter' ? 90 : 365
  const start = anchor - ((days / 2) * 86_400_000)
  // Task dates are calendar days validated in UTC by the provider. Parsing them at local midnight
  // shifted every bar a day west of UTC.
  const point = (value: string | undefined, fallback: number): number => value === undefined ? fallback : new Date(`${value}T00:00:00Z`).getTime()
  const end = start + (days * 86_400_000)
  const dated = tasks.filter(task => {
    if (task.startDate === undefined && task.dueDate === undefined) return false
    if (!showCompleted && task.status === 'done') return false
    // A task entirely outside the window used to be clamped to the left edge, drawing a bar that
    // looked like work happening now. Leave it out of the window instead.
    const taskStart = point(task.startDate, point(task.dueDate, anchor))
    const taskEnd = Math.max(point(task.dueDate, taskStart + 86_400_000), taskStart + 86_400_000)
    return taskEnd >= start && taskStart <= end
  })
  useEffect(() => {
    const container = rows.current
    if (container === null) return
    const measure = (): void => {
      const track = container.querySelector('.dsh-taskboard-gantt-track')
      if (track === null) { setTodayLeft(undefined); return }
      const trackBox = track.getBoundingClientRect()
      const containerBox = container.getBoundingClientRect()
      setTodayLeft(trackBox.left - containerBox.left + (trackBox.width / 2))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => { observer.disconnect() }
  }, [dated.length, zoom])
  return <div className="dsh-taskboard-gantt"><header><button type="button" onClick={() => { setAnchor(Date.now()) }}>{t.today}</button><select aria-label={t.ganttZoom} value={zoom} onChange={event => { setZoom(event.target.value as typeof zoom) }}><option value="month">{t.days30}</option><option value="quarter">{t.days90}</option><option value="year">{t.oneYear}</option></select><label><input type="checkbox" checked={showCompleted} onChange={event => { setShowCompleted(event.target.checked) }} />{t.showCompleted}</label></header><div className="dsh-taskboard-gantt-rows" ref={rows}>{todayLeft !== undefined && <div className="dsh-taskboard-today" style={{ left: `${String(todayLeft)}px` }} aria-hidden="true" />}{dated.length === 0 ? <div className="dsh-taskboard-empty">{t.noDatedTasks}</div> : dated.map(task => {
    const taskStart = point(task.startDate, point(task.dueDate, anchor))
    const taskEnd = point(task.dueDate, taskStart + 86_400_000)
    const left = Math.max(0, Math.min(100, ((taskStart - start) / (days * 86_400_000)) * 100))
    const width = Math.max(1.5, Math.min(100 - left, ((Math.max(taskEnd, taskStart + 86_400_000) - taskStart) / (days * 86_400_000)) * 100))
    const repeat = task.recurrence === undefined ? '' : ` · ${task.recurrence.frequency}/${task.recurrence.interval}${task.recurrence.until === undefined ? '' : ` until ${task.recurrence.until}`}`
    return <button type="button" key={task.id} onClick={() => { open(task) }}><span>{task.identifier} · {task.title}</span><span className="dsh-taskboard-gantt-track"><i style={{ left: `${left}%`, width: `${width}%` }} /></span><small>{task.startDate ?? '…'} → {task.dueDate ?? '…'}{repeat}</small></button>
  })}</div></div>
}

function WorkflowEditor({ project, workflows, catalog, capabilities, mutate }: {
  project: TaskboardProject | undefined
  workflows: readonly SavedWorkflow[]
  catalog: TaskboardSnapshot['workflowCatalog']
  capabilities: TaskboardSnapshot['workflowCapabilities'] | undefined
  mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>
}) {
  const t = useStrings()
  const [selectedId, setSelectedId] = useState<string>()
  const selected = workflows.find(item => item.id === selectedId) ?? workflows[0]
  const [name, setName] = useState('')
  const [document, setDocument] = useState<WorkflowDocument>()
  const stepEntries = catalog.filter(item => item.category !== 'trigger')
  const triggerEntries = catalog.filter(item => item.category === 'trigger')
  const [newWorkflowName, setNewWorkflowName] = useState('')
  const [nodeKind, setNodeKind] = useState('tests')
  const [newTabName, setNewTabName] = useState('')
  const [triggerKind, setTriggerKind] = useState('issue-trigger')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    setSelectedId(selected?.id)
    setName(selected?.name ?? '')
    setDocument(selected?.document)
  }, [selected?.id, selected?.name, selected?.version])
  const create = (event: FormEvent): void => {
    event.preventDefault()
    if (project === undefined || newWorkflowName.trim() === '') return
    const trigger = catalog.find(item => item.kind === 'issue-trigger' && item.category === 'trigger')
    if (trigger === undefined) return
    void mutate('workflow.create', {
      projectId: project.id,
      name: newWorkflowName.trim(),
      document: { tabs: [{ id: 'main', name: 'Main', trigger: { id: 'trigger', kind: trigger.kind, execution: trigger.execution, config: {} }, steps: [] }] },
    }).then(() => { setNewWorkflowName('') })
  }
  const addStep = (): void => {
    if (document === undefined) return
    const entry = catalog.find(item => item.kind === nodeKind)
    if (entry === undefined || entry.category === 'trigger') return
    const first = document.tabs[0]
    if (first === undefined) return
    const node = { id: `${nodeKind}-${Date.now()}`, kind: nodeKind, execution: entry.execution, config: {} } as const
    setDocument(insertWorkflowNode(document, first.id, node))
  }
  const addTab = (): void => {
    if (document === undefined || newTabName.trim() === '') return
    const entry = catalog.find(item => item.kind === triggerKind && item.category === 'trigger')
    if (entry === undefined) return
    const suffix = Date.now()
    setDocument(addWorkflowTab(document, { id: `tab-${suffix}`, name: newTabName.trim(), trigger: { id: `trigger-${suffix}`, kind: triggerKind, execution: entry.execution, config: {} }, steps: [] }))
    setNewTabName('')
  }
  const editNode = (action: 'up' | 'down' | 'copy' | 'delete' | 'true' | 'false', tabId: string, nodeId: string): void => {
    if (document === undefined) return
    if (action === 'up' || action === 'down') setDocument(moveWorkflowNode(document, nodeId, action === 'up' ? -1 : 1))
    else if (action === 'copy') {
      const suffix = Date.now()
      setDocument(copyWorkflowNode(document, nodeId, source => `${source}-copy-${suffix}`))
    } else if (action === 'delete') setDocument(removeWorkflowNode(document, nodeId))
    else {
      const entry = catalog.find(item => item.kind === nodeKind && item.category !== 'trigger')
      if (entry === undefined) return
      setDocument(insertWorkflowNode(document, tabId, { id: `${nodeKind}-${Date.now()}`, kind: nodeKind, execution: entry.execution, config: {} }, nodeId, action === 'true' ? 'trueBranch' : 'falseBranch'))
    }
  }
  const addCapability = (kind: 'skill' | 'mcp', target: string): void => {
    if (document === undefined || document.tabs[0] === undefined) return
    const entry = catalog.find(item => item.kind === kind)
    if (entry === undefined) return
    setDocument(insertWorkflowNode(document, document.tabs[0].id, {
      id: `${kind}-${Date.now()}`, kind, execution: entry.execution, config: { target },
    }))
  }
  return <div className="dsh-taskboard-workflows"><aside><form className="dsh-taskboard-workflow-create" onSubmit={create}><input aria-label={t.workflowName} value={newWorkflowName} onChange={event => { setNewWorkflowName(event.target.value) }} placeholder={t.workflowName} /><button type="submit" disabled={project === undefined || newWorkflowName.trim() === ''}>＋ {t.addWorkflow}</button></form>{workflows.map(item => <button type="button" className={item.id === selected?.id ? 'active' : ''} key={item.id} onClick={() => { setSelectedId(item.id) }}><strong>{item.name}</strong><small>v{item.version}</small></button>)}</aside><section>{selected === undefined || document === undefined ? <div className="dsh-taskboard-empty">{t.workflowNote}</div> : <><header><input aria-label={t.workflowName} value={name} onChange={event => { setName(event.target.value) }} /><select aria-label={t.nodeKind} value={nodeKind} onChange={event => { setNodeKind(event.target.value) }}>{stepEntries.map(item => <option key={item.kind} value={item.kind}>{item.kind}</option>)}</select><button type="button" onClick={addStep}>＋ {t.addStep}</button><input aria-label={t.newTabName} value={newTabName} onChange={event => { setNewTabName(event.target.value) }} placeholder={t.newTabName} /><select aria-label={t.triggerKind} value={triggerKind} onChange={event => { setTriggerKind(event.target.value) }}>{triggerEntries.map(item => <option key={item.kind} value={item.kind}>{item.kind}</option>)}</select><button type="button" disabled={newTabName.trim() === ''} onClick={addTab}>＋ {t.tab}</button><button type="button" onClick={() => { void mutate('workflow.update', { workflowId: selected.id, expectedVersion: selected.version, name, document }) }}>{t.save}</button><button type="button" aria-expanded={confirmDelete} onClick={() => { setConfirmDelete(value => !value) }}>×</button>{confirmDelete && <div className="dsh-taskboard-confirm" role="alert"><span>{t.deleteWorkflow}?</span><button type="button" onClick={() => { void mutate('workflow.delete', { workflowId: selected.id, expectedVersion: selected.version }); setConfirmDelete(false) }}>{t.delete}</button><button type="button" onClick={() => { setConfirmDelete(false) }}>{t.close}</button></div>}</header><div className="dsh-taskboard-workflow-tabs">{document.tabs.map(tab => <article key={tab.id}><header><h3>{tab.name}</h3><button type="button" disabled={document.tabs.length <= 1} onClick={() => { setDocument(removeWorkflowTab(document, tab.id)) }}>× {t.tab}</button></header><WorkflowNodeCard node={tab.trigger} tabId={tab.id} edit={editNode} trigger /><div className="dsh-taskboard-flow-line" />{tab.steps.map(node => <WorkflowNodeCard key={node.id} node={node} tabId={tab.id} edit={editNode} />)}</article>)}</div><footer>{catalog.map(item => <span key={item.kind} data-execution={item.execution}>{item.kind} · {item.execution === 'executable' ? t.executable : t.designOnly}</span>)}</footer><section className="dsh-taskboard-capabilities"><h3>{t.installedCapabilities}</h3><small>{t.skillDiscovery}: {capabilities?.skillDiscoveryComplete === true ? t.completeWord : t.refreshing}</small><div>{capabilities?.skills.map(skill => <button type="button" key={`skill-${skill.name}`} title={skill.description} onClick={() => { addCapability('skill', skill.name) }}>＋ {t.skill} · {skill.name}</button>)}</div><div>{capabilities?.mcpTools.map(tool => <button type="button" key={`mcp-${tool.name}`} title={tool.description} onClick={() => { addCapability('mcp', tool.name) }}>＋ {t.mcp} · {tool.name}</button>)}</div></section></>}</section></div>
}

function WorkflowNodeCard({ node, tabId, edit, trigger = false }: { node: WorkflowDocument['tabs'][number]['trigger']; tabId: string; edit: (action: 'up' | 'down' | 'copy' | 'delete' | 'true' | 'false', tabId: string, nodeId: string) => void; trigger?: boolean }) {
  const t = useStrings()
  return <div className="dsh-taskboard-workflow-node" data-execution={node.execution}><strong>{node.kind}</strong><small>{node.execution === 'executable' ? t.executable : t.designOnly}</small>{!trigger && <div className="dsh-taskboard-workflow-node-actions"><button type="button" onClick={() => { edit('up', tabId, node.id) }}>↑</button><button type="button" onClick={() => { edit('down', tabId, node.id) }}>↓</button><button type="button" onClick={() => { edit('copy', tabId, node.id) }}>{t.copy}</button><button type="button" onClick={() => { edit('delete', tabId, node.id) }}>×</button>{node.kind === 'condition' && <><button type="button" onClick={() => { edit('true', tabId, node.id) }}>＋ {t.trueLabel}</button><button type="button" onClick={() => { edit('false', tabId, node.id) }}>＋ {t.falseLabel}</button></>}</div>}{node.steps?.map(child => <WorkflowNodeCard key={child.id} node={child} tabId={tabId} edit={edit} />)}{(node.trueBranch !== undefined || node.falseBranch !== undefined) && <div className="dsh-taskboard-branches"><section><b>{t.trueLabel}</b>{node.trueBranch?.map(child => <WorkflowNodeCard key={child.id} node={child} tabId={tabId} edit={edit} />)}</section><section><b>{t.falseLabel}</b>{node.falseBranch?.map(child => <WorkflowNodeCard key={child.id} node={child} tabId={tabId} edit={edit} />)}</section></div>}</div>
}

function TaskDetail({ project, task, tasks, workflows, detail, mutate, upload, download, preview, openSession, openNewSession, close, onDirtyChange }: { project: TaskboardProject | undefined; task: TaskboardTask; tasks: readonly TaskboardTask[]; workflows: readonly SavedWorkflow[]; detail: TaskDetailData | undefined; mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>; upload: (file: File, commentId?: string) => Promise<void>; download: (attachmentId: string, filename: string) => Promise<void>; preview: (attachmentId: string) => Promise<string>; openSession: (sessionId: string) => Promise<void>; openNewSession: () => Promise<void>; close: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const t = useStrings()
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [priority, setPriority] = useState(task.priority)
  const [labels, setLabels] = useState(task.labels.join(', '))
  const [startDate, setStartDate] = useState(task.startDate ?? '')
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [recurrence, setRecurrence] = useState<'' | 'daily' | 'weekly' | 'monthly'>(task.recurrence?.frequency ?? '')
  const [recurrenceInterval, setRecurrenceInterval] = useState(String(task.recurrence?.interval ?? 1))
  const [recurrenceUntil, setRecurrenceUntil] = useState(task.recurrence?.until ?? '')
  const [assignee, setAssignee] = useState(task.assignee ?? '')
  const [workflowId, setWorkflowId] = useState(task.workflowId ?? '')
  const [developmentKind, setDevelopmentKind] = useState<'' | 'branch' | 'worktree'>(task.developmentContext?.kind ?? '')
  const [developmentBranch, setDevelopmentBranch] = useState(task.developmentContext?.branch ?? '')
  const [worktreePath, setWorktreePath] = useState(task.developmentContext?.kind === 'worktree' ? task.developmentContext.path : '')
  const [comment, setComment] = useState('')
  const [descriptionMode, setDescriptionMode] = useState<'write' | 'preview'>(descriptionComposerMode(task.description))
  const [editingDescription, setEditingDescription] = useState(true)
  const [commentMode, setCommentMode] = useState<'write' | 'preview'>('write')
  const [editingCommentId, setEditingCommentId] = useState<string>()
  const [editCommentBody, setEditCommentBody] = useState('')
  const [editCommentMode, setEditCommentMode] = useState<'write' | 'preview'>('write')
  const [deletingCommentId, setDeletingCommentId] = useState<string>()
  const [relationKind, setRelationKind] = useState<'parent' | 'blocks' | 'related'>('related')
  const [relationTarget, setRelationTarget] = useState('')
  const [pendingAction, setPendingAction] = useState<'' | 'return' | 'block' | 'reopen' | 'takeover'>('')
  const [actionReason, setActionReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const developmentInvalid = developmentKind === 'branch'
    ? developmentBranch.trim() === ''
    : developmentKind === 'worktree' && (developmentBranch.trim() === '' || worktreePath.trim() === '')
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
    || (recurrence !== '' && recurrenceUntil !== (task.recurrence?.until ?? ''))
  const currentVersion = detail?.task.version ?? task.version
  // Report upward so Escape and the backdrop can confirm before discarding these local edits.
  useEffect(() => {
    onDirtyChange(dirty)
    return () => { onDirtyChange(false) }
  }, [dirty, onDirtyChange])
  useEffect(() => {
    setTitle(task.title); setDescription(task.description); setPriority(task.priority); setLabels(task.labels.join(', '))
    setStartDate(task.startDate ?? ''); setDueDate(task.dueDate ?? ''); setRecurrence(task.recurrence?.frequency ?? '')
    setRecurrenceInterval(String(task.recurrence?.interval ?? 1)); setRecurrenceUntil(task.recurrence?.until ?? ''); setAssignee(task.assignee ?? '')
    setWorkflowId(task.workflowId ?? ''); setDevelopmentKind(task.developmentContext?.kind ?? ''); setDevelopmentBranch(task.developmentContext?.branch ?? '')
    setWorktreePath(task.developmentContext?.kind === 'worktree' ? task.developmentContext.path : '')
    setComment(''); setPendingAction(''); setActionReason(''); setConfirmDelete(false)
    setDescriptionMode(descriptionComposerMode(task.description)); setEditingDescription(true); setCommentMode('write')
    setEditingCommentId(undefined); setEditCommentBody(''); setDeletingCommentId(undefined)
  }, [task.id])
  useEffect(() => { dialogRef.current?.focus() }, [task.id])
  const save = (): void => {
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
    })
  }
  const runReasonAction = (): void => {
    const reason = actionReason.trim()
    if (reason === '' || pendingAction === '') return
    const endpoint = pendingAction === 'return' ? 'task.return' : pendingAction === 'block' ? 'task.block' : pendingAction === 'reopen' ? 'task.reopen' : 'task.force-takeover'
    const reasonKey = pendingAction === 'return' ? 'comment' : 'reason'
    void mutate(endpoint, { taskId: task.id, expectedVersion: currentVersion, [reasonKey]: reason }).then(() => { setPendingAction(''); setActionReason('') })
  }
  const taskLabel = (id: string): string => {
    const match = tasks.find(item => item.id === id)
    return match === undefined ? id : `${match.identifier} · ${match.title}`
  }
  const relationLabel = (relation: TaskDetailData['relations'][number]): string => {
    if (relation.kind === 'related') return `related · ${taskLabel(relation.sourceTaskId === task.id ? relation.targetTaskId : relation.sourceTaskId)}`
    if (relation.kind === 'parent') return relation.sourceTaskId === task.id ? `parent of · ${taskLabel(relation.targetTaskId)}` : `child of · ${taskLabel(relation.sourceTaskId)}`
    return relation.sourceTaskId === task.id ? `blocks · ${taskLabel(relation.targetTaskId)}` : `blocked by · ${taskLabel(relation.sourceTaskId)}`
  }
  const saveDisabled = title.trim() === '' || developmentInvalid
  const closed = isClosedStatus(task.status)
  const taskAttachments = detail?.attachments.filter(item => item.commentId === undefined) ?? []
  const submitComment = (): void => {
    if (comment.trim() === '') return
    void mutate('task.comment', { taskId: task.id, expectedVersion: currentVersion, body: comment.trim() }).then(() => { setComment(''); setCommentMode('write') })
  }
  return (
    <div className="dsh-taskboard-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div ref={dialogRef} className="dsh-taskboard-detail" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="dsh-taskboard-detail-header">
          <div className="dsh-taskboard-detail-heading">
            <div className="dsh-taskboard-detail-meta">
              <span className="dsh-taskboard-issue-badge" data-closed={closed ? 'true' : undefined}>
                <i className="dsh-taskboard-status-dot" data-status={task.status} />
                {closed ? t.closedIssue : t.openIssue}
              </span>
              <span className="dsh-taskboard-detail-path">{project?.key ?? t.project} · {task.identifier}</span>
              <small>v{task.version} · {t[task.status]}</small>
            </div>
            <input id={titleId} className="dsh-taskboard-detail-title" value={title} aria-label={t.title} onChange={event => { setTitle(event.target.value) }} />
            <div className="dsh-taskboard-detail-author">
              <span className="dsh-taskboard-avatar" aria-hidden="true">{actorInitial(task.creator)}</span>
              <span><strong>{actorName(task.creator)}</strong> {formatOpenedAt(task.createdAt, t)}</span>
            </div>
          </div>
          <div className="dsh-taskboard-detail-toolbar">
            <button type="button" className="dsh-taskboard-save" data-dirty={dirty ? 'true' : undefined} disabled={saveDisabled} title={developmentInvalid ? t.developmentRequired : undefined} onClick={save}>
              <SaveIcon size={16} /><span>{t.save}</span>
            </button>
            <button type="button" className="dsh-taskboard-detail-close" aria-label={t.closeDetail} onClick={close}><CloseIcon size={14} /></button>
          </div>
        </header>
        <div className="dsh-taskboard-detail-columns">
          <div className="dsh-taskboard-detail-main">
            <section className="dsh-taskboard-body" aria-label={t.description}>
              {editingDescription
                ? <>
                    <MarkdownComposer
                      value={description}
                      onChange={setDescription}
                      mode={descriptionMode}
                      onModeChange={setDescriptionMode}
                      placeholder={t.descriptionPlaceholder}
                      emptyPreview={<p>{t.empty}</p>}
                    />
                    <footer>
                      <button type="button" className="dsh-taskboard-link" onClick={() => { setEditingDescription(false); setDescriptionMode('preview') }}>{t.preview}</button>
                    </footer>
                  </>
                : <>
                    <div className="dsh-taskboard-body-content">{description.trim() === '' ? <p className="dsh-taskboard-muted">{t.empty}</p> : <MarkdownText value={description} />}</div>
                    <footer>
                      <button type="button" className="dsh-taskboard-link" onClick={() => { setEditingDescription(true); setDescriptionMode('write') }}>{t.edit}</button>
                    </footer>
                  </>}
            </section>
            <div className="dsh-taskboard-detail-feed">
            {taskAttachments.length > 0 && <section className="dsh-taskboard-timeline-block" aria-label={t.attachments}>{taskAttachments.map(item => <AttachmentRow key={item.id} attachment={item} download={download} preview={preview} showMeta remove={() => { void mutate('attachment.delete', { taskId: task.id, expectedVersion: currentVersion, attachmentId: item.id }) }} />)}</section>}
            <ol className="dsh-taskboard-timeline">
              {(detail?.comments ?? []).map(item =>
                <li key={item.id} className="dsh-taskboard-timeline-comment">
                    <span className="dsh-taskboard-avatar" aria-hidden="true">{actorInitial(item.authorId)}</span>
                    <article>
                      <header>
                        <span><strong>{actorName(item.authorId)}</strong><small>{new Date(item.createdAt).toLocaleString()}{item.updatedAt !== item.createdAt ? ` · ${t.edited}` : ''}</small></span>
                        {deletingCommentId === item.id
                          ? <span className="dsh-taskboard-comment-actions" role="alert">
                              <span>{t.delete}?</span>
                              <button type="button" className="dsh-taskboard-save" onClick={() => { void mutate('comment.delete', { taskId: task.id, expectedVersion: currentVersion, commentId: item.id }).then(value => { if (value !== undefined) setDeletingCommentId(undefined) }) }}>{t.delete}</button>
                              <button type="button" onClick={() => { setDeletingCommentId(undefined) }}>{t.cancel}</button>
                            </span>
                          : <span className="dsh-taskboard-comment-actions">
                              <button type="button" className="dsh-taskboard-link" onClick={() => { setEditingCommentId(item.id); setEditCommentBody(item.body); setEditCommentMode('write'); setDeletingCommentId(undefined) }}>{t.edit}</button>
                              <button type="button" className="dsh-taskboard-link" onClick={() => { setDeletingCommentId(item.id); setEditingCommentId(undefined) }}>{t.delete}</button>
                            </span>}
                      </header>
                      {editingCommentId === item.id
                        ? <>
                            <MarkdownComposer
                              value={editCommentBody}
                              onChange={setEditCommentBody}
                              mode={editCommentMode}
                              onModeChange={setEditCommentMode}
                              placeholder={t.commentPlaceholder}
                              emptyPreview={<p>{t.commentPlaceholder}</p>}
                            />
                            <footer>
                              <button type="button" className="dsh-taskboard-save" disabled={editCommentBody.trim() === ''} onClick={() => {
                                void mutate('comment.update', { taskId: task.id, expectedVersion: currentVersion, commentId: item.id, body: editCommentBody.trim() })
                                  .then(value => { if (value !== undefined) { setEditingCommentId(undefined); setEditCommentBody('') } })
                              }}>{t.save}</button>
                              <button type="button" onClick={() => { setEditingCommentId(undefined); setEditCommentBody('') }}>{t.cancel}</button>
                            </footer>
                          </>
                        : <MarkdownText value={item.body} />}
                      <label className="dsh-taskboard-file-label">{t.attachComment}<input type="file" onChange={event => { const file = event.target.files?.[0]; if (file !== undefined) void upload(file, item.id); event.target.value = '' }} /></label>
                      {detail?.attachments.filter(attachment => attachment.commentId === item.id).map(attachment => <AttachmentRow key={attachment.id} attachment={attachment} download={download} preview={preview} remove={() => { void mutate('attachment.delete', { taskId: task.id, expectedVersion: currentVersion, attachmentId: attachment.id }) }} />)}
                    </article>
                  </li>)}
            </ol>
            </div>
            {pendingAction !== '' && <div className="dsh-taskboard-reason"><label>{t.reason}<textarea autoFocus value={actionReason} onChange={event => { setActionReason(event.target.value) }} /></label><button type="button" className="dsh-taskboard-save" disabled={actionReason.trim() === ''} onClick={runReasonAction}>{t.confirm}</button><button type="button" onClick={() => { setPendingAction(''); setActionReason('') }}>{t.close}</button></div>}
            {confirmDelete && <div className="dsh-taskboard-confirm" role="alert"><span>{t.permanentlyDelete} {task.identifier}?</span><button type="button" onClick={() => { void mutate('task.delete', { taskId: task.id, expectedVersion: currentVersion }); setConfirmDelete(false) }}>{t.delete}</button><button type="button" onClick={() => { setConfirmDelete(false) }}>{t.close}</button></div>}
            <section className="dsh-taskboard-composer" aria-label={t.addComment}>
              <h3>{t.addComment}</h3>
              <MarkdownComposer
                value={comment}
                onChange={setComment}
                mode={commentMode}
                onModeChange={setCommentMode}
                placeholder={t.commentPlaceholder}
                emptyPreview={<p>{t.commentPlaceholder}</p>}
              />
              <footer>
                <label className="dsh-taskboard-file-label">{t.attachFiles}<input type="file" onChange={event => { const file = event.target.files?.[0]; if (file !== undefined) void upload(file); event.target.value = '' }} /></label>
                <div className="dsh-taskboard-composer-actions">
                  {task.status === 'backlog' && <button type="button" onClick={() => { void mutate('task.approve', { taskId: task.id, expectedVersion: currentVersion }) }}>{t.approve}</button>}
                  {task.status === 'in_review' && <button type="button" onClick={() => { void mutate('task.accept', { taskId: task.id, expectedVersion: currentVersion }) }}>{t.accept}</button>}
                  {task.status === 'blocked' && <button type="button" onClick={() => { void mutate('task.resume', { taskId: task.id, expectedVersion: currentVersion }) }}>{t.resume}</button>}
                  {(task.status === 'todo' || task.status === 'in_progress') && <button type="button" onClick={() => { void mutate('task.cancel', { taskId: task.id, expectedVersion: currentVersion }) }}>{t.closeIssue}</button>}
                  {(task.status === 'done' || task.status === 'canceled') && <button type="button" onClick={() => { setPendingAction('reopen') }}>{t.reopen}</button>}
                  <button type="button" className="dsh-taskboard-save" disabled={comment.trim() === ''} onClick={submitComment}>{t.comment}</button>
                </div>
              </footer>
            </section>
          </div>
          <aside className="dsh-taskboard-detail-side">
            <MetaField label={t.assignee}>
              <input value={assignee} placeholder={t.noOne} onChange={event => { setAssignee(event.target.value) }} />
            </MetaField>
            <MetaField label={t.labels}>
              <input value={labels} onChange={event => { setLabels(event.target.value) }} placeholder="local, release" />
            </MetaField>
            <section className="dsh-taskboard-meta-project">
              <h3>{t.project}</h3>
              <p>{project === undefined ? t.none : `${project.key} · ${project.name}`}</p>
              <MetaField nested label={t.status}>
                <select aria-label={t.status} value={task.status} onChange={event => {
                  const status = event.target.value
                  if (status === task.status) return
                  void mutate('task.move', { taskId: task.id, expectedVersion: currentVersion, status })
                }}>{TASK_STATUSES.map(status => <option key={status} value={status}>{t[status]}</option>)}</select>
              </MetaField>
              <MetaField nested label={t.priority}>
                <select value={priority} onChange={event => { setPriority(event.target.value as TaskboardTask['priority']) }}>{(['urgent', 'high', 'medium', 'low', 'none'] as const).map(value => <option key={value} value={value}>{priorityLabel(t, value)}</option>)}</select>
              </MetaField>
              <MetaField nested label={t.workflow}>
                <select value={workflowId} onChange={event => { setWorkflowId(event.target.value) }}><option value="">{t.none}</option>{workflows.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              </MetaField>
              <MetaField nested label={t.start}>
                <input type="date" value={startDate} onChange={event => { setStartDate(event.target.value) }} />
              </MetaField>
              <MetaField nested label={t.targetDate}>
                <input type="date" value={dueDate} onChange={event => { setDueDate(event.target.value) }} />
              </MetaField>
              <MetaField nested label={t.recurrence}>
                <select value={recurrence} onChange={event => { setRecurrence(event.target.value as typeof recurrence) }}><option value="">{t.noRecurrence}</option><option value="daily">{t.daily}</option><option value="weekly">{t.weekly}</option><option value="monthly">{t.monthly}</option></select>
                {recurrence !== '' && <><input type="number" min="1" aria-label={t.interval} value={recurrenceInterval} onChange={event => { setRecurrenceInterval(event.target.value) }} /><input type="date" aria-label={t.until} value={recurrenceUntil} onChange={event => { setRecurrenceUntil(event.target.value) }} /></>}
              </MetaField>
            </section>
            <MetaField label={t.relations}>
              <div className="dsh-taskboard-relation-create"><select aria-label={t.relationKind} value={relationKind} onChange={event => { setRelationKind(event.target.value as typeof relationKind) }}><option value="parent">parent</option><option value="blocks">blocks</option><option value="related">related</option></select><select aria-label={t.relatedTask} value={relationTarget} onChange={event => { setRelationTarget(event.target.value) }}><option value="">{t.selectTask}</option>{tasks.filter(item => item.id !== task.id && item.projectId === task.projectId).map(item => <option key={item.id} value={item.id}>{item.identifier} · {item.title}</option>)}</select><button type="button" disabled={relationTarget === ''} onClick={() => { void mutate('task.relation', { taskId: task.id, expectedVersion: currentVersion, targetTaskId: relationTarget, kind: relationKind }).then(() => { setRelationTarget('') }) }}>{t.add}</button></div>
              {detail === undefined || detail.relations.length === 0 ? <p className="dsh-taskboard-muted">{t.noneYet}</p> : detail.relations.map(item => {
                // removeRelation checks the source task's version. For an outgoing relation that
                // is this task, so prefer the detail version over the snapshot page, which may not
                // contain the source at all.
                const sourceVersion = item.sourceTaskId === task.id
                  ? currentVersion
                  : tasks.find(candidate => candidate.id === item.sourceTaskId)?.version
                return <article key={item.id} className="dsh-taskboard-side-item"><strong>{relationLabel(item)}</strong><button type="button" disabled={sourceVersion === undefined} title={sourceVersion === undefined ? t.relationSourceUnloaded : undefined} onClick={() => { if (sourceVersion !== undefined) void mutate('relation.delete', { relationId: item.id, expectedVersion: sourceVersion }) }}>{t.delete}</button></article>
              })}
            </MetaField>
            <MetaField label={t.developmentContext}>
              <select value={developmentKind} onChange={event => { setDevelopmentKind(event.target.value as typeof developmentKind) }}><option value="">{t.none}</option><option value="branch">{t.branch}</option><option value="worktree">{t.worktree}</option></select>
              {developmentKind !== '' && <input value={developmentBranch} aria-label={t.branch} placeholder={t.branch} onChange={event => { setDevelopmentBranch(event.target.value) }} />}
              {developmentKind === 'worktree' && <input value={worktreePath} aria-label={t.worktreePath} placeholder={t.worktreePath} onChange={event => { setWorktreePath(event.target.value) }} />}
            </MetaField>
            <MetaField label={t.sessions}>
              <button type="button" disabled={project?.workspaceId === undefined || (task.status !== 'todo' && task.status !== 'in_progress')} title={project?.workspaceId === undefined ? t.workspaceRequired : task.status !== 'todo' && task.status !== 'in_progress' ? t.sessionTaskMustBeActive : undefined} onClick={() => { void openNewSession() }}>{t.newSession}</button>
              {detail === undefined || detail.claims.length === 0 ? <p className="dsh-taskboard-muted">{t.noneYet}</p> : detail.claims.map(item => {
                const runtime = detail.sessionRuntime?.find(value => value.sessionId === item.sessionId)
                return <article key={item.id} className="dsh-taskboard-side-item"><button type="button" className="dsh-taskboard-link" onClick={() => { void openSession(item.sessionId) }}>{t.openSession}: {item.sessionId}</button><small>{item.state} · {runtime?.status ?? t.offline}{runtime?.current === true ? ` · ${t.current}` : ''}</small></article>
              })}
            </MetaField>
            <div className="dsh-taskboard-actions">
              {task.status === 'in_review' && <button type="button" onClick={() => { setPendingAction('return') }}>{t.returnWork}</button>}
              {(task.status === 'todo' || task.status === 'in_progress') && <button type="button" onClick={() => { setPendingAction('block') }}>{t.blocked}</button>}
              {(['backlog', 'in_review', 'blocked'] as const).includes(task.status as never) && <button type="button" onClick={() => { void mutate('task.cancel', { taskId: task.id, expectedVersion: currentVersion }) }}>{t.closeIssue}</button>}
              {detail?.activeClaim !== undefined && <button type="button" onClick={() => { setPendingAction('takeover') }}>{t.takeover}</button>}
              {task.archivedAt === undefined ? <button type="button" onClick={() => { void mutate('task.archive', { taskId: task.id, expectedVersion: currentVersion }) }}>{t.archive}</button> : <button type="button" onClick={() => { void mutate('task.restore', { taskId: task.id, expectedVersion: currentVersion }) }}>{t.restore}</button>}
              {task.archivedAt !== undefined && <button type="button" aria-expanded={confirmDelete} onClick={() => { setConfirmDelete(value => !value) }}>{t.delete}</button>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function MarkdownText({ value }: { value: string }) {
  const blocks = useMemo(() => parseMarkdown(value), [value])
  return <div className="dsh-taskboard-markdown">{blocks.map((block, index) => <MarkdownBlockView key={index} block={block} />)}</div>
}

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  if (block.type === 'heading') {
    const children = <MarkdownInlines nodes={block.children} />
    if (block.level === 1) return <h1>{children}</h1>
    if (block.level === 2) return <h2>{children}</h2>
    if (block.level === 3) return <h3>{children}</h3>
    return <h4>{children}</h4>
  }
  if (block.type === 'paragraph') return <p><MarkdownInlines nodes={block.children} /></p>
  if (block.type === 'code') return <pre><code>{block.value}</code></pre>
  if (block.type === 'blockquote') return <blockquote>{block.children.map((child, index) => <MarkdownBlockView key={index} block={child} />)}</blockquote>
  if (block.type === 'list') {
    const items = block.items.map((item, index) => <li key={index}><MarkdownInlines nodes={item} /></li>)
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
  }
  return <hr />
}

function MarkdownInlines({ nodes }: { nodes: readonly MarkdownInline[] }) {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <span key={index}>{node.value}</span>
    if (node.type === 'code') return <code key={index}>{node.value}</code>
    if (node.type === 'strong') return <strong key={index}><MarkdownInlines nodes={node.children} /></strong>
    if (node.type === 'em') return <em key={index}><MarkdownInlines nodes={node.children} /></em>
    if (node.type === 'del') return <del key={index}><MarkdownInlines nodes={node.children} /></del>
    if (node.type === 'image') return <img key={index} src={node.src} alt={node.alt} />
    const external = /^https?:/i.test(node.href)
    return <a key={index} href={node.href} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}><MarkdownInlines nodes={node.children} /></a>
  })
}

/** Browser plugin registration; generated Remote contribution and both slots unwind together. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const remote = ctx.get('remote') as unknown as TypertClientRemote
  const locale = ctx.get('locale') as unknown as TaskboardLocaleRuntime
  const unbindLocale = bindTaskboardLocale(locale)
  const unregisterCopy = locale.register(TASKBOARD_LOCALE_NS, taskboardLocales)
  const unmountRemote = await remote.$mount(taskboardRemote)
  ctx.inject(['remote.taskboard'], (remoteCtx) => {
    const sessions = remoteCtx.get('sessions') as unknown as ISessions
    const workspaces = remoteCtx.get('workspaces') as unknown as IWorkspaces
    const conversation = remoteCtx.get('conversation') as unknown as ConversationDraftPort
    const mountedRemote = remoteCtx.get('remote') as unknown as TypertClientRemote
    const refreshSessions = (sessions as unknown as { refresh?: () => Promise<void> }).refresh
    const sessionNavigator: TaskSessionNavigator = {
      list: sessions.list as unknown as TaskSessionNavigator['list'],
      refresh: async () => {
        if (refreshSessions === undefined) throw new Error('Native Session list refresh is unavailable')
        await refreshSessions.call(sessions)
      },
      open: sessionId => { sessions.open(sessionId as never) },
    }
    const controller = new TaskboardClientController(
      connection,
      mountedRemote.taskboard,
      sessionId => openTaskSession(sessionNavigator, sessionId),
      async (workspaceId, draft) => {
        const sessionId = await workspaces.connectWorkspace(workspaceId as never)
        const scoped = sessions.scope(sessionId)
        if (scoped === undefined) throw new Error(`Unable to resolve the new Session ${sessionId}`)
        conversation.input.for(scoped).setDraft(draft)
        sessions.open(sessionId)
        return sessionId
      },
    )
    // Close the page when the user navigates to another Session: the shell's
    // session navigation is store-based (not hash-based), so it never clears
    // the Taskboard hash on its own.
    const sessionList = sessions.list
    let previousSession = sessionList.getSnapshot().current
    const offSessions = sessionList.subscribe(() => {
      const next = sessionList.getSnapshot().current
      if (next !== previousSession) {
        previousSession = next
        if (controller.getSnapshot().open) controller.close()
      }
    })
    remoteCtx.effect(() => () => { controller.dispose(); offSessions() }, 'taskboard client controller')
    const Nav = (props: PropsRuntime<'sidebar.footer.action'>) => <TaskboardNavButton {...props} controller={controller} />
    const Page = (props: PropsRuntime<'shell.overlay'>) => <TaskboardPage {...props} controller={controller} workspaces={workspaces} />
    remoteCtx.slots.inject('sidebar.footer.action', () => remoteCtx.slots.register({ name: 'sidebar.footer.action', id: 'taskboard.navigation' }, Nav))
    remoteCtx.slots.inject('shell.overlay', () => remoteCtx.slots.register({ name: 'shell.overlay', id: 'taskboard.page' }, Page))
  })
  return async () => {
    unbindLocale()
    unregisterCopy()
    await unmountRemote()
  }
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
`
