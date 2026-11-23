import { useEffect, useState } from 'react'
import { listenKioskBackground, loadKioskBackground } from './bridge'
import { type KioskBackground } from './model'

export function useKioskBackground() {
  const [background, setBackground] = useState<KioskBackground | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let receivedUpdate = false
    let unlisten: (() => void) | undefined

    function apply(image: KioskBackground | null) {
      setBackground(image)
      setError('')
    }

    void listenKioskBackground(image => {
      receivedUpdate = true
      if (active) apply(image)
    }).then(async cleanup => {
      if (!active) {
        cleanup()
        return
      }
      unlisten = cleanup
      const image = await loadKioskBackground()
      if (active && !receivedUpdate) apply(image)
    }).catch(reason => {
      if (active && !receivedUpdate) setError(String(reason))
    })

    return () => {
      active = false
      unlisten?.()
    }
  }, [])

  return { background, error }
}
