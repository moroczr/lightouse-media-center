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
  expect(await press(' ')).toBe(false)
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
    saving={false} error="" busy={false} theme="plain" view="grid" onViewChange={vi.fn()}
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

it('sends the arrow-selected media file live with Space or Ctrl+Enter', async () => {
  vi.spyOn(bridge, 'listMedia').mockResolvedValue([file])
  const live = vi.fn()
  const preview = vi.fn()
  await render(<MediaBrowser sources={[source]} filter="all" onFilterChange={vi.fn()} view="list"
    onViewChange={vi.fn()} busy={false} onPreview={preview} onLive={live} />)
  await act(async () => container.querySelector<HTMLButtonElement>('.media-result')!.click())
  expect(document.activeElement).toBe(container.querySelector('input[type="search"]'))
  await press('ArrowDown')
  expect(document.activeElement?.textContent).toContain(file.name)
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining(file))
  expect(await press('Enter')).toBe(false)
  expect(await press(' ', { ctrlKey: true })).toBe(false)
  expect(live).not.toHaveBeenCalled()
  expect(await press(' ')).toBe(true)
  expect(await press(' ', { repeat: true })).toBe(true)
  expect(live).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(file))
  container.querySelector<HTMLInputElement>('input[type="search"]')!.focus()
  expect(await press(' ')).toBe(false)
  expect(live).toHaveBeenCalledTimes(1)
  live.mockClear()
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

it('moves focus from a completed Bible reference to the previewed verse and sends it live with Space', async () => {
  const book = { id: 'GEN', name: 'Genesis', chapters: 1 }
  vi.spyOn(bridge.bible, 'settings').mockResolvedValue({
    defaultId: 'test', databases: [{ id: 'test', name: 'Test', enabled: true, fileName: null }],
  })
  vi.spyOn(bridge.bible, 'books').mockResolvedValue([book])
  vi.spyOn(bridge.bible, 'verses').mockResolvedValue(
    Array.from({ length: 14 }, (_, i) => ({ verse: i + 1, text: `Verse ${i + 1}` })),
  )
  const preview = vi.fn()
  const live = vi.fn()
  await render(<ScriptureEditor active settingsRevision={0} busy={false}
    view="list" onViewChange={vi.fn()} onPreview={preview} onLive={live} />)
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Genesis 1:1')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(input.getAttribute('aria-expanded')).toBe('true')
  expect(await press(' ')).toBe(false)
  expect(await press('ArrowDown')).toBe(true)
  expect(document.activeElement?.textContent).toContain('Genesis 1:1')
  expect(await press('ArrowDown')).toBe(true)
  expect(document.activeElement?.textContent).toContain('Genesis 1:2')
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Genesis 1:2' }))
  expect(live).not.toHaveBeenCalled()
  expect(await press(' ')).toBe(true)
  expect(live).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    reference: { translation: 'test', book: 'GEN', chapter: 1, verse: 2 },
  }))
})

it.each(['list', 'grid'] as const)('browses books and chapters before presenting a verse in %s view', async view => {
  const book = { id: 'GEN', name: 'Genesis', chapters: 2 }
  vi.spyOn(bridge.bible, 'settings').mockResolvedValue({
    defaultId: 'test', databases: [{ id: 'test', name: 'Test', enabled: true, fileName: null }],
  })
  vi.spyOn(bridge.bible, 'books').mockResolvedValue([book])
  vi.spyOn(bridge.bible, 'verses').mockResolvedValue([{ verse: 1, text: 'First' }, { verse: 2, text: 'Second' }])
  const live = vi.fn()
  const preview = vi.fn()
  await render(<ScriptureEditor active settingsRevision={0} busy={false}
    view={view} onViewChange={vi.fn()} onPreview={preview} onLive={live} />)
  const rows = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>(`ul[aria-label="${label}"] [data-result-button]`))
  const click = async (button: HTMLButtonElement, detail: number, type = 'click') => {
    await act(async () => { button.dispatchEvent(new MouseEvent(type, { detail, bubbles: true })) })
  }

  const input = container.querySelector<HTMLInputElement>('.search-box input')!
  await act(async () => input.focus())
  expect(await press('ArrowDown')).toBe(true)
  expect(document.activeElement).toBe(rows('Bible books')[0])
  await click(rows('Bible books')[0], 1)
  expect(document.activeElement).toBe(input)
  expect(await press('ArrowDown')).toBe(true)
  expect(document.activeElement).toBe(rows('Chapters')[0])
  await click(rows('Chapters')[0], 2)
  expect(rows('Chapters')).toHaveLength(2)
  await act(async () => rows('Chapters')[0].focus())
  if (view === 'grid') {
    // Use an explicit grid width because jsdom does not compute CSS grid tracks.
    container.querySelector<HTMLUListElement>('ul[aria-label="Chapters"]')!.style.gridTemplateColumns = '120px 120px'
  }
  await press(view === 'grid' ? 'ArrowRight' : 'ArrowDown')
  expect(document.activeElement).toBe(rows('Chapters')[1])
  await click(rows('Chapters')[1], 1)
  expect(document.activeElement).toBe(input)
  expect(await press('ArrowDown')).toBe(true)
  expect(document.activeElement).toBe(rows('Verses')[0])
  await click(rows('Verses')[0], 2)
  await click(rows('Verses')[0], 2, 'dblclick')
  expect(live).not.toHaveBeenCalled()
  const verse = rows('Verses')[1]
  await click(verse, 1)
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Genesis 2:2' }))
  await click(verse, 2)
  await click(verse, 2, 'dblclick')
  expect(live).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Genesis 2:2' }))
})

