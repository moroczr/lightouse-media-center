// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as bridge from '../src/shared/bridge'
import { translate, writeLanguage } from '../src/shared/messages'
import { LanguageProvider } from '../src/shared/i18n'
import type { Project } from '../src/shared/model'
import { SlideThemesProvider } from '../src/shared/SlideThemes'
import Studio from '../src/studio/Studio'

const saved: Project = {
  version: 1, activeId: 'service', displayId: null, slideLibraries: [], textLibrary: [],
  playlists: [{ id: 'service', kind: 'playlist', title: 'Saved service', children: [] }],
  sources: [
    { id: 'audio', name: 'Audio', path: '/audio' },
    { id: 'video', name: 'Video', path: '/video' },
  ],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await bridge.saveProject(saved)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function openStudio() {
  await act(async () => root.render(
    <LanguageProvider><SlideThemesProvider><Studio /></SlideThemesProvider></LanguageProvider>,
  ))
}

function button(label: string) {
  const element = Array.from(container.querySelectorAll('button')).find(item =>
    (item.getAttribute('aria-label') ?? item.textContent) === label)
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}

async function openDialog(label: string) {
  // jsdom does not implement native dialog open/close methods.
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
  HTMLDialogElement.prototype.close ??= function () { this.open = false }
  await act(async () => button(label).click())
}

async function editSearch(input: HTMLInputElement, value: string) {
  await act(async () => {
    // Use the native setter to simulate editing a React-controlled input.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('keeps editor controls, shortcuts and autosave inactive until the saved workspace loads', async () => {
  const load = deferred<Project>()
  vi.spyOn(bridge, 'loadProject').mockReturnValueOnce(load.promise)
  const save = vi.spyOn(bridge, 'saveProject')
  await openStudio()
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading workspace…')
  expect(container.querySelector('button, input, select, textarea')).toBeNull()
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  })
  expect(container.querySelector('dialog, [role="tablist"]')).toBeNull()
  expect(save).not.toHaveBeenCalled()

  await act(async () => load.resolve(saved))
  expect(button('Rename playlist Saved service')).toBeTruthy()
  expect(save.mock.calls.map(([project]) => project)).toEqual([saved])
})

it('preserves stored data on load failure and opens it when Retry succeeds', async () => {
  const load = vi.spyOn(bridge, 'loadProject').mockRejectedValueOnce(new Error('Storage unavailable'))
  const save = vi.spyOn(bridge, 'saveProject')
  await openStudio()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Storage unavailable')
  expect(Array.from(container.querySelectorAll('button'), item => item.textContent)).toEqual(['Retry'])
  expect(save).not.toHaveBeenCalled()

  await act(async () => button('Retry').click())
  expect(load).toHaveBeenCalledTimes(2)
  expect(button('Remove source Video')).toBeTruthy()
  expect(save.mock.calls.map(([project]) => project)).toEqual([saved])
})

it('keeps a saved workspace with no playlists available for recovery', async () => {
  await bridge.saveProject({ ...saved, playlists: [] })
  const save = vi.spyOn(bridge, 'saveProject')
  await openStudio()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Invalid workspace format.')
  expect(button('Retry')).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
  await expect(bridge.loadProject()).rejects.toThrow('Invalid workspace format.')
})

it('saves two rapid edits in order while the first write is pending', async () => {
  await openStudio()
  const firstWrite = deferred<void>()
  const write = bridge.saveProject
  const save = vi.spyOn(bridge, 'saveProject').mockImplementationOnce(async project => {
    await firstWrite.promise
    await write(project)
  })

  await act(async () => button('Remove source Audio').click())
  await act(async () => button('Remove source Video').click())
  expect(container.querySelector('.source-row')).toBeNull()
  expect(save.mock.calls.map(([project]) => project.sources)).toEqual([[saved.sources[1]]])
  expect(await bridge.loadProject()).toEqual(saved)

  await act(async () => firstWrite.resolve())
  expect(save.mock.calls.map(([project]) => project.sources)).toEqual([[saved.sources[1]], []])
  expect(await bridge.loadProject()).toEqual({ ...saved, sources: [] })
})

async function press(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  await act(async () => { target.dispatchEvent(event) })
  return event.defaultPrevented
}

