export const builtInThemes = [
  { id: 'plain', label: 'Black' },
  { id: 'twilight', label: 'Twilight' },
  { id: 'violet', label: 'Violet' },
  { id: 'midnight', label: 'Midnight Blue' },
  { id: 'forest', label: 'Forest' },
  { id: 'ember', label: 'Ember' },
  { id: 'slate', label: 'Slate' },
] as const

export type BuiltInTheme = (typeof builtInThemes)[number]['id']
export type ImageTheme = `image:${string}`
export type Theme = BuiltInTheme | ImageTheme
export type SlideKind = 'text' | 'scripture'

export const builtInSlideDefaults = { text: 'twilight', scripture: 'violet' } as const satisfies Record<SlideKind, BuiltInTheme>

export function isBuiltInTheme(theme: string): theme is BuiltInTheme {
  return builtInThemes.some(({ id }) => id === theme)
}

export interface SlideBackground extends BackgroundImage {
  id: ImageTheme
}

export interface SlideSettings {
  defaultThemes: Record<SlideKind, Theme | null>
  backgrounds: SlideBackground[]
}

export interface Reference {
  translation: string
  book: string
  chapter: number
  verse: number
}

export interface Book {
  id: string
  name: string
  chapters: number
  abbreviation?: string
  alternateName?: string
}

export interface Translation {
  id: string
  name: string
}

export interface BibleDatabase extends Translation {
  fileName: string | null
  enabled: boolean
}

export interface BiblePreferences {
  disabledIds: string[]
  defaultId: string | null
}

export interface BibleSettings {
  databases: BibleDatabase[]
  defaultId: string | null
}

export interface Verse {
  verse: number
  text: string
}

export interface Source {
  id: string
  name: string
  path: string
}

export interface MediaFile {
  kind: 'video' | 'audio'
  name: string
  path: string
}

interface ItemBase {
  id: string
  title: string
}

export interface TextEntry {
  id: string
  text: string
}

export type TextSlide = ItemBase & {
  kind: 'text'
  entries: TextEntry[]
  showCaption?: false
  captionFromFirstEntry?: true
}
export interface LibraryTextSlide {
  folder: string
  slide: TextSlide
}

export type TextCue = ItemBase & { kind: 'text'; text: string; caption?: string }
export type ScriptureCue = ItemBase & { kind: 'scripture'; reference: Reference; theme: Theme }
type MediaCue = ItemBase & { kind: 'video' | 'audio'; path: string }

export type Cue = TextCue | ScriptureCue | MediaCue
export type Group = ItemBase & { kind: 'playlist'; children: Item[] }
export type Item = TextSlide | ScriptureCue | MediaCue | Group
export type ItemKind = Item['kind']

export interface Project {
  version: 1
  playlists: Group[]
  sources: Source[]
  textLibrary: LibraryTextSlide[]
  slideLibraries: string[]
  activeId: string
  displayId: string | null
}

export interface BackgroundImage {
  name: string
  url: string
}

export interface Display {
  id: string
  name: string
  width: number
  height: number
  studio: boolean
}

export type AudienceTextCue = TextCue & { theme: Theme }
export type AudienceScriptureCue = ScriptureCue & { text: string; caption: string }

export type AudienceCue = AudienceTextCue | AudienceScriptureCue | (ItemBase & { kind: 'video' | 'audio'; url: string })

export type PlaybackAction =
  | { kind: 'play' | 'pause' | 'stop' }
  | { kind: 'seek'; position: number }
  | { kind: 'skip'; seconds: number }
  | { kind: 'volume'; volume: number }
  | { kind: 'mute'; muted: boolean }

export interface Stage {
  revision: number
  playbackRevision: number
  seek: { revision: number; position: number } | null
  cue: AudienceCue | null
  blackout: boolean
  playing: boolean
  duration: number
  position: number
  volume: number
  muted: boolean
  error: string | null
}

export const emptyStage: Stage = {
  revision: 0,
  playbackRevision: 0,
  seek: null,
  cue: null,
  blackout: false,
  playing: false,
  duration: 0,
  position: 0,
  volume: 1,
  muted: false,
  error: null,
}

export const kindNames = {
  text: 'Text slide',
  scripture: 'Scripture',
  video: 'Video',
  audio: 'Audio',
  playlist: 'Nested playlist',
} as const satisfies Record<ItemKind, string>

type LegacyTextSlide = Omit<TextCue, 'caption'> & { theme?: Theme }
type SavedTextSlide = TextSlide & { caption?: string; theme?: Theme }
type SavedGroup = Omit<Group, 'children'> & {
  children: (Exclude<Item, Group | TextSlide> | SavedTextSlide | LegacyTextSlide | SavedGroup)[]
}
export type SavedProject = Omit<Project, 'playlists' | 'textLibrary' | 'slideLibraries'> & {
  playlists: SavedGroup[]
  slideLibraries?: string[]
  textLibrary?: (Omit<LibraryTextSlide, 'slide'> & { slide: SavedTextSlide; name?: string })[]
}

function migrateTextSlide({ id, title, text }: LegacyTextSlide): TextSlide {
  return { id, title, kind: 'text', entries: [{ id: `${id}:entry`, text }], showCaption: false }
}

