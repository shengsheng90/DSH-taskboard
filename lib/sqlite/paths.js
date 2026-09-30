import { existsSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
export const DEFAULT_TASKBOARD_DATABASE_PATH = '.dsh/taskboard.sqlite';
export const DEFAULT_TASKBOARD_ATTACHMENT_ROOT = '.dsh/taskboard-attachments';
const STORAGE_IGNORE_CONTENT = [
    '# Written by dsh-taskboard. The local Taskboard store is machine state, not project source.',
    '*',
    '',
].join('\n');
/** `parent` is `child` or an ancestor of it. */
function contains(parent, child) {
    const step = relative(parent, child);
    return step === '' || (step !== '..' && !step.startsWith(`..${sep}`) && !isAbsolute(step));
}
function walkUp(start, match) {
    let current = resolve(start);
    const { root } = parse(current);
    for (;;) {
        if (match(current))
            return current;
        if (current === root)
            return undefined;
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
/**
 * A git root holds work unless it holds configuration: the home directory itself, anything above
 * it (`/Users`, `/`), or a dot-directory inside it (`~/.claude`, `~/.config/...`, `~/.dsh`). Those
 * are exactly the directories a Host inherits by accident, and a versioned `~/.claude` is common
 * enough that finding `.git` there says nothing about the operator wanting a taskboard in it.
 */
export function isProjectGitRoot(root, home) {
    const gitRoot = resolve(root);
    const userHome = resolve(home);
    if (contains(gitRoot, userHome))
        return false;
    if (!contains(userHome, gitRoot))
        return true;
    return relative(userHome, gitRoot).split(sep)[0]?.startsWith('.') !== true;
}
/** Walk up from `start` and return the nearest directory that contains `.git`. */
export function findGitRoot(start, exists = existsSync) {
    return walkUp(start, current => exists(join(current, '.git')));
}
/**
 * The nearest git root above `start` that is a project. Configuration roots are skipped rather
 * than ending the walk, so a versioned `~/.claude` inside a versioned `~` still resolves to
 * neither of them.
 */
export function findProjectGitRoot(start, home, exists = existsSync) {
    return walkUp(start, current => exists(join(current, '.git')) && isProjectGitRoot(current, home));
}
function isRelativeConfigured(configured) {
    return configured !== ':memory:' && !isAbsolute(configured);
}
function resolveBase(relatives, options, exists) {
    const cwd = resolve(options.cwd ?? process.cwd());
    const home = resolve(options.home ?? osHomedir());
    // A store already sitting in the startup cwd keeps working, wherever it came from. Only the
    // anchor decides — the database when it is relative, the attachment root otherwise — because
    // the authority rows are the store; an attachment directory left behind by a deleted database
    // is not one, and following it would pin the board to the polluted directory forever.
    const anchor = relatives[0];
    if (anchor !== undefined && exists(resolve(cwd, anchor)))
        return { directory: cwd, source: 'existing' };
    const projectRoot = findProjectGitRoot(cwd, home, exists);
    if (projectRoot !== undefined)
        return { directory: projectRoot, source: 'git-root' };
    // No project: write to the operator's data directory, never to a cwd nobody chose.
    const userDataDir = options.userDataDir ?? process.env['DSH_HOME'] ?? join(home, '.dsh');
    return { directory: resolve(cwd, userDataDir), source: 'user-data' };
}
function place(configured, base, exists) {
    if (configured === ':memory:')
        return { configured, path: ':memory:', source: 'memory', existed: true };
    if (isAbsolute(configured)) {
        const path = resolve(configured);
        return { configured, path, source: 'absolute', existed: exists(path) };
    }
    // Unreachable: every caller resolves a base before placing a relative path. Loud rather than
    // silently reintroducing `resolve(configured)`, which is what bound the store to the cwd.
    if (base === undefined)
        throw new Error('taskboard storage base is required for a relative path');
    // The user data directory is flat; keeping a configured `.dsh/` prefix would nest it pointlessly.
    const path = base.source === 'user-data'
        ? resolve(base.directory, basename(configured))
        : resolve(base.directory, configured);
    return { configured, path, source: base.source, existed: exists(path) };
}
/**
 * Resolve the Taskboard store.
 *
 * `:memory:` and absolute paths are used as given. Relative paths are project-local: they bind to
 * the nearest git project above the cwd, not to the cwd itself, because a Host inherits its cwd
 * from whatever started it. A database that already exists at the cwd-relative location is kept so
 * stores created before this rule are not abandoned, and a cwd with no project behind it falls
 * back to `$DSH_HOME` (default `~/.dsh`) instead of being polluted.
 */
export function resolveTaskboardStorage(databasePath, attachmentRoot, options = {}) {
    const exists = options.exists ?? existsSync;
    const relatives = [databasePath, attachmentRoot].filter(isRelativeConfigured);
    const base = relatives.length === 0 ? undefined : resolveBase(relatives, options, exists);
    const database = place(databasePath, base, exists);
    const attachments = place(attachmentRoot, base, exists);
    return base === undefined
        ? { database, attachments }
        : { database, attachments, base: base.directory, baseSource: base.source };
}
/**
 * Resolve one configured path. Prefer {@link resolveTaskboardStorage}: resolving the database and
 * the attachment root separately lets them land under different bases.
 */
export function resolveTaskboardStoragePath(configured, options = {}) {
    return resolveTaskboardStorage(configured, configured, options).database;
}
/**
 * Startup diagnostics. An operator must be able to answer "where is my board, and did this process
 * just create one?" from the log alone — the silent empty database is the whole complaint.
 *
 * Every line is written at one severity on purpose. In this Logger `warn` is level 2 and the
 * default exporter cutoff is 1, so a warning would be *quieter* than an info line, not louder.
 */
export function taskboardStorageLog(layout) {
    const lines = [];
    if (layout.baseSource === 'user-data') {
        lines.push(`taskboard cwd is not a git project; storing data under ${String(layout.base)}`);
    }
    if (layout.database.source !== 'memory')
        lines.push(`taskboard database path: ${layout.database.path}`);
    lines.push(`taskboard attachments path: ${layout.attachments.path}`);
    if (layout.database.source !== 'memory' && !layout.database.existed) {
        lines.push(`taskboard database created at ${layout.database.path}`);
    }
    return lines;
}
/**
 * Keep a store out of the operator's `git status`. Only an existing dot-directory below the base
 * is marked — never the base itself, never a directory the project also uses for source — and an
 * existing `.gitignore` is left alone. Returns the files written.
 *
 * Any base git can see qualifies, not only a project root: a store kept by the `existing` rule
 * predates the project-local behaviour and is exactly the one already sitting in someone's
 * working tree. `$DSH_HOME` is not version controlled, so it is skipped.
 */
export function writeTaskboardStorageIgnore(layout, options = {}) {
    const base = layout.base;
    if (base === undefined || layout.baseSource === 'user-data')
        return [];
    const exists = options.exists ?? existsSync;
    const write = options.write ?? ((path, content) => { writeFileSync(path, content, { flag: 'wx' }); });
    const gitRoot = layout.baseSource === 'git-root' ? base : findGitRoot(base, exists);
    if (gitRoot === undefined)
        return [];
    const directories = new Set();
    for (const entry of [layout.database, layout.attachments]) {
        if (entry.source === 'memory' || entry.source === 'absolute')
            continue;
        const head = entry.configured.split(/[/\\]/)[0];
        if (head === undefined || !head.startsWith('.') || head === '.' || head === '..')
            continue;
        directories.add(resolve(base, head));
    }
    const written = [];
    for (const directory of directories) {
        if (directory === base || !contains(base, directory) || !contains(gitRoot, directory))
            continue;
        if (!exists(directory))
            continue;
        const marker = join(directory, '.gitignore');
        if (exists(marker))
            continue;
        try {
            write(marker, STORAGE_IGNORE_CONTENT);
            written.push(marker);
        }
        catch {
            // A read-only project, or a marker another process just wrote, must not block startup.
        }
    }
    return written;
}
//# sourceMappingURL=paths.js.map