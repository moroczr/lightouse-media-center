// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as bridge from '../src/shared/bridge'
import { LanguageProvider } from '../src/shared/i18n'
import type { LibraryTextSlide, MediaFile } from '../src/shared/model'
import { SlideThemesProvider } from '../src/shared/SlideThemes'
import { MediaBrowser } from '../src/studio/MediaBrowser'
import { ScriptureEditor } from '../src/studio/ScriptureEditor'
import { TextSlideLibrary } from '../src/studio/TextSlideLibrary'

const source = { id: 'music', name: 'Music', path: '/music' }
const file: MediaFile = { name: 'Morning', kind: 'audio', path: '/music/morning.mp3' }
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLElement.prototype.scrollIntoView ??= () => {}
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render(panel: ReactNode) {
  await act(async () => root.render(
    <LanguageProvider><SlideThemesProvider>{panel}</SlideThemesProvider></LanguageProvider>,
  ))
}

async function press(key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  await act(async () => { document.activeElement!.dispatchEvent(event) })
  return event.defaultPrevented
}

it('leaves focus in an empty search and picks a single media result only on Enter', async () => {
  vi.spyOn(bridge, 'listMedia').mockResolvedValue([file])
  const pick = vi.fn()
  const picker = (filter: 'video' | 'all') => <MediaBrowser sources={[source]} filter={filter}
    onFilterChange={vi.fn()} view="list" onViewChange={vi.fn()} busy={false} onSave={pick} />

  await render(picker('video'))
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
  search.focus()
  expect(await press('ArrowDown')).toBe(false)
  expect(document.activeElement).toBe(search)
  expect(await press('Enter')).toBe(false)

  await render(picker('all'))
  const row = container.querySelector('.media-result')!
  expect(await press('ArrowDown')).toBe(true)
  expect(document.activeElement).toBe(row)
  await press('ArrowUp')
  await press('ArrowDown')
  expect(document.activeElement).toBe(row)
  expect(await press('ArrowLeft')).toBe(false)
  expect(await press('Enter', { ctrlKey: true })).toBe(false)
  expect(pick).not.toHaveBeenCalled()
  expect(await press('Enter')).toBe(true)
  expect(pick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(file))
})

it('moves through a partial slide grid and returns from search to the selected result', async () => {
  const items: LibraryTextSlide[] = Array.from({ length: 5 }, (_, i) => ({
    folder: 'Library', slide: { kind: 'text', id: String(i), title: `Slide ${i + 1}`, entries: [] },
  }))
  const pick = vi.fn()
  await render(<TextSlideLibrary active items={items} libraries={['Library']} initialFolder="Library"
    saving={false} error="" busy={false} theme="plain" view="mosaic" onViewChange={vi.fn()}
    actions={{ kind: 'pick', onAdd: pick }} />)
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
  const grid = container.querySelector('ul')!
  grid.style.gridTemplateColumns = '100px 100px 100px'
  const rows = Array.from(grid.querySelectorAll('button'))
  search.focus()
  expect(await press('ArrowRight')).toBe(false)
  expect(document.activeElement).toBe(search)
  await press('ArrowUp')
  expect(document.activeElement).toBe(rows[4])
  await press('ArrowUp')
  await press('ArrowRight')
  expect(document.activeElement).toBe(rows[2])
  await press('ArrowRight')
  expect(document.activeElement).toBe(rows[2])
  await press('ArrowDown')
  expect(document.activeElement).toBe(rows[4])
  await press('ArrowLeft')
  await press('ArrowLeft')
  expect(document.activeElement).toBe(rows[3])
  search.focus()
  await press('ArrowDown')
  expect(document.activeElement).toBe(rows[3])
  expect(pick).not.toHaveBeenCalled()
  await press('Enter')
  expect(pick).toHaveBeenCalledExactlyOnceWith(items[3])
})

it('opens a media folder and sends the selected file live only on Ctrl+Enter', async () => {
  vi.spyOn(bridge, 'listMedia').mockResolvedValue([file])
  const live = vi.fn()
  await render(<MediaBrowser sources={[source]} filter="all" onFilterChange={vi.fn()} view="list"
    onViewChange={vi.fn()} busy={false} onLive={live} />)
  await act(async () => container.querySelector<HTMLButtonElement>('.media-result')!.click())
  expect(document.activeElement).toBe(container.querySelector('input[type="search"]'))
  await press('ArrowDown')
  expect(document.activeElement?.textContent).toContain(file.name)
  expect(await press('Enter')).toBe(false)
  expect(live).not.toHaveBeenCalled()
  expect(await press('Enter', { ctrlKey: true })).toBe(true)
  expect(live).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(file))
})

it('pages past both ends of the displayed verse window without submitting a cue', async () => {
  const book = { id: 'GEN', name: 'Genesis', chapters: 1 }
  vi.spyOn(bridge.bible, 'settings').mockResolvedValue({
    defaultId: 'test', databases: [{ id: 'test', name: 'Test', enabled: true, fileName: null }],
  })
  vi.spyOn(bridge.bible, 'books').mockResolvedValue([book])
  vi.spyOn(bridge.bible, 'verses').mockResolvedValue(
    Array.from({ length: 14 }, (_, i) => ({ verse: i + 1, text: `Verse ${i + 1}` })),
  )
  const save = vi.fn()
  const cue = { id: 'verse', kind: 'scripture', title: 'Genesis 1:1', theme: 'violet',
    reference: { translation: 'test', book: book.id, chapter: 1, verse: 1 } } as const
  await render(<ScriptureEditor existing={cue} active settingsRevision={0} busy={false}
    view="list" onViewChange={vi.fn()} onSave={save} />)
  const rows = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.verse-result'))
  expect(rows()).toHaveLength(10)
  await act(async () => rows().at(-1)!.focus())
  await press('ArrowDown')
  expect(rows()).toHaveLength(10)
  expect(rows()[0].querySelector('strong')?.textContent).toBe('Genesis 1:2')
  expect(document.activeElement).toBe(rows().at(-1))
  expect(document.activeElement?.querySelector('strong')?.textContent).toBe('Genesis 1:11')

  await act(async () => rows()[0].focus())
  await press('ArrowUp')
  expect(document.activeElement).toBe(rows()[0])
  expect(document.activeElement?.querySelector('strong')?.textContent).toBe('Genesis 1:1')
  expect(save).not.toHaveBeenCalled()
  await press('Enter')
  expect(save).toHaveBeenCalledExactlyOnceWith(cue)
})
