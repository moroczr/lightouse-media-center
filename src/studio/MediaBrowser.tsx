import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, FolderOpen, FolderPlus, LayoutGrid, List, Plus, RadioTower, Search } from 'lucide-react'
import { desktop, listMedia, pickMedia } from '../shared/bridge'
import { type MediaFile, type Source } from '../shared/model'
import { ItemIcon } from './CueList'

export type MediaView = 'list' | 'tile'
type MediaFilter = 'all' | MediaFile['kind']
type CatalogItem = MediaFile & { location: string }

const filters: { value: MediaFilter; label: string }[] = [
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
  const [filter, setFilter] = useState(initialFilter)
  const [query, setQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string>()
  const [openedFile, setOpenedFile] = useState<MediaFile>()
  const [picking, setPicking] = useState(false)
  const [pickerError, setPickerError] = useState('')
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
      ? [{ ...openedFile, location: 'Opened file' }, ...items]
      : items
    return results.filter(file => (
      (filter === 'all' || file.kind === filter)
      && (file.name.toLocaleLowerCase().includes(search) || file.location.toLocaleLowerCase().includes(search))
    ))
  }, [current, filter, openedFile, query])
  const selected = shown.find(file => file.path === selectedPath)

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
    <div className="editor media-browser">
      <div className="media-toolbar">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input type="search" autoFocus aria-label="Search media" value={query} placeholder="Search files and folders"
            onChange={event => setQuery(event.target.value)} />
        </label>
        <div className="media-tools">
          <button className="button" disabled={picking} onClick={() => void pick('file')}><FolderOpen size={16} /> Open file</button>
          <button className="button" disabled={picking} onClick={() => void pick('folder')}><FolderPlus size={16} /> Add folder</button>
        </div>
      </div>

      <div className="media-options">
        <div className="media-segment" role="group" aria-label="Media type">
          {filters.map(option => (
            <button key={option.value} className="button" aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}>{option.label}</button>
          ))}
        </div>
        <div className="media-segment" role="group" aria-label="Media view">
          <button className="icon-button" title="List view" aria-label="List view" aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}><List size={17} /></button>
          <button className="icon-button" title="Tile view" aria-label="Tile view" aria-pressed={view === 'tile'}
            onClick={() => onViewChange('tile')}><LayoutGrid size={17} /></button>
        </div>
      </div>

      {pickerError && <p className="media-warning" role="alert"><CircleAlert size={15} />{pickerError}</p>}
      {!!current?.unavailable.length && (
        <p className="media-warning" role="status"><CircleAlert size={15} />Couldn’t scan {current.unavailable.join(', ')}.</p>
      )}

      <div className="media-results" role="region" aria-label="Media results" aria-busy={loading}>
        {shown.length ? (
          <ul className={`media-entries media-entries--${view}`}>
            {shown.map(file => (
              <li key={file.path}>
                <button className="media-result" aria-pressed={selectedPath === file.path}
                  title={file.path} onClick={() => setSelectedPath(file.path)}>
                  <ItemIcon kind={file.kind} size={view === 'tile' ? 28 : 16} />
                  <span className="media-result-text">
                    <strong>{file.name}</strong>
                    <span>{file.location}</span>
                  </span>
                  <span className="media-result-type">{file.kind === 'video' ? 'Movie' : 'Audio'}</span>
                  <Check className="media-result-check" size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="media-empty" role="status">{loading ? 'Scanning media folders…'
            : !sources.length && !openedFile ? 'Add a folder to browse your media, or open a file.'
            : query.trim() || filter !== 'all' ? 'No media matches your search or filter.'
            : 'No media found in your source folders.'}</p>
        )}
      </div>

      <div className="media-footer">
        <p className="media-selection" role="status" title={selected?.name}>
          {selected ? selected.name : loading ? '' : `${shown.length} ${shown.length === 1 ? 'item' : 'items'}`}
        </p>
        <div className="dialog-actions">
          <button className="button" disabled={!selected || busy} onClick={() => { if (selected) onLive(selected) }}><RadioTower size={16} /> Send to Kiosk</button>
          <button className="button button-primary" disabled={!selected || busy} onClick={() => { if (selected) onSave(selected) }}><Plus size={17} /> Add to playlist</button>
        </div>
      </div>
    </div>
  )
}
