import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, CircleAlert, Folder, FolderOpen, FolderPlus, Search } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError, type Message } from '../shared/messages'
import { desktop, listMedia, pickMedia } from '../shared/bridge'
import { type MediaFile, type Source } from '../shared/model'
import { ItemIcon } from './CueList'
import { AddToPlaylistButton } from './Editors'
import { ResultBrowser, useResultBrowser, type BrowserItem } from './ResultBrowser'
import { ViewModeSwitch, type ViewMode } from './ViewModeSwitch'
import type { CueDragStart } from './useCueDrag'

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

export function MediaBrowser({ sources, filter, onFilterChange, view, onViewChange, onAddFolder, active = true, busy, onSave, onPreview, onLive, onCuePointerDown }: {
  sources: Source[];
  filter: MediaFilter;
  onFilterChange: (filter: MediaFilter) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onAddFolder?: () => Promise<void>;
  active?: boolean;
  busy: boolean;
  onSave?: (file: MediaFile) => void;
  onPreview?: (file: MediaFile | undefined) => void;
  onLive?: (file: MediaFile) => void;
  onCuePointerDown?: CueDragStart;
}) {
  const { t } = useLanguage()
  const grid = view === 'grid'
  const [query, setQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string>()
  const [location, setLocation] = useState<MediaLocation>()
  const [picking, setPicking] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const [catalog, setCatalog] = useState<{ sources: Source[]; items: CatalogItem[]; unavailable: string[] }>()
  const browseSources = !!onLive
  const source = location?.kind === 'source' ? sources.find(source => source.id === location.id) : undefined
  const openedFile = location?.kind === 'file' ? location.file : undefined
  const atRoot = browseSources && !source && !openedFile
  const searchAllSources = atRoot && !!query.trim()
  const scanSources = useMemo(() => {
    if (source) return [source]
    return searchAllSources || !browseSources ? sources : []
  }, [source, searchAllSources, browseSources, sources])

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
    const folders = atRoot
      ? sources.filter(folder => matches(folder.name) || (desktop && matches(folder.path)))
        .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.path, b.path))
      : []
    if (atRoot && !search) return folders

    const items = openedFile ? [{ ...openedFile, location: t('Opened file') }] : current?.items ?? []
    const files = items.filter(file => (
      (filter === 'all' || file.kind === filter) && (matches(file.name) || matches(file.location))
    ))
    return [...folders, ...files]
  }, [atRoot, current, filter, openedFile, query, sources, t])
  const selectedIndex = shown.findIndex(item => item.path === selectedPath)
  const selection = shown[selectedIndex]
  const selected = selection && 'kind' in selection ? selection : undefined
  const canAct = !!selected && !busy && !picking

  useEffect(() => {
    onPreview?.(selected)
  }, [onPreview, selected])

  function act(action: (file: MediaFile) => void) {
    if (canAct) action(selected)
  }

  const browser = useResultBrowser({
    selectedIndex, grid, loading, active, disabled: busy || picking,
    items: shown.map((item): BrowserItem => {
      const common = { key: item.path, label: item.name, select: () => setSelectedPath(item.path) }
      if (!('kind' in item)) return {
        ...common, title: desktop ? item.path : item.name, description: desktop ? item.path : t('Folder'),
        icon: <span className="item-icon media-folder-icon"><Folder size={grid ? 30 : 18} aria-hidden="true" /></span>,
        open: () => openLocation({ kind: 'source', id: item.id }),
      }
      return {
        ...common, title: item.path, description: item.location, kind: item.kind,
        icon: <ItemIcon kind={item.kind} size={grid ? 28 : 16} />,
        badge: item.kind === 'audio' || !onLive ? t(item.kind === 'video' ? 'Movie' : 'Audio') : undefined,
        accessory: !onLive && <Check className="media-result-check" size={15} aria-hidden="true" />,
        pick: onSave && (() => onSave(item)), live: onLive && (() => onLive(item)),
      }
    }),
  })

  function openLocation(next?: MediaLocation) {
    browser.cancelPendingFocus()
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
    <div className="editor media-browser" onKeyDown={browser.onKeyDown}>
      <div className="media-toolbar">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input type="search" ref={input => {
            searchInput.current = input
            if (input) input.autofocus = true
          }} aria-label={t('Search media')} value={query}
            placeholder={t(atRoot ? 'Search all libraries' : source ? 'Search this folder' : 'Search files and folders')}
            onKeyDown={browser.onSearchKeyDown} onBlur={browser.cancelPendingFocus}
            onChange={event => { browser.cancelPendingFocus(); setQuery(event.target.value) }} />
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
        <ViewModeSwitch view={view} onChange={onViewChange} label="Media view" gridLabel="Tile view" />
      </div>

      {pickerError && <p className="media-warning" role="alert"><CircleAlert size={15} />{translateError(t, pickerError)}</p>}
      {!!current?.unavailable.length && (
        <p className="media-warning" role="status"><CircleAlert size={15} />{t('Couldn’t scan {folders}.', { folders: current.unavailable.join(', ') })}</p>
      )}

      <div className="media-results" role="region" aria-label={t('Media results')} aria-busy={loading}>
        {shown.length ? (
          <ResultBrowser browser={browser} onCuePointerDown={onCuePointerDown} />
        ) : (
          <p className="media-empty" role="status">{loading ? t('Scanning media folders…')
            : atRoot && !sources.length ? t('Add a folder to browse your media, or open a file.')
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
