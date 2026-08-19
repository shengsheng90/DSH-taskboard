import { TaskboardError } from '../domain/index.js'
import type { AutomationRule, TaskboardTask } from '../domain/index.js'
import type { TaskboardService } from '../service/index.js'

export type QuotaState = 'available' | 'uncertain'

export interface TaskboardAutomationWorker {
  start(rule: AutomationRule, task: TaskboardTask): Promise<void>
}

export interface TaskboardQuotaPolicy {
  state(rule: AutomationRule): Promise<QuotaState>
}

const DEFAULT_QUOTA: TaskboardQuotaPolicy = { state: () => Promise.resolve('available') }

/** Host-owned durable scheduler that starts work but never steals an existing claim. */
export class TaskboardAutomationCoordinator {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly inFlight = new Set<Promise<void>>()
  private readonly inFlightByRule = new Map<string, Set<Promise<void>>>()
  private readonly draining = new Set<string>()
  private readonly runningByProject = new Map<string, number>()
  private running = false
  private rescanQueued = false
  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly taskboard: TaskboardService,
    private readonly worker: TaskboardAutomationWorker,
    private readonly quota: TaskboardQuotaPolicy = DEFAULT_QUOTA,
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.unsubscribe = this.taskboard.provider.subscribe(event => {
      // Task activities carry taskId. Generic revisions cover project,
      // workflow, and automation rows; coalesce them before re-projecting all
      // durable rules so newly enabled rules start without a Host restart.
      if (event.taskId === undefined) this.queueRescan()
    })
    this.rescan()
  }

  refresh(rule: AutomationRule): void {
    this.cancelTimer(rule.id)
    if (this.running) this.schedule(rule)
  }

  async runNow(ruleId: string): Promise<void> {
    await this.tick(ruleId)
  }

  /** Extra drain that starts eligible work now without moving the durable schedule. */
  async runImmediate(ruleId: string): Promise<void> {
    if (this.draining.has(ruleId)) return
    const scheduledAt = this.taskboard.provider.getAutomation(ruleId).nextEligibleAt
    this.draining.add(ruleId)
    try {
      await this.drain(ruleId, this.running, {
        preserveSchedule: true,
        ...(scheduledAt === undefined ? {} : { scheduledAt }),
      })
    } finally {
      this.draining.delete(ruleId)
      if (this.running) {
        const latest = this.taskboard.provider.getAutomation(ruleId)
        this.schedule(scheduledAt === undefined ? latest : { ...latest, nextEligibleAt: scheduledAt })
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.rescanQueued = false
    this.draining.clear()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.allSettled([...this.inFlight])
  }

  private schedule(rule: AutomationRule): void {
    if (!this.running || rule.state !== 'enabled' || this.draining.has(rule.id)) return
    const at = rule.nextEligibleAt ?? Date.now()
    const delay = Math.min(Math.max(0, at - Date.now()), 2_147_483_647)
    const timer = setTimeout(() => {
      this.timers.delete(rule.id)
      void this.tick(rule.id)
    }, delay)
    this.timers.set(rule.id, timer)
  }

  private queueRescan(): void {
    if (!this.running || this.rescanQueued) return
    this.rescanQueued = true
    queueMicrotask(() => {
      this.rescanQueued = false
      if (this.running) this.rescan()
    })
  }

  private rescan(): void {
    const rules = this.taskboard.provider.listAutomations()
    const activeIds = new Set(rules.filter(rule => rule.state === 'enabled').map(rule => String(rule.id)))
    for (const id of this.timers.keys()) if (!activeIds.has(id)) this.cancelTimer(id)
    for (const rule of rules) this.refresh(rule)
  }

  private async tick(ruleId: string): Promise<void> {
    if (this.draining.has(ruleId)) return
    this.draining.add(ruleId)
    this.cancelTimer(ruleId)
    const coordinatorActive = this.running
    try {
      await this.drain(ruleId, coordinatorActive)
    } finally {
      this.draining.delete(ruleId)
    }
  }

  private async drain(
    ruleId: string,
    coordinatorActive: boolean,
    options: { readonly preserveSchedule?: boolean; readonly scheduledAt?: number } = {},
  ): Promise<void> {
    const preserve = options.preserveSchedule === true
    const kept = options.scheduledAt
    while (this.draining.has(ruleId)) {
      if (coordinatorActive && !this.running) return
      let rule = this.taskboard.provider.getAutomation(ruleId)
      if (!preserve && rule.state !== 'enabled') return
      const quota = await this.quota.state(rule)
      if (quota === 'uncertain' && rule.config.quotaPolicy === 'pause-on-uncertain') {
        rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
          kind: 'quota-paused', message: 'quota state is uncertain; no new claims started', at: Date.now(),
        }, preserve ? kept : undefined, preserve ? undefined : 'paused')
        if (!preserve) this.refresh(rule)
        return
      }
      const inFlight = this.ruleInFlight(ruleId)
      const slots = this.availableSlots(rule)
      if (slots === 0) {
        if (inFlight.size === 0) {
          rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
            kind: 'empty', message: 'worker concurrency is currently full', at: Date.now(),
          }, preserve ? kept : Date.now() + rule.config.intervalMs)
          if (!preserve) this.schedule(rule)
          return
        }
        await Promise.race(inFlight)
        continue
      }
      const candidates = this.taskboard.provider.listTasks({ projectId: rule.projectId, statuses: ['todo'], limit: 500 })
      if (candidates.length === 0) {
        if (inFlight.size > 0) {
          await Promise.allSettled([...inFlight])
          continue
        }
        const pause = !preserve && rule.config.autoPauseOnEmpty
        rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
          kind: 'empty', message: 'no eligible todo tasks', at: Date.now(),
        }, preserve ? kept : (pause ? undefined : Date.now() + rule.config.intervalMs), pause ? 'paused' : preserve ? undefined : 'enabled')
        if (!preserve) this.schedule(rule)
        return
      }
      let started = 0
      let dependencyBlocked = 0
      for (const task of candidates) {
        if (started >= slots) break
        try {
          this.startWorker(rule, task)
          started += 1
          rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
            kind: 'claimed', taskId: task.id, message: `worker started for ${task.identifier}`, at: Date.now(),
          }, preserve ? kept : undefined)
        } catch (error) {
          if (error instanceof TaskboardError && error.code === 'TASK_DEPENDENCY_INCOMPLETE') dependencyBlocked += 1
          else throw error
        }
      }
      if (started > 0) continue
      if (inFlight.size > 0) {
        await Promise.race(inFlight)
        continue
      }
      rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
        kind: dependencyBlocked > 0 ? 'dependency-blocked' : 'empty',
        message: dependencyBlocked > 0 ? 'todo tasks are waiting for dependencies' : 'no worker started',
        at: Date.now(),
      }, preserve ? kept : Date.now() + rule.config.intervalMs)
      if (!preserve) this.schedule(rule)
      return
    }
  }

  private availableSlots(rule: AutomationRule): number {
    const globalAvailable = Math.max(0, this.taskboard.config.maxGlobalWorkers - this.inFlight.size)
    const projectRunning = this.runningByProject.get(rule.projectId) ?? 0
    const projectAvailable = Math.max(0, this.taskboard.config.maxProjectWorkers - projectRunning)
    // The rule's own limit counts the rule's own workers. Measuring it against the project total
    // let a sibling rule in the same project silently consume this rule's budget.
    const ruleAvailable = Math.max(0, rule.config.concurrencyLimit - this.ruleInFlight(String(rule.id)).size)
    return Math.min(globalAvailable, projectAvailable, ruleAvailable)
  }

  private ruleInFlight(ruleId: string): Set<Promise<void>> {
    const existing = this.inFlightByRule.get(ruleId)
    if (existing !== undefined) return existing
    const created = new Set<Promise<void>>()
    this.inFlightByRule.set(ruleId, created)
    return created
  }

  private startWorker(rule: AutomationRule, task: TaskboardTask): void {
    const projectId = String(rule.projectId)
    const ruleId = String(rule.id)
    this.runningByProject.set(projectId, (this.runningByProject.get(projectId) ?? 0) + 1)
    let run: Promise<void>
    try {
      run = this.worker.start(rule, task)
    } catch (error) {
      this.decrement(projectId)
      throw error
    }
    const ruleTracking = this.ruleInFlight(ruleId)
    const tracked = run.catch(async (error: unknown) => {
      const latest = this.taskboard.provider.getAutomation(rule.id)
      if (latest.state === 'enabled') {
        this.taskboard.provider.recordAutomationDecision(latest.id, latest.version, {
          kind: 'error', taskId: task.id, message: error instanceof Error ? error.message : String(error), at: Date.now(),
        }, latest.nextEligibleAt)
      }
    }).finally(() => {
      this.inFlight.delete(tracked)
      ruleTracking.delete(tracked)
      // Drop the per-rule bucket once it empties so a deleted rule leaves nothing behind.
      if (ruleTracking.size === 0) this.inFlightByRule.delete(ruleId)
      this.decrement(projectId)
    })
    this.inFlight.add(tracked)
    ruleTracking.add(tracked)
  }

  private decrement(projectId: string): void {
    const next = Math.max(0, (this.runningByProject.get(projectId) ?? 1) - 1)
    if (next === 0) this.runningByProject.delete(projectId)
    else this.runningByProject.set(projectId, next)
  }

  private cancelTimer(ruleId: string): void {
    const timer = this.timers.get(ruleId)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(ruleId)
  }
}
