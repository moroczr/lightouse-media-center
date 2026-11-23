import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RadioTower, X } from 'lucide-react'
import { type Cue, type Group, type Theme } from '../shared/model'

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
  existing?: Extract<Cue, { kind: 'text' }>;
  onSave: (cue: Cue) => void;
  onLive: (cue: Cue) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [text, setText] = useState(existing?.text ?? '')
  const [theme, setTheme] = useState<Theme>(existing?.theme ?? 'twilight')

  const makeCue = (): Cue => ({
    id: existing?.id ?? crypto.randomUUID(),
    kind: 'text',
    title: title.trim() || text.trim().split('\n')[0].slice(0, 80),
    text: text.trim(),
    theme,
  })

  return (
    <form className="editor" onSubmit={event => { event.preventDefault(); if (text.trim()) onSave(makeCue()) }}>
      <label>Cue name<input autoFocus value={title} maxLength={100} onChange={event => setTitle(event.target.value)} placeholder="Optional" /></label>
      <label>Slide text<textarea value={text} rows={5} maxLength={1600} onChange={event => setText(event.target.value)} placeholder="Text shown on the audience display" /></label>
      <ThemePicker value={theme} onChange={setTheme} />
      <EditorActions editing={!!existing} valid={!!text.trim()} onLive={existing ? undefined : () => onLive(makeCue())} />
    </form>
  )
}

export function NameEditor({ existing, onSave, action, label }: {
  existing?: Group | Cue;
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
