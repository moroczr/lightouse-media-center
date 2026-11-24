import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, CircleAlert, FolderOpen, FolderPlus, LayoutGrid, List, Plus, RadioTower, Search } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError, type Message } from '../shared/messages'
import { desktop, listMedia, pickMedia } from '../shared/bridge'
import { type MediaFile, type Source } from '../shared/model'
import { ItemIcon } from './CueList'

export type MediaView = 'list' | 'tile'
type MediaFilter = 'all' | MediaFile['kind']
type CatalogItem = MediaFile & { location: string }

const filters: { value: MediaFilter; label: Message }[] = [
  { value: 'all', label: 'All media' },
  { value: 'video', label: 'Movies' },
  { value: 'audio', label: 'Audio' },
]

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function fileLocation(file: MediaFile, source: Source) {
  const relative = file.path.slice(source.path.length)
  const separator = desktop && source.path.includes('\\') && !source.path.includes('/') ? '\\' : '/'
  const folders = relative.split(separator).filter(Boolean).slice(desktop ? 0 : 1, -1)
  return [source.name, ...folders].join(' / ')
}

export function MediaBrowser({ sources, initialFilter = 'all', view, onViewChange, onAddFolder, busy, onSave, onLive }: {
  sources: Source[];
  initialFilter?: MediaFilter;
  view: MediaView;
  onViewChange: (view: MediaView) => void;
  onAddFolder: () => Promise<void>;
  busy: boolean;
  onSave: (file: MediaFile) => void;
  onLive: (file: MediaFile) => void;
}) {
  const { t } = useLanguage()
  const [filter, setFilter] = useState(initialFilter)
  const [query, setQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string>()
  const [openedFile, setOpenedFile] = useState<MediaFile>()
  const [picking, setPicking] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const resultList = useRef<HTMLUListElement>(null)
  const [catalog, setCatalog] = useState<{ sources: Source[]; items: CatalogItem[]; unavailable: string[] }>()

  useEffect(() => {
    let active = true
    void Promise.allSettled(sources.map(listMedia)).then(results => {
      if (!active) return
      const items = new Map<string, CatalogItem>()
      const unavailable: string[] = []
      results.forEach((result, index) => {
        const source = sources[index]
        if (result.status === 'rejected') {
          unavailable.push(source.name)
          return
        }
        for (const file of result.value) {
          if (!items.has(file.path)) items.set(file.path, { ...file, location: fileLocation(file, source) })
        }
      })
      const sorted = [...items.values()].sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.location, b.location))
      setCatalog({ sources, items: sorted, unavailable })
    })
    return () => { active = false }
  }, [sources])

  const current = catalog?.sources === sources ? catalog : undefined
  const loading = sources.length > 0 && !current
  const shown = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    const items = current?.items ?? []
    const results = openedFile && !items.some(file => file.path === openedFile.path)
      ? [{ ...openedFile, location: t('Opened file') }, ...items]
      : items
    return results.filter(file => (
      (filter === 'all' || file.kind === filter)
      && (file.name.toLocaleLowerCase().includes(search) || file.location.toLocaleLowerCase().includes(search))
    ))
  }, [current, filter, openedFile, query, t])
  const selectedIndex = shown.findIndex(file => file.path === selectedPath)
  const selected = shown[selectedIndex]
  const canAct = !!selected && !busy && !picking

  function act(action: (file: MediaFile) => void) {
    if (canAct) action(selected)
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.metaKey || event.shiftKey) return
    const list = resultList.current
    const target = event.target
    const inResults = target instanceof Node && !!list?.contains(target)

    if (event.key === 'Enter' && (inResults || target instanceof HTMLInputElement || event.ctrlKey)) {
      if (!selected) return
      event.preventDefault()
      if (!event.repeat) act(event.ctrlKey ? onLive : onSave)
      return
    }

    if (event.ctrlKey || busy || picking || !list || !shown.length) return
    const { key } = event
    const vertical = key === 'ArrowUp' || key === 'ArrowDown'
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
    if (!vertical && !(inResults && view === 'tile' && horizontal)) return
    event.preventDefault()

    const last = shown.length - 1
    let index = selectedIndex
    if (index < 0) {
      index = key === 'ArrowUp' ? last : 0
    } else if (inResults) {
      const columns = view === 'tile' ? getComputedStyle(list).gridTemplateColumns.split(/\s+/).length : 1
      const column = index % columns
      if (key === 'ArrowUp' && index >= columns) index -= columns
      if (key === 'ArrowDown' && index - column + columns <= last) index = Math.min(index + columns, last)
      if (key === 'ArrowLeft' && column > 0) index--
      if (key === 'ArrowRight' && column + 1 < columns && index < last) index++
    }

    const button = list.children[index]?.querySelector('button')
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  async function pick(action: 'file' | 'folder') {
    setPickerError('')
    setPicking(true)
    try {
      if (action === 'folder') {
        await onAddFolder()
      } else {
        const file = await pickMedia(filter === 'all' ? undefined : filter)
        if (file) {
          setOpenedFile(file)
          setSelectedPath(file.path)
          setQuery('')
        }
      }
    } catch (reason) {
      setPickerError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="editor media-browser" onKeyDown={navigate}>
      <div className="media-toolbar">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input type="search" ref={input => { if (input) input.autofocus = true }}
            aria-label={t('Search media')} value={query} placeholder={t('Search files and folders')}
            onChange={event => setQuery(event.target.value)} />
        </label>
        <div className="media-tools">
          <button className="button" disabled={picking} onClick={() => void pick('file')}><FolderOpen size={16} /> {t('Open file')}</button>
          <button className="button" disabled={picking} onClick={() => void pick('folder')}><FolderPlus size={16} /> {t('Add folder')}</button>
        </div>
      </div>

      <div className="media-options">
        <div className="media-segment" role="group" aria-label={t('Media type')}>
          {filters.map(option => (
            <button key={option.value} className="button" aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}>{t(option.label)}</button>
          ))}
        </div>
        <div className="media-segment" role="group" aria-label={t('Media view')}>
          <button className="icon-button" title={t('List view')} aria-label={t('List view')} aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}><List size={17} /></button>
          <button className="icon-button" title={t('Tile view')} aria-label={t('Tile view')} aria-pressed={view === 'tile'}
            onClick={() => onViewChange('tile')}><LayoutGrid size={17} /></button>
        </div>
      </div>

      {pickerError && <p className="media-warning" role="alert"><CircleAlert size={15} />{translateError(t, pickerError)}</p>}
      {!!current?.unavailable.length && (
        <p className="media-warning" role="status"><CircleAlert size={15} />{t('Couldn’t scan {folders}.', { folders: current.unavailable.join(', ') })}</p>
      )}

      <div className="media-results" role="region" aria-label={t('Media results')} aria-busy={loading}>
        {shown.length ? (
          <ul ref={resultList} className={`media-entries media-entries--${view}`}>
            {shown.map((file, index) => (
              <li key={file.path}>
                <button type="button" className="media-result" aria-pressed={selectedIndex === index}
                  tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
                  title={file.path} onFocus={() => setSelectedPath(file.path)}
                  onClick={event => {
                    event.currentTarget.focus({ preventScroll: true })
                    setSelectedPath(file.path)
                  }}>
                  <ItemIcon kind={file.kind} size={view === 'tile' ? 28 : 16} />
                  <span className="media-result-text">
                    <strong>{file.name}</strong>
                    <span>{file.location}</span>
                  </span>
                  <span className="media-result-type">{file.kind === 'video' ? t('Movie') : t('Audio')}</span>
                  <Check className="media-result-check" size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="media-empty" role="status">{loading ? t('Scanning media folders…')
            : !sources.length && !openedFile ? t('Add a folder to browse your media, or open a file.')
            : query.trim() || filter !== 'all' ? t('No media matches your search or filter.')
            : t('No media found in your source folders.')}</p>
        )}
      </div>

      <div className="media-footer">
        <p className="media-selection" role="status" title={selected?.name}>
          {selected ? selected.name : loading ? '' : t(shown.length === 1 ? '{count} item' : '{count} items', { count: shown.length })}
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" disabled={!canAct} aria-keyshortcuts="Control+Enter" onClick={() => act(onLive)}>
            <RadioTower size={16} /> {t('Send to Kiosk')} <kbd className="cue-shortcut" aria-hidden="true">Ctrl+↵</kbd>
          </button>
          <button type="button" className="button button-primary" disabled={!canAct} aria-keyshortcuts="Enter" onClick={() => act(onSave)}>
            <Plus size={17} /> {t('Add to playlist')} <kbd className="cue-shortcut" aria-hidden="true">↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
