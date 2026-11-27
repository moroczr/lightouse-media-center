import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { addBrowserSlideBackground, loadBrowserSlideSettings, saveBrowserDefaultSlideTheme } from './browserSlideSettings'
import {
  type AudienceCue, type AudienceTextCue, type BibleCatalog, type BibleDownloadProgress, type BiblePreferences, type BibleSettings, type Book, type Cue, type Display, type Group, type BackgroundImage, type MediaFile, type PlaybackAction, type Project,
  type Reference, type SavedProject, type SlideKind, type SlideSettings, type Source, type Stage, type TextCue, type Theme, type Verse, emptyStage, isMedia, normalizeProject,
} from './model'
import { formatScriptureCue, readAdjacentVerses, verseLabel } from './scripture'
import { readLanguage, translate, type Message } from './messages'
import { createVerseSearch, type BibleVerseRow } from './verseSearch'

export const desktop = isTauri()
function dialogLabels(title: Message, filter?: Message) {
  const language = readLanguage()
  return {
    title: translate(language, title),
    filterName: filter ? translate(language, filter) : undefined,
  }
}

const fadeKey = 'lighthouse-playback-fade'
const projectKey = 'lighthouse-project-v1'
const backgroundKey = 'nemesa-kiosk-background'
const backgroundEvent = 'kiosk-background-updated'
const slideSettingsEvent = 'slide-settings-updated'
const channel = desktop ? null : new BroadcastChannel('nemesa-stage')
const browserFiles = new Map<string, File>()
const browserUrls = new Map<string, string>()
let popup: Window | null = null
let browserStage: Stage = { ...emptyStage, fade: !desktop && localStorage.getItem(fadeKey) === 'true' }

type BibleData = { books: Book[]; verses: BibleVerseRow[] }
const verseSearches = new Map<string, Promise<ReturnType<typeof createVerseSearch>>>()

function loadVerseSearch(translation: string) {
  let request = verseSearches.get(translation)
  if (!request) {
    const data = invoke<BibleData>('bible_search_data', { translation })
    request = data.then(({ books, verses }) => createVerseSearch(books, verses))
    verseSearches.set(translation, request)
    void request.catch(() => verseSearches.delete(translation))
  }
  return request
}

export const bible = {
  search: async (translation: string, query: string) => (await loadVerseSearch(translation))(query),
  settings: async () => desktop ? invoke<BibleSettings>('load_bible_settings') : { databases: [], defaultId: null },
  saveSettings: (preferences: BiblePreferences) => invoke<BibleSettings>('save_bible_settings', { preferences }),
  catalog: () => invoke<BibleCatalog>('fetch_bible_catalog'),
  download: async (revision: string, id: string) => {
    const settings = await invoke<BibleSettings>('download_bible', { revision, id })
    verseSearches.delete(id)
    return settings
  },
  onDownloadProgress: (callback: (progress: BibleDownloadProgress) => void) =>
    listen<BibleDownloadProgress>('bible-download-progress', event => callback(event.payload)),
  remove: async (id: string) => {
    const settings = await invoke<BibleSettings>('remove_bible', { id })
    verseSearches.delete(id)
    return settings
  },
  books: (translation: string) => invoke<Book[]>('books', { translation }),
  verses: (translation: string, book: string, chapter: number) => invoke<Verse[]>('verses', { translation, book, chapter }),
}

export async function adjacentVerses({ translation, book, chapter, verse }: Reference) {
  const books = await bible.books(translation)
  const current = books.find(entry => entry.id === book)
  if (!current) throw new Error('This book is unavailable in the selected translation.')
  return readAdjacentVerses(books, { book: current, chapter, verse },
    (bookId, number) => bible.verses(translation, bookId, number))
}

