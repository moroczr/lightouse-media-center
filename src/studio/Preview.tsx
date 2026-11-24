import { useEffect, useRef, useState } from 'react'
import { Ban, ChevronLeft, ChevronRight, Monitor, Pause, Play, RadioTower, RotateCcw, RotateCw, Square, Volume2, VolumeX } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError } from '../shared/messages'
import { Audience } from '../shared/Audience'
import { adjacentVerses } from '../shared/bridge'
import { clockTime, isMedia, type AudienceCue, type PlaybackAction, type Reference, type Stage } from '../shared/model'
import type { PassageVerse } from '../shared/scripture'
import { ItemIcon } from './CueList'

interface PreviewProps {
  stage: Stage
  standby: AudienceCue | null
  background?: string
  next: AudienceCue | null
  nextTitle?: string
  nextError: string
  kiosk: boolean
  busy: boolean
  canGoLive: boolean
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  onGoLive: () => void
  onBlackout: () => void
  onNavigateVerse: (verse: PassageVerse) => void
  textNavigation?: { index: number; total: number; onMove: (direction: -1 | 1) => void }
  onPlayback: (action: PlaybackAction) => void
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
      <button type="button" className="button" disabled={busy || !previous} onClick={() => previous && onSelect(previous)}>
        <ChevronLeft size={16} aria-hidden="true" /> {t('Previous verse')}
      </button>
      <button type="button" className="button" disabled={busy || !next} onClick={() => next && onSelect(next)}>
        {t('Next verse')} <ChevronRight size={16} aria-hidden="true" />
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
  const status = stage.blackout ? 'Blackout' : live ? 'Live' : stage.cue ? 'Staged' : 'Standby'

  return (
    <>
      <div className="preview-grid">
        <section className="preview-panel preview-panel--live" aria-labelledby="live-heading">
          <header className="preview-heading">
            <h2 id="live-heading"><Monitor size={15} /> {t('Live output')}</h2>
            <span className={`status-pill${live ? ' status-pill--live' : ''}`}><span />{t(status)}</span>
          </header>
          <div className="preview-screen">
            <Audience key={stage.revision} cue={audience} background={props.background} stage={props.kiosk ? stage : { ...stage, playing: false }} />
          </div>
          <div className="preview-caption">
            <span>{stage.blackout ? t('Display is black') : audience?.title ?? (props.background ? t('Kiosk background') : t('No live cue'))}</span>
            {audience && !media && <span className="subtle">{stage.cue ? t('Audience view') : t('Standby preview')}</span>}
          </div>
        </section>
        {media && <MediaPlayback key={stage.revision} stage={stage} onAction={props.onPlayback} />}
        {stage.cue?.kind === 'scripture' && (
          <VerseNavigation reference={stage.cue.reference} busy={props.busy} onSelect={props.onNavigateVerse} />
        )}
        {props.textNavigation && (
          <div className="live-controls step-navigation" role="group" aria-label={t('Live text slide navigation')}>
            <button type="button" className="button" disabled={props.busy || props.textNavigation.index === 0}
              onClick={() => props.textNavigation?.onMove(-1)}><ChevronLeft size={16} aria-hidden="true" /> {t('Previous slide')}</button>
            <button type="button" className="button" disabled={props.busy || props.textNavigation.index + 1 === props.textNavigation.total}
              onClick={() => props.textNavigation?.onMove(1)}>{t('Next slide')} <ChevronRight size={16} aria-hidden="true" /></button>
          </div>
        )}
        <section className="preview-panel preview-panel--next" aria-labelledby="next-heading">
          <header className="preview-heading">
            <h2 id="next-heading"><ChevronRight size={17} /> {t('Next up')}</h2>
            {props.next && <span className="status-pill status-pill--next">{t('Queued')}</span>}
          </header>
          <div className="preview-screen">
            <Audience key={props.next?.id ?? 'empty'} cue={props.next} />
            {props.nextError && <div className="slide-empty slide-overlay" role="status">{translateError(t, props.nextError)}</div>}
          </div>
          <div className="preview-caption">
            <span>{props.nextTitle ?? t('No cue selected')}</span>
            {props.next && <ItemIcon kind={props.next.kind} size={13} />}
          </div>
        </section>
        <KioskVolume stage={stage} onAction={props.onPlayback} />
      </div>
      <div className="transport" role="group" aria-label={t('Cue controls')}>
        <button type="button" className="button button-quiet transport-blackout" aria-pressed={stage.blackout}
          onClick={props.onBlackout} title={t('Toggle blackout (B)')}><Ban size={16} aria-hidden="true" /> {t('Blackout')}</button>
        <button className="button" disabled={!props.hasPrevious} onClick={props.onPrevious} title={t('Cue previous item (↑)')}><ChevronLeft size={17} /> {t('Previous')}</button>
        <button className="button" disabled={!props.hasNext} onClick={props.onNext} title={t('Cue next item (↓)')}>{t('Next')} <ChevronRight size={17} /></button>
        <button className="button button-primary" disabled={!props.canGoLive || props.busy} onClick={props.onGoLive} title={t('Send the queued item to Kiosk (Enter)')}><RadioTower size={17} /> {t('Go live')}</button>
      </div>
    </>
  )
}
