import { existsSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'

export const DEFAULT_TASKBOARD_DATABASE_PATH = '.dsh/taskboard.sqlite'
export const DEFAULT_TASKBOARD_ATTACHMENT_ROOT = '.dsh/taskboard-attachments'

export type TaskboardStorageSource = 'memory' | 'absolute' | 'existing' | 'git-root' | 'user-data'
export type TaskboardStorageKind = 'database' | 'attachments'

export interface ResolvedTaskboardStoragePath {
  readonly configured: string
  readonly path: string
  readonly source: TaskboardStorageSource
  readonly created: boolean
}

export interface ResolveTaskboardStorageOptions {
  readonly cwd?: string
  readonly home?: string
  readonly userDataDir?: string
  readonly exists?: (path: string) => boolean
}

/** Walk up from `start` and return the nearest directory that contains `.git`. */
export function findGitRoot(start: string, exists: (path: string) => boolean = existsSync): string | undefined {
  let current = resolve(start)
  const { root } = parse(current)
  for (;;) {
    if (exists(join(current, '.git'))) return current
    if (current === root) return undefined
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Resolve a configured Taskboard storage path.
 *
 * Relative paths are project-local: they bind to the nearest git root, not the
 * process cwd. A cwd-relative file that already exists is kept so previously
 * created databases are not abandoned. When no git project is found, the path
 * falls back to `$DSH_HOME/<basename>` or `~/.dsh/<basename>`.
 */
export function resolveTaskboardStoragePath(
  configured: string,
  options: ResolveTaskboardStorageOptions = {},
): ResolvedTaskboardStoragePath {
  if (configured === ':memory:') {
    return { configured, path: ':memory:', source: 'memory', created: false }
  }
  const exists = options.exists ?? existsSync
  if (isAbsolute(configured)) {
    const path = resolve(configured)
    return { configured, path, source: 'absolute', created: !exists(path) }
  }
  const cwd = options.cwd ?? process.cwd()
  const cwdPath = resolve(cwd, configured)
  if (exists(cwdPath)) {
    return { configured, path: cwdPath, source: 'existing', created: false }
  }
  const gitRoot = findGitRoot(cwd, exists)
  if (gitRoot !== undefined) {
    const path = resolve(gitRoot, configured)
    return { configured, path, source: 'git-root', created: !exists(path) }
  }
  const userDataDir = options.userDataDir ?? process.env['DSH_HOME'] ?? join(options.home ?? osHomedir(), '.dsh')
  const path = resolve(userDataDir, basename(configured))
  return { configured, path, source: 'user-data', created: !exists(path) }
}

export function formatTaskboardStorageLog(
  resolved: ResolvedTaskboardStoragePath,
  kind: TaskboardStorageKind,
): string[] {
  const lines = [`taskboard ${kind} path: ${resolved.path}`]
  if (resolved.source === 'user-data') {
    lines.push(`taskboard cwd is not a git project; using user data directory for ${kind}: ${resolved.path}`)
  }
  if (kind === 'database' && resolved.created) {
    lines.push(`taskboard database created at ${resolved.path}`)
  }
  return lines
}