function normalizeTextSlide({ caption, theme: _theme, ...slide }: SavedTextSlide): TextSlide {
  if (caption === undefined) return slide
  const title = slide.captionFromFirstEntry ? textCueTitle(slide.entries[0]?.text ?? '') : caption
  return { ...slide, title: title || slide.title }
}

export function normalizeProject(project: SavedProject): Project {
  function migrateGroup(group: SavedGroup): Group {
    return {
      ...group,
      children: group.children.map(item => {
        if (item.kind === 'playlist') return migrateGroup(item)
        if (item.kind === 'text') return 'text' in item ? migrateTextSlide(item) : normalizeTextSlide(item)
        return item
      }),
    }
  }
  const libraries = new Map<string, string>()
  function registerLibrary(path: string) {
    const key = path.toLocaleLowerCase()
    const name = libraries.get(key) ?? path
    libraries.set(key, name)
    return name
  }
  for (const path of project.slideLibraries ?? []) {
    const name = normalizeTextSlideFolder(path)
    if (name) registerLibrary(name)
  }
  const textLibrary = (project.textLibrary ?? []).map(({ folder, slide }) => ({
    folder: registerLibrary(normalizeTextSlideFolder(folder) || 'Unfiled'),
    slide: normalizeTextSlide(slide),
  }))
  return {
    ...project,
    textLibrary,
    slideLibraries: [...libraries.values()],
    playlists: project.playlists.map(migrateGroup),
  }
}

export function textCueTitle(text: string) {
  return text.trimStart().split(/\r?\n/, 1)[0].slice(0, 100)
}

export function textSlideCues(slide: TextSlide): TextCue[] {
  const firstEntry = slide.captionFromFirstEntry ? slide.entries[0] : undefined
  const caption = firstEntry?.text ?? (slide.showCaption === false ? undefined : slide.title)
  const entries = firstEntry && slide.entries.length > 1 ? slide.entries.slice(1) : slide.entries
  return entries.map(entry => ({
    id: entry.id,
    kind: 'text',
    title: textCueTitle(entry.text),
    text: entry === firstEntry ? '' : entry.text,
    caption,
  }))
}

export function normalizeTextSlideFolder(folder: string) {
  return folder.split('/').map(part => part.trim()).filter(Boolean).join('/')
}

export function copyLibraryTextSlide({ slide }: LibraryTextSlide): TextSlide {
  return {
    ...slide,
    id: crypto.randomUUID(),
    entries: slide.entries.map(entry => ({ ...entry, id: crypto.randomUUID() })),
  }
}

export function flatten(items: Item[]): Cue[] {
  return items.flatMap<Cue>(item => {
    if (item.kind === 'playlist') return flatten(item.children)
    if (item.kind === 'text') return textSlideCues(item)
    return [item]
  })
}

export function findCueAncestors(items: Item[], cueId: string): string[] | undefined {
  for (const item of items) {
    if (item.kind === 'playlist') {
      const ancestors = findCueAncestors(item.children, cueId)
      if (ancestors) return [item.id, ...ancestors]
    } else if (item.kind === 'text') {
      if (textSlideCues(item).some(cue => cue.id === cueId)) return [item.id]
    } else if (item.id === cueId) {
      return []
    }
  }
}

export function updateGroup(group: Group, id: string, update: (group: Group) => Group): Group {
  if (group.id === id) return update(group)
  return {
    ...group,
    children: group.children.map(item => item.kind === 'playlist' ? updateGroup(item, id, update) : item),
  }
}

export function mediaCue(file: MediaFile): MediaCue {
  return { id: crypto.randomUUID(), kind: file.kind, title: file.name.replace(/\.[^.]+$/, ''), path: file.path }
}

export function isMedia(cue: AudienceCue | null): cue is Extract<AudienceCue, { url: string }> {
  return !!cue && 'url' in cue
}

export function clockTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const welcome = migrateTextSlide({
  id: 'welcome',
  title: 'Welcome',
  kind: 'text',
  text: 'Welcome\nWe’re glad you’re here',
})

export const welcomePreview = textSlideCues(welcome)[0]

export const starterProject: Project = {
  version: 1,
  activeId: 'sunday',
  displayId: null,
  sources: [],
  textLibrary: [],
  slideLibraries: [],
  playlists: [
    {
      id: 'sunday',
      kind: 'playlist',
      title: 'Sunday Service',
      children: [
        welcome,
        {
          id: 'opening-scripture',
          kind: 'scripture',
          title: 'Psalm 46:10',
          reference: { translation: 'WEBP', book: 'PSA', chapter: 46, verse: 10 },
          theme: 'violet',
        },
        {
          id: 'worship',
          kind: 'playlist',
          title: 'Worship',
          children: [
            migrateTextSlide({ id: 'call', title: 'Call to Worship', kind: 'text', text: 'Let us worship together' }),
            migrateTextSlide({ id: 'prayer', title: 'Prayer', kind: 'text', text: 'Let us pray' }),
          ],
        },
        migrateTextSlide({ id: 'announcements', title: 'Announcements', kind: 'text', text: 'Announcements' }),
        {
          id: 'closing',
          kind: 'playlist',
          title: 'Closing',
          children: [
            {
              id: 'blessing', title: 'Closing Blessing', kind: 'scripture', theme: 'plain',
              reference: { translation: 'WEBP', book: 'NUM', chapter: 6, verse: 24 },
            },
          ],
        },
      ],
    },
  ],
}
