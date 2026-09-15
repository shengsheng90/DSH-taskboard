import { existsSync, writeFileSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export const DEFAULT_TASKBOARD_DATABASE_PATH = '.dsh/taskboard.sqlite'
export const DEFAULT_TASKBOARD_ATTACHMENT_ROOT = '.dsh/taskboard-attachments'

/** `existing`, `git-root` and `user-data` are the bases a relative path can bind to. */
export type TaskboardStorageSource = 'memory' | 'absolute' | 'existing' | 'git-root' | 'user-data'
export type TaskboardStorageBaseSource = Extract<TaskboardStorageSource, 'existing' | 'git-root' | 'user-data'>

export interface ResolvedTaskboardStoragePath {
  readonly configured: string
  readonly path: string
  readonly source: TaskboardStorageSource
  /** The path was already on disk when it was resolved. */
  readonly existed: boolean
}

/**
 * The database and the attachment root resolved together. They share one base so a half-deleted
 * store can never split the authority rows from the bytes they point at.
 */
export interface TaskboardStorageLayout {
  readonly database: ResolvedTaskboardStoragePath
  readonly attachments: ResolvedTaskboardStoragePath
  /** Directory the relative members resolved against; absent when neither member is relative. */
  readonly base?: string
  readonly baseSource?: TaskboardStorageBaseSource
}

export interface ResolveTaskboardStorageOptions {
  readonly cwd?: string
  readonly home?: string
  readonly userDataDir?: string
  readonly exists?: (path: string) => boolean
}

export interface WriteTaskboardStorageIgnoreOptions {
  readonly exists?: (path: string) => boolean
  readonly write?: (path: string, content: string) => void
}

interface StorageBase {
  readonly directory: string
  readonly source: TaskboardStorageBaseSource
}

const STORAGE_IGNORE_CONTENT = [
  '# Written by dsh-taskboard. The local Taskboard store is machine state, not project source.',
  '*',
  '',
].join('\n')

/** `parent` is `child` or an ancestor of it. */
function contains(parent: string, child: string): boolean {
  const step = relative(parent, child)
  return step === '' || (step !== '..' && !step.startsWith(`..${sep}`) && !isAbsolute(step))
}

function walkUp(start: string, match: (directory: string) => boolean): string | undefined {
  let current = resolve(start)
  const { root } = parse(current)
  for (;;) {
    if (match(current)) return current
    if (current === root) return undefined
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * A git root holds work unless it holds configuration: the home directory itself, anything above
 * it (`/Users`, `/`), or a dot-directory inside it (`~/.claude`, `~/.config/...`, `~/.dsh`). Those
 * are exactly the directories a Host inherits by accident, and a versioned `~/.claude` is common
 * enough that finding `.git` there says nothing about the operator wanting a taskboard in it.
 */
export function isProjectGitRoot(root: string, home: string): boolean {
  const gitRoot = resolve(root)
  const userHome = resolve(home)
  if (contains(gitRoot, userHome)) return false
  if (!contains(userHome, gitRoot)) return true
  return relative(userHome, gitRoot).split(sep)[0]?.startsWith('.') !== true
}

/** Walk up from `start` and return the nearest directory that contains `.git`. */
export function findGitRoot(start: string, exists: (path: string) => boolean = existsSync): string | undefined {
  return walkUp(start, current => exists(join(current, '.git')))
}

/**
 * The nearest git root above `start` that is a project. Configuration roots are skipped rather
 * than ending the walk, so a versioned `~/.claude` inside a versioned `~` still resolves to
 * neither of them.
 */
export function findProjectGitRoot(
  start: string,
  home: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  return walkUp(start, current => exists(join(current, '.git')) && isProjectGitRoot(current, home))
}

function isRelativeConfigured(configured: string): boolean {
  return configured !== ':memory:' && !isAbsolute(configured)
}

function resolveBase(
  relatives: readonly string[],
  options: ResolveTaskboardStorageOptions,
  exists: (path: string) => boolean,
): StorageBase {
  const cwd = resolve(options.cwd ?? process.cwd())
  const home = resolve(options.home ?? osHomedir())
  // A store already sitting in the startup cwd keeps working, wherever it came from. Only the
  // anchor decides — the database when it is relative, the attachment root otherwise — because
  // the authority rows are the store; an attachment directory left behind by a deleted database
  // is not one, and following it would pin the board to the polluted directory forever.
  const anchor = relatives[0]
  if (anchor !== undefined && exists(resolve(cwd, anchor))) return { directory: cwd, source: 'existing' }
  const projectRoot = findProjectGitRoot(cwd, home, exists)
  if (projectRoot !== undefined) return { directory: projectRoot, source: 'git-root' }
  // No project: write to the operator's data directory, never to a cwd nobody chose.
  const userDataDir = options.userDataDir ?? process.env['DSH_HOME'] ?? join(home, '.dsh')
  return { directory: resolve(cwd, userDataDir), source: 'user-data' }
}

function place(
  configured: string,
  base: StorageBase | undefined,
  exists: (path: string) => boolean,
): ResolvedTaskboardStoragePath {
  if (configured === ':memory:') return { configured, path: ':memory:', source: 'memory', existed: true }
  if (isAbsolute(configured)) {
    const path = resolve(configured)
    return { configured, path, source: 'absolute', existed: exists(path) }
  }
  // Unreachable: every caller resolves a base before placing a relative path. Loud rather than
  // silently reintroducing `resolve(configured)`, which is what bound the store to the cwd.
  if (base === undefined) throw new Error('taskboard storage base is required for a relative path')
  // The user data directory is flat; keeping a configured `.dsh/` prefix would nest it pointlessly.
  const path = base.source === 'user-data'
    ? resolve(base.directory, basename(configured))
    : resolve(base.directory, configured)
  return { configured, path, source: base.source, existed: exists(path) }
}

/**
 * Resolve the Taskboard store.
 *
 * `:memory:` and absolute paths are used as given. Relative paths are project-local: they bind to
 * the nearest git project above the cwd, not to the cwd itself, because a Host inherits its cwd
 * from whatever started it. A database that already exists at the cwd-relative location is kept so
 * stores created before this rule are not abandoned, and a cwd with no project behind it falls
 * back to `$DSH_HOME` (default `~/.dsh`) instead of being polluted.
 */
export function resolveTaskboardStorage(
  databasePath: string,
  attachmentRoot: string,
  options: ResolveTaskboardStorageOptions = {},
): TaskboardStorageLayout {
  const exists = options.exists ?? existsSync
  const relatives = [databasePath, attachmentRoot].filter(isRelativeConfigured)
  const base = relatives.length === 0 ? undefined : resolveBase(relatives, options, exists)
  const database = place(databasePath, base, exists)
  const attachments = place(attachmentRoot, base, exists)
  return base === undefined
    ? { database, attachments }
    : { database, attachments, base: base.directory, baseSource: base.source }
}

/**
 * Resolve one configured path. Prefer {@link resolveTaskboardStorage}: resolving the database and
 * the attachment root separately lets them land under different bases.
 */
export function resolveTaskboardStoragePath(
  configured: string,
  options: ResolveTaskboardStorageOptions = {},
): ResolvedTaskboardStoragePath {
  return resolveTaskboardStorage(configured, configured, options).database
}

/**
 * Startup diagnostics. An operator must be able to answer "where is my board, and did this process
 * just create one?" from the log alone — the silent empty database is the whole complaint.
 *
 * Every line is written at one severity on purpose. In this Logger `warn` is level 2 and the
 * default exporter cutoff is 1, so a warning would be *quieter* than an info line, not louder.
 */
export function taskboardStorageLog(layout: TaskboardStorageLayout): string[] {
  const lines: string[] = []
  if (layout.baseSource === 'user-data') {
    lines.push(`taskboard cwd is not a git project; storing data under ${String(layout.base)}`)
  }
  if (layout.database.source !== 'memory') lines.push(`taskboard database path: ${layout.database.path}`)
  lines.push(`taskboard attachments path: ${layout.attachments.path}`)
  if (layout.database.source !== 'memory' && !layout.database.existed) {
    lines.push(`taskboard database created at ${layout.database.path}`)
  }
  return lines
}

/**
 * Keep a project-local store out of the operator's `git status`. Only an existing dot-directory
 * below the project root is marked — never the project root, never a directory the project also
 * uses for source — and an existing `.gitignore` is left alone. Returns the files written.
 */
export function writeTaskboardStorageIgnore(
  layout: TaskboardStorageLayout,
  options: WriteTaskboardStorageIgnoreOptions = {},
): string[] {
  const base = layout.base
  if (layout.baseSource !== 'git-root' || base === undefined) return []
  const exists = options.exists ?? existsSync
  const write = options.write ?? ((path, content) => { writeFileSync(path, content, { flag: 'wx' }) })
  const directories = new Set<string>()
  for (const entry of [layout.database, layout.attachments]) {
    if (entry.source !== 'git-root') continue
    const head = entry.configured.split(/[/\\]/)[0]
    if (head === undefined || !head.startsWith('.') || head === '.' || head === '..') continue
    directories.add(resolve(base, head))
  }
  const written: string[] = []
  for (const directory of directories) {
    if (directory === base || !contains(base, directory) || !exists(directory)) continue
    const marker = join(directory, '.gitignore')
    if (exists(marker)) continue
    try {
      write(marker, STORAGE_IGNORE_CONTENT)
      written.push(marker)
    } catch {
      // A read-only project, or a marker another process just wrote, must not block startup.
    }
  }
  return written
}