it('uses the selected media row for drag preview and live actions and disables sending while busy', async () => {
  vi.spyOn(bridge, 'listMedia').mockResolvedValue([file])
  const live = vi.fn()
  const preview = vi.fn()
  const startDrag = vi.fn()
  const panel = (busy: boolean) => <MediaBrowser sources={[source]} filter="all" onFilterChange={vi.fn()}
    view="list" onViewChange={vi.fn()} busy={busy} onPreview={preview} onLive={live} onCuePointerDown={startDrag} />
  await render(panel(false))
  await act(async () => container.querySelector<HTMLButtonElement>('.media-result')!.click())
  const row = container.querySelector<HTMLButtonElement>('.media-result')!
  await act(async () => { row.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
  expect(startDrag).toHaveBeenCalledOnce()
  const [, drag] = startDrag.mock.calls[0]
  await act(async () => drag.preview())
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining(file))
  expect(live).not.toHaveBeenCalled()
  await act(async () => drag.live())
  expect(live).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(file))

  await render(panel(true))
  const busyRow = container.querySelector<HTMLButtonElement>('.media-result')!
  await act(async () => container.querySelector<HTMLInputElement>('input[type="search"]')!.focus())
  expect(await press('ArrowDown')).toBe(true)
  expect(document.activeElement).toBe(busyRow)
  await act(async () => { busyRow.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
  await press(' ')
  expect(startDrag).toHaveBeenCalledTimes(1)
  expect(live).toHaveBeenCalledTimes(1)
  expect(container.querySelector<HTMLButtonElement>('.result-send')!.disabled).toBe(true)
})

it('keeps a newer text search open when an earlier verse finishes going live', async () => {
  const book = { id: 'GEN', name: 'Genesis', chapters: 1 }
  vi.spyOn(bridge.bible, 'settings').mockResolvedValue({
    defaultId: 'test', databases: [{ id: 'test', name: 'Test', enabled: true, fileName: null }],
  })
  vi.spyOn(bridge.bible, 'books').mockResolvedValue([book])
  const search = vi.spyOn(bridge.bible, 'search').mockImplementation(async (_translation, text) => [
    { book, chapter: 1, verse: text === 'first' ? 1 : 2, text },
  ])
  let finish!: (success: boolean) => void
  const live = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  await render(<ScriptureEditor active settingsRevision={0} busy={false}
    view="list" onViewChange={vi.fn()} onLive={live} />)
  const mode = container.querySelector<HTMLButtonElement>('.scripture-modes button[aria-keyshortcuts="/"]')!
  await act(async () => mode.click())
  const input = container.querySelector<HTMLInputElement>('.search-box input')!
  async function lookup(text: string) {
    await act(async () => {
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { await vi.waitFor(() => expect(search).toHaveBeenCalledWith('test', text)) })
  }
  await lookup('first')
  await act(async () => container.querySelector<HTMLButtonElement>('.result-send')!.click())
  expect(live).toHaveBeenCalledOnce()
  await lookup('second')
  await act(async () => finish(true))
  expect(input.value).toBe('second')
  expect(container.querySelector('ul[aria-label="Matching verses"] strong')?.textContent).toBe('Genesis 1:2')
  expect(document.activeElement).toBe(input)
})

it('starts a fresh Bible search with either displayed shortcut, including in the current mode', async () => {
  const book = { id: 'GEN', name: 'Genesis', chapters: 50 }
  vi.spyOn(bridge.bible, 'settings').mockResolvedValue({
    defaultId: 'test', databases: [{ id: 'test', name: 'Test', enabled: true, fileName: null }],
  })
  vi.spyOn(bridge.bible, 'books').mockResolvedValue([book])
  await render(<ScriptureEditor active settingsRevision={0} busy={false} view="list" onViewChange={vi.fn()} />)
  const input = container.querySelector<HTMLInputElement>('.search-box input')!
  const mode = (key: string) => container.querySelector<HTMLButtonElement>(`.scripture-modes button[aria-keyshortcuts="${key}"]`)!
  const edit = async (value: string, data: string, inputType = 'insertText') => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data, inputType }))
    })
  }
  expect(mode('@').textContent).toContain('Reference @')
  expect(mode('/').textContent).toContain('Verse text /')
  await act(async () => input.focus())
  await edit('Genesis 2:', 'Genesis 2:', 'insertFromPaste')
  expect(await press('/')).toBe(true)
  expect(mode('/').getAttribute('aria-pressed')).toBe('true')
  expect(input.value).toBe('')
  await edit('light', 'light')
  expect(await press('@', { shiftKey: true })).toBe(true)
  expect(mode('@').getAttribute('aria-pressed')).toBe('true')
  expect(input.value).toBe('')
  expect(document.activeElement).toBe(input)
  await edit('Genesis 3:', 'Genesis 3:', 'insertFromPaste')
  expect(await press('@')).toBe(true)
  expect(input.value).toBe('')
  expect(await press('/', { ctrlKey: true })).toBe(false)
  expect(await press('/', { isComposing: true })).toBe(false)
  expect(mode('@').getAttribute('aria-pressed')).toBe('true')
  await edit('/', '/')
  expect(mode('/').getAttribute('aria-pressed')).toBe('true')
  expect(input.value).toBe('')
  await edit('light', 'light')
  expect(await press('/')).toBe(true)
  expect(input.value).toBe('')
  await edit('again', 'again')
  await edit('again/', '/')
  expect(input.value).toBe('')
  await edit('light/shines', 'light/shines', 'insertFromPaste')
  expect(input.value).toBe('light/shines')
  expect(document.activeElement).toBe(input)
})

