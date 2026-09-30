window.__ModuleLoader__.load({
	id: "@shengsheng/dsh-taskboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/domain/error.ts
		/** Stable domain error returned across CLI, tool, and RPC boundaries. */
		var TaskboardError = class extends Error {
			code;
			details;
			constructor(message, code, details) {
				super(message);
				this.code = code;
				this.details = details;
				this.name = "TaskboardError";
			}
		};
		//#endregion
		//#region src/domain/types.ts
		const TASK_STATUSES = [
			"backlog",
			"todo",
			"in_progress",
			"in_review",
			"blocked",
			"done",
			"canceled"
		];
		//#endregion
		//#region src/workflow/index.ts
		function transformList(list, targetId, operation) {
			const direct = list.findIndex((node) => node.id === targetId);
			if (direct >= 0) return {
				nodes: operation(list, direct),
				changed: true
			};
			for (const [index, node] of list.entries()) for (const branch of [
				"steps",
				"trueBranch",
				"falseBranch"
			]) {
				const children = node[branch];
				if (children === void 0) continue;
				const transformed = transformList(children, targetId, operation);
				if (!transformed.changed) continue;
				const copy = [...list];
				copy[index] = {
					...node,
					[branch]: transformed.nodes
				};
				return {
					nodes: copy,
					changed: true
				};
			}
			return {
				nodes: list,
				changed: false
			};
		}
		function transformDocumentList(document, nodeId, operation) {
			for (const [tabIndex, tab] of document.tabs.entries()) {
				if (tab.trigger.id === nodeId) throw new TaskboardError("workflow triggers cannot be moved, copied, or deleted", "TASK_INVALID_INPUT");
				const transformed = transformList(tab.steps, nodeId, operation);
				if (!transformed.changed) continue;
				const tabs = [...document.tabs];
				tabs[tabIndex] = {
					...tab,
					steps: transformed.nodes
				};
				return { tabs };
			}
			throw new TaskboardError(`workflow node ${nodeId} was not found`, "TASK_INVALID_INPUT");
		}
		/** Remove one non-trigger node from any nested sequence. */
		function removeWorkflowNode(document, nodeId) {
			return transformDocumentList(document, nodeId, (items, index) => items.filter((_item, itemIndex) => itemIndex !== index));
		}
		/** Move one non-trigger node within its current ordered sequence. */
		function moveWorkflowNode(document, nodeId, offset) {
			return transformDocumentList(document, nodeId, (items, index) => {
				const destination = index + offset;
				if (destination < 0 || destination >= items.length) return items;
				const copy = [...items];
				const [node] = copy.splice(index, 1);
				if (node !== void 0) copy.splice(destination, 0, node);
				return copy;
			});
		}
		function cloneNode(node, idFor) {
			return {
				...node,
				id: idFor(node.id),
				...node.steps === void 0 ? {} : { steps: node.steps.map((child) => cloneNode(child, idFor)) },
				...node.trueBranch === void 0 ? {} : { trueBranch: node.trueBranch.map((child) => cloneNode(child, idFor)) },
				...node.falseBranch === void 0 ? {} : { falseBranch: node.falseBranch.map((child) => cloneNode(child, idFor)) }
			};
		}
		/** Copy one node and its nested subtree immediately after the original. */
		function copyWorkflowNode(document, nodeId, idFor) {
			return transformDocumentList(document, nodeId, (items, index) => {
				const source = items[index];
				if (source === void 0) return items;
				const copy = [...items];
				copy.splice(index + 1, 0, cloneNode(source, idFor));
				return copy;
			});
		}
		/** Insert a node into a tab's root steps or one condition branch. */
		function insertWorkflowNode(document, tabId, node, parentId, branch = "steps") {
			const tabIndex = document.tabs.findIndex((tab) => tab.id === tabId);
			const tab = document.tabs[tabIndex];
			if (tab === void 0) throw new TaskboardError(`workflow tab ${tabId} was not found`, "TASK_INVALID_INPUT");
			const tabs = [...document.tabs];
			if (parentId === void 0) {
				tabs[tabIndex] = {
					...tab,
					steps: [...tab.steps, node]
				};
				return { tabs };
			}
			const update = (candidate) => {
				if (candidate.id === parentId) return {
					...candidate,
					[branch]: [...candidate[branch] ?? [], node]
				};
				return {
					...candidate,
					...candidate.steps === void 0 ? {} : { steps: candidate.steps.map(update) },
					...candidate.trueBranch === void 0 ? {} : { trueBranch: candidate.trueBranch.map(update) },
					...candidate.falseBranch === void 0 ? {} : { falseBranch: candidate.falseBranch.map(update) }
				};
			};
			if (!tab.steps.some((candidate) => containsNode(candidate, parentId))) throw new TaskboardError(`workflow parent ${parentId} was not found`, "TASK_INVALID_INPUT");
			tabs[tabIndex] = {
				...tab,
				steps: tab.steps.map(update)
			};
			return { tabs };
		}
		function containsNode(node, id) {
			return node.id === id || [
				...node.steps ?? [],
				...node.trueBranch ?? [],
				...node.falseBranch ?? []
			].some((child) => containsNode(child, id));
		}
		/** Add one tab with its required trigger. */
		function addWorkflowTab(document, tab) {
			if (document.tabs.some((item) => item.id === tab.id)) throw new TaskboardError(`workflow tab ${tab.id} already exists`, "TASK_INVALID_INPUT");
			return { tabs: [...document.tabs, tab] };
		}
		/** Delete a tab while retaining the invariant that at least one remains. */
		function removeWorkflowTab(document, tabId) {
			if (document.tabs.length <= 1) throw new TaskboardError("workflow requires at least one tab", "TASK_INVALID_INPUT");
			if (!document.tabs.some((tab) => tab.id === tabId)) throw new TaskboardError(`workflow tab ${tabId} was not found`, "TASK_INVALID_INPUT");
			return { tabs: document.tabs.filter((tab) => tab.id !== tabId) };
		}
		/** Keep the dashboard log short; the remainder opens in a dialog. */
		function previewAutomationRuns(runs, limit = 10) {
			return {
				preview: runs.slice(0, limit),
				remaining: Math.max(0, runs.length - limit)
			};
		}
		/** Authoritative board column order: manual `sortOrder` first, descending.
		*
		*  Descending keeps the newest card on top without a separate rule, because `createTask`
		*  assigns an increasing `sortOrder` per project. Ordering by anything else (`updatedAt`,
		*  for one) silently discards every drag-to-reorder write. */
		function boardColumnOrder(tasks) {
			return [...tasks].sort((left, right) => {
				if (right.sortOrder !== left.sortOrder) return right.sortOrder - left.sortOrder;
				if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt;
				return left.id.localeCompare(right.id);
			});
		}
		/** One page of a board column in manual order; later clicks reveal another page below. */
		function paginateBoardColumn(tasks, visibleCount = 15) {
			const ordered = boardColumnOrder(tasks);
			const limit = Math.max(0, visibleCount);
			return {
				visible: ordered.slice(0, limit),
				remaining: Math.max(0, ordered.length - limit)
			};
		}
		const BOARD_ORDER_STEP = 1e3;
		/** `sortOrder` that lands a card directly above `target`, or at the column end when dropped on
		*  empty space. Midpoints keep neighbouring cards untouched, so one drop is one write. */
		function boardDropSortOrder(column, draggedId, target) {
			const ordered = boardColumnOrder(column).filter((task) => task.id !== draggedId);
			if (target === void 0) {
				const last = ordered[ordered.length - 1];
				return last === void 0 ? void 0 : last.sortOrder - BOARD_ORDER_STEP;
			}
			const at = ordered.findIndex((task) => task.id === target.id);
			if (at < 0) return void 0;
			const below = ordered[at];
			const above = ordered[at - 1];
			return above === void 0 ? below.sortOrder + BOARD_ORDER_STEP : (above.sortOrder + below.sortOrder) / 2;
		}
		/** Human quick-add from the web form: land in Backlog so drafts are not claimed. */
		function humanQuickCreateRequest(projectId, title) {
			return {
				projectId,
				title: title.trim(),
				creator: "human:web-client",
				status: "backlog"
			};
		}
		/** Content types the page can render inline; everything else is download-only. */
		function isPreviewableAttachment(contentType) {
			return /^image\/(gif|jpeg|png|webp)$/i.test(contentType.trim());
		}
		/** Empty descriptions open Write; saved Markdown opens Preview. */
		function descriptionComposerMode(description) {
			return description.trim() === "" ? "write" : "preview";
		}
		/** Accept a create mutation result only when it carries a task id. */
		function createdTaskId(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const id = value.id;
			return typeof id === "string" && id.length > 0 ? id : void 0;
		}
		/** Fill empty automation model fields from Host defaults without overwriting an explicit rule. */
		function applyAutomationDefaults(config, defaults) {
			return {
				...config,
				...config.modelRoute === void 0 && defaults?.modelRoute !== void 0 ? { modelRoute: defaults.modelRoute } : {},
				...config.reasoning === void 0 && defaults?.reasoning !== void 0 ? { reasoning: defaults.reasoning } : {}
			};
		}
		/** Classify bounded-snapshot revisions after events, reconnects, or a Host restart. */
		function classifyRevisionChange(previous, next) {
			if (previous === void 0) return "initial";
			if (next === previous) return "same";
			if (next < previous) return "reset";
			return next === previous + 1 ? "next" : "gap";
		}
		const PRIORITY_RANK = {
			urgent: 0,
			high: 1,
			medium: 2,
			low: 3,
			none: 4
		};
		const STATUS_RANK = new Map(TASK_STATUSES.map((status, index) => [status, index]));
		/** Rank one task for the list view. Priority and status are enums with a meaningful order, so
		*  comparing their raw strings put "high" before "low" before "urgent" -- alphabetical noise. */
		function sortValue(task, key) {
			if (key === "priority") return PRIORITY_RANK[task.priority] ?? Number.MAX_SAFE_INTEGER;
			if (key === "status") return STATUS_RANK.get(task.status) ?? Number.MAX_SAFE_INTEGER;
			if (key === "dueDate") return task.dueDate ?? "￿";
			return key === "title" ? task.title : task.identifier;
		}
		/** Order the list view by one column, in the requested direction. */
		function sortTaskList(tasks, key, direction = "asc") {
			const sign = direction === "asc" ? 1 : -1;
			return [...tasks].sort((left, right) => {
				const a = sortValue(left, key);
				const b = sortValue(right, key);
				if (typeof a === "number" && typeof b === "number") {
					if (a !== b) return (a - b) * sign;
				} else if (a !== b) return String(a).localeCompare(String(b), void 0, { numeric: true }) * sign;
				return left.identifier.localeCompare(right.identifier, void 0, { numeric: true });
			});
		}
		/** Map a board drop onto reorder-within-column or a human status move.
		*
		*  `column` is every task already in the destination column, so a drop on empty space can
		*  append to the end instead of being discarded. */
		function boardDropIntent(dragged, targetStatus, column = [], target) {
			if (dragged === void 0 || dragged.archivedAt !== void 0) return { kind: "none" };
			if (target !== void 0 && dragged.id === target.id) return { kind: "none" };
			const sortOrder = boardDropSortOrder(column, dragged.id, target);
			if (dragged.status === targetStatus) {
				if (sortOrder === void 0) return { kind: "none" };
				return {
					kind: "reorder",
					taskId: dragged.id,
					expectedVersion: dragged.version,
					sortOrder
				};
			}
			return {
				kind: "move",
				taskId: dragged.id,
				expectedVersion: dragged.version,
				status: targetStatus,
				...sortOrder === void 0 ? {} : { sortOrder }
			};
		}
		/** Labels present on the project catalog or any task, in first-seen order. */
		function projectLabelCatalog(projectLabels, tasks) {
			const seen = /* @__PURE__ */ new Set();
			const catalog = [];
			for (const label of [...projectLabels, ...tasks.flatMap((task) => task.labels)]) {
				const name = label.trim();
				if (name === "" || seen.has(name)) continue;
				seen.add(name);
				catalog.push(name);
			}
			return catalog;
		}
		/** Tasks that carry `label`, or unlabeled tasks when `label` is undefined. */
		function tasksForLabel(tasks, label) {
			return tasks.filter((task) => label === void 0 ? task.labels.length === 0 : task.labels.includes(label));
		}
		const VIEWS = /* @__PURE__ */ new Set([
			"dashboard",
			"board",
			"list",
			"labels",
			"gantt",
			"workflows"
		]);
		const RECENT_PROJECT_KEY = "dsh-taskboard.recent-project";
		/** Restore only an open project-less route; explicit deep links always win. */
		function restoreRecentProject(route, recent) {
			return !route.open || route.projectId !== void 0 || recent === null || recent === "" ? route : {
				...route,
				projectId: recent
			};
		}
		/** Render the unsent native-conversation draft created only on explicit user request. */
		function renderTaskSessionDraft(detail) {
			const { task } = detail;
			const comments = detail.comments.length === 0 ? "- None" : detail.comments.map((item) => `- ${item.authorId}: ${item.body}`).join("\n");
			const relations = detail.relations.length === 0 ? "- None" : detail.relations.map((item) => {
				const direction = item.sourceTaskId === task.id ? "outgoing" : "incoming";
				const other = item.sourceTaskId === task.id ? item.targetTaskId : item.sourceTaskId;
				return `- ${item.kind} (${direction}): ${other}`;
			}).join("\n");
			const attachments = detail.attachments.length === 0 ? "- None" : detail.attachments.map((item) => `- ${item.id}: ${item.filename} (${item.contentType}, ${item.byteSize} bytes)`).join("\n");
			const development = task.developmentContext === void 0 ? "Project workspace" : task.developmentContext.kind === "branch" ? `Branch ${task.developmentContext.branch}` : `Worktree ${task.developmentContext.path}, branch ${task.developmentContext.branch}`;
			return [
				`Work on Task ${task.identifier}.`,
				`Opaque task id: ${task.id}`,
				`Current task revision: ${task.version}`,
				"",
				`Title: ${task.title}`,
				"",
				"Description and acceptance details:",
				task.description || "(No description supplied.)",
				"",
				"Current comments:",
				comments,
				"",
				"Relations and dependency state:",
				relations,
				"",
				`Development context: ${development}`,
				"",
				"Attachment references:",
				attachments,
				"",
				"Use taskboard_get with the exact opaque id before any write. Claim only if eligible, verify the work, and submit it for human review. Never modify the task description; write the final result as a comment. Never accept it as done."
			].join("\n");
		}
		/** Decode one refresh-safe Taskboard hash without consulting browser state. */
		function decodeTaskboardHash(hash) {
			if (!hash.startsWith("#taskboard")) return {
				open: false,
				view: "board"
			};
			const [, projectId, rawView, taskId] = hash.slice(1).split("/");
			const view = VIEWS.has(rawView) ? rawView : "board";
			return {
				open: true,
				...projectId === void 0 || projectId === "-" ? {} : { projectId: decodeURIComponent(projectId) },
				view,
				...taskId === void 0 ? {} : { taskId: decodeURIComponent(taskId) }
			};
		}
		function parseRoute() {
			const route = decodeTaskboardHash(typeof location === "undefined" ? "" : location.hash);
			if (!route.open || route.projectId !== void 0 || typeof localStorage === "undefined") return route;
			try {
				return restoreRecentProject(route, localStorage.getItem(RECENT_PROJECT_KEY));
			} catch {
				return route;
			}
		}
		/** Encode one open page route for deep-link and refresh restoration. */
		function encodeTaskboardRoute(route) {
			const project = encodeURIComponent(route.projectId ?? "-");
			const task = route.taskId === void 0 ? "" : `/${encodeURIComponent(route.taskId)}`;
			return `#taskboard/${project}/${route.view}${task}`;
		}
		function watcherId() {
			return globalThis.crypto?.randomUUID?.() ?? `watcher-${String(Math.trunc(Math.random() * 0xe8d4a51000))}`;
		}
		/** Bind an observable so `useSyncExternalStore` can take the methods without losing `this`. */
		function observeSnapshot(source) {
			return {
				subscribe: (listener) => source.subscribe(listener),
				getSnapshot: () => source.getSnapshot()
			};
		}
		/** Browser-local page state and route codec; business state always comes from the Host. */
		var TaskboardClientController = class {
			connection;
			remote;
			selectSession;
			createTaskSession;
			route = parseRoute();
			listeners = /* @__PURE__ */ new Set();
			globalRevision;
			/** Identifies this page's long-poll loop so the Host can release a waiter this page abandoned:
			*  an abort is local and never reaches the Host, so the old waiter held its slot until timeout. */
			watcherId = watcherId();
			constructor(connection, remote, selectSession, createTaskSession) {
				this.connection = connection;
				this.remote = remote;
				this.selectSession = selectSession;
				this.createTaskSession = createTaskSession;
				if (typeof window !== "undefined") window.addEventListener("hashchange", this.onRoute);
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			getSnapshot = () => this.route;
			open() {
				this.navigate({
					...this.route,
					open: true
				});
			}
			close() {
				if (typeof history !== "undefined") history.pushState(null, "", `${location.pathname}${location.search}`);
				this.route = {
					open: false,
					view: this.route.view,
					...this.route.projectId === void 0 ? {} : { projectId: this.route.projectId }
				};
				this.publish();
			}
			select(projectId, view = this.route.view, taskId) {
				if (typeof localStorage !== "undefined") try {
					if (projectId === void 0) localStorage.removeItem(RECENT_PROJECT_KEY);
					else localStorage.setItem(RECENT_PROJECT_KEY, projectId);
				} catch {}
				this.navigate({
					open: true,
					view,
					...projectId === void 0 ? {} : { projectId },
					...taskId === void 0 ? {} : { taskId }
				});
			}
			async snapshot(projectId, signal) {
				signal?.throwIfAborted();
				const result = await this.remote.snapshot(projectId);
				if (!result.ok) throw new Error(result.error.message);
				return JSON.parse(result.value);
			}
			async detail(taskId, signal) {
				signal?.throwIfAborted();
				const result = await this.remote.taskDetail(taskId);
				if (!result.ok) throw new Error(result.error.message);
				return JSON.parse(result.value);
			}
			subscribeConnection(listener) {
				return this.connection.generation.subscribe(listener);
			}
			recordSnapshotRevision(revision) {
				const change = classifyRevisionChange(this.globalRevision, revision);
				this.globalRevision = revision;
				return change;
			}
			async openSession(sessionId) {
				if (this.selectSession === void 0) throw new Error("native Session navigation is unavailable");
				await this.selectSession(sessionId);
				this.close();
			}
			async openNewSession(workspaceId, detail) {
				if (this.createTaskSession === void 0) throw new Error("native Session creation is unavailable");
				const sessionId = await this.createTaskSession(workspaceId, renderTaskSessionDraft(detail));
				await this.mutate("task.bind-session", {
					taskId: detail.task.id,
					expectedVersion: detail.task.version,
					sessionId,
					agentId: sessionId
				});
				this.close();
				return sessionId;
			}
			async mutate(endpoint, payload, signal) {
				signal?.throwIfAborted();
				const result = await this.connection.rpc.call("/taskboard", endpoint, payload, signal);
				if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
				return result.value;
			}
			/** Search the whole project in SQLite. The board can only filter the tasks a snapshot carried. */
			async searchTasks(projectId, search, signal) {
				return await this.mutate("task.search", {
					projectId,
					search
				}, signal);
			}
			async watchChanges(afterRevision, signal) {
				signal?.throwIfAborted();
				const carried = await this.remote.mutate({
					endpoint: "changes.watch",
					payloadJson: JSON.stringify({
						afterRevision,
						timeoutMs: 1e4,
						watcherId: this.watcherId
					})
				});
				signal?.throwIfAborted();
				if (!carried.ok) throw new Error(carried.error.message);
				if (!carried.value.ok) throw new Error(`${carried.value.errorCode ?? "taskboard"}: ${carried.value.errorMessage ?? "change watch failed"}`);
				return JSON.parse(carried.value.valueJson ?? "null");
			}
			async uploadAttachment(taskId, expectedVersion, file, commentId, signal) {
				const ticket = await this.mutate("attachment.upload-ticket", {
					taskId,
					expectedVersion,
					filename: file.name,
					contentType: file.type || "application/octet-stream",
					...commentId === void 0 ? {} : { commentId }
				}, signal);
				const response = await fetch(ticket.url, {
					method: ticket.method,
					body: file,
					...signal === void 0 ? {} : { signal },
					headers: { "content-type": "application/octet-stream" }
				});
				if (!response.ok) throw new Error(`attachment upload failed (${response.status}): ${await response.text()}`);
			}
			async downloadAttachment(attachmentId, filename) {
				const ticket = await this.mutate("attachment.download-ticket", {
					attachmentId,
					disposition: "attachment"
				});
				const anchor = document.createElement("a");
				anchor.href = ticket.url;
				anchor.download = filename;
				anchor.rel = "noopener";
				document.body.append(anchor);
				anchor.click();
				anchor.remove();
			}
			/** One-time inline URL for previewing an attachment in place; the ticket expires after one GET. */
			async previewAttachmentUrl(attachmentId) {
				return (await this.mutate("attachment.download-ticket", {
					attachmentId,
					disposition: "inline"
				})).url;
			}
			dispose() {
				if (typeof window !== "undefined") window.removeEventListener("hashchange", this.onRoute);
				this.listeners.clear();
			}
			onRoute = () => {
				this.route = parseRoute();
				this.publish();
			};
			navigate(route) {
				const hash = encodeTaskboardRoute(route);
				if (typeof history !== "undefined" && hash !== location.hash) history.pushState(null, "", hash);
				this.route = route;
				this.publish();
			}
			publish() {
				for (const listener of [...this.listeners]) listener();
			}
		};
		//#endregion
		//#region src/client/popover.tsx
		const POPOVER_OPEN_EVENT = "dsh-taskboard-popover-open";
		function useExclusivePopover() {
			const id = (0, react.useId)();
			const [open, setOpenState] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const onPeerOpen = (event) => {
					if (event.detail === id) return;
					setOpenState(false);
				};
				document.addEventListener(POPOVER_OPEN_EVENT, onPeerOpen);
				return () => {
					document.removeEventListener(POPOVER_OPEN_EVENT, onPeerOpen);
				};
			}, [id]);
			const setOpen = (next) => {
				if (next) document.dispatchEvent(new CustomEvent(POPOVER_OPEN_EVENT, { detail: id }));
				setOpenState(next);
			};
			const toggle = () => {
				setOpenState((current) => {
					const next = !current;
					if (next) document.dispatchEvent(new CustomEvent(POPOVER_OPEN_EVENT, { detail: id }));
					return next;
				});
			};
			return {
				open,
				setOpen,
				toggle
			};
		}
		function usePopoverDismiss(open, onOutside, onEscape = onOutside) {
			const rootRef = (0, react.useRef)(null);
			const onOutsideRef = (0, react.useRef)(onOutside);
			const onEscapeRef = (0, react.useRef)(onEscape);
			onOutsideRef.current = onOutside;
			onEscapeRef.current = onEscape;
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
					onOutsideRef.current();
				};
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopImmediatePropagation();
					onEscapeRef.current();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}, [open]);
			return rootRef;
		}
		function PopoverShell({ open, onToggle, onDismiss, onEscape, label, children }) {
			const rootRef = usePopoverDismiss(open, onDismiss, onEscape ?? onDismiss);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: "dsh-taskboard-popover",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-expanded": open,
					onClick: onToggle,
					children: label
				}), open ? children : null]
			});
		}
		//#endregion
		//#region src/client/markdown.ts
		const ATTACHMENT_SRC = /^\/api\/attachments\/[A-Za-z0-9-]+\/content(?:[?#].*)?$/;
		const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}\.)[ \t]+(.*)$/;
		const HEADING = /^(#{1,4})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
		const FENCE = /^(`{3,}|~{3,})(.*)$/;
		const HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
		/** Allow http(s), mailto, and Taskboard attachment content URLs; drop javascript/data/relative traps. */
		function sanitizeMarkdownUrl(raw) {
			const url = raw.trim();
			if (url === "") return void 0;
			if (ATTACHMENT_SRC.test(url)) return url;
			if (/[\s<>"']/.test(url)) return void 0;
			if (/^(javascript|data|vbscript):/i.test(url)) return void 0;
			if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
		}
		function parseMarkdown(source) {
			const lines = source.replace(/\r\n?/g, "\n").split("\n");
			const blocks = [];
			let index = 0;
			while (index < lines.length) {
				const line = lines[index] ?? "";
				if (line.trim() === "") {
					index += 1;
					continue;
				}
				const fence = FENCE.exec(line);
				if (fence !== null) {
					const marker = fence[1] ?? "```";
					const language = (fence[2] ?? "").trim();
					const body = [];
					index += 1;
					while (index < lines.length && !(lines[index] ?? "").startsWith(marker)) {
						body.push(lines[index] ?? "");
						index += 1;
					}
					if (index < lines.length) index += 1;
					blocks.push({
						type: "code",
						language,
						value: body.join("\n")
					});
					continue;
				}
				const heading = HEADING.exec(line);
				if (heading !== null) {
					const marks = heading[1] ?? "#";
					const level = Math.min(marks.length, 4);
					blocks.push({
						type: "heading",
						level,
						children: parseInline(heading[2] ?? "")
					});
					index += 1;
					continue;
				}
				if (HR.test(line) && LIST_ITEM.exec(line) === null) {
					blocks.push({ type: "hr" });
					index += 1;
					continue;
				}
				if (/^ {0,3}>/.test(line)) {
					const quoted = [];
					while (index < lines.length && /^ {0,3}>/.test(lines[index] ?? "")) {
						quoted.push((lines[index] ?? "").replace(/^ {0,3}> ?/, ""));
						index += 1;
					}
					blocks.push({
						type: "blockquote",
						children: parseMarkdown(quoted.join("\n"))
					});
					continue;
				}
				if (LIST_ITEM.test(line)) {
					const parsed = readList(lines, index);
					blocks.push(parsed.block);
					index = parsed.nextIndex;
					continue;
				}
				const paragraph = [line];
				index += 1;
				while (index < lines.length) {
					const next = lines[index] ?? "";
					if (next.trim() === "" || isBlockStart(next)) break;
					paragraph.push(next);
					index += 1;
				}
				blocks.push({
					type: "paragraph",
					children: parseInline(paragraph.join("\n"))
				});
			}
			return blocks;
		}
		function applyMarkdownEdit(value, selectionStart, selectionEnd, action) {
			const start = Math.max(0, Math.min(selectionStart, selectionEnd, value.length));
			const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), value.length));
			if (action === "bold") return wrapSelection(value, start, end, "**", "**", "bold");
			if (action === "italic") return wrapSelection(value, start, end, "*", "*", "italic");
			if (action === "code") return wrapCode(value, start, end);
			if (action === "link") return wrapLink(value, start, end);
			if (action === "heading") return prefixLines(value, start, end, (line) => `## ${line.replace(/^#{1,6}[ \t]+/, "")}`);
			if (action === "quote") return toggleLinePrefix(value, start, end, "> ");
			if (action === "ul") return toggleLinePrefix(value, start, end, "- ");
			return numberLines(value, start, end);
		}
		function isBlockStart(line) {
			return HEADING.test(line) || FENCE.test(line) || HR.test(line) && LIST_ITEM.exec(line) === null || /^ {0,3}>/.test(line) || LIST_ITEM.test(line);
		}
		function readList(lines, start) {
			const first = LIST_ITEM.exec(lines[start] ?? "");
			const ordered = /^\d{1,9}\.$/.test(first?.[2] ?? "");
			const items = [];
			let index = start;
			let current;
			while (index < lines.length) {
				const line = lines[index] ?? "";
				if (line.trim() === "") {
					const peek = lines[index + 1] ?? "";
					if (current !== void 0 && (LIST_ITEM.test(peek) || /^\s{2,}\S/.test(peek))) {
						index += 1;
						continue;
					}
					break;
				}
				const item = LIST_ITEM.exec(line);
				if (item !== null && /^\d{1,9}\.$/.test(item[2] ?? "") === ordered) {
					current = [item[3] ?? ""];
					items.push(current);
					index += 1;
					continue;
				}
				if (current !== void 0 && /^\s{2,}/.test(line)) {
					current.push(line.trim());
					index += 1;
					continue;
				}
				break;
			}
			return {
				block: {
					type: "list",
					ordered,
					items: items.map((parts) => parseInline(parts.join("\n")))
				},
				nextIndex: index
			};
		}
		function parseInline(input) {
			const nodes = [];
			let index = 0;
			let textStart = 0;
			const flush = (to) => {
				if (to > textStart) nodes.push({
					type: "text",
					value: input.slice(textStart, to)
				});
			};
			while (index < input.length) {
				const ch = input[index] ?? "";
				if (ch === "\\" && index + 1 < input.length) {
					flush(index);
					nodes.push({
						type: "text",
						value: input[index + 1] ?? ""
					});
					index += 2;
					textStart = index;
					continue;
				}
				if (ch === "`") {
					const closed = findClosing(input, index + 1, "`");
					if (closed !== void 0) {
						flush(index);
						nodes.push({
							type: "code",
							value: input.slice(index + 1, closed)
						});
						index = closed + 1;
						textStart = index;
						continue;
					}
				}
				if (input.startsWith("![", index)) {
					const image = readLink(input, index, true);
					if (image !== void 0) {
						flush(index);
						nodes.push(image.node);
						index = image.end;
						textStart = index;
						continue;
					}
				}
				if (ch === "[") {
					const link = readLink(input, index, false);
					if (link !== void 0) {
						flush(index);
						nodes.push(link.node);
						index = link.end;
						textStart = index;
						continue;
					}
				}
				if (input.startsWith("**", index) || input.startsWith("__", index)) {
					const delim = input.slice(index, index + 2);
					const closed = findClosing(input, index + 2, delim);
					if (closed !== void 0 && closed > index + 2) {
						flush(index);
						nodes.push({
							type: "strong",
							children: parseInline(input.slice(index + 2, closed))
						});
						index = closed + 2;
						textStart = index;
						continue;
					}
				}
				if (input.startsWith("~~", index)) {
					const closed = findClosing(input, index + 2, "~~");
					if (closed !== void 0 && closed > index + 2) {
						flush(index);
						nodes.push({
							type: "del",
							children: parseInline(input.slice(index + 2, closed))
						});
						index = closed + 2;
						textStart = index;
						continue;
					}
				}
				if ((ch === "*" || ch === "_") && canOpenEmphasis(input, index, ch)) {
					const closed = findClosing(input, index + 1, ch);
					if (closed !== void 0 && closed > index + 1 && (input[closed - 1] ?? "") !== " " && canCloseEmphasis(input, closed, ch)) {
						flush(index);
						nodes.push({
							type: "em",
							children: parseInline(input.slice(index + 1, closed))
						});
						index = closed + 1;
						textStart = index;
						continue;
					}
				}
				index += 1;
			}
			flush(input.length);
			return nodes;
		}
		function canOpenEmphasis(input, index, marker) {
			const next = input[index + 1] ?? "";
			if (next === "" || next === " " || next === marker) return false;
			if (marker !== "_") return true;
			const prev = index === 0 ? " " : input[index - 1] ?? " ";
			return !/[A-Za-z0-9]/.test(prev);
		}
		function canCloseEmphasis(input, index, marker) {
			if (marker !== "_") return true;
			const next = input[index + 1] ?? " ";
			return !/[A-Za-z0-9]/.test(next);
		}
		function findClosing(input, from, delim) {
			let index = from;
			while (index < input.length) {
				if (input[index] === "\\") {
					index += 2;
					continue;
				}
				if (input.startsWith(delim, index)) return index;
				index += 1;
			}
		}
		function readLink(input, start, image) {
			const labelStart = image ? start + 2 : start + 1;
			let depth = 1;
			let index = labelStart;
			while (index < input.length) {
				const ch = input[index] ?? "";
				if (ch === "\\") {
					index += 2;
					continue;
				}
				if (ch === "[") depth += 1;
				else if (ch === "]") {
					depth -= 1;
					if (depth === 0) {
						if ((input[index + 1] ?? "") !== "(") return void 0;
						const close = input.indexOf(")", index + 2);
						if (close === -1) return void 0;
						const label = input.slice(labelStart, index);
						const href = sanitizeMarkdownUrl(input.slice(index + 2, close));
						const end = close + 1;
						const fallback = {
							type: "text",
							value: input.slice(start, end)
						};
						if (href === void 0) return {
							node: fallback,
							end
						};
						if (image) return {
							node: {
								type: "image",
								src: href,
								alt: label
							},
							end
						};
						return {
							node: {
								type: "link",
								href,
								children: parseInline(label)
							},
							end
						};
					}
				}
				index += 1;
			}
		}
		function wrapSelection(value, start, end, before, after, placeholder) {
			const selected = value.slice(start, end) || placeholder;
			const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
			const selectionStart = start + before.length;
			return {
				value: next,
				selectionStart,
				selectionEnd: selectionStart + selected.length
			};
		}
		function wrapCode(value, start, end) {
			const selected = value.slice(start, end);
			if (selected.includes("\n")) {
				const body = selected.replace(/^\n/, "").replace(/\n$/, "");
				const inserted = `\`\`\`\n${body}\n\`\`\``;
				return {
					value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
					selectionStart: start + 4,
					selectionEnd: start + 4 + body.length
				};
			}
			return wrapSelection(value, start, end, "`", "`", "code");
		}
		function wrapLink(value, start, end) {
			const selected = value.slice(start, end);
			if (selected.length > 0) {
				const next = `${value.slice(0, start)}[${selected}](url)${value.slice(end)}`;
				const urlStart = start + selected.length + 3;
				return {
					value: next,
					selectionStart: urlStart,
					selectionEnd: urlStart + 3
				};
			}
			return {
				value: `${value.slice(0, start)}[text](url)${value.slice(end)}`,
				selectionStart: start + 1,
				selectionEnd: start + 5
			};
		}
		function lineRange(value, start, end) {
			const from = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
			const newline = value.indexOf("\n", end);
			return {
				from,
				to: newline === -1 ? value.length : newline
			};
		}
		function replaceLines(value, start, end, rewrite) {
			const { from, to } = lineRange(value, start, end);
			const nextBlock = rewrite(value.slice(from, to).split("\n")).join("\n");
			return {
				value: `${value.slice(0, from)}${nextBlock}${value.slice(to)}`,
				selectionStart: from,
				selectionEnd: from + nextBlock.length
			};
		}
		function prefixLines(value, start, end, rewrite) {
			return replaceLines(value, start, end, (lines) => lines.map(rewrite));
		}
		function toggleLinePrefix(value, start, end, prefix) {
			return replaceLines(value, start, end, (lines) => {
				const allPrefixed = lines.every((line) => line.startsWith(prefix));
				return lines.map((line) => allPrefixed ? line.slice(prefix.length) : line.startsWith(prefix) ? line : `${prefix}${line}`);
			});
		}
		function numberLines(value, start, end) {
			return replaceLines(value, start, end, (lines) => {
				return lines.every((line) => /^\d+\. /.test(line)) ? lines.map((line) => line.replace(/^\d+\. /, "")) : lines.map((line, index) => `${index + 1}. ${line.replace(/^\d+\. /, "")}`);
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const TASKBOARD_LOCALE_NS = "taskboard";
		const taskboardLocales = {
			zh: {
				taskboard: "任务板",
				close: "关闭任务板",
				newTask: "新建任务",
				title: "标题",
				description: "描述",
				create: "创建",
				dashboard: "概览",
				board: "看板",
				list: "列表",
				gantt: "甘特",
				workflows: "工作流",
				other: "其他任务",
				backlog: "待批准",
				todo: "待办",
				in_progress: "进行中",
				in_review: "待评审",
				blocked: "已阻塞",
				done: "已完成",
				canceled: "已取消",
				empty: "暂无任务",
				noProject: "还没有项目，请先创建一个项目",
				refresh: "刷新",
				approve: "批准开工",
				accept: "验收完成",
				archive: "归档",
				restore: "恢复",
				save: "保存",
				closeDetail: "关闭详情",
				dismiss: "关闭",
				comment: "评论",
				addComment: "添加评论",
				project: "项目",
				addProject: "新建项目",
				projectName: "项目名称",
				projectKey: "项目代号",
				due: "截止",
				recentTasks: "最近任务",
				priority: "优先级",
				loading: "正在读取本地任务数据…",
				workflowNote: "保存的工作流会作为 Agent 执行指引加入任务上下文；节点不会由调度器自动运行。",
				search: "搜索任务",
				allStatuses: "全部状态",
				deleteProject: "删除项目",
				editProject: "编辑项目",
				newSession: "在新会话中打开",
				workspaceRequired: "请先为项目映射 Workspace",
				sessionTaskMustBeActive: "请先批准或恢复任务，再启动关联会话。",
				comments: "评论记录",
				activity: "活动",
				attachments: "附件",
				relations: "关系",
				sessions: "关联会话",
				automation: "自动化",
				enable: "启用",
				pause: "暂停",
				nextRun: "下次运行",
				lastDecision: "最近决策",
				addAutomation: "新建自动化",
				addWorkflow: "新建工作流",
				addStep: "添加步骤",
				designOnly: "仅设计",
				executable: "可执行",
				returnWork: "退回修改",
				openSession: "打开会话",
				storageHealth: "本地存储健康",
				healthy: "正常",
				degraded: "需处理",
				cleanupPending: "待清理附件",
				orphanedClaims: "孤儿认领",
				undo: "撤销上次编辑",
				today: "今天",
				showCompleted: "显示已完成",
				recurrence: "重复",
				noRecurrence: "不重复",
				interval: "间隔",
				until: "截止重复",
				write: "编写",
				preview: "预览",
				edit: "编辑",
				markdownToolbar: "Markdown 工具栏",
				mdHeading: "标题",
				mdBold: "加粗",
				mdItalic: "斜体",
				mdQuote: "引用",
				mdCode: "代码",
				mdLink: "链接",
				mdBullet: "无序列表",
				mdNumber: "有序列表",
				descriptionPlaceholder: "使用 Markdown 编写任务详情",
				openIssue: "打开",
				closedIssue: "已关闭",
				opened: "创建了",
				commentPlaceholder: "使用 Markdown 编写评论",
				attachFiles: "粘贴、拖放或选择要附加的文件",
				noneYet: "暂无",
				noOne: "未指定",
				noDate: "无日期",
				targetDate: "目标日期",
				closeIssue: "关闭任务",
				labels: "标签",
				unlabeled: "未标签",
				addLabel: "新建标签",
				renameLabel: "重命名标签",
				deleteLabel: "删除标签",
				noLabels: "暂无标签",
				labelName: "标签名称",
				unlabeledTasks: "未标签任务",
				edited: "已编辑",
				workspaceId: "Harness Workspace ID",
				blankGlobal: "留空表示全局项目",
				globalProject: "全局项目",
				workspace: "Workspace",
				noProjectLabels: "无项目标签",
				tasksWord: "个任务",
				activeWord: "进行中",
				agentPreset: "Agent 预设",
				modelRoute: "模型路由",
				reasoning: "推理强度",
				intervalSeconds: "间隔（秒）",
				workers: "工作器数",
				quota: "配额策略",
				pauseUncertain: "配额不确定时暂停",
				ignore: "忽略",
				autoPauseEmpty: "无任务时自动暂停",
				model: "模型",
				hostDefault: "Host 默认",
				stayEnabled: "保持启用",
				status: "状态",
				ganttZoom: "甘特缩放",
				days30: "30 天",
				days90: "90 天",
				oneYear: "1 年",
				noDatedTasks: "暂无已排期任务",
				workflowName: "工作流名称",
				nodeKind: "节点类型",
				newTabName: "新标签页名称",
				triggerKind: "触发器类型",
				tab: "标签页",
				deleteWorkflow: "删除工作流",
				installedCapabilities: "已安装能力",
				skillDiscovery: "Skill 发现",
				completeWord: "已完成",
				refreshing: "刷新中/不完整",
				skill: "Skill",
				mcp: "MCP",
				copy: "复制",
				trueLabel: "真",
				falseLabel: "假",
				assignee: "负责人",
				workflow: "工作流",
				developmentContext: "开发上下文",
				none: "无",
				branch: "分支",
				worktree: "Worktree",
				worktreePath: "Worktree 路径",
				start: "开始",
				daily: "每天",
				weekly: "每周",
				monthly: "每月",
				developmentRequired: "当前开发上下文需要分支和 Worktree 路径。",
				resume: "恢复",
				cancel: "取消",
				reopen: "重新打开",
				takeover: "强制接管",
				delete: "删除",
				confirm: "确认",
				reason: "原因",
				permanentlyDelete: "永久删除",
				participants: "参与者",
				creator: "创建者",
				actors: "操作者",
				attachComment: "附加到评论",
				relationKind: "关系类型",
				relatedTask: "关联任务",
				selectTask: "选择任务",
				add: "添加",
				bytes: "字节",
				current: "当前",
				offline: "离线",
				urgent: "紧急",
				high: "高",
				medium: "中",
				low: "低",
				enabled: "已启用",
				paused: "已暂停",
				more: "更多",
				moreRemaining: "还有 {count} 个",
				modify: "修改",
				runNow: "立即执行",
				recheckIntegrity: "重新校验",
				lastChecked: "上次校验",
				never: "尚未校验",
				tasksTruncated: "仅显示 {shown} / {total} 个任务，请用搜索或状态筛选缩小范围。",
				relationSourceUnloaded: "关系源任务未加载，请先用搜索定位该任务",
				showPreview: "预览",
				hidePreview: "收起预览",
				cleanupStalled: "清理失败已放弃",
				unsavedChanges: "未保存的修改",
				unsavedBody: "这个任务有未保存的修改，关闭后会丢失。",
				discardChanges: "放弃修改",
				keepEditing: "继续编辑",
				automationLog: "自动化运行日志",
				automationClaimed: "读取待办并开始执行 {task}",
				automationEmpty: "已检查待办，当前没有可执行的任务",
				automationFull: "工作器已满，本次未启动新任务",
				automationBlocked: "已检查待办，任务因依赖未完成而跳过",
				automationQuota: "配额不确定，已暂停新认领",
				automationError: "执行失败：{message}",
				openedMinutesAgo: "创建了 {count} 分钟前",
				openedHoursAgo: "创建了 {count} 小时前",
				openedDaysAgo: "创建了 {count} 天前",
				openedOnDate: "创建了 {date}"
			},
			en: {
				taskboard: "Taskboard",
				close: "Close Taskboard",
				newTask: "New task",
				title: "Title",
				description: "Description",
				create: "Create",
				dashboard: "Dashboard",
				board: "Board",
				list: "List",
				gantt: "Gantt",
				workflows: "Workflows",
				other: "Other Tasks",
				backlog: "Backlog",
				todo: "Todo",
				in_progress: "In progress",
				in_review: "In review",
				blocked: "Blocked",
				done: "Done",
				canceled: "Canceled",
				empty: "No tasks",
				noProject: "No project yet — create one to start adding tasks",
				refresh: "Refresh",
				approve: "Approve for work",
				accept: "Accept",
				archive: "Archive",
				restore: "Restore",
				save: "Save",
				closeDetail: "Close details",
				dismiss: "Close",
				comment: "Comment",
				addComment: "Add comment",
				project: "Project",
				addProject: "New project",
				projectName: "Project name",
				projectKey: "Project key",
				due: "Due",
				recentTasks: "Recent tasks",
				priority: "Priority",
				loading: "Reading local task data…",
				workflowNote: "Saved workflows are added to the Agent task context as execution guidance; the scheduler does not run nodes automatically.",
				search: "Search tasks",
				allStatuses: "All statuses",
				deleteProject: "Delete project",
				editProject: "Edit project",
				newSession: "Open in new session",
				workspaceRequired: "Map a Workspace to this project first",
				sessionTaskMustBeActive: "Approve or resume the task before starting a linked Session.",
				comments: "Comments",
				activity: "Activity",
				attachments: "Attachments",
				relations: "Relations",
				sessions: "Linked sessions",
				automation: "Automation",
				enable: "Enable",
				pause: "Pause",
				nextRun: "Next run",
				lastDecision: "Last decision",
				addAutomation: "New automation",
				addWorkflow: "New workflow",
				addStep: "Add step",
				designOnly: "Design only",
				executable: "Executable",
				returnWork: "Return for rework",
				openSession: "Open session",
				storageHealth: "Local storage health",
				healthy: "Healthy",
				degraded: "Needs attention",
				cleanupPending: "Pending attachment cleanup",
				orphanedClaims: "Orphaned claims",
				undo: "Undo last edit",
				today: "Today",
				showCompleted: "Show completed",
				recurrence: "Recurrence",
				noRecurrence: "None",
				interval: "Interval",
				until: "Repeat until",
				write: "Write",
				preview: "Preview",
				edit: "Edit",
				markdownToolbar: "Markdown toolbar",
				mdHeading: "Heading",
				mdBold: "Bold",
				mdItalic: "Italic",
				mdQuote: "Quote",
				mdCode: "Code",
				mdLink: "Link",
				mdBullet: "Bullet list",
				mdNumber: "Numbered list",
				descriptionPlaceholder: "Write the task details in Markdown",
				openIssue: "Open",
				closedIssue: "Closed",
				opened: "opened",
				commentPlaceholder: "Use Markdown to format your comment",
				attachFiles: "Paste, drop, or choose files to attach",
				noneYet: "None yet",
				noOne: "No one",
				noDate: "No date",
				targetDate: "Target date",
				closeIssue: "Close issue",
				labels: "Labels",
				unlabeled: "No label",
				addLabel: "New label",
				renameLabel: "Rename label",
				deleteLabel: "Delete label",
				noLabels: "No labels yet",
				labelName: "Label name",
				unlabeledTasks: "Unlabeled tasks",
				edited: "edited",
				workspaceId: "Harness Workspace ID",
				blankGlobal: "Blank = global project",
				globalProject: "Global project",
				workspace: "Workspace",
				noProjectLabels: "No project labels",
				tasksWord: "tasks",
				activeWord: "active",
				agentPreset: "Agent preset",
				modelRoute: "Model route",
				reasoning: "Reasoning",
				intervalSeconds: "Interval (seconds)",
				workers: "Workers",
				quota: "Quota",
				pauseUncertain: "Pause when uncertain",
				ignore: "Ignore",
				autoPauseEmpty: "Auto-pause when empty",
				model: "Model",
				hostDefault: "host default",
				stayEnabled: "stay enabled",
				status: "Status",
				ganttZoom: "Gantt zoom",
				days30: "30 days",
				days90: "90 days",
				oneYear: "1 year",
				noDatedTasks: "No dated tasks",
				workflowName: "Workflow name",
				nodeKind: "Node kind",
				newTabName: "New tab name",
				triggerKind: "Trigger kind",
				tab: "Tab",
				deleteWorkflow: "Delete workflow",
				installedCapabilities: "Installed capabilities",
				skillDiscovery: "Skill discovery",
				completeWord: "complete",
				refreshing: "refreshing/incomplete",
				skill: "Skill",
				mcp: "MCP",
				copy: "Copy",
				trueLabel: "True",
				falseLabel: "False",
				assignee: "Assignee",
				workflow: "Workflow",
				developmentContext: "Development context",
				none: "None",
				branch: "Branch",
				worktree: "Worktree",
				worktreePath: "Worktree path",
				start: "Start",
				daily: "daily",
				weekly: "weekly",
				monthly: "monthly",
				developmentRequired: "Branch and worktree path are required for the selected development context.",
				resume: "Resume",
				cancel: "Cancel",
				reopen: "Reopen",
				takeover: "Force takeover",
				delete: "Delete",
				confirm: "Confirm",
				reason: "reason",
				permanentlyDelete: "Permanently delete",
				participants: "Participants",
				creator: "Creator",
				actors: "Actors",
				attachComment: "Attach to comment",
				relationKind: "Relation kind",
				relatedTask: "Related task",
				selectTask: "Select task",
				add: "Add",
				bytes: "bytes",
				current: "current",
				offline: "offline",
				urgent: "Urgent",
				high: "High",
				medium: "Medium",
				low: "Low",
				enabled: "Enabled",
				paused: "Paused",
				more: "More",
				moreRemaining: "{count} more",
				modify: "Modify",
				runNow: "Run now",
				recheckIntegrity: "Re-check",
				lastChecked: "Last checked",
				never: "not checked yet",
				tasksTruncated: "Showing {shown} of {total} tasks. Narrow the view with search or the status filter.",
				relationSourceUnloaded: "The source task is not loaded; find it with search first",
				showPreview: "Preview",
				hidePreview: "Hide preview",
				cleanupStalled: "Cleanup gave up",
				unsavedChanges: "Unsaved changes",
				unsavedBody: "This task has unsaved edits. Closing now discards them.",
				discardChanges: "Discard changes",
				keepEditing: "Keep editing",
				automationLog: "Automation run log",
				automationClaimed: "Read Todo and started {task}",
				automationEmpty: "Checked Todo; no eligible tasks to run",
				automationFull: "Workers are busy; no new task was started",
				automationBlocked: "Checked Todo; tasks are waiting on dependencies",
				automationQuota: "Quota is uncertain; new claims are paused",
				automationError: "Run failed: {message}",
				openedMinutesAgo: "opened {count}m ago",
				openedHoursAgo: "opened {count}h ago",
				openedDaysAgo: "opened {count}d ago",
				openedOnDate: "opened on {date}"
			}
		};
		const PRIORITIES = /* @__PURE__ */ new Set([
			"urgent",
			"high",
			"medium",
			"low",
			"none"
		]);
		/** Pick zh when the Harness/browser tag is Chinese; otherwise English. */
		function resolveTaskboardLocale(language) {
			return language.toLowerCase().startsWith("zh") ? "zh" : "en";
		}
		function taskboardStrings(language) {
			return taskboardLocales[resolveTaskboardLocale(language)];
		}
		function interpolate(template, params) {
			return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
		}
		function priorityLabel(t, priority) {
			return PRIORITIES.has(priority) ? t[priority] : priority;
		}
		function formatOpenedAt(createdAt, t) {
			const elapsed = Math.max(0, Date.now() - createdAt);
			const minute = 6e4;
			const hour = 60 * minute;
			const day = 24 * hour;
			if (elapsed < hour) return interpolate(t.openedMinutesAgo, { count: Math.max(1, Math.round(elapsed / minute)) });
			if (elapsed < day) return interpolate(t.openedHoursAgo, { count: Math.max(1, Math.round(elapsed / hour)) });
			if (elapsed < 30 * day) return interpolate(t.openedDaysAgo, { count: Math.max(1, Math.round(elapsed / day)) });
			return interpolate(t.openedOnDate, { date: new Date(createdAt).toLocaleDateString() });
		}
		function formatAutomationLog(t, decision, taskLabel) {
			if (decision.kind === "claimed") return interpolate(t.automationClaimed, { task: taskLabel ?? decision.taskId ?? "—" });
			if (decision.kind === "dependency-blocked") return t.automationBlocked;
			if (decision.kind === "quota-paused") return t.automationQuota;
			if (decision.kind === "error") return interpolate(t.automationError, { message: decision.message });
			return decision.message.includes("concurrency") ? t.automationFull : t.automationEmpty;
		}
		let localeSource;
		const localeListeners = /* @__PURE__ */ new Set();
		function notifyLocaleListeners() {
			for (const listener of [...localeListeners]) listener();
		}
		/** Bind the Harness locale service so the native page follows its language. */
		function bindTaskboardLocale(source) {
			localeSource = source;
			notifyLocaleListeners();
			const off = source?.subscribe(notifyLocaleListeners);
			return () => {
				off?.();
				if (localeSource === source) localeSource = void 0;
			};
		}
		function browserLanguage() {
			return typeof navigator === "undefined" ? "en" : navigator.language;
		}
		function currentTaskboardLanguage() {
			return localeSource?.getSnapshot().active ?? browserLanguage();
		}
		function subscribeTaskboardLocale(listener) {
			localeListeners.add(listener);
			return () => {
				localeListeners.delete(listener);
			};
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
		var _a$1;
		function $constructor(name, initializer, params) {
			function init(inst, def) {
				if (!inst._zod) Object.defineProperty(inst, "_zod", {
					value: {
						def,
						constr: _,
						traits: /* @__PURE__ */ new Set()
					},
					enumerable: false
				});
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				const proto = _.prototype;
				const keys = Object.keys(proto);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				var _a;
				const inst = params?.Parent ? new Definition() : this;
				init(inst, def);
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				for (const fn of inst._zod.deferred) fn();
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		function cached(getter) {
			return { get value() {
				{
					const value = getter();
					Object.defineProperty(this, "value", { value });
					return value;
				}
			} };
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
		function defineLazy(object, key, getter) {
			let value = void 0;
			Object.defineProperty(object, key, {
				get() {
					if (value === EVALUATING) return;
					if (value === void 0) {
						value = EVALUATING;
						value = getter();
					}
					return value;
				},
				set(v) {
					Object.defineProperty(object, key, { value: v });
				},
				configurable: true
			});
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) {
				const descriptors = Object.getOwnPropertyDescriptors(def);
				Object.assign(mergedDescriptors, descriptors);
			}
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
			});
		}
		Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -Number.MAX_VALUE, Number.MAX_VALUE;
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = {};
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						newShape[key] = currDef.shape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = { ...schema._zod.def.shape };
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						delete newShape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = schema._zod.def.shape;
				for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function merge(a, b) {
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			return clone(a, mergeDefs(a._zod.def, {
				get shape() {
					const _shape = {
						...a._zod.def.shape,
						...b._zod.def.shape
					};
					assignProp(this, "shape", _shape);
					return _shape;
				},
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask) {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const oldShape = schema._zod.def.shape;
					const shape = { ...oldShape };
					if (mask) for (const key in mask) {
						if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						shape[key] = Class ? new Class({
							type: "optional",
							innerType: oldShape[key]
						}) : oldShape[key];
					}
					else for (const key in oldShape) shape[key] = Class ? new Class({
						type: "optional",
						innerType: oldShape[key]
					}) : oldShape[key];
					assignProp(this, "shape", shape);
					return shape;
				},
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const oldShape = schema._zod.def.shape;
				const shape = { ...oldShape };
				if (mask) for (const key in mask) {
					if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					shape[key] = new Class({
						type: "nonoptional",
						innerType: oldShape[key]
					});
				}
				else for (const key in oldShape) shape[key] = new Class({
					type: "nonoptional",
					innerType: oldShape[key]
				});
				assignProp(this, "shape", shape);
				return shape;
			} }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function finalizeIssue(iss, ctx, config) {
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
			rest.path ?? (rest.path = []);
			rest.message = message;
			if (ctx?.reportInput) rest.input = _input;
			return rest;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			Object.defineProperty(inst, "_zod", {
				value: inst._zod,
				enumerable: false
			});
			Object.defineProperty(inst, "issues", {
				value: def,
				enumerable: false
			});
			inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
			Object.defineProperty(inst, "toString", {
				value: () => inst.message,
				enumerable: false
			});
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) {
				fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
				fieldErrors[sub.path[0]].push(mapper(sub));
			} else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
							else {
								curr[el] = curr[el] || { _errors: [] };
								curr[el]._errors.push(mapper(issue));
							}
							curr = curr[el];
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
		const _parse = (_Err) => (schema, value, _ctx, _params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			if (result.issues.length) {
				const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, _params?.callee);
				throw e;
			}
			return result.value;
		};
		const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			if (result.issues.length) {
				const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, params?.callee);
				throw e;
			}
			return result.value;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? {
				success: false,
				error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? {
				success: false,
				error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
		const _encode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parse(_Err)(schema, value, ctx);
		};
		const _decode = (_Err) => (schema, value, _ctx) => {
			return _parse(_Err)(schema, value, _ctx);
		};
		const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parseAsync(_Err)(schema, value, ctx);
		};
		const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _parseAsync(_Err)(schema, value, _ctx);
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^[A-Za-z0-9_-]*$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time$1(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime$1(args) {
			const time = timeSource({ precision: args.precision });
			const opts = ["Z"];
			if (args.local) opts.push("");
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const timeRegex = `${time}(?:${opts.join("|")})`;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const string$1 = (params) => {
			const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
			return new RegExp(`^${regex}$`);
		};
		const boolean$1 = /^(?:true|false)$/i;
		const _undefined$2 = /^undefined$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
				if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
				if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.minimum = def.length;
				bag.maximum = def.length;
				bag.length = def.length;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				const length = input.length;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				if (def.pattern) {
					bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
					bag.patterns.add(def.pattern);
				}
			});
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
			def.pattern = pattern;
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = []) {
				this.content = [];
				this.indent = 0;
				if (this) this.args = args;
			}
			indented(fn) {
				this.indent += 1;
				fn(this);
				this.indent -= 1;
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const args = this?.args;
				const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
				return new F(...args, lines.join("\n"));
			}
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const checks = [...inst._zod.def.checks ?? []];
			if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
			defineLazy(inst, "~standard", () => ({
				validate: (value) => {
					try {
						const r = safeParse$1(inst, value);
						return r.success ? { value: r.data } : { issues: r.error?.issues };
					} catch (_) {
						return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
					}
				},
				vendor: "zod",
				version: 1
			}));
		});
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					if (!def.normalize && def.protocol?.source === httpProtocol.source) {
						if (!/^https?:\/\//i.test(trimmed)) {
							payload.issues.push({
								code: "invalid_format",
								format: "url",
								note: "Invalid URL format",
								input: payload.value,
								inst,
								continue: !def.abort
							});
							return;
						}
					}
					const url = new URL(trimmed);
					if (def.hostname) {
						def.hostname.lastIndex = 0;
						if (!def.hostname.test(url.hostname)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid hostname",
							pattern: def.hostname.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.protocol) {
						def.protocol.lastIndex = 0;
						if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid protocol",
							pattern: def.protocol.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.normalize) payload.value = url.href;
					else payload.value = trimmed;
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			def.pattern ?? (def.pattern = nanoid);
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv4`;
		});
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv6`;
			inst._zod.check = (payload) => {
				try {
					new URL(`http://[${payload.value}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "ipv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				const parts = payload.value.split("/");
				try {
					if (parts.length !== 2) throw new Error();
					const [address, prefix] = parts;
					if (!prefix) throw new Error();
					const prefixNum = Number(prefix);
					if (`${prefixNum}` !== prefix) throw new Error();
					if (prefixNum < 0 || prefixNum > 128) throw new Error();
					new URL(`http://[${address}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "cidrv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64";
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64URL(data) {
			if (!base64url.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64url);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64url";
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUndefined = /*@__PURE__*/ $constructor("$ZodUndefined", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = _undefined$2;
			inst._zod.values = /* @__PURE__ */ new Set([void 0]);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (typeof input === "undefined") return payload;
				payload.issues.push({
					expected: "undefined",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = Array(input.length);
				const proms = [];
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else handleArrayResult(result, payload, i);
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
			const isPresent = key in input;
			if (result.issues.length) {
				if (isOptionalIn && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && !isOptionalIn) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				keys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const isOptionalIn = _catchall.optin === "optional";
			const isOptionalOut = _catchall.optout === "optional";
			for (const key in input) {
				if (key === "__proto__") continue;
				if (keySet.has(key)) continue;
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
				else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
				const sh = def.shape;
				Object.defineProperty(def, "shape", { get: () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					return newSh;
				} });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazy(inst._zod, "propValues", () => {
				const shape = def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
					}
				}
				return propValues;
			});
			const isObject$1 = isObject;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = {};
				const proms = [];
				const shape = value.shape;
				for (const key of value.keys) {
					const el = shape[key];
					const isOptionalIn = el._zod.optin === "optional";
					const isOptionalOut = el._zod.optout === "optional";
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
					else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const generateFastpass = (shape) => {
				const doc = new Doc([
					"shape",
					"payload",
					"ctx"
				]);
				const normalized = _normalized.value;
				const parseStr = (key) => {
					const k = esc(key);
					return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				};
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.keys) ids[key] = `key_${counter++}`;
				doc.write(`const newResult = {};`);
				for (const key of normalized.keys) {
					const id = ids[key];
					const k = esc(key);
					const schema = shape[key];
					const isOptionalIn = schema?._zod?.optin === "optional";
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(key)};`);
					if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
					else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				const fn = doc.compile();
				return (payload, ctx) => fn(shape, payload, ctx);
			};
			let fastpass;
			const isObject$2 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "values", () => {
				if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazy(inst._zod, "pattern", () => {
				if (def.options.every((o) => o._zod.pattern)) {
					const patterns = def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				for (const key of sharedKeys) {
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
				unrecIssue ?? (unrecIssue = iss);
				for (const k of iss.keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k).l = true;
				}
			} else result.issues.push(iss);
			for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).r = true;
			}
			else result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length && unrecIssue) result.issues.push({
				...unrecIssue,
				keys: bothKeys
			});
			if (aborted(result)) return result;
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			result.value = merged.data;
			return result;
		}
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				payload.fallback = true;
				return payload;
			};
		});
		function handleOptionalResult(result, input) {
			if (input === void 0 && (result.issues.length || result.fallback)) return {
				issues: [],
				value: void 0
			};
			return result;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.optout = "optional";
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
			});
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (def.innerType._zod.optin === "optional") {
					const input = payload.value;
					const result = def.innerType._zod.run(payload, ctx);
					if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
					return handleOptionalResult(result, input);
				}
				if (payload.value === void 0) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => {
				const v = def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => {
					payload.value = result.value;
					if (result.issues.length) {
						payload.value = def.catchValue({
							...payload,
							error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
							input: payload.value
						});
						payload.issues = [];
						payload.fallback = true;
					}
					return payload;
				});
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
					payload.fallback = true;
				}
				return payload;
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => def.in._zod.values);
			defineLazy(inst._zod, "optin", () => def.in._zod.optin);
			defineLazy(inst._zod, "optout", () => def.out._zod.optout);
			defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.length) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues,
				fallback: left.fallback
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
			defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class({
				type: "string",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _undefined$1(Class, params) {
			return new Class({
				type: "undefined",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) {
				if (ctx.target === "draft-2020-12") result.$defs = defs;
				else result.definitions = defs;
			}
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time") delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const regexes = [...patterns];
				if (regexes.length === 1) json.pattern = regexes[0].source;
				else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const undefinedProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Undefined cannot be represented in JSON Schema");
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			json.properties = {};
			const shape = def.shape;
			for (const key in shape) json.properties[key] = process(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			});
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const v = def.shape[key]._zod;
				if (ctx.io === "input") return v.optin === void 0;
				else return v.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function datetime(params) {
			return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
		}
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function date(params) {
			return /* @__PURE__ */ _isoDate(ZodISODate, params);
		}
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function time(params) {
			return /* @__PURE__ */ _isoTime(ZodISOTime, params);
		}
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function duration(params) {
			return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			Object.defineProperties(inst, {
				format: { value: (mapper) => formatError(inst, mapper) },
				flatten: { value: (mapper) => flattenError(inst, mapper) },
				addIssue: { value: (issue) => {
					inst.issues.push(issue);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				addIssues: { value: (issues) => {
					inst.issues.push(...issues);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				isEmpty: { get() {
					return inst.issues.length === 0;
				} }
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
		const _installedGroups = /* @__PURE__ */ new WeakMap();
		function _installLazyMethods(inst, group, methods) {
			const proto = Object.getPrototypeOf(inst);
			let installed = _installedGroups.get(proto);
			if (!installed) {
				installed = /* @__PURE__ */ new Set();
				_installedGroups.set(proto, installed);
			}
			if (installed.has(group)) return;
			installed.add(group);
			for (const key in methods) {
				const fn = methods[key];
				Object.defineProperty(proto, key, {
					configurable: true,
					enumerable: false,
					get() {
						const bound = fn.bind(this);
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: bound
						});
						return bound;
					},
					set(v) {
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: v
						});
					}
				});
			}
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			$ZodType.init(inst, def);
			Object.assign(inst["~standard"], { jsonSchema: {
				input: createStandardJSONSchemaMethod(inst, "input"),
				output: createStandardJSONSchemaMethod(inst, "output")
			} });
			inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
			inst.def = def;
			inst.type = def.type;
			Object.defineProperty(inst, "_def", { value: def });
			inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
			inst.safeParse = (data, params) => safeParse(inst, data, params);
			inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
			inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
			inst.spa = inst.safeParseAsync;
			inst.encode = (data, params) => encode(inst, data, params);
			inst.decode = (data, params) => decode(inst, data, params);
			inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
			inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
			inst.safeEncode = (data, params) => safeEncode(inst, data, params);
			inst.safeDecode = (data, params) => safeDecode(inst, data, params);
			inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
			inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
			_installLazyMethods(inst, "ZodType", {
				check(...chks) {
					const def = this.def;
					return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
						check: ch,
						def: { check: "custom" },
						onattach: []
					} } : ch)] }), { parent: true });
				},
				with(...chks) {
					return this.check(...chks);
				},
				clone(def, params) {
					return clone(this, def, params);
				},
				brand() {
					return this;
				},
				register(reg, meta) {
					reg.add(this, meta);
					return this;
				},
				refine(check, params) {
					return this.check(refine(check, params));
				},
				superRefine(refinement, params) {
					return this.check(superRefine(refinement, params));
				},
				overwrite(fn) {
					return this.check(/* @__PURE__ */ _overwrite(fn));
				},
				optional() {
					return optional(this);
				},
				exactOptional() {
					return exactOptional(this);
				},
				nullable() {
					return nullable(this);
				},
				nullish() {
					return optional(nullable(this));
				},
				nonoptional(params) {
					return nonoptional(this, params);
				},
				array() {
					return array(this);
				},
				or(arg) {
					return union([this, arg]);
				},
				and(arg) {
					return intersection(this, arg);
				},
				transform(tx) {
					return pipe(this, transform(tx));
				},
				default(d) {
					return _default(this, d);
				},
				prefault(d) {
					return prefault(this, d);
				},
				catch(params) {
					return _catch(this, params);
				},
				pipe(target) {
					return pipe(this, target);
				},
				readonly() {
					return readonly(this);
				},
				describe(description) {
					const cl = this.clone();
					globalRegistry.add(cl, { description });
					return cl;
				},
				meta(...args) {
					if (args.length === 0) return globalRegistry.get(this);
					const cl = this.clone();
					globalRegistry.add(cl, args[0]);
					return cl;
				},
				isOptional() {
					return this.safeParse(void 0).success;
				},
				isNullable() {
					return this.safeParse(null).success;
				},
				apply(fn) {
					return fn(this);
				}
			});
			Object.defineProperty(inst, "description", {
				get() {
					return globalRegistry.get(inst)?.description;
				},
				configurable: true
			});
			return inst;
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
			const bag = inst._zod.bag;
			inst.format = bag.format ?? null;
			inst.minLength = bag.minimum ?? null;
			inst.maxLength = bag.maximum ?? null;
			_installLazyMethods(inst, "_ZodString", {
				regex(...args) {
					return this.check(/* @__PURE__ */ _regex(...args));
				},
				includes(...args) {
					return this.check(/* @__PURE__ */ _includes(...args));
				},
				startsWith(...args) {
					return this.check(/* @__PURE__ */ _startsWith(...args));
				},
				endsWith(...args) {
					return this.check(/* @__PURE__ */ _endsWith(...args));
				},
				min(...args) {
					return this.check(/* @__PURE__ */ _minLength(...args));
				},
				max(...args) {
					return this.check(/* @__PURE__ */ _maxLength(...args));
				},
				length(...args) {
					return this.check(/* @__PURE__ */ _length(...args));
				},
				nonempty(...args) {
					return this.check(/* @__PURE__ */ _minLength(1, ...args));
				},
				lowercase(params) {
					return this.check(/* @__PURE__ */ _lowercase(params));
				},
				uppercase(params) {
					return this.check(/* @__PURE__ */ _uppercase(params));
				},
				trim() {
					return this.check(/* @__PURE__ */ _trim());
				},
				normalize(...args) {
					return this.check(/* @__PURE__ */ _normalize(...args));
				},
				toLowerCase() {
					return this.check(/* @__PURE__ */ _toLowerCase());
				},
				toUpperCase() {
					return this.check(/* @__PURE__ */ _toUpperCase());
				},
				slugify() {
					return this.check(/* @__PURE__ */ _slugify());
				}
			});
		});
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
			inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
			inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
			inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
			inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
			inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
			inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
			inst.datetime = (params) => inst.check(datetime(params));
			inst.date = (params) => inst.check(date(params));
			inst.time = (params) => inst.check(time(params));
			inst.duration = (params) => inst.check(duration(params));
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
		}
		const ZodUndefined = /*@__PURE__*/ $constructor("ZodUndefined", (inst, def) => {
			$ZodUndefined.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => undefinedProcessor(inst, ctx, json, params);
		});
		function _undefined(params) {
			return /* @__PURE__ */ _undefined$1(ZodUndefined, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
			_installLazyMethods(inst, "ZodArray", {
				min(n, params) {
					return this.check(/* @__PURE__ */ _minLength(n, params));
				},
				nonempty(params) {
					return this.check(/* @__PURE__ */ _minLength(1, params));
				},
				max(n, params) {
					return this.check(/* @__PURE__ */ _maxLength(n, params));
				},
				length(n, params) {
					return this.check(/* @__PURE__ */ _length(n, params));
				},
				unwrap() {
					return this.element;
				}
			});
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			defineLazy(inst, "shape", () => {
				return def.shape;
			});
			_installLazyMethods(inst, "ZodObject", {
				keyof() {
					return _enum(Object.keys(this._zod.def.shape));
				},
				catchall(catchall) {
					return this.clone({
						...this._zod.def,
						catchall
					});
				},
				passthrough() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				loose() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				strict() {
					return this.clone({
						...this._zod.def,
						catchall: never()
					});
				},
				strip() {
					return this.clone({
						...this._zod.def,
						catchall: void 0
					});
				},
				extend(incoming) {
					return extend(this, incoming);
				},
				safeExtend(incoming) {
					return safeExtend(this, incoming);
				},
				merge(other) {
					return merge(this, other);
				},
				pick(mask) {
					return pick(this, mask);
				},
				omit(mask) {
					return omit(this, mask);
				},
				partial(...args) {
					return partial(ZodOptional, this, args[0]);
				},
				required(...args) {
					return required(ZodNonOptional, this, args[0]);
				}
			});
		});
		function object(shape, params) {
			const def = {
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			};
			return new ZodObject(def);
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = Object.values(def.entries);
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
			return new ZodEnum({
				type: "enum",
				entries,
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				payload.value = output;
				payload.fallback = true;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		//#endregion
		//#region generated/typert.remote-client.js
		let _shengsheng_dsh_taskboard_taskboard_mutate_parameter_0$schema$value;
		const _shengsheng_dsh_taskboard_taskboard_mutate_parameter_0$schema = () => _shengsheng_dsh_taskboard_taskboard_mutate_parameter_0$schema$value ??= object({
			"endpoint": string().readonly(),
			"payloadJson": string().readonly()
		});
		let _shengsheng_dsh_taskboard_taskboard_mutate_result$schema$value;
		const _shengsheng_dsh_taskboard_taskboard_mutate_result$schema = () => _shengsheng_dsh_taskboard_taskboard_mutate_result$schema$value ??= object({
			"ok": boolean().readonly(),
			"valueJson": string().readonly().optional(),
			"errorCode": string().readonly().optional(),
			"errorMessage": string().readonly().optional()
		});
		let _shengsheng_dsh_taskboard_taskboard_snapshot_parameter_0$schema$value;
		const _shengsheng_dsh_taskboard_taskboard_snapshot_parameter_0$schema = () => _shengsheng_dsh_taskboard_taskboard_snapshot_parameter_0$schema$value ??= union([_undefined(), string()]);
		let _shengsheng_dsh_taskboard_taskboard_snapshot_result$schema$value;
		const _shengsheng_dsh_taskboard_taskboard_snapshot_result$schema = () => _shengsheng_dsh_taskboard_taskboard_snapshot_result$schema$value ??= string();
		let _shengsheng_dsh_taskboard_taskboard_taskDetail_parameter_0$schema$value;
		const _shengsheng_dsh_taskboard_taskboard_taskDetail_parameter_0$schema = () => _shengsheng_dsh_taskboard_taskboard_taskDetail_parameter_0$schema$value ??= string();
		let _shengsheng_dsh_taskboard_taskboard_taskDetail_result$schema$value;
		const _shengsheng_dsh_taskboard_taskboard_taskDetail_result$schema = () => _shengsheng_dsh_taskboard_taskboard_taskDetail_result$schema$value ??= string();
		const TYPERT_REMOTE = {
			package: "@shengsheng/dsh-taskboard",
			descriptors: [
				{
					id: "@shengsheng/dsh-taskboard#taskboard/mutate",
					service: "taskboard",
					namespace: "taskboard",
					method: "mutate",
					implementation: "remoteMutate",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@shengsheng/dsh-taskboard/domain#TaskboardRemoteMutationRequest",
							create: _shengsheng_dsh_taskboard_taskboard_mutate_parameter_0$schema,
							get schema() {
								return _shengsheng_dsh_taskboard_taskboard_mutate_parameter_0$schema();
							}
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@shengsheng/dsh-taskboard/domain#TaskboardRemoteMutationResult",
						create: _shengsheng_dsh_taskboard_taskboard_mutate_result$schema,
						get schema() {
							return _shengsheng_dsh_taskboard_taskboard_mutate_result$schema();
						}
					},
					sourceLocation: {
						"file": "packages/taskboard/src/service/index.ts",
						"line": 405,
						"column": 9
					}
				},
				{
					id: "@shengsheng/dsh-taskboard#taskboard/snapshot",
					service: "taskboard",
					namespace: "taskboard",
					method: "snapshot",
					implementation: "remoteSnapshot",
					invocation: { kind: "direct" },
					parameters: [{
						name: "projectId",
						wire: "projectId",
						source: "json",
						acceptsUndefined: true,
						codec: {
							mode: "strict",
							typeSymbol: "@shengsheng/dsh-taskboard#taskboard/snapshot:projectId",
							create: _shengsheng_dsh_taskboard_taskboard_snapshot_parameter_0$schema,
							get schema() {
								return _shengsheng_dsh_taskboard_taskboard_snapshot_parameter_0$schema();
							}
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@shengsheng/dsh-taskboard#taskboard/snapshot:result",
						create: _shengsheng_dsh_taskboard_taskboard_snapshot_result$schema,
						get schema() {
							return _shengsheng_dsh_taskboard_taskboard_snapshot_result$schema();
						}
					},
					sourceLocation: {
						"file": "packages/taskboard/src/service/index.ts",
						"line": 395,
						"column": 3
					}
				},
				{
					id: "@shengsheng/dsh-taskboard#taskboard/taskDetail",
					service: "taskboard",
					namespace: "taskboard",
					method: "taskDetail",
					implementation: "remoteTaskDetail",
					invocation: { kind: "direct" },
					parameters: [{
						name: "taskId",
						wire: "taskId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@shengsheng/dsh-taskboard#taskboard/taskDetail:taskId",
							create: _shengsheng_dsh_taskboard_taskboard_taskDetail_parameter_0$schema,
							get schema() {
								return _shengsheng_dsh_taskboard_taskboard_taskDetail_parameter_0$schema();
							}
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@shengsheng/dsh-taskboard#taskboard/taskDetail:result",
						create: _shengsheng_dsh_taskboard_taskboard_taskDetail_result$schema,
						get schema() {
							return _shengsheng_dsh_taskboard_taskboard_taskDetail_result$schema();
						}
					},
					sourceLocation: {
						"file": "packages/taskboard/src/service/index.ts",
						"line": 400,
						"column": 3
					}
				}
			]
		};
		//#endregion
		//#region src/client/index.tsx
		const inject = [
			"slots",
			"connection",
			"sessions",
			"workspaces",
			"uiWorkspace",
			"conversation",
			"remote",
			"locale"
		];
		/** A disposed automation Agent becomes a persisted cold Session. Refresh the native list before
		*  selecting it: sessions.open intentionally rejects ids absent from the current list snapshot. */
		async function openTaskSession(navigator, sessionId) {
			if (navigator.list.getSnapshot().byId[sessionId] === void 0) await navigator.refresh();
			if (navigator.list.getSnapshot().byId[sessionId] === void 0) throw new Error(`Session ${sessionId} is unavailable`);
			navigator.open(sessionId);
		}
		function useStrings() {
			return taskboardStrings((0, react.useSyncExternalStore)(subscribeTaskboardLocale, currentTaskboardLanguage, currentTaskboardLanguage));
		}
		/** Kanban glyph in the DSH filled-outline family (same optical weight as the settings gear). */
		function TaskboardIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						fillRule: "evenodd",
						clipRule: "evenodd",
						d: "M3.2 1.05H12.8A2.15 2.15 0 0 1 14.95 3.2V12.8A2.15 2.15 0 0 1 12.8 14.95H3.2A2.15 2.15 0 0 1 1.05 12.8V3.2A2.15 2.15 0 0 1 3.2 1.05ZM3.2 2.37H12.8A0.83 0.83 0 0 1 13.63 3.2V12.8A0.83 0.83 0 0 1 12.8 13.63H3.2A0.83 0.83 0 0 1 2.37 12.8V3.2A0.83 0.83 0 0 1 3.2 2.37Z",
						fill: "currentColor"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M4.56 3.52A0.64 0.64 0 0 1 5.2 4.16V11.84A0.64 0.64 0 0 1 4.56 12.48 0.64 0.64 0 0 1 3.92 11.84V4.16A0.64 0.64 0 0 1 4.56 3.52Z",
						fill: "currentColor"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 3.52A0.64 0.64 0 0 1 8.64 4.16V7.18A0.64 0.64 0 0 1 8 7.82 0.64 0.64 0 0 1 7.36 7.18V4.16A0.64 0.64 0 0 1 8 3.52Z",
						fill: "currentColor"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M11.44 3.52A0.64 0.64 0 0 1 12.08 4.16V9.33A0.64 0.64 0 0 1 11.44 9.97 0.64 0.64 0 0 1 10.8 9.33V4.16A0.64 0.64 0 0 1 11.44 3.52Z",
						fill: "currentColor"
					})
				]
			});
		}
		/** Filled floppy-disk glyph so the primary Save action stays recognizable at small sizes. */
		function SaveIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.2 2.35c0-.58.47-1.05 1.05-1.05h7.15L14 3.9v9.75c0 .58-.47 1.05-1.05 1.05H3.25c-.58 0-1.05-.47-1.05-1.05V2.35Zm2.2.7v3.45h6.05V3.05H4.4Zm1.2.9h1.35v1.7H5.6V3.95ZM3.7 9.2v3.55h8.6V9.2H3.7Z" })
			});
		}
		/** 14px stroke X matching the Harness settings/modal close glyph. */
		function CloseIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4 4l8 8M12 4l-8 8",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})
			});
		}
		/** Downward chevron used as the board-column lazy-load affordance. */
		function MoreIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3.2 6.2L8 11l4.8-4.8",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function actorName(value) {
			return value.split(/[:/]/).pop() || value;
		}
		function actorInitial(value) {
			return (actorName(value).trim().slice(0, 1) || "?").toUpperCase();
		}
		function isClosedStatus(status) {
			return status === "done" || status === "canceled";
		}
		/** Backoff before the change poll is retried, and the idle delay before a truncated project's
		*  search reaches SQLite. */
		const WATCH_RETRY_MS = 2e3;
		const SEARCH_DEBOUNCE_MS = 250;
		function pause(ms, signal) {
			return new Promise((resolve) => {
				const timer = window.setTimeout(() => {
					signal.removeEventListener("abort", onAbort);
					resolve();
				}, ms);
				function onAbort() {
					window.clearTimeout(timer);
					resolve();
				}
				signal.addEventListener("abort", onAbort, { once: true });
			});
		}
		const MARKDOWN_TOOLBAR = [
			{
				action: "heading",
				label: "mdHeading",
				glyph: "H"
			},
			{
				action: "bold",
				label: "mdBold",
				glyph: "B"
			},
			{
				action: "italic",
				label: "mdItalic",
				glyph: "I"
			},
			{
				action: "quote",
				label: "mdQuote",
				glyph: "“"
			},
			{
				action: "code",
				label: "mdCode",
				glyph: "</>"
			},
			{
				action: "link",
				label: "mdLink",
				glyph: "[]"
			},
			{
				action: "ul",
				label: "mdBullet",
				glyph: "•"
			},
			{
				action: "ol",
				label: "mdNumber",
				glyph: "1."
			}
		];
		function ComposerTabs({ mode, onChange }) {
			const t = useStrings();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-taskboard-composer-tabs",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-current": mode === "write" ? "page" : void 0,
					onClick: () => {
						onChange("write");
					},
					children: t.write
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-current": mode === "preview" ? "page" : void 0,
					onClick: () => {
						onChange("preview");
					},
					children: t.preview
				})]
			});
		}
		function MarkdownComposer({ value, onChange, mode, onModeChange, placeholder, emptyPreview }) {
			const t = useStrings();
			const textareaRef = (0, react.useRef)(null);
			const run = (action) => {
				const field = textareaRef.current;
				const next = applyMarkdownEdit(value, field?.selectionStart ?? value.length, field?.selectionEnd ?? value.length, action);
				onChange(next.value);
				requestAnimationFrame(() => {
					textareaRef.current?.focus();
					textareaRef.current?.setSelectionRange(next.selectionStart, next.selectionEnd);
				});
			};
			const onKeyDown = (event) => {
				if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
				const key = event.key.toLowerCase();
				const action = key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : key === "e" ? "code" : void 0;
				if (action === void 0) return;
				event.preventDefault();
				run(action);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-taskboard-composer-bar",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComposerTabs, {
					mode,
					onChange: onModeChange
				}), mode === "write" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-taskboard-md-tools",
					role: "toolbar",
					"aria-label": t.markdownToolbar,
					children: MARKDOWN_TOOLBAR.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						title: t[item.label],
						"aria-label": t[item.label],
						onClick: () => {
							run(item.action);
						},
						children: item.glyph
					}, item.action))
				})]
			}), mode === "write" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
				ref: textareaRef,
				value,
				placeholder,
				onChange: (event) => {
					onChange(event.target.value);
				},
				onKeyDown
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-taskboard-composer-preview",
				children: value.trim() === "" ? emptyPreview : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownText, { value })
			})] });
		}
		/** Attachment row with an inline preview for image types; other types stay download-only. */
		function AttachmentRow({ attachment, download, preview, remove, showMeta = false }) {
			const t = useStrings();
			const [url, setUrl] = (0, react.useState)();
			const previewable = isPreviewableAttachment(attachment.contentType);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: "dsh-taskboard-attachment-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-taskboard-link",
						onClick: () => {
							download(attachment.id, attachment.filename);
						},
						children: attachment.filename
					}),
					showMeta && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						attachment.contentType,
						" · ",
						attachment.byteSize,
						" ",
						t.bytes
					] }),
					previewable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-taskboard-link",
						"aria-expanded": url !== void 0,
						onClick: () => {
							if (url !== void 0) {
								setUrl(void 0);
								return;
							}
							preview(attachment.id).then(setUrl);
						},
						children: url === void 0 ? t.showPreview : t.hidePreview
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: remove,
						children: t.delete
					})
				] }), url !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: url,
					alt: attachment.filename
				})]
			});
		}
		function MetaField({ label, children, nested = false }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: nested ? "dsh-taskboard-meta-field dsh-taskboard-meta-nested" : "dsh-taskboard-meta-field",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children })]
			});
		}
		/** Sidebar foot styles must live on the nav itself: the page style tag unmounts when the overlay is closed.
		*  Wide geometry matches Host Settings: 34px row, full column width, 12px radius, icon+label left-aligned.
		*  Pressed/hover fill is the only selected chrome; do not restore native button padding or grey inset. */
		const NAV_STYLES = `
.dsh-taskboard-nav{-webkit-appearance:none;appearance:none;flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:none;border-radius:12px;background:transparent;box-shadow:none;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;font:inherit;font-size:14px;line-height:22px;overflow:hidden}.dsh-taskboard-nav:hover,.dsh-taskboard-nav[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}.dsh-taskboard-nav-rail{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}.dsh-taskboard-nav-label{overflow:hidden;white-space:nowrap}
`;
		function TaskboardNavButton({ wide, controller }) {
			const route = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const t = useStrings();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: NAV_STYLES }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: wide ? "dsh-taskboard-nav" : "dsh-taskboard-nav dsh-taskboard-nav-rail",
				"aria-pressed": route.open,
				"aria-label": t.taskboard,
				onClick: () => {
					route.open ? controller.close() : controller.open();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskboardIcon, { size: wide ? 16 : 18 }), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-taskboard-nav-label",
					children: t.taskboard
				})]
			})] });
		}
		/** Resolve the sidebar/detail column widths so the page fills only the center column. */
		function useFrameInsets(ref, active) {
			const [insets, setInsets] = (0, react.useState)({
				left: 0,
				right: 0
			});
			(0, react.useEffect)(() => {
				if (!active || ref.current === null) return;
				const frame = ref.current.parentElement?.parentElement?.parentElement;
				if (frame === null || frame === void 0) return;
				const measure = () => {
					const tracks = getComputedStyle(frame).gridTemplateColumns.split(" ");
					const left = Number.parseFloat(tracks[0] ?? "0");
					const right = Number.parseFloat(tracks[tracks.length - 1] ?? "0");
					setInsets({
						left: Number.isFinite(left) ? left : 0,
						right: Number.isFinite(right) ? right : 0
					});
				};
				measure();
				const observer = new ResizeObserver(measure);
				observer.observe(frame);
				return () => {
					observer.disconnect();
				};
			}, [active, ref]);
			return insets;
		}
		function TaskboardPage({ controller, workspaces }) {
			const route = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const workspaceList = (0, react.useMemo)(() => observeSnapshot(workspaces.list), [workspaces]);
			const workspaceState = (0, react.useSyncExternalStore)(workspaceList.subscribe, workspaceList.getSnapshot, workspaceList.getSnapshot);
			const root = (0, react.useRef)(null);
			const insets = useFrameInsets(root, route.open);
			const [snapshot, setSnapshot] = (0, react.useState)();
			const [detail, setDetail] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [refreshKey, setRefreshKey] = (0, react.useState)(0);
			const [query, setQuery] = (0, react.useState)("");
			/** Matches from SQLite for a project whose snapshot was truncated; the in-memory filter below
			*  can only ever see the rows the snapshot carried. */
			const [searchHits, setSearchHits] = (0, react.useState)([]);
			const [statusFilter, setStatusFilter] = (0, react.useState)("all");
			const [logOpen, setLogOpen] = (0, react.useState)(false);
			const [undo, setUndo] = (0, react.useState)();
			/** Newest globalRevision already rendered; the change poll uses it to skip redundant refetches. */
			const loadedRevision = (0, react.useRef)(0);
			/** Serializes writes so a double-click cannot duplicate a task or race the expected version. */
			const inFlight = (0, react.useRef)(false);
			/** Set by the open task dialog; title/description/meta edits live in local state until Save. */
			const detailDirty = (0, react.useRef)(false);
			const [discardPrompt, setDiscardPrompt] = (0, react.useState)(false);
			const t = useStrings();
			(0, react.useEffect)(() => {
				if (!route.open) return;
				const abort = new AbortController();
				setBusy(true);
				controller.snapshot(route.projectId, abort.signal).then((next) => {
					controller.recordSnapshotRevision(next.globalRevision);
					loadedRevision.current = next.globalRevision;
					setSnapshot(next);
					setError(void 0);
					if (route.projectId === void 0 && next.projects[0] !== void 0) controller.select(next.projects[0].id, route.view);
				}).catch((cause) => {
					if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					if (!abort.signal.aborted) setBusy(false);
				});
				return () => {
					abort.abort();
				};
			}, [
				controller,
				refreshKey,
				route.open,
				route.projectId
			]);
			(0, react.useEffect)(() => {
				if (!route.open || route.taskId === void 0) {
					setDetail(void 0);
					return;
				}
				const abort = new AbortController();
				controller.detail(route.taskId, abort.signal).then((value) => {
					if (!abort.signal.aborted) setDetail(value);
				}).catch((cause) => {
					if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
				});
				return () => {
					abort.abort();
				};
			}, [
				controller,
				refreshKey,
				route.open,
				route.taskId
			]);
			(0, react.useEffect)(() => {
				if (!route.open) return;
				return controller.subscribeConnection(() => {
					setRefreshKey((value) => value + 1);
				});
			}, [controller, route.open]);
			(0, react.useEffect)(() => {
				if (!route.open || snapshot === void 0) return;
				const timer = window.setInterval(() => {
					setRefreshKey((value) => value + 1);
				}, snapshot.refreshIntervalMs);
				return () => {
					window.clearInterval(timer);
				};
			}, [route.open, snapshot?.refreshIntervalMs]);
			(0, react.useEffect)(() => {
				if (!route.open || snapshot === void 0) return;
				const abort = new AbortController();
				const watch = async () => {
					let revision = snapshot.globalRevision;
					while (!abort.signal.aborted) {
						let result;
						try {
							result = await controller.watchChanges(revision, abort.signal);
						} catch (cause) {
							if (abort.signal.aborted) return;
							setError(cause instanceof Error ? cause.message : String(cause));
							await pause(WATCH_RETRY_MS, abort.signal);
							continue;
						}
						if (abort.signal.aborted) return;
						if (result.changed || result.globalRevision !== revision) {
							if (result.globalRevision > loadedRevision.current) setRefreshKey((value) => value + 1);
							return;
						}
						revision = result.globalRevision;
					}
				};
				watch();
				return () => {
					abort.abort();
				};
			}, [
				controller,
				route.open,
				snapshot?.globalRevision
			]);
			(0, react.useEffect)(() => {
				const needle = query.trim();
				const projectId = route.projectId;
				if (!route.open || snapshot?.tasksTruncated !== true || needle === "" || projectId === void 0) {
					setSearchHits([]);
					return;
				}
				const abort = new AbortController();
				const timer = window.setTimeout(() => {
					controller.searchTasks(projectId, needle, abort.signal).then((hits) => {
						if (!abort.signal.aborted) setSearchHits(hits);
					}, () => {});
				}, SEARCH_DEBOUNCE_MS);
				return () => {
					abort.abort();
					window.clearTimeout(timer);
				};
			}, [
				controller,
				query,
				route.open,
				route.projectId,
				snapshot?.tasksTruncated,
				refreshKey
			]);
			(0, react.useEffect)(() => {
				if (!route.open) return;
				const onKey = (event) => {
					if (event.key !== "Escape") return;
					if (discardPrompt) {
						event.preventDefault();
						setDiscardPrompt(false);
						return;
					}
					if (logOpen) {
						event.preventDefault();
						setLogOpen(false);
						return;
					}
					if (route.taskId !== void 0) {
						event.preventDefault();
						if (detailDirty.current) setDiscardPrompt(true);
						else controller.select(route.projectId, route.view);
						return;
					}
					controller.close();
				};
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("keydown", onKey);
				};
			}, [
				controller,
				discardPrompt,
				logOpen,
				route.open,
				route.projectId,
				route.taskId,
				route.view
			]);
			if (!route.open) return null;
			const selected = snapshot?.projects.find((project) => project.id === route.projectId) ?? snapshot?.projects[0];
			const tasks = snapshot?.tasks ?? [];
			const visibleTasks = (searchHits.length === 0 ? tasks : [...tasks, ...searchHits.filter((hit) => !tasks.some((task) => task.id === hit.id))]).filter((task) => {
				if (statusFilter !== "all" && task.status !== statusFilter) return false;
				const needle = query.trim().toLocaleLowerCase();
				return needle === "" || `${task.identifier} ${task.title} ${task.description} ${task.labels.join(" ")}`.toLocaleLowerCase().includes(needle);
			});
			const selectedTask = tasks.find((task) => task.id === route.taskId) ?? (detail !== void 0 && detail.task.id === route.taskId ? detail.task : void 0);
			const refresh = () => {
				setRefreshKey((value) => value + 1);
			};
			const closeDetail = () => {
				detailDirty.current = false;
				setDiscardPrompt(false);
				controller.select(selected?.id, route.view);
			};
			/** Every path that closes the task dialog goes through here so unsaved edits are never dropped. */
			const requestCloseDetail = () => {
				if (detailDirty.current) setDiscardPrompt(true);
				else closeDetail();
			};
			const mutate = async (endpoint, payload) => {
				if (inFlight.current) return void 0;
				inFlight.current = true;
				setBusy(true);
				try {
					const prior = endpoint === "task.update" && typeof payload["taskId"] === "string" ? tasks.find((task) => task.id === payload["taskId"]) : void 0;
					const request = payload["request"];
					const value = await controller.mutate(endpoint, payload);
					if (prior !== void 0 && request !== void 0 && typeof value === "object" && value !== null && "version" in value) {
						const inverse = {};
						for (const key of Object.keys(request)) inverse[key] = prior[key] ?? null;
						setUndo({
							endpoint: "task.update",
							payload: {
								taskId: prior.id,
								expectedVersion: Number(value.version),
								request: inverse
							}
						});
					} else if ((endpoint === "task.archive" || endpoint === "task.restore") && typeof value === "object" && value !== null && "version" in value && typeof payload["taskId"] === "string") setUndo({
						endpoint: endpoint === "task.archive" ? "task.restore" : "task.archive",
						payload: {
							taskId: payload["taskId"],
							expectedVersion: Number(value.version)
						}
					});
					if (endpoint === "task.create" && createdTaskId(value) !== void 0) {
						const created = value;
						setSnapshot((prev) => {
							if (prev === void 0 || prev.tasks.some((task) => task.id === created.id)) return prev;
							return {
								...prev,
								tasks: [created, ...prev.tasks]
							};
						});
					}
					setError(void 0);
					refresh();
					return value;
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					setError(message);
					if (message.includes("TASK_STALE_VERSION")) refresh();
					return;
				} finally {
					inFlight.current = false;
					setBusy(false);
				}
			};
			const performUndo = async () => {
				if (undo === void 0 || inFlight.current) return;
				inFlight.current = true;
				setBusy(true);
				try {
					const current = tasks.find((task) => task.id === undo.payload["taskId"]);
					const payload = current === void 0 ? undo.payload : {
						...undo.payload,
						expectedVersion: current.version
					};
					await controller.mutate(undo.endpoint, payload);
					setUndo(void 0);
					setError(void 0);
					refresh();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					inFlight.current = false;
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: root,
				className: "dsh-taskboard-page",
				style: {
					left: insets.left,
					right: insets.right
				},
				role: "main",
				"aria-label": t.taskboard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: STYLES }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-taskboard-header",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-taskboard-brand",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskboardIcon, { size: 16 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t.taskboard })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								"aria-label": t.project,
								value: selected?.id ?? "",
								onChange: (event) => {
									controller.select(event.target.value || void 0, route.view);
								},
								children: snapshot?.projects.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: project.id,
									children: [
										project.key,
										" · ",
										project.name
									]
								}, project.id))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectCreate, {
								controller,
								refresh,
								workspaces: workspaceState.items
							}),
							selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectActions, {
								project: selected,
								controller,
								refresh,
								workspaces: workspaceState.items
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: refresh,
								children: t.refresh
							}),
							selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutomationActions, {
								project: selected,
								automations: snapshot?.automations ?? [],
								defaults: snapshot?.automationDefaults,
								mutate
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-taskboard-icon-close",
								"aria-label": t.close,
								onClick: () => {
									controller.close();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, { size: 14 })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-taskboard-filters",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								"aria-label": t.search,
								placeholder: t.search,
								value: query,
								onChange: (event) => {
									setQuery(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								"aria-label": t.allStatuses,
								value: statusFilter,
								onChange: (event) => {
									setStatusFilter(event.target.value);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "all",
									children: t.allStatuses
								}), [
									"backlog",
									"todo",
									"in_progress",
									"in_review",
									"blocked",
									"done",
									"canceled"
								].map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: status,
									children: t[status]
								}, status))]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: undo === void 0 || busy,
								onClick: () => {
									performUndo();
								},
								children: t.undo
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
						className: "dsh-taskboard-tabs",
						"aria-label": t.taskboard,
						children: [
							"dashboard",
							"board",
							"list",
							"labels",
							"gantt",
							"workflows"
						].map((view) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-current": route.view === view ? "page" : void 0,
							onClick: () => {
								controller.select(selected?.id, view);
							},
							children: t[view]
						}, view))
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-taskboard-error",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-label": t.dismiss,
							onClick: () => {
								setError(void 0);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, { size: 12 })
						})]
					}),
					snapshot?.tasksTruncated === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-taskboard-notice",
						role: "status",
						children: interpolate(t.tasksTruncated, {
							shown: snapshot.tasks.length,
							total: snapshot.taskTotal
						})
					}),
					busy && snapshot === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-taskboard-loading",
						children: t.loading
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-taskboard-content",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("main", {
							className: "dsh-taskboard-view",
							children: selected === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-taskboard-empty",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.noProject }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectCreate, {
									controller,
									refresh,
									workspaces: workspaceState.items
								})]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCreate, {
									project: selected,
									mutate,
									onCreated: (taskId) => {
										controller.select(selected.id, route.view, taskId);
									}
								}),
								route.view === "dashboard" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dashboard, {
									tasks: visibleTasks,
									runs: snapshot?.automationRuns ?? [],
									project: selected,
									storage: snapshot?.storageHealth,
									open: (task) => {
										controller.select(selected?.id, route.view, task.id);
									},
									openLog: () => {
										setLogOpen(true);
									},
									mutate
								}),
								route.view === "board" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Board, {
									tasks: visibleTasks,
									open: (task) => {
										controller.select(selected?.id, route.view, task.id);
									},
									mutate
								}, selected?.id ?? "none"),
								route.view === "list" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListView, {
									tasks: visibleTasks,
									open: (task) => {
										controller.select(selected?.id, route.view, task.id);
									}
								}),
								route.view === "labels" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LabelsView, {
									project: selected,
									tasks: visibleTasks,
									open: (task) => {
										controller.select(selected?.id, route.view, task.id);
									},
									mutate
								}),
								route.view === "gantt" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Gantt, {
									tasks: visibleTasks,
									open: (task) => {
										controller.select(selected?.id, route.view, task.id);
									}
								}),
								route.view === "workflows" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowEditor, {
									project: selected,
									workflows: snapshot?.workflows ?? [],
									catalog: snapshot?.workflowCatalog ?? [],
									capabilities: snapshot?.workflowCapabilities,
									mutate
								})
							] })
						})
					}),
					logOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutomationLogDialog, {
						runs: snapshot?.automationRuns ?? [],
						tasks,
						close: () => {
							setLogOpen(false);
						}
					}),
					discardPrompt && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-taskboard-dialog-backdrop",
						onClick: (event) => {
							if (event.target === event.currentTarget) setDiscardPrompt(false);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-taskboard-discard-dialog",
							role: "alertdialog",
							"aria-modal": "true",
							"aria-label": t.unsavedChanges,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t.unsavedChanges }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.unsavedBody }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									autoFocus: true,
									onClick: () => {
										setDiscardPrompt(false);
									},
									children: t.keepEditing
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: closeDetail,
									children: t.discardChanges
								})] })
							]
						})
					}),
					selectedTask !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskDetail, {
						project: selected,
						task: selectedTask,
						tasks,
						workflows: snapshot?.workflows ?? [],
						detail,
						mutate,
						upload: async (file, commentId) => {
							setBusy(true);
							try {
								await controller.uploadAttachment(selectedTask.id, detail?.task.version ?? selectedTask.version, file, commentId);
								refresh();
							} catch (cause) {
								setError(cause instanceof Error ? cause.message : String(cause));
							} finally {
								setBusy(false);
							}
						},
						download: (id, filename) => controller.downloadAttachment(id, filename),
						preview: (id) => controller.previewAttachmentUrl(id),
						openSession: async (sessionId) => {
							setBusy(true);
							try {
								await controller.openSession(sessionId);
							} catch (cause) {
								setError(cause instanceof Error ? cause.message : String(cause));
							} finally {
								setBusy(false);
							}
						},
						openNewSession: async () => {
							if (selected?.workspaceId === void 0 || detail === void 0) return;
							setBusy(true);
							try {
								await controller.openNewSession(selected.workspaceId, detail);
							} catch (cause) {
								setError(cause instanceof Error ? cause.message : String(cause));
							} finally {
								setBusy(false);
							}
						},
						close: requestCloseDetail,
						onDirtyChange: (value) => {
							detailDirty.current = value;
						}
					}, selectedTask.id)
				]
			});
		}
		function ProjectCreate({ controller, refresh, workspaces }) {
			const t = useStrings();
			const popover = useExclusivePopover();
			const [name, setName] = (0, react.useState)("");
			const [key, setKey] = (0, react.useState)("");
			const [workspaceId, setWorkspaceId] = (0, react.useState)("");
			const [labels, setLabels] = (0, react.useState)("");
			const close = () => {
				popover.setOpen(false);
			};
			const create = async (event) => {
				event.preventDefault();
				if (name.trim() === "" || key.trim() === "") return;
				const project = await controller.mutate("project.create", { request: {
					key: key.trim(),
					name: name.trim(),
					...workspaceId.trim() === "" ? {} : { workspaceId: workspaceId.trim() },
					labels: labels.split(",").map((value) => value.trim()).filter(Boolean)
				} });
				close();
				setName("");
				setKey("");
				setWorkspaceId("");
				setLabels("");
				controller.select(project.id, "board");
				refresh();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PopoverShell, {
				open: popover.open,
				onToggle: popover.toggle,
				onDismiss: close,
				label: `＋ ${t.addProject}`,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					onSubmit: (event) => {
						create(event);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.projectName, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							autoFocus: true,
							value: name,
							onChange: (event) => {
								const value = event.target.value;
								setName(value);
								if (key === "") setKey(value.replaceAll(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase());
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.projectKey, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: key,
							onChange: (event) => {
								setKey(event.target.value.toUpperCase());
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.workspaceId, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: workspaceId,
							onChange: (event) => {
								setWorkspaceId(event.target.value);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: t.blankGlobal
							}), workspaces.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: item.workspaceId,
								children: [
									item.title,
									" · ",
									item.path
								]
							}, item.workspaceId))]
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.labels, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: labels,
							onChange: (event) => {
								setLabels(event.target.value);
							},
							placeholder: "local, release"
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: name.trim() === "" || key.trim() === "",
							children: t.create
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: close,
							children: t.cancel
						})] })
					]
				})
			});
		}
		function ProjectActions({ project, controller, refresh, workspaces }) {
			const t = useStrings();
			const editPopover = useExclusivePopover();
			const deletePopover = useExclusivePopover();
			const [name, setName] = (0, react.useState)(project.name);
			const [workspace, setWorkspace] = (0, react.useState)(project.workspaceId ?? "");
			const [labels, setLabels] = (0, react.useState)(project.labels.join(", "));
			(0, react.useEffect)(() => {
				setName(project.name);
				setWorkspace(project.workspaceId ?? "");
				setLabels(project.labels.join(", "));
			}, [project]);
			const edit = async (event) => {
				event.preventDefault();
				if (name.trim() === "") return;
				await controller.mutate("project.update", {
					projectId: project.id,
					expectedVersion: project.version,
					request: {
						name: name.trim(),
						workspaceId: workspace.trim() || null,
						labels: labels.split(",").map((value) => value.trim()).filter(Boolean)
					}
				});
				editPopover.setOpen(false);
				refresh();
			};
			const remove = async () => {
				await controller.mutate("project.delete", {
					projectId: project.id,
					expectedVersion: project.version
				});
				deletePopover.setOpen(false);
				controller.select(void 0, "dashboard");
				refresh();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PopoverShell, {
				open: editPopover.open,
				onToggle: editPopover.toggle,
				onDismiss: () => {
					editPopover.setOpen(false);
				},
				label: t.editProject,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					onSubmit: (event) => {
						edit(event);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.projectName, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							autoFocus: true,
							value: name,
							onChange: (event) => {
								setName(event.target.value);
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.workspaceId, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: workspace,
							onChange: (event) => {
								setWorkspace(event.target.value);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t.blankGlobal
								}),
								project.workspaceId !== void 0 && !workspaces.some((item) => item.workspaceId === project.workspaceId) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: project.workspaceId,
									children: project.workspaceId
								}),
								workspaces.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: item.workspaceId,
									children: [
										item.title,
										" · ",
										item.path
									]
								}, item.workspaceId))
							]
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.labels, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: labels,
							onChange: (event) => {
								setLabels(event.target.value);
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							children: t.save
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								editPopover.setOpen(false);
							},
							children: t.cancel
						})] })
					]
				})
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PopoverShell, {
				open: deletePopover.open,
				onToggle: deletePopover.toggle,
				onDismiss: () => {
					deletePopover.setOpen(false);
				},
				label: t.deleteProject,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-taskboard-confirm",
					role: "alert",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							t.deleteProject,
							": ",
							project.key,
							" · ",
							project.name,
							"?"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								remove();
							},
							children: t.deleteProject
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								deletePopover.setOpen(false);
							},
							children: t.cancel
						})
					]
				})
			})] });
		}
		function TaskCreate({ project, mutate, onCreated }) {
			const [title, setTitle] = (0, react.useState)("");
			const t = useStrings();
			const submit = (event) => {
				event.preventDefault();
				if (project === void 0 || title.trim() === "") return;
				mutate("task.create", { request: humanQuickCreateRequest(project.id, title) }).then((value) => {
					const taskId = createdTaskId(value);
					if (taskId === void 0) return;
					setTitle("");
					onCreated(taskId);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				className: "dsh-taskboard-create",
				onSubmit: submit,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					value: title,
					onChange: (event) => {
						setTitle(event.target.value);
					},
					placeholder: t.newTask,
					"aria-label": t.title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "submit",
					disabled: project === void 0,
					children: t.create
				})]
			});
		}
		/** The integrity scan reads every database page, so it is an explicit action, never part of a refresh. */
		function StorageHealthPanel({ storage, mutate }) {
			const t = useStrings();
			const [checking, setChecking] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-taskboard-storage",
				"data-status": storage.status,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t.storageHealth }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-taskboard-storage-actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: storage.status === "ok" ? t.healthy : t.degraded }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: checking,
							onClick: () => {
								setChecking(true);
								mutate("storage.check-integrity", {}).finally(() => {
									setChecking(false);
								});
							},
							children: t.recheckIntegrity
						})]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"SQLite: ",
						storage.integrity,
						" · schema v",
						storage.schemaVersion,
						" · revision ",
						storage.globalRevision
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						storage.taskCount,
						" ",
						t.tasksWord,
						" · ",
						storage.attachmentCount,
						" ",
						t.attachments,
						" · ",
						storage.attachmentBytes,
						" ",
						t.bytes
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						t.cleanupPending,
						": ",
						storage.cleanupPending,
						" · ",
						t.cleanupStalled,
						": ",
						storage.cleanupStalled,
						" · ",
						t.orphanedClaims,
						": ",
						storage.orphanedClaims
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						t.lastChecked,
						": ",
						storage.integrityCheckedAt === 0 ? t.never : new Date(storage.integrityCheckedAt).toLocaleString()
					] })
				]
			});
		}
		function Dashboard({ tasks, runs, project, storage, open, openLog, mutate }) {
			const t = useStrings();
			const counts = (0, react.useMemo)(() => {
				const tally = {};
				for (const task of tasks) tally[task.status] = (tally[task.status] ?? 0) + 1;
				return tally;
			}, [tasks]);
			const dueTasks = (0, react.useMemo)(() => [...tasks].filter((task) => task.dueDate !== void 0 && task.status !== "done" && task.status !== "canceled").sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate))).slice(0, 8), [tasks]);
			const recentTasks = (0, react.useMemo)(() => [...tasks].sort((left, right) => right.createdAt - left.createdAt).slice(0, 8), [tasks]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-taskboard-dashboard",
					children: [
						"todo",
						"in_progress",
						"in_review",
						"blocked"
					].map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: counts[status] ?? 0 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t[status] })] }, status))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsh-taskboard-summary",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", { children: [
							project?.key ?? "—",
							" · ",
							project?.name ?? t.project
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: project?.workspaceId === void 0 ? t.globalProject : `${t.workspace}: ${project.workspaceId}` }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: project?.labels.length === 0 ? t.noProjectLabels : `${t.labels}: ${project?.labels.join(", ")}` }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							tasks.length,
							" ",
							t.tasksWord,
							" · ",
							counts["in_progress"] ?? 0,
							" ",
							t.activeWord,
							" · ",
							counts["in_review"] ?? 0,
							" ",
							t.in_review
						] })
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsh-taskboard-due",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t.recentTasks }), recentTasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.empty }) : recentTasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => {
							open(task);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
							task.identifier,
							" · ",
							task.title
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t[task.status] })]
					}, task.id))]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsh-taskboard-due",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t.due }), dueTasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.empty }) : dueTasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => {
							open(task);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
							task.identifier,
							" · ",
							task.title
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							task.dueDate,
							" · ",
							t[task.status]
						] })]
					}, task.id))]
				}),
				storage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StorageHealthPanel, {
					storage,
					mutate
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutomationLog, {
					runs,
					tasks,
					openLog
				})
			] });
		}
		function AutomationActions({ project, automations, defaults, mutate }) {
			const t = useStrings();
			const popover = useExclusivePopover();
			const [adding, setAdding] = (0, react.useState)(false);
			const [agentPreset, setAgentPreset] = (0, react.useState)(defaults?.agentPreset ?? "standard");
			const [modelRoute, setModelRoute] = (0, react.useState)(defaults?.modelRoute ?? "");
			const [reasoning, setReasoning] = (0, react.useState)(defaults?.reasoning ?? "");
			const minimumIntervalSeconds = Math.ceil((defaults?.minIntervalMs ?? 3e4) / 1e3);
			const [intervalSeconds, setIntervalSeconds] = (0, react.useState)(minimumIntervalSeconds);
			const [concurrencyLimit, setConcurrencyLimit] = (0, react.useState)(1);
			const [quotaPolicy, setQuotaPolicy] = (0, react.useState)("ignore");
			const [autoPauseOnEmpty, setAutoPauseOnEmpty] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setAgentPreset(defaults?.agentPreset ?? "standard");
				setModelRoute(defaults?.modelRoute ?? "");
				setReasoning(defaults?.reasoning ?? "");
			}, [
				defaults?.agentPreset,
				defaults?.modelRoute,
				defaults?.reasoning
			]);
			(0, react.useEffect)(() => {
				if (!popover.open) setAdding(false);
			}, [popover.open]);
			const closeMenu = () => {
				setAdding(false);
				popover.setOpen(false);
			};
			const add = (event) => {
				event.preventDefault();
				if (agentPreset.trim() === "") return;
				mutate("automation.create", {
					projectId: project.id,
					config: {
						intervalMs: Math.max(minimumIntervalSeconds, intervalSeconds) * 1e3,
						agentPreset: agentPreset.trim(),
						concurrencyLimit,
						quotaPolicy,
						autoPauseOnEmpty,
						...modelRoute.trim() === "" ? {} : { modelRoute: modelRoute.trim() },
						...reasoning.trim() === "" ? {} : { reasoning: reasoning.trim() }
					}
				}).then(() => {
					setAdding(false);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PopoverShell, {
				open: popover.open,
				onToggle: () => {
					if (popover.open) closeMenu();
					else popover.setOpen(true);
				},
				onDismiss: closeMenu,
				onEscape: () => {
					if (adding) setAdding(false);
					else closeMenu();
				},
				label: t.automation,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-taskboard-automation-menu",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t.automation }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-taskboard-popover-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								"aria-expanded": adding,
								onClick: () => {
									setAdding((value) => !value);
								},
								children: ["＋ ", t.addAutomation]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-taskboard-popover-close",
								"aria-label": t.dismiss,
								onClick: closeMenu,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, { size: 14 })
							})]
						})] }),
						adding && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							className: "dsh-taskboard-automation-form",
							onSubmit: add,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.agentPreset, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: agentPreset,
									onChange: (event) => {
										setAgentPreset(event.target.value);
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.modelRoute, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: modelRoute,
									onChange: (event) => {
										setModelRoute(event.target.value);
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.reasoning, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: reasoning,
									onChange: (event) => {
										setReasoning(event.target.value);
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.intervalSeconds, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: minimumIntervalSeconds,
									value: intervalSeconds,
									onChange: (event) => {
										setIntervalSeconds(Math.max(minimumIntervalSeconds, Number(event.target.value) || minimumIntervalSeconds));
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.workers, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: "1",
									value: concurrencyLimit,
									onChange: (event) => {
										setConcurrencyLimit(Math.max(1, Number(event.target.value) || 1));
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.quota, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									value: quotaPolicy,
									onChange: (event) => {
										setQuotaPolicy(event.target.value);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "pause-on-uncertain",
										children: t.pauseUncertain
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "ignore",
										children: t.ignore
									})]
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: autoPauseOnEmpty,
									onChange: (event) => {
										setAutoPauseOnEmpty(event.target.checked);
									}
								}), t.autoPauseEmpty] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									children: t.create
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										setAdding(false);
									},
									children: t.cancel
								})
							]
						}),
						automations.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.empty }) : automations.map((rule) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutomationEditor, {
							rule,
							defaults,
							minimumIntervalSeconds,
							mutate
						}, rule.id))
					]
				})
			});
		}
		function automationRunLabel(run, tasks) {
			const task = run.decision.taskId === void 0 ? void 0 : tasks.find((item) => item.id === run.decision.taskId);
			return task === void 0 ? run.decision.taskId : `${task.identifier} · ${task.title}`;
		}
		function AutomationLogItems({ runs, tasks }) {
			const t = useStrings();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", { children: runs.map((run) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				"data-kind": run.decision.kind,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
					dateTime: new Date(run.createdAt).toISOString(),
					children: new Date(run.createdAt).toLocaleString()
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatAutomationLog(t, run.decision, automationRunLabel(run, tasks)) })]
			}, run.id)) });
		}
		function AutomationLog({ runs, tasks, openLog }) {
			const t = useStrings();
			const { preview, remaining } = previewAutomationRuns(runs);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-taskboard-log",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t.automationLog }), remaining > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dsh-taskboard-link",
					onClick: openLog,
					children: t.more
				})] }), runs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.empty }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutomationLogItems, {
					runs: preview,
					tasks
				})]
			});
		}
		function AutomationLogDialog({ runs, tasks, close }) {
			const t = useStrings();
			const titleId = (0, react.useId)();
			const dialogRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				dialogRef.current?.focus();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-taskboard-dialog-backdrop",
				onClick: (event) => {
					if (event.target === event.currentTarget) close();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: dialogRef,
					className: "dsh-taskboard-log-dialog",
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": titleId,
					tabIndex: -1,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: titleId,
						children: t.automationLog
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-taskboard-detail-close",
						"aria-label": t.closeDetail,
						onClick: close,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, { size: 14 })
					})] }), runs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.empty }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutomationLogItems, {
						runs,
						tasks
					})]
				})
			});
		}
		function AutomationEditor({ rule, defaults, minimumIntervalSeconds, mutate }) {
			const t = useStrings();
			const [editing, setEditing] = (0, react.useState)(false);
			const [config, setConfig] = (0, react.useState)(() => applyAutomationDefaults(rule.config, defaults));
			(0, react.useEffect)(() => {
				setConfig(applyAutomationDefaults(rule.config, defaults));
			}, [
				rule.version,
				defaults?.modelRoute,
				defaults?.reasoning
			]);
			const update = (next) => {
				setConfig(next);
			};
			const setOptional = (key, value) => {
				const { modelRoute, reasoning, ...required } = config;
				update({
					...required,
					...key === "modelRoute" && value !== "" ? { modelRoute: value } : {},
					...key === "reasoning" && value !== "" ? { reasoning: value } : {},
					...key !== "modelRoute" && modelRoute !== void 0 ? { modelRoute } : {},
					...key !== "reasoning" && reasoning !== void 0 ? { reasoning } : {}
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: rule.config.agentPreset }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
					rule.state === "enabled" ? t.enabled : t.paused,
					" · ",
					rule.config.concurrencyLimit,
					" ",
					t.workers,
					" · ",
					rule.config.intervalMs / 1e3,
					"s"
				] })] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						t.nextRun,
						": ",
						rule.nextEligibleAt === void 0 ? "—" : new Date(rule.nextEligibleAt).toLocaleString()
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						t.lastDecision,
						": ",
						rule.lastDecision === void 0 ? "—" : formatAutomationLog(t, rule.lastDecision)
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						t.model,
						": ",
						rule.config.modelRoute ?? defaults?.modelRoute ?? t.hostDefault,
						" · ",
						t.reasoning,
						": ",
						rule.config.reasoning ?? defaults?.reasoning ?? t.hostDefault,
						" · ",
						t.quota,
						": ",
						rule.config.quotaPolicy,
						" · ",
						t.empty,
						": ",
						rule.config.autoPauseOnEmpty ? t.pause : t.stayEnabled
					] })
				] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => {
							mutate("automation.run-now", { automationId: rule.id });
						},
						children: t.runNow
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => {
							mutate("automation.update", {
								automationId: rule.id,
								expectedVersion: rule.version,
								update: { state: rule.state === "enabled" ? "paused" : "enabled" }
							});
						},
						children: rule.state === "enabled" ? t.pause : t.enable
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"aria-expanded": editing,
						onClick: () => {
							setEditing((value) => !value);
						},
						children: t.modify
					})
				] }),
				editing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					className: "dsh-taskboard-automation-form",
					onSubmit: (event) => {
						event.preventDefault();
						mutate("automation.update", {
							automationId: rule.id,
							expectedVersion: rule.version,
							update: { config }
						}).then(() => {
							setEditing(false);
						});
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.agentPreset, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: config.agentPreset,
							onChange: (event) => {
								update({
									...config,
									agentPreset: event.target.value
								});
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.modelRoute, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: config.modelRoute ?? "",
							onChange: (event) => {
								setOptional("modelRoute", event.target.value.trim());
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.reasoning, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: config.reasoning ?? "",
							onChange: (event) => {
								setOptional("reasoning", event.target.value.trim());
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.intervalSeconds, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "number",
							min: minimumIntervalSeconds,
							value: config.intervalMs / 1e3,
							onChange: (event) => {
								update({
									...config,
									intervalMs: Math.max(minimumIntervalSeconds, Number(event.target.value) || minimumIntervalSeconds) * 1e3
								});
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.workers, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "number",
							min: "1",
							value: config.concurrencyLimit,
							onChange: (event) => {
								update({
									...config,
									concurrencyLimit: Math.max(1, Number(event.target.value) || 1)
								});
							}
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.quota, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: config.quotaPolicy,
							onChange: (event) => {
								update({
									...config,
									quotaPolicy: event.target.value
								});
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "pause-on-uncertain",
								children: t.pauseUncertain
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "ignore",
								children: t.ignore
							})]
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: config.autoPauseOnEmpty,
							onChange: (event) => {
								update({
									...config,
									autoPauseOnEmpty: event.target.checked
								});
							}
						}), t.autoPauseEmpty] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: config.agentPreset.trim() === "",
							children: t.save
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								setEditing(false);
								setConfig(applyAutomationDefaults(rule.config, defaults));
							},
							children: t.cancel
						})
					]
				})
			] });
		}
		function Board({ tasks, open, mutate }) {
			const t = useStrings();
			const [draggedId, setDraggedId] = (0, react.useState)();
			const draggingRef = (0, react.useRef)(false);
			const dragged = tasks.find((task) => task.id === draggedId);
			const applyDrop = (status, target) => {
				const column = tasks.filter((task) => task.status === status && task.archivedAt === void 0);
				const intent = boardDropIntent(dragged, status, column, target);
				setDraggedId(void 0);
				if (intent.kind === "reorder") mutate("task.update", {
					taskId: intent.taskId,
					expectedVersion: intent.expectedVersion,
					request: { sortOrder: intent.sortOrder }
				});
				else if (intent.kind === "move") mutate("task.move", {
					taskId: intent.taskId,
					expectedVersion: intent.expectedVersion,
					status: intent.status,
					...intent.sortOrder === void 0 ? {} : { sortOrder: intent.sortOrder }
				});
			};
			const archived = tasks.filter((task) => task.archivedAt !== void 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-taskboard-board",
				children: TASK_STATUSES.map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BoardColumn, {
					status,
					tasks,
					open,
					applyDrop,
					draggingRef,
					setDraggedId
				}, status))
			}), archived.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-taskboard-other",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t.other }), archived.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
					task,
					open
				}, task.id))]
			})] });
		}
		function BoardColumn({ status, tasks, open, applyDrop, draggingRef, setDraggedId }) {
			const t = useStrings();
			const [visibleCount, setVisibleCount] = (0, react.useState)(15);
			const columnTasks = (0, react.useMemo)(() => tasks.filter((task) => task.status === status && task.archivedAt === void 0), [tasks, status]);
			const { visible, remaining } = paginateBoardColumn(columnTasks, visibleCount);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"data-status": status,
				onDragOver: (event) => {
					event.preventDefault();
				},
				onDrop: (event) => {
					event.preventDefault();
					applyDrop(status);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
							className: "dsh-taskboard-status-dot",
							"data-status": status
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t[status] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: columnTasks.length })
					] }),
					visible.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
						task,
						open: (candidate) => {
							if (!draggingRef.current) open(candidate);
						},
						drag: {
							start: () => {
								draggingRef.current = true;
								setDraggedId(task.id);
							},
							drop: () => {
								applyDrop(status, task);
							},
							end: () => {
								setDraggedId(void 0);
								window.setTimeout(() => {
									draggingRef.current = false;
								}, 0);
							}
						}
					}, task.id)),
					remaining > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsh-taskboard-more",
						"aria-label": `${t.more} · ${interpolate(t.moreRemaining, { count: remaining })}`,
						onClick: () => {
							setVisibleCount((count) => count + 15);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MoreIcon, { size: 16 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-taskboard-more-label",
							children: t.more
						})]
					})
				]
			});
		}
		function TaskCard({ task, open, drag }) {
			const t = useStrings();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				draggable: drag !== void 0,
				className: "dsh-taskboard-card",
				"data-status": task.status,
				onDragStart: drag?.start,
				onDragEnd: drag?.end,
				onDragOver: (event) => {
					if (drag !== void 0) {
						event.preventDefault();
						event.stopPropagation();
					}
				},
				onDrop: (event) => {
					if (drag === void 0) return;
					event.preventDefault();
					event.stopPropagation();
					drag.drop();
				},
				onClick: () => {
					open(task);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						task.identifier,
						" · v",
						task.version
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: task.title }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [priorityLabel(t, task.priority), task.dueDate === void 0 ? "" : ` · ${task.dueDate}`] })
				]
			});
		}
		function ListView({ tasks, open }) {
			const t = useStrings();
			const [sort, setSort] = (0, react.useState)("identifier");
			const [direction, setDirection] = (0, react.useState)("asc");
			const ordered = (0, react.useMemo)(() => sortTaskList(tasks, sort, direction), [
				tasks,
				sort,
				direction
			]);
			const heading = (key, label) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
				"aria-sort": sort === key ? direction === "asc" ? "ascending" : "descending" : "none",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => {
						if (sort === key) setDirection((current) => current === "asc" ? "desc" : "asc");
						else {
							setSort(key);
							setDirection("asc");
						}
					},
					children: [label, sort === key ? direction === "asc" ? " ↑" : " ↓" : ""]
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-taskboard-table-wrap",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					heading("identifier", "ID"),
					heading("title", t.title),
					heading("status", t.status),
					heading("priority", t.priority),
					heading("dueDate", t.due)
				] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: ordered.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-taskboard-row-open",
						onClick: () => {
							open(task);
						},
						children: task.identifier
					}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: task.title }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: t[task.status] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: priorityLabel(t, task.priority) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: task.dueDate ?? "—" })
				] }, task.id)) })] })
			});
		}
		function LabelsView({ project, tasks, open, mutate }) {
			const t = useStrings();
			const catalog = projectLabelCatalog(project.labels, tasks);
			const unlabeled = tasksForLabel(tasks, void 0);
			const [selected, setSelected] = (0, react.useState)(catalog[0]);
			const [draft, setDraft] = (0, react.useState)("");
			const [rename, setRename] = (0, react.useState)("");
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (selected !== void 0 && !catalog.includes(selected)) setSelected(catalog[0]);
			}, [catalog, selected]);
			(0, react.useEffect)(() => {
				setRename(selected ?? "");
				setConfirmDelete(false);
			}, [selected]);
			const selectedTasks = tasksForLabel(tasks, selected);
			const add = (event) => {
				event.preventDefault();
				const name = draft.trim();
				if (name === "" || catalog.includes(name)) return;
				mutate("project.update", {
					projectId: project.id,
					expectedVersion: project.version,
					request: { labels: [...project.labels, name] }
				}).then(() => {
					setDraft("");
					setSelected(name);
				});
			};
			const saveRename = () => {
				const name = rename.trim();
				if (selected === void 0 || name === "" || name === selected) return;
				mutate("project.rename-label", {
					projectId: project.id,
					expectedVersion: project.version,
					from: selected,
					to: name
				}).then(() => {
					setSelected(name);
				});
			};
			const remove = () => {
				if (selected === void 0) return;
				mutate("project.remove-label", {
					projectId: project.id,
					expectedVersion: project.version,
					label: selected
				}).then(() => {
					setConfirmDelete(false);
					setSelected(void 0);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-taskboard-labels",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: "dsh-taskboard-workflow-create",
						onSubmit: add,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							"aria-label": t.labelName,
							value: draft,
							onChange: (event) => {
								setDraft(event.target.value);
							},
							placeholder: t.addLabel
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "submit",
							disabled: draft.trim() === "",
							children: ["＋ ", t.addLabel]
						})]
					}),
					catalog.map((label) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: label === selected ? "active" : "",
						onClick: () => {
							setSelected(label);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tasksForLabel(tasks, label).length })]
					}, label)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: selected === void 0 ? "active" : "",
						onClick: () => {
							setSelected(void 0);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t.unlabeled }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: unlabeled.length })]
					})
				] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [selected === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t.unlabeledTasks }) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						"aria-label": t.renameLabel,
						value: rename,
						onChange: (event) => {
							setRename(event.target.value);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: rename.trim() === "" || rename.trim() === selected,
						onClick: saveRename,
						children: t.save
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"aria-expanded": confirmDelete,
						onClick: () => {
							setConfirmDelete((value) => !value);
						},
						children: t.deleteLabel
					}),
					confirmDelete && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-taskboard-confirm",
						role: "alert",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t.deleteLabel,
								" “",
								selected,
								"”?"
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: remove,
								children: t.delete
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									setConfirmDelete(false);
								},
								children: t.close
							})
						]
					})
				] }), selectedTasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-taskboard-empty",
					children: selected === void 0 && catalog.length === 0 ? t.noLabels : t.empty
				}) : selectedTasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
					task,
					open
				}, task.id))] })]
			});
		}
		function Gantt({ tasks, open }) {
			const t = useStrings();
			const [zoom, setZoom] = (0, react.useState)("quarter");
			const [showCompleted, setShowCompleted] = (0, react.useState)(false);
			const [anchor, setAnchor] = (0, react.useState)(() => Date.now());
			const rows = (0, react.useRef)(null);
			const [todayLeft, setTodayLeft] = (0, react.useState)();
			const days = zoom === "month" ? 30 : zoom === "quarter" ? 90 : 365;
			const start = anchor - days / 2 * 864e5;
			const point = (value, fallback) => value === void 0 ? fallback : (/* @__PURE__ */ new Date(`${value}T00:00:00Z`)).getTime();
			const end = start + days * 864e5;
			const dated = tasks.filter((task) => {
				if (task.startDate === void 0 && task.dueDate === void 0) return false;
				if (!showCompleted && task.status === "done") return false;
				const taskStart = point(task.startDate, point(task.dueDate, anchor));
				return Math.max(point(task.dueDate, taskStart + 864e5), taskStart + 864e5) >= start && taskStart <= end;
			});
			(0, react.useEffect)(() => {
				const container = rows.current;
				if (container === null) return;
				const measure = () => {
					const track = container.querySelector(".dsh-taskboard-gantt-track");
					if (track === null) {
						setTodayLeft(void 0);
						return;
					}
					const trackBox = track.getBoundingClientRect();
					const containerBox = container.getBoundingClientRect();
					setTodayLeft(trackBox.left - containerBox.left + trackBox.width / 2);
				};
				measure();
				const observer = new ResizeObserver(measure);
				observer.observe(container);
				return () => {
					observer.disconnect();
				};
			}, [dated.length, zoom]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-taskboard-gantt",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => {
							setAnchor(Date.now());
						},
						children: t.today
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						"aria-label": t.ganttZoom,
						value: zoom,
						onChange: (event) => {
							setZoom(event.target.value);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "month",
								children: t.days30
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "quarter",
								children: t.days90
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "year",
								children: t.oneYear
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: showCompleted,
						onChange: (event) => {
							setShowCompleted(event.target.checked);
						}
					}), t.showCompleted] })
				] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-taskboard-gantt-rows",
					ref: rows,
					children: [todayLeft !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-taskboard-today",
						style: { left: `${String(todayLeft)}px` },
						"aria-hidden": "true"
					}), dated.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-taskboard-empty",
						children: t.noDatedTasks
					}) : dated.map((task) => {
						const taskStart = point(task.startDate, point(task.dueDate, anchor));
						const taskEnd = point(task.dueDate, taskStart + 864e5);
						const left = Math.max(0, Math.min(100, (taskStart - start) / (days * 864e5) * 100));
						const width = Math.max(1.5, Math.min(100 - left, (Math.max(taskEnd, taskStart + 864e5) - taskStart) / (days * 864e5) * 100));
						const repeat = task.recurrence === void 0 ? "" : ` · ${task.recurrence.frequency}/${task.recurrence.interval}${task.recurrence.until === void 0 ? "" : ` until ${task.recurrence.until}`}`;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							onClick: () => {
								open(task);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									task.identifier,
									" · ",
									task.title
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-taskboard-gantt-track",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
										left: `${left}%`,
										width: `${width}%`
									} })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
									task.startDate ?? "…",
									" → ",
									task.dueDate ?? "…",
									repeat
								] })
							]
						}, task.id);
					})]
				})]
			});
		}
		function WorkflowEditor({ project, workflows, catalog, capabilities, mutate }) {
			const t = useStrings();
			const [selectedId, setSelectedId] = (0, react.useState)();
			const selected = workflows.find((item) => item.id === selectedId) ?? workflows[0];
			const [name, setName] = (0, react.useState)("");
			const [document, setDocument] = (0, react.useState)();
			const stepEntries = catalog.filter((item) => item.category !== "trigger");
			const triggerEntries = catalog.filter((item) => item.category === "trigger");
			const [newWorkflowName, setNewWorkflowName] = (0, react.useState)("");
			const [nodeKind, setNodeKind] = (0, react.useState)("tests");
			const [newTabName, setNewTabName] = (0, react.useState)("");
			const [triggerKind, setTriggerKind] = (0, react.useState)("issue-trigger");
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setSelectedId(selected?.id);
				setName(selected?.name ?? "");
				setDocument(selected?.document);
			}, [
				selected?.id,
				selected?.name,
				selected?.version
			]);
			const create = (event) => {
				event.preventDefault();
				if (project === void 0 || newWorkflowName.trim() === "") return;
				const trigger = catalog.find((item) => item.kind === "issue-trigger" && item.category === "trigger");
				if (trigger === void 0) return;
				mutate("workflow.create", {
					projectId: project.id,
					name: newWorkflowName.trim(),
					document: { tabs: [{
						id: "main",
						name: "Main",
						trigger: {
							id: "trigger",
							kind: trigger.kind,
							execution: trigger.execution,
							config: {}
						},
						steps: []
					}] }
				}).then(() => {
					setNewWorkflowName("");
				});
			};
			const addStep = () => {
				if (document === void 0) return;
				const entry = catalog.find((item) => item.kind === nodeKind);
				if (entry === void 0 || entry.category === "trigger") return;
				const first = document.tabs[0];
				if (first === void 0) return;
				const node = {
					id: `${nodeKind}-${Date.now()}`,
					kind: nodeKind,
					execution: entry.execution,
					config: {}
				};
				setDocument(insertWorkflowNode(document, first.id, node));
			};
			const addTab = () => {
				if (document === void 0 || newTabName.trim() === "") return;
				const entry = catalog.find((item) => item.kind === triggerKind && item.category === "trigger");
				if (entry === void 0) return;
				const suffix = Date.now();
				setDocument(addWorkflowTab(document, {
					id: `tab-${suffix}`,
					name: newTabName.trim(),
					trigger: {
						id: `trigger-${suffix}`,
						kind: triggerKind,
						execution: entry.execution,
						config: {}
					},
					steps: []
				}));
				setNewTabName("");
			};
			const editNode = (action, tabId, nodeId) => {
				if (document === void 0) return;
				if (action === "up" || action === "down") setDocument(moveWorkflowNode(document, nodeId, action === "up" ? -1 : 1));
				else if (action === "copy") {
					const suffix = Date.now();
					setDocument(copyWorkflowNode(document, nodeId, (source) => `${source}-copy-${suffix}`));
				} else if (action === "delete") setDocument(removeWorkflowNode(document, nodeId));
				else {
					const entry = catalog.find((item) => item.kind === nodeKind && item.category !== "trigger");
					if (entry === void 0) return;
					setDocument(insertWorkflowNode(document, tabId, {
						id: `${nodeKind}-${Date.now()}`,
						kind: nodeKind,
						execution: entry.execution,
						config: {}
					}, nodeId, action === "true" ? "trueBranch" : "falseBranch"));
				}
			};
			const addCapability = (kind, target) => {
				if (document === void 0 || document.tabs[0] === void 0) return;
				const entry = catalog.find((item) => item.kind === kind);
				if (entry === void 0) return;
				setDocument(insertWorkflowNode(document, document.tabs[0].id, {
					id: `${kind}-${Date.now()}`,
					kind,
					execution: entry.execution,
					config: { target }
				}));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-taskboard-workflows",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					className: "dsh-taskboard-workflow-create",
					onSubmit: create,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						"aria-label": t.workflowName,
						value: newWorkflowName,
						onChange: (event) => {
							setNewWorkflowName(event.target.value);
						},
						placeholder: t.workflowName
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "submit",
						disabled: project === void 0 || newWorkflowName.trim() === "",
						children: ["＋ ", t.addWorkflow]
					})]
				}), workflows.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: item.id === selected?.id ? "active" : "",
					onClick: () => {
						setSelectedId(item.id);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: ["v", item.version] })]
				}, item.id))] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", { children: selected === void 0 || document === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-taskboard-empty",
					children: t.workflowNote
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							"aria-label": t.workflowName,
							value: name,
							onChange: (event) => {
								setName(event.target.value);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							"aria-label": t.nodeKind,
							value: nodeKind,
							onChange: (event) => {
								setNodeKind(event.target.value);
							},
							children: stepEntries.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: item.kind,
								children: item.kind
							}, item.kind))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							onClick: addStep,
							children: ["＋ ", t.addStep]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							"aria-label": t.newTabName,
							value: newTabName,
							onChange: (event) => {
								setNewTabName(event.target.value);
							},
							placeholder: t.newTabName
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							"aria-label": t.triggerKind,
							value: triggerKind,
							onChange: (event) => {
								setTriggerKind(event.target.value);
							},
							children: triggerEntries.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: item.kind,
								children: item.kind
							}, item.kind))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							disabled: newTabName.trim() === "",
							onClick: addTab,
							children: ["＋ ", t.tab]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								mutate("workflow.update", {
									workflowId: selected.id,
									expectedVersion: selected.version,
									name,
									document
								});
							},
							children: t.save
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-expanded": confirmDelete,
							onClick: () => {
								setConfirmDelete((value) => !value);
							},
							children: "×"
						}),
						confirmDelete && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-taskboard-confirm",
							role: "alert",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t.deleteWorkflow, "?"] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										mutate("workflow.delete", {
											workflowId: selected.id,
											expectedVersion: selected.version
										});
										setConfirmDelete(false);
									},
									children: t.delete
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										setConfirmDelete(false);
									},
									children: t.close
								})
							]
						})
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-taskboard-workflow-tabs",
						children: document.tabs.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: tab.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								disabled: document.tabs.length <= 1,
								onClick: () => {
									setDocument(removeWorkflowTab(document, tab.id));
								},
								children: ["× ", t.tab]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowNodeCard, {
								node: tab.trigger,
								tabId: tab.id,
								edit: editNode,
								trigger: true
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsh-taskboard-flow-line" }),
							tab.steps.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowNodeCard, {
								node,
								tabId: tab.id,
								edit: editNode
							}, node.id))
						] }, tab.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", { children: catalog.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						"data-execution": item.execution,
						children: [
							item.kind,
							" · ",
							item.execution === "executable" ? t.executable : t.designOnly
						]
					}, item.kind)) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-taskboard-capabilities",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t.installedCapabilities }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
								t.skillDiscovery,
								": ",
								capabilities?.skillDiscoveryComplete === true ? t.completeWord : t.refreshing
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: capabilities?.skills.map((skill) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								title: skill.description,
								onClick: () => {
									addCapability("skill", skill.name);
								},
								children: [
									"＋ ",
									t.skill,
									" · ",
									skill.name
								]
							}, `skill-${skill.name}`)) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: capabilities?.mcpTools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								title: tool.description,
								onClick: () => {
									addCapability("mcp", tool.name);
								},
								children: [
									"＋ ",
									t.mcp,
									" · ",
									tool.name
								]
							}, `mcp-${tool.name}`)) })
						]
					})
				] }) })]
			});
		}
		function WorkflowNodeCard({ node, tabId, edit, trigger = false }) {
			const t = useStrings();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-taskboard-workflow-node",
				"data-execution": node.execution,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: node.kind }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: node.execution === "executable" ? t.executable : t.designOnly }),
					!trigger && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-taskboard-workflow-node-actions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									edit("up", tabId, node.id);
								},
								children: "↑"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									edit("down", tabId, node.id);
								},
								children: "↓"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									edit("copy", tabId, node.id);
								},
								children: t.copy
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									edit("delete", tabId, node.id);
								},
								children: "×"
							}),
							node.kind === "condition" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => {
									edit("true", tabId, node.id);
								},
								children: ["＋ ", t.trueLabel]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => {
									edit("false", tabId, node.id);
								},
								children: ["＋ ", t.falseLabel]
							})] })
						]
					}),
					node.steps?.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowNodeCard, {
						node: child,
						tabId,
						edit
					}, child.id)),
					(node.trueBranch !== void 0 || node.falseBranch !== void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-taskboard-branches",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t.trueLabel }), node.trueBranch?.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowNodeCard, {
							node: child,
							tabId,
							edit
						}, child.id))] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t.falseLabel }), node.falseBranch?.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowNodeCard, {
							node: child,
							tabId,
							edit
						}, child.id))] })]
					})
				]
			});
		}
		function TaskDetail({ project, task, tasks, workflows, detail, mutate, upload, download, preview, openSession, openNewSession, close, onDirtyChange }) {
			const t = useStrings();
			const [title, setTitle] = (0, react.useState)(task.title);
			const [description, setDescription] = (0, react.useState)(task.description);
			const [priority, setPriority] = (0, react.useState)(task.priority);
			const [labels, setLabels] = (0, react.useState)(task.labels.join(", "));
			const [startDate, setStartDate] = (0, react.useState)(task.startDate ?? "");
			const [dueDate, setDueDate] = (0, react.useState)(task.dueDate ?? "");
			const [recurrence, setRecurrence] = (0, react.useState)(task.recurrence?.frequency ?? "");
			const [recurrenceInterval, setRecurrenceInterval] = (0, react.useState)(String(task.recurrence?.interval ?? 1));
			const [recurrenceUntil, setRecurrenceUntil] = (0, react.useState)(task.recurrence?.until ?? "");
			const [assignee, setAssignee] = (0, react.useState)(task.assignee ?? "");
			const [workflowId, setWorkflowId] = (0, react.useState)(task.workflowId ?? "");
			const [developmentKind, setDevelopmentKind] = (0, react.useState)(task.developmentContext?.kind ?? "");
			const [developmentBranch, setDevelopmentBranch] = (0, react.useState)(task.developmentContext?.branch ?? "");
			const [worktreePath, setWorktreePath] = (0, react.useState)(task.developmentContext?.kind === "worktree" ? task.developmentContext.path : "");
			const [comment, setComment] = (0, react.useState)("");
			const [descriptionMode, setDescriptionMode] = (0, react.useState)(descriptionComposerMode(task.description));
			const [editingDescription, setEditingDescription] = (0, react.useState)(true);
			const [commentMode, setCommentMode] = (0, react.useState)("write");
			const [editingCommentId, setEditingCommentId] = (0, react.useState)();
			const [editCommentBody, setEditCommentBody] = (0, react.useState)("");
			const [editCommentMode, setEditCommentMode] = (0, react.useState)("write");
			const [deletingCommentId, setDeletingCommentId] = (0, react.useState)();
			const [relationKind, setRelationKind] = (0, react.useState)("related");
			const [relationTarget, setRelationTarget] = (0, react.useState)("");
			const [pendingAction, setPendingAction] = (0, react.useState)("");
			const [actionReason, setActionReason] = (0, react.useState)("");
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(false);
			const titleId = (0, react.useId)();
			const dialogRef = (0, react.useRef)(null);
			const developmentInvalid = developmentKind === "branch" ? developmentBranch.trim() === "" : developmentKind === "worktree" && (developmentBranch.trim() === "" || worktreePath.trim() === "");
			const dirty = title !== task.title || description !== task.description || priority !== task.priority || labels !== task.labels.join(", ") || (assignee.trim() || "") !== (task.assignee ?? "") || (workflowId || "") !== (task.workflowId ?? "") || developmentKind !== (task.developmentContext?.kind ?? "") || developmentBranch !== (task.developmentContext?.branch ?? "") || worktreePath !== (task.developmentContext?.kind === "worktree" ? task.developmentContext.path : "") || startDate !== (task.startDate ?? "") || dueDate !== (task.dueDate ?? "") || recurrence !== (task.recurrence?.frequency ?? "") || recurrence !== "" && recurrenceInterval !== String(task.recurrence?.interval ?? 1) || recurrence !== "" && recurrenceUntil !== (task.recurrence?.until ?? "");
			const currentVersion = detail?.task.version ?? task.version;
			(0, react.useEffect)(() => {
				onDirtyChange(dirty);
				return () => {
					onDirtyChange(false);
				};
			}, [dirty, onDirtyChange]);
			(0, react.useEffect)(() => {
				setTitle(task.title);
				setDescription(task.description);
				setPriority(task.priority);
				setLabels(task.labels.join(", "));
				setStartDate(task.startDate ?? "");
				setDueDate(task.dueDate ?? "");
				setRecurrence(task.recurrence?.frequency ?? "");
				setRecurrenceInterval(String(task.recurrence?.interval ?? 1));
				setRecurrenceUntil(task.recurrence?.until ?? "");
				setAssignee(task.assignee ?? "");
				setWorkflowId(task.workflowId ?? "");
				setDevelopmentKind(task.developmentContext?.kind ?? "");
				setDevelopmentBranch(task.developmentContext?.branch ?? "");
				setWorktreePath(task.developmentContext?.kind === "worktree" ? task.developmentContext.path : "");
				setComment("");
				setPendingAction("");
				setActionReason("");
				setConfirmDelete(false);
				setDescriptionMode(descriptionComposerMode(task.description));
				setEditingDescription(true);
				setCommentMode("write");
				setEditingCommentId(void 0);
				setEditCommentBody("");
				setDeletingCommentId(void 0);
			}, [task.id]);
			(0, react.useEffect)(() => {
				dialogRef.current?.focus();
			}, [task.id]);
			const save = () => {
				mutate("task.update", {
					taskId: task.id,
					expectedVersion: currentVersion,
					request: {
						title,
						description,
						priority,
						labels: labels.split(",").map((value) => value.trim()).filter(Boolean),
						assignee: assignee.trim() || null,
						workflowId: workflowId || null,
						developmentContext: developmentKind === "" ? null : developmentKind === "branch" ? {
							kind: "branch",
							branch: developmentBranch.trim()
						} : {
							kind: "worktree",
							branch: developmentBranch.trim(),
							path: worktreePath.trim()
						},
						startDate: startDate || null,
						dueDate: dueDate || null,
						recurrence: recurrence === "" ? null : {
							frequency: recurrence,
							interval: Math.max(1, Number.parseInt(recurrenceInterval, 10) || 1),
							...recurrenceUntil === "" ? {} : { until: recurrenceUntil }
						}
					}
				});
			};
			const runReasonAction = () => {
				const reason = actionReason.trim();
				if (reason === "" || pendingAction === "") return;
				const endpoint = pendingAction === "return" ? "task.return" : pendingAction === "block" ? "task.block" : pendingAction === "reopen" ? "task.reopen" : "task.force-takeover";
				const reasonKey = pendingAction === "return" ? "comment" : "reason";
				mutate(endpoint, {
					taskId: task.id,
					expectedVersion: currentVersion,
					[reasonKey]: reason
				}).then(() => {
					setPendingAction("");
					setActionReason("");
				});
			};
			const taskLabel = (id) => {
				const match = tasks.find((item) => item.id === id);
				return match === void 0 ? id : `${match.identifier} · ${match.title}`;
			};
			const relationLabel = (relation) => {
				if (relation.kind === "related") return `related · ${taskLabel(relation.sourceTaskId === task.id ? relation.targetTaskId : relation.sourceTaskId)}`;
				if (relation.kind === "parent") return relation.sourceTaskId === task.id ? `parent of · ${taskLabel(relation.targetTaskId)}` : `child of · ${taskLabel(relation.sourceTaskId)}`;
				return relation.sourceTaskId === task.id ? `blocks · ${taskLabel(relation.targetTaskId)}` : `blocked by · ${taskLabel(relation.sourceTaskId)}`;
			};
			const saveDisabled = title.trim() === "" || developmentInvalid;
			const closed = isClosedStatus(task.status);
			const taskAttachments = detail?.attachments.filter((item) => item.commentId === void 0) ?? [];
			const submitComment = () => {
				if (comment.trim() === "") return;
				mutate("task.comment", {
					taskId: task.id,
					expectedVersion: currentVersion,
					body: comment.trim()
				}).then(() => {
					setComment("");
					setCommentMode("write");
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-taskboard-dialog-backdrop",
				onClick: (event) => {
					if (event.target === event.currentTarget) close();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: dialogRef,
					className: "dsh-taskboard-detail",
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": titleId,
					tabIndex: -1,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-taskboard-detail-header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-taskboard-detail-heading",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-taskboard-detail-meta",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dsh-taskboard-issue-badge",
											"data-closed": closed ? "true" : void 0,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
												className: "dsh-taskboard-status-dot",
												"data-status": task.status
											}), closed ? t.closedIssue : t.openIssue]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dsh-taskboard-detail-path",
											children: [
												project?.key ?? t.project,
												" · ",
												task.identifier
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
											"v",
											task.version,
											" · ",
											t[task.status]
										] })
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: titleId,
									className: "dsh-taskboard-detail-title",
									value: title,
									"aria-label": t.title,
									onChange: (event) => {
										setTitle(event.target.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-taskboard-detail-author",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-taskboard-avatar",
										"aria-hidden": "true",
										children: actorInitial(task.creator)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: actorName(task.creator) }),
										" ",
										formatOpenedAt(task.createdAt, t)
									] })]
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-taskboard-detail-toolbar",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsh-taskboard-save",
								"data-dirty": dirty ? "true" : void 0,
								disabled: saveDisabled,
								title: developmentInvalid ? t.developmentRequired : void 0,
								onClick: save,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SaveIcon, { size: 16 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t.save })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-taskboard-detail-close",
								"aria-label": t.closeDetail,
								onClick: close,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, { size: 14 })
							})]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-taskboard-detail-columns",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-taskboard-detail-main",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
									className: "dsh-taskboard-body",
									"aria-label": t.description,
									children: editingDescription ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownComposer, {
										value: description,
										onChange: setDescription,
										mode: descriptionMode,
										onModeChange: setDescriptionMode,
										placeholder: t.descriptionPlaceholder,
										emptyPreview: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.empty })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-taskboard-link",
										onClick: () => {
											setEditingDescription(false);
											setDescriptionMode("preview");
										},
										children: t.preview
									}) })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-taskboard-body-content",
										children: description.trim() === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-taskboard-muted",
											children: t.empty
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownText, { value: description })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-taskboard-link",
										onClick: () => {
											setEditingDescription(true);
											setDescriptionMode("write");
										},
										children: t.edit
									}) })] })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-taskboard-detail-feed",
									children: [taskAttachments.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
										className: "dsh-taskboard-timeline-block",
										"aria-label": t.attachments,
										children: taskAttachments.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AttachmentRow, {
											attachment: item,
											download,
											preview,
											showMeta: true,
											remove: () => {
												mutate("attachment.delete", {
													taskId: task.id,
													expectedVersion: currentVersion,
													attachmentId: item.id
												});
											}
										}, item.id))
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
										className: "dsh-taskboard-timeline",
										children: (detail?.comments ?? []).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											className: "dsh-taskboard-timeline-comment",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsh-taskboard-avatar",
												"aria-hidden": "true",
												children: actorInitial(item.authorId)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: actorName(item.authorId) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [new Date(item.createdAt).toLocaleString(), item.updatedAt !== item.createdAt ? ` · ${t.edited}` : ""] })] }), deletingCommentId === item.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dsh-taskboard-comment-actions",
													role: "alert",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t.delete, "?"] }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "dsh-taskboard-save",
															onClick: () => {
																mutate("comment.delete", {
																	taskId: task.id,
																	expectedVersion: currentVersion,
																	commentId: item.id
																}).then((value) => {
																	if (value !== void 0) setDeletingCommentId(void 0);
																});
															},
															children: t.delete
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															onClick: () => {
																setDeletingCommentId(void 0);
															},
															children: t.cancel
														})
													]
												}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dsh-taskboard-comment-actions",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsh-taskboard-link",
														onClick: () => {
															setEditingCommentId(item.id);
															setEditCommentBody(item.body);
															setEditCommentMode("write");
															setDeletingCommentId(void 0);
														},
														children: t.edit
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsh-taskboard-link",
														onClick: () => {
															setDeletingCommentId(item.id);
															setEditingCommentId(void 0);
														},
														children: t.delete
													})]
												})] }),
												editingCommentId === item.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownComposer, {
													value: editCommentBody,
													onChange: setEditCommentBody,
													mode: editCommentMode,
													onModeChange: setEditCommentMode,
													placeholder: t.commentPlaceholder,
													emptyPreview: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.commentPlaceholder })
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dsh-taskboard-save",
													disabled: editCommentBody.trim() === "",
													onClick: () => {
														mutate("comment.update", {
															taskId: task.id,
															expectedVersion: currentVersion,
															commentId: item.id,
															body: editCommentBody.trim()
														}).then((value) => {
															if (value !== void 0) {
																setEditingCommentId(void 0);
																setEditCommentBody("");
															}
														});
													},
													children: t.save
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														setEditingCommentId(void 0);
														setEditCommentBody("");
													},
													children: t.cancel
												})] })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownText, { value: item.body }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: "dsh-taskboard-file-label",
													children: [t.attachComment, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "file",
														onChange: (event) => {
															const file = event.target.files?.[0];
															if (file !== void 0) upload(file, item.id);
															event.target.value = "";
														}
													})]
												}),
												detail?.attachments.filter((attachment) => attachment.commentId === item.id).map((attachment) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AttachmentRow, {
													attachment,
													download,
													preview,
													remove: () => {
														mutate("attachment.delete", {
															taskId: task.id,
															expectedVersion: currentVersion,
															attachmentId: attachment.id
														});
													}
												}, attachment.id))
											] })]
										}, item.id))
									})]
								}),
								pendingAction !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-taskboard-reason",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t.reason, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
											autoFocus: true,
											value: actionReason,
											onChange: (event) => {
												setActionReason(event.target.value);
											}
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsh-taskboard-save",
											disabled: actionReason.trim() === "",
											onClick: runReasonAction,
											children: t.confirm
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												setPendingAction("");
												setActionReason("");
											},
											children: t.close
										})
									]
								}),
								confirmDelete && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-taskboard-confirm",
									role: "alert",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											t.permanentlyDelete,
											" ",
											task.identifier,
											"?"
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												mutate("task.delete", {
													taskId: task.id,
													expectedVersion: currentVersion
												});
												setConfirmDelete(false);
											},
											children: t.delete
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												setConfirmDelete(false);
											},
											children: t.close
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "dsh-taskboard-composer",
									"aria-label": t.addComment,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t.addComment }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownComposer, {
											value: comment,
											onChange: setComment,
											mode: commentMode,
											onModeChange: setCommentMode,
											placeholder: t.commentPlaceholder,
											emptyPreview: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.commentPlaceholder })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: "dsh-taskboard-file-label",
											children: [t.attachFiles, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "file",
												onChange: (event) => {
													const file = event.target.files?.[0];
													if (file !== void 0) upload(file);
													event.target.value = "";
												}
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-taskboard-composer-actions",
											children: [
												task.status === "backlog" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														mutate("task.approve", {
															taskId: task.id,
															expectedVersion: currentVersion
														});
													},
													children: t.approve
												}),
												task.status === "in_review" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														mutate("task.accept", {
															taskId: task.id,
															expectedVersion: currentVersion
														});
													},
													children: t.accept
												}),
												task.status === "blocked" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														mutate("task.resume", {
															taskId: task.id,
															expectedVersion: currentVersion
														});
													},
													children: t.resume
												}),
												(task.status === "todo" || task.status === "in_progress") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														mutate("task.cancel", {
															taskId: task.id,
															expectedVersion: currentVersion
														});
													},
													children: t.closeIssue
												}),
												(task.status === "done" || task.status === "canceled") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														setPendingAction("reopen");
													},
													children: t.reopen
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dsh-taskboard-save",
													disabled: comment.trim() === "",
													onClick: submitComment,
													children: t.comment
												})
											]
										})] })
									]
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: "dsh-taskboard-detail-side",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaField, {
									label: t.assignee,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										value: assignee,
										placeholder: t.noOne,
										onChange: (event) => {
											setAssignee(event.target.value);
										}
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaField, {
									label: t.labels,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										value: labels,
										onChange: (event) => {
											setLabels(event.target.value);
										},
										placeholder: "local, release"
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "dsh-taskboard-meta-project",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t.project }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: project === void 0 ? t.none : `${project.key} · ${project.name}` }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaField, {
											nested: true,
											label: t.status,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
												"aria-label": t.status,
												value: task.status,
												onChange: (event) => {
													const status = event.target.value;
													if (status === task.status) return;
													mutate("task.move", {
														taskId: task.id,
														expectedVersion: currentVersion,
														status
													});
												},
												children: TASK_STATUSES.map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: status,
													children: t[status]
												}, status))
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaField, {
											nested: true,
											label: t.priority,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
												value: priority,
												onChange: (event) => {
													setPriority(event.target.value);
												},
												children: [
													"urgent",
													"high",
													"medium",
													"low",
													"none"
												].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value,
													children: priorityLabel(t, value)
												}, value))
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaField, {
											nested: true,
											label: t.workflow,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												value: workflowId,
												onChange: (event) => {
													setWorkflowId(event.target.value);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: t.none
												}), workflows.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: item.id,
													children: item.name
												}, item.id))]
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaField, {
											nested: true,
											label: t.start,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "date",
												value: startDate,
												onChange: (event) => {
													setStartDate(event.target.value);
												}
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaField, {
											nested: true,
											label: t.targetDate,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "date",
												value: dueDate,
												onChange: (event) => {
													setDueDate(event.target.value);
												}
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(MetaField, {
											nested: true,
											label: t.recurrence,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												value: recurrence,
												onChange: (event) => {
													setRecurrence(event.target.value);
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "",
														children: t.noRecurrence
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "daily",
														children: t.daily
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "weekly",
														children: t.weekly
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "monthly",
														children: t.monthly
													})
												]
											}), recurrence !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "number",
												min: "1",
												"aria-label": t.interval,
												value: recurrenceInterval,
												onChange: (event) => {
													setRecurrenceInterval(event.target.value);
												}
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "date",
												"aria-label": t.until,
												value: recurrenceUntil,
												onChange: (event) => {
													setRecurrenceUntil(event.target.value);
												}
											})] })]
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(MetaField, {
									label: t.relations,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-taskboard-relation-create",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												"aria-label": t.relationKind,
												value: relationKind,
												onChange: (event) => {
													setRelationKind(event.target.value);
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "parent",
														children: "parent"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "blocks",
														children: "blocks"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "related",
														children: "related"
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												"aria-label": t.relatedTask,
												value: relationTarget,
												onChange: (event) => {
													setRelationTarget(event.target.value);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: t.selectTask
												}), tasks.filter((item) => item.id !== task.id && item.projectId === task.projectId).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
													value: item.id,
													children: [
														item.identifier,
														" · ",
														item.title
													]
												}, item.id))]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												disabled: relationTarget === "",
												onClick: () => {
													mutate("task.relation", {
														taskId: task.id,
														expectedVersion: currentVersion,
														targetTaskId: relationTarget,
														kind: relationKind
													}).then(() => {
														setRelationTarget("");
													});
												},
												children: t.add
											})
										]
									}), detail === void 0 || detail.relations.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsh-taskboard-muted",
										children: t.noneYet
									}) : detail.relations.map((item) => {
										const sourceVersion = item.sourceTaskId === task.id ? currentVersion : tasks.find((candidate) => candidate.id === item.sourceTaskId)?.version;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
											className: "dsh-taskboard-side-item",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: relationLabel(item) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												disabled: sourceVersion === void 0,
												title: sourceVersion === void 0 ? t.relationSourceUnloaded : void 0,
												onClick: () => {
													if (sourceVersion !== void 0) mutate("relation.delete", {
														relationId: item.id,
														expectedVersion: sourceVersion
													});
												},
												children: t.delete
											})]
										}, item.id);
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(MetaField, {
									label: t.developmentContext,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											value: developmentKind,
											onChange: (event) => {
												setDevelopmentKind(event.target.value);
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: t.none
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "branch",
													children: t.branch
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "worktree",
													children: t.worktree
												})
											]
										}),
										developmentKind !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: developmentBranch,
											"aria-label": t.branch,
											placeholder: t.branch,
											onChange: (event) => {
												setDevelopmentBranch(event.target.value);
											}
										}),
										developmentKind === "worktree" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: worktreePath,
											"aria-label": t.worktreePath,
											placeholder: t.worktreePath,
											onChange: (event) => {
												setWorktreePath(event.target.value);
											}
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(MetaField, {
									label: t.sessions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: project?.workspaceId === void 0 || task.status !== "todo" && task.status !== "in_progress",
										title: project?.workspaceId === void 0 ? t.workspaceRequired : task.status !== "todo" && task.status !== "in_progress" ? t.sessionTaskMustBeActive : void 0,
										onClick: () => {
											openNewSession();
										},
										children: t.newSession
									}), detail === void 0 || detail.claims.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsh-taskboard-muted",
										children: t.noneYet
									}) : detail.claims.map((item) => {
										const runtime = detail.sessionRuntime?.find((value) => value.sessionId === item.sessionId);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
											className: "dsh-taskboard-side-item",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsh-taskboard-link",
												onClick: () => {
													openSession(item.sessionId);
												},
												children: [
													t.openSession,
													": ",
													item.sessionId
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
												item.state,
												" · ",
												runtime?.status ?? t.offline,
												runtime?.current === true ? ` · ${t.current}` : ""
											] })]
										}, item.id);
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-taskboard-actions",
									children: [
										task.status === "in_review" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												setPendingAction("return");
											},
											children: t.returnWork
										}),
										(task.status === "todo" || task.status === "in_progress") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												setPendingAction("block");
											},
											children: t.blocked
										}),
										[
											"backlog",
											"in_review",
											"blocked"
										].includes(task.status) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												mutate("task.cancel", {
													taskId: task.id,
													expectedVersion: currentVersion
												});
											},
											children: t.closeIssue
										}),
										detail?.activeClaim !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												setPendingAction("takeover");
											},
											children: t.takeover
										}),
										task.archivedAt === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												mutate("task.archive", {
													taskId: task.id,
													expectedVersion: currentVersion
												});
											},
											children: t.archive
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => {
												mutate("task.restore", {
													taskId: task.id,
													expectedVersion: currentVersion
												});
											},
											children: t.restore
										}),
										task.archivedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"aria-expanded": confirmDelete,
											onClick: () => {
												setConfirmDelete((value) => !value);
											},
											children: t.delete
										})
									]
								})
							]
						})]
					})]
				})
			});
		}
		function MarkdownText({ value }) {
			const blocks = (0, react.useMemo)(() => parseMarkdown(value), [value]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-taskboard-markdown",
				children: blocks.map((block, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownBlockView, { block }, index))
			});
		}
		function MarkdownBlockView({ block }) {
			if (block.type === "heading") {
				const children = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: block.children });
				if (block.level === 1) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children });
				if (block.level === 2) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children });
				if (block.level === 3) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children });
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children });
			}
			if (block.type === "paragraph") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: block.children }) });
			if (block.type === "code") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: block.value }) });
			if (block.type === "blockquote") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", { children: block.children.map((child, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownBlockView, { block: child }, index)) });
			if (block.type === "list") {
				const items = block.items.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: item }) }, index));
				return block.ordered ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", { children: items }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: items });
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", {});
		}
		function MarkdownInlines({ nodes }) {
			return nodes.map((node, index) => {
				if (node.type === "text") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: node.value }, index);
				if (node.type === "code") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: node.value }, index);
				if (node.type === "strong") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: node.children }) }, index);
				if (node.type === "em") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: node.children }) }, index);
				if (node.type === "del") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("del", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: node.children }) }, index);
				if (node.type === "image") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: node.src,
					alt: node.alt
				}, index);
				const external = /^https?:/i.test(node.href);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					href: node.href,
					...external ? {
						target: "_blank",
						rel: "noreferrer noopener"
					} : {},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: node.children })
				}, index);
			});
		}
		/** Browser plugin registration; generated Remote contribution and both slots unwind together. */
		async function apply(ctx) {
			const connection = ctx.get("connection");
			const remote = ctx.get("remote");
			const locale = ctx.get("locale");
			const unbindLocale = bindTaskboardLocale(locale);
			const unregisterCopy = locale.register(TASKBOARD_LOCALE_NS, taskboardLocales);
			const unmountRemote = await remote.$mount(TYPERT_REMOTE);
			ctx.inject(["remote.taskboard", "uiWorkspace"], (remoteCtx) => {
				const sessions = remoteCtx.get("sessions");
				const workspaces = remoteCtx.get("workspaces");
				const uiWorkspace = remoteCtx.get("uiWorkspace");
				const conversation = remoteCtx.get("conversation");
				const mountedRemote = remoteCtx.get("remote");
				const sessionNavigator = {
					list: { getSnapshot: () => sessions.list.getSnapshot() },
					refresh: () => sessions.refresh(),
					open: (sessionId) => {
						sessions.open(sessionId);
					}
				};
				const controller = new TaskboardClientController(connection, mountedRemote.taskboard, (sessionId) => openTaskSession(sessionNavigator, sessionId), async (workspaceId, draft) => {
					const sessionId = await uiWorkspace.connectWorkspace(workspaceId);
					const scoped = sessions.scope(sessionId);
					if (scoped === void 0) throw new Error(`Unable to resolve the new Session ${sessionId}`);
					conversation.input.for(scoped).setDraft(draft);
					sessions.open(sessionId);
					return sessionId;
				});
				const sessionList = sessions.list;
				let previousSession = sessionList.getSnapshot().current;
				const offSessions = sessionList.subscribe(() => {
					const next = sessionList.getSnapshot().current;
					if (next !== previousSession) {
						previousSession = next;
						if (controller.getSnapshot().open) controller.close();
					}
				});
				remoteCtx.effect(() => () => {
					controller.dispose();
					offSessions();
				}, "taskboard client controller");
				const slots = remoteCtx.get("slots");
				const Nav = (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskboardNavButton, {
					...props,
					controller
				});
				const Page = (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskboardPage, {
					...props,
					controller,
					workspaces
				});
				slots.inject("sidebar.footer.action", () => slots.register({
					name: "sidebar.footer.action",
					id: "taskboard.navigation"
				}, Nav));
				slots.inject("shell.overlay", () => slots.register({
					name: "shell.overlay",
					id: "taskboard.page"
				}, Page));
			});
			return async () => {
				unbindLocale();
				unregisterCopy();
				await unmountRemote();
			};
		}
		const STYLES = `
${NAV_STYLES}
.dsh-taskboard-page{position:absolute;top:0;bottom:0;z-index:1;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:14px/22px system-ui,sans-serif;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#d4d4d4);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#c4c4c4)}
.dsh-taskboard-page button,.dsh-taskboard-page input,.dsh-taskboard-page textarea,.dsh-taskboard-page select{font:inherit;color:inherit}.dsh-taskboard-page button{cursor:pointer}.dsh-taskboard-page button:disabled{cursor:not-allowed;opacity:.4}
.dsh-taskboard-page input,.dsh-taskboard-page textarea,.dsh-taskboard-page select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff)}.dsh-taskboard-page input,.dsh-taskboard-page select{height:34px;padding:0 12px}.dsh-taskboard-page textarea{padding:8px 12px;min-height:90px;resize:vertical;line-height:22px}.dsh-taskboard-page input:focus,.dsh-taskboard-page textarea:focus,.dsh-taskboard-page select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#0f1115)}.dsh-taskboard-page input::placeholder,.dsh-taskboard-page textarea::placeholder{color:var(--dsw-alias-label-dimmed,#e1e5ee)}
.dsh-taskboard-header{flex:none;min-height:54px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-brand{display:flex;gap:8px;align-items:center;margin-right:auto;font-size:16px;line-height:24px;font-weight:500}
.dsh-taskboard-header button,.dsh-taskboard-filters button,.dsh-taskboard-create button,.dsh-taskboard-gantt>header button,.dsh-taskboard-automation-menu button,.dsh-taskboard-popover>button,.dsh-taskboard-workflows>section>header button,.dsh-taskboard-labels>section>header button,.dsh-taskboard-workflow-create button,.dsh-taskboard-capabilities button,.dsh-taskboard-detail button,.dsh-taskboard-composer-actions button,.dsh-taskboard-actions button,.dsh-taskboard-reason button,.dsh-taskboard-confirm button,.dsh-taskboard-relation-create button{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:18px;background:transparent}.dsh-taskboard-header button.dsh-taskboard-icon-close{width:28px;height:28px;min-width:28px;min-height:28px;padding:0;border:0;border-radius:28px}.dsh-taskboard-header button:hover:not(:disabled),.dsh-taskboard-filters button:hover:not(:disabled),.dsh-taskboard-create button:hover:not(:disabled),.dsh-taskboard-gantt>header button:hover:not(:disabled),.dsh-taskboard-automation-menu button:hover:not(:disabled),.dsh-taskboard-popover>button:hover:not(:disabled),.dsh-taskboard-workflows>section>header button:hover:not(:disabled),.dsh-taskboard-labels>section>header button:hover:not(:disabled),.dsh-taskboard-workflow-create button:hover:not(:disabled),.dsh-taskboard-capabilities button:hover:not(:disabled),.dsh-taskboard-detail button:hover:not(:disabled),.dsh-taskboard-composer-actions button:hover:not(:disabled),.dsh-taskboard-actions button:hover:not(:disabled),.dsh-taskboard-reason button:hover:not(:disabled),.dsh-taskboard-confirm button:hover:not(:disabled),.dsh-taskboard-relation-create button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dsh-taskboard-header select,.dsh-taskboard-filters select,.dsh-taskboard-gantt>header select{height:36px;border-radius:18px}
.dsh-taskboard-filters{display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-filters input{flex:1;min-width:120px}
.dsh-taskboard-tabs{display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-tabs button{height:40px;padding:9px 16px 9px 12px;border:0;border-radius:12px;background:transparent}.dsh-taskboard-tabs button:hover{background:var(--dsw-specific-sidebar-nav-item-hover,#f1f3f5)}.dsh-taskboard-tabs button[aria-current=page]{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}
.dsh-taskboard-error{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 16px;background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05));color:var(--dsw-alias-state-error-primary,#ec1313)}.dsh-taskboard-error button{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:11px;background:transparent;color:inherit;cursor:pointer}.dsh-taskboard-error button:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.12))}.dsh-taskboard-notice{padding:8px 16px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7);color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-discard-dialog{width:min(400px,calc(100vw - 32px));padding:20px;border-radius:14px;background:var(--dsw-specific-menu,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.18))}.dsh-taskboard-discard-dialog h2{margin:0 0 8px;font-size:15px;font-weight:600}.dsh-taskboard-discard-dialog p{margin:0 0 16px;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-discard-dialog div{display:flex;justify-content:flex-end;gap:8px}.dsh-taskboard-discard-dialog button{min-height:34px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:17px;background:transparent;font:inherit;cursor:pointer}.dsh-taskboard-discard-dialog button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}.dsh-taskboard-attachment-row>div{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.dsh-taskboard-attachment-row img{display:block;max-width:100%;max-height:320px;margin-top:8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04));border-radius:8px}.dsh-taskboard-loading,.dsh-taskboard-empty{padding:32px;text-align:center;color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-content{display:flex;flex:1;min-height:0}.dsh-taskboard-view{flex:1;min-width:0;overflow:auto;padding:16px 24px 24px}
.dsh-taskboard-create{display:flex;gap:8px;margin-bottom:16px}.dsh-taskboard-create input{flex:1}
.dsh-taskboard-dashboard{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px}.dsh-taskboard-dashboard div{display:flex;flex-direction:column;padding:20px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff)}.dsh-taskboard-dashboard strong{font-size:30px;line-height:38px;font-weight:500}.dsh-taskboard-dashboard span{color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,1fr);gap:12px;overflow-x:auto;overscroll-behavior-x:contain;align-items:start}.dsh-taskboard-board section,.dsh-taskboard-other{min-width:0;padding:12px;border-radius:12px;background:var(--dsw-specific-sidebar-fill,#f9fafb)}.dsh-taskboard-board h2,.dsh-taskboard-other h2{display:flex;align-items:center;gap:8px;font-size:14px;line-height:22px;font-weight:500;margin:0 0 10px}.dsh-taskboard-board h2 small,.dsh-taskboard-other h2 small{margin-left:auto;color:var(--dsw-alias-label-tertiary,#81858c);font-weight:400}
.dsh-taskboard-status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;color:var(--dsw-alias-label-tertiary,#81858c)}.dsh-taskboard-status-dot[data-status=todo],.dsh-taskboard-status-dot[data-status=done]{color:var(--dsw-alias-state-success-primary,#22c55e)}.dsh-taskboard-status-dot[data-status=in_progress]{color:var(--dsw-alias-state-warn-primary,#f59e0b)}.dsh-taskboard-status-dot[data-status=in_review]{color:var(--dsw-alias-state-business-primary,#4176e6)}.dsh-taskboard-status-dot[data-status=blocked]{color:var(--dsw-alias-state-error-primary,#ec1313)}.dsh-taskboard-status-dot[data-status=canceled]{color:var(--dsw-alias-label-caption,#adb2b8)}.dsh-taskboard-status-dot[data-status=backlog]{color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-taskboard-card{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-bottom:8px;padding:12px 14px;text-align:left;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);min-height:0}.dsh-taskboard-card:hover{border-color:var(--dsw-alias-label-dimmed,#e1e5ee);background:var(--dsw-alias-bg-layer-2,#fff)}.dsh-taskboard-card strong{font-weight:500}.dsh-taskboard-card small,.dsh-taskboard-card span{color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-more{width:100%;display:flex;align-items:center;justify-content:center;gap:4px;min-height:32px;margin-top:4px;padding:6px 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-tertiary,#81858c)}.dsh-taskboard-more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-more-label{font-size:12px;line-height:18px}.dsh-taskboard-other{margin-top:14px}.dsh-taskboard-other .dsh-taskboard-card{display:inline-flex;width:min(280px,100%);margin-right:8px}
.dsh-taskboard-table-wrap{overflow:auto}.dsh-taskboard-table-wrap table{width:100%;border-collapse:collapse}.dsh-taskboard-table-wrap th,.dsh-taskboard-table-wrap td{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04));text-align:left}.dsh-taskboard-row-open{padding:0;border:0;background:transparent;color:var(--dsw-alias-link,#2563eb);font:inherit;text-align:left;cursor:pointer}.dsh-taskboard-row-open:hover{text-decoration:underline}.dsh-taskboard-table-wrap tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}.dsh-taskboard-table-wrap th button{border:0;background:transparent;font-weight:500;min-height:0;padding:0;border-radius:0}
.dsh-taskboard-gantt{display:flex;flex-direction:column;gap:8px}.dsh-taskboard-gantt>header{display:flex;align-items:center;gap:10px}.dsh-taskboard-gantt>header label{display:flex;align-items:center;gap:5px}.dsh-taskboard-gantt-rows{position:relative;display:flex;flex-direction:column}.dsh-taskboard-gantt-rows>button{display:grid;grid-template-columns:220px 1fr minmax(180px,auto);gap:12px;align-items:center;text-align:left;border:0;background:transparent;min-height:0;padding:8px 0;border-radius:0}.dsh-taskboard-gantt-rows>button:hover{background:transparent}.dsh-taskboard-gantt-track{position:relative;display:block;height:16px;border-radius:8px;background:var(--dsw-specific-sidebar-fill,#f9fafb);overflow:hidden}.dsh-taskboard-gantt-track i{position:absolute;top:2px;display:block;height:12px;border-radius:6px;background:var(--dsw-alias-state-business-primary,#4176e6)}.dsh-taskboard-today{position:absolute;top:0;bottom:0;width:1px;background:var(--dsw-alias-state-error-primary,#ec1313);opacity:.45;pointer-events:none}.dsh-taskboard-gantt small{color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-dialog-backdrop{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:var(--dsw-mask-blur,blur(2px))}
.dsh-taskboard-detail{width:min(1120px,100%);height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;padding:0;border:1px solid var(--dsw-alias-border-inverted,transparent);border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08));--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#d4d4d4);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#c4c4c4)}.dsh-taskboard-detail:focus{outline:none}
.dsh-taskboard-detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex:none;padding:20px 16px 12px 24px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-detail-heading{min-width:0;flex:1;display:flex;flex-direction:column;gap:8px}.dsh-taskboard-detail-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.dsh-taskboard-detail-path{font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-detail-meta small{color:var(--dsw-alias-label-tertiary,#81858c)}.dsh-taskboard-detail input.dsh-taskboard-detail-title{width:100%;height:auto;min-height:36px;padding:4px 0;border:0;border-radius:0;background:transparent;font-size:20px;line-height:28px;font-weight:500}.dsh-taskboard-detail input.dsh-taskboard-detail-title:focus{border:0;box-shadow:none;outline:none}.dsh-taskboard-detail-author{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-detail-author strong{color:var(--dsw-alias-label-primary,#0f1115);font-weight:500}.dsh-taskboard-detail-toolbar{display:flex;align-items:center;gap:8px;flex:none}
.dsh-taskboard-issue-badge,.dsh-taskboard-status-pill,.dsh-taskboard-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:12px;font-size:12px;line-height:18px;background:var(--dsw-alias-state-success-tertiary,#e6faed);color:var(--dsw-alias-state-success-primary,#22c55e)}.dsh-taskboard-issue-badge[data-closed=true]{background:var(--dsw-alias-button-ghost-active-fill,#ebeef2);color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-status-pill{background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-pill{background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-pill-row{display:flex;flex-wrap:wrap;gap:6px}.dsh-taskboard-avatar{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-button-ghost-active-fill,#ebeef2);color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;font-weight:500}.dsh-taskboard-muted{color:var(--dsw-alias-label-tertiary,#81858c);font-size:13px}
.dsh-taskboard-save{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border:0;border-radius:18px;background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:500}.dsh-taskboard-detail button.dsh-taskboard-save{border:0;background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}.dsh-taskboard-save svg{flex:none}.dsh-taskboard-save:hover:not(:disabled),.dsh-taskboard-detail button.dsh-taskboard-save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#43454a)}.dsh-taskboard-save[data-dirty=true]{box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-hover-accent,rgba(38,49,72,.14))}.dsh-taskboard-detail-close{width:28px;height:28px;min-height:28px;min-width:28px;padding:0;border:0;border-radius:28px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-detail button.dsh-taskboard-detail-close{width:28px;min-width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:28px}.dsh-taskboard-detail button.dsh-taskboard-detail-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dsh-taskboard-detail-columns{display:grid;grid-template-columns:minmax(0,1fr) 296px;flex:1;min-height:0}.dsh-taskboard-detail-main{overflow:hidden;padding:16px 24px 24px;display:flex;flex-direction:column;gap:16px}.dsh-taskboard-detail-main>.dsh-taskboard-body{flex:none;max-height:40%;overflow:auto}.dsh-taskboard-detail-feed{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px}.dsh-taskboard-detail-main>.dsh-taskboard-composer,.dsh-taskboard-detail-main>.dsh-taskboard-reason,.dsh-taskboard-detail-main>.dsh-taskboard-confirm{flex:none}.dsh-taskboard-detail-main>.dsh-taskboard-composer{max-height:42%;overflow:auto}.dsh-taskboard-detail-side{overflow:auto;padding:4px 16px 24px;border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}
.dsh-taskboard-body,.dsh-taskboard-composer{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);overflow:hidden}.dsh-taskboard-body-content{padding:16px 16px 8px;min-height:72px}.dsh-taskboard-body>footer,.dsh-taskboard-composer>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-composer h3{margin:0;padding:12px 14px 0;font-size:14px;line-height:22px;font-weight:500}.dsh-taskboard-composer-bar{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:4px 8px;padding:8px 8px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-composer-tabs{display:flex;gap:0}.dsh-taskboard-composer-tabs button{height:32px;min-height:32px;padding:0 12px;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-detail .dsh-taskboard-composer-tabs button{min-height:32px;border-radius:8px 8px 0 0}.dsh-taskboard-composer-tabs button[aria-current=page]{background:var(--dsw-alias-bg-layer-3,#fff);border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1));color:var(--dsw-alias-label-primary,#0f1115);margin-bottom:-1px}.dsh-taskboard-md-tools{display:flex;flex-wrap:wrap;gap:2px;padding:0 4px 6px}.dsh-taskboard-detail .dsh-taskboard-md-tools button{width:auto;min-width:28px;height:28px;min-height:28px;padding:0 6px;border:0;border-radius:6px;background:transparent;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-detail .dsh-taskboard-md-tools button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-composer textarea,.dsh-taskboard-body textarea,.dsh-taskboard-composer-preview{margin:0;border:0;border-radius:0;min-height:120px;background:transparent}.dsh-taskboard-composer textarea:focus,.dsh-taskboard-body textarea:focus{border:0}.dsh-taskboard-composer-preview{padding:12px 14px}.dsh-taskboard-composer>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-composer-actions{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}.dsh-taskboard-file-label{position:relative;display:inline-flex;align-items:center;gap:6px;margin:0;color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;cursor:pointer}.dsh-taskboard-file-label input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.dsh-taskboard-timeline{list-style:none;margin:0;padding:0 0 0 14px;display:flex;flex-direction:column;gap:14px;border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-timeline-comment,.dsh-taskboard-timeline-event{position:relative;display:flex;gap:10px;padding-left:18px}.dsh-taskboard-timeline-comment .dsh-taskboard-avatar,.dsh-taskboard-timeline-mark{position:absolute;left:-15px;top:0}.dsh-taskboard-timeline-mark{width:10px;height:10px;margin-top:6px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3,rgba(0,0,0,.12))}.dsh-taskboard-timeline-comment article{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff)}.dsh-taskboard-timeline-comment article>header{display:flex;align-items:center;gap:8px;margin-bottom:6px;justify-content:space-between;flex-wrap:wrap}.dsh-taskboard-comment-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap}.dsh-taskboard-detail .dsh-taskboard-comment-actions button:not(.dsh-taskboard-link){min-height:28px;height:28px;padding:0 10px;border-radius:14px;font-size:12px}.dsh-taskboard-timeline-comment article>footer{display:flex;gap:8px;margin-top:8px}.dsh-taskboard-timeline-event p{margin:0;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-timeline-event small,.dsh-taskboard-timeline-comment small{margin-left:8px;color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-taskboard-actions{display:flex;flex-wrap:wrap;gap:6px;margin:0}.dsh-taskboard-link{border:0;background:transparent;min-height:0;padding:0;border-radius:0;color:var(--dsw-alias-state-business-primary,#4176e6);text-align:left}.dsh-taskboard-detail button.dsh-taskboard-link{border:0;background:transparent;min-height:0;padding:0;border-radius:0;color:var(--dsw-alias-state-business-primary,#4176e6)}.dsh-taskboard-attachment-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-taskboard-attachment-row small{color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-taskboard-meta-field{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-meta-field>span{font-size:12px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-meta-field>div{display:flex;flex-direction:column;gap:6px}.dsh-taskboard-meta-project{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-meta-project h3{margin:0 0 4px;font-size:12px;line-height:16px;font-weight:500}.dsh-taskboard-meta-project>p{margin:0 0 8px;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-meta-nested{padding:8px 0;border-bottom:0}.dsh-taskboard-meta-nested+.dsh-taskboard-meta-nested{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-detail-side input,.dsh-taskboard-detail-side select{height:32px;border-color:transparent;background:transparent;padding-left:8px}.dsh-taskboard-detail-side input:hover,.dsh-taskboard-detail-side select:hover,.dsh-taskboard-detail-side input:focus,.dsh-taskboard-detail-side select:focus{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,#fff)}.dsh-taskboard-detail-side .dsh-taskboard-actions{flex-direction:column;align-items:stretch;padding-top:12px}.dsh-taskboard-detail-side .dsh-taskboard-actions button{width:100%}.dsh-taskboard-side-item{display:flex;flex-direction:column;gap:4px;align-items:flex-start}.dsh-taskboard-side-item small{color:var(--dsw-alias-label-tertiary,#81858c);overflow-wrap:anywhere}
.dsh-taskboard-automation-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:12;display:flex;flex-direction:column;gap:8px;width:min(520px,calc(100vw - 32px));max-height:min(70vh,640px);overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-inverted,transparent);border-radius:12px;background:var(--dsw-specific-menu,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08))}.dsh-taskboard-automation-menu>header{display:flex;align-items:center;justify-content:space-between;gap:12px}.dsh-taskboard-popover-actions{display:flex;align-items:center;gap:6px}.dsh-taskboard-automation-menu button.dsh-taskboard-popover-close{width:28px;height:28px;min-width:28px;min-height:28px;padding:0;border:0;border-radius:28px}.dsh-taskboard-automation-menu h2{margin:0;font-size:14px;line-height:22px;font-weight:500}.dsh-taskboard-automation-menu article{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-automation-menu article>div{display:flex;flex:1;flex-direction:column}.dsh-taskboard-automation-menu article>div:last-of-type{display:flex;flex:0 0 auto;flex-direction:row;gap:6px}.dsh-taskboard-automation-menu article small,.dsh-taskboard-automation-menu article span,.dsh-taskboard-automation-menu>p{color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-log{display:flex;flex-direction:column;gap:6px;margin-top:18px;padding:14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px}.dsh-taskboard-log header{display:flex;align-items:center;justify-content:space-between}.dsh-taskboard-log h2{margin:0;font-size:16px;line-height:24px;font-weight:500}.dsh-taskboard-log>p{margin:0;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-log ol,.dsh-taskboard-log-dialog ol{list-style:none;margin:0;padding:0}.dsh-taskboard-log li,.dsh-taskboard-log-dialog li{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-log li:first-child,.dsh-taskboard-log-dialog li:first-child{border-top:0}.dsh-taskboard-log time,.dsh-taskboard-log-dialog time{color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;line-height:18px}.dsh-taskboard-log span,.dsh-taskboard-log-dialog span{color:var(--dsw-alias-label-primary,#0f1115)}.dsh-taskboard-log li[data-kind=claimed] span,.dsh-taskboard-log-dialog li[data-kind=claimed] span{color:var(--dsw-alias-state-success-primary,#22c55e)}.dsh-taskboard-log li[data-kind=error] span,.dsh-taskboard-log li[data-kind=quota-paused] span,.dsh-taskboard-log-dialog li[data-kind=error] span,.dsh-taskboard-log-dialog li[data-kind=quota-paused] span{color:var(--dsw-alias-state-error-primary,#ec1313)}.dsh-taskboard-log-dialog{width:min(720px,100%);max-height:min(80vh,720px);display:flex;flex-direction:column;overflow:hidden;border-radius:16px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08))}.dsh-taskboard-log-dialog header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:16px 16px 12px 20px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-log-dialog h2{margin:0;font-size:16px;line-height:24px;font-weight:500}.dsh-taskboard-log-dialog ol{overflow:auto;padding:0 20px 16px}.dsh-taskboard-log-dialog>p{margin:0;padding:16px 20px;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-log header .dsh-taskboard-link{min-height:0;padding:0}.dsh-taskboard-log-dialog button.dsh-taskboard-detail-close{width:28px;min-width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:28px}
.dsh-taskboard-storage{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px;padding:12px;border:1px solid var(--dsw-alias-state-success-primary,#22c55e);border-radius:12px;background:var(--dsw-alias-state-success-tertiary,#e6faed)}.dsh-taskboard-storage[data-status=degraded]{border-color:var(--dsw-alias-state-warn-primary,#f59e0b);background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}.dsh-taskboard-storage header{display:flex;flex:1 0 100%;align-items:center;justify-content:space-between}.dsh-taskboard-storage-actions{display:flex;align-items:center;gap:10px}.dsh-taskboard-storage-actions button{min-height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:14px;background:transparent;font:inherit;cursor:pointer}.dsh-taskboard-storage-actions button:disabled{opacity:.5;cursor:default}.dsh-taskboard-storage h2{margin:0;font-size:14px;font-weight:500}.dsh-taskboard-storage span{color:var(--dsw-alias-label-secondary,#61666b)}
.dsh-taskboard-workflows,.dsh-taskboard-labels{display:grid;grid-template-columns:190px 1fr;min-height:420px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;overflow:hidden}.dsh-taskboard-workflows>aside,.dsh-taskboard-labels>aside{display:flex;flex-direction:column;gap:6px;padding:10px;background:var(--dsw-specific-sidebar-fill,#f9fafb)}.dsh-taskboard-workflows>aside button,.dsh-taskboard-labels>aside button{display:flex;justify-content:space-between;padding:9px 12px;border:1px solid transparent;border-radius:12px;background:transparent;text-align:left;min-height:40px}.dsh-taskboard-workflows>aside button.active,.dsh-taskboard-labels>aside button.active{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}.dsh-taskboard-workflows>section,.dsh-taskboard-labels>section{padding:14px;overflow:auto}.dsh-taskboard-workflows>section>header,.dsh-taskboard-labels>section>header{display:flex;gap:8px;position:relative;flex-wrap:wrap}.dsh-taskboard-workflows>section>header input,.dsh-taskboard-labels>section>header input{flex:1;min-width:120px}.dsh-taskboard-labels>section h2{margin:0;font-size:16px;line-height:24px;font-weight:500}.dsh-taskboard-workflow-tabs{display:flex;gap:20px;padding:20px 0}.dsh-taskboard-workflow-tabs>article{min-width:240px}.dsh-taskboard-workflow-tabs>article>header{display:flex;align-items:center;justify-content:space-between}.dsh-taskboard-workflow-node{margin:8px 0;padding:11px;border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b);border-radius:12px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}.dsh-taskboard-workflow-node[data-execution=executable]{border-color:var(--dsw-alias-state-success-primary,#22c55e);background:var(--dsw-alias-state-success-tertiary,#e6faed)}.dsh-taskboard-workflow-node>small{display:block;color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-flow-line{height:20px;margin-left:28px;border-left:2px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12))}.dsh-taskboard-branches{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.dsh-taskboard-workflows footer{display:flex;flex-wrap:wrap;gap:5px}.dsh-taskboard-workflows footer span{padding:3px 6px;border-radius:12px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7);font-size:11px}.dsh-taskboard-workflows footer span[data-execution=executable]{background:var(--dsw-alias-state-success-tertiary,#e6faed)}
.dsh-taskboard-workflow-node-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}.dsh-taskboard-workflow-node-actions button{padding:2px 8px;min-height:22px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:11px;background:transparent;font-size:11px}
.dsh-taskboard-capabilities{margin-top:14px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.04))}.dsh-taskboard-capabilities h3{margin:0 0 5px;font-weight:500}.dsh-taskboard-capabilities>div{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.dsh-taskboard-markdown{overflow-wrap:anywhere}.dsh-taskboard-markdown h1,.dsh-taskboard-markdown h2,.dsh-taskboard-markdown h3,.dsh-taskboard-markdown h4{margin:16px 0 8px;font-weight:600;line-height:1.35}.dsh-taskboard-markdown h1:first-child,.dsh-taskboard-markdown h2:first-child,.dsh-taskboard-markdown h3:first-child,.dsh-taskboard-markdown h4:first-child{margin-top:0}.dsh-taskboard-markdown h1{font-size:22px;line-height:30px}.dsh-taskboard-markdown h2{font-size:18px;line-height:26px}.dsh-taskboard-markdown h3{font-size:16px;line-height:24px}.dsh-taskboard-markdown h4{font-size:14px;line-height:22px}.dsh-taskboard-markdown p{margin:0 0 8px;white-space:pre-wrap}.dsh-taskboard-markdown p:last-child{margin-bottom:0}.dsh-taskboard-markdown ul,.dsh-taskboard-markdown ol{margin:0 0 8px;padding-left:1.4em}.dsh-taskboard-markdown li{margin:2px 0;white-space:pre-wrap}.dsh-taskboard-markdown blockquote{margin:0 0 8px;padding:0 12px;border-left:3px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));color:var(--dsw-alias-label-secondary,#61666b)}.dsh-taskboard-markdown a{color:var(--dsw-alias-state-business-primary,#4176e6)}.dsh-taskboard-markdown img{display:block;max-width:100%;height:auto;margin:8px 0;border-radius:8px}.dsh-taskboard-markdown code{padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-code-block,#f9fafb);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.dsh-taskboard-markdown pre{overflow:auto;padding:8px;border-radius:8px;background:var(--dsw-alias-markdown-code-block,#f9fafb)}.dsh-taskboard-markdown pre code{padding:0;background:transparent}.dsh-taskboard-markdown hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));margin:12px 0}
.dsh-taskboard-popover{position:relative}.dsh-taskboard-popover>form,.dsh-taskboard-confirm{position:absolute;top:calc(100% + 6px);right:0;z-index:12;display:flex;flex-direction:column;gap:8px;width:280px;padding:12px;border:1px solid var(--dsw-alias-border-inverted,transparent);border-radius:12px;background:var(--dsw-specific-menu,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08))}.dsh-taskboard-popover form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-popover form div,.dsh-taskboard-inline-form{display:flex;gap:7px}.dsh-taskboard-confirm{position:relative;top:auto;right:auto;width:auto;margin:8px 0}.dsh-taskboard-popover>.dsh-taskboard-confirm{position:absolute;top:calc(100% + 6px);right:0;z-index:12;width:280px;margin:0}.dsh-taskboard-reason{padding:12px;border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b);border-radius:12px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}.dsh-taskboard-reason label{display:flex;flex-direction:column;gap:6px}.dsh-taskboard-relation-create{display:grid;grid-template-columns:1fr;gap:6px}.dsh-taskboard-inline-form{align-items:end;padding:10px 0}.dsh-taskboard-inline-form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-workflow-create{display:flex;flex-direction:column;gap:5px}.dsh-taskboard-workflow-create input{min-width:0}
.dsh-taskboard-summary,.dsh-taskboard-due{display:flex;flex-direction:column;gap:6px;margin-top:14px;padding:14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px}.dsh-taskboard-summary h2,.dsh-taskboard-due h2{margin:0;font-size:16px;line-height:24px;font-weight:500}.dsh-taskboard-due button{display:flex;justify-content:space-between;gap:12px;padding:8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:0;background:transparent;text-align:left;min-height:0}.dsh-taskboard-automation-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;flex:1 0 100%;padding:10px 0}.dsh-taskboard-automation-form label{display:flex;flex-direction:column;gap:4px}.dsh-taskboard-automation-form label:has(input[type="checkbox"]){flex-direction:row;align-items:center}
@media(max-width:900px){.dsh-taskboard-dashboard{grid-template-columns:repeat(2,1fr)}.dsh-taskboard-board{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:1fr;overflow-x:visible}.dsh-taskboard-dialog-backdrop{padding:12px}.dsh-taskboard-detail{height:min(100%,calc(100vh - 24px));border-radius:16px}.dsh-taskboard-detail-columns{grid-template-columns:1fr}.dsh-taskboard-detail-side{border-left:0;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.dsh-taskboard-header{gap:5px}.dsh-taskboard-gantt button{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.dsh-taskboard-page *{scroll-behavior:auto!important;transition:none!important}}
`;
		//#endregion
		exports.TaskboardNavButton = TaskboardNavButton;
		exports.TaskboardPage = TaskboardPage;
		exports.apply = apply;
		exports.bindTaskboardLocale = bindTaskboardLocale;
		exports.inject = inject;
		exports.openTaskSession = openTaskSession;
		exports.taskboardStrings = taskboardStrings;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map