it.each([
  { label: 'Presentation workspace', opener: null },
  { label: 'Settings sections', opener: 'Settings' },
  { label: 'Cue sources', opener: 'Add cue' },
])('supports keyboard navigation and linked panels in $label', async ({ label, opener }) => {
  await openStudio()
  if (opener) await openDialog(opener)
  const list = container.querySelector<HTMLElement>(`[role="tablist"][aria-label="${label}"]`)!
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')!)!)
  const last = tabs.length - 1

  function expectSelected(index: number) {
    expect(document.activeElement).toBe(tabs[index])
    tabs.forEach((tab, i) => {
      expect(tab.getAttribute('aria-selected')).toBe(String(i === index))
      expect(tab.tabIndex).toBe(i === index ? 0 : -1)
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBe(panels[i])
      expect(panels[i].getAttribute('role')).toBe('tabpanel')
      expect(panels[i].getAttribute('aria-labelledby')).toBe(tab.id)
      expect(panels[i].hidden).toBe(i !== index)
    })
  }

  if (opener === 'Add cue') expect(document.activeElement).toBe(tabs[0])
  tabs[0].focus()
  expectSelected(0)
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
    expect(await press(tabs[0], 'ArrowLeft', { [modifier]: true })).toBe(false)
    expectSelected(0)
  }
  for (const [key, index] of [
    ['ArrowLeft', last], ['ArrowRight', 0], ['ArrowRight', 1], ['End', last], ['Home', 0],
  ] as const) {
    expect(await press(document.activeElement!, key)).toBe(true)
    expectSelected(index)
  }
  await act(async () => tabs[1].click())
  expectSelected(1)
  if (opener === 'Add cue') {
    expect(await press(tabs[1], 'b', { ctrlKey: true })).toBe(true)
    expectSelected(2)
  }
})

it('focuses the Media search field from the Studio shortcut and preserves it across tab changes', async () => {
  await openStudio()
  const mediaTab = container.querySelector<HTMLButtonElement>('[role="tab"][aria-keyshortcuts="Control+M"]')!
  const panel = document.getElementById(mediaTab.getAttribute('aria-controls')!)!
  const search = panel.querySelector<HTMLInputElement>('input[type="search"]')!

  expect(await press(window, 'm', { ctrlKey: true })).toBe(true)
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
  expect(panel.hidden).toBe(false)
  expect(document.activeElement).toBe(search)
  await editSearch(search, 'morning')
  await press(mediaTab, 'Home')
  expect(panel.hidden).toBe(true)
  await act(async () => mediaTab.click())
  expect(panel.hidden).toBe(false)
  expect(panel.querySelector('input[type="search"]')).toBe(search)
  expect(search.value).toBe('morning')
})

it.each([
  { scope: 'workspace', language: 'en' },
  { scope: 'cue-picker', language: 'hu' },
] as const)('keeps layout choices and searches independent in $scope', async ({ scope, language }) => {
  writeLanguage(language)
  vi.spyOn(bridge, 'listMedia').mockResolvedValue([{ kind: 'audio', name: 'Morning', path: '/audio/morning.mp3' }])
  vi.spyOn(bridge.bible, 'settings').mockResolvedValue({
    defaultId: 'test', databases: [{ id: 'test', name: 'Test', enabled: true, fileName: null }],
  })
  vi.spyOn(bridge.bible, 'books').mockResolvedValue([{ id: 'GEN', name: 'Genesis', chapters: 1 }])
  await bridge.saveProject({ ...saved, slideLibraries: ['Services'] })
  await openStudio()
  if (scope === 'cue-picker') await openDialog(translate(language, 'Add cue'))

  for (const [id, groupLabel, gridLabel, gridSelector] of [
    ['media', 'Media view', 'Tile view', '.media-entries--tile'],
    ['text', 'Text slide view', 'Mosaic view', '.text-library-grid'],
    ['scripture', 'Bible view', 'Mosaic view', '.media-entries--tile'],
  ] as const) {
    const tab = document.getElementById(`${scope}-tab-${id}`)!
    await act(async () => tab.click())
    const panel = document.getElementById(tab.getAttribute('aria-controls')!)!
    const group = panel.querySelector(`[role="group"][aria-label="${translate(language, groupLabel)}"]`)!
    const list = group.querySelector<HTMLButtonElement>(`[aria-label="${translate(language, 'List view')}"]`)!
    const grid = group.querySelector<HTMLButtonElement>(`[aria-label="${translate(language, gridLabel)}"]`)!
    const search = panel.querySelector<HTMLInputElement>('.search-box input')!

    expect(list.getAttribute('aria-pressed')).toBe('true')
    expect(grid.getAttribute('aria-pressed')).toBe('false')
    await act(async () => grid.click())
    expect(panel.querySelector(gridSelector)).not.toBeNull()
    expect(list.getAttribute('aria-pressed')).toBe('false')
    expect(grid.getAttribute('aria-pressed')).toBe('true')
    for (const other of container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${translate(language, 'List view')}"]`)) {
      if (other !== list) expect(other.getAttribute('aria-pressed')).toBe('true')
    }

    await editSearch(search, 'morning')
    await act(async () => list.click())
    expect(panel.querySelector('.search-box input')).toBe(search)
    expect(search.value).toBe('morning')
    expect(list.getAttribute('aria-pressed')).toBe('true')
    expect(grid.getAttribute('aria-pressed')).toBe('false')
    expect(panel.querySelector(gridSelector)).toBeNull()
  }
})

