import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'

const POPOVER_OPEN_EVENT = 'dsh-taskboard-popover-open'

export function useExclusivePopover(): {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly toggle: () => void
} {
  const id = useId()
  const [open, setOpenState] = useState(false)
  useEffect(() => {
    const onPeerOpen = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === id) return
      setOpenState(false)
    }
    document.addEventListener(POPOVER_OPEN_EVENT, onPeerOpen)
    return () => { document.removeEventListener(POPOVER_OPEN_EVENT, onPeerOpen) }
  }, [id])
  const setOpen = (next: boolean): void => {
    if (next) document.dispatchEvent(new CustomEvent(POPOVER_OPEN_EVENT, { detail: id }))
    setOpenState(next)
  }
  const toggle = (): void => {
    setOpenState(current => {
      const next = !current
      if (next) document.dispatchEvent(new CustomEvent(POPOVER_OPEN_EVENT, { detail: id }))
      return next
    })
  }
  return { open, setOpen, toggle }
}

export function usePopoverDismiss(
  open: boolean,
  onOutside: () => void,
  onEscape: () => void = onOutside,
): RefObject<HTMLDivElement> {
  const rootRef = useRef<HTMLDivElement>(null)
  const onOutsideRef = useRef(onOutside)
  const onEscapeRef = useRef(onEscape)
  onOutsideRef.current = onOutside
  onEscapeRef.current = onEscape
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      onOutsideRef.current()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onEscapeRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])
  return rootRef
}

export function PopoverShell({
  open,
  onToggle,
  onDismiss,
  onEscape,
  label,
  children,
}: {
  open: boolean
  onToggle: () => void
  onDismiss: () => void
  onEscape?: () => void
  label: ReactNode
  children: ReactNode
}) {
  const rootRef = usePopoverDismiss(open, onDismiss, onEscape ?? onDismiss)
  return (
    <div ref={rootRef} className="dsh-taskboard-popover">
      <button type="button" aria-expanded={open} onClick={onToggle}>{label}</button>
      {open ? children : null}
    </div>
  )
}
