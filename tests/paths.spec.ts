import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  isProjectGitRoot, resolveTaskboardStorage, resolveTaskboardStoragePath, taskboardStorageLog,
  writeTaskboardStorageIgnore,
} from '../src/sqlite/paths.js'
import type { TaskboardStorageLayout } from '../src/sqlite/paths.js'

const HOME = resolve('/Users/someone')
const DATABASE = '.dsh/taskboard.sqlite'
const ATTACHMENTS = '.dsh/taskboard-attachments'

/** Resolve the default store against a fake tree: `present` is everything that exists on disk. */
function layoutAt(cwd: string, present: readonly string[], userDataDir?: string): TaskboardStorageLayout {
  const existing = new Set(present.map(value => resolve(value)))
  return resolveTaskboardStorage(DATABASE, ATTACHMENTS, {
    cwd, home: HOME, exists: path => existing.has(resolve(path)),
    ...(userDataDir === undefined ? {} : { userDataDir }),
  })
}

test('keeps :memory: and absolute paths unchanged', () => {
  const memory = resolveTaskboardStoragePath(':memory:')
  assert.deepEqual(memory, { configured: ':memory:', path: ':memory:', source: 'memory', existed: true })

  const absolute = resolve('/var/taskboard/board.sqlite')
  const missing = resolveTaskboardStoragePath(absolute, { exists: () => false })
  assert.equal(missing.path, absolute)
  assert.equal(missing.source, 'absolute')
  assert.equal(missing.existed, false)

  const present = resolveTaskboardStoragePath(absolute, { exists: path => path === absolute })
  assert.equal(present.existed, true)
  assert.equal(present.source, 'absolute')
})

test('keeps a store that already sits in the startup cwd', () => {
  const cwd = join(HOME, '.claude')
  const resolved = layoutAt(cwd, [join(cwd, DATABASE)])
  assert.equal(resolved.database.path, resolve(cwd, DATABASE))
  assert.equal(resolved.database.source, 'existing')
  assert.equal(resolved.database.existed, true)
})

test('binds a relative store to the project root, not to a nested cwd', () => {
  const root = join(HOME, 'work/app')
  const resolved = layoutAt(join(root, 'src/sqlite'), [join(root, '.git')])
  assert.equal(resolved.base, root)
  assert.equal(resolved.baseSource, 'git-root')
  assert.equal(resolved.database.path, join(root, DATABASE))
  assert.equal(resolved.database.existed, false)
})

test('does not mistake a versioned configuration directory for a project', () => {
  // issue #23: `~/.claude` under version control is common, and finding `.git` there says nothing
  // about the operator wanting a taskboard in it. Walking up must skip it, not stop at it.
  const cwd = join(HOME, '.claude')
  const versioned = layoutAt(cwd, [join(cwd, '.git'), join(HOME, '.git')])
  assert.equal(versioned.baseSource, 'user-data')
  assert.equal(versioned.database.path, join(HOME, '.dsh/taskboard.sqlite'))
  assert.notEqual(versioned.database.path, join(cwd, DATABASE))

  assert.equal(isProjectGitRoot(join(HOME, '.claude'), HOME), false)
  assert.equal(isProjectGitRoot(join(HOME, '.config/nvim'), HOME), false)
  assert.equal(isProjectGitRoot(HOME, HOME), false)
  assert.equal(isProjectGitRoot(resolve('/Users'), HOME), false)
  assert.equal(isProjectGitRoot(resolve('/'), HOME), false)
  assert.equal(isProjectGitRoot(join(HOME, 'work/app'), HOME), true)
  assert.equal(isProjectGitRoot(resolve('/srv/app'), HOME), true)
})

test('falls back to the user data directory when the cwd has no project', () => {
  const cwd = join(HOME, 'Downloads/scratch')
  const resolved = layoutAt(cwd, [])
  assert.equal(resolved.baseSource, 'user-data')
  assert.equal(resolved.database.path, join(HOME, '.dsh/taskboard.sqlite'))
  assert.equal(resolved.attachments.path, join(HOME, '.dsh/taskboard-attachments'))
  assert.notEqual(resolved.database.path, resolve(cwd, DATABASE))
})

test('honors an explicit user data directory for the non-project fallback', () => {
  const resolved = layoutAt(resolve('/tmp/no-git'), [], resolve('/custom/dsh'))
  assert.equal(resolved.baseSource, 'user-data')
  assert.equal(resolved.database.path, resolve('/custom/dsh/taskboard.sqlite'))
  assert.equal(resolved.attachments.path, resolve('/custom/dsh/taskboard-attachments'))
})

test('resolves the database and the attachment root against a single base', () => {
  // A half-deleted store must not split the authority rows from the bytes they point at, and an
  // attachment directory whose database is gone must not pin the board to a polluted directory.
  const cwd = join(HOME, '.claude')
  const orphaned = layoutAt(cwd, [join(cwd, ATTACHMENTS)])
  assert.equal(orphaned.baseSource, 'user-data')
  assert.equal(orphaned.database.path, join(HOME, '.dsh/taskboard.sqlite'))
  assert.equal(orphaned.attachments.path, join(HOME, '.dsh/taskboard-attachments'))

  // With an absolute database the attachment root is the anchor, so its bytes are never orphaned.
  const pinned = resolveTaskboardStorage(resolve('/var/board.sqlite'), ATTACHMENTS, {
    cwd, home: HOME, exists: path => resolve(path) === resolve(cwd, ATTACHMENTS),
  })
  assert.equal(pinned.attachments.path, resolve(cwd, ATTACHMENTS))

  const root = join(HOME, 'work/app')
  const project = layoutAt(join(root, 'src'), [join(root, '.git')])
  assert.equal(project.database.path, join(root, DATABASE))
  assert.equal(project.attachments.path, join(root, ATTACHMENTS))

  const mixed = resolveTaskboardStorage(resolve('/var/board.sqlite'), ATTACHMENTS, {
    cwd: join(HOME, 'Downloads'), home: HOME, exists: () => false,
  })
  assert.equal(mixed.database.source, 'absolute')
  assert.equal(mixed.attachments.path, join(HOME, '.dsh/taskboard-attachments'))
})

