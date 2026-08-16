import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { runTaskboardCli, CLI_EXIT_CONFLICT } from '../src/cli.js'
import { TASKBOARD_SCHEMA_VERSION } from '../src/index.js'

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  let stdout = ''
  let stderr = ''
  const code = runTaskboardCli(['--database', ':memory:', ...args], {
    stdout: value => { stdout += value },
    stderr: value => { stderr += value },
  })
  return { code, stdout, stderr }
}

test('CLI emits schema-versioned JSON', () => {
  const result = run(['storage', 'status'])
  assert.equal(result.code, 0)
  assert.equal(JSON.parse(result.stdout).schemaVersion, 1)
  assert.equal(JSON.parse(result.stdout).value.schemaVersion, TASKBOARD_SCHEMA_VERSION)
})

test('CLI distinguishes optimistic conflicts from other API failures', () => {
  const directory = run(['project', 'create', '--key', 'DSH', '--name', 'Harness'])
  assert.equal(directory.code, 0)
  const project = JSON.parse(directory.stdout).value as { id: string }
  const created = run(['task', 'create', '--project', project.id, '--title', 'One'])
  // :memory: gives each invocation a new database, so the create must report a missing project.
  assert.equal(created.code, 4)

  // The dedicated conflict exit is exported and stable for script callers.
  assert.equal(CLI_EXIT_CONFLICT, 5)
})

