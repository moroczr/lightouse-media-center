import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Folder, FolderPlus, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Audience } from '../shared/Audience'
import { useLanguage } from '../shared/i18n'
import { translateError } from '../shared/messages'
import { textSlideCues, type LibraryTextSlide, type Theme } from '../shared/model'
import { BackgroundPicker } from './BackgroundPicker'
import { ItemIcon } from './CueList'
import { AddToPlaylistButton } from './Editors'
import { ResultBrowser, useResultBrowser, type BrowserItem } from './ResultBrowser'
import { ViewModeSwitch, type ViewMode } from './ViewModeSwitch'
import type { CueDragStart } from './useCueDrag'

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

export type LibrarySlideSelection = { item: LibraryTextSlide; index: number }

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
    onPreview: (selection: LibrarySlideSelection | undefined) => void
    onLive: (selection: LibrarySlideSelection) => void
    onCuePointerDown: CueDragStart
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
  view: ViewMode
  onViewChange: (view: ViewMode) => void
  actions: TextLibraryActions
}) {
  const { language, t } = useLanguage()
  const mosaic = view === 'grid'
  const [folder, setFolder] = useState(() => items.find(item => item.slide.id === selectedId)?.folder ?? initialFolder ?? '')
  const [openedId, setOpenedId] = useState<string>()
  const opened = actions.kind === 'browse' ? items.find(item => item.slide.id === openedId) : undefined
  const entries = useMemo(() => opened ? textSlideCues(opened.slide) : [], [opened])
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(selectedId ? `slide:${selectedId}` : undefined)
  const searchInput = useRef<HTMLInputElement>(null)
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
  const rows = opened ? entries.map((cue, index) => ({
    kind: 'entry', key: `entry:${cue.id}`, cue, index,
  } as const)).filter(({ cue }) => (cue.text || cue.title).toLocaleLowerCase().includes(search)) : [
    ...subfolders.map(name => ({ kind: 'folder', key: `folder:${prefix}${name}`, name, path: prefix + name } as const)),
    ...shown.map(item => ({ kind: 'slide', key: `slide:${item.slide.id}`, item } as const)),
  ]
  const selectedIndex = rows.findIndex(row => row.key === selection)
  const selectedRow = rows[selectedIndex]
  const selected = selectedRow?.kind === 'slide' ? selectedRow.item : undefined
  const entryIndex = selectedRow?.kind === 'entry' ? selectedRow.index : undefined
  const crumbs = folder ? folder.split('/') : []
  const onPreview = actions.kind === 'browse' ? actions.onPreview : undefined

  useEffect(() => {
    onPreview?.(opened && entryIndex !== undefined ? { item: opened, index: entryIndex } : undefined)
  }, [onPreview, opened, entryIndex])

  function openLocation(path: string, item?: LibraryTextSlide) {
    setOpenedId(item?.slide.id)
    setFolder(path)
    setQuery('')
    setSelection(undefined)
    searchInput.current?.focus()
  }

  const browser = useResultBrowser({
    grid: mosaic, disabled: busy, selectedIndex,
    items: rows.map((row): BrowserItem => {
      const common = { key: row.key, select: () => setSelection(row.key) }
      if (row.kind === 'folder') return {
        ...common, label: row.name, title: row.name, description: t(libraries.includes(row.path) ? 'Library' : 'Folder'),
        icon: !mosaic && <Folder size={22} aria-hidden="true" />, thumbnail: <Folder size={36} />,
        open: () => openLocation(row.path),
        actions: actions.kind === 'browse' && <>
          <RowAction icon={Pencil} label={t('Rename library {name}', { name: row.name })} disabled={busy} onClick={() => actions.onRenameLibrary(row.path)} />
          <RowAction icon={Trash2} label={t('Delete library {name}', { name: row.name })} disabled={busy} danger onClick={() => actions.onDeleteLibrary(row.path)} />
        </>,
      }
      const cues = row.kind === 'slide' ? textSlideCues(row.item.slide) : [row.cue]
      const preview = cues[0]
      const appearance = {
        ...common, icon: !mosaic && <ItemIcon kind="text" />,
        thumbnail: mosaic && <Audience cue={preview ? { ...preview, theme } : null} />,
      }
      if (row.kind === 'entry') return {
        ...appearance, label: row.cue.title, title: row.cue.text || row.cue.title, description: t('Slide {number}', { number: row.index + 1 }),
        kind: 'text', live: opened && actions.kind === 'browse' ? () => actions.onLive({ item: opened, index: row.index }) : undefined,
      }
      const { item } = row
      const name = item.slide.title
      const details = {
        ...appearance, label: name, title: name, description: item.folder || t('Library'),
        badge: t(cues.length === 1 ? '{count} slide' : '{count} slides', { count: cues.length }),
      }
      if (actions.kind === 'pick') return { ...details, pick: () => actions.onAdd(item) }
      return {
        ...details, open: () => openLocation(item.folder, item),
        actions: <>
          <RowAction icon={Pencil} label={t('Edit slide {name}', { name })} disabled={busy} onClick={() => actions.onEdit(item)} />
          <RowAction icon={Trash2} label={t('Delete slide {name}', { name })} disabled={busy} danger onClick={() => actions.onDelete(item)} />
        </>,
      }
    }),
  })

  return (
    <div className={`editor text-library${mosaic ? ' text-library--mosaic' : ''}`} onKeyDown={browser.onKeyDown}>
      <div className="text-library-toolbar">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input type="search" aria-label={t(opened ? 'Search these slides' : 'Search saved text slides')} placeholder={opened ? t('Search these slides') : folder ? t('Search this library') : t('Search all libraries')} value={query}
            ref={element => {
              searchInput.current = element
              if (element) element.autofocus = true
            }} onChange={event => setQuery(event.target.value)} />
        </label>
        {actions.kind === 'browse' && !opened && (libraries.includes(folder) ? (
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
          <button type="button" className="button button-quiet" aria-current={!folder && !opened ? 'location' : undefined}
            onClick={() => openLocation('')}>{t('Library')}</button>
          {crumbs.map((part, index) => {
            const path = crumbs.slice(0, index + 1).join('/')
            return (
              <span key={path}>
                <ChevronRight size={13} aria-hidden="true" />
                <button type="button" className="button button-quiet" aria-current={path === folder && !opened ? 'location' : undefined}
                  onClick={() => openLocation(path)}>{part}</button>
              </span>
            )
          })}
          {opened && <span>
            <ChevronRight size={13} aria-hidden="true" /><span aria-current="location">{opened.slide.title}</span>
          </span>}
        </nav>
        <div className="text-library-controls">
          {actions.kind === 'browse' && <BackgroundPicker active={active} value={theme}
            disabled={busy || actions.backgroundBusy} onChange={actions.onBackgroundChange} />}
          <ViewModeSwitch view={view} onChange={onViewChange} label="Text slide view" gridLabel="Mosaic view" />
        </div>
      </div>

      <div className="media-results" role="region" aria-label={opened ? t('Slides in {name}', { name: opened.slide.title }) : t('Saved text slides')} aria-busy={saving}>
        {rows.length ? (
          <ResultBrowser browser={browser} variant="thumbnail"
            onCuePointerDown={actions.kind === 'browse' ? actions.onCuePointerDown : undefined} />
        ) : (
          <p className="media-empty" role="status">{search ? t('No text slides match your search.')
            : opened ? t('No slides in this set.') : libraries.length || actions.kind === 'pick' ? t('No saved text slides here.') : t('Create a library to save text slides.')}</p>
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
