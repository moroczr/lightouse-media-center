import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, ChevronDown, CircleAlert, Ellipsis, FolderOpen, FolderPlus, Image as ImageIcon, LibraryBig, ListMusic,
  Monitor, MonitorOff, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plus, Settings, Trash2, Type, X,
} from 'lucide-react'
import { useStage } from '../shared/Audience'
import { useKioskBackground } from '../shared/KioskBackground'
import {
  closeKiosk, desktop, displays, isKioskOpen, listenKioskClosed, loadProject, openKiosk, pickFolder,
  controlPlayback, present, resolveCue, saveProject, setBlackout,
} from '../shared/bridge'
import {
  copyLibraryTextSlide, findCueAncestors, flatten, kindNames, mediaCue, normalizeTextSlideFolder, starterProject, textSlideCues, updateGroup,
  type AudienceCue, type Cue, type Display, type Group, type Item, type ItemKind,
  type LibraryTextSlide, type Project, type ScriptureCue, type TextCue, type TextSlide, welcomePreview,
} from '../shared/model'
import { formatScriptureCue, verseLabel, type PassageVerse } from '../shared/scripture'
import { CueList, ItemIcon, Menu } from './CueList'
import { Dialog, NameEditor, TextEditor } from './Editors'
import { KioskBackgroundEditor } from './KioskBackgroundEditor'
import { ScriptureEditor } from './ScriptureEditor'
import { MediaBrowser, type MediaView } from './MediaBrowser'
import { TextSlideLibrary } from './TextSlideLibrary'
import { Preview } from './Preview'
import { SettingsDialog } from './Settings'

type Editor =
  | { kind: 'settings' }
  | { kind: 'kiosk-background' }
  | { kind: 'choose'; parent: string }
  | { kind: 'text-library'; parent: string; selectedId?: string; folder?: string }
  | { kind: 'new-slide-library'; parent: string }
  | { kind: 'library-text'; parent: string; folder: string; existing?: TextSlide }
  | { kind: 'text'; parent: string; existing?: TextSlide }
  | { kind: 'scripture'; parent: string; existing?: ScriptureCue }
  | { kind: 'playlist'; parent: string | null }
  | { kind: 'media'; parent: string; filter?: 'video' | 'audio' }
  | { kind: 'rename'; parent: string | null; existing: Item }
  | { kind: 'remove'; parent: string | null; item: Item }

type AddCueKind = ItemKind | 'media'

const libraryActions = {
  media: { kind: 'media', label: 'Add Media', shortcut: 'M', icon: LibraryBig },
  scripture: { kind: 'scripture', label: 'Bible lookup', shortcut: 'B', icon: BookOpen },
  text: { kind: 'text', label: kindNames.text, shortcut: 'T', icon: Type },
} as const

const libraryItems = Object.values(libraryActions)
const cueActions: readonly { kind: AddCueKind; label: string; shortcut?: string }[] = [
  libraryActions.text, libraryActions.scripture, libraryActions.media,
  { kind: 'video', label: kindNames.video },
  { kind: 'audio', label: kindNames.audio },
  { kind: 'playlist', label: kindNames.playlist },
]

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function playlistPath(root: Group, target: string): string[] | undefined {
  if (root.id === target) return [root.id]
  for (const item of root.children) {
    if (item.kind !== 'playlist') continue
    const path = playlistPath(item, target)
    if (path) return [root.id, ...path]
  }
}

