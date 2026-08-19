import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { openTaskboardDatabase, TASKBOARD_SCHEMA_VERSION, TaskboardError } from '../src/index.js'

test('migrates the previous schema monotonically and adds claim automation ownership', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-schema-'))
  const path = join(directory, 'taskboard.sqlite')
  const old = new DatabaseSync(path)
  old.exec(`
    CREATE TABLE task_claims (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      expected_task_version INTEGER NOT NULL,
      state TEXT NOT NULL,
      development_context_json TEXT,
      claimed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body TEXT NOT NULL,
      author_id TEXT NOT NULL,
      session_id TEXT,
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    PRAGMA user_version = 2;
  `)
  old.close()
  const migrated = openTaskboardDatabase(path)
  try {
    const version = migrated.prepare('PRAGMA user_version').get() as { user_version: number }
    const columns = migrated.prepare('PRAGMA table_info(task_claims)').all() as Array<{ name: string }>
    assert.equal(version.user_version, TASKBOARD_SCHEMA_VERSION)
    assert.ok(columns.some(column => column.name === 'automation_id'))
    // v4 adds lookup indexes, and skips any whose table is absent from a partial database.
    const indexes = new Set((migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[])
      .map(row => row.name))
    assert.ok(indexes.has('claims_state_time'))
    assert.ok(indexes.has('comments_task_time'))
    assert.ok(!indexes.has('attachments_task_time'))
  } finally {
    migrated.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('refuses a database created by an unsupported future schema', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-future-schema-'))
  const path = join(directory, 'taskboard.sqlite')
  const future = new DatabaseSync(path)
  future.exec(`PRAGMA user_version = ${TASKBOARD_SCHEMA_VERSION + 1}`)
  future.close()
  try {
    assert.throws(
      () => openTaskboardDatabase(path),
      (error: unknown) => error instanceof TaskboardError && error.code === 'STORAGE_SCHEMA_UNSUPPORTED',
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
