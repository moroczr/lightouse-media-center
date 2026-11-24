import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Folder, Plus, RadioTower, Trash2, X } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError } from '../shared/messages'
import { builtInSlideDefaults, builtInThemes, kindNames, textCueTitle, type Item, type TextEntry, type TextSlide, type Theme } from '../shared/model'
import { ThemePreview, ThemeSwatch, useSlideThemes } from '../shared/SlideThemes'

export function Dialog({ title, children, onClose, wide, pinActions }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; pinActions?: boolean;
}) {
  const { t } = useLanguage()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = ref.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog
      className={`dialog${wide ? ' dialog--wide' : ''}${pinActions ? ' dialog--pinned-actions' : ''}`}
      ref={ref}
      aria-label={title}
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="dialog-body">
        <header className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label={t('Close dialog')} onClick={onClose}><X size={19} /></button>
        </header>
        {children}
      </div>
    </dialog>
  )
}

export function EditorForm({ children, actions, className = '', ...props }: ComponentPropsWithoutRef<'form'> & {
  actions: ReactNode
}) {
  return (
    <form {...props} className={`editor-form ${className}`}>
      <div className="editor editor-content">{children}</div>
      {actions}
    </form>
  )
}

export function ThemePicker({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  const { t } = useLanguage()
  const { settings } = useSlideThemes()
  const options = [
    ...builtInThemes.map(theme => ({ id: theme.id, name: t(theme.label), url: undefined })),
    ...(settings?.backgrounds ?? []),
  ]
  return (
    <fieldset className="theme-picker">
      <legend>{t('Background')}</legend>
      <div className="theme-picker-body">
        <div className="theme-options">
          {options.map(({ id, name, url }) => (
            <label className={`theme-option${id === value ? ' selected' : ''}`} key={id} title={name}>
              <input type="radio" name="theme" value={id} checked={id === value} onChange={() => onChange(id)} />
              <ThemeSwatch theme={id} url={url} />
              <span className="theme-option-name">{name}</span>
            </label>
          ))}
        </div>
        <ThemePreview theme={value} />
      </div>
    </fieldset>
  )
}

export function EditorActions({ editing, valid, onLive, showShortcuts }: {
  editing?: boolean
  valid: boolean
  onLive?: () => void
  showShortcuts?: boolean
}) {
  const { t } = useLanguage()
  return (
    <div className="dialog-actions">
      {onLive && (
        <button type="button" className="button" disabled={!valid} onClick={onLive}
          aria-keyshortcuts={showShortcuts ? 'Control+Enter' : undefined}>
          <RadioTower size={15} /> {t('Send to Kiosk')}
          {showShortcuts && <kbd className="cue-shortcut" aria-hidden="true">Ctrl+↵</kbd>}
        </button>
      )}
      <button className="button button-primary" disabled={!valid} type="submit"
        aria-keyshortcuts={showShortcuts ? 'Enter' : undefined}>
        {editing ? t('Save changes') : t('Add to playlist')}
        {showShortcuts && <kbd className="cue-shortcut" aria-hidden="true">↵</kbd>}
      </button>
    </div>
  )
}

export function TextEditor({ existing, onSave, onLive, library, busy = false }: {
  existing?: TextSlide
  busy?: boolean
  onSave?: (slide: TextSlide) => void
  onLive?: (slide: TextSlide) => void
  library?: {
    folder: string
    onSave: (slide: TextSlide) => string | undefined
    onBack: () => void
  }
}) {
  const { t } = useLanguage()
  const { settings, error: themeError } = useSlideThemes()
  const [id] = useState(() => existing?.id ?? crypto.randomUUID())
  const [caption, setCaption] = useState(existing?.captionFromFirstEntry ? '' : existing?.title ?? '')
  const [libraryError, setLibraryError] = useState('')
  const [entries, setEntries] = useState<TextEntry[]>(() => existing?.entries ?? [{ id: crypto.randomUUID(), text: '' }])
  const [chosenTheme, setTheme] = useState<Theme>()
  const theme = chosenTheme ?? existing?.theme ?? settings?.defaultThemes.text ?? builtInSlideDefaults.text
  const entryToFocus = useRef<string | null>(null)

  const explicitCaption = caption.trim()
  const captionFromFirstEntry = !explicitCaption
  const slide: TextSlide = {
    id,
    kind: 'text',
    title: explicitCaption || textCueTitle(entries[0]?.text ?? '') || t(kindNames.text),
    entries: entries.map(entry => ({ ...entry, text: entry.text.trim() })),
    theme,
    showCaption: existing?.showCaption === false && explicitCaption === existing.title.trim() ? false : undefined,
    captionFromFirstEntry: captionFromFirstEntry || undefined,
  }
  const valid = !busy && !!(chosenTheme || existing || settings || themeError)
    && slide.entries.length > 0 && slide.entries.every(entry => !!entry.text)

  function saveToLibrary() {
    if (library && valid) setLibraryError(library.onSave(slide) ?? '')
  }

  function liveShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (!onLive || event.key !== 'Enter' || !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey
      || event.defaultPrevented || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (valid && !event.repeat) onLive(slide)
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
    <EditorForm onKeyDown={liveShortcut} onSubmit={event => {
      event.preventDefault()
      if (onSave && valid) onSave(slide)
      else if (!onSave) saveToLibrary()
    }} actions={
      <div className="dialog-actions">
        {onLive && <button type="button" className="button" disabled={!valid} aria-keyshortcuts="Control+Enter" onClick={() => onLive(slide)}>
          <RadioTower size={15} aria-hidden="true" /> {t('Send to Kiosk')} <kbd className="cue-shortcut" aria-hidden="true">Ctrl+↵</kbd>
        </button>}
        <button type="submit" className="button button-primary" disabled={!valid} aria-keyshortcuts="Enter">
          {onSave ? existing ? t('Save changes') : t('Add to playlist') : t('Save to library')}
          <kbd className="cue-shortcut" aria-hidden="true">↵</kbd>
        </button>
      </div>
    }>
      {library && (
        <div className="text-library-context">
          <button type="button" className="button button-quiet" onClick={library.onBack}>
            <ArrowLeft size={16} aria-hidden="true" /> {t('Back to library')}
          </button>
          <span><Folder size={15} aria-hidden="true" /> {library.folder}</span>
        </div>
      )}
      <label>
        {t('Caption (optional)')}
        <input autoFocus value={caption} maxLength={100} placeholder={t('Uses the first text entry if blank')}
          onChange={event => setCaption(event.target.value)} />
      </label>
      {libraryError && <p className="media-warning" role="alert">{translateError(t, libraryError)}</p>}
      <ol className="text-entries">
        {entries.map((entry, index) => {
          const label = captionFromFirstEntry && index === 0
            ? t('Caption text') : t('Slide {number}', { number: captionFromFirstEntry ? index : index + 1 })
          return (
            <li className="text-entry" key={entry.id}>
              <div className="text-entry-header">
                <label htmlFor={`text-entry-${entry.id}`}>{label}</label>
                <div className="text-entry-actions">
                  <button type="button" className="icon-button" aria-label={t('Move {label} up', { label: label.toLowerCase() })} title={t('Move up')} disabled={index === 0} onClick={() => moveEntry(index, -1)}><ArrowUp size={15} /></button>
                  <button type="button" className="icon-button" aria-label={t('Move {label} down', { label: label.toLowerCase() })} title={t('Move down')} disabled={index === entries.length - 1} onClick={() => moveEntry(index, 1)}><ArrowDown size={15} /></button>
                  <button type="button" className="icon-button" aria-label={t('Remove {label}', { label: label.toLowerCase() })} title={t('Remove text entry')} disabled={entries.length === 1} onClick={() => setEntries(current => current.filter(item => item.id !== entry.id))}><Trash2 size={15} /></button>
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
      <button type="button" className="button text-entry-add" onClick={addEntry}><Plus size={16} /> {t('Add text entry')}</button>
      <ThemePicker value={theme} onChange={setTheme} />
    </EditorForm>
  )
}

export function NameEditor({ existing, onSave, action, label }: {
  existing?: Item;
  onSave: (name: string) => string | void;
  action: string;
  label: string;
}) {
  const { t } = useLanguage()
  const [value, setValue] = useState(existing?.title ?? '')
  const [error, setError] = useState('')
  return (
    <form className="editor" onSubmit={event => {
      event.preventDefault()
      const name = value.trim()
      if (name) setError(onSave(name) || '')
    }}>
      <label>
        {label}
        <input value={value} maxLength={100} ref={element => { if (element) element.autofocus = true }}
          onChange={event => { setValue(event.target.value); setError('') }} />
      </label>
      {error && <p className="media-warning" role="alert">{translateError(t, error)}</p>}
      <div className="dialog-actions"><button className="button button-primary" disabled={!value.trim()}>{action}</button></div>
    </form>
  )
}
