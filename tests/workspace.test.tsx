// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as bridge from '../src/shared/bridge'
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
