import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Ban, ChevronLeft, ChevronRight, Monitor, Pause, Play, RotateCcw, RotateCw, Square, Volume2, VolumeX } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError } from '../shared/messages'
import { Audience } from '../shared/Audience'
import { adjacentVerses } from '../shared/bridge'
import { clockTime, isMedia, type AudienceCue, type PlaybackAction, type Reference, type Stage } from '../shared/model'
import type { PassageVerse } from '../shared/scripture'
import type { CueDropTarget } from './useCueDrag'

interface PreviewProps {
  stage: Stage
  standby: AudienceCue | null
  background?: string
  next: AudienceCue | null
  nextError: string
  browsing: boolean
  kiosk: boolean
  busy: boolean
  dropTarget: CueDropTarget | null
  browserDrag: boolean
  onBlackout: () => void
  onNavigateVerse: (verse: PassageVerse) => void
  textNavigation?: { index: number; total: number; onMove: (direction: -1 | 1) => void }
  onPlayback: (action: PlaybackAction) => void
}

function CueDropScreen({ children, target, prompt, active }: {
  children: ReactNode; target?: CueDropTarget; prompt: string; active: boolean;
}) {
  return (
    <div className="preview-screen" data-cue-drop-target={target}>
      {children}
      {target && active && <div className="cue-drop-prompt" aria-hidden="true">{prompt}</div>}
    </div>
  )
}

