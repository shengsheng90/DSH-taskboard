import type { AutomationRule, TaskboardTask } from '../domain/index.js';
import type { TaskboardService } from '../service/index.js';
export type QuotaState = 'available' | 'uncertain';
export interface TaskboardAutomationWorker {
    start(rule: AutomationRule, task: TaskboardTask): Promise<void>;
}
export interface TaskboardQuotaPolicy {
    state(rule: AutomationRule): Promise<QuotaState>;
}
export declare const AUTOMATION_CANDIDATE_PAGE_SIZE = 500;
/** Host-owned durable scheduler that starts work but never steals an existing claim. */
export declare class TaskboardAutomationCoordinator {
    private readonly taskboard;
    private readonly worker;
    private readonly quota;
    private readonly timers;
    private readonly inFlight;
    private readonly inFlightByRule;
    private readonly draining;
    private readonly runningByProject;
    private running;
    private rescanQueued;
    private unsubscribe;
    constructor(taskboard: TaskboardService, worker: TaskboardAutomationWorker, quota?: TaskboardQuotaPolicy);
    start(): void;
    refresh(rule: AutomationRule): void;
    runNow(ruleId: string): Promise<void>;
    /** Extra drain that starts eligible work now without moving the durable schedule. */
    runImmediate(ruleId: string): Promise<void>;
    stop(): Promise<void>;
    private schedule;
    private queueRescan;
    private rescan;
    private tick;
    private reschedule;
    private drain;
    private availableSlots;
    private ruleInFlight;
    private startWorker;
    /** Record a decision against the row's current version.
     *  Workers settle while `drain()` awaits, so the version it read before an await is routinely
     *  stale by the time it writes; a compare-and-set on that stale value threw out of the round. */
    private record;
    private decrement;
    private cancelTimer;
}
//# sourceMappingURL=index.d.ts.map