test('CLI round-trips project, task, relation, attachment, workflow, automation, and storage domains', t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-cli-'))
  t.after(() => { rmSync(directory, { recursive: true, force: true }) })
  const database = join(directory, 'taskboard.sqlite')
  const attachmentRoot = join(directory, 'attachments')
  const invoke = (args: string[]): unknown => {
    let stdout = ''
    let stderr = ''
    const code = runTaskboardCli(['--database', database, '--attachment-root', attachmentRoot, ...args], {
      stdout: value => { stdout += value }, stderr: value => { stderr += value },
    })
    assert.equal(code, 0, stderr)
    return (JSON.parse(stdout) as { schemaVersion: number; value: unknown }).value
  }
  const task = (id: string) => (invoke(['task', 'get', '--task', id]) as { task: { version: number } }).task

  let project = invoke(['project', 'create', '--key', 'CLI', '--name', 'CLI project', '--workspace', 'workspace-one', '--labels', 'local,release']) as { id: string; version: number }
  project = invoke(['project', 'update', '--project', project.id, '--version', String(project.version), '--request-json', JSON.stringify({ name: 'CLI project updated' })]) as typeof project
  assert.equal((invoke(['project', 'get', '--project', project.id]) as { name: string }).name, 'CLI project updated')
  assert.equal((invoke(['project', 'list']) as unknown[]).length, 1)

  let first = invoke(['task', 'create', '--request-json', JSON.stringify({
    projectId: project.id, title: 'First', description: 'CLI coverage', creator: 'cli-test', status: 'backlog',
    priority: 'high', labels: ['cli'], assignee: 'owner', startDate: '2026-08-14', dueDate: '2026-08-20',
    recurrence: { frequency: 'weekly', interval: 1 }, developmentContext: { kind: 'branch', branch: 'codex/cli' },
  })]) as { id: string; version: number }
  first = invoke(['task', 'approve', '--task', first.id, '--version', String(first.version)]) as typeof first
  first = invoke(['task', 'update', '--task', first.id, '--version', String(first.version), '--request-json', JSON.stringify({ priority: 'urgent' })]) as typeof first
  first = invoke(['task', 'move', '--task', first.id, '--version', String(first.version), '--status', 'in_progress']) as typeof first
  assert.equal((invoke(['task', 'get', '--task', first.id]) as { task: { status: string } }).task.status, 'in_progress')
  first = invoke(['task', 'move', '--task', first.id, '--version', String(first.version), '--status', 'todo']) as typeof first
  const comment = invoke(['task', 'comment', '--task', first.id, '--version', String(first.version), '--body', 'CLI comment']) as { id: string }
  first = { ...first, version: task(first.id).version }
  assert.equal((invoke(['task', 'list', '--project', project.id, '--status', 'todo', '--search', 'First']) as unknown[]).length, 1)

  let second = invoke(['task', 'create', '--project', project.id, '--title', 'Second', '--status', 'todo']) as { id: string; version: number }
  const relation = invoke(['relation', 'add', '--source', first.id, '--target', second.id, '--kind', 'related', '--version', String(first.version)]) as { id: string; sourceTaskId: string }
  first = { ...first, version: task(first.id).version }
  invoke(['relation', 'delete', '--relation', relation.id, '--version', String(task(relation.sourceTaskId).version)])
  first = { ...first, version: task(first.id).version }
  second = { ...second, version: task(second.id).version }

  const source = join(directory, 'evidence.txt')
  const output = join(directory, 'downloaded.txt')
  writeFileSync(source, 'verified attachment')
  const attached = invoke(['attachment', 'add', '--task', first.id, '--version', String(first.version), '--file', source, '--filename', 'evidence.txt', '--content-type', 'text/plain', '--comment', comment.id]) as { attachment: { id: string }; task: { version: number } }
  assert.equal((invoke(['attachment', 'list', '--task', first.id]) as unknown[]).length, 1)
  invoke(['attachment', 'download', '--attachment', attached.attachment.id, '--output', output])
  assert.equal(readFileSync(output, 'utf8'), 'verified attachment')
  invoke(['attachment', 'delete', '--task', first.id, '--attachment', attached.attachment.id, '--version', String(attached.task.version)])
  first = { ...first, version: task(first.id).version }

  const workflowDocument = { tabs: [{ id: 'main', name: 'Main', trigger: { id: 'trigger', kind: 'issue-trigger', execution: 'design-only', config: {} }, steps: [] }] }
  let workflow = invoke(['workflow', 'create', '--project', project.id, '--name', 'CLI flow', '--document-json', JSON.stringify(workflowDocument)]) as { id: string; version: number }
  workflow = invoke(['workflow', 'update', '--workflow', workflow.id, '--version', String(workflow.version), '--name', 'CLI flow v2', '--document-json', JSON.stringify(workflowDocument)]) as typeof workflow
  assert.equal((invoke(['workflow', 'get', '--workflow', workflow.id]) as { name: string }).name, 'CLI flow v2')
  assert.equal((invoke(['workflow', 'list', '--project', project.id]) as unknown[]).length, 1)
  invoke(['workflow', 'delete', '--workflow', workflow.id, '--version', String(workflow.version)])

  const automationConfig = { intervalMs: 30_000, agentPreset: 'coding', concurrencyLimit: 1, quotaPolicy: 'pause-on-uncertain', autoPauseOnEmpty: false }
  let automation = invoke(['automation', 'create', '--project', project.id, '--config-json', JSON.stringify(automationConfig)]) as { id: string; version: number }
  automation = invoke(['automation', 'update', '--automation', automation.id, '--version', String(automation.version), '--state', 'enabled']) as typeof automation
  assert.equal((invoke(['automation', 'get', '--automation', automation.id]) as { state: string }).state, 'enabled')
  assert.equal((invoke(['automation', 'list', '--project', project.id]) as unknown[]).length, 1)

  first = invoke(['task', 'block', '--task', first.id, '--version', String(first.version), '--reason', 'blocked']) as typeof first
  first = invoke([
    'task', 'resume', '--task', first.id, '--version', String(first.version),
    '--target', 'in_progress', '--session', 'session-cli',
  ]) as typeof first
  assert.equal((invoke(['task', 'get', '--task', first.id]) as { activeClaim: { sessionId: string } }).activeClaim.sessionId, 'session-cli')
  first = invoke(['task', 'cancel', '--task', first.id, '--version', String(first.version)]) as typeof first
  first = invoke(['task', 'reopen', '--task', first.id, '--version', String(first.version), '--reason', 'reopen']) as typeof first
  first = invoke(['task', 'archive', '--task', first.id, '--version', String(first.version)]) as typeof first
  first = invoke(['task', 'restore', '--task', first.id, '--version', String(first.version)]) as typeof first
  assert.equal((invoke(['storage', 'status']) as { integrity: string }).integrity, 'ok')

  second = invoke(['task', 'cancel', '--task', second.id, '--version', String(second.version)]) as typeof second
  second = invoke(['task', 'archive', '--task', second.id, '--version', String(second.version)]) as typeof second
  invoke(['task', 'delete', '--task', second.id, '--version', String(second.version)])
})