export default function Studio() {
  const [project, setProject] = useState<Project>(starterProject)
  const [loaded, setLoaded] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [persistedTextLibrary, setPersistedTextLibrary] = useState<LibraryTextSlide[]>()
  const [persistedSlideLibraries, setPersistedSlideLibraries] = useState<string[]>()
  const [cueId, setCueId] = useState<string | null>(desktop ? welcomePreview.id : 'opening-scripture')
  const [displayList, setDisplayList] = useState<Display[]>([])
  const [kiosk, setKiosk] = useState(false)
  const [displayBusy, setDisplayBusy] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set(['worship']))
  const stage = useStage()
  const [liveTextCues, setLiveTextCues] = useState<TextCue[]>([])
  const { background, error: backgroundError } = useKioskBackground()
  const [editor, setEditor] = useState<Editor | null>(null)
  const [mediaView, setMediaView] = useState<MediaView>('list')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [transmitting, setTransmitting] = useState(false)
  const transmittingRef = useRef(false)
  const saves = useRef(Promise.resolve())
  const displayInUse = useRef<string | null>(null)
  const displayOperation = useRef(0)

  const active = project.playlists.find(list => list.id === project.activeId) ?? project.playlists[0]
  const currentCueId = stage.cue?.id
  const liveTextIndex = stage.cue?.kind === 'text' ? liveTextCues.findIndex(cue => cue.id === currentCueId) : -1
  const sequence = useMemo(() => flatten(active.children), [active])
  const index = sequence.findIndex(item => item.id === cueId)
  const queued = sequence[index]
  const [resolved, setResolved] = useState<{ item: Cue; cue: AudienceCue | null; error: string }>()
  const next = resolved?.item === queued ? resolved?.cue ?? null : null
  const savedDisplay = displayList.find(display => display.id === project.displayId)
  const display = savedDisplay ?? displayList.find(item => !item.studio) ?? displayList[0]
  const showStandby = !kiosk && stage.revision === 0 && !stage.cue && !desktop
    && active.id === 'sunday' && queued?.id !== welcomePreview.id && sequence[0]?.id === welcomePreview.id

  function tell(text: string, error = false) {
    setNotice({ text, error })
  }

  useEffect(() => {
    let active = true
    void loadProject().then(saved => {
      if (!active) return
      if (saved?.playlists.length) {
        const root = saved.playlists.find(item => item.id === saved.activeId) ?? saved.playlists[0]
        setProject(saved)
        setCueId(flatten(root.children)[0]?.id ?? null)
      }
      setLoaded(true)
    }).catch(reason => {
      if (!active) return
      setSaveError(`Could not open the workspace: ${errorText(reason)}`)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!loaded) return
    saves.current = saves.current.then(() => saveProject(project)).then(() => {
      setPersistedTextLibrary(project.textLibrary)
      setPersistedSlideLibraries(project.slideLibraries)
      setSaveError('')
    }).catch(reason => setSaveError(`Could not save changes: ${errorText(reason)}`))
  }, [project, loaded])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), notice.error ? 7200 : 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!kiosk || !currentCueId) return
    const ancestors = findCueAncestors(active.children, currentCueId)
    if (!ancestors?.length) return

    setExpanded(current => ancestors.every(id => current.has(id))
      ? current
      : new Set([...current, ...ancestors]))
  }, [active, currentCueId, kiosk, stage.revision])

  useEffect(() => {
    if (!queued) return
    let current = true
    void resolveCue(queued).then(cue => {
      if (current) setResolved({ item: queued, cue, error: '' })
    }).catch(reason => {
      if (current) setResolved({ item: queued, cue: null, error: errorText(reason) })
    })
    return () => { current = false }
  }, [queued])

  useEffect(() => {
    let active = true
    let pending = false
    let cleanup: (() => void) | undefined
    void listenKioskClosed(() => {
      if (!active) return
      displayInUse.current = null
      setKiosk(false)
    }).then(unlisten => {
      if (active) cleanup = unlisten
      else unlisten()
    }).catch(reason => { if (active) tell(errorText(reason), true) })

    async function pollDisplays() {
      if (pending) return
      pending = true
      const operation = displayOperation.current
      try {
        const [available, showing] = await Promise.all([displays(), isKioskOpen()])
        if (!active || operation !== displayOperation.current || operation % 2 !== 0) return
        setDisplayList(available)
        const target = displayInUse.current
        if (target && !available.some(item => item.id === target)) {
          displayInUse.current = null
          await closeKiosk()
          if (!active) return
          setKiosk(false)
          tell('Kiosk display disconnected. Choose a display to reopen it.', true)
        } else {
          if (!showing) displayInUse.current = null
          setKiosk(showing)
        }
      } catch (reason) {
        if (active) tell(errorText(reason), true)
      } finally {
        pending = false
      }
    }
    void pollDisplays()
    const timer = window.setInterval(() => void pollDisplays(), 1800)
    return () => { active = false; window.clearInterval(timer); cleanup?.() }
  }, [])

  function updatePlaylist(fn: (root: Group) => Group, rootId = active.id) {
    setProject(current => ({
      ...current,
      activeId: rootId,
      playlists: current.playlists.map(root => root.id === rootId ? fn(root) : root),
    }))
  }

  function selectPlaylist(root: Group) {
    setProject(current => ({ ...current, activeId: root.id }))
    setCueId(flatten(root.children)[0]?.id ?? null)
  }

  function cueItem(id: string | undefined, branchId?: string) {
    if (branchId) setExpanded(current => new Set(current).add(branchId))
    if (id) setCueId(id)
    else tell('This playlist group is empty.')
  }

  function nudge(direction: -1 | 1) {
    const candidate = sequence[(index < 0 ? sequence.length : index) + direction]
    if (candidate) setCueId(candidate.id)
  }

  async function send(item: Cue, advance: boolean, textCues: TextCue[] = []) {
    if (transmittingRef.current) return
    transmittingRef.current = true
    setTransmitting(true)
    try {
      const cue = await resolveCue(item)
      await present(cue)
      setLiveTextCues(textCues)
      if (advance) {
        const currentIndex = sequence.findIndex(candidate => candidate.id === item.id)
        setCueId(current => current === item.id ? sequence[currentIndex + 1]?.id ?? null : current)
      } else {
        setEditor(null)
      }
      if (!kiosk) tell('Cue staged. Launch Kiosk to present it.')
    } catch (reason) {
      tell(errorText(reason), true)
    } finally {
      transmittingRef.current = false
      setTransmitting(false)
    }
  }

  function sendTextSlide(slide: TextSlide) {
    const cues = textSlideCues(slide)
    if (cues.length) void send(cues[0], false, cues)
  }

  function showAdjacentTextSlide(direction: -1 | 1) {
    if (liveTextIndex < 0 || transmittingRef.current) return
    const cue = liveTextCues[liveTextIndex + direction]
    if (cue) void updateStage(present(cue, stage.revision))
  }

  function goLive() {
    if (queued && next) void send(queued, true)
  }

  function takeCue(id: string) {
    const cue = sequence.find(item => item.id === id)
    if (cue) void send(cue, true)
  }

  function showAdjacentVerse(verse: PassageVerse) {
    const cue = stage.cue
    if (cue?.kind !== 'scripture' || transmittingRef.current) return
    const updated = formatScriptureCue({
      ...cue,
      title: verseLabel(verse),
      reference: { translation: cue.reference.translation, book: verse.book.id, chapter: verse.chapter, verse: verse.verse },
    }, verse.text)
    void updateStage(present(updated, stage.revision))
  }

  async function toggleKiosk() {
    displayOperation.current++
    setDisplayBusy(true)
    try {
      if (kiosk) {
        await closeKiosk()
        displayInUse.current = null
        setKiosk(false)
      } else if (display) {
        await openKiosk(display.id)
        displayInUse.current = display.id
        setKiosk(true)
      }
    } catch (reason) {
      tell(errorText(reason), true)
    } finally {
      displayOperation.current++
      setDisplayBusy(false)
    }
  }

  async function updateStage(action: ReturnType<typeof present>) {
    try { await action }
    catch (reason) { tell(errorText(reason), true) }
  }

  function toggleBlackout() {
    void updateStage(setBlackout(!stage.blackout))
  }

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (event.altKey || event.metaKey || event.repeat || event.isComposing || event.defaultPrevented) return
      const target = event.target
      if (event.ctrlKey) {
        if (event.shiftKey || (editor && editor.kind !== 'choose')) return
        const action = libraryItems.find(item => item.shortcut === event.key.toUpperCase())
        if (!action) return
        event.preventDefault()
        const openMenu = target instanceof HTMLElement ? target.closest<HTMLDetailsElement>('details.menu') : null
        if (openMenu) openMenu.open = false
        openEditor(action.kind, editor?.kind === 'choose' ? editor.parent : active.id)
        return
      }
      if (editor || (target instanceof HTMLElement && target.closest('input, textarea, select, button, summary, [contenteditable]'))) return
      if (event.key === 'ArrowUp' && (index > 0 || index < 0)) { event.preventDefault(); nudge(-1) }
      if (event.key === 'ArrowDown') { event.preventDefault(); nudge(1) }
      if (event.key === 'Enter' && queued && next) { event.preventDefault(); goLive() }
      if (event.key.toLowerCase() === 'b') toggleBlackout()
    }

    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })

  function addItem(parent: string, item: Item, rootId = active.id) {
    const root = project.playlists.find(playlist => playlist.id === rootId)
    const path = root && playlistPath(root, parent)
    if (!path) {
      tell('The destination playlist is unavailable.', true)
      return
    }
    updatePlaylist(root => updateGroup(root, parent, group => ({ ...group, children: [...group.children, item] })), rootId)
    if (parent !== rootId || item.kind === 'text') {
      setExpanded(current => new Set([...current, ...path.slice(1), ...(item.kind === 'text' ? [item.id] : [])]))
    }
    if (item.kind !== 'playlist') setCueId(flatten([item])[0]?.id ?? null)
    setEditor(null)
  }

  function saveItem(parent: string, item: Item, existing?: Item) {
    if (!existing) { addItem(parent, item); return }
    updatePlaylist(root => updateGroup(root, parent, group => ({
      ...group, children: group.children.map(child => child.id === item.id ? item : child),
    })))
    if (item.kind === 'text' && existing.kind === 'text') {
      setExpanded(current => new Set(current).add(item.id))
      const oldIndex = textSlideCues(existing).findIndex(cue => cue.id === cueId)
      const cues = textSlideCues(item)
      if (oldIndex >= 0 && !cues.some(cue => cue.id === cueId)) {
        setCueId(cues[Math.min(oldIndex, cues.length - 1)]?.id ?? null)
      }
    }
    setEditor(null)
  }

  function createSlideLibrary(parent: string, name: string) {
    if (!loaded) return saveError || 'Wait for the workspace to finish loading.'
    const folder = normalizeTextSlideFolder(name)
    if (!folder) return 'Enter a library name.'
    if (project.slideLibraries.some(path => path.toLocaleLowerCase() === folder.toLocaleLowerCase())) {
      return 'A slide library with this name already exists.'
    }
    setProject(current => ({ ...current, slideLibraries: [...current.slideLibraries, folder] }))
    setEditor({ kind: 'text-library', parent, folder })
  }

  function saveLibraryTextSlide(parent: string, slide: TextSlide, folder: string) {
    if (!project.slideLibraries.includes(folder)) return 'This slide library is unavailable.'
    setProject(current => ({
      ...current,
      textLibrary: [...current.textLibrary.filter(item => item.slide.id !== slide.id), { folder, slide }],
    }))
    setEditor({ kind: 'text-library', parent, selectedId: slide.id })
  }

  async function addSource() {
    const source = await pickFolder()
    if (source) {
      setProject(current => current.sources.some(item => item.path === source.path)
        ? current
        : { ...current, sources: [...current.sources, source] })
    }
  }

  function addSourceFromSidebar() {
    void addSource().catch(reason => tell(errorText(reason), true))
  }

  function openEditor(kind: AddCueKind, parent: string) {
    if (kind === 'video' || kind === 'audio') {
      setEditor({ kind: 'media', parent, filter: kind })
      return
    }
    setEditor({ kind: kind === 'text' ? 'text-library' : kind, parent })
  }

  function cueMenuItems(parent: string, className?: string) {
    return cueActions.map(({ kind, label, shortcut }) => (
      <button type="button" key={kind} className={className} onClick={() => openEditor(kind, parent)}
        aria-keyshortcuts={shortcut ? `Control+${shortcut}` : undefined}>
        {kind === 'media' ? <LibraryBig size={16} aria-hidden="true" /> : <ItemIcon kind={kind} size={14} />}
        {label}
        {shortcut && <kbd className="cue-shortcut" aria-hidden="true">Ctrl+{shortcut}</kbd>}
      </button>
    ))
  }

  function editItem(item: Item, parent: string) {
    if (item.kind === 'text' || item.kind === 'scripture') {
      if (item.kind === 'text') setEditor({ kind: 'text', parent, existing: item })
      else setEditor({ kind: 'scripture', parent, existing: item })
    } else setEditor({ kind: 'rename', parent, existing: item })
  }

  function moveItem(parent: string, index: number, direction: -1 | 1) {
    updatePlaylist(root => updateGroup(root, parent, group => {
      const children = [...group.children]
      const destination = index + direction
      if (destination < 0 || destination >= children.length) return group
      const item = children[index]
      children.splice(index, 1)
      children.splice(destination, 0, item)
      return { ...group, children }
    }))
  }

  function removeItem(item: Item, parent: string | null) {
    if (!parent) {
      const remaining = project.playlists.filter(root => root.id !== item.id)
      if (!remaining.length) return
      setProject(current => ({ ...current, playlists: remaining, activeId: remaining[0].id }))
      setCueId(flatten(remaining[0].children)[0]?.id ?? null)
    } else {
      const removedSelected = flatten([item]).some(cue => cue.id === cueId)
      const withoutItem = (root: Group) => updateGroup(root, parent, group => ({
        ...group, children: group.children.filter(child => child.id !== item.id),
      }))
      updatePlaylist(withoutItem)
      if (removedSelected) setCueId(flatten(withoutItem(active).children)[index]?.id ?? null)
    }
    setEditor(null)
  }

  function addPlaylist(name: string, parent: string | null) {
    const group: Group = { id: crypto.randomUUID(), kind: 'playlist', title: name, children: [] }
    if (parent) { addItem(parent, group); return }
    setProject(current => ({ ...current, playlists: [...current.playlists, group], activeId: group.id }))
    setCueId(null)
    setEditor(null)
  }

  function rename(item: Item, parent: string | null, title: string) {
    if (parent) {
      updatePlaylist(root => updateGroup(root, parent, group => ({
        ...group, children: group.children.map(child => child.id === item.id ? { ...child, title } : child),
      })))
    } else {
      updatePlaylist(root => ({ ...root, title }))
    }
    setEditor(null)
  }

  const title = editor?.kind === 'playlist' ? (editor.parent ? 'New nested playlist' : 'New playlist')
    : editor?.kind === 'rename' ? `Rename ${editor.existing.kind === 'playlist' ? 'playlist' : 'cue'}`
    : editor?.kind === 'text' ? (editor.existing ? 'Edit text slide' : 'New one-off text slide')
    : editor?.kind === 'text-library' ? 'Text slide library'
    : editor?.kind === 'new-slide-library' ? 'New slide library'
    : editor?.kind === 'library-text' ? (editor.existing ? 'Edit saved text slide' : 'New text slide')
    : editor?.kind === 'scripture' ? (editor.existing ? 'Edit scripture cue' : 'Bible lookup')
    : editor?.kind === 'media' ? 'Add Media'
    : editor?.kind === 'kiosk-background' ? 'Kiosk background'
    : editor?.kind === 'remove' ? 'Remove from workspace'
    : 'Add cue'

  const sidebarAction = sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'

  return (
    <div className="studio-shell">
      <header className="appbar">
        <div className="playlist-controls" role="group" aria-label="Workspace controls">
          <button type="button" className="icon-button" aria-label={sidebarAction} title={sidebarAction}
            aria-controls="studio-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(open => !open)}>
            {sidebarOpen ? <PanelLeftClose size={17} aria-hidden="true" /> : <PanelLeftOpen size={17} aria-hidden="true" />}
          </button>
          <Menu primary label="Add cue" trigger={<><Plus size={17} /> Add cue <ChevronDown size={15} /></>}>
            {cueMenuItems(active.id)}
          </Menu>
          <Menu label="Playlist actions" trigger={<Ellipsis size={19} />}>
            <button onClick={() => setEditor({ kind: 'rename', parent: null, existing: active })}><Pencil size={15} /> Rename playlist</button>
            <button className="danger" disabled={project.playlists.length < 2} onClick={() => setEditor({ kind: 'remove', parent: null, item: active })}><Trash2 size={15} /> Remove playlist</button>
          </Menu>
        </div>
        <div className="display-controls" role="group" aria-label="Kiosk controls">
          <div className="display-select">
            <Monitor size={16} />
            <select aria-label="Kiosk display" title={display ? `${display.width} × ${display.height}` : 'Audience display'} value={display?.id ?? ''} disabled={kiosk || displayBusy} onChange={event => {
              const displayId = event.target.value
              setProject(current => ({ ...current, displayId }))
            }}>
              {!displayList.length && <option value="">No displays</option>}
              {displayList.map((monitor, i) => <option value={monitor.id} key={monitor.id}>
                {desktop ? `Display ${i + 1} · ${monitor.name}${monitor.studio ? ' (Studio)' : ''}` : 'Display 1 · Preview'}
              </option>)}
            </select>
            <ChevronDown size={13} />
          </div>
          <button type="button" className="icon-button" aria-label="Kiosk background" title="Kiosk background"
            onClick={() => setEditor({ kind: 'kiosk-background' })}><ImageIcon size={17} aria-hidden="true" /></button>
          <button className={`button kiosk-button${kiosk ? ' kiosk-button--open' : ''}`} onClick={() => void toggleKiosk()} disabled={!display || displayBusy}>
            {kiosk ? <MonitorOff size={16} /> : <Play size={15} />} {kiosk ? 'Close Kiosk' : 'Launch Kiosk'}
          </button>
          <button type="button" className="icon-button settings-button" aria-label="Settings" title="Settings" aria-haspopup="dialog"
            onClick={() => setEditor({ kind: 'settings' })}><Settings size={17} aria-hidden="true" /></button>
        </div>
      </header>

      <div className="workspace">
        <aside id="studio-sidebar" className="sidebar" aria-label="Playlists, sources, and slides" hidden={!sidebarOpen}>
          <div className="sidebar-content">
            <section className="sidebar-section">
              <div className="sidebar-heading"><h2>Playlists</h2><button className="icon-button" title="New playlist" aria-label="New playlist" onClick={() => setEditor({ kind: 'playlist', parent: null })}><Plus size={17} /></button></div>
              {project.playlists.map(list => (
                <button className={`sidebar-item playlist-link${active.id === list.id ? ' sidebar-item--active' : ''}`} key={list.id} onClick={() => selectPlaylist(list)} aria-current={active.id === list.id ? 'true' : undefined}>
                  <ListMusic size={17} /><span>{list.title}</span><span className="playlist-count">{flatten(list.children).length}</span>
                </button>
              ))}
            </section>
            <section className="sidebar-section">
              <div className="sidebar-heading"><h2>Library</h2></div>
              {libraryItems.map(({ kind, label, shortcut, icon: Icon }) => (
                <button type="button" key={kind} className="sidebar-item"
                  onClick={() => openEditor(kind, active.id)} aria-keyshortcuts={`Control+${shortcut}`}>
                  <Icon size={17} aria-hidden="true" /><span>{label}</span>
                  <kbd className="cue-shortcut" aria-hidden="true">Ctrl+{shortcut}</kbd>
                </button>
              ))}
            </section>
            <section className="sidebar-section sidebar-section--media-sources">
              <div className="sidebar-heading"><h2>Media sources</h2><button className="icon-button" title="Add source folder" aria-label="Add source folder" onClick={addSourceFromSidebar}><Plus size={17} /></button></div>
              {project.sources.map(source => (
                <div className="source-row" key={source.id}>
                  <div className="sidebar-item" title={source.path}><FolderOpen size={16} /><span>{source.name}</span></div>
                  <button className="icon-button" title="Remove source folder" aria-label={`Remove source ${source.name}`} onClick={() => setProject(current => ({
                    ...current, sources: current.sources.filter(item => item.id !== source.id),
                  }))}><X size={14} /></button>
                </div>
              ))}
              {!project.sources.length && <button className="add-folder" onClick={addSourceFromSidebar}><FolderPlus size={16} /> Add a folder</button>}
            </section>
            <section className="sidebar-section sidebar-section--slides" aria-labelledby="slide-libraries-heading">
              <div className="sidebar-heading">
                <h2 id="slide-libraries-heading">Slides</h2>
                <button type="button" className="icon-button" title="New slide library" aria-label="New slide library"
                  onClick={() => setEditor({ kind: 'new-slide-library', parent: active.id })}><Plus size={17} /></button>
              </div>
              {[...project.slideLibraries].sort((a, b) => a.localeCompare(b)).map(folder => (
                <button type="button" key={folder} className="sidebar-item" title={folder}
                  onClick={() => setEditor({ kind: 'text-library', parent: active.id, folder })}>
                  <FolderOpen size={17} aria-hidden="true" /><span>{folder}</span>
                </button>
              ))}
              {!project.slideLibraries.length && (
                <button type="button" className="add-folder" onClick={() => setEditor({ kind: 'new-slide-library', parent: active.id })}>
                  <FolderPlus size={16} aria-hidden="true" /> New library
                </button>
              )}
            </section>
          </div>
          <div className="sidebar-foot">
            <span className={`engine-light${kiosk ? ' engine-light--active' : ''}`} />
            <span>{kiosk ? 'Kiosk connected' : 'Kiosk on standby'}</span>
          </div>
        </aside>

        <main className="main">
          <div className="main-inner">
            <Preview
              stage={stage} standby={showStandby ? welcomePreview : null} background={background?.url} next={next} nextTitle={queued?.title}
              nextError={resolved?.item === queued ? resolved?.error ?? '' : ''}
              kiosk={kiosk} busy={transmitting} canGoLive={!!queued && !!next}
              hasPrevious={index > 0 || (index < 0 && sequence.length > 0)} hasNext={index >= 0 && index < sequence.length - 1}
              onPrevious={() => nudge(-1)} onNext={() => nudge(1)} onGoLive={goLive}
              onBlackout={toggleBlackout}
              onNavigateVerse={showAdjacentVerse}
              textNavigation={liveTextIndex >= 0 && liveTextCues.length > 1 ? {
                index: liveTextIndex, total: liveTextCues.length, onMove: showAdjacentTextSlide,
              } : undefined}
              onPlayback={action => void updateStage(controlPlayback(stage.revision, action))}
            />

            {(saveError || stage.error) && <div className="problem" role="alert"><CircleAlert size={17} /> {saveError || stage.error}</div>}

            <section className="cue-section" aria-labelledby="cues-heading">
              <header>
                <h2 id="cues-heading">Cue list</h2>
              </header>
              <div className="cue-scroll">
                <CueList root={active} selectedId={cueId} expanded={expanded}
                  current={stage.cue ? {
                    id: stage.cue.id,
                    status: stage.blackout ? 'Blackout' : kiosk ? 'Live' : 'Staged',
                  } : null}
                  onToggle={id => setExpanded(current => {
                    const next = new Set(current)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })}
                  onCue={cueItem} onGoLive={takeCue} onEdit={editItem} onMove={moveItem}
                  onAdd={parent => setEditor({ kind: 'choose', parent })}
                  onRemove={(item, parent) => setEditor({ kind: 'remove', parent, item })}
                />
              </div>
            </section>
          </div>
        </main>
      </div>

      {notice && <div className={`toast${notice.error ? ' toast--error' : ''}`} role={notice.error ? 'alert' : 'status'}>
        {notice.error ? <CircleAlert size={17} /> : <Monitor size={17} />}<span>{notice.text}</span>
        <button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={16} /></button>
      </div>}

      {editor?.kind === 'settings' && <SettingsDialog onClose={() => setEditor(null)} />}
      {editor && editor.kind !== 'settings' && <Dialog key={editor.kind} title={title} wide={editor.kind === 'media' || editor.kind === 'scripture' || editor.kind === 'text-library'} onClose={() => setEditor(null)}>
        {editor.kind === 'choose' && <div className="add-cue-options">
          {cueMenuItems(editor.parent, 'button')}
        </div>}
        {editor.kind === 'playlist' && <NameEditor label="Playlist name" action="Create playlist" onSave={name => addPlaylist(name, editor.parent)} />}
        {editor.kind === 'rename' && <NameEditor label="Name" action="Save changes" existing={editor.existing} onSave={name => rename(editor.existing, editor.parent, name)} />}
        {editor.kind === 'text-library' && (
          <TextSlideLibrary items={project.textLibrary} libraries={project.slideLibraries} playlists={project.playlists} parent={editor.parent}
            selectedId={editor.selectedId} initialFolder={editor.folder} busy={transmitting}
            saving={loaded && !saveError && (persistedTextLibrary !== project.textLibrary || persistedSlideLibraries !== project.slideLibraries)}
            error={saveError}
            onCreateLibrary={() => setEditor({ kind: 'new-slide-library', parent: editor.parent })}
            onCreateOneOff={() => setEditor({ kind: 'text', parent: editor.parent })}
            onCreate={folder => setEditor({ kind: 'library-text', parent: editor.parent, folder })}
            onEdit={item => setEditor({ kind: 'library-text', parent: editor.parent, folder: item.folder, existing: item.slide })}
            onAdd={(item, parent, root) => addItem(parent, copyLibraryTextSlide(item), root)}
            onLive={item => sendTextSlide(copyLibraryTextSlide(item))} />
        )}
        {editor.kind === 'new-slide-library' && (
          <NameEditor label="Library name" action="Create library" onSave={name => createSlideLibrary(editor.parent, name)} />
        )}
        {editor.kind === 'text' && (
          <TextEditor existing={editor.existing} busy={transmitting}
            onSave={slide => saveItem(editor.parent, slide, editor.existing)}
            onLive={editor.existing ? undefined : sendTextSlide} />
        )}
        {editor.kind === 'library-text' && (
          <TextEditor existing={editor.existing} library={{
            folder: editor.folder,
            onBack: () => setEditor({ kind: 'text-library', parent: editor.parent, folder: editor.folder, selectedId: editor.existing?.id }),
            onSave: slide => saveLibraryTextSlide(editor.parent, slide, editor.folder),
          }} />
        )}
        {editor.kind === 'scripture' && <ScriptureEditor existing={editor.existing} busy={transmitting} onSave={cue => saveItem(editor.parent, cue, editor.existing)} onLive={cue => void send(cue, false)} />}
        {editor.kind === 'media' && <MediaBrowser sources={project.sources} initialFilter={editor.filter}
          view={mediaView} onViewChange={setMediaView} onAddFolder={addSource} busy={transmitting}
          onSave={file => addItem(editor.parent, mediaCue(file))} onLive={file => void send(mediaCue(file), false)}
        />}
        {editor.kind === 'kiosk-background' && <KioskBackgroundEditor background={background} loadError={backgroundError} />}
        {editor.kind === 'remove' && <div className="editor">
          <p>Remove <strong>{editor.item.title}</strong>{editor.item.kind === 'text' ? ' and its slides' : editor.item.kind === 'playlist' && editor.item.children.length ? ' and its cues' : ''}?</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setEditor(null)}>Cancel</button>
            <button className="button button-danger" onClick={() => removeItem(editor.item, editor.parent)}>Remove</button>
          </div>
        </div>}
      </Dialog>}
    </div>
  )
}