it.each(['List view', 'Mosaic view'])('opens slide sets and presents the chosen entry in %s', async view => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  await bridge.present(null)
  await bridge.saveProject({ ...saved, slideLibraries: ['Songs'], textLibrary: [{
    folder: 'Songs', slide: { kind: 'text', id: 'song', title: 'Morning song', captionFromFirstEntry: true,
      entries: [
        { id: 'caption', text: 'Morning song' }, { id: 'one', text: 'First verse' },
        { id: 'two', text: 'Second verse' }, { id: 'three', text: 'Final verse' },
      ] },
  }] })
  await openStudio()
  const panel = container.querySelector<HTMLElement>('#workspace-panel-text')!
  const click = async (element: HTMLElement, detail = 1, type = 'click') => {
    await act(async () => { element.dispatchEvent(new MouseEvent(type, { detail, bubbles: true })) })
  }
  const row = (title: string) => panel.querySelector<HTMLButtonElement>(`.text-library-row-main[title="${title}"]`)!
  const preview = () => container.querySelector('.preview-panel--next .slide-text')?.textContent
  const live = () => container.querySelector('.preview-panel--live .slide-text')?.textContent
  await click(button('Slides'))
  await click(row('Songs'))
  await click(panel.querySelector<HTMLButtonElement>(`button[aria-label="${view}"]`)!)
  await act(async () => row('Morning song').focus())
  expect(await press(document.activeElement!, ' ')).toBe(false)
  expect((await bridge.getStage()).cue).toBeNull()
  await click(row('Morning song'))
  expect(panel.querySelector('[aria-current="location"]')?.textContent).toBe('Morning song')
  expect(Array.from(panel.querySelectorAll('.text-library-row-main strong'), el => el.textContent))
    .toEqual(['First verse', 'Second verse', 'Final verse'])

  // The second click of a double-click on the set may land on a newly rendered row.
  await click(row('First verse'), 2)
  await click(row('First verse'), 2, 'dblclick')
  expect((await bridge.getStage()).cue).toBeNull()
  await click(row('Second verse'))
  expect(preview()).toBe('Second verse')
  expect(live()).toBeUndefined()
  await click(row('Second verse'), 2)
  await click(row('Second verse'), 2, 'dblclick')
  expect(live()).toBe('Second verse')
  expect(container.querySelector('.preview-panel--live .slide-caption')?.textContent).toBe('Morning song')
  await click(button('Next slide'))
  expect(live()).toBe('Final verse')

  HTMLElement.prototype.scrollIntoView ??= () => {}
  const search = panel.querySelector<HTMLInputElement>('input[type="search"]')!
  search.focus()
  await press(search, 'ArrowDown')
  await press(document.activeElement!, 'ArrowUp')
  expect(document.activeElement).toBe(row('First verse'))
  expect(preview()).toBe('First verse')
  expect(live()).toBe('Final verse')
  expect(await press(document.activeElement!, ' ')).toBe(true)
  expect(live()).toBe('First verse')
  expect((await bridge.getStage()).cue).toMatchObject({ kind: 'text', text: 'First verse' })

  await editSearch(search, 'Second')
  await click(row('Second verse'))
  expect(preview()).toBe('Second verse')
  expect(live()).toBe('First verse')
  await click(button('Go live'))
  expect(live()).toBe('Second verse')
  expect(button('Previous slide').disabled).toBe(false)
  await click(Array.from(panel.querySelectorAll<HTMLButtonElement>('.text-library-path button')).find(el => el.textContent === 'Songs')!)
  expect(row('Morning song')).toBeTruthy()
  expect(live()).toBe('Second verse')
})