it('searches all media libraries from the root and only the current subtree inside a library', async () => {
  const sources = [source, { id: 'video', name: 'Video', path: '/video' }]
  const scan = vi.spyOn(bridge, 'listMedia').mockImplementation(async library => library.id === 'music'
    ? [{ name: 'Morning song', kind: 'audio', path: '/music/Music/Services/Morning.mp3' }]
    : [{ name: 'Morning film', kind: 'video', path: '/video/Video/Services/Morning.mp4' }])
  const live = vi.fn()
  await render(<MediaBrowser sources={sources} filter="all" onFilterChange={vi.fn()}
    view="list" onViewChange={vi.fn()} busy={false} onLive={live} />)
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
  const labels = () => Array.from(container.querySelectorAll('.media-result strong'), el => el.textContent)
  async function type(value: string) {
    await act(async () => {
      search.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value)
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  expect(labels()).toEqual(['Music', 'Video'])
  expect(scan).not.toHaveBeenCalled()
  await type('morning')
  expect(labels()).toEqual(['Morning film', 'Morning song'])
  await type('services')
  expect(labels()).toEqual(['Morning film', 'Morning song'])
  expect(scan).toHaveBeenCalledTimes(2)
  expect(await press('ArrowDown')).toBe(true)
  expect(document.activeElement?.textContent).toContain('Morning film')
  expect(await press(' ')).toBe(true)
  expect(live).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Morning film' }))
  await type('music')
  expect(labels()).toEqual(['Music', 'Morning song'])
  await act(async () => container.querySelector<HTMLButtonElement>('.media-result')!.click())
  await type('morning')
  expect(labels()).toEqual(['Morning song'])
  await type('video')
  expect(labels()).toEqual([])
  expect(await press('ArrowDown')).toBe(false)
  expect(document.activeElement).toBe(search)
})

it.each(['keep the query', 'edit the query', 'move focus'])(
  'handles Down Arrow during a Media scan when operators %s',
  async action => {
    let finishScan!: (files: MediaFile[]) => void
    vi.spyOn(bridge, 'listMedia').mockImplementation(() => new Promise(resolve => { finishScan = resolve }))
    await render(<MediaBrowser sources={[source]} filter="all" onFilterChange={vi.fn()}
      view="list" onViewChange={vi.fn()} busy={false} onLive={vi.fn()} />)
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!
    async function type(value: string) {
      await act(async () => {
        input.focus()
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await type('morn')
    expect(await press('ArrowDown')).toBe(true)
    expect(document.activeElement).toBe(input)
    const otherButton = container.querySelector<HTMLButtonElement>('.media-segment button')!
    if (action === 'edit the query') await type('morning')
    if (action === 'move focus') await act(async () => otherButton.focus())

    await act(async () => finishScan([file]))
    const row = container.querySelector('[data-result-button]')
    expect(row?.textContent).toContain(file.name)
    const expected = action === 'keep the query' ? row : action === 'move focus' ? otherButton : input
    expect(document.activeElement).toBe(expected)
  },
)
