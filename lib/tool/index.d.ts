import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { TaskboardService } from '../service/index.js';
/** Build the narrow model-facing tool set. It intentionally contains no accept or generic status mutation. */
export declare function taskboardToolDefinitions(service: TaskboardService): ToolDefinition[];
/** Register Taskboard tools into the active Harness tool runtime. */
export declare function registerTaskboardTools(ctx: Context, service: TaskboardService): void;
//# sourceMappingURL=index.d.ts.map