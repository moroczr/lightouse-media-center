import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronRight, CircleAlert, Folder, FolderOpen, FolderPlus, LayoutGrid, List, Search } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError, type Message } from '../shared/messages'
import { desktop, listMedia, pickMedia } from '../shared/bridge'
import { type MediaFile, type Source } from '../shared/model'
import { ItemIcon } from './CueList'
import { AddToPlaylistButton, SendToKioskButton } from './Editors'

export type MediaView = 'list' | 'tile'
export type MediaFilter = 'all' | MediaFile['kind']
type CatalogItem = MediaFile & { location: string }
type MediaLocation = { kind: 'source'; id: string } | { kind: 'file'; file: MediaFile }

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

export function MediaBrowser({ sources, filter, onFilterChange, view, onViewChange, onAddFolder, busy, onSave, onLive }: {
  sources: Source[];
  filter: MediaFilter;
  onFilterChange: (filter: MediaFilter) => void;
  view: MediaView;
  onViewChange: (view: MediaView) => void;
  onAddFolder?: () => Promise<void>;
  busy: boolean;
  onSave?: (file: MediaFile) => void;
  onLive?: (file: MediaFile) => void;
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string>()
  const [location, setLocation] = useState<MediaLocation>()
  const [picking, setPicking] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const resultList = useRef<HTMLUListElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [catalog, setCatalog] = useState<{ sources: Source[]; items: CatalogItem[]; unavailable: string[] }>()
  const browseSources = !!onLive
  const source = location?.kind === 'source' ? sources.find(source => source.id === location.id) : undefined
  const openedFile = location?.kind === 'file' ? location.file : undefined
  const atRoot = browseSources && !source && !openedFile
  const scanSources = useMemo(() => browseSources ? (source ? [source] : []) : sources, [browseSources, source, sources])

  useEffect(() => {
    if (location?.kind === 'source' && !source) {
      setLocation(undefined)
      setSelectedPath(undefined)
      setQuery('')
    }
  }, [location, source])

  useEffect(() => {
    if (!scanSources.length) return
    let active = true
    void Promise.allSettled(scanSources.map(listMedia)).then(results => {
      if (!active) return
      const items = new Map<string, CatalogItem>()
      const unavailable: string[] = []
      results.forEach((result, index) => {
        const source = scanSources[index]
        if (result.status === 'rejected') {
          unavailable.push(source.name)
          return
        }
        for (const file of result.value) {
          if (!items.has(file.path)) items.set(file.path, { ...file, location: fileLocation(file, source) })
        }
      })
      const sorted = [...items.values()].sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.location, b.location))
      setCatalog({ sources: scanSources, items: sorted, unavailable })
    })
    return () => { active = false }
  }, [scanSources])

  const current = catalog?.sources === scanSources ? catalog : undefined
  const loading = scanSources.length > 0 && !current
  const shown = useMemo((): (CatalogItem | Source)[] => {
    const search = query.trim().toLocaleLowerCase()
    const matches = (value: string) => value.toLocaleLowerCase().includes(search)
    if (atRoot) {
      return sources.filter(folder => matches(folder.name) || (desktop && matches(folder.path)))
        .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.path, b.path))
    }

    const items = openedFile ? [{ ...openedFile, location: t('Opened file') }] : current?.items ?? []
    return items.filter(file => (
      (filter === 'all' || file.kind === filter) && (matches(file.name) || matches(file.location))
    ))
  }, [atRoot, current, filter, openedFile, query, sources, t])
  const selectedIndex = shown.findIndex(item => item.path === selectedPath)
  const selection = shown[selectedIndex]
  const selected = selection && 'kind' in selection ? selection : undefined
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
      const action = event.ctrlKey ? onLive : onSave
      if (!selected || !action) return
      event.preventDefault()
      if (!event.repeat) act(action)
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

  function openLocation(next?: MediaLocation) {
    setLocation(next)
    setSelectedPath(next?.kind === 'file' ? next.file.path : undefined)
    setQuery('')
    searchInput.current?.focus({ preventScroll: true })
  }

  async function pick(action: 'file' | 'folder') {
    setPickerError('')
    setPicking(true)
    try {
      if (action === 'folder') {
        await onAddFolder?.()
      } else {
        const file = await pickMedia(filter === 'all' ? undefined : filter)
        if (file) openLocation({ kind: 'file', file })
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
          <input type="search" ref={input => {
            searchInput.current = input
            if (input) input.autofocus = true
          }} aria-label={t('Search media')} value={query}
            placeholder={t(atRoot ? 'Search source folders' : source ? 'Search this folder' : 'Search files and folders')}
            onChange={event => setQuery(event.target.value)} />
        </label>
        {onAddFolder && <div className="media-tools">
          <button className="button" disabled={picking} onClick={() => void pick('file')}><FolderOpen size={16} /> {t('Open file')}</button>
          <button className="button" disabled={picking} onClick={() => void pick('folder')}><FolderPlus size={16} /> {t('Add folder')}</button>
        </div>}
      </div>

      <div className="media-options">
        {browseSources && <nav className="media-path" aria-label={t('Media sources')}>
          {atRoot ? <span aria-current="location">{t('Media sources')}</span> : <>
            <button type="button" className="button button-quiet" onClick={() => openLocation()}>{t('Media sources')}</button>
            <ChevronRight size={14} aria-hidden="true" />
            <span aria-current="location" title={source?.name}>{source?.name ?? t('Opened file')}</span>
          </>}
        </nav>}
        <div className="media-segment" role="group" aria-label={t('Media type')}>
          {filters.map(option => (
            <button key={option.value} className="button" aria-pressed={filter === option.value}
              onClick={() => onFilterChange(option.value)}>{t(option.label)}</button>
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
            {shown.map((item, index) => {
              const isFile = 'kind' in item
              return (
                <li key={item.path} className={isFile && onLive ? 'result-with-send' : undefined}
                  onFocus={() => setSelectedPath(item.path)}>
                  <button type="button" className="media-result" aria-pressed={isFile ? selectedIndex === index : undefined}
                    tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1} title={isFile || desktop ? item.path : item.name}
                    onClick={event => {
                      if (!isFile) {
                        openLocation({ kind: 'source', id: item.id })
                        return
                      }
                      event.currentTarget.focus({ preventScroll: true })
                      setSelectedPath(item.path)
                    }}>
                    {isFile ? <ItemIcon kind={item.kind} size={view === 'tile' ? 28 : 16} />
                      : <span className="item-icon media-folder-icon"><Folder size={view === 'tile' ? 30 : 18} aria-hidden="true" /></span>}
                    <span className="media-result-text">
                      <strong>{item.name}</strong>
                      <span>{isFile ? item.location : desktop ? item.path : t('Folder')}</span>
                    </span>
                    {isFile ? <>
                      {(item.kind === 'audio' || !onLive) && (
                        <span className="media-result-type">{item.kind === 'video' ? t('Movie') : t('Audio')}</span>
                      )}
                      {!onLive && <Check className="media-result-check" size={15} aria-hidden="true" />}
                    </> : <ChevronRight className="media-folder-chevron" size={15} aria-hidden="true" />}
                  </button>
                  {isFile && onLive && <SendToKioskButton name={item.name} disabled={busy || picking} onClick={() => onLive(item)} />}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="media-empty" role="status">{loading ? t('Scanning media folders…')
            : atRoot ? t(sources.length ? 'No source folders match your search.' : 'Add a folder to browse your media, or open a file.')
            : !sources.length && !openedFile ? t('No media sources added.')
            : query.trim() || filter !== 'all' ? t('No media matches your search or filter.')
            : t(source ? 'No audio or video files in this folder.' : 'No media found in your source folders.')}</p>
        )}
      </div>

      {onSave && <div className="media-footer">
        <p className="media-selection" role="status" title={selected?.name}>
          {selected ? selected.name : loading ? '' : t(shown.length === 1 ? '{count} item' : '{count} items', { count: shown.length })}
        </p>
        <div className="dialog-actions">
          <AddToPlaylistButton disabled={!canAct} onClick={() => act(onSave)} />
        </div>
      </div>}
    </div>
  )
}
