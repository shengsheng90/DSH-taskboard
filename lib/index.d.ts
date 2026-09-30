/** DeepSeek Harness host plugin for the native local Taskboard. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export * from './domain/index.js';
export * from './service/index.js';
export * from './sqlite/index.js';
export * from './tool/index.js';
export * from './workflow/index.js';
export * from './automation/index.js';
export * from './execution/index.js';
export declare const name = "taskboard";
export interface Config {
    readonly databasePath: string;
    readonly attachmentRoot: string;
    readonly pageSize?: number;
    readonly snapshotTaskLimit?: number;
    readonly maxAttachmentBytes?: number;
    readonly maxTaskAttachmentBytes?: number;
    readonly allowedAttachmentTypes?: string[];
    readonly minAutomationIntervalMs?: number;
    readonly maxProjectWorkers?: number;
    readonly maxGlobalWorkers?: number;
    readonly allowSharedWorktrees?: boolean;
    readonly clientRefreshIntervalMs?: number;
    readonly maxChangeWaiters?: number;
    readonly maxChangeWatchMs?: number;
    readonly defaultAgentPreset?: string;
    readonly defaultModelRoute?: string;
}
export declare const Config: z<Config>;
/** Mount the Taskboard service and optional loopback Web RPC adapter. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map