function MediaPlayback({ stage, onAction }: {
  stage: Stage
  onAction: (action: PlaybackAction) => void
}) {
  const { t } = useLanguage()
  const timeline = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const duration = stage.duration
  const position = Math.min(draft ?? stage.position, duration)
  const canSeek = duration > 0

  useEffect(() => {
    const input = timeline.current
    if (!input) return
    // The native change event commits a drag after the final input event.
    const commit = () => {
      onAction({ kind: 'seek', position: input.valueAsNumber })
      setDraft(null)
    }
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [onAction])

  return (
    <div className="live-controls media-playback" role="group" aria-label={t('Media playback')}>
      <div className="media-playback-buttons">
        <button className="icon-button" aria-label={t('Play media')} title={t('Start or resume playback')} disabled={stage.playing} onClick={() => onAction({ kind: 'play' })}><Play size={16} /></button>
        <button className="icon-button" aria-label={t('Pause media')} title={t('Pause playback')} disabled={!stage.playing} onClick={() => onAction({ kind: 'pause' })}><Pause size={16} /></button>
        <button className="icon-button" aria-label={t('Stop media')} title={t('Stop and rewind')} onClick={() => onAction({ kind: 'stop' })}><Square size={15} /></button>
        <button className="button media-skip" aria-label={t('Back 10 seconds')} title={t('Back 10 seconds')} disabled={!canSeek} onClick={() => onAction({ kind: 'skip', seconds: -10 })}><RotateCcw size={15} /><span>{t('10s')}</span></button>
        <button className="button media-skip" aria-label={t('Forward 10 seconds')} title={t('Forward 10 seconds')} disabled={!canSeek} onClick={() => onAction({ kind: 'skip', seconds: 10 })}><RotateCw size={15} /><span>{t('10s')}</span></button>
      </div>
      <div className="media-scrubber">
        <span className="media-time">{clockTime(position)}</span>
        <input
          ref={timeline}
          className="media-timeline"
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={position}
          disabled={!canSeek}
          aria-label={t('Playback position')}
          aria-valuetext={t('{position} of {duration}', { position: clockTime(position), duration: clockTime(duration) })}
          onChange={event => setDraft(event.currentTarget.valueAsNumber)}
          onBlur={() => setDraft(null)}
        />
        <span className="media-time">{clockTime(duration)}</span>
      </div>
    </div>
  )
}

function VerseNavigation({ reference, busy, onSelect }: {
  reference: Reference
  busy: boolean
  onSelect: (verse: PassageVerse) => void
}) {
  const { t } = useLanguage()
  const { translation, book, chapter, verse } = reference
  const key = `${translation}/${book}/${chapter}/${verse}`
  const [result, setResult] = useState<{
    key: string; neighbors?: Awaited<ReturnType<typeof adjacentVerses>>
  }>()
  const current = result?.key === key ? result : undefined
  const { previous, next } = current?.neighbors ?? {}

  useEffect(() => {
    let active = true
    void adjacentVerses({ translation, book, chapter, verse }).then(neighbors => {
      if (active) setResult({ key, neighbors })
    }).catch(() => {
      if (active) setResult({ key })
    })
    return () => { active = false }
  }, [translation, book, chapter, verse, key])

  return (
    <div className="live-controls step-navigation" role="group" aria-label={t('Live verse navigation')} aria-busy={!current}>
      <button type="button" className="button" aria-label={t('Previous verse')} title={t('Previous verse')}
        disabled={busy || !previous} onClick={() => previous && onSelect(previous)}>
        <ChevronLeft size={16} aria-hidden="true" /><span>{t('Previous verse')}</span>
      </button>
      <button type="button" className="button" aria-label={t('Next verse')} title={t('Next verse')}
        disabled={busy || !next} onClick={() => next && onSelect(next)}>
        <span>{t('Next verse')}</span><ChevronRight size={16} aria-hidden="true" />
      </button>
      {current && !current.neighbors && <span role="status">{t('Could not load adjacent verses.')}</span>}
    </div>
  )
}

function KioskVolume({ stage, onAction }: {
  stage: Stage
  onAction: (action: PlaybackAction) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<number | null>(null)
  const appliedVolume = Math.round(stage.volume * 100)
  const volume = draft ?? appliedVolume

  useEffect(() => {
    if (draft === appliedVolume) setDraft(null)
  }, [draft, appliedVolume])

  return (
    <div className="media-audio" role="group" aria-label={t('Kiosk audio')}>
      <span className="media-time">{volume}%</span>
      <div className="media-volume-track">
        <input
          className="media-volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          aria-label={t('Kiosk volume')}
          aria-orientation="vertical"
          title={t('Kiosk volume')}
          aria-valuetext={`${volume}%`}
          onChange={event => {
            const value = event.currentTarget.valueAsNumber
            setDraft(value)
            onAction({ kind: 'volume', volume: value / 100 })
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
      <button
        className={`icon-button${stage.muted ? ' media-mute-active' : ''}`}
        aria-label={t('Mute Kiosk audio')}
        aria-pressed={stage.muted}
        title={stage.muted ? t('Unmute Kiosk audio') : t('Mute Kiosk audio')}
        onClick={() => onAction({ kind: 'mute', muted: !stage.muted })}
      >
        {stage.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
    </div>
  )
}

export function Preview(props: PreviewProps) {
  const { t } = useLanguage()
  const { stage } = props
  const live = props.kiosk && !!stage.cue && !stage.blackout
  const media = isMedia(stage.cue)
  const audience = stage.cue ?? (props.background ? null : props.standby)
  const { textNavigation } = props
  const status = stage.blackout ? 'Blackout' : live ? 'Live' : stage.cue ? 'Staged' : 'Standby'

  return (
    <div className="preview-grid">
      <section className="preview-panel preview-panel--live" aria-labelledby="live-heading">
        <header className="preview-heading">
          <h2 id="live-heading"><Monitor size={15} /> {t('Live output')}</h2>
          <span className={`status-pill${live ? ' status-pill--live' : ''}`}><span />{t(status)}</span>
        </header>
        <CueDropScreen target={props.busy ? undefined : 'live'} active={props.dropTarget === 'live'} prompt={t('Drop to go live')}>
          <Audience key={stage.revision} cue={audience} background={props.background} stage={props.kiosk ? stage : { ...stage, playing: false }} />
          <button type="button" className="button preview-blackout" aria-label={t('Blackout')} aria-pressed={stage.blackout}
            onClick={props.onBlackout} aria-keyshortcuts="Control+Shift+B" title={t('Toggle blackout (Ctrl+Shift+B)')}><Ban size={16} aria-hidden="true" /><span>{t('Blackout')}</span></button>
        </CueDropScreen>
      </section>
      <section className="preview-panel preview-panel--next" aria-labelledby="next-heading">
        <header className="preview-heading">
          <h2 id="next-heading"><ChevronRight size={17} /> {t('Next up')}</h2>
          {props.next && <span className="status-pill status-pill--next">{t(props.browsing ? 'Preview' : 'Queued')}</span>}
        </header>
        <CueDropScreen target="next" active={props.dropTarget === 'next'} prompt={t(props.browserDrag ? 'Drop to preview' : 'Drop to queue')}>
          <Audience key={props.next?.id ?? 'empty'} cue={props.next} />
          {props.nextError && <div className="slide-empty slide-overlay" role="status">{translateError(t, props.nextError)}</div>}
        </CueDropScreen>
      </section>
      <KioskVolume stage={stage} onAction={props.onPlayback} />
      <div className="live-transport">
        {media && <MediaPlayback key={stage.revision} stage={stage} onAction={props.onPlayback} />}
        {stage.cue?.kind === 'scripture' && (
          <VerseNavigation reference={stage.cue.reference} busy={props.busy} onSelect={props.onNavigateVerse} />
        )}
        {textNavigation && (
          <div className="live-controls step-navigation" role="group" aria-label={t('Live text slide navigation')}>
            <button type="button" className="button" aria-label={t('Previous slide')} title={t('Previous slide')}
              disabled={props.busy || textNavigation.index === 0} onClick={() => textNavigation.onMove(-1)}>
              <ChevronLeft size={16} aria-hidden="true" /><span>{t('Previous slide')}</span>
            </button>
            <button type="button" className="button" aria-label={t('Next slide')} title={t('Next slide')}
              disabled={props.busy || textNavigation.index + 1 === textNavigation.total} onClick={() => textNavigation.onMove(1)}>
              <span>{t('Next slide')}</span><ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
