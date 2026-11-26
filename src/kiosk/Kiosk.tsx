import { useEffect } from 'react'
import { Audience } from '../shared/Audience'
import { closeKiosk, desktop } from '../shared/bridge'
import { useKioskBackground, useStage } from '../shared/presentationSubscriptions'

export default function Kiosk() {
  const { stage } = useStage()
  const { background } = useKioskBackground()

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (desktop) void closeKiosk()
      else window.close()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

  const fullscreen = desktop && location.hash === '#kiosk'
  return (
    <div className={fullscreen ? 'kiosk--fullscreen' : undefined}>
      <Audience key={stage.revision} cue={stage.cue} stage={stage} background={background?.url} output />
    </div>
  )
}
