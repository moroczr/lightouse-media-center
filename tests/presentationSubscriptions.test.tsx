// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Kiosk from '../src/kiosk/Kiosk'
import * as bridge from '../src/shared/bridge'
import { LanguageProvider } from '../src/shared/i18n'
import { builtInSlideDefaults, emptyStage, type AudienceTextCue, type BackgroundImage, type Stage } from '../src/shared/model'
import { SlideThemesProvider } from '../src/shared/SlideThemes'
import Studio from '../src/studio/Studio'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function slide(text: string): AudienceTextCue {
  return { id: text, kind: 'text', title: text, text, theme: builtInSlideDefaults.text }
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  vi.spyOn(bridge, 'loadProject').mockResolvedValue({
    version: 1, activeId: 'service', playlists: [{ id: 'service', kind: 'playlist', title: 'Service', children: [] }],
    sources: [], slideLibraries: [], textLibrary: [], displayId: null,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function render(children: ReactNode) {
  await act(async () => root.render(
    <LanguageProvider><SlideThemesProvider>{children}</SlideThemesProvider></LanguageProvider>,
  ))
}

function expectBothOutputs(text: string) {
  expect(container.querySelector('.preview-panel--live .slide-text')?.textContent).toBe(text)
  expect(container.querySelector('.audience--output .slide-text')?.textContent).toBe(text)
}

it.each(['resolves', 'rejects'])('keeps the live stage in both windows when a late snapshot %s', async outcome => {
  const snapshot = deferred<Stage>()
  const load = vi.spyOn(bridge, 'getStage').mockReturnValue(snapshot.promise)
  await render(<><Studio /><Kiosk /></>)
  expect(load).toHaveBeenCalledTimes(2)

  await act(async () => { await bridge.present(slide('First cue')) })
  expectBothOutputs('First cue')
  await act(async () => { await bridge.present(slide('Latest cue')) })
  expectBothOutputs('Latest cue')

  await act(async () => {
    if (outcome === 'resolves') snapshot.resolve({ ...emptyStage, cue: slide('Old cue') })
    else snapshot.reject(new Error('Snapshot unavailable'))
  })
  expectBothOutputs('Latest cue')
  expect(container.querySelector('.problem')).toBeNull()
})

it('shows a rejected initial load in Studio and recovers in both windows on the next event', async () => {
  vi.spyOn(bridge, 'getStage').mockRejectedValue(new Error('Stage unavailable'))
  await render(<><Studio /><Kiosk /></>)
  expect(container.querySelector('.problem[role="alert"]')?.textContent).toContain('Could not sync live output: Stage unavailable')
  expect(container.querySelector('.audience--output')?.textContent).toBe('')

  await act(async () => { await bridge.present(slide('Recovered cue')) })
  expectBothOutputs('Recovered cue')
  expect(container.querySelector('.problem')).toBeNull()
})

it('reports listener registration failure without starting a snapshot', async () => {
  vi.spyOn(bridge, 'listenStage').mockRejectedValue(new Error('Listener unavailable'))
  const load = vi.spyOn(bridge, 'getStage')
  await render(<Studio />)
  expect(load).not.toHaveBeenCalled()
  expect(container.querySelector('.problem[role="alert"]')?.textContent).toContain('Listener unavailable')
})

it('releases late registrations once and only loads snapshots for the mounted Kiosk', async () => {
  const stageRegistration = deferred<() => void>()
  const backgroundRegistration = deferred<() => void>()
  const releaseStage = vi.fn()
  const releaseBackground = vi.fn()
  const stages = vi.spyOn(bridge, 'listenStage').mockReturnValueOnce(stageRegistration.promise)
  vi.spyOn(bridge, 'listenKioskBackground').mockReturnValueOnce(backgroundRegistration.promise)
  const loadStage = vi.spyOn(bridge, 'getStage').mockResolvedValue({ ...emptyStage, cue: slide('Current snapshot') })
  const loadBackground = vi.spyOn(bridge, 'loadKioskBackground').mockResolvedValue(null)

  await render(<Kiosk />)
  expect(loadStage).not.toHaveBeenCalled()
  expect(loadBackground).not.toHaveBeenCalled()
  await render(null)
  await render(<Kiosk />)
  await act(async () => {
    stageRegistration.resolve(releaseStage)
    backgroundRegistration.resolve(releaseBackground)
    stages.mock.calls[0][0]({ ...emptyStage, cue: slide('Obsolete listener') })
  })
  expect(releaseStage).toHaveBeenCalledTimes(1)
  expect(releaseBackground).toHaveBeenCalledTimes(1)
  expect(loadStage).toHaveBeenCalledTimes(1)
  expect(loadBackground).toHaveBeenCalledTimes(1)
  expect(container.querySelector('.audience--output .slide-text')?.textContent).toBe('Current snapshot')
})

it('keeps a background removal received while the saved image is loading', async () => {
  const snapshot = deferred<BackgroundImage | null>()
  vi.spyOn(bridge, 'getStage').mockResolvedValue(emptyStage)
  const load = vi.spyOn(bridge, 'loadKioskBackground').mockReturnValue(snapshot.promise)
  await render(<Kiosk />)
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => { await bridge.saveKioskBackground(null) })
  await act(async () => snapshot.resolve({ name: 'Old image', url: '/old.png' }))
  expect(container.querySelector('.audience-background')).toBeNull()
})