test('reports the resolved store and a database it had to create', () => {
  const fallback = layoutAt(join(HOME, 'Downloads/scratch'), [])
  assert.deepEqual(taskboardStorageLog(fallback), [
    `taskboard cwd is not a git project; storing data under ${join(HOME, '.dsh')}`,
    `taskboard database path: ${join(HOME, '.dsh/taskboard.sqlite')}`,
    `taskboard attachments path: ${join(HOME, '.dsh/taskboard-attachments')}`,
    `taskboard database created at ${join(HOME, '.dsh/taskboard.sqlite')}`,
  ])

  const reopened = layoutAt(join(HOME, '.claude'), [join(HOME, '.claude', DATABASE)])
  assert.deepEqual(taskboardStorageLog(reopened).filter(line => line.includes('created at')), [])

  const memory = resolveTaskboardStorage(':memory:', resolve('/var/attachments'), { exists: () => true })
  assert.deepEqual(taskboardStorageLog(memory), ['taskboard attachments path: /var/attachments'])
})

test('marks a project-local store as ignored without touching the project itself', () => {
  const root = join(HOME, 'work/app')
  const project = layoutAt(join(root, 'src'), [join(root, '.git')])
  const written: Array<[string, string]> = []
  const collect = (path: string, content: string): void => { written.push([path, content]) }

  assert.deepEqual(
    writeTaskboardStorageIgnore(project, { exists: path => path === join(root, '.dsh'), write: collect }),
    [join(root, '.dsh/.gitignore')],
  )
  assert.equal(written.length, 1)
  assert.match(written[0]?.[1] ?? '', /^#[^\n]*\n\*\n$/)

  // The directory has to exist already: resolving a store must not create one.
  assert.deepEqual(writeTaskboardStorageIgnore(project, { exists: () => false, write: collect }), [])
  // An existing marker is the operator's.
  assert.deepEqual(writeTaskboardStorageIgnore(project, { exists: () => true, write: collect }), [])
  assert.equal(written.length, 1)
})

test('never writes an ignore marker outside a dedicated directory', () => {
  const root = join(HOME, 'work/app')
  const exists = (path: string): boolean => path === join(root, '.git')
  // Everything the marker could need is on disk, so only the directory rules can refuse a write.
  const onDisk = { exists: (path: string): boolean => !path.endsWith('.gitignore'), write: (): void => {} }

  const bare = resolveTaskboardStorage('board.sqlite', 'attachments', { cwd: root, home: HOME, exists })
  assert.equal(bare.baseSource, 'git-root')
  assert.deepEqual(writeTaskboardStorageIgnore(bare, onDisk), [])

  const shared = resolveTaskboardStorage('data/board.sqlite', 'data/attachments', { cwd: root, home: HOME, exists })
  assert.equal(shared.baseSource, 'git-root')
  assert.deepEqual(writeTaskboardStorageIgnore(shared, onDisk), [])

  const fallback = layoutAt(join(HOME, 'Downloads'), [])
  assert.deepEqual(writeTaskboardStorageIgnore(fallback, { exists: () => true, write: () => {} }), [])

  const cwd = join(HOME, '.claude')
  const kept = layoutAt(cwd, [join(cwd, DATABASE)])
  assert.deepEqual(writeTaskboardStorageIgnore(kept, { exists: () => true, write: () => {} }), [])
})

test('resolving a store never creates anything on disk', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-taskboard-cwd-'))
  const home = mkdtempSync(join(tmpdir(), 'dsh-taskboard-home-'))
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })
  const resolved = resolveTaskboardStorage(DATABASE, ATTACHMENTS, { cwd, home, userDataDir: join(home, '.dsh') })
  assert.equal(resolved.baseSource, 'user-data')
  assert.equal(resolved.database.path, join(home, '.dsh/taskboard.sqlite'))
  assert.equal(existsSync(join(cwd, '.dsh')), false)
  assert.equal(existsSync(join(home, '.dsh')), false)
})

test('writes a real ignore marker into a project-local store directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-taskboard-project-'))
  t.after(() => { rmSync(root, { recursive: true, force: true }) })
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, '.dsh'))
  const resolved = resolveTaskboardStorage(DATABASE, ATTACHMENTS, { cwd: root, home: tmpdir() })
  assert.equal(resolved.baseSource, 'git-root')

  assert.deepEqual(writeTaskboardStorageIgnore(resolved), [join(root, '.dsh/.gitignore')])
  assert.match(readFileSync(join(root, '.dsh/.gitignore'), 'utf8'), /^#[^\n]*\n\*\n$/)

  // Rerunning is a no-op, and an operator's own marker survives.
  writeFileSync(join(root, '.dsh/.gitignore'), 'mine\n')
  assert.deepEqual(writeTaskboardStorageIgnore(resolved), [])
  assert.equal(readFileSync(join(root, '.dsh/.gitignore'), 'utf8'), 'mine\n')
})
