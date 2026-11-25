import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronRight, Folder, FolderPlus, LayoutGrid, List, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Audience } from '../shared/Audience'
import { useLanguage } from '../shared/i18n'
import { translateError } from '../shared/messages'
import { textSlideCues, type LibraryTextSlide, type Theme } from '../shared/model'
import { BackgroundPicker } from './BackgroundPicker'
import { ItemIcon } from './CueList'
import { AddToPlaylistButton, SendToKioskButton } from './Editors'

function RowAction({ icon: Icon, label, disabled, danger, onClick }: {
  icon: typeof Pencil
  label: string
  disabled: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`icon-button${danger ? ' text-library-delete' : ''}`}
      disabled={disabled} title={label} aria-label={label} onClick={onClick}>
      <Icon size={15} aria-hidden="true" />
    </button>
  )
}

export type TextLibraryView = 'list' | 'mosaic'

type TextLibraryActions =
  | { kind: 'pick'; onAdd: (item: LibraryTextSlide) => void }
  | {
    kind: 'browse'
    onBackgroundChange: (theme: Theme) => void
    backgroundBusy: boolean
    onCreate: (folder: string) => void
    onCreateLibrary: () => void
    onRenameLibrary: (folder: string) => void
    onDeleteLibrary: (folder: string) => void
    onEdit: (item: LibraryTextSlide) => void
    onDelete: (item: LibraryTextSlide) => void
    onPreview: (item: LibraryTextSlide | undefined) => void
    onLive: (item: LibraryTextSlide) => void
  }

