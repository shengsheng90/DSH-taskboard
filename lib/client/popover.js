import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from 'react';
const POPOVER_OPEN_EVENT = 'dsh-taskboard-popover-open';
export function useExclusivePopover() {
    const id = useId();
    const [open, setOpenState] = useState(false);
    useEffect(() => {
        const onPeerOpen = (event) => {
            if (event.detail === id)
                return;
            setOpenState(false);
        };
        document.addEventListener(POPOVER_OPEN_EVENT, onPeerOpen);
        return () => { document.removeEventListener(POPOVER_OPEN_EVENT, onPeerOpen); };
    }, [id]);
    const setOpen = (next) => {
        if (next)
            document.dispatchEvent(new CustomEvent(POPOVER_OPEN_EVENT, { detail: id }));
        setOpenState(next);
    };
    const toggle = () => {
        setOpenState(current => {
            const next = !current;
            if (next)
                document.dispatchEvent(new CustomEvent(POPOVER_OPEN_EVENT, { detail: id }));
            return next;
        });
    };
    return { open, setOpen, toggle };
}
export function usePopoverDismiss(open, onOutside, onEscape = onOutside) {
    const rootRef = useRef(null);
    const onOutsideRef = useRef(onOutside);
    const onEscapeRef = useRef(onEscape);
    onOutsideRef.current = onOutside;
    onEscapeRef.current = onEscape;
    useEffect(() => {
        if (!open)
            return;
        const onPointerDown = (event) => {
            if (event.target instanceof Node && rootRef.current?.contains(event.target))
                return;
            onOutsideRef.current();
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape')
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            onEscapeRef.current();
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);
    return rootRef;
}
export function PopoverShell({ open, onToggle, onDismiss, onEscape, label, children, }) {
    const rootRef = usePopoverDismiss(open, onDismiss, onEscape ?? onDismiss);
    return (_jsxs("div", { ref: rootRef, className: "dsh-taskboard-popover", children: [_jsx("button", { type: "button", "aria-expanded": open, onClick: onToggle, children: label }), open ? children : null] }));
}
//# sourceMappingURL=popover.js.map