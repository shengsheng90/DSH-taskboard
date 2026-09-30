import { type ReactNode, type RefObject } from 'react';
export declare function useExclusivePopover(): {
    readonly open: boolean;
    readonly setOpen: (open: boolean) => void;
    readonly toggle: () => void;
};
export declare function usePopoverDismiss(open: boolean, onOutside: () => void, onEscape?: () => void): RefObject<HTMLDivElement>;
export declare function PopoverShell({ open, onToggle, onDismiss, onEscape, label, children, }: {
    open: boolean;
    onToggle: () => void;
    onDismiss: () => void;
    onEscape?: () => void;
    label: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=popover.d.ts.map