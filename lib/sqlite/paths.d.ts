export declare const DEFAULT_TASKBOARD_DATABASE_PATH = ".dsh/taskboard.sqlite";
export declare const DEFAULT_TASKBOARD_ATTACHMENT_ROOT = ".dsh/taskboard-attachments";
/** `existing`, `git-root` and `user-data` are the bases a relative path can bind to. */
export type TaskboardStorageSource = 'memory' | 'absolute' | 'existing' | 'git-root' | 'user-data';
export type TaskboardStorageBaseSource = Extract<TaskboardStorageSource, 'existing' | 'git-root' | 'user-data'>;
export interface ResolvedTaskboardStoragePath {
    readonly configured: string;
    readonly path: string;
    readonly source: TaskboardStorageSource;
    /** The path was already on disk when it was resolved. */
    readonly existed: boolean;
}
/**
 * The database and the attachment root resolved together. They share one base so a half-deleted
 * store can never split the authority rows from the bytes they point at.
 */
export interface TaskboardStorageLayout {
    readonly database: ResolvedTaskboardStoragePath;
    readonly attachments: ResolvedTaskboardStoragePath;
    /** Directory the relative members resolved against; absent when neither member is relative. */
    readonly base?: string;
    readonly baseSource?: TaskboardStorageBaseSource;
}
export interface ResolveTaskboardStorageOptions {
    readonly cwd?: string;
    readonly home?: string;
    readonly userDataDir?: string;
    readonly exists?: (path: string) => boolean;
}
export interface WriteTaskboardStorageIgnoreOptions {
    readonly exists?: (path: string) => boolean;
    readonly write?: (path: string, content: string) => void;
}
/**
 * A git root holds work unless it holds configuration: the home directory itself, anything above
 * it (`/Users`, `/`), or a dot-directory inside it (`~/.claude`, `~/.config/...`, `~/.dsh`). Those
 * are exactly the directories a Host inherits by accident, and a versioned `~/.claude` is common
 * enough that finding `.git` there says nothing about the operator wanting a taskboard in it.
 */
export declare function isProjectGitRoot(root: string, home: string): boolean;
/** Walk up from `start` and return the nearest directory that contains `.git`. */
export declare function findGitRoot(start: string, exists?: (path: string) => boolean): string | undefined;
/**
 * The nearest git root above `start` that is a project. Configuration roots are skipped rather
 * than ending the walk, so a versioned `~/.claude` inside a versioned `~` still resolves to
 * neither of them.
 */
export declare function findProjectGitRoot(start: string, home: string, exists?: (path: string) => boolean): string | undefined;
/**
 * Resolve the Taskboard store.
 *
 * `:memory:` and absolute paths are used as given. Relative paths are project-local: they bind to
 * the nearest git project above the cwd, not to the cwd itself, because a Host inherits its cwd
 * from whatever started it. A database that already exists at the cwd-relative location is kept so
 * stores created before this rule are not abandoned, and a cwd with no project behind it falls
 * back to `$DSH_HOME` (default `~/.dsh`) instead of being polluted.
 */
export declare function resolveTaskboardStorage(databasePath: string, attachmentRoot: string, options?: ResolveTaskboardStorageOptions): TaskboardStorageLayout;
/**
 * Resolve one configured path. Prefer {@link resolveTaskboardStorage}: resolving the database and
 * the attachment root separately lets them land under different bases.
 */
export declare function resolveTaskboardStoragePath(configured: string, options?: ResolveTaskboardStorageOptions): ResolvedTaskboardStoragePath;
/**
 * Startup diagnostics. An operator must be able to answer "where is my board, and did this process
 * just create one?" from the log alone — the silent empty database is the whole complaint.
 *
 * Every line is written at one severity on purpose. In this Logger `warn` is level 2 and the
 * default exporter cutoff is 1, so a warning would be *quieter* than an info line, not louder.
 */
export declare function taskboardStorageLog(layout: TaskboardStorageLayout): string[];
/**
 * Keep a store out of the operator's `git status`. Only an existing dot-directory below the base
 * is marked — never the base itself, never a directory the project also uses for source — and an
 * existing `.gitignore` is left alone. Returns the files written.
 *
 * Any base git can see qualifies, not only a project root: a store kept by the `existing` rule
 * predates the project-local behaviour and is exactly the one already sitting in someone's
 * working tree. `$DSH_HOME` is not version controlled, so it is skipped.
 */
export declare function writeTaskboardStorageIgnore(layout: TaskboardStorageLayout, options?: WriteTaskboardStorageIgnoreOptions): string[];
//# sourceMappingURL=paths.d.ts.map