export async function loadProject(): Promise<Project | null> {
  const saved: SavedProject | null = desktop
    ? await invoke('load_project')
    : JSON.parse(localStorage.getItem(projectKey) ?? 'null')
  if (saved === null) return null
  if (!Array.isArray(saved.playlists)) throw new Error('Invalid workspace format.')
  const project = normalizeProject(saved)
  if (!desktop) return project

  const booksByTranslation = new Map<string, Promise<Book[]>>()
  async function updateScriptureTitles(group: Group): Promise<Group> {
    const children = await Promise.all(group.children.map(async item => {
      if (item.kind === 'playlist') return updateScriptureTitles(item)
      if (item.kind !== 'scripture') return item
      const { translation, book, chapter, verse } = item.reference
      let request = booksByTranslation.get(translation)
      if (!request) {
        request = bible.books(translation).catch(() => [])
        booksByTranslation.set(translation, request)
      }
      const match = (await request).find(entry => entry.id === book)
      return match ? { ...item, title: verseLabel({ book: match, chapter, verse }) } : item
    }))
    return { ...group, children }
  }
  return { ...project, playlists: await Promise.all(project.playlists.map(updateScriptureTitles)) }
}

export function saveProject(project: Project): Promise<void> {
  if (desktop) return invoke('save_project', { project })
  localStorage.setItem(projectKey, JSON.stringify(project))
  return Promise.resolve()
}

export async function loadKioskBackground(): Promise<BackgroundImage | null> {
  if (desktop) return invoke('load_kiosk_background')
  const saved = localStorage.getItem(backgroundKey)
  return saved ? JSON.parse(saved) : null
}

export async function listenKioskBackground(callback: (background: BackgroundImage | null) => void) {
  if (desktop) return listen<BackgroundImage | null>(backgroundEvent, event => callback(event.payload))
  const local = (event: Event) => callback((event as CustomEvent<BackgroundImage | null>).detail)
  const remote = (event: StorageEvent) => {
    if (event.key === backgroundKey) callback(event.newValue ? JSON.parse(event.newValue) : null)
  }
  window.addEventListener(backgroundEvent, local)
  window.addEventListener('storage', remote)
  return () => {
    window.removeEventListener(backgroundEvent, local)
    window.removeEventListener('storage', remote)
  }
}

async function validateBackground(url: string) {
  const image = new Image()
  image.src = url
  try { await image.decode() }
  catch { throw new Error('The selected image could not be opened.') }
}

export async function saveKioskBackground(background: BackgroundImage | null) {
  if (background) await validateBackground(background.url)
  if (desktop) return invoke<void>('save_kiosk_background', { background })
  try {
    if (background) localStorage.setItem(backgroundKey, JSON.stringify(background))
    else localStorage.removeItem(backgroundKey)
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'QuotaExceededError') {
      throw new Error('This image is too large for the browser preview. Choose a smaller image.')
    }
    throw reason
  }
  window.dispatchEvent(new CustomEvent(backgroundEvent, { detail: background }))
}

function publishBrowserStage(next: Stage) {
  browserStage = next
  channel?.postMessage({ type: 'stage', stage: next })
  window.dispatchEvent(new CustomEvent<Stage>('nemesa-stage', { detail: next }))
}

export async function listenStage(callback: (stage: Stage) => void) {
  if (desktop) return listen<Stage>('stage-updated', event => callback(event.payload))
  const local = (event: Event) => callback((event as CustomEvent<Stage>).detail)
  const remote = (event: MessageEvent) => {
    if (event.data?.type === 'stage') {
      browserStage = event.data.stage
      callback(browserStage)
    }
    if (location.hash.startsWith('#kiosk')) return
    if (event.data?.type === 'ready') {
      channel?.postMessage({ type: 'stage', stage: browserStage })
    }
    if (event.data?.type === 'report') {
      const { revision, playbackRevision, report } = event.data
      if (browserStage.revision !== revision || browserStage.playbackRevision !== playbackRevision || !isMedia(browserStage.cue)) return
      publishBrowserStage({
        ...browserStage,
        position: report.position,
        duration: report.duration,
        playing: browserStage.playing && !report.ended && !report.error,
        error: report.error ?? browserStage.error,
      })
    }
  }
  window.addEventListener('nemesa-stage', local)
  channel?.addEventListener('message', remote)
  if (location.hash.startsWith('#kiosk')) channel?.postMessage({ type: 'ready' })
  return () => {
    window.removeEventListener('nemesa-stage', local)
    channel?.removeEventListener('message', remote)
  }
}

export function getStage(): Promise<Stage> {
  return desktop ? invoke('get_stage') : Promise.resolve(browserStage)
}

