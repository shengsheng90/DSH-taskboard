#!/usr/bin/env node
export declare const TASKBOARD_CLI_SCHEMA_VERSION = 1;
export declare const CLI_EXIT_USAGE = 2;
export declare const CLI_EXIT_UNAVAILABLE = 3;
export declare const CLI_EXIT_API = 4;
export declare const CLI_EXIT_CONFLICT = 5;
export interface CliIo {
    stdout(value: string): void;
    stderr(value: string): void;
}
/** Run one versioned JSON CLI command without triggering a model turn. */
export declare function runTaskboardCli(argv: readonly string[], io: CliIo): number;
//# sourceMappingURL=cli.d.ts.map