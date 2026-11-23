import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, ChevronDown, CircleAlert, Ellipsis, FolderOpen, FolderPlus, Image as ImageIcon, LibraryBig, ListMusic,
  Monitor, MonitorOff, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plus, Trash2, Type, X,
} from 'lucide-react'
import { useStage } from '../shared/Audience'
import { useKioskBackground } from '../shared/KioskBackground'
import {
  closeKiosk, desktop, displays, isKioskOpen, listenKioskClosed, loadProject, openKiosk, pickFolder,
  controlPlayback, present, resolveCue, saveProject, setBlackout,
} from '../shared/bridge'
import {
  flatten, kindNames, mediaCue, starterProject, updateGroup,
  type AudienceCue, type Cue, type Display, type Group, type Item, type ItemKind,
  type Project, type ScriptureCue, type TextSlide, welcomePreview,
} from '../shared/model'
import { CueList, ItemIcon, Menu } from './CueList'
import { Dialog, NameEditor, TextEditor } from './Editors'
import { KioskBackgroundEditor } from './KioskBackgroundEditor'
import { ScriptureEditor } from './ScriptureEditor'
import { MediaBrowser, type MediaView } from './MediaBrowser'
import { Preview } from './Preview'

type Editor =
  | { kind: 'kiosk-background' }
  | { kind: 'choose'; parent: string }
  | { kind: 'text'; parent: string; existing?: TextSlide }
  | { kind: 'scripture'; parent: string; existing?: ScriptureCue }
  | { kind: 'playlist'; parent: string | null }
  | { kind: 'media'; parent: string; filter?: 'video' | 'audio' }
  | { kind: 'rename'; parent: string | null; existing: Item }
  | { kind: 'remove'; parent: string | null; item: Item }

const cueKinds: ItemKind[] = ['text', 'scripture', 'video', 'audio', 'playlist']

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

