import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  formatTaskboardStorageLog,
  resolveTaskboardStoragePath,
} from '../src/sqlite/paths.js'

test('keeps :memory: and absolute paths unchanged', () => {
  const memory = resolveTaskboardStoragePath(':memory:')
  assert.deepEqual(memory, { configured: ':memory:', path: ':memory:', source: 'memory', created: false })

  const absolute = resolve('/var/taskboard/board.sqlite')
  const missing = resolveTaskboardStoragePath(absolute, { exists: () => false })
  assert.equal(missing.path, absolute)
  assert.equal(missing.source, 'absolute')
  assert.equal(missing.created, true)

  const present = resolveTaskboardStoragePath(absolute, { exists: path => path === absolute })
  assert.equal(present.created, false)
  assert.equal(present.source, 'absolute')
})

test('keeps an already-created cwd-relative database even without a git project', () => {
  const cwd = resolve('/Users/someone/.claude')
  const existing = resolve(cwd, '.dsh/taskboard.sqlite')
  const resolved = resolveTaskboardStoragePath('.dsh/taskboard.sqlite', {
    cwd,
    home: resolve('/Users/someone'),
    exists: path => path === existing,
  })
  assert.equal(resolved.path, existing)
  assert.equal(resolved.source, 'existing')
  assert.equal(resolved.created, false)
})

test('resolves a relative path against the nearest git root, not a nested cwd', () => {
  const root = resolve('/Users/someone/work/app')
  const cwd = resolve(root, 'src')
  const git = resolve(root, '.git')
  const resolved = resolveTaskboardStoragePath('.dsh/taskboard.sqlite', {
    cwd,
    home: resolve('/Users/someone'),
    exists: path => path === git,
  })
  assert.equal(resolved.path, resolve(root, '.dsh/taskboard.sqlite'))
  assert.equal(resolved.source, 'git-root')
  assert.equal(resolved.created, true)
})

test('falls back to the user data directory when cwd is not a git project', () => {
  const cwd = resolve('/Users/someone/.claude')
  const home = resolve('/Users/someone')
  const resolved = resolveTaskboardStoragePath('.dsh/taskboard.sqlite', {
    cwd,
    home,
    exists: () => false,
  })
  assert.equal(resolved.path, resolve(home, '.dsh/taskboard.sqlite'))
  assert.equal(resolved.source, 'user-data')
  assert.equal(resolved.created, true)
  assert.notEqual(resolved.path, resolve(cwd, '.dsh/taskboard.sqlite'))
})

test('honors DSH_HOME / userDataDir for the non-project fallback', () => {
  const resolved = resolveTaskboardStoragePath('.dsh/taskboard-attachments', {
    cwd: resolve('/tmp/no-git'),
    userDataDir: resolve('/custom/dsh'),
    exists: () => false,
  })
  assert.equal(resolved.path, resolve('/custom/dsh/taskboard-attachments'))
  assert.equal(resolved.source, 'user-data')
})

test('logs fallback and new-database creation with the absolute path', () => {
  const path = resolve('/Users/someone/.dsh/taskboard.sqlite')
  const lines = formatTaskboardStorageLog({
    configured: '.dsh/taskboard.sqlite',
    path,
    source: 'user-data',
    created: true,
  }, 'database')
  assert.deepEqual(lines, [
    `taskboard database path: ${path}`,
    `taskboard cwd is not a git project; using user data directory for database: ${path}`,
    `taskboard database created at ${path}`,
  ])
})
