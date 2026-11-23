import { useEffect, useRef, useState } from 'react'
import { Ban, ChevronLeft, ChevronRight, Monitor, MonitorX, Pause, Play, RadioTower, RotateCcw, RotateCw, Square, Volume2, VolumeX } from 'lucide-react'
import { Audience } from '../shared/Audience'
import { clockTime, isMedia, type AudienceCue, type PlaybackAction, type Stage } from '../shared/model'
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
  onClear: () => void
  onPlayback: (action: PlaybackAction) => void
}

function MediaPlayback({ stage, onAction }: {
  stage: Stage
  onAction: (action: PlaybackAction) => void
}) {
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
    <div className="media-playback" role="group" aria-label="Media playback">
      <div className="media-playback-buttons">
        <button className="icon-button" aria-label="Play media" title="Start or resume playback" disabled={stage.playing} onClick={() => onAction({ kind: 'play' })}><Play size={16} /></button>
        <button className="icon-button" aria-label="Pause media" title="Pause playback" disabled={!stage.playing} onClick={() => onAction({ kind: 'pause' })}><Pause size={16} /></button>
        <button className="icon-button" aria-label="Stop media" title="Stop and rewind" onClick={() => onAction({ kind: 'stop' })}><Square size={15} /></button>
        <button className="button media-skip" aria-label="Back 10 seconds" title="Back 10 seconds" disabled={!canSeek} onClick={() => onAction({ kind: 'skip', seconds: -10 })}><RotateCcw size={15} /><span>10s</span></button>
        <button className="button media-skip" aria-label="Forward 10 seconds" title="Forward 10 seconds" disabled={!canSeek} onClick={() => onAction({ kind: 'skip', seconds: 10 })}><RotateCw size={15} /><span>10s</span></button>
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
          aria-label="Playback position"
          aria-valuetext={`${clockTime(position)} of ${clockTime(duration)}`}
          onChange={event => setDraft(event.currentTarget.valueAsNumber)}
          onBlur={() => setDraft(null)}
        />
        <span className="media-time">{clockTime(duration)}</span>
      </div>
    </div>
  )
}

function KioskVolume({ stage, onAction }: {
  stage: Stage
  onAction: (action: PlaybackAction) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const appliedVolume = Math.round(stage.volume * 100)
  const volume = draft ?? appliedVolume

  useEffect(() => {
    if (draft === appliedVolume) setDraft(null)
  }, [draft, appliedVolume])

  return (
    <div className="media-audio" role="group" aria-label="Kiosk audio">
      <span className="media-time">{volume}%</span>
      <div className="media-volume-track">
        <input
          className="media-volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          aria-label="Kiosk volume"
          aria-orientation="vertical"
          title="Kiosk volume"
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
        aria-label="Mute Kiosk audio"
        aria-pressed={stage.muted}
        title={stage.muted ? 'Unmute Kiosk audio' : 'Mute Kiosk audio'}
        onClick={() => onAction({ kind: 'mute', muted: !stage.muted })}
      >
        {stage.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
    </div>
  )
}

export function Preview(props: PreviewProps) {
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
            <h2 id="live-heading"><Monitor size={15} /> Live output</h2>
            <span className={`status-pill${live ? ' status-pill--live' : ''}`}><span />{status}</span>
          </header>
          <div className="preview-screen">
            <Audience key={stage.revision} cue={audience} background={props.background} stage={props.kiosk ? stage : { ...stage, playing: false }} />
          </div>
          <div className="preview-caption">
            <span>{stage.blackout ? 'Display is black' : audience?.title ?? (props.background ? 'Kiosk background' : 'No live cue')}</span>
            {audience && !media && <span className="subtle">{stage.cue ? 'Audience view' : 'Standby preview'}</span>}
          </div>
        </section>
        {media && <MediaPlayback key={stage.revision} stage={stage} onAction={props.onPlayback} />}
        <section className="preview-panel preview-panel--next" aria-labelledby="next-heading">
          <header className="preview-heading">
            <h2 id="next-heading"><ChevronRight size={17} /> Next up</h2>
            {props.next && <span className="status-pill status-pill--next">Queued</span>}
          </header>
          <div className="preview-screen">
            <Audience key={props.next?.id ?? 'empty'} cue={props.next} />
            {props.nextError && <div className="slide-empty slide-overlay" role="status">{props.nextError}</div>}
          </div>
          <div className="preview-caption">
            <span>{props.nextTitle ?? 'No cue selected'}</span>
            {props.next && <ItemIcon kind={props.next.kind} size={13} />}
          </div>
        </section>
        <KioskVolume stage={stage} onAction={props.onPlayback} />
      </div>
      <div className="transport">
        <div className="transport-mode">
          <button className={`button button-quiet${stage.blackout ? ' is-active' : ''}`} aria-pressed={stage.blackout} onClick={props.onBlackout} title="Toggle blackout (B)"><Ban size={16} /> <span>Blackout</span></button>
          {stage.cue && <button className="icon-button" aria-label="Clear live output" onClick={props.onClear} title="Clear live output"><MonitorX size={17} /></button>}
        </div>
        <div className="transport-navigation">
          <button className="button" disabled={!props.hasPrevious} onClick={props.onPrevious} title="Cue previous item (↑)"><ChevronLeft size={17} /> Previous</button>
          <button className="button" disabled={!props.hasNext} onClick={props.onNext} title="Cue next item (↓)">Next <ChevronRight size={17} /></button>
          <button className="button button-primary" disabled={!props.canGoLive || props.busy} onClick={props.onGoLive} title="Send the queued item to Kiosk (Enter)"><RadioTower size={17} /> Go live</button>
        </div>
      </div>
    </>
  )
}
