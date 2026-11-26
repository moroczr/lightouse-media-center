import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  BookOpen, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, FolderOpen, FolderPlus, Image as ImageIcon, LibraryBig, ListMusic,
  Monitor, MonitorOff, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plus, RadioTower, Settings, Trash2, Type, X,
} from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError, type Message } from '../shared/messages'
import { useStage } from '../shared/Audience'
import { useKioskBackground } from '../shared/KioskBackground'
import { useSlideThemes } from '../shared/SlideThemes'
import {
  closeKiosk, desktop, displays, isKioskOpen, listenKioskClosed, loadProject, openKiosk, pickFolder,
  controlPlayback, present, resolveCue, saveProject, setBlackout, slideSettings,
} from '../shared/bridge'
import {
  builtInSlideDefaults, copyLibraryTextSlide, findCueAncestors, flatten, mediaCue, normalizeTextSlideFolder, starterProject, textSlideCues, updateGroup,
  type AudienceCue, type AudienceScriptureCue, type Cue, type Display, type Group, type Item, type MediaFile,
  type LibraryTextSlide, type Project, type ScriptureCue, type TextCue, type TextSlide, type Theme, welcomePreview,
} from '../shared/model'
import { formatScriptureCue, verseLabel, type PassageVerse } from '../shared/scripture'
import { CueList, ItemIcon } from './CueList'
import { CuePickerDialog, type CuePickerTab } from './CuePickerDialog'
import { Dialog, NameEditor, TextEditor } from './Editors'
import { KioskBackgroundEditor } from './KioskBackgroundEditor'
import { ScriptureEditor, type ScriptureView } from './ScriptureEditor'
import { MediaBrowser, type MediaFilter, type MediaView } from './MediaBrowser'
import { TextSlideLibrary, type TextLibraryView } from './TextSlideLibrary'
import { Preview } from './Preview'
import { SettingsDialog } from './Settings'
import { useCueDrag, type CueDropTarget } from './useCueDrag'

type Editor =
  | { kind: 'settings' }
  | { kind: 'kiosk-background' }
  | { kind: 'pick-cue'; parent: string; tab: CuePickerTab }
  | { kind: 'one-off'; parent: string }
  | { kind: 'playlist'; parent: string | null }
  | { kind: 'rename'; parent: string | null; existing: Item }
  | { kind: 'remove'; parent: string | null; item: Item }
  | { kind: 'delete-library'; folder: string }
  | { kind: 'delete-saved-slide'; item: LibraryTextSlide }

type ToolTab = CuePickerTab
type WorkspaceTab = 'cues' | ToolTab
type TextPanel =
  | { kind: 'library' }
  | { kind: 'new-library' }
  | { kind: 'rename-library'; folder: string }
  | { kind: 'saved-slide'; folder: string; existing?: TextSlide }
  | { kind: 'cue'; existing: TextSlide }

const libraryActions = {
  media: { kind: 'media', shortcut: 'M' },
  scripture: { kind: 'scripture', shortcut: 'B' },
  text: { kind: 'text', shortcut: 'T' },
} as const

const workspaceTabs = [
  { id: 'cues', label: 'Cue List', icon: ListMusic },
  { id: 'media', label: 'Media', icon: LibraryBig, shortcut: libraryActions.media.shortcut },
  { id: 'scripture', label: 'Bible lookup', icon: BookOpen, shortcut: libraryActions.scripture.shortcut },
  { id: 'text', label: 'Slides', icon: Type, shortcut: libraryActions.text.shortcut },
] satisfies readonly { id: WorkspaceTab; label: Message; icon: typeof Type; shortcut?: string }[]

const libraryItems = Object.values(libraryActions)
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

function isInSlideLibrary(path: string, library: string) {
  return path === library || path.startsWith(`${library}/`)
}

function useResolvedCue(item: Exclude<Cue, TextCue> | undefined) {
  const [resolved, setResolved] = useState<{ item: Exclude<Cue, TextCue>; cue: AudienceCue | null; error: string }>()

  useEffect(() => {
    if (!item) return
    let current = true
    void resolveCue(item).then(cue => {
      if (current) setResolved({ item, cue, error: '' })
    }).catch(reason => {
      if (current) setResolved({ item, cue: null, error: errorText(reason) })
    })
    return () => { current = false }
  }, [item])

  return resolved?.item === item ? resolved : undefined
}

