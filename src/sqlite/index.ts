export { SqliteTaskboardProvider } from './provider.js'
export { openTaskboardDatabase, TASKBOARD_SCHEMA_VERSION } from './schema.js'
export {
  DEFAULT_TASKBOARD_ATTACHMENT_ROOT,
  DEFAULT_TASKBOARD_DATABASE_PATH,
  findGitRoot,
  findProjectGitRoot,
  isProjectGitRoot,
  resolveTaskboardStorage,
  resolveTaskboardStoragePath,
  taskboardStorageLog,
  writeTaskboardStorageIgnore,
} from './paths.js'
export type {
  ResolveTaskboardStorageOptions,
  ResolvedTaskboardStoragePath,
  TaskboardStorageBaseSource,
  TaskboardStorageLayout,
  TaskboardStorageSource,
  WriteTaskboardStorageIgnoreOptions,
} from './paths.js'