export function TextSlideLibrary({
  active, items, libraries, selectedId, initialFolder, saving, error, busy, theme, view, onViewChange, actions,
}: {
  active: boolean
  items: LibraryTextSlide[]
  libraries: string[]
  selectedId?: string
  initialFolder?: string
  saving: boolean
  error: string
  busy: boolean
  theme: Theme
  view: TextLibraryView
  onViewChange: (view: TextLibraryView) => void
  actions: TextLibraryActions
}) {
  const { language, t } = useLanguage()
  const mosaic = view === 'mosaic'
  const [folder, setFolder] = useState(() => items.find(item => item.slide.id === selectedId)?.folder ?? initialFolder ?? '')
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(selectedId ? `slide:${selectedId}` : undefined)
  const searchInput = useRef<HTMLInputElement>(null)
  const resultList = useRef<HTMLUListElement>(null)
  const search = query.trim().toLocaleLowerCase()
  const prefix = folder ? `${folder}/` : ''
  const subfolders = search ? [] : [...new Set(libraries.flatMap(path => (
    path.startsWith(prefix) && path.length > prefix.length
      ? [path.slice(prefix.length).split('/', 1)[0]] : []
  )))].sort((a, b) => a.localeCompare(b, language))
  const shown = items.filter(item => search
    ? (item.folder === folder || item.folder.startsWith(prefix))
      && `${item.folder}/${item.slide.title}`.toLocaleLowerCase().includes(search)
    : item.folder === folder).sort((a, b) => a.slide.title.localeCompare(b.slide.title, language) || a.folder.localeCompare(b.folder, language))
  const rows = [
    ...subfolders.map(name => ({ kind: 'folder', key: `folder:${prefix}${name}`, name, path: prefix + name } as const)),
    ...shown.map(item => ({ kind: 'slide', key: `slide:${item.slide.id}`, item } as const)),
  ]
  const selectedIndex = rows.findIndex(row => row.key === selection)
  const selectedRow = rows[selectedIndex]
  const selected = selectedRow?.kind === 'slide' ? selectedRow.item : undefined
  const crumbs = folder ? folder.split('/') : []
  const onPreview = actions.kind === 'browse' ? actions.onPreview : undefined

  useEffect(() => {
    onPreview?.(selected)
  }, [onPreview, selected])

  function openFolder(path: string) {
    setFolder(path)
    setQuery('')
    setSelection(undefined)
    searchInput.current?.focus()
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.metaKey || event.shiftKey) return
    const list = resultList.current
    const source = event.target
    const inResults = source instanceof HTMLElement && !!list?.contains(source)
    const onRow = inResults && source.matches('.text-library-row-main')
    if (event.key === 'Enter' && selected && (onRow || source === searchInput.current)) {
      const action = event.ctrlKey
        ? (actions.kind === 'browse' ? actions.onLive : undefined)
        : (actions.kind === 'pick' ? actions.onAdd : undefined)
      if (action) {
        event.preventDefault()
        if (!event.repeat && !busy) action(selected)
        return
      }
    }
    if (event.ctrlKey || busy || !list) return

    const { key } = event
    const vertical = key === 'ArrowDown' || key === 'ArrowUp'
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
    if (!vertical && !(mosaic && inResults && horizontal)) return
    event.preventDefault()

    const last = rows.length - 1
    let index = selectedIndex
    if (index < 0) {
      index = key === 'ArrowUp' ? last : 0
    } else if (inResults) {
      const columns = mosaic ? getComputedStyle(list).gridTemplateColumns.split(/\s+/).length : 1
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

  return (
    <div className={`editor text-library${mosaic ? ' text-library--mosaic' : ''}`} onKeyDown={navigate}>
      <div className="text-library-toolbar">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input type="search" aria-label={t('Search saved text slides')} placeholder={folder ? t('Search this library') : t('Search all libraries')} value={query}
            ref={element => {
              searchInput.current = element
              if (element) element.autofocus = true
            }} onChange={event => setQuery(event.target.value)} />
        </label>
        {actions.kind === 'browse' && (libraries.includes(folder) ? (
          <button type="button" className="button button-primary" onClick={() => actions.onCreate(folder)}>
            <Plus size={16} aria-hidden="true" /> {t('New text slide')}
          </button>
        ) : (
          <button type="button" className="icon-button" aria-label={t('New library')} title={t('New library')}
            onClick={actions.onCreateLibrary}><FolderPlus size={16} aria-hidden="true" /></button>
        ))}
      </div>

      <div className="text-library-options">
        <nav className="text-library-path" aria-label={t('Slide libraries')}>
          <button type="button" className="button button-quiet" aria-current={!folder ? 'location' : undefined}
            onClick={() => openFolder('')}>{t('Library')}</button>
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
        <div className="text-library-controls">
          {actions.kind === 'browse' && <BackgroundPicker active={active} value={theme}
            disabled={busy || actions.backgroundBusy} onChange={actions.onBackgroundChange} />}
          <div className="media-segment" role="group" aria-label={t('Text slide view')}>
            <button type="button" className="icon-button" title={t('List view')} aria-label={t('List view')}
              aria-pressed={!mosaic} onClick={() => onViewChange('list')}><List size={17} aria-hidden="true" /></button>
            <button type="button" className="icon-button" title={t('Mosaic view')} aria-label={t('Mosaic view')}
              aria-pressed={mosaic} onClick={() => onViewChange('mosaic')}><LayoutGrid size={17} aria-hidden="true" /></button>
          </div>
        </div>
      </div>

      <div className="media-results" role="region" aria-label={t('Saved text slides')} aria-busy={saving}>
        {rows.length ? (
          <ul className={`media-entries${mosaic ? ' text-library-grid' : ''}`} ref={resultList}>
            {rows.map((row, index) => {
              const item = row.kind === 'slide' ? row.item : undefined
              const name = row.kind === 'folder' ? row.name : row.item.slide.title
              const cues = item ? textSlideCues(item.slide) : []
              const count = cues.length
              return (
                <li key={row.key} className="text-library-row" onFocus={() => setSelection(row.key)}>
                  {mosaic && (
                    <div className="text-library-thumbnail" aria-hidden="true">
                      {item ? <Audience cue={cues[0] ? { ...cues[0], theme } : null} /> : <Folder size={36} />}
                    </div>
                  )}
                  <button type="button" className="media-result text-library-row-main" title={name}
                    aria-pressed={item ? index === selectedIndex : undefined}
                    tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
                    onClick={event => {
                      if (row.kind === 'folder') openFolder(row.path)
                      else {
                        event.currentTarget.focus({ preventScroll: true })
                        setSelection(row.key)
                      }
                    }}
                    onDoubleClick={item && actions.kind === 'browse' ? () => {
                      if (!busy) actions.onLive(item)
                    } : undefined}>
                    {row.kind === 'folder' ? <>
                      {!mosaic && <Folder size={22} aria-hidden="true" />}
                      <span className="media-result-text"><strong>{name}</strong><span>{libraries.includes(row.path) ? t('Library') : t('Folder')}</span></span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </> : <>
                      {!mosaic && <ItemIcon kind="text" />}
                      <span className="media-result-text"><strong>{name}</strong><span>{row.item.folder || t('Library')}</span></span>
                      <span className="media-result-type">{t(count === 1 ? '{count} slide' : '{count} slides', { count })}</span>
                    </>}
                  </button>
                  {actions.kind === 'browse' && (
                    <div className="text-library-row-actions" role="group" aria-label={t('Actions for {name}', { name })}>
                      {row.kind === 'folder' ? <>
                        <RowAction icon={Pencil} label={t('Rename library {name}', { name })} disabled={busy} onClick={() => actions.onRenameLibrary(row.path)} />
                        <RowAction icon={Trash2} label={t('Delete library {name}', { name })} danger disabled={busy} onClick={() => actions.onDeleteLibrary(row.path)} />
                      </> : <>
                        <SendToKioskButton name={name} disabled={busy} onClick={() => actions.onLive(row.item)} />
                        <RowAction icon={Pencil} label={t('Edit slide {name}', { name })} disabled={busy} onClick={() => actions.onEdit(row.item)} />
                        <RowAction icon={Trash2} label={t('Delete slide {name}', { name })} danger disabled={busy} onClick={() => actions.onDelete(row.item)} />
                      </>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="media-empty" role="status">{search ? t('No text slides match your search.')
            : libraries.length || actions.kind === 'pick' ? t('No saved text slides here.') : t('Create a library to save text slides.')}</p>
        )}
      </div>
      {actions.kind === 'pick' && (
        <div className="media-footer">
          <p className="media-selection" role="status" title={selected?.slide.title}>{selected?.slide.title}</p>
          <div className="dialog-actions">
            <AddToPlaylistButton disabled={busy || !selected} onClick={() => { if (selected) actions.onAdd(selected) }} />
          </div>
        </div>
      )}
      {saving && <p role="status">{t('Saving text slide library…')}</p>}
      {error && <p className="media-warning" role="alert">{translateError(t, error)}</p>}
    </div>
  )
}