export function present(cue: AudienceCue | null, expectedRevision?: number): Promise<Stage> {
  if (desktop) return invoke('present', { cue, expectedRevision })
  if (expectedRevision !== undefined && browserStage.revision !== expectedRevision) return Promise.resolve(browserStage)
  const next = {
    ...emptyStage,
    cue,
    blackout: browserStage.blackout,
    volume: browserStage.volume,
    muted: browserStage.muted,
    fade: browserStage.fade,
    revision: browserStage.revision + 1,
    playing: isMedia(cue),
  }
  publishBrowserStage(next)
  return Promise.resolve(next)
}

export async function setBlackout(blackout: boolean) {
  if (desktop) return invoke<Stage>('set_blackout', { blackout })
  const next = { ...browserStage, blackout }
  publishBrowserStage(next)
  return next
}

export async function controlPlayback(revision: number, action: PlaybackAction) {
  if (desktop) return invoke<Stage>('control_playback', { revision, action })
  const changesOutput = action.kind === 'volume' || action.kind === 'mute' || action.kind === 'fade'
  if (!changesOutput && (browserStage.revision !== revision || !isMedia(browserStage.cue))) return browserStage
  if ((action.kind === 'seek' || action.kind === 'skip') && browserStage.duration <= 0) return browserStage
  const next = { ...browserStage }
  let position: number | undefined
  switch (action.kind) {
    case 'play':
      next.playing = true
      next.error = null
      if (next.duration > 0 && next.position >= next.duration) position = 0
      break
    case 'stop':
      next.playing = false
      position = 0
      break
    case 'pause':
      next.playing = false
      break
    case 'seek':
      position = action.position
      break
    case 'skip':
      position = next.position + action.seconds
      break
    case 'volume':
      next.volume = Math.max(0, Math.min(action.volume, 1))
      break
    case 'mute':
      next.muted = action.muted
      break
    case 'fade':
      localStorage.setItem(fadeKey, String(action.enabled))
      next.fade = action.enabled
      break
  }
  if (!changesOutput) next.playbackRevision++
  if (position !== undefined) {
    next.position = Math.max(0, Math.min(position, next.duration))
    next.seek = { revision: next.playbackRevision, position: next.position }
  }
  publishBrowserStage(next)
  return next
}

export interface PlaybackReport {
  position: number
  duration: number
  ended: boolean
  error: string | null
}

export async function reportPlayback(revision: number, playbackRevision: number, report: PlaybackReport) {
  if (desktop) return invoke<void>('report_playback', { revision, playbackRevision, report })
  channel?.postMessage({ type: 'report', revision, playbackRevision, report })
}

export async function displays(): Promise<Display[]> {
  if (desktop) return invoke('list_displays')
  return [{ id: 'browser', name: 'Browser window', width: screen.width, height: screen.height, studio: false }]
}

export async function isKioskOpen() {
  return desktop ? invoke<boolean>('kiosk_open') : !!popup && !popup.closed
}

export async function listenKioskClosed(callback: () => void) {
  return desktop ? listen('kiosk-closed', callback) : () => {}
}

export async function openKiosk(displayId: string) {
  if (desktop) return invoke<void>('open_kiosk', { displayId })
  popup = window.open('/#kiosk', 'nemesa-kiosk', 'popup,width=1000,height=580')
  if (!popup) throw new Error('Allow pop-ups to open the preview Kiosk.')
  popup.focus()
}

export async function closeKiosk() {
  if (desktop) return invoke<void>('close_kiosk')
  popup?.close()
  popup = null
}

function fileInput(accept: string, folder = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.webkitdirectory = folder
    input.hidden = true
    const finish = () => {
      resolve(Array.from(input.files ?? []))
      input.remove()
    }
    input.onchange = finish
    input.oncancel = finish
    document.body.append(input)
    input.click()
  })
}

export function pickKioskBackground() {
  return pickBackground('Choose the Kiosk background')
}

async function pickBackground(title: Message): Promise<BackgroundImage | null> {
  if (desktop) return invoke('pick_kiosk_background', dialogLabels(title, 'Images'))
  const [file] = await fileInput('image/png,image/jpeg,image/webp')
  if (!file) return null
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.')
  }
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The selected image could not be read.'))
    reader.readAsDataURL(file)
  })
  return { name: file.name, url }
}

