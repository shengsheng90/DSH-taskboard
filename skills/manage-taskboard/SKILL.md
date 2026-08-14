---
name: manage-taskboard
description: Manage work in the native DeepSeek Harness Taskboard with exact task ids and optimistic versions. Use when an Agent must inspect project work, claim an eligible todo, record progress or blockers, verify an implementation, submit it for human review, or release its own claim; also use when a human asks how to accept, return, archive, or automate Taskboard work through the native UI or dsh-taskboard JSON CLI.
---

# Manage Taskboard

Use the in-process `taskboard_*` tools for Agent work. Use `dsh-taskboard` only for human-operated scripts and interoperability; do not make the model shell out when a native tool exists.

## Execute one task

1. Call `taskboard_list` with the exact project id. Prefer an eligible `todo`; do not select `backlog`, archived, dependency-blocked, or already claimed work.
2. Call `taskboard_get` immediately before claiming. Preserve the opaque task id and current `version` exactly; never derive an id from a display key such as `DSH-42`.
3. Call `taskboard_claim` with that id and version. Treat a stale-version or claim conflict as a signal to reread and reconsider, not to retry blindly.
4. Read the full description, comments, relations, dependency state, development context, and attachment references before changing files. Work only in the task's declared workspace, branch, or worktree.
5. Complete the work and run relevant verification. If requirements change, call `taskboard_get` again before continuing.
6. Record material findings with `taskboard_comment`, always using the version returned by the latest read or write.
7. Call `taskboard_submit_review` with a concise result comment and concrete verification evidence. This moves owned work to `in_review`; it never marks work `done`.

Keep every write version-linear: after any successful comment, relation, block, or other mutation, use its returned version for the next write. If another actor wins the race, reread the task and reconcile instead of overwriting their change.

## Handle exceptional outcomes

- Call `taskboard_block` only with a concrete reason when work cannot proceed. Include the missing dependency, decision, permission, or external condition.
- Call `taskboard_release_claim` when intentionally abandoning owned work. Explain what remains and leave useful progress in a comment first when possible.
- Use `taskboard_relate` only after reading both tasks. Keep relations within one project and do not create parent cycles.
- Never call or emulate acceptance. Only a human may accept `in_review` as `done`, return it for rework, approve backlog work, archive it, or permanently delete it.

## Guide human review

Ask the human to open the native Taskboard task detail, inspect the result comment and verification evidence, then choose Accept or Return for rework. For headless human automation, use `dsh-taskboard task accept --task <opaque-id> --version <exact-version>` or `task return ... --comment ...`. Every successful CLI response is versioned JSON; exit codes distinguish usage, unavailable service, API errors, and optimistic conflicts.

Do not bypass service policy with direct SQLite access, browser-side file access, generic status mutation, or prompt-only assumptions. The SQLite Provider and Host service are authoritative.
