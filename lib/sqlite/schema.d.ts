import { DatabaseSync } from 'node:sqlite';
export declare const TASKBOARD_SCHEMA_VERSION = 4;
/** Open and initialize the authoritative Taskboard database. */
export declare function openTaskboardDatabase(path: string): DatabaseSync;
//# sourceMappingURL=schema.d.ts.map