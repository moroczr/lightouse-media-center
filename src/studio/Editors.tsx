import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Plus, RadioTower, Trash2, X } from 'lucide-react'
import { textSlideCues, type Item, type TextCue, type TextEntry, type TextSlide, type Theme } from '../shared/model'

export function Dialog({ title, children, onClose, wide }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = ref.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog
      className={wide ? 'dialog dialog--wide' : 'dialog'}
      ref={ref}
      aria-label={title}
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="dialog-body">
        <header className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>
        </header>
        {children}
      </div>
    </dialog>
  )
}

const themes: { value: Theme; label: string }[] = [
  { value: 'plain', label: 'Black' },
  { value: 'twilight', label: 'Twilight' },
  { value: 'violet', label: 'Violet' },
]

export function ThemePicker({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  return (
    <fieldset className="theme-picker">
      <legend>Background</legend>
      {themes.map(theme => (
        <label className={`theme-option${theme.value === value ? ' selected' : ''}`} key={theme.value}>
          <input type="radio" name="theme" value={theme.value} checked={theme.value === value} onChange={() => onChange(theme.value)} />
          <span className={`theme-swatch slide--${theme.value}`} />
          {theme.label}
        </label>
      ))}
    </fieldset>
  )
}

export function EditorActions({ editing, valid, onLive }: { editing?: boolean; valid: boolean; onLive?: () => void }) {
  return (
    <div className="dialog-actions">
      {onLive && (
        <button type="button" className="button" disabled={!valid} onClick={onLive}>
          <RadioTower size={15} /> Send to Kiosk
        </button>
      )}
      <button className="button button-primary" disabled={!valid} type="submit">
        {editing ? 'Save changes' : 'Add to playlist'}
      </button>
    </div>
  )
}

export function TextEditor({ existing, onSave, onLive }: {
  existing?: TextSlide;
  onSave: (slide: TextSlide) => void;
  onLive: (cue: TextCue) => void;
}) {
  const [caption, setCaption] = useState(existing?.title ?? '')
  const [entries, setEntries] = useState<TextEntry[]>(() => existing?.entries ?? [{ id: crypto.randomUUID(), text: '' }])
  const [theme, setTheme] = useState<Theme>(existing?.theme ?? 'twilight')
  const entryToFocus = useRef<string | null>(null)
  const valid = !!caption.trim() && entries.every(entry => !!entry.text.trim())

  function makeSlide(): TextSlide {
    return {
      id: existing?.id ?? crypto.randomUUID(),
      kind: 'text',
      title: caption.trim(),
      entries: entries.map(entry => ({ ...entry, text: entry.text.trim() })),
      theme,
    }
  }

  function addEntry() {
    const id = crypto.randomUUID()
    entryToFocus.current = id
    setEntries(current => [...current, { id, text: '' }])
  }

  function moveEntry(index: number, direction: -1 | 1) {
    setEntries(current => {
      const destination = index + direction
      if (destination < 0 || destination >= current.length) return current
      const reordered = [...current]
      reordered[index] = current[destination]
      reordered[destination] = current[index]
      return reordered
    })
  }

  return (
    <form className="editor" onSubmit={event => { event.preventDefault(); if (valid) onSave(makeSlide()) }}>
      <label>Caption<input autoFocus required value={caption} maxLength={100} onChange={event => setCaption(event.target.value)} /></label>
      <ol className="text-entries">
        {entries.map((entry, index) => {
          const label = `Slide ${index + 1}`
          return (
            <li className="text-entry" key={entry.id}>
              <div className="text-entry-header">
                <label htmlFor={`text-entry-${entry.id}`}>{label}</label>
                <div className="text-entry-actions">
                  <button type="button" className="icon-button" aria-label={`Move ${label.toLowerCase()} up`} title="Move up" disabled={index === 0} onClick={() => moveEntry(index, -1)}><ArrowUp size={15} /></button>
                  <button type="button" className="icon-button" aria-label={`Move ${label.toLowerCase()} down`} title="Move down" disabled={index === entries.length - 1} onClick={() => moveEntry(index, 1)}><ArrowDown size={15} /></button>
                  <button type="button" className="icon-button" aria-label={`Remove ${label.toLowerCase()}`} title="Remove slide" disabled={entries.length === 1} onClick={() => setEntries(current => current.filter(item => item.id !== entry.id))}><Trash2 size={15} /></button>
                </div>
              </div>
              <textarea id={`text-entry-${entry.id}`} rows={3} required maxLength={1600} value={entry.text}
                ref={element => {
                  if (element && entryToFocus.current === entry.id) {
                    entryToFocus.current = null
                    element.focus()
                  }
                }}
                onChange={event => {
                  const text = event.target.value
                  setEntries(current => current.map(item => item.id === entry.id ? { ...item, text } : item))
                }}
              />
            </li>
          )
        })}
      </ol>
      <button type="button" className="button text-entry-add" onClick={addEntry}><Plus size={16} /> Add text entry</button>
      <ThemePicker value={theme} onChange={setTheme} />
      <EditorActions editing={!!existing} valid={valid}
        onLive={!existing && entries.length === 1 ? () => onLive(textSlideCues(makeSlide())[0]) : undefined} />
    </form>
  )
}

export function NameEditor({ existing, onSave, action, label }: {
  existing?: Item;
  onSave: (name: string) => void;
  action: string;
  label: string;
}) {
  const [value, setValue] = useState(existing?.title ?? '')
  return (
    <form className="editor" onSubmit={event => { event.preventDefault(); if (value.trim()) onSave(value.trim()) }}>
      <label>{label}<input autoFocus value={value} maxLength={100} onChange={event => setValue(event.target.value)} /></label>
      <div className="dialog-actions"><button className="button button-primary" disabled={!value.trim()}>{action}</button></div>
    </form>
  )
}