export const slideSettings = {
  load: () => desktop ? invoke<SlideSettings>('load_slide_settings') : loadBrowserSlideSettings(),
  saveDefault: async (kind: SlideKind, theme: Theme | null) => {
    if (desktop) await invoke<void>('save_default_slide_theme', { kind, theme })
    else {
      saveBrowserDefaultSlideTheme(kind, theme)
      channel?.postMessage({ type: slideSettingsEvent })
    }
  },
  importBackground: async () => {
    const background = await pickBackground('Choose a slide background')
    if (!background) return false
    await validateBackground(background.url)
    if (desktop) await invoke<void>('add_slide_background', { background })
    else {
      await addBrowserSlideBackground(background)
      channel?.postMessage({ type: slideSettingsEvent })
    }
    return true
  },
  listen: async (onUpdate: () => void) => {
    if (desktop) return listen(slideSettingsEvent, onUpdate)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === slideSettingsEvent) onUpdate()
    }
    channel?.addEventListener('message', onMessage)
    return () => channel?.removeEventListener('message', onMessage)
  },
}

const video = /\.(mp4|m4v|mov|webm|ogv)$/i
const audio = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i
const videoExtensions = '.mp4,.m4v,.mov,.webm,.ogv'
const audioExtensions = '.mp3,.m4a,.aac,.wav,.ogg,.oga,.flac,.opus'

function registerFile(file: File, scope: string): MediaFile | null {
  const kind = video.test(file.name) ? 'video' : audio.test(file.name) ? 'audio' : null
  if (!kind) return null
  const path = `${scope}/${file.webkitRelativePath || file.name}`
  browserFiles.set(path, file)
  return { name: file.name, kind, path }
}

export async function pickMedia(kind?: 'audio' | 'video') {
  if (desktop) {
    const filter = kind === 'audio' ? 'Audio' : kind === 'video' ? 'Video' : 'Audio and video'
    return invoke<MediaFile | null>('pick_media', { kind, ...dialogLabels('Open a media file', filter) })
  }
  const accept = kind === 'audio' ? audioExtensions : kind === 'video' ? videoExtensions : `${videoExtensions},${audioExtensions}`
  const [file] = await fileInput(accept)
  const item = file ? registerFile(file, crypto.randomUUID()) : null
  if (file && !item) throw new Error('Choose a supported audio or video file.')
  return item
}

export async function pickFolder() {
  if (desktop) return invoke<Source | null>('pick_folder', dialogLabels('Add a media source'))
  const files = await fileInput('', true)
  if (!files.length) return null
  const name = files[0].webkitRelativePath.split('/')[0]
  const id = crypto.randomUUID()
  files.forEach(file => registerFile(file, id))
  return { id, name, path: id }
}

export async function listMedia(source: Source) {
  if (desktop) return invoke<MediaFile[]>('list_media', { path: source.path })
  return Array.from(browserFiles.entries())
    .filter(([path]) => path.startsWith(`${source.path}/`))
    .map(([path, file]): MediaFile => ({ name: file.name, path, kind: video.test(file.name) ? 'video' : 'audio' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function mediaUrl(path: string) {
  if (desktop) return invoke<string>('authorize_media', { path })
  const file = browserFiles.get(path)
  if (!file) throw new Error('Select the media file again in this browser session.')
  let url = browserUrls.get(path)
  if (!url) {
    url = URL.createObjectURL(file)
    browserUrls.set(path, url)
  }
  return url
}

export async function resolveCue(cue: Exclude<Cue, TextCue> | AudienceTextCue): Promise<AudienceCue> {
  const base = { id: cue.id, title: cue.title, kind: cue.kind }
  if (cue.kind === 'text') return cue
  if (cue.kind === 'scripture') {
    const { translation, book, chapter, verse } = cue.reference
    const [books, chapterVerses] = await Promise.all([
      bible.books(translation),
      bible.verses(translation, book, chapter),
    ])
    const matchedBook = books.find(entry => entry.id === book)
    const matchedVerse = chapterVerses.find(row => row.verse === verse)
    if (!matchedBook || !matchedVerse?.text) throw new Error('This verse is unavailable in the selected translation.')
    return formatScriptureCue(cue, { ...matchedVerse, book: matchedBook, chapter })
  }
  return { ...base, kind: cue.kind, url: await mediaUrl(cue.path) }
}
