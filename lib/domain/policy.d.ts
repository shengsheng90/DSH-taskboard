import { type TaskStatus, type TaskboardActor } from './types.js';
/** Parse a UI/CLI status token into the closed Taskboard vocabulary. */
export declare function parseTaskStatus(value: string): TaskStatus;
/** Assert that an operation carries direct human authority. */
export declare function requireHuman(actor: TaskboardActor, operation: string): asserts actor is Extract<TaskboardActor, {
    kind: 'human';
}>;
/** Validate a source status for one intent-specific transition. */
export declare function requireStatus(current: TaskStatus, allowed: readonly TaskStatus[], operation: string): void;
/** Return whether an operation is reserved for humans. */
export declare function isHumanOnlyOperation(operation: string): boolean;
//# sourceMappingURL=policy.d.ts.map