import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { ChevronRight } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import type { ItemKind } from '../shared/model'
import { SendToKioskButton } from './Editors'
import type { CueDragStart } from './useCueDrag'
import { focusResult, navigateResultList } from './resultNavigation'

export type BrowserItem = {
  key: string
  label: string
  description?: string
  title?: string
  icon?: ReactNode
  thumbnail?: ReactNode
  badge?: string
  actions?: ReactNode
  select: () => void
} & (
  | { open: () => void; live?: never; pick?: never; kind?: never }
  | { open?: never; live?: () => void; pick?: () => void; kind?: ItemKind }
)

type BrowserOptions = {
  items: BrowserItem[]
  selectedIndex: number
  grid: boolean
  disabled: boolean
  active: boolean
  loading?: boolean
  onBoundary?: (direction: -1 | 1) => void
}

export function useResultBrowser(options: BrowserOptions) {
  const { items, selectedIndex, grid, disabled, active, loading, onBoundary } = options
  const listRef = useRef<HTMLUListElement>(null)
  const pendingFocus = useRef<HTMLInputElement>(null)
  const enteringTab = useRef(false)

  useLayoutEffect(() => {
    if (active) return
    enteringTab.current = true
    pendingFocus.current = null
  }, [active])

  function onResultFocus(index: number) {
    enteringTab.current = false
    if (index !== selectedIndex) items[index].select()
  }

  function cancelPendingFocus() {
    pendingFocus.current = null
  }

  // Honor Down Arrow once the current search has rendered any results.
  useLayoutEffect(() => {
    const input = pendingFocus.current
    if (!input || (loading && !items.length)) return
    pendingFocus.current = null
    if (input !== document.activeElement || input.closest('[hidden]') || !listRef.current) return
    focusResult(listRef.current, enteringTab.current ? 0 : Math.max(0, selectedIndex))
  }, [items.length, loading, selectedIndex])

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (event.key === 'ArrowDown' && loading && !items.length) {
      event.preventDefault()
      pendingFocus.current = event.currentTarget
      return
    }
    // On tab entry, start at the edge of the results even when a previous selection is still visible.
    navigateResultList(event, listRef.current, enteringTab.current ? -1 : selectedIndex, grid)
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.metaKey || event.shiftKey) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const inList = listRef.current?.contains(target)
    const onRow = inList && target.closest('[data-result-button]')
    const inSearch = target instanceof HTMLInputElement && ['text', 'search'].includes(target.type)
    if (event.key === 'Enter' || event.key === ' ') {
      const item = items[selectedIndex]
      const space = event.key === ' '
      const sendShortcut = event.key === 'Enter' && event.ctrlKey
      if (!onRow && !inSearch && !sendShortcut) return
      if (space && (!onRow || event.ctrlKey)) return
      const action = space || sendShortcut ? item?.live : item?.pick
      if (!action) return
      event.preventDefault()
      if (!disabled && !event.repeat) action()
    } else if (inList) {
      navigateResultList(event, listRef.current, selectedIndex, grid, onBoundary)
    }
  }

  return { ...options, listRef, onKeyDown, onSearchKeyDown, onResultFocus, cancelPendingFocus }
}

const layouts = {
  catalog: { list: 'media-entries media-entries--list', grid: 'media-entries media-entries--tile', button: 'media-result' },
  thumbnail: { list: 'media-entries', grid: 'media-entries text-library-grid', button: 'media-result text-library-row-main' },
  passage: { list: 'scripture-scroll verse-results', grid: 'scripture-scroll verse-results verse-results--mosaic', button: 'verse-result' },
}

export function ResultBrowser({ browser, variant = 'catalog', className = '', label, loading, selectedRef, onCuePointerDown }: {
  browser: ReturnType<typeof useResultBrowser>
  variant?: keyof typeof layouts
  className?: string
  label?: string
  loading?: boolean
  selectedRef?: Ref<HTMLButtonElement>
  onCuePointerDown?: CueDragStart
}) {
  const { t } = useLanguage()
  const { items, selectedIndex, grid, disabled, listRef } = browser
  const firstClick = useRef<HTMLButtonElement | null>(null)
  const thumbnail = variant === 'thumbnail'
  const passage = variant === 'passage'
  const layout = layouts[variant]
  const listClass = grid ? layout.grid : layout.list

  return (
    <ul className={`${listClass} ${className}`.trim()} ref={listRef} aria-label={label} aria-busy={loading}>
      {items.map((item, index) => {
        const selected = index === selectedIndex
        const { live, kind } = item
        const startDrag = !disabled && live && kind && onCuePointerDown
          ? (event: PointerEvent<HTMLButtonElement>) => onCuePointerDown(event, { title: item.label, kind, preview: item.select, live })
          : undefined
        const send = live && <SendToKioskButton name={item.label} disabled={disabled} onClick={live} />
        const text = <><strong>{item.label}</strong>{item.description && <span>{item.description}</span>}</>
        return (
          <li key={item.key} className={thumbnail ? 'text-library-row' : live ? 'result-with-send' : undefined}
            onFocus={() => browser.onResultFocus(index)}>
            {grid && item.thumbnail && <div className="text-library-thumbnail" aria-hidden="true">{item.thumbnail}</div>}
            <button type="button" data-result-button="" data-selected={selected ? '' : undefined} className={layout.button + (startDrag ? ' cue-draggable' : '')}
              title={item.title} tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
              ref={selected ? selectedRef : undefined} aria-pressed={item.open ? undefined : selected}
              aria-keyshortcuts={live && !disabled ? 'Space Control+Enter' : undefined}
              onPointerDown={startDrag}
              onClick={event => {
                // Extra clicks in the same sequence may land on a new row after opening a folder.
                if (event.detail > 1 && firstClick.current !== event.currentTarget) return
                firstClick.current = event.currentTarget
                if (item.open && event.detail === 0) {
                  // Keyboard and assistive technology activate the native button with a zero-detail click.
                  item.open()
                  return
                }
                if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true })
                else if (!selected) item.select()
              }}
              onDoubleClick={event => {
                if (firstClick.current !== event.currentTarget) return
                if (item.open) item.open()
                else if (!disabled) live?.()
              }}>
              {item.icon}
              {passage ? text : <span className="media-result-text">{text}</span>}
              {item.badge && <span className="media-result-type">{item.badge}</span>}
              {item.open && <ChevronRight className="media-folder-chevron" size={15} aria-hidden="true" />}
            </button>
            {thumbnail && (item.actions || send)
              ? <div className="text-library-row-actions" role="group" aria-label={t('Actions for {name}', { name: item.label })}>{item.actions}{send}</div>
              : <>{item.actions}{send}</>}
          </li>
        )
      })}
    </ul>
  )
}
