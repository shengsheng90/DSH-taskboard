#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AutomationId, CommentId, ProjectId, SqliteTaskboardProvider, TASKBOARD_SCHEMA_VERSION, TaskId, TaskboardError,
  WorkflowNodeRegistry, parseTaskStatus,
} from './index.js'
import type {
  AutomationRuleConfig, AutomationState, CreateTaskRequest, FreshClaimRequest, HumanActor, RelationKind, TaskStatus,
  UpdateProjectRequest, UpdateTaskRequest, WorkflowDocument,
} from './index.js'

export const TASKBOARD_CLI_SCHEMA_VERSION = 1
export const CLI_EXIT_USAGE = 2
export const CLI_EXIT_UNAVAILABLE = 3
export const CLI_EXIT_API = 4
export const CLI_EXIT_CONFLICT = 5

export interface CliIo {
  stdout(value: string): void
  stderr(value: string): void
}

function output(value: unknown): string {
  return `${JSON.stringify({ schemaVersion: TASKBOARD_CLI_SCHEMA_VERSION, value })}\n`
}

function errorOutput(error: unknown): string {
  if (error instanceof TaskboardError) {
    return `${JSON.stringify({ schemaVersion: TASKBOARD_CLI_SCHEMA_VERSION, error: { code: error.code, message: error.message, details: error.details ?? {} } })}\n`
  }
  return `${JSON.stringify({ schemaVersion: TASKBOARD_CLI_SCHEMA_VERSION, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } })}\n`
}

function flags(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith('--')) continue
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) throw new Error(`option ${token} requires a value`)
    result.set(token.slice(2), next)
    index += 1
  }
  return result
}

function required(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name)
  if (value === undefined || value.trim().length === 0) throw new Error(`--${name} is required`)
  return value
}

function version(options: ReadonlyMap<string, string>): number {
  const value = Number(required(options, 'version'))
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('--version must be a positive integer')
  return value
}

