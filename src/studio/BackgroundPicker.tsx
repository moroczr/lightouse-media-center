import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { builtInThemes, type Theme } from '../shared/model'
import { ThemeSwatch, useSlideThemes } from '../shared/SlideThemes'

export function BackgroundPicker({ active, disabled = false, value, onChange }: {
  active: boolean
  disabled?: boolean
  value: Theme
  onChange: (theme: Theme) => void
}) {
  const { t } = useLanguage()
  const { settings } = useSlideThemes()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [activeIndex, setActiveIndex] = useState<number>()
  const options = [
    ...builtInThemes.map(option => ({ id: option.id, name: t(option.label), url: undefined })),
    ...(settings?.backgrounds ?? []),
  ]
  const selectedIndex = options.findIndex(option => option.id === value)
  const selected = options[selectedIndex]
  const selectedName = selected?.name ?? t('Background unavailable')
  const enabled = active && !disabled
  const expanded = enabled && activeIndex !== undefined
  const highlighted = Math.min(activeIndex ?? 0, options.length - 1)

  useEffect(() => {
    if (!enabled) setActiveIndex(undefined)
  }, [enabled])

  useLayoutEffect(() => {
    const button = trigger.current
    const popup = list.current
    if (!expanded || !button || !popup) return

    const position = () => {
      const rect = button.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      if (!rect.width || rect.bottom <= 0 || rect.top >= viewportHeight) {
        setActiveIndex(undefined)
        return
      }
      const gap = 6
      const maxHeight = 288
      const above = rect.top - gap * 2
      const below = viewportHeight - rect.bottom - gap * 2
      const opensUp = below < maxHeight && above > below
      const viewportWidth = document.documentElement.clientWidth
      const width = Math.min(Math.max(rect.width, 228), viewportWidth - gap * 2)
      const left = Math.max(gap, Math.min(rect.right, viewportWidth - gap) - width)

      popup.style.width = `${width}px`
      popup.style.left = `${left}px`
      popup.style.top = opensUp ? 'auto' : `${rect.bottom + gap}px`
      popup.style.bottom = opensUp ? `${viewportHeight - rect.top + gap}px` : 'auto'
      popup.style.maxHeight = `${Math.min(maxHeight, opensUp ? above : below)}px`
      popup.style.visibility = 'visible'
    }

    const followScroll = (event: Event) => {
      if (event.target !== popup) position()
    }
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.contains(event.target) && !popup.contains(event.target)) {
        setActiveIndex(undefined)
      }
    }

    position()
    window.addEventListener('resize', position)
    document.addEventListener('scroll', followScroll, true)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', followScroll, true)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [expanded])

  useLayoutEffect(() => {
    if (expanded) list.current?.children[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [expanded, highlighted])

  function choose(theme: Theme) {
    onChange(theme)
    setActiveIndex(undefined)
    trigger.current?.focus({ preventScroll: true })
  }

  function handleKeys(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return

    const { key } = event
    if (expanded && (key === 'Escape' || key === 'Enter' || key === ' ')) {
      event.preventDefault()
      if (key === 'Escape') {
        event.stopPropagation()
        setActiveIndex(undefined)
      } else if (!event.repeat) {
        choose(options[highlighted].id)
      }
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      const next = highlighted + (key === 'ArrowDown' ? 1 : -1)
      setActiveIndex(expanded ? Math.max(0, Math.min(next, options.length - 1)) : Math.max(0, selectedIndex))
    } else if (expanded && (key === 'Home' || key === 'End')) {
      event.preventDefault()
      setActiveIndex(key === 'Home' ? 0 : options.length - 1)
    } else if (key.length === 1 && key !== ' ') {
      const start = expanded ? highlighted : selectedIndex
      const initial = key.toLocaleLowerCase()
      const matches = (name: string) => name.toLocaleLowerCase().startsWith(initial)
      const next = options.findIndex((option, index) => index > start && matches(option.name))
      const match = next < 0 ? options.findIndex(option => matches(option.name)) : next
      if (match >= 0) {
        event.preventDefault()
        setActiveIndex(match)
      }
    }
  }

  return (
    <div className="background-picker">
      <span id={`${id}-label`}>{t('Background')}</span>
      <button type="button" role="combobox" className="button background-picker-trigger" ref={trigger} disabled={disabled}
        aria-labelledby={`${id}-label`} aria-describedby={`${id}-value`} aria-expanded={expanded}
        aria-controls={expanded ? id : undefined} aria-activedescendant={expanded ? `${id}-${highlighted}` : undefined}
        title={selectedName} onBlur={() => setActiveIndex(undefined)} onKeyDown={handleKeys}
        onClick={event => {
          event.currentTarget.focus({ preventScroll: true })
          setActiveIndex(expanded ? undefined : Math.max(0, selectedIndex))
        }}>
        {selected && <ThemeSwatch theme={selected.id} url={selected.url} />}
        <span id={`${id}-value`} className="background-picker-name">{selectedName}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {expanded && createPortal(
        <ul id={id} ref={list} className="background-picker-options" role="listbox" aria-labelledby={`${id}-label`}>
          {options.map(({ id: theme, name, url }, index) => (
            <li key={theme} id={`${id}-${index}`} role="option" aria-selected={theme === value}
              className={index === highlighted ? 'active' : undefined}
              onMouseDown={event => event.preventDefault()} onClick={() => choose(theme)}>
              <ThemeSwatch theme={theme} url={url} />
              <span className="background-picker-name" title={name}>{name}</span>
              {theme === value && <Check size={15} aria-hidden="true" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  )
}
