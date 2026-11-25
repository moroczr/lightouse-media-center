import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import type { ItemKind } from '../shared/model'

export type CueDropTarget = 'live' | 'next'

export interface CueDragItem {
  cueId: string
  title: string
  kind: ItemKind
}

interface CueDrag {
  item: CueDragItem
  pointerId: number
  x: number
  y: number
  started: boolean
}

function targetAt(event: PointerEvent): CueDropTarget | null {
  const screen = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cue-drop-target]')
  const target = screen?.getAttribute('data-cue-drop-target')
  return target === 'live' || target === 'next' ? target : null
}

function positionPreview(element: HTMLDivElement, { x, y }: { x: number; y: number }) {
  const gap = 14
  const inset = 8
  const width = element.offsetWidth
  const height = element.offsetHeight
  const left = x + gap + width + inset <= window.innerWidth ? x + gap : Math.max(inset, x - gap - width)
  const top = y + gap + height + inset <= window.innerHeight ? y + gap : Math.max(inset, y - gap - height)
  element.style.transform = `translate3d(${left}px, ${top}px, 0)`
}

export function useCueDrag(onDrop: (id: string, target: CueDropTarget) => void) {
  const drag = useRef<CueDrag | null>(null)
  const suppressClick = useRef(false)
  const previewElement = useRef<HTMLDivElement | null>(null)
  const [preview, setPreview] = useState<{ item: CueDragItem; target: CueDropTarget | null } | null>(null)

  const previewRef = useCallback((element: HTMLDivElement | null) => {
    previewElement.current = element
    if (element && drag.current) positionPreview(element, drag.current)
  }, [])

  useEffect(() => {
    function cancel(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !drag.current?.started) return
      drag.current = null
      suppressClick.current = true
      setPreview(null)
    }

    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])

  function start(event: PointerEvent<HTMLButtonElement>, item: CueDragItem) {
    if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch') return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { item, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false }
  }

  function move(event: PointerEvent) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!current.started && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return
    current.started = true
    current.x = event.clientX
    current.y = event.clientY
    if (previewElement.current) positionPreview(previewElement.current, current)

    const target = targetAt(event)
    const item = current.item
    setPreview(previous => previous?.item === item && previous.target === target ? previous : { item, target })
  }

  function end(event: PointerEvent) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    if (!current.started) return
    suppressClick.current = true
    setPreview(null)
    if (event.type === 'pointerup') {
      const destination = targetAt(event)
      if (destination) onDrop(current.item.cueId, destination)
    }
  }

  function blockClick(event: MouseEvent) {
    // Pointer capture can send a click back to the source after a drag.
    if (!suppressClick.current || event.detail === 0) return
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    preview,
    previewRef,
    start,
    handlers: {
      onPointerDownCapture: () => { suppressClick.current = false },
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
      onClickCapture: blockClick,
      onDoubleClickCapture: blockClick,
    },
  }
}
