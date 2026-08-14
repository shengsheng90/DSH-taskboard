# Browser lifecycle verification

The deterministic browser fixture loads the production `lib/client.js` bundle and supplies a stateful in-memory Remote. It is a Client lifecycle check, not a substitute for the proposal's required credentialed Harness-model run.

## Deterministic scenario

Serve the repository root, open `examples/taskboard/browser-fixture.html`, and exercise `DSH-6`:

1. Open the backlog task and choose **Approve for work** / **批准开工**.
2. The fixture worker claims the task, publishes todo progress, records a verification comment, and submits `in_review`.
3. Choose **Return for rework** / **退回修改**, enter a concrete reason, and confirm.
4. The same deterministic worker path claims it again and records a second verification comment in `in_review`.
5. Choose **Accept** / **验收完成** and verify that the task is `done` and the acceptance action disappears.

The 2026-08-14 QA run used the in-app browser against the built bundle and observed:

```json
{
  "firstReview": true,
  "humanReturnComment": true,
  "verificationCommentCount": 2,
  "secondReview": true,
  "humanAcceptance": true,
  "finalStatus": "done"
}
```

The final candidate was rerun after adding plugin-owned revision long polling. Without a manual refresh, `DSH-6` advanced from version 4 to version 11, displayed both worker verification comments and the required human rework comment, then exposed only **Reopen** after explicit acceptance. No Client watch error appeared.

The same fixture also verifies native Session navigation: a Workspace-backed task exposes **Open in new session** / **在新会话中打开**, and the Taskboard page closes only after the controller accepts the native Session handoff.

## Credentialed release gate

Release acceptance still requires installing the exact candidate tarball in a real Harness profile and repeating the lifecycle with an actual configured model, real Workspace/development cwd, durable Session messages, Goal/todo progress, model permissions, and explicit human acceptance. Record the model route, candidate tarball hash, Session id, task id, claim id, claimed revision, verification command, and final task revision without recording credentials or private prompt data.