type WorkspaceLoad =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; saved: Project | null }

export default function Studio() {
  const { t } = useLanguage()
  const [workspace, setWorkspace] = useState<WorkspaceLoad>({ status: 'loading' })
  const loading = workspace.status === 'loading'

  useEffect(() => {
    if (!loading) return
    let active = true
    void loadProject().then(saved => {
      if (active) setWorkspace({ status: 'ready', saved })
    }).catch(reason => {
      if (active) setWorkspace({ status: 'failed', message: errorText(reason) })
    })
    return () => { active = false }
  }, [loading])

  if (workspace.status === 'ready') return <StudioWorkspace saved={workspace.saved} />

  return (
    <main className="workspace-startup">
      {workspace.status === 'failed' ? <>
        <p role="alert">{t('Could not open the workspace: {detail}', { detail: translateError(t, workspace.message) })}</p>
        <button type="button" className="button" onClick={() => setWorkspace({ status: 'loading' })}>{t('Retry')}</button>
      </> : <p role="status">{t('Loading workspace…')}</p>}
    </main>
  )
}

function StudioWorkspace({ saved }: { saved: Project | null }) {
  const { t } = useLanguage()
  const [project, setProject] = useState<Project>(saved ?? starterProject)
  const [saveError, setSaveError] = useState('')
  const [persistedTextLibrary, setPersistedTextLibrary] = useState<LibraryTextSlide[]>()
  const [persistedSlideLibraries, setPersistedSlideLibraries] = useState<string[]>()
  const active = project.playlists.find(list => list.id === project.activeId) ?? project.playlists[0]
  const [cueId, setCueId] = useState<string | null>(() => {
    if (!saved) return desktop ? welcomePreview.id : 'opening-scripture'
    return flatten(active.children)[0]?.id ?? null
  })
  const [displayList, setDisplayList] = useState<Display[]>([])
  const [kiosk, setKiosk] = useState(false)
  const [displayBusy, setDisplayBusy] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set(['worship']))
  const stage = useStage()
  const [liveTextCues, setLiveTextCues] = useState<TextCue[]>([])
  const { settings: themeSettings, error: themeError, reload: reloadThemes } = useSlideThemes()
  const [savingTextTheme, setSavingTextTheme] = useState(false)
  const textTheme = themeSettings?.defaultThemes.text ?? builtInSlideDefaults.text
  const { background, error: backgroundError } = useKioskBackground()
  const [editor, setEditor] = useState<Editor | null>(null)
  const [tab, setTab] = useState<WorkspaceTab>('cues')
  const [mediaSelection, setMediaSelection] = useState<MediaFile>()
  const [versePreview, setVersePreview] = useState<AudienceScriptureCue>()
  const [slideSelection, setSlideSelection] = useState<LibraryTextSlide>()
  const [destinations, setDestinations] = useState<Partial<Record<ToolTab, string>>>({})
  const [scriptureEdit, setScriptureEdit] = useState<ScriptureCue>()
  const [bibleSettingsRevision, setBibleSettingsRevision] = useState(0)
  const [textPanel, setTextPanel] = useState<TextPanel>({ kind: 'library' })
  const [libraryLocation, setLibraryLocation] = useState<{ revision: number; folder?: string; selectedId?: string }>({ revision: 0 })
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const workspaceTabList = useRef<HTMLDivElement>(null)
  const [scriptureView, setScriptureView] = useState<ScriptureView>('list')
  const [mediaView, setMediaView] = useState<MediaView>('list')
  const [textLibraryView, setTextLibraryView] = useState<TextLibraryView>('list')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [transmitting, setTransmitting] = useState(false)
  const transmittingRef = useRef(false)
  const saves = useRef(Promise.resolve())
  const displayInUse = useRef<string | null>(null)
  const displayOperation = useRef(0)
  const drag = useCueDrag(dropCue)

  const currentCueId = stage.cue?.id
  const liveTextIndex = stage.cue?.kind === 'text' ? liveTextCues.findIndex(cue => cue.id === currentCueId) : -1
  const sequence = useMemo(() => flatten(active.children), [active])
  const index = sequence.findIndex(item => item.id === cueId)
  const queued = sequence[index]
  const mediaPreview = useMemo(() => mediaSelection && mediaCue(mediaSelection), [mediaSelection])
  const slidePreview = useMemo(() => slideSelection && textSlideCues(slideSelection.slide)[0], [slideSelection])
  const browserPreview = tab === 'media' ? mediaPreview
    : tab === 'scripture' && !scriptureEdit ? versePreview
    : tab === 'text' && textPanel.kind === 'library' ? slidePreview : undefined
  const resolvedQueue = useResolvedCue(queued?.kind === 'text' ? undefined : queued)
  const resolvedMedia = useResolvedCue(tab === 'media' ? mediaPreview : undefined)
  const resolved = browserPreview ? resolvedMedia : resolvedQueue
  const upcoming = browserPreview ?? queued
  const next = upcoming?.kind === 'text' ? { ...upcoming, theme: textTheme }
    : browserPreview?.kind === 'scripture' ? browserPreview : resolved?.cue ?? null
  const savedDisplay = displayList.find(display => display.id === project.displayId)
  const display = savedDisplay ?? displayList.find(item => !item.studio) ?? displayList[0]
  const firstCue = sequence[0]
  const standby = !kiosk && stage.revision === 0 && !stage.cue && !desktop
    && active.id === 'sunday' && queued?.id !== welcomePreview.id
    && firstCue?.kind === 'text' && firstCue.id === welcomePreview.id ? { ...firstCue, theme: textTheme } : null

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
    if (textPanel.kind === 'cue') setTextPanel({ kind: 'library' })
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
    saves.current = saves.current.then(() => saveProject(project)).then(() => {
      setPersistedTextLibrary(project.textLibrary)
      setPersistedSlideLibraries(project.slideLibraries)
      setSaveError('')
    }).catch(reason => setSaveError(`Could not save changes: ${errorText(reason)}`))
  }, [project])

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
    const cue = stage.cue
    if ((!themeSettings && !themeError) || cue?.kind !== 'text' || cue.theme === textTheme) return
    void present({ ...cue, theme: textTheme }, stage.revision).catch(reason => {
      setNotice({ text: errorText(reason), error: true })
    })
  }, [stage.cue, stage.revision, textTheme, themeSettings, themeError])

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

  function updatePlaylist(fn: (root: Group) => Group) {
    setProject(current => ({
      ...current,
      activeId: active.id,
      playlists: current.playlists.map(root => root.id === active.id ? fn(root) : root),
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
    if (candidate) {
      setCueId(candidate.id)
      if (browserPreview) activateTab('cues')
    }
  }

  async function send(item: Cue, mode: 'advance' | 'keep-queue', textCues: TextCue[] = []) {
    if (transmittingRef.current) return
    transmittingRef.current = true
    setTransmitting(true)
    try {
      const cue = await resolveCue(item.kind === 'text' ? { ...item, theme: textTheme } : item)
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

  async function changeTextTheme(theme: Theme) {
    if (theme === textTheme || savingTextTheme) return
    setSavingTextTheme(true)
    try {
      await slideSettings.saveDefault('text', theme)
      await reloadThemes()
    } catch (reason) {
      tell(errorText(reason), true)
    } finally {
      setSavingTextTheme(false)
    }
  }

  function sendTextSlide(slide: TextSlide) {
    const cues = textSlideCues(slide)
    if (cues.length) void send(cues[0], 'keep-queue', cues)
  }

  function showAdjacentTextSlide(direction: -1 | 1) {
    if (liveTextIndex < 0 || transmittingRef.current) return
    const cue = liveTextCues[liveTextIndex + direction]
    if (cue) void updateStage(present({ ...cue, theme: textTheme }, stage.revision))
  }

  function goLive() {
    if (!upcoming || !next) return
    if (browserPreview?.kind === 'text' && slideSelection) {
      sendTextSlide(copyLibraryTextSlide(slideSelection))
      return
    }
    void send(upcoming, browserPreview ? 'keep-queue' : 'advance')
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
    }, verse)
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
        const shortcut = `${event.shiftKey ? 'Shift+' : ''}${event.key.toUpperCase()}`
        if (shortcut === 'Shift+B') {
          event.preventDefault()
          toggleBlackout()
          return
        }
        if (editor && editor.kind !== 'pick-cue') return
        const action = libraryItems.find(item => item.shortcut === shortcut)
        if (!action) return
        event.preventDefault()
        if (editor?.kind === 'pick-cue') setEditor({ ...editor, tab: action.kind })
        else activateTab(action.kind, true)
        return
      }
      if (editor || (target instanceof HTMLElement && target.closest('input, textarea, select, button, summary, [contenteditable]'))) return
      if (tab === 'cues') {
        if (event.key === 'ArrowUp' && (index > 0 || index < 0)) { event.preventDefault(); nudge(-1) }
        if (event.key === 'ArrowDown') { event.preventDefault(); nudge(1) }
        if (event.key === 'Enter' && queued && next) { event.preventDefault(); goLive() }
      }
    }

    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })

  function addItem(parent: string, item: Item) {
    const path = playlistPath(active, parent)
    if (!path) {
      tell('The destination playlist is unavailable.', true)
      return
    }
    updatePlaylist(root => updateGroup(root, parent, group => ({ ...group, children: [...group.children, item] })))
    if (parent !== active.id || item.kind === 'text') {
      setExpanded(current => new Set([...current, ...path.slice(1).map(group => group.id), ...(item.kind === 'text' ? [item.id] : [])]))
    }
    if (item.kind !== 'playlist') setCueId(flatten([item])[0]?.id ?? null)
    return true
  }

  function addWorkspaceItem(parent: string, item: Item) {
    if (!addItem(parent, item)) return false
    tell(t('Added “{name}” to playlist.', { name: item.title }))
    return true
  }

  function openCuePicker(parent: string) {
    setEditor({ kind: 'pick-cue', parent, tab: 'media' })
  }

  function addPickedCue(parent: string, item: Item) {
    if (addWorkspaceItem(parent, item)) setEditor(null)
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
    if (item.kind === 'text' && existing.kind === 'text') {
      setExpanded(current => new Set(current).add(item.id))
      const oldIndex = textSlideCues(existing).findIndex(cue => cue.id === cueId)
      const cues = textSlideCues(item)
      if (oldIndex >= 0 && !cues.some(cue => cue.id === cueId)) {
        setCueId(cues[Math.min(oldIndex, cues.length - 1)]?.id ?? null)
      }
    }

    const shown = stage.cue
    if (item.kind === 'scripture' && existing.kind === 'scripture' && shown?.kind === 'scripture'
      && shown.id === item.id && item.theme !== existing.theme) {
      void updateStage(present({ ...shown, theme: item.theme }, stage.revision))
    }
    finishCueEdit(item.kind)
  }

  function createSlideLibrary(name: string) {
    const folder = normalizeTextSlideFolder(name)
    if (!folder) return t('Enter a library name.')
    if (project.slideLibraries.some(path => path.toLocaleLowerCase() === folder.toLocaleLowerCase())) {
      return t('A slide library with this name already exists.')
    }
    setProject(current => ({ ...current, slideLibraries: [...current.slideLibraries, folder] }))
    showLibrary(folder)
  }

  function renameSlideLibrary(folder: string, name: string) {
    const leaf = normalizeTextSlideFolder(name)
    if (!leaf) return t('Enter a library name.')
    if (name.includes('/')) return t('Enter a name without a slash.')

    const renamed = folder.slice(0, folder.lastIndexOf('/') + 1) + leaf
    const target = renamed.toLocaleLowerCase()
    if (project.slideLibraries.some(path => !isInSlideLibrary(path, folder) && isInSlideLibrary(path.toLocaleLowerCase(), target))) {
      return t('A slide library with this name already exists.')
    }

    if (renamed !== folder) {
      const renamePath = (path: string) => renamed + path.slice(folder.length)
      setProject(current => ({
        ...current,
        slideLibraries: current.slideLibraries.map(path => isInSlideLibrary(path, folder) ? renamePath(path) : path),
        textLibrary: current.textLibrary.map(item => isInSlideLibrary(item.folder, folder)
          ? { ...item, folder: renamePath(item.folder) } : item),
      }))
    }
    setTextPanel({ kind: 'library' })
    activateTab('text', true)
  }

  function deleteSavedContent(removal: Extract<Editor, { kind: 'delete-library' | 'delete-saved-slide' }>) {
    if (removal.kind === 'delete-library') {
      setProject(current => ({
        ...current,
        slideLibraries: current.slideLibraries.filter(path => !isInSlideLibrary(path, removal.folder)),
        textLibrary: current.textLibrary.filter(item => !isInSlideLibrary(item.folder, removal.folder)),
      }))
    } else {
      setProject(current => ({
        ...current, textLibrary: current.textLibrary.filter(item => item.slide.id !== removal.item.slide.id),
      }))
    }
    setEditor(null)
    activateTab('text', true)
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
      const removingActive = item.id === active.id
      setProject(current => ({ ...current, playlists: remaining, activeId: removingActive ? remaining[0].id : active.id }))
      if (removingActive) {
        setCueId(flatten(remaining[0].children)[0]?.id ?? null)
        showCueList()
      }
    } else {
      const removedSelected = flatten([item]).some(cue => cue.id === cueId)
      const withoutItem = (root: Group) => updateGroup(root, parent, group => ({
        ...group, children: group.children.filter(child => child.id !== item.id),
      }))
      const updated = withoutItem(active)
      const containsCue = (destination: Group, id: string) =>
        playlistPath(updated, destination.id)?.at(-1)?.children.some(child => child.id === id)
      if (scriptureEdit && !containsCue(scriptureTarget, scriptureEdit.id)) setScriptureEdit(undefined)
      if (textPanel.kind === 'cue' && !containsCue(textTarget, textPanel.existing.id)) {
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
      setProject(current => ({
        ...current, playlists: current.playlists.map(root => root.id === item.id ? { ...root, title } : root),
      }))
    }
    setEditor(null)
  }

  const title = editor?.kind === 'playlist' ? (editor.parent ? t('New nested playlist') : t('New playlist'))
    : editor?.kind === 'rename' ? t(editor.existing.kind === 'playlist' ? 'Rename playlist' : 'Rename cue')
    : editor?.kind === 'kiosk-background' ? t('Kiosk background')
    : editor?.kind === 'remove' ? t('Remove from workspace')
    : editor?.kind === 'delete-library' ? t('Delete library')
    : editor?.kind === 'delete-saved-slide' ? t('Delete saved slide')
    : t('New one-off text slide')

  const sidebarAction = sidebarOpen ? t('Collapse sidebar') : t('Expand sidebar')
  const savingLibrary = !saveError && (persistedTextLibrary !== project.textLibrary
    || persistedSlideLibraries !== project.slideLibraries)

  return (
    <div className={`studio-shell${drag.preview ? ' studio-shell--dragging' : ''}`} {...drag.handlers}>
      <div className="workspace">
        <aside className={`sidebar${sidebarOpen ? '' : ' sidebar--collapsed'}`} aria-label={t('Playlists and media sources')}>
          <div className="sidebar-kiosk" role="group" aria-label={t('Kiosk controls')}>
            <div className="sidebar-kiosk-heading">
              <div className="sidebar-kiosk-status" title={t(kiosk ? 'Kiosk connected' : 'Kiosk on standby')}>
                <span className={`engine-light${kiosk ? ' engine-light--active' : ''}`} aria-hidden="true" />
                <span>{kiosk ? t('Kiosk connected') : t('Kiosk on standby')}</span>
              </div>
              <button type="button" className="icon-button" aria-label={sidebarAction} title={sidebarAction}
                aria-controls="studio-sidebar-content" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(open => !open)}>
                {sidebarOpen ? <PanelLeftClose size={17} aria-hidden="true" /> : <PanelLeftOpen size={17} aria-hidden="true" />}
              </button>
            </div>
            <div className="display-select" title={t('Kiosk display')}>
              <Monitor size={16} aria-hidden="true" />
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
              <ChevronDown className="display-chevron" size={13} aria-hidden="true" />
            </div>
            <button type="button" className={`button kiosk-button${kiosk ? ' kiosk-button--open' : ''}`}
              aria-label={t(kiosk ? 'Close Kiosk' : 'Launch Kiosk')} title={t(kiosk ? 'Close Kiosk' : 'Launch Kiosk')}
              onClick={() => void toggleKiosk()} disabled={!display || displayBusy}>
              {kiosk ? <MonitorOff size={16} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              <span>{t(kiosk ? 'Close Kiosk' : 'Launch Kiosk')}</span>
            </button>
          </div>
          <div id="studio-sidebar-content" className="sidebar-content" hidden={!sidebarOpen}>
            <section className="sidebar-section" aria-labelledby="playlists-heading">
              <div className="sidebar-heading">
                <h2 id="playlists-heading">{t('Playlists')}</h2>
                <button type="button" className="icon-button" title={t('New playlist')} aria-label={t('New playlist')}
                  onClick={() => setEditor({ kind: 'playlist', parent: null })}><Plus size={17} aria-hidden="true" /></button>
              </div>
              {project.playlists.map(list => (
                <div className="playlist-row" key={list.id}>
                  <button type="button" className={`sidebar-item playlist-link${active.id === list.id ? ' sidebar-item--active' : ''}`}
                    title={list.title} onClick={() => selectPlaylist(list)} aria-current={active.id === list.id ? 'true' : undefined}>
                    <span>{list.title}</span><span className="playlist-count">{flatten(list.children).length}</span>
                  </button>
                  <button type="button" className="icon-button" title={t('Rename playlist {name}', { name: list.title })}
                    aria-label={t('Rename playlist {name}', { name: list.title })}
                    onClick={() => setEditor({ kind: 'rename', parent: null, existing: list })}><Pencil size={14} aria-hidden="true" /></button>
                  <button type="button" className="icon-button playlist-remove" title={t('Remove playlist {name}', { name: list.title })}
                    aria-label={t('Remove playlist {name}', { name: list.title })} disabled={project.playlists.length < 2}
                    onClick={() => setEditor({ kind: 'remove', parent: null, item: list })}><Trash2 size={14} aria-hidden="true" /></button>
                </div>
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
          </div>
          <div className="sidebar-utilities">
            <button type="button" className="button button-quiet settings-button" aria-label={t('Settings')} title={t('Settings')} aria-haspopup="dialog"
              onClick={() => setEditor({ kind: 'settings' })}><Settings size={17} aria-hidden="true" /><span>{t('Settings')}</span></button>
            <button type="button" className="icon-button" aria-label={t('Kiosk background')} title={t('Kiosk background')} aria-haspopup="dialog"
              onClick={() => setEditor({ kind: 'kiosk-background' })}><ImageIcon size={17} aria-hidden="true" /></button>
          </div>
        </aside>

        <main className="main">
          <div className="main-inner">
            <Preview
              stage={stage} standby={standby} background={background?.url} next={next}
              nextError={resolved?.error ?? ''} browsing={!!browserPreview}
              kiosk={kiosk} busy={transmitting}
              dropTarget={drag.preview?.target ?? null} browserDrag={!!drag.preview && !('cueId' in drag.preview.item)}
              onBlackout={toggleBlackout}
              onNavigateVerse={showAdjacentVerse}
              textNavigation={liveTextIndex >= 0 && liveTextCues.length > 1 ? {
                index: liveTextIndex, total: liveTextCues.length, onMove: showAdjacentTextSlide,
              } : undefined}
              onPlayback={action => void updateStage(controlPlayback(stage.revision, action))}
            />

            {(saveError || stage.error) && <div className="problem" role="alert"><CircleAlert size={17} /> {translateError(t, saveError || stage.error || '')}</div>}

            <div className="cue-workspace">
              <div className="workspace-bar">
                <div className="workspace-bar-inner">
                  <div className="workspace-tabs" role="tablist" aria-label={t('Presentation workspace')} ref={workspaceTabList} onKeyDown={navigateTabs}>
                    {workspaceTabs.map(({ id, label, icon: Icon, shortcut }) => (
                      <button key={id} type="button" role="tab" id={`workspace-tab-${id}`} aria-controls={`workspace-panel-${id}`}
                        aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
                        aria-keyshortcuts={shortcut ? `Control+${shortcut}` : undefined} onClick={() => activateTab(id)}>
                        <Icon size={15} aria-hidden="true" /><span>{t(label)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="cue-navigation" role="group" aria-label={t('Cue controls')}>
                    <button type="button" className="button" aria-label={t('Previous')}
                      disabled={index === 0 || !sequence.length} onClick={() => nudge(-1)}
                      title={t('Cue previous item (↑)')}><ChevronLeft size={17} aria-hidden="true" /><span>{t('Previous')}</span></button>
                    <button type="button" className="button" aria-label={t('Next')}
                      disabled={index < 0 || index >= sequence.length - 1} onClick={() => nudge(1)}
                      title={t('Cue next item (↓)')}><span>{t('Next')}</span><ChevronRight size={17} aria-hidden="true" /></button>
                    <button type="button" className="button button-primary" aria-label={t('Go live')}
                      disabled={!upcoming || !next || transmitting} onClick={goLive}
                      title={t(browserPreview ? 'Send the previewed item to Kiosk' : 'Send the queued item to Kiosk (Enter)')}><RadioTower size={17} aria-hidden="true" /><span>{t('Go live')}</span></button>
                  </div>
                </div>
              </div>
              <section id="workspace-panel-cues" role="tabpanel" aria-labelledby="workspace-tab-cues" className="cue-panel"
                tabIndex={0} hidden={tab !== 'cues'}>
                <div className="cue-add">
                  <button type="button" className="icon-button" aria-label={t('Add cue')} title={t('Add cue')}
                    aria-haspopup="dialog" onClick={() => openCuePicker(active.id)}>
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </div>
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
                    onCue={cueItem} onGoLive={takeCue} onCuePointerDown={drag.start} onEdit={editItem} onMove={moveItem}
                    onAdd={openCuePicker}
                    onRemove={(item, parent) => setEditor({ kind: 'remove', parent, item })}
                  />
                </div>
              </section>

              <section id="workspace-panel-media" role="tabpanel" aria-labelledby="workspace-tab-media" className="tool-panel"
                tabIndex={0} hidden={tab !== 'media'}>
                <MediaBrowser sources={project.sources} filter={mediaFilter} onFilterChange={setMediaFilter}
                  view={mediaView} onViewChange={setMediaView} onAddFolder={addSource} busy={transmitting}
                  onPreview={setMediaSelection} onLive={file => void send(mediaCue(file), 'keep-queue')}
                  onCuePointerDown={drag.start} />
              </section>

              <section id="workspace-panel-scripture" role="tabpanel" aria-labelledby="workspace-tab-scripture" className="tool-panel scripture-panel"
                tabIndex={0} hidden={tab !== 'scripture'}>
                {scriptureEdit && (
                  <>
                    <div className="workspace-context">
                      <h2>{t('Edit scripture cue')}</h2>
                      <button type="button" className="button" onClick={() => finishCueEdit('scripture')}>{t('Cancel')}</button>
                    </div>
                    <ScriptureEditor key={scriptureEdit.id} existing={scriptureEdit}
                      active={tab === 'scripture'} settingsRevision={bibleSettingsRevision} busy={transmitting}
                      view={scriptureView} onViewChange={setScriptureView}
                      onSave={cue => saveItem(scriptureTarget.id, cue, scriptureEdit)} />
                  </>
                )}
                <div className="scripture-lookup" hidden={!!scriptureEdit}>
                  <ScriptureEditor active={tab === 'scripture' && !scriptureEdit} settingsRevision={bibleSettingsRevision} busy={transmitting}
                    view={scriptureView} onViewChange={setScriptureView}
                    onPreview={setVersePreview} onLive={cue => void send(cue, 'keep-queue')}
                    onCuePointerDown={drag.start} />
                </div>
              </section>

              <section id="workspace-panel-text" role="tabpanel" aria-labelledby="workspace-tab-text" className="tool-panel"
                tabIndex={0} hidden={tab !== 'text'}>
                <div hidden={textPanel.kind !== 'library'}>
                  <TextSlideLibrary active={tab === 'text' && textPanel.kind === 'library'}
                    items={project.textLibrary} libraries={project.slideLibraries}
                    key={libraryLocation.revision} selectedId={libraryLocation.selectedId} initialFolder={libraryLocation.folder}
                    theme={textTheme} view={textLibraryView} onViewChange={setTextLibraryView} busy={transmitting}
                    saving={savingLibrary} error={saveError}
                    actions={{
                      kind: 'browse',
                      backgroundBusy: savingTextTheme || (!themeSettings && !themeError),
                      onBackgroundChange: theme => void changeTextTheme(theme),
                      onCreateLibrary: () => setTextPanel({ kind: 'new-library' }),
                      onCreate: folder => setTextPanel({ kind: 'saved-slide', folder }),
                      onRenameLibrary: folder => setTextPanel({ kind: 'rename-library', folder }),
                      onDeleteLibrary: folder => setEditor({ kind: 'delete-library', folder }),
                      onEdit: item => setTextPanel({ kind: 'saved-slide', folder: item.folder, existing: item.slide }),
                      onDelete: item => setEditor({ kind: 'delete-saved-slide', item }),
                      onPreview: setSlideSelection,
                      onCuePointerDown: drag.start,
                      onLive: item => sendTextSlide(copyLibraryTextSlide(item)),
                    }} />
                </div>
                {(textPanel.kind === 'new-library' || textPanel.kind === 'rename-library') && (
                  <>
                    <div className="workspace-context">
                      <h2>{t(textPanel.kind === 'rename-library' ? 'Rename slide library' : 'New slide library')}</h2>
                      <button type="button" className="button" onClick={() => setTextPanel({ kind: 'library' })}>{t('Cancel')}</button>
                    </div>
                    {textPanel.kind === 'rename-library' ? (
                      <NameEditor label={t('Library name')} action={t('Save changes')}
                        initialValue={textPanel.folder.split('/').at(-1)} onSave={name => renameSlideLibrary(textPanel.folder, name)} />
                    ) : <NameEditor label={t('Library name')} action={t('Create library')} onSave={createSlideLibrary} />}
                  </>
                )}
                {textPanel.kind === 'cue' && (
                  <>
                    <div className="workspace-context">
                      <h2>{t('Edit text slide')}</h2>
                      <button type="button" className="button" onClick={() => finishCueEdit('text')}>{t('Cancel')}</button>
                    </div>
                    <TextEditor key={textPanel.existing.id} existing={textPanel.existing} busy={transmitting}
                      onSave={slide => saveItem(textTarget.id, slide, textPanel.existing)} />
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
      {editor?.kind === 'pick-cue' && (
        <CuePickerDialog tab={editor.tab} onTabChange={tab => setEditor({ ...editor, tab })}
          destination={playlistPath(active, editor.parent)?.at(-1)?.title} project={project}
          settingsRevision={bibleSettingsRevision} busy={transmitting} textTheme={textTheme}
          onAdd={item => addPickedCue(editor.parent, item)}
          onCreateText={() => setEditor({ kind: 'one-off', parent: editor.parent })}
          onCreatePlaylist={() => setEditor({ kind: 'playlist', parent: editor.parent })} onClose={() => setEditor(null)} />
      )}
      {editor && editor.kind !== 'settings' && editor.kind !== 'pick-cue' && <Dialog key={editor.kind} title={title} onClose={() => setEditor(null)}>
        {editor.kind === 'one-off' && <TextEditor busy={transmitting} onSave={slide => addPickedCue(editor.parent, slide)} />}
        {editor.kind === 'playlist' && <NameEditor label={t('Playlist name')} action={t('Create playlist')} onSave={name => addPlaylist(name, editor.parent)} />}
        {editor.kind === 'rename' && <NameEditor label={t('Name')} action={t('Save changes')} initialValue={editor.existing.title} onSave={name => rename(editor.existing, editor.parent, name)} />}
        {editor.kind === 'kiosk-background' && <KioskBackgroundEditor background={background} loadError={backgroundError} />}
        {(editor.kind === 'delete-library' || editor.kind === 'delete-saved-slide') && <div className="editor">
          <p>{editor.kind === 'delete-library'
            ? t('Delete “{name}” and all its saved slides and sublibraries?', { name: editor.folder.split('/').at(-1) ?? editor.folder })
            : t('Delete saved slide “{name}”?', { name: editor.item.slide.title })}</p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setEditor(null)}>{t('Cancel')}</button>
            <button type="button" className="button button-danger" onClick={() => deleteSavedContent(editor)}>{t('Delete')}</button>
          </div>
        </div>}
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
