import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TaskboardError } from '../domain/error.js'

export const TASKBOARD_SCHEMA_VERSION = 4

/** Per-parent lookup indexes. Without these, task detail alone drives three full table scans. */
const LOOKUP_INDEXES: readonly { readonly table: string; readonly sql: string }[] = [
  { table: 'comments', sql: 'CREATE INDEX IF NOT EXISTS comments_task_time ON comments(task_id, created_at)' },
  { table: 'attachments', sql: 'CREATE INDEX IF NOT EXISTS attachments_task_time ON attachments(task_id, created_at)' },
  { table: 'attachments', sql: 'CREATE INDEX IF NOT EXISTS attachments_comment ON attachments(comment_id)' },
  { table: 'task_relations', sql: 'CREATE INDEX IF NOT EXISTS relations_source_time ON task_relations(source_task_id, created_at)' },
  { table: 'task_relations', sql: 'CREATE INDEX IF NOT EXISTS relations_target_time ON task_relations(target_task_id, created_at)' },
  { table: 'task_claims', sql: 'CREATE INDEX IF NOT EXISTS claims_state_time ON task_claims(state, claimed_at)' },
  { table: 'automation_runs', sql: 'CREATE INDEX IF NOT EXISTS automation_runs_rule_time ON automation_runs(rule_id, created_at)' },
  { table: 'tasks', sql: 'CREATE INDEX IF NOT EXISTS tasks_workflow ON tasks(workflow_id) WHERE workflow_id IS NOT NULL' },
]

const ALL_LOOKUP_INDEX_DDL = LOOKUP_INDEXES.map(index => `${index.sql};`).join('\n')

/** Skip indexes whose table is absent so one partially-created database cannot block the upgrade. */
function lookupIndexDdl(db: DatabaseSync): string {
  const present = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map(row => row.name))
  return LOOKUP_INDEXES.filter(index => present.has(index.table)).map(index => `${index.sql};`).join('\n')
}

/** Open and initialize the authoritative Taskboard database. */
export function openTaskboardDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (row.user_version > TASKBOARD_SCHEMA_VERSION || row.user_version < 0) {
    db.close()
    throw new TaskboardError(
      `taskboard schema ${row.user_version} is unsupported; expected ${TASKBOARD_SCHEMA_VERSION}`,
      'STORAGE_SCHEMA_UNSUPPORTED',
      { onDisk: row.user_version, supported: TASKBOARD_SCHEMA_VERSION },
    )
  }
  if (row.user_version === 0) initialize(db)
  else if (row.user_version === 1) migrateV1ToV2(db)
  if (row.user_version === 1 || row.user_version === 2) migrateV2ToV3(db)
  if (row.user_version >= 1 && row.user_version <= 3) migrateV3ToV4(db)
  return db
}

function migrateV3ToV4(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    ${lookupIndexDdl(db)}
    PRAGMA user_version = 4;
    COMMIT;
  `)
}

function migrateV1ToV2(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE attachment_cleanup (
      storage_key TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    PRAGMA user_version = 2;
    COMMIT;
  `)
}

function migrateV2ToV3(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE task_claims ADD COLUMN automation_id TEXT;
    PRAGMA user_version = 3;
    COMMIT;
  `)
}

function initialize(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE taskboard_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      global_revision INTEGER NOT NULL
    ) STRICT;
    INSERT INTO taskboard_meta(singleton, global_revision) VALUES (1, 0);

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      workspace_id TEXT,
      labels_json TEXT NOT NULL,
      next_issue_number INTEGER NOT NULL,
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      identifier TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('backlog','todo','in_progress','in_review','blocked','done','canceled')),
      priority TEXT NOT NULL CHECK (priority IN ('urgent','high','medium','low','none')),
      labels_json TEXT NOT NULL,
      sort_order REAL NOT NULL,
      assignee TEXT,
      creator TEXT NOT NULL,
      start_date TEXT,
      due_date TEXT,
      recurrence_json TEXT,
      workflow_id TEXT,
      development_context_json TEXT,
      source_json TEXT,
      archived_at INTEGER,
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX tasks_project_status_order ON tasks(project_id, status, sort_order, created_at);

    CREATE TABLE task_claims (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      automation_id TEXT,
      expected_task_version INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('active','orphaned','released','submitted','reclaimed')),
      development_context_json TEXT,
      claimed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX task_one_active_claim ON task_claims(task_id) WHERE state IN ('active','orphaned');

    CREATE TABLE task_relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('parent','blocks','related')),
      actor_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(source_task_id, target_task_id, kind),
      CHECK(source_task_id <> target_task_id)
    ) STRICT;
    CREATE UNIQUE INDEX task_one_parent ON task_relations(source_task_id) WHERE kind = 'parent';

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      author_id TEXT NOT NULL,
      session_id TEXT,
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE task_activities (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX task_activity_time ON task_activities(task_id, created_at, id);

    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE attachment_cleanup (
      storage_key TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE workflow_workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      document_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE automation_rules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      config_json TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      last_decision_json TEXT,
      next_eligible_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE automation_runs (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
      decision_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    ${ALL_LOOKUP_INDEX_DDL}
    PRAGMA user_version = ${TASKBOARD_SCHEMA_VERSION};
    COMMIT;
  `)
}
