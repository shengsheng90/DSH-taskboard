# Native Taskboard delivery ledger

This ledger records the implementation shipped by this repository and the evidence used to validate it. It replaces the construction-only plan from the initial proposal.

The row-by-row release status, including the credentialed operator gates that a keyless package build cannot prove, is maintained in [`acceptance-audit.md`](./acceptance-audit.md).

## Runtime architecture

```text
native client page
  -> generated Typert Remote client
  -> TaskboardService
  -> SQLiteTaskboardProvider (authoritative state + optimistic versions)
  -> attachment store (atomic files + SQLite metadata)

model tools / CLI / scheduler / Agent worker
  -> the same provider and transition policy
  -> Harness Agent + Session + Goal + Workspace services
```

The client mounts through the existing `sidebar.footer.action` and `shell.overlay` slots. The bundle therefore needs no patch to Harness-owned UI or Host source. Realtime invalidation uses a bounded plugin-owned Typert long poll against the global revision; all registrations, waits, and worker subscriptions have bounded cleanup.

## Delivered surface

| Area | Implementation | Focused evidence |
|---|---|---|
| Domain and lifecycle | Branded ids, actors, project/task/comment/relation/claim/attachment/workflow/automation models, centralized transition policy, human-only acceptance | `tests/domain.spec.ts`, `tests/tool.spec.ts` |
| Persistence | Versioned SQLite schema and migrations, compare-and-swap writes, post-commit activity events, atomic attachment writes, cleanup queue, bounded storage health, recurrence and project/workflow/automation persistence | `tests/schema.spec.ts`, `tests/sqlite-provider.spec.ts` |
| Harness service | Typed Typert snapshot/detail/mutation endpoints, bounded attachment byte tickets, compatibility loopback RPC | `tests/service.spec.ts`, `tests/attachment-routes.spec.ts`, checked files under `generated/` |
| Native execution | Synchronous claim, root Session creation/resume, Agent preset/model routing, Workspace cwd/worktree selection, Goal completion/block mapping, durable human follow-ups, orphan reconciliation | `src/execution/index.ts`, provider claim tests |
| Model tools | Narrow list/get/claim/comment/review/block/release/relate tools; no accept or unrestricted status mutation | `tests/tool.spec.ts` |
| Automation | Persistent rules, interval floor, project/global concurrency, empty/dependency decisions, quota-uncertainty pause | `tests/automation.spec.ts` |
| Workflow editor | Persisted multi-tab documents, insertion/move/copy/delete, nested true/false branches, deterministic layout, installed Skill/MCP discovery, and explicit executable/design-only labels | `tests/workflow.spec.ts`, `tests/service.spec.ts` |
| CLI | Versioned JSON protocol, stable exits 2/3/4/5, project/task/relation/attachment/workflow/automation/storage commands | `tests/cli.spec.ts`, `docs/cli.md` |
| Native client | Project CRUD, storage Dashboard, board/list/recurrence Gantt/workflows, search/filter/sort/reorder, reversible edit/archive undo, task detail/activity/comments/relations/attachments/claims/session links, explicit native Session creation with an unsent task draft, lifecycle controls, bilingual copy, responsive layout | `tests/client-route.spec.ts`, `examples/taskboard/browser-fixture.html`, `docs/assets/taskboard-demo.gif` |
| Distribution | DSH patch manifest, host/client exports, generated Typert artifacts, bilingual README, notices, example, management skill | package tarball inspection and import smoke test |

## File map

| Concern | Files |
|---|---|
| Host entry and config | `src/index.ts`, `cordis.patch.yml` |
| Domain and policy | `src/domain/*` |
| SQLite and attachments | `src/sqlite/*`, `src/service/attachments.ts` |
| Typed service | `src/service/*`, `generated/typert.*`, `scripts/copy-typert-artifacts.mjs` |
| Agent integration and tools | `src/execution/*`, `src/tool/*` |
| Scheduler and workflows | `src/automation/*`, `src/workflow/*` |
| Native web client | `src/client/*` |
| CLI | `src/cli.ts` |
| Tests and examples | `tests/*`, `examples/taskboard/*` |
| Operator docs and skill | `README*.md`, `docs/*`, `skills/manage-taskboard/*` |

## Validation contract

Run under a Node version accepted by `package.json`:

```bash
pnpm check
pnpm example
pnpm pack
```

Browser validation uses the actual bundled `TaskboardPage` and a deterministic stateful fixture Remote. It covers board navigation, storage diagnostics, task recurrence, edit/archive undo, Gantt controls, installed capability insertion, workflow visualization, localized detail rendering, the native-Session handoff button, the 720 px responsive breakpoint, and the full approve → review → return → second review → human accept lifecycle documented in `browser-e2e.md`. In addition, an earlier packed tarball was installed through the real `dsh plugin --profile web` path into an isolated profile, composed by `--dump-config`, booted with the real Harness Web Host, and exercised through the generated Typert Remote to create and render `E2E-1` (`docs/assets/taskboard-real-harness.jpg`). That Host smoke predates the final Session-button patch and is intentionally keyless; a credentialed Agent execution remains an operator acceptance test rather than a package-build prerequisite.
