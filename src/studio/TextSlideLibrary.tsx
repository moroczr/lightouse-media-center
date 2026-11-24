import { useRef, useState, type KeyboardEvent } from 'react'
import { ChevronRight, Folder, FolderPlus, Pencil, Plus, RadioTower, Search } from 'lucide-react'
import { textSlideCues, type Group, type LibraryTextSlide } from '../shared/model'
import { ItemIcon } from './CueList'

function playlistDestinations(group: Group, root = group.id, label = group.title): { id: string; root: string; label: string }[] {
  return [
    { id: group.id, root, label },
    ...group.children.flatMap(child => child.kind === 'playlist'
      ? playlistDestinations(child, root, `${label} / ${child.title}`) : []),
  ]
}

export function TextSlideLibrary({
  items, libraries, playlists, parent, selectedId, initialFolder, saving, error, busy, onCreate, onCreateLibrary, onCreateOneOff, onEdit, onAdd, onLive,
}: {
  items: LibraryTextSlide[]
  libraries: string[]
  playlists: Group[]
  parent: string
  selectedId?: string
  initialFolder?: string
  saving: boolean
  error: string
  busy: boolean
  onCreate: (folder: string) => void
  onCreateLibrary: () => void
  onCreateOneOff: () => void
  onEdit: (item: LibraryTextSlide) => void
  onAdd: (item: LibraryTextSlide, parent: string, root: string) => void
  onLive: (item: LibraryTextSlide) => void
}) {
  const [folder, setFolder] = useState(() => items.find(item => item.slide.id === selectedId)?.folder ?? initialFolder ?? '')
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(selectedId ? `slide:${selectedId}` : undefined)
  const [destination, setDestination] = useState(parent)
  const searchInput = useRef<HTMLInputElement>(null)
  const resultList = useRef<HTMLUListElement>(null)
  const search = query.trim().toLocaleLowerCase()
  const prefix = folder ? `${folder}/` : ''
  const subfolders = search ? [] : [...new Set(libraries.flatMap(path => (
    path.startsWith(prefix) && path.length > prefix.length
      ? [path.slice(prefix.length).split('/', 1)[0]] : []
  )))].sort((a, b) => a.localeCompare(b))
  const shown = items.filter(item => search
    ? (item.folder === folder || item.folder.startsWith(prefix))
      && `${item.folder}/${item.slide.title}`.toLocaleLowerCase().includes(search)
    : item.folder === folder).sort((a, b) => a.slide.title.localeCompare(b.slide.title) || a.folder.localeCompare(b.folder))
  const rows = [
    ...subfolders.map(name => ({ kind: 'folder', key: `folder:${prefix}${name}`, name, path: prefix + name } as const)),
    ...shown.map(item => ({ kind: 'slide', key: `slide:${item.slide.id}`, item } as const)),
  ]
  const selectedIndex = rows.findIndex(row => row.key === selection)
  const selectedRow = rows[selectedIndex]
  const selected = selectedRow?.kind === 'slide' ? selectedRow.item : undefined
  const destinations = playlists.flatMap(group => playlistDestinations(group))
  const target = destinations.find(option => option.id === destination) ?? destinations[0]
  const crumbs = folder ? folder.split('/') : []

  function openFolder(path: string) {
    setFolder(path)
    setQuery('')
    setSelection(undefined)
    searchInput.current?.focus()
  }

  function addSelected() {
    if (selected && target && !busy) onAdd(selected, target.id, target.root)
  }

  function sendSelected() {
    if (selected && !busy) onLive(selected)
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.metaKey || event.shiftKey) return
    const list = resultList.current
    const source = event.target
    const inResults = source instanceof Node && !!list?.contains(source)
    if (event.key === 'Enter' && (inResults || source === searchInput.current || event.ctrlKey)) {
      // Let an unmodified Enter activate a focused folder through its button.
      if (!selected && !event.ctrlKey) return
      event.preventDefault()
      if (!event.repeat) {
        if (event.ctrlKey) sendSelected()
        else addSelected()
      }
      return
    }
    if (event.ctrlKey || busy || !list || source instanceof HTMLSelectElement) return

    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!direction) return
    event.preventDefault()
    const last = rows.length - 1
    const index = selectedIndex < 0 ? (direction === 1 ? 0 : last)
      : Math.max(0, Math.min(last, selectedIndex + (inResults ? direction : 0)))
    const button = list.children[index]?.querySelector('button')
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <div className="editor" onKeyDown={navigate}>
      <div className="text-library-toolbar">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input type="search" aria-label="Search saved text slides" placeholder={folder ? 'Search this library' : 'Search all libraries'} value={query}
            ref={element => {
              searchInput.current = element
              if (element) element.autofocus = true
            }} onChange={event => setQuery(event.target.value)} />
        </label>
        <button type="button" className="button" onClick={onCreateOneOff}>One-off text slide</button>
        {libraries.includes(folder) ? (
          <button type="button" className="button button-primary" onClick={() => onCreate(folder)}>
            <Plus size={16} aria-hidden="true" /> New text slide
          </button>
        ) : (
          <button type="button" className="button button-primary" onClick={onCreateLibrary}>
            <FolderPlus size={16} aria-hidden="true" /> New library
          </button>
        )}
      </div>

      <nav className="text-library-path" aria-label="Slide libraries">
        <button type="button" className="button button-quiet" aria-current={!folder ? 'location' : undefined}
          onClick={() => openFolder('')}>Library</button>
        {crumbs.map((part, index) => {
          const path = crumbs.slice(0, index + 1).join('/')
          return (
            <span key={path}>
              <ChevronRight size={13} aria-hidden="true" />
              <button type="button" className="button button-quiet" aria-current={path === folder ? 'location' : undefined}
                onClick={() => openFolder(path)}>{part}</button>
            </span>
          )
        })}
      </nav>

      <div className="media-results" role="region" aria-label="Saved text slides" aria-busy={saving}>
        {rows.length ? (
          <ul className="media-entries" ref={resultList}>
            {rows.map((row, index) => {
              const count = row.kind === 'slide' ? textSlideCues(row.item.slide).length : 0
              return (
                <li key={row.key}>
                  <button type="button" className="media-result"
                    aria-pressed={row.kind === 'slide' ? index === selectedIndex : undefined}
                    tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
                    onFocus={() => setSelection(row.key)}
                    onClick={event => {
                      if (row.kind === 'folder') {
                        openFolder(row.path)
                      } else {
                        event.currentTarget.focus({ preventScroll: true })
                        setSelection(row.key)
                      }
                    }}>
                    {row.kind === 'folder' ? <>
                      <Folder size={22} aria-hidden="true" />
                      <span className="media-result-text"><strong>{row.name}</strong><span>{libraries.includes(row.path) ? 'Library' : 'Folder'}</span></span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </> : <>
                      <ItemIcon kind="text" />
                      <span className="media-result-text"><strong>{row.item.slide.title}</strong><span>{row.item.folder || 'Library'}</span></span>
                      <span className="media-result-type">{count} {count === 1 ? 'slide' : 'slides'}</span>
                    </>}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="media-empty" role="status">{search ? 'No text slides match your search.'
            : libraries.length ? 'No saved text slides here.' : 'Create a library to save text slides.'}</p>
        )}
      </div>
      {saving && <p role="status">Saving text slide library…</p>}
      {error && <p className="media-warning" role="alert">{error}</p>}

      <label>
        Destination playlist
        <select value={target?.id ?? ''} onChange={event => setDestination(event.target.value)}>
          {destinations.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <div className="dialog-actions">
        <button type="button" className="button" disabled={!selected || busy} onClick={() => selected && onEdit(selected)}>
          <Pencil size={15} aria-hidden="true" /> Edit
        </button>
        <button type="button" className="button" disabled={!selected || busy} aria-keyshortcuts="Control+Enter" onClick={sendSelected}>
          <RadioTower size={16} aria-hidden="true" /> Send to Kiosk <kbd className="cue-shortcut" aria-hidden="true">Ctrl+↵</kbd>
        </button>
        <button type="button" className="button button-primary" disabled={!selected || !target || busy}
          aria-keyshortcuts="Enter" onClick={addSelected}>
          <Plus size={17} aria-hidden="true" /> Add to playlist <kbd className="cue-shortcut" aria-hidden="true">↵</kbd>
        </button>
      </div>
    </div>
  )
}
