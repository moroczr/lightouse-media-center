export type Theme = 'plain' | 'twilight' | 'violet'

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
}

export interface Translation {
  id: string
  name: string
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

export type Cue = ItemBase & (
  | { kind: 'text'; text: string; theme: Theme }
  | { kind: 'scripture'; reference: Reference; theme: Theme }
  | { kind: 'video' | 'audio'; path: string }
)

export type Group = ItemBase & { kind: 'playlist'; children: Item[] }
export type Item = Cue | Group
export type ItemKind = Item['kind']

export interface Project {
  version: 1
  playlists: Group[]
  sources: Source[]
  activeId: string
  displayId: string | null
}

export interface KioskBackground {
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

export type AudienceCue = ItemBase & (
  | { kind: 'text' | 'scripture'; text: string; caption?: string; theme: Theme }
  | { kind: 'video' | 'audio'; url: string }
)

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

export const kindNames: Record<ItemKind, string> = {
  text: 'Text slide',
  scripture: 'Scripture',
  video: 'Video',
  audio: 'Audio',
  playlist: 'Nested playlist',
}

export function flatten(items: Item[]): Cue[] {
  return items.flatMap(item => item.kind === 'playlist' ? flatten(item.children) : [item])
}

export function findItem(items: Item[], id: string | null): Item | undefined {
  for (const item of items) {
    if (item.id === id) return item
    if (item.kind === 'playlist') {
      const found = findItem(item.children, id)
      if (found) return found
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

export function mediaCue(file: MediaFile): Cue {
  return { id: crypto.randomUUID(), kind: file.kind, title: file.name.replace(/\.[^.]+$/, ''), path: file.path }
}

export function isMedia(cue: AudienceCue | null): cue is Extract<AudienceCue, { url: string }> {
  return !!cue && 'url' in cue
}

export function clockTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export const welcome: Cue = {
  id: 'welcome',
  title: 'Welcome',
  kind: 'text',
  text: 'Welcome\nWe’re glad you’re here',
  theme: 'twilight',
}

export const welcomePreview: AudienceCue = {
  id: welcome.id,
  title: welcome.title,
  kind: 'text',
  text: welcome.text,
  theme: welcome.theme,
}

export const starterProject: Project = {
  version: 1,
  activeId: 'sunday',
  displayId: null,
  sources: [],
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
            { id: 'call', title: 'Call to Worship', kind: 'text', text: 'Let us worship together', theme: 'twilight' },
            { id: 'prayer', title: 'Prayer', kind: 'text', text: 'Let us pray', theme: 'plain' },
          ],
        },
        { id: 'announcements', title: 'Announcements', kind: 'text', text: 'Announcements', theme: 'violet' },
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