export default function Studio() {
  const [project, setProject] = useState<Project>(starterProject)
  const [loaded, setLoaded] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [cueId, setCueId] = useState<string | null>(desktop ? welcomePreview.id : 'opening-scripture')
  const [displayList, setDisplayList] = useState<Display[]>([])
  const [kiosk, setKiosk] = useState(false)
  const [displayBusy, setDisplayBusy] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set(['worship']))
  const stage = useStage()
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
    saves.current = saves.current.then(() => saveProject(project)).then(() => setSaveError(''))
      .catch(reason => setSaveError(`Could not save changes: ${errorText(reason)}`))
  }, [project, loaded])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), notice.error ? 7200 : 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

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

  function updatePlaylist(fn: (root: Group) => Group) {
    setProject(current => ({
      ...current,
      playlists: current.playlists.map(root => root.id === active.id ? fn(root) : root),
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

  async function send(item: Cue, advance: boolean) {
    if (transmittingRef.current) return
    transmittingRef.current = true
    setTransmitting(true)
    try {
      const cue = await resolveCue(item)
      await present(cue)
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

  function goLive() {
    if (queued && next) void send(queued, true)
  }

  function takeCue(id: string) {
    const cue = sequence.find(item => item.id === id)
    if (cue) void send(cue, true)
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

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      const target = event.target
      if (editor || event.altKey || event.ctrlKey || event.metaKey || event.repeat
        || (target instanceof HTMLElement && target.closest('input, textarea, select, button, summary, [contenteditable]'))) return
      if (event.key === 'ArrowUp' && (index > 0 || index < 0)) { event.preventDefault(); nudge(-1) }
      if (event.key === 'ArrowDown') { event.preventDefault(); nudge(1) }
      if (event.key === 'Enter' && queued && next) { event.preventDefault(); goLive() }
      if (event.key.toLowerCase() === 'b') void updateStage(setBlackout(!stage.blackout))
    }

    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })

  function addItem(parent: string, item: Item) {
    updatePlaylist(root => updateGroup(root, parent, group => ({ ...group, children: [...group.children, item] })))
    if (parent !== active.id || item.kind === 'text') {
      setExpanded(current => {
        const next = new Set(current)
        if (parent !== active.id) next.add(parent)
        if (item.kind === 'text') next.add(item.id)
        return next
      })
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
      const oldIndex = existing.entries.findIndex(entry => entry.id === cueId)
      if (oldIndex >= 0 && !item.entries.some(entry => entry.id === cueId)) {
        setCueId(item.entries[Math.min(oldIndex, item.entries.length - 1)]?.id ?? null)
      }
    }
    setEditor(null)
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

  function openEditor(kind: ItemKind, parent: string) {
    if (kind === 'video' || kind === 'audio') {
      setEditor({ kind: 'media', parent, filter: kind })
      return
    }
    setEditor({ kind, parent })
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
    : editor?.kind === 'text' ? (editor.existing ? 'Edit text slide' : 'New text slide')
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
            {cueKinds.map(kind => <button key={kind} onClick={() => openEditor(kind, active.id)}><ItemIcon kind={kind} size={14} /> {kindNames[kind]}</button>)}
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
        </div>
      </header>

      <div className="workspace">
        <aside id="studio-sidebar" className="sidebar" aria-label="Playlists and sources" hidden={!sidebarOpen}>
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
              <button className="sidebar-item" onClick={() => setEditor({ kind: 'media', parent: active.id })}><LibraryBig size={17} /><span>Add Media</span></button>
              <button className="sidebar-item" onClick={() => setEditor({ kind: 'scripture', parent: active.id })}><BookOpen size={17} /><span>Bible lookup</span></button>
              <button className="sidebar-item" onClick={() => setEditor({ kind: 'text', parent: active.id })}><Type size={17} /><span>Text slide</span></button>
            </section>
            <section className="sidebar-section">
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
              onBlackout={() => void updateStage(setBlackout(!stage.blackout))}
              onClear={() => void updateStage(present(null))}
              onPlayback={action => void updateStage(controlPlayback(stage.revision, action))}
            />

            {(saveError || stage.error) && <div className="problem" role="alert"><CircleAlert size={17} /> {saveError || stage.error}</div>}

            <section className="cue-section" aria-labelledby="cues-heading">
              <header>
                <h2 id="cues-heading">Cue list</h2>
              </header>
              <div className="cue-scroll">
                <CueList root={active} selectedId={cueId} liveId={kiosk && !stage.blackout ? stage.cue?.id ?? null : null} expanded={expanded}
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

      {editor && <Dialog key={editor.kind} title={title} wide={editor.kind === 'media' || editor.kind === 'scripture'} onClose={() => setEditor(null)}>
        {editor.kind === 'choose' && <div className="add-cue-options">
          {cueKinds.map(kind => <button className="button" onClick={() => openEditor(kind, editor.parent)} key={kind}><ItemIcon kind={kind} />{kindNames[kind]}</button>)}
        </div>}
        {editor.kind === 'playlist' && <NameEditor label="Playlist name" action="Create playlist" onSave={name => addPlaylist(name, editor.parent)} />}
        {editor.kind === 'rename' && <NameEditor label="Name" action="Save changes" existing={editor.existing} onSave={name => rename(editor.existing, editor.parent, name)} />}
        {editor.kind === 'text' && <TextEditor existing={editor.existing} onSave={slide => saveItem(editor.parent, slide, editor.existing)} onLive={cue => void send(cue, false)} />}
        {editor.kind === 'scripture' && <ScriptureEditor existing={editor.existing} busy={transmitting} onSave={cue => saveItem(editor.parent, cue, editor.existing)} onLive={cue => void send(cue, false)} />}
        {editor.kind === 'media' && <MediaBrowser sources={project.sources} initialFilter={editor.filter}
          view={mediaView} onViewChange={setMediaView} onAddFolder={addSource} busy={transmitting}
          onSave={file => addItem(editor.parent, mediaCue(file))} onLive={file => void send(mediaCue(file), false)}
        />}
        {editor.kind === 'kiosk-background' && <KioskBackgroundEditor background={background} loadError={backgroundError} />}
        {editor.kind === 'remove' && <div className="editor">
          <p>Remove <strong>{editor.item.title}</strong>{editor.item.kind === 'text' ? ' and its slides' : editor.item.kind === 'playlist' && editor.item.children.length ? ' and its cues' : ''}?</p>
          <div className="dialog-actions"><button className="button" onClick={() => setEditor(null)}>Cancel</button><button className="button button-danger" onClick={() => removeItem(editor.item, editor.parent)}>Remove</button></div>
        </div>}
      </Dialog>}
    </div>
  )
}
