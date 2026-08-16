/** DeepSeek Harness host plugin for the native local Taskboard. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TaskboardService } from './service/index.js'
import { registerTaskboardTools } from './tool/index.js'
import { TaskboardAutomationCoordinator } from './automation/index.js'
import { HarnessTaskboardWorker } from './execution/index.js'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-workspace'

export * from './domain/index.js'
export * from './service/index.js'
export * from './sqlite/index.js'
export * from './tool/index.js'
export * from './workflow/index.js'
export * from './automation/index.js'
export * from './execution/index.js'

export const name = 'taskboard'

export interface Config {
  readonly databasePath: string
  readonly attachmentRoot: string
  readonly pageSize?: number
  readonly maxAttachmentBytes?: number
  readonly maxTaskAttachmentBytes?: number
  readonly allowedAttachmentTypes?: string[]
  readonly minAutomationIntervalMs?: number
  readonly maxProjectWorkers?: number
  readonly maxGlobalWorkers?: number
  readonly allowSharedWorktrees?: boolean
  readonly clientRefreshIntervalMs?: number
  readonly maxChangeWaiters?: number
  readonly maxChangeWatchMs?: number
  readonly defaultAgentPreset?: string
  readonly defaultModelRoute?: string
}

export const Config: z<Config> = z.object({
  databasePath: z.string().required(),
  attachmentRoot: z.string().required(),
  pageSize: z.natural().min(1).max(500).default(100),
  maxAttachmentBytes: z.natural().min(1).default(25 * 1024 * 1024),
  maxTaskAttachmentBytes: z.natural().min(1).default(100 * 1024 * 1024),
  allowedAttachmentTypes: z.array(z.string()).default([
    'application/json', 'application/octet-stream', 'application/pdf', 'application/zip',
    'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/markdown', 'text/plain',
  ]),
  minAutomationIntervalMs: z.natural().min(1_000).default(30_000),
  maxProjectWorkers: z.natural().min(1).default(2),
  maxGlobalWorkers: z.natural().min(1).default(4),
  allowSharedWorktrees: z.boolean().default(false),
  clientRefreshIntervalMs: z.natural().min(1_000).max(300_000).default(15_000),
  maxChangeWaiters: z.natural().min(1).max(1_024).default(128),
  maxChangeWatchMs: z.natural().min(1_000).max(60_000).default(30_000),
  defaultAgentPreset: z.string().default('standard'),
  defaultModelRoute: z.string(),
})

/** Mount the Taskboard service and optional loopback Web RPC adapter. */
export function apply(ctx: Context, config: Config): void {
  const service = new TaskboardService(ctx, config)
  ctx.inject(['tools'], (toolCtx) => { registerTaskboardTools(toolCtx, service) })
  ctx.inject(['agents', 'goals', 'workspaceRegistry', 'agentPresets', 'agentDefaultModel'], (nativeCtx) => {
    const worker = new HarnessTaskboardWorker(nativeCtx, service)
    const automation = new TaskboardAutomationCoordinator(service, worker)
    nativeCtx.effect(() => {
      let stopping = false
      void worker.reconcile().then(
        () => { if (!stopping) automation.start() },
        error => { nativeCtx.logger.warn(`taskboard startup reconciliation failed: ${String(error)}`) },
      )
      return async () => {
        stopping = true
        await automation.stop()
        await worker.stop()
      }
    }, 'taskboard: Agent execution and automation lifecycle')
  })
}
