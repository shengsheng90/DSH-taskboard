import type { Context } from '@deepseek-ai/cordis';
import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { AutomationRule, TaskboardClaim, TaskboardTask } from '../domain/index.js';
import type { TaskboardAutomationWorker } from '../automation/index.js';
import type { TaskboardService } from '../service/index.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        taskboard: {
            readonly kind: 'taskboard';
            readonly taskId: string;
            readonly claimId: string;
            readonly claimedRevision: number;
        };
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Host default used when an automation rule does not name a modelRoute. */
        agentDefaultModel: {
            currentSelection(): ModelSelection;
        };
    }
}
/** Resolve the model an automation worker must install before prompt assembly. */
export declare function resolveAutomationModel(ctx: Context, rule: AutomationRule): ModelSelection;
/** Prefer a short review marker when a result comment already exists. */
export declare function completionResultComment(comments: readonly {
    readonly body: string;
}[]): string;
/** Assigned workflows are durable execution guidance. The editor's executable/design-only marker
 *  describes registered capabilities; it does not make the scheduler an implicit workflow engine. */
export declare function renderWorkflowGuidance(service: TaskboardService, task: TaskboardTask): string;
/** Render the complete durable task instruction admitted to a worker Session. */
export declare function renderTaskInstruction(service: TaskboardService, taskId: string, claim: TaskboardClaim): string;
/** Native Agent/Session worker used by durable project automation. */
export declare class HarnessTaskboardWorker implements TaskboardAutomationWorker {
    private readonly ctx;
    private readonly taskboard;
    private readonly handles;
    constructor(ctx: Context, taskboard: TaskboardService);
    /** Claim synchronously so the scheduler never counts work that lost the transaction race. */
    start(rule: AutomationRule, task: TaskboardTask): Promise<void>;
    /** Mark dead owners explicitly, then resume only claims owned by a still-enabled automation rule. */
    reconcile(): Promise<void>;
    stop(): Promise<void>;
    /** Drop and dispose one tracked Agent handle; safe to call for a session already released. */
    private release;
    /** Release a handle only once its Session no longer owns an active claim. */
    private releaseUnclaimed;
    private launch;
    private onGoalChanged;
    private recordGoalFailure;
    private onTaskChanged;
}
//# sourceMappingURL=index.d.ts.map