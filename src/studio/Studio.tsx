import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  BookOpen, ChevronDown, CircleAlert, Ellipsis, FolderOpen, FolderPlus, Image as ImageIcon, LibraryBig, ListMusic,
  Monitor, MonitorOff, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plus, Settings, Trash2, Type, X,
} from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError, type Message } from '../shared/messages'
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
import { MediaBrowser, type MediaFilter, type MediaView } from './MediaBrowser'
import { TextSlideLibrary } from './TextSlideLibrary'
import { Preview } from './Preview'
import { SettingsDialog } from './Settings'
import { useCueDrag, type CueDropTarget } from './useCueDrag'

type Editor =
  | { kind: 'settings' }
  | { kind: 'kiosk-background' }
  | { kind: 'choose'; parent: string }
  | { kind: 'playlist'; parent: string | null }
  | { kind: 'rename'; parent: string | null; existing: Item }
  | { kind: 'remove'; parent: string | null; item: Item }

type AddCueKind = ItemKind | 'media'
type ToolTab = 'media' | 'scripture' | 'text'
type WorkspaceTab = 'cues' | ToolTab
type TextPanel =
  | { kind: 'library' }
  | { kind: 'new-library' }
  | { kind: 'saved-slide'; folder: string; existing?: TextSlide }
  | { kind: 'cue'; existing?: TextSlide }

const workspaceTabs = [
  { id: 'cues', label: 'Cue List', icon: ListMusic },
  { id: 'media', label: 'Media', icon: LibraryBig, shortcut: 'M' },
  { id: 'scripture', label: 'Bible lookup', icon: BookOpen, shortcut: 'B' },
  { id: 'text', label: 'Text slides', icon: Type, shortcut: 'T' },
] satisfies readonly { id: WorkspaceTab; label: Message; icon: typeof Type; shortcut?: string }[]

const libraryActions = {
  media: { kind: 'media', label: 'Add Media', shortcut: 'M' },
  scripture: { kind: 'scripture', label: 'Bible lookup', shortcut: 'B' },
  text: { kind: 'text', label: kindNames.text, shortcut: 'T' },
} as const

const libraryItems = Object.values(libraryActions)
const cueActions: readonly { kind: AddCueKind; label: Message; shortcut?: string }[] = [
  libraryActions.text, libraryActions.scripture, libraryActions.media,
  { kind: 'video', label: kindNames.video },
  { kind: 'audio', label: kindNames.audio },
  { kind: 'playlist', label: kindNames.playlist },
]

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function playlistPath(root: Group, target: string): Group[] | undefined {
  if (root.id === target) return [root]
  for (const item of root.children) {
    if (item.kind !== 'playlist') continue
    const path = playlistPath(item, target)
    if (path) return [root, ...path]
  }
}

export default function Studio() {
  const { language, t } = useLanguage()
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
  const [tab, setTab] = useState<WorkspaceTab>('cues')
  const [destinations, setDestinations] = useState<Partial<Record<ToolTab, string>>>({})
  const [scriptureEdit, setScriptureEdit] = useState<ScriptureCue>()
  const [bibleSettingsRevision, setBibleSettingsRevision] = useState(0)
  const [textPanel, setTextPanel] = useState<TextPanel>({ kind: 'library' })
  const [libraryLocation, setLibraryLocation] = useState<{ revision: number; folder?: string; selectedId?: string }>({ revision: 0 })
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const workspaceTabList = useRef<HTMLDivElement>(null)
  const [mediaView, setMediaView] = useState<MediaView>('list')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [transmitting, setTransmitting] = useState(false)
  const transmittingRef = useRef(false)
  const saves = useRef(Promise.resolve())
  const displayInUse = useRef<string | null>(null)
  const displayOperation = useRef(0)
  const drag = useCueDrag(dropCue)

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
  const firstCue = sequence[0]
  const standby = !kiosk && stage.revision === 0 && !stage.cue && !desktop
    && active.id === 'sunday' && queued?.id !== welcomePreview.id
    && firstCue?.kind === 'text' && firstCue.id === welcomePreview.id ? firstCue : null

  const mediaTarget = toolDestination('media')
  const scriptureTarget = toolDestination('scripture')
  const textTarget = toolDestination('text')

  function toolDestination(tool: ToolTab) {
    const parent = destinations[tool]
    return parent && parent !== active.id ? playlistPath(active, parent)?.at(-1) ?? active : active
  }

  function activateTab(nextTab: WorkspaceTab, focusInput = false) {
    setTab(nextTab)
    const focusTab = () => workspaceTabList.current?.querySelector<HTMLButtonElement>(`#workspace-tab-${nextTab}`)?.focus()
    if (!focusInput) {
      focusTab()
      return
    }
    // Allow an open menu or cue chooser to finish closing before moving focus.
    window.requestAnimationFrame(() => {
      const panel = document.getElementById(`workspace-panel-${nextTab}`)
      const input = Array.from(panel?.querySelectorAll<HTMLElement>('[autofocus]') ?? [])
        .find(element => !element.closest('[hidden]') && !element.matches(':disabled'))
      if (input) input.focus()
      else focusTab()
    })
  }

  function navigateTabs(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const index = workspaceTabs.findIndex(item => item.id === tab)
    const last = workspaceTabs.length - 1
    const next = event.key === 'ArrowRight' ? (index + 1) % workspaceTabs.length
      : event.key === 'ArrowLeft' ? (index + last) % workspaceTabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last : undefined
    if (next === undefined) return
    event.preventDefault()
    activateTab(workspaceTabs[next].id)
  }

  function showCueList() {
    setDestinations({})
    setScriptureEdit(undefined)
    if (textPanel.kind === 'cue' && textPanel.existing) setTextPanel({ kind: 'library' })
    setTab('cues')
  }

  function showLibrary(folder?: string, selectedId?: string) {
    setLibraryLocation(current => ({ revision: current.revision + 1, folder, selectedId }))
    setTextPanel({ kind: 'library' })
  }

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
    if (root.id !== active.id) showCueList()
    else setTab('cues')
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

  async function send(item: Cue, mode: 'advance' | 'keep-queue', textCues: TextCue[] = []) {
    if (transmittingRef.current) return
    transmittingRef.current = true
    setTransmitting(true)
    try {
      const cue = await resolveCue(item)
      await present(cue)
      setLiveTextCues(textCues)
      if (mode === 'advance') {
        const currentIndex = sequence.findIndex(candidate => candidate.id === item.id)
        setCueId(current => current === item.id ? sequence[currentIndex + 1]?.id ?? null : current)
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
    if (cues.length) void send(cues[0], 'keep-queue', cues)
  }

  function showAdjacentTextSlide(direction: -1 | 1) {
    if (liveTextIndex < 0 || transmittingRef.current) return
    const cue = liveTextCues[liveTextIndex + direction]
    if (cue) void updateStage(present(cue, stage.revision))
  }

  function goLive() {
    if (queued && next) void send(queued, 'advance')
  }

  function takeCue(id: string) {
    const cue = sequence.find(item => item.id === id)
    if (cue) void send(cue, 'advance')
  }

  function dropCue(id: string, destination: CueDropTarget) {
    const cue = sequence.find(item => item.id === id)
    if (!cue) return
    if (destination === 'live') void send(cue, 'keep-queue')
    else cueItem(cue.id)
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
        if (editor?.kind === 'choose') openCueTool(action.kind, editor.parent)
        else activateTab(action.kind, true)
        return
      }
      if (editor || (target instanceof HTMLElement && target.closest('input, textarea, select, button, summary, [contenteditable]'))) return
      if (tab === 'cues') {
        if (event.key === 'ArrowUp' && (index > 0 || index < 0)) { event.preventDefault(); nudge(-1) }
        if (event.key === 'ArrowDown') { event.preventDefault(); nudge(1) }
        if (event.key === 'Enter' && queued && next) { event.preventDefault(); goLive() }
      }
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
      setExpanded(current => new Set([...current, ...path.slice(1).map(group => group.id), ...(item.kind === 'text' ? [item.id] : [])]))
    }
    if (item.kind !== 'playlist') setCueId(flatten([item])[0]?.id ?? null)
    return true
  }

  function addWorkspaceItem(parent: string, item: Item, rootId = active.id) {
    if (!addItem(parent, item, rootId)) return
    if (rootId !== active.id) {
      setDestinations({})
      setScriptureEdit(undefined)
    }
    tell(t('Added “{name}” to playlist.', { name: item.title }))
  }

  function finishCueEdit(tool: 'text' | 'scripture') {
    if (tool === 'text') setTextPanel({ kind: 'library' })
    else setScriptureEdit(undefined)
    setDestinations(current => ({ ...current, [tool]: undefined }))
    activateTab('cues')
  }

  function saveItem(parent: string, item: TextSlide | ScriptureCue, existing: TextSlide | ScriptureCue) {
    updatePlaylist(root => updateGroup(root, parent, group => ({
      ...group, children: group.children.map(child => child.id === item.id ? item : child),
    })))
    const previousTextCues = existing.kind === 'text' ? textSlideCues(existing) : []
    if (item.kind === 'text') {
      setExpanded(current => new Set(current).add(item.id))
      const oldIndex = previousTextCues.findIndex(cue => cue.id === cueId)
      const cues = textSlideCues(item)
      if (oldIndex >= 0 && !cues.some(cue => cue.id === cueId)) {
        setCueId(cues[Math.min(oldIndex, cues.length - 1)]?.id ?? null)
      }
    }

    const shown = stage.cue
    if (item.theme !== existing.theme && shown?.kind === item.kind
      && (shown.id === item.id || previousTextCues.some(cue => cue.id === shown.id))) {
      void updateStage(present({ ...shown, theme: item.theme }, stage.revision))
    }
    finishCueEdit(item.kind)
  }

  function createSlideLibrary(name: string) {
    if (!loaded) return saveError || t('Wait for the workspace to finish loading.')
    const folder = normalizeTextSlideFolder(name)
    if (!folder) return t('Enter a library name.')
    if (project.slideLibraries.some(path => path.toLocaleLowerCase() === folder.toLocaleLowerCase())) {
      return t('A slide library with this name already exists.')
    }
    setProject(current => ({ ...current, slideLibraries: [...current.slideLibraries, folder] }))
    showLibrary(folder)
  }

  function saveLibraryTextSlide(slide: TextSlide, folder: string) {
    if (!project.slideLibraries.includes(folder)) return t('This slide library is unavailable.')
    setProject(current => ({
      ...current,
      textLibrary: [...current.textLibrary.filter(item => item.slide.id !== slide.id), { folder, slide }],
    }))
    showLibrary(folder, slide.id)
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

  function openCueTool(kind: AddCueKind, parent: string) {
    if (kind === 'playlist') {
      setEditor({ kind, parent })
      return
    }
    const tool = kind === 'video' || kind === 'audio' ? 'media' : kind
    setEditor(null)
    setDestinations(current => ({ ...current, [tool]: parent }))
    if (tool === 'media') setMediaFilter(kind === 'video' || kind === 'audio' ? kind : 'all')
    if (tool === 'scripture') setScriptureEdit(undefined)
    if (tool === 'text') setTextPanel({ kind: 'library' })
    activateTab(tool, true)
  }

  function cueMenuItems(parent: string, className?: string) {
    return cueActions.map(({ kind, label, shortcut }) => (
      <button type="button" key={kind} className={className} onClick={() => openCueTool(kind, parent)}
        aria-keyshortcuts={shortcut ? `Control+${shortcut}` : undefined}>
        {kind === 'media' ? <LibraryBig size={16} aria-hidden="true" /> : <ItemIcon kind={kind} size={14} />}
        {t(label)}
        {shortcut && <kbd className="cue-shortcut" aria-hidden="true">Ctrl+{shortcut}</kbd>}
      </button>
    ))
  }

  function editItem(item: Item, parent: string) {
    if (item.kind === 'text' || item.kind === 'scripture') {
      setDestinations(current => ({ ...current, [item.kind]: parent }))
      if (item.kind === 'text') setTextPanel({ kind: 'cue', existing: item })
      else setScriptureEdit(item)
      activateTab(item.kind, true)
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
      showCueList()
    } else {
      const removedSelected = flatten([item]).some(cue => cue.id === cueId)
      const withoutItem = (root: Group) => updateGroup(root, parent, group => ({
        ...group, children: group.children.filter(child => child.id !== item.id),
      }))
      const updated = withoutItem(active)
      const containsCue = (destination: Group, id: string) =>
        playlistPath(updated, destination.id)?.at(-1)?.children.some(child => child.id === id)
      if (scriptureEdit && !containsCue(scriptureTarget, scriptureEdit.id)) setScriptureEdit(undefined)
      if (textPanel.kind === 'cue' && textPanel.existing && !containsCue(textTarget, textPanel.existing.id)) {
        setTextPanel({ kind: 'library' })
      }
      updatePlaylist(withoutItem)
      if (removedSelected) setCueId(flatten(updated.children)[index]?.id ?? null)
    }
    setEditor(null)
  }

  function addPlaylist(name: string, parent: string | null) {
    const group: Group = { id: crypto.randomUUID(), kind: 'playlist', title: name, children: [] }
    if (parent) {
      if (addItem(parent, group)) setEditor(null)
      return
    }
    setProject(current => ({ ...current, playlists: [...current.playlists, group], activeId: group.id }))
    setCueId(null)
    showCueList()
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

  const title = editor?.kind === 'playlist' ? (editor.parent ? t('New nested playlist') : t('New playlist'))
    : editor?.kind === 'rename' ? t(editor.existing.kind === 'playlist' ? 'Rename playlist' : 'Rename cue')
    : editor?.kind === 'kiosk-background' ? t('Kiosk background')
    : editor?.kind === 'remove' ? t('Remove from workspace')
    : t('Add cue')

  const sidebarAction = sidebarOpen ? t('Collapse sidebar') : t('Expand sidebar')

  return (
    <div className={`studio-shell${drag.preview ? ' studio-shell--dragging' : ''}`} {...drag.handlers}>
      <header className="appbar">
        <div className="playlist-controls" role="group" aria-label={t('Workspace controls')}>
          <button type="button" className="icon-button" aria-label={sidebarAction} title={sidebarAction}
            aria-controls="studio-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(open => !open)}>
            {sidebarOpen ? <PanelLeftClose size={17} aria-hidden="true" /> : <PanelLeftOpen size={17} aria-hidden="true" />}
          </button>
          <Menu primary label={t('Add cue')} trigger={<><Plus size={17} /> {t('Add cue')} <ChevronDown size={15} /></>}>
            {cueMenuItems(active.id)}
          </Menu>
          <Menu label={t('Playlist actions')} trigger={<Ellipsis size={19} />}>
            <button onClick={() => setEditor({ kind: 'rename', parent: null, existing: active })}><Pencil size={15} /> {t('Rename playlist')}</button>
            <button className="danger" disabled={project.playlists.length < 2} onClick={() => setEditor({ kind: 'remove', parent: null, item: active })}><Trash2 size={15} /> {t('Remove playlist')}</button>
          </Menu>
        </div>
        <div className="display-controls" role="group" aria-label={t('Kiosk controls')}>
          <div className="display-select">
            <Monitor size={16} />
            <select aria-label={t('Kiosk display')} title={display ? `${display.width} × ${display.height}` : t('Audience display')} value={display?.id ?? ''} disabled={kiosk || displayBusy} onChange={event => {
              const displayId = event.target.value
              setProject(current => ({ ...current, displayId }))
            }}>
              {!displayList.length && <option value="">{t('No displays')}</option>}
              {displayList.map((monitor, i) => <option value={monitor.id} key={monitor.id}>
                {desktop ? t(monitor.studio ? 'Display {number} · {name} (Studio)' : 'Display {number} · {name}', {
                  number: i + 1, name: monitor.name === 'Unnamed display' ? t('Unnamed display') : monitor.name,
                }) : t('Display 1 · Preview')}
              </option>)}
            </select>
            <ChevronDown size={13} />
          </div>
          <button type="button" className="icon-button" aria-label={t('Kiosk background')} title={t('Kiosk background')}
            onClick={() => setEditor({ kind: 'kiosk-background' })}><ImageIcon size={17} aria-hidden="true" /></button>
          <button className={`button kiosk-button${kiosk ? ' kiosk-button--open' : ''}`} onClick={() => void toggleKiosk()} disabled={!display || displayBusy}>
            {kiosk ? <MonitorOff size={16} /> : <Play size={15} />} {kiosk ? t('Close Kiosk') : t('Launch Kiosk')}
          </button>
          <button type="button" className="icon-button settings-button" aria-label={t('Settings')} title={t('Settings')} aria-haspopup="dialog"
            onClick={() => setEditor({ kind: 'settings' })}><Settings size={17} aria-hidden="true" /></button>
        </div>
      </header>

      <div className="workspace">
        <aside id="studio-sidebar" className="sidebar" aria-label={t('Playlists, sources, and slides')} hidden={!sidebarOpen}>
          <div className="sidebar-content">
            <section className="sidebar-section">
              <div className="sidebar-heading"><h2>{t('Playlists')}</h2><button className="icon-button" title={t('New playlist')} aria-label={t('New playlist')} onClick={() => setEditor({ kind: 'playlist', parent: null })}><Plus size={17} /></button></div>
              {project.playlists.map(list => (
                <button className={`sidebar-item playlist-link${active.id === list.id ? ' sidebar-item--active' : ''}`} key={list.id} onClick={() => selectPlaylist(list)} aria-current={active.id === list.id ? 'true' : undefined}>
                  <ListMusic size={17} /><span>{list.title}</span><span className="playlist-count">{flatten(list.children).length}</span>
                </button>
              ))}
            </section>
            <section className="sidebar-section sidebar-section--media-sources">
              <div className="sidebar-heading"><h2>{t('Media sources')}</h2><button className="icon-button" title={t('Add source folder')} aria-label={t('Add source folder')} onClick={addSourceFromSidebar}><Plus size={17} /></button></div>
              {project.sources.map(source => (
                <div className="source-row" key={source.id}>
                  <div className="sidebar-item" title={source.path}><FolderOpen size={16} /><span>{source.name}</span></div>
                  <button className="icon-button" title={t('Remove source folder')} aria-label={t('Remove source {name}', { name: source.name })} onClick={() => setProject(current => ({
                    ...current, sources: current.sources.filter(item => item.id !== source.id),
                  }))}><X size={14} /></button>
                </div>
              ))}
              {!project.sources.length && <button className="add-folder" onClick={addSourceFromSidebar}><FolderPlus size={16} /> {t('Add a folder')}</button>}
            </section>
            <section className="sidebar-section sidebar-section--slides" aria-labelledby="slide-libraries-heading">
              <div className="sidebar-heading">
                <h2 id="slide-libraries-heading">{t('Slides')}</h2>
                <button type="button" className="icon-button" title={t('New slide library')} aria-label={t('New slide library')}
                  onClick={() => { setTextPanel({ kind: 'new-library' }); activateTab('text', true) }}><Plus size={17} /></button>
              </div>
              {[...project.slideLibraries].sort((a, b) => a.localeCompare(b, language)).map(folder => (
                <button type="button" key={folder} className="sidebar-item" title={folder}
                  onClick={() => { showLibrary(folder); activateTab('text', true) }}>
                  <FolderOpen size={17} aria-hidden="true" /><span>{folder}</span>
                </button>
              ))}
              {!project.slideLibraries.length && (
                <button type="button" className="add-folder" onClick={() => { setTextPanel({ kind: 'new-library' }); activateTab('text', true) }}>
                  <FolderPlus size={16} aria-hidden="true" /> {t('New library')}
                </button>
              )}
            </section>
          </div>
          <div className="sidebar-foot">
            <span className={`engine-light${kiosk ? ' engine-light--active' : ''}`} />
            <span>{kiosk ? t('Kiosk connected') : t('Kiosk on standby')}</span>
          </div>
        </aside>

        <main className="main">
          <div className="main-inner">
            <Preview
              stage={stage} standby={standby} background={background?.url} next={next} nextTitle={queued?.title}
              nextError={resolved?.item === queued ? resolved?.error ?? '' : ''}
              kiosk={kiosk} busy={transmitting} canGoLive={!!queued && !!next}
              hasPrevious={index > 0 || (index < 0 && sequence.length > 0)} hasNext={index >= 0 && index < sequence.length - 1}
              onPrevious={() => nudge(-1)} onNext={() => nudge(1)} onGoLive={goLive}
              dropTarget={drag.preview?.target ?? null} onBlackout={toggleBlackout}
              onNavigateVerse={showAdjacentVerse}
              textNavigation={liveTextIndex >= 0 && liveTextCues.length > 1 ? {
                index: liveTextIndex, total: liveTextCues.length, onMove: showAdjacentTextSlide,
              } : undefined}
              onPlayback={action => void updateStage(controlPlayback(stage.revision, action))}
            />

            {(saveError || stage.error) && <div className="problem" role="alert"><CircleAlert size={17} /> {translateError(t, saveError || stage.error || '')}</div>}

            <div className="cue-workspace">
              <div className="workspace-tabs" role="tablist" aria-label={t('Presentation workspace')} ref={workspaceTabList} onKeyDown={navigateTabs}>
                {workspaceTabs.map(({ id, label, icon: Icon, shortcut }) => (
                  <button key={id} type="button" role="tab" id={`workspace-tab-${id}`} aria-controls={`workspace-panel-${id}`}
                    aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
                    aria-keyshortcuts={shortcut ? `Control+${shortcut}` : undefined} onClick={() => activateTab(id)}>
                    <Icon size={15} aria-hidden="true" /> {t(label)}
                  </button>
                ))}
              </div>
              <section id="workspace-panel-cues" role="tabpanel" aria-labelledby="workspace-tab-cues" className="cue-scroll"
                tabIndex={0} hidden={tab !== 'cues'}>
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
                  onCue={cueItem} onGoLive={takeCue} onCuePointerDown={drag.start} onEdit={editItem} onMove={moveItem}
                  onAdd={parent => setEditor({ kind: 'choose', parent })}
                  onRemove={(item, parent) => setEditor({ kind: 'remove', parent, item })}
                />
              </section>

              <section id="workspace-panel-media" role="tabpanel" aria-labelledby="workspace-tab-media" className="tool-panel"
                tabIndex={0} hidden={tab !== 'media'}>
                {mediaTarget !== active && <p className="workspace-context">{t('Adding to {name}', { name: mediaTarget.title })}</p>}
                <MediaBrowser sources={project.sources} filter={mediaFilter} onFilterChange={setMediaFilter}
                  view={mediaView} onViewChange={setMediaView} onAddFolder={addSource} busy={transmitting}
                  onSave={file => addWorkspaceItem(mediaTarget.id, mediaCue(file))} onLive={file => void send(mediaCue(file), 'keep-queue')} />
              </section>

              <section id="workspace-panel-scripture" role="tabpanel" aria-labelledby="workspace-tab-scripture" className="tool-panel"
                tabIndex={0} hidden={tab !== 'scripture'}>
                {scriptureEdit ? (
                  <>
                    <div className="workspace-context">
                      <h2>{t('Edit scripture cue')}</h2>
                      <button type="button" className="button" onClick={() => finishCueEdit('scripture')}>{t('Cancel')}</button>
                    </div>
                    <ScriptureEditor key={scriptureEdit.id} existing={scriptureEdit}
                      active={tab === 'scripture'} settingsRevision={bibleSettingsRevision} busy={transmitting}
                      onSave={cue => saveItem(scriptureTarget.id, cue, scriptureEdit)} onLive={cue => void send(cue, 'keep-queue')} />
                  </>
                ) : scriptureTarget !== active && <p className="workspace-context">{t('Adding to {name}', { name: scriptureTarget.title })}</p>}
                <div hidden={!!scriptureEdit}>
                  <ScriptureEditor active={tab === 'scripture' && !scriptureEdit} settingsRevision={bibleSettingsRevision} busy={transmitting}
                    onSave={cue => addWorkspaceItem(scriptureTarget.id, cue)} onLive={cue => void send(cue, 'keep-queue')} />
                </div>
              </section>

              <section id="workspace-panel-text" role="tabpanel" aria-labelledby="workspace-tab-text" className="tool-panel"
                tabIndex={0} hidden={tab !== 'text'}>
                <div hidden={textPanel.kind !== 'library'}>
                  <TextSlideLibrary items={project.textLibrary} libraries={project.slideLibraries} playlists={project.playlists} parent={textTarget.id}
                    key={libraryLocation.revision} selectedId={libraryLocation.selectedId} initialFolder={libraryLocation.folder} busy={transmitting}
                    saving={loaded && !saveError && (persistedTextLibrary !== project.textLibrary || persistedSlideLibraries !== project.slideLibraries)}
                    error={saveError}
                    onCreateLibrary={() => setTextPanel({ kind: 'new-library' })}
                    onCreateOneOff={() => setTextPanel({ kind: 'cue' })}
                    onCreate={folder => setTextPanel({ kind: 'saved-slide', folder })}
                    onEdit={item => setTextPanel({ kind: 'saved-slide', folder: item.folder, existing: item.slide })}
                    onAdd={(item, parent, root) => addWorkspaceItem(parent, copyLibraryTextSlide(item), root)}
                    onLive={item => sendTextSlide(copyLibraryTextSlide(item))} />
                </div>
                {textPanel.kind === 'new-library' && (
                  <>
                    <div className="workspace-context">
                      <h2>{t('New slide library')}</h2>
                      <button type="button" className="button" onClick={() => setTextPanel({ kind: 'library' })}>{t('Cancel')}</button>
                    </div>
                    <NameEditor label={t('Library name')} action={t('Create library')} onSave={createSlideLibrary} />
                  </>
                )}
                {textPanel.kind === 'cue' && (
                  <>
                    <div className="workspace-context">
                      <h2>{t(textPanel.existing ? 'Edit text slide' : 'New one-off text slide')}</h2>
                      <button type="button" className="button" onClick={() => {
                        if (textPanel.existing) finishCueEdit('text')
                        else setTextPanel({ kind: 'library' })
                      }}>{t('Cancel')}</button>
                    </div>
                    {!textPanel.existing && textTarget !== active && <p className="workspace-context">{t('Adding to {name}', { name: textTarget.title })}</p>}
                    <TextEditor key={textPanel.existing?.id ?? 'one-off'} existing={textPanel.existing} busy={transmitting}
                      onSave={slide => {
                        if (textPanel.existing) saveItem(textTarget.id, slide, textPanel.existing)
                        else addWorkspaceItem(textTarget.id, copyLibraryTextSlide({ folder: '', slide }))
                      }}
                      onLive={textPanel.existing ? undefined : sendTextSlide} />
                  </>
                )}
                {textPanel.kind === 'saved-slide' && (
                  <>
                    <div className="workspace-context">
                      <h2>{t(textPanel.existing ? 'Edit saved text slide' : 'New text slide')}</h2>
                    </div>
                    <TextEditor existing={textPanel.existing} library={{
                      folder: textPanel.folder,
                      onBack: () => setTextPanel({ kind: 'library' }),
                      onSave: slide => saveLibraryTextSlide(slide, textPanel.folder),
                    }} />
                  </>
                )}
              </section>
            </div>
          </div>
        </main>
      </div>

      {drag.preview && (
        <div ref={drag.previewRef} className="cue-drag-preview" aria-hidden="true">
          <ItemIcon kind={drag.preview.item.kind} />
          <span className="cue-title">{drag.preview.item.title}</span>
        </div>
      )}

      {notice && <div className={`toast${notice.error ? ' toast--error' : ''}`} role={notice.error ? 'alert' : 'status'}>
        {notice.error ? <CircleAlert size={17} /> : <Monitor size={17} />}<span>{translateError(t, notice.text)}</span>
        <button className="icon-button" aria-label={t('Dismiss message')} onClick={() => setNotice(null)}><X size={16} /></button>
      </div>}

      {editor?.kind === 'settings' && <SettingsDialog onClose={() => setEditor(null)}
        onBibleChange={() => setBibleSettingsRevision(revision => revision + 1)} />}
      {editor && editor.kind !== 'settings' && <Dialog key={editor.kind} title={title} onClose={() => setEditor(null)}>
        {editor.kind === 'choose' && <div className="add-cue-options">
          {cueMenuItems(editor.parent, 'button')}
        </div>}
        {editor.kind === 'playlist' && <NameEditor label={t('Playlist name')} action={t('Create playlist')} onSave={name => addPlaylist(name, editor.parent)} />}
        {editor.kind === 'rename' && <NameEditor label={t('Name')} action={t('Save changes')} existing={editor.existing} onSave={name => rename(editor.existing, editor.parent, name)} />}
        {editor.kind === 'kiosk-background' && <KioskBackgroundEditor background={background} loadError={backgroundError} />}
        {editor.kind === 'remove' && <div className="editor">
          <p>{t(editor.item.kind === 'text' ? 'Remove “{name}” and its slides?'
            : editor.item.kind === 'playlist' && editor.item.children.length ? 'Remove “{name}” and its cues?'
            : 'Remove “{name}”?', { name: editor.item.title })}</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setEditor(null)}>{t('Cancel')}</button>
            <button className="button button-danger" onClick={() => removeItem(editor.item, editor.parent)}>{t('Remove')}</button>
          </div>
        </div>}
      </Dialog>}
    </div>
  )
}
