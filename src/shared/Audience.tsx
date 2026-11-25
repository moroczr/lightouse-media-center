import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Monitor, Music2, Video } from 'lucide-react'
import { useLanguage } from './i18n'
import { getStage, listenStage, reportPlayback } from './bridge'
import { useSlideThemes } from './SlideThemes'
import { emptyStage, isBuiltInTheme, isMedia, type AudienceCue, type Stage } from './model'

export function useStage(initial: Stage = emptyStage) {
  const [stage, setStage] = useState(initial)

  useEffect(() => {
    let active = true
    let cleanup: (() => void) | undefined
    let receivedUpdate = false
    void listenStage(updated => {
      receivedUpdate = true
      if (active) setStage(updated)
    }).then(unlisten => {
      if (!active) {
        unlisten()
        return
      }
      cleanup = unlisten
      void getStage().then(current => {
        if (active && !receivedUpdate) setStage(current)
      })
    })
    return () => {
      active = false
      cleanup?.()
    }
  }, [])
  return stage
}

function SlideText({ cue }: { cue: Extract<AudienceCue, { text: string }> }) {
  const { settings } = useSlideThemes()
  const theme = isBuiltInTheme(cue.theme) ? cue.theme : 'image'
  const background = theme === 'image' ? settings?.backgrounds.find(image => image.id === cue.theme) : undefined
  const slide = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [heading, ...rest] = cue.text.split('\n')
  const welcomeLayout = cue.kind === 'text' && !cue.caption && rest.length === 1 && heading.length < 35 && rest[0].length < 80
  const textSize = cue.text.length < 75 ? 'large' : cue.text.length < 190 ? 'medium' : 'small'

  useLayoutEffect(() => {
    const surface = slide.current
    const body = content.current
    if (!surface || !body) return
    let active = true

    function fit() {
      if (!active || !surface || !body) return
      const style = getComputedStyle(surface)
      const height = surface.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      if (height <= 0) return
      body.style.setProperty('--slide-scale', '1')
      if (body.scrollHeight <= height + 1) return
      let low = 0
      let high = 1
      for (let iteration = 0; iteration < 12; iteration++) {
        const candidate = (low + high) / 2
        body.style.setProperty('--slide-scale', String(candidate))
        if (body.scrollHeight > height) high = candidate
        else low = candidate
      }
      body.style.setProperty('--slide-scale', String(low))
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(surface)
    void document.fonts.ready.then(fit)
    return () => { active = false; observer.disconnect() }
  }, [cue.text, cue.caption])

  return (
    <div ref={slide} className={`slide slide--${theme} slide--${cue.kind} slide--${textSize}`}>
      {background && <div className="slide-background" aria-hidden="true"><img src={background.url} alt="" /></div>}
      <div ref={content} className="slide-content">
        {cue.text && <div className="slide-text">{welcomeLayout ? heading : cue.text}</div>}
        {welcomeLayout && <div className="slide-subtitle">{rest[0]}</div>}
        {cue.caption && <div className="slide-caption">{cue.caption}</div>}
      </div>
    </div>
  )
}

interface AudienceProps {
  cue: AudienceCue | null
  stage?: Stage
  background?: string
  output?: boolean
}

export function Audience({ cue, stage, background, output = false }: AudienceProps) {
  const { t } = useLanguage()
  const media = useRef<HTMLMediaElement | null>(null)
  const lastReport = useRef(0)
  const initialized = useRef(false)
  const appliedSeek = useRef<number | undefined>(undefined)
  const appliedPlayback = useRef(0)
  const revision = stage?.revision ?? 0
  const playbackRevision = stage?.playbackRevision ?? 0
  const seek = stage?.seek
  const playing = stage?.playing ?? false
  const blackout = stage?.blackout ?? false
  const muted = stage?.muted ?? false
  const volume = stage?.volume ?? 1
  const shouldPlay = playing && (output || !blackout)
  const position = stage?.position ?? 0
  const [previewError, setPreviewError] = useState(false)

  function setPosition(element: HTMLMediaElement, requested: number) {
    const target = Number.isFinite(element.duration) ? Math.min(requested, element.duration) : requested
    if (Math.abs(element.currentTime - target) > 0.01) element.currentTime = target
  }

  function synchronizePosition(element: HTMLMediaElement) {
    if (element.readyState < 1) return
    if (!initialized.current) {
      setPosition(element, position)
      initialized.current = true
    } else if (seek && appliedSeek.current !== seek.revision) {
      setPosition(element, seek.position)
    }
    appliedSeek.current = seek?.revision
  }

  function report(element: HTMLMediaElement, error: string | null = null) {
    if (!output || appliedPlayback.current !== playbackRevision) return
    if (!error && (!initialized.current || element.seeking || appliedSeek.current !== seek?.revision)) return
    void reportPlayback(revision, playbackRevision, {
      position: element.currentTime || 0,
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      ended: element.ended,
      error,
    })
  }

  useLayoutEffect(() => {
    if (output && media.current) media.current.volume = volume
  }, [output, volume])

  useEffect(() => {
    const element = media.current
    if (!element) return
    appliedPlayback.current = playbackRevision
    synchronizePosition(element)
    if (!shouldPlay) {
      element.pause()
      report(element)
      return
    }
    if (!element.paused) return
    let active = true
    void element.play().catch(error => {
      if (active && error.name !== 'AbortError') {
        report(element, 'Playback could not start. Try Play or check the file format.')
      }
    })
    return () => { active = false }
  }, [shouldPlay, playbackRevision])

  useEffect(() => {
    const element = media.current
    if (!output && stage && element && initialized.current && !element.seeking
      && Math.abs(element.currentTime - position) > 0.75) {
      setPosition(element, position)
    }
  }, [position, output, stage])

  const mediaProps = {
    ref: (element: HTMLMediaElement | null) => { media.current = element },
    preload: cue?.kind === 'video' && !output ? 'auto' : 'metadata',
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const element = event.currentTarget
      appliedPlayback.current = playbackRevision
      synchronizePosition(element)
      report(element)
    },
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const now = performance.now()
      if (now - lastReport.current < 350) return
      lastReport.current = now
      report(event.currentTarget)
    },
    onSeeked: (event: React.SyntheticEvent<HTMLMediaElement>) => report(event.currentTarget),
    onPause: (event: React.SyntheticEvent<HTMLMediaElement>) => report(event.currentTarget),
    onEnded: (event: React.SyntheticEvent<HTMLMediaElement>) => report(event.currentTarget),
    onError: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      setPreviewError(true)
      report(event.currentTarget, 'The media file could not be played on this device.')
    },
  }

  const backgroundImage = background && <img className="audience-background" src={background} alt="" />

  return (
    <div className={`audience${output ? ' audience--output' : ''}`}>
      {!cue && !blackout && (backgroundImage || (!output && (
        <div className="slide-empty"><Monitor size={24} /><span>{t('No cue selected')}</span></div>
      )))}
      {cue && !isMedia(cue) && <SlideText cue={cue} />}
      {cue?.kind === 'video' && (
        <>
          <video {...mediaProps} src={cue.url} muted={!output || muted} playsInline />
          {previewError && !output && <div className="slide-empty slide-overlay"><Video size={24} /><span>{t('Preview unavailable')}</span></div>}
        </>
      )}
      {cue?.kind === 'audio' && (output
        ? <audio {...mediaProps} src={cue.url} muted={muted} />
        : <div className="slide-empty"><Music2 size={26} /><span>{cue.title}</span></div>)}
      {blackout && <div className="slide-blackout">{backgroundImage}</div>}
    </div>
  )
}
