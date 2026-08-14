# Acceptance audit

This file maps the 13 rows in the bilingual proposal's local functional acceptance matrix to current-state evidence. `PASS` means the repository contains direct implementation and repeatable evidence. `PARTIAL` records a known proposal-level gap instead of hiding it behind adjacent coverage. `OPERATOR` means the implementation is present but the final proof depends on a live Harness capability or model credential that is not bundled with this plugin. A package release must not silently reinterpret an `OPERATOR` row as a complete browser E2E.

| Area | State | Current evidence |
|---|---|---|
| Projects | PASS | Native controlled create/edit/delete forms, global/Workspace mapping, labels, recent-project restoration, stable opaque/readable ids; provider and CLI coverage in `tests/sqlite-provider.spec.ts`, `tests/client-route.spec.ts`, and `tests/cli.spec.ts`. Provider rejects deletion while project-owned records remain. |
| Task data | PASS | Every declared task field, all seven statuses, recurrence, ordering, archive/restore/delete, source metadata, versions, and restart round trips are covered by `tests/sqlite-provider.spec.ts` and `tests/schema.spec.ts`. |
| Board and views | PASS | Dashboard counts/due work/project summary, Board/Other/List/Gantt, search/filter/routes, workflow editor, responsive CSS, and Chinese/English product copy are present in `src/client/index.tsx`. `tests/client-route.spec.ts` tests locale selection; the deterministic browser fixture was rerun against the production client bundle at the 720 px-capable responsive layout. |
| Detail collaboration | PASS | Safe Markdown projection, participants, activity, comments, task/comment attachments, relation create/delete, dependency direction, development context and conflict refresh are implemented. Relation cycles and attachment ordering/policy are provider-tested. |
| Harness Sessions | OPERATOR | The worker creates or resumes the original root Session, persists task-sourced user messages, keeps historical claim references, and projects live status/todos. The proposal's delivery-stage phrase “first-use Session import” maps to its normative explicit-user-request behavior: the client uses public Workspace/Session/conversation services to open a native blank Session and seed an unsent draft carrying the exact task id and revision; it is not a separate database import. Global projects disable this action until a Workspace is mapped. `tests/execution.spec.ts`, `tests/service.spec.ts`, and `tests/client-route.spec.ts` cover these public faces without a model, and the button was exercised in the production browser bundle. A credentialed run must still prove model/preset/permission ownership through the full browser flow. |
| Agent lifecycle | PASS | Atomic claim, dependency recheck, one active owner, cwd selection, durable instruction, Goal review/block mapping, orphan resume, and absence of model acceptance are covered by provider/tool/execution tests. |
| Human lifecycle | PASS | Human-only approve/return/accept/cancel/reopen/archive/restore/delete/force-reclaim policy is enforced in the provider and exposed through UI/CLI. Returning or resuming to `todo` cannot retain an active claim; direct `in_progress` rework/resume atomically establishes a fresh explicit claim. Domain/provider/service/tool tests prove the authority and ownership split. |
| Automation | PASS | Durable configuration and UI expose interval, preset, model route, reasoning, concurrency, quota, empty policy, next run, last decision and state. Startup discovery, concurrency, quota, empty/dependency behavior and original-Session reconciliation have focused tests. |
| CLI and Skill | PASS | Schema-versioned JSON, distinct exits, id/version discipline, all domain groups, headless example, and packaged `manage-taskboard` Skill are covered by `tests/cli.spec.ts`, `docs/cli.md`, the skill validator, and package inspection. One persistent-database CLI test now round-trips projects, full task fields/lifecycle, comments, relations, comment attachments/download/delete, workflows, automation, and storage health through public commands. |
| Visual workflow | PASS | Multiple persisted workflows/tabs, deterministic nested branches, complete catalog, discovered Skill/MCP targets, optimistic updates, validation, and executable/design-only labels are covered by `tests/workflow.spec.ts` and the browser fixture. |
| Local service | PASS | SQLite is the only task authority; Host attachment routes use expiring single-use capabilities. Provider invalidations are post-commit and revisioned. A bounded plugin-owned Typert long poll over the existing Client connection wakes on committed revisions; rollback/stale writes do not wake it, timeout/reconnect/gap/reset use bounded snapshots, and unload settles pending waits before SQLite closes. `tests/sqlite-provider.spec.ts`, `tests/service.spec.ts`, and `tests/client-route.spec.ts` cover the authority and refresh behavior without modifying Harness event forwarding. No external sync or remote provider exists. |
| Security and quality | OPERATOR | Path/content-type/size/download policy, bounded queries, accessibility labels, responsive layout, Cordis unload closing SQLite exactly once, docs, screenshots/GIF, real Host installation and keyless RPC smoke are present. The deterministic production-bundle browser scenario now completes approve → Agent review → human return → second Agent review → explicit human acceptance; see `docs/browser-e2e.md`. The current suite passes 53 tests. Final release evidence still requires repeating that browser lifecycle against an actual configured Harness model. |
| License | PASS | `THIRD_PARTY_NOTICES.md` preserves attribution to the Apache-2.0 reference project; the proposal files preserve design provenance. |

## Repeatable local checks

Run with Node 22.19+ or Node 24+ because SQLite uses the built-in `node:sqlite` module:

```bash
pnpm typecheck
pnpm exec tsx --test tests/*.spec.ts
pnpm build
pnpm example
pnpm pack
```

The deterministic browser fixture is `examples/taskboard/browser-fixture.html`. The real-Host keyless smoke artifact is `docs/assets/taskboard-real-harness.jpg`. The final credentialed operator scenario is intentionally separate: create a task in the native page, approve or enable automation, verify the selected Workspace/development cwd, observe live Agent/todo progress, receive a verification comment in `in_review`, return it once, and explicitly accept the second review as `done`.