it.each(['Space', 'Go live'])('opens the passage after presenting a Bible text match with %s', async action => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  await bridge.present(null)
  const book = { id: 'GEN', name: 'Genesis', chapters: 2 }
  const chapterOne = [{ verse: 1, text: 'First match' }, { verse: 2, text: 'Middle' }, { verse: 3, text: 'Last match' }]
  const chapterTwo = Array.from({ length: 12 }, (_, i) => ({ verse: i + 1, text: `Following verse ${i + 1}` }))
  vi.spyOn(bridge.bible, 'settings').mockResolvedValue({
    defaultId: 'test', databases: [{ id: 'test', name: 'Test', enabled: true, fileName: null }],
  })
  vi.spyOn(bridge.bible, 'books').mockResolvedValue([book])
  vi.spyOn(bridge.bible, 'verses').mockImplementation(async (_id, _book, chapter) => chapter === 1 ? chapterOne : chapterTwo)
  const search = vi.spyOn(bridge.bible, 'search').mockResolvedValue([chapterOne[0], chapterOne[2]].map(verse => ({ ...verse, book, chapter: 1 })))
  await openStudio()
  await act(async () => button('Bible lookup').click())
  const panel = container.querySelector<HTMLElement>('#workspace-panel-scripture')!
  const mode = Array.from(panel.querySelectorAll('button')).find(el => el.textContent === 'Verse text')!
  await act(async () => mode.click())
  const input = panel.querySelector<HTMLInputElement>('.search-box input')!
  await editSearch(input, 'match')
  const list = (label: string) => panel.querySelector(`ul[aria-label="${label}"]`)
  const rows = () => Array.from(panel.querySelectorAll<HTMLButtonElement>('.verse-result'))
  await act(async () => { await vi.waitFor(() => expect(search).toHaveBeenCalledWith('test', 'match')) })
  expect(rows()).toHaveLength(2)
  await act(async () => rows()[1].click())
  expect(list('Matching verses')).toBeTruthy()
  expect(container.querySelector('.preview-panel--next .slide-text')?.textContent).toBe('Last match')
  expect((await bridge.getStage()).cue).toBeNull()

  const activate = () => action === 'Space'
    ? press(rows()[1], ' ')
    : act(async () => button('Go live').click())
  vi.spyOn(bridge, 'present').mockRejectedValueOnce(new Error('Could not send'))
  await activate()
  expect(list('Matching verses')).toBeTruthy()
  expect(input.value).toBe('match')
  await activate()
  expect((await bridge.getStage()).cue).toMatchObject({ kind: 'scripture', title: 'Genesis 1:3' })
  expect(list('Matching verses')).toBeNull()
  expect(input.value).toBe('Genesis 1:3')
  expect(rows().slice(0, 3).map(row => row.querySelector('strong')?.textContent))
    .toEqual(['Genesis 1:3', 'Genesis 2:1', 'Genesis 2:2'])
  expect(document.activeElement).toBe(rows()[0])
  await press(document.activeElement!, 'ArrowDown')
  expect(container.querySelector('.preview-panel--next .slide-text')?.textContent).toBe('Following verse 1')
  expect((await bridge.getStage()).cue?.title).toBe('Genesis 1:3')
  await act(async () => mode.click())
  expect(input.value).toBe('match')
  expect(list('Matching verses')).toBeTruthy()
})
