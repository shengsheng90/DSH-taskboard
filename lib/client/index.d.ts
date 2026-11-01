import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { TaskboardClientController } from './controller.js';
export { bindTaskboardLocale, taskboardStrings } from './locales.js';
export declare const inject: string[];
interface InjectedProps {
    controller: TaskboardClientController;
}
interface WorkspaceOption {
    readonly workspaceId: string;
    readonly title: string;
    readonly path: string;
}
interface IWorkspaces {
    readonly list: {
        subscribe(listener: () => void): () => void;
        getSnapshot(): {
            readonly items: readonly WorkspaceOption[];
        };
    };
}
/** Structural view of one Session catalog row, as the linked-session label reads it. */
interface TaskSessionRow {
    readonly displayTitle?: string;
    readonly title?: string;
}
interface PageInjectedProps extends InjectedProps {
    workspaces: IWorkspaces;
}
interface TaskSessionNavigator {
    readonly list: {
        getSnapshot(): {
            readonly byId: Readonly<Record<string, unknown>>;
        };
    };
    refresh(): Promise<void>;
    open(sessionId: string): void;
}
/** A disposed automation Agent becomes a persisted cold Session. Refresh the native list before
 *  selecting it: sessions.open intentionally rejects ids absent from the current list snapshot. */
export declare function openTaskSession(navigator: TaskSessionNavigator, sessionId: string): Promise<void>;
type NavProps = PropsRuntime<'sidebar.footer.action'> & InjectedProps;
type PageProps = PropsRuntime<'shell.overlay'> & PageInjectedProps;
export declare function TaskboardNavButton({ wide, controller }: NavProps): import("react").JSX.Element;
export declare function TaskboardPage({ controller, workspaces }: PageProps): import("react").JSX.Element | null;
/** Session catalog the Taskboard page projects; set by apply() before the slots mount. */
type TaskSessionCatalog = {
    readonly byId: Readonly<Record<string, TaskSessionRow | undefined>>;
};
/** Name of the Workspace a project is bound to: its title, then the folder name, then the raw id. */
export declare function workspaceLabel(workspaces: readonly WorkspaceOption[], workspaceId: string): string;
/** Label of one linked Session: the title the sidebar shows, otherwise the raw id. */
export declare function taskSessionLabel(catalog: TaskSessionCatalog | undefined, sessionId: string): string;
/** Browser plugin registration; generated Remote contribution and both slots unwind together. */
export declare function apply(ctx: Context): Promise<() => Promise<void>>;
//# sourceMappingURL=index.d.ts.map