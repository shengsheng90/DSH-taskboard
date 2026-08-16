import type { TaskboardAutomationId, TaskboardProjectId } from './ids.js'

export type AutomationState = 'enabled' | 'paused'

export interface AutomationRuleConfig {
  readonly intervalMs: number
  readonly agentPreset: string
  readonly modelRoute?: string
  readonly reasoning?: string
  readonly concurrencyLimit: number
  readonly quotaPolicy: 'pause-on-uncertain' | 'ignore'
  readonly autoPauseOnEmpty: boolean
}

export interface AutomationDecision {
  readonly kind: 'claimed' | 'empty' | 'dependency-blocked' | 'quota-paused' | 'error'
  readonly taskId?: string
  readonly message: string
  readonly at: number
}

export interface AutomationRule {
  readonly id: TaskboardAutomationId
  readonly projectId: TaskboardProjectId
  readonly config: AutomationRuleConfig
  readonly state: AutomationState
  readonly version: number
  readonly lastDecision?: AutomationDecision
  readonly nextEligibleAt?: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** One durable scheduler tick recorded when a rule reads Todo and decides what to start. */
export interface AutomationRun {
  readonly id: string
  readonly ruleId: TaskboardAutomationId
  readonly decision: AutomationDecision
  readonly createdAt: number
}
