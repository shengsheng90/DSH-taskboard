# JSON CLI reference

Every success is `{ "schemaVersion": 1, "value": ... }`. Every error includes the same schema version and a stable code. Mutations other than create require `--version`.

```text
project list|get|create|update|delete|rename-label|remove-label
task list|get|create|update|approve|accept|move|return|block|resume|cancel|reopen|archive|restore|force-takeover|delete|comment|comment-update|comment-delete
relation add|delete
attachment list|add|download|delete
workflow list|get|create|update|delete
automation list|get|create|update
storage status
```

Structured creates and updates accept JSON:

```sh
dsh-taskboard task create --request-json '{"projectId":"project-...","title":"Ship","creator":"human:cli","priority":"high","dueDate":"2026-08-20"}'
dsh-taskboard task update --task task-... --version 3 --request-json '{"labels":["release"],"recurrence":{"frequency":"weekly","interval":1}}'
dsh-taskboard task move --task task-... --version 4 --status in_review
dsh-taskboard project update --project project-... --version 2 --request-json '{"workspaceId":"workspace-1","labels":["local"]}'
```

`task return` and `task resume` default to `--target todo`, which releases any active/orphaned claim before making the task claimable again. Immediate work uses `--target in_progress --session <session-id> [--agent <agent-id>]`; the lifecycle transaction creates a fresh claim for that explicit owner.

Exit codes are `0` success, `2` usage/invalid CLI input, `3` local service or storage unavailable, `4` domain/API rejection, and `5` optimistic conflict. Attachment downloads use exclusive file creation and never overwrite an existing output.