function positiveInteger(options: ReadonlyMap<string, string>, name: string, fallback: number): number {
  const raw = options.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`)
  return value
}

function jsonOption<T>(options: ReadonlyMap<string, string>, name: string): T {
  const value = required(options, name)
  try {
    return JSON.parse(value) as T
  } catch (cause) {
    throw new Error(`--${name} must be valid JSON: ${String(cause)}`)
  }
}

function human(options: ReadonlyMap<string, string>): HumanActor {
  return { kind: 'human', actorId: options.get('actor') ?? 'human:cli' }
}

function workTarget(options: ReadonlyMap<string, string>): 'todo' | 'in_progress' {
  const target = options.get('target') ?? 'todo'
  if (target !== 'todo' && target !== 'in_progress') throw new Error('--target must be todo or in_progress')
  return target
}

function freshClaim(options: ReadonlyMap<string, string>, target: 'todo' | 'in_progress'): FreshClaimRequest | undefined {
  if (target === 'todo') return undefined
  const sessionId = required(options, 'session')
  return { sessionId, agentId: options.get('agent') ?? sessionId }
}

function usage(): string {
  return [
    'usage: dsh-taskboard [--database PATH] <group> <command> [options]',
    'groups: project, task, relation, attachment, workflow, automation, storage',
    'all mutations except creates require --version with the exact current task/project version',
  ].join('\n')
}

/** Run one versioned JSON CLI command without triggering a model turn. */
export function runTaskboardCli(argv: readonly string[], io: CliIo): number {
  const args = [...argv]
  const groupAt = args.findIndex(value => !value.startsWith('--') && (args[args.indexOf(value) - 1]?.startsWith('--') !== true))
  if (groupAt < 0) {
    io.stderr(`${usage()}\n`)
    return CLI_EXIT_USAGE
  }
  const group = args[groupAt]
  const command = args[groupAt + 1]
  if (command === undefined) {
    io.stderr(`${usage()}\n`)
    return CLI_EXIT_USAGE
  }
  let options: Map<string, string>
  try {
    options = flags(args)
  } catch (error) {
    io.stderr(errorOutput(error))
    return CLI_EXIT_USAGE
  }
  const database = options.get('database') ?? process.env['DSH_TASKBOARD_DATABASE'] ?? '.dsh/taskboard.sqlite'
  const attachmentRoot = options.get('attachment-root') ?? process.env['DSH_TASKBOARD_ATTACHMENT_ROOT'] ?? '.dsh/taskboard-attachments'
  let provider: SqliteTaskboardProvider
  try {
    provider = new SqliteTaskboardProvider(database, {
      root: attachmentRoot,
      maxAttachmentBytes: positiveInteger(options, 'max-attachment-bytes', 25 * 1024 * 1024),
      maxTaskAttachmentBytes: positiveInteger(options, 'max-task-attachment-bytes', 100 * 1024 * 1024),
      allowedContentTypes: (options.get('allowed-content-types')
        ?? process.env['DSH_TASKBOARD_ALLOWED_CONTENT_TYPES']
        ?? 'application/json,application/octet-stream,application/pdf,application/zip,image/gif,image/jpeg,image/png,image/webp,text/markdown,text/plain')
        .split(',').map(value => value.trim()).filter(Boolean),
    })
  } catch (error) {
    io.stderr(errorOutput(error))
    return CLI_EXIT_UNAVAILABLE
  }
  try {
    const actor = human(options)
    const workflowNodes = new WorkflowNodeRegistry()
    let value: unknown
    if (group === 'project' && command === 'list') {
      value = provider.listProjects()
    } else if (group === 'project' && command === 'get') {
      value = provider.getProject(ProjectId(required(options, 'project')))
    } else if (group === 'project' && command === 'create') {
      value = provider.createProject({
        key: required(options, 'key'), name: required(options, 'name'),
        ...(options.has('workspace') ? { workspaceId: required(options, 'workspace') } : {}),
        ...(options.has('labels') ? { labels: required(options, 'labels').split(',').map(value => value.trim()).filter(Boolean) } : {}),
      }, actor)
    } else if (group === 'project' && command === 'update') {
      value = provider.updateProject(
        ProjectId(required(options, 'project')), version(options),
        jsonOption<UpdateProjectRequest>(options, 'request-json'), actor,
      )
    } else if (group === 'project' && command === 'delete') {
      value = provider.deleteProject(ProjectId(required(options, 'project')), version(options), actor)
    } else if (group === 'task' && command === 'list') {
      const statuses = options.get('status')?.split(',').filter(Boolean) as TaskStatus[] | undefined
      value = provider.listTasks({
        projectId: ProjectId(required(options, 'project')),
        ...(statuses === undefined ? {} : { statuses }),
        includeArchived: options.get('archived') === 'true',
        ...(options.has('search') ? { search: required(options, 'search') } : {}),
      })
    } else if (group === 'task' && command === 'get') {
      value = provider.getTaskDetail(provider.getTask(required(options, 'task')).id)
    } else if (group === 'task' && command === 'create') {
      const request = options.has('request-json')
        ? jsonOption<CreateTaskRequest>(options, 'request-json')
        : {
            projectId: ProjectId(required(options, 'project')),
            title: required(options, 'title'),
            creator: options.get('creator') ?? actor.actorId,
            ...(options.has('description') ? { description: required(options, 'description') } : {}),
            ...(options.has('status') ? { status: required(options, 'status') as 'backlog' | 'todo' } : {}),
          }
      value = provider.createTask(request, actor)
    } else if (group === 'task' && command === 'update') {
      value = provider.updateTask(
        TaskId(required(options, 'task')), version(options), jsonOption<UpdateTaskRequest>(options, 'request-json'), actor,
      )
    } else if (group === 'task' && command === 'approve') {
      value = provider.approve(TaskId(required(options, 'task')), version(options), actor)
    } else if (group === 'task' && command === 'accept') {
      value = provider.accept(TaskId(required(options, 'task')), version(options), actor)
    } else if (group === 'task' && command === 'move') {
      const sortOrder = options.get('sort-order')
      value = provider.moveStatus(
        TaskId(required(options, 'task')), version(options), parseTaskStatus(required(options, 'status')), actor,
        sortOrder === undefined ? undefined : Number(sortOrder),
      )
    } else if (group === 'task' && command === 'return') {
      const target = workTarget(options)
      value = provider.returnForRework(
        TaskId(required(options, 'task')), version(options), target,
        required(options, 'comment'), actor, freshClaim(options, target),
      )
    } else if (group === 'task' && command === 'block') {
      value = provider.block(TaskId(required(options, 'task')), version(options), required(options, 'reason'), actor)
    } else if (group === 'task' && command === 'resume') {
      const target = workTarget(options)
      value = provider.resume(
        TaskId(required(options, 'task')), version(options), actor, target, freshClaim(options, target),
      )
    } else if (group === 'task' && command === 'cancel') {
      value = provider.cancel(TaskId(required(options, 'task')), version(options), actor)
    } else if (group === 'task' && command === 'reopen') {
      value = provider.reopen(TaskId(required(options, 'task')), version(options), required(options, 'reason'), actor)
    } else if (group === 'task' && command === 'archive') {
      value = provider.archive(TaskId(required(options, 'task')), version(options), actor)
    } else if (group === 'task' && command === 'restore') {
      value = provider.restore(TaskId(required(options, 'task')), version(options), actor)
    } else if (group === 'task' && command === 'force-takeover') {
      value = provider.forceTakeover(
        TaskId(required(options, 'task')), version(options), required(options, 'reason'), actor,
      )
    } else if (group === 'task' && command === 'delete') {
      value = provider.deleteTask(TaskId(required(options, 'task')), version(options), actor)
    } else if (group === 'task' && command === 'comment') {
      value = provider.comment(TaskId(required(options, 'task')), version(options), required(options, 'body'), actor)
    } else if (group === 'relation' && command === 'add') {
      value = provider.addRelation(
        TaskId(required(options, 'source')), version(options), TaskId(required(options, 'target')),
        required(options, 'kind') as RelationKind, actor,
      )
    } else if (group === 'relation' && command === 'delete') {
      value = provider.removeRelation(required(options, 'relation'), version(options), actor)
    } else if (group === 'attachment' && command === 'list') {
      value = provider.listAttachments(TaskId(required(options, 'task')))
    } else if (group === 'attachment' && command === 'add') {
      const path = required(options, 'file')
      const size = statSync(path).size
      const max = positiveInteger(options, 'max-attachment-bytes', 25 * 1024 * 1024)
      if (size > max) throw new TaskboardError('attachment exceeds the configured per-file limit', 'ATTACHMENT_SIZE_EXCEEDED', { actual: size, limit: max })
      value = provider.createAttachment(TaskId(required(options, 'task')), version(options), {
        filename: options.get('filename') ?? basename(path),
        contentType: required(options, 'content-type'),
        bytes: readFileSync(path),
        ...(options.has('comment') ? { commentId: CommentId(required(options, 'comment')) } : {}),
      }, actor)
    } else if (group === 'attachment' && command === 'download') {
      const downloaded = provider.readAttachment(required(options, 'attachment'), 'attachment')
      const path = required(options, 'output')
      writeFileSync(path, downloaded.bytes, { flag: 'wx', mode: 0o600 })
      value = { attachment: downloaded.attachment, output: path, byteSize: downloaded.bytes.byteLength }
    } else if (group === 'attachment' && command === 'delete') {
      value = provider.deleteAttachment(
        TaskId(required(options, 'task')), required(options, 'attachment'), version(options), actor,
      )
    } else if (group === 'workflow' && command === 'list') {
      value = provider.listWorkflows(ProjectId(required(options, 'project')))
    } else if (group === 'workflow' && command === 'get') {
      value = provider.getWorkflow(required(options, 'workflow'))
    } else if (group === 'workflow' && command === 'create') {
      const document = jsonOption<WorkflowDocument>(options, 'document-json')
      workflowNodes.validate(document)
      value = provider.createWorkflow(
        ProjectId(required(options, 'project')), required(options, 'name'),
        document, actor,
      )
    } else if (group === 'workflow' && command === 'update') {
      const document = jsonOption<WorkflowDocument>(options, 'document-json')
      workflowNodes.validate(document)
      value = provider.updateWorkflow(
        required(options, 'workflow'), version(options), required(options, 'name'),
        document, actor,
      )
    } else if (group === 'workflow' && command === 'delete') {
      value = provider.deleteWorkflow(required(options, 'workflow'), version(options), actor)
    } else if (group === 'automation' && command === 'list') {
      value = provider.listAutomations(options.has('project') ? ProjectId(required(options, 'project')) : undefined)
    } else if (group === 'automation' && command === 'get') {
      value = provider.getAutomation(required(options, 'automation'))
    } else if (group === 'automation' && command === 'create') {
      value = provider.createAutomation(
        ProjectId(required(options, 'project')), jsonOption<AutomationRuleConfig>(options, 'config-json'), actor,
      )
    } else if (group === 'automation' && command === 'update') {
      const update = {
        ...(options.has('config-json') ? { config: jsonOption<AutomationRuleConfig>(options, 'config-json') } : {}),
        ...(options.has('state') ? { state: required(options, 'state') as AutomationState } : {}),
      }
      if (update.config === undefined && update.state === undefined) throw new Error('automation update requires --config-json or --state')
      if (update.state !== undefined && update.state !== 'enabled' && update.state !== 'paused') throw new Error('--state must be enabled or paused')
      value = provider.updateAutomation(AutomationId(required(options, 'automation')), version(options), update, actor)
    } else if (group === 'storage' && command === 'status') {
      const cleanup = provider.retryAttachmentCleanup()
      value = {
        database,
        attachmentRoot,
        ...provider.storageHealth(),
        attachmentCleanup: cleanup,
      }
    } else {
      throw new Error(`unknown command ${String(group)} ${String(command)}`)
    }
    io.stdout(output(value))
    return 0
  } catch (error) {
    io.stderr(errorOutput(error))
    if (error instanceof TaskboardError && error.code === 'TASK_STALE_VERSION') return CLI_EXIT_CONFLICT
    return error instanceof TaskboardError ? CLI_EXIT_API : CLI_EXIT_USAGE
  } finally {
    provider.close()
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = runTaskboardCli(process.argv.slice(2), {
    stdout: value => { process.stdout.write(value) },
    stderr: value => { process.stderr.write(value) },
  })
}
