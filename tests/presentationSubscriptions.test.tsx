// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Kiosk from '../src/kiosk/Kiosk'
import { Audience } from '../src/shared/Audience'
import { Preview } from '../src/studio/Preview'
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

it('shows the audio background and equalizer in Studio and Kiosk while keeping playback in Kiosk', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const cue = { id: 'song', kind: 'audio', title: 'Song', url: '/song.mp3' } as const
  const show = (stage: Stage, background?: string) => render(<>
    <Preview stage={stage} next={cue} standby={null} background={background} nextError="" kiosk busy={false}
      dropTarget={null} browserDrag={false} onBlackout={vi.fn()} onNavigateVerse={vi.fn()} onPlayback={vi.fn()} />
    <Audience stage={stage} cue={cue} background={background} output />
  </>)
  const stage = { ...emptyStage, cue, playing: true }
  await show(stage, '/first.jpg')
  const outputs = ['.preview-panel--live', '.preview-panel--next', '.audience--output']
  for (const selector of outputs) {
    expect(container.querySelector(selector + ' .audience-background')?.getAttribute('src')).toBe('/first.jpg')
    expect(container.querySelector(selector + ' .audio-equalizer')?.getAttribute('data-playing'))
      .toBe(String(selector !== '.preview-panel--next'))
  }
  const audio = container.querySelector('.audience--output audio')
  expect(audio).toBeTruthy()
  expect(container.querySelectorAll('audio')).toHaveLength(1)

  await show({ ...stage, playing: false }, '/second.jpg')
  expect(container.querySelector('.audio-equalizer[data-playing="true"]')).toBeNull()
  await show({ ...stage, blackout: true }, '/second.jpg')
  for (const selector of ['.preview-panel--live', '.audience--output']) {
    expect(container.querySelector(selector + ' .audio-equalizer')).toBeNull()
    expect(container.querySelector(selector + ' .slide-blackout img')?.getAttribute('src')).toBe('/second.jpg')
  }
  expect(container.querySelector('audio')).toBe(audio)
  await show(stage)
  expect(container.querySelector('.audience-background')).toBeNull()
  expect(container.querySelector('.audience--output .audio-equalizer[data-playing="true"]')).toBeTruthy()
})

it('restores the last Fade setting in a fresh browser session', async () => {
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} })
  vi.resetModules()
  let session = await import('../src/shared/bridge')
  for (const enabled of [true, false]) {
    await session.controlPlayback(0, { kind: 'fade', enabled })
    vi.resetModules()
    session = await import('../src/shared/bridge')
    expect(await session.getStage()).toMatchObject({ fade: enabled, cue: null, playing: false })
  }
})

it('fades Kiosk audio for mute and transport while preserving the selected volume', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  const playing = new WeakSet<HTMLMediaElement>()
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) {
    return !playing.has(this)
  })
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
    playing.add(this)
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this)
  })
  const click = async (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
  }
  const tick = async (ms: number) => { await act(async () => vi.advanceTimersByTime(ms)) }

  try {
    await bridge.controlPlayback(0, { kind: 'volume', volume: 0.6 })
    await bridge.present({ id: 'song', kind: 'audio', title: 'Song', url: '/song.mp3' })
    await render(<><Studio /><Kiosk /></>)
    const audio = container.querySelector('audio')!
    const fade = container.querySelector<HTMLInputElement>('.media-fade input')!
    const slider = container.querySelector<HTMLInputElement>('input[aria-label="Kiosk volume"]')!
    expect(audio.volume).toBe(0.6)
    expect(fade.checked).toBe(false)

    await click('Mute Kiosk audio')
    expect(audio.muted).toBe(true)
    await click('Mute Kiosk audio')
    expect(audio.muted).toBe(false)
    await act(async () => fade.click())
    expect((await bridge.getStage()).fade).toBe(true)

    await click('Mute Kiosk audio')
    expect(audio.volume).toBe(0.6)
    await tick(500)
    expect(audio.volume).toBeCloseTo(0.3)
    expect(audio.muted).toBe(false)
    const volumeDuringMute = audio.volume
    await click('Mute Kiosk audio')
    expect(audio.volume).toBe(volumeDuringMute)
    await tick(1000)
    expect(audio.volume).toBe(0.6)

    await click('Mute Kiosk audio')
    await tick(1000)
    expect(audio.volume).toBe(0)
    expect(audio.muted).toBe(true)
    expect(slider.value).toBe('60')
    await click('Mute Kiosk audio')
    await tick(500)
    expect(audio.volume).toBeCloseTo(0.3)
    await tick(500)
    expect(audio.volume).toBe(0.6)

    audio.currentTime = 12
    await click('Pause media')
    await tick(500)
    expect(audio.paused).toBe(false)
    expect(audio.volume).toBeCloseTo(0.3)
    await tick(500)
    expect(audio.paused).toBe(true)
    expect(audio.currentTime).toBe(12)

    await click('Play media')
    expect(audio.paused).toBe(false)
    expect(audio.volume).toBe(0)
    await tick(1000)
    expect(audio.volume).toBe(0.6)

    await click('Stop media')
    await tick(500)
    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(12)
    await tick(500)
    expect(audio.paused).toBe(true)
    expect(audio.currentTime).toBe(0)
    expect(audio.volume).toBe(0)

    await act(async () => { await bridge.present(null) })
    expect((await bridge.getStage()).fade).toBe(true)
    expect(slider.value).toBe('60')
  } finally {
    await act(async () => {
      await bridge.present(null)
      await bridge.controlPlayback(0, { kind: 'fade', enabled: false })
      await bridge.controlPlayback(0, { kind: 'mute', muted: false })
      await bridge.controlPlayback(0, { kind: 'volume', volume: 1 })
    })
    vi.useRealTimers()
  }
})
