import { useEffect, useState } from 'react'
import { getStage, listenStage, listenKioskBackground, loadKioskBackground } from './bridge'
import { emptyStage, type BackgroundImage, type Stage } from './model'

function useSubscribedValue<T>(
  initial: T, listen: (receive: (value: T) => void) => Promise<() => void>, load: () => Promise<T>,
) {
  const [state, setState] = useState({ value: initial, error: '' })

  useEffect(() => {
    let active = true
    let receivedEvent = false
    let unlisten: (() => void) | undefined

    async function disconnect() {
      try {
        await unlisten?.()
      } catch (reason) {
        console.error('Could not remove presentation listener.', reason)
      }
    }

    async function connect() {
      unlisten = await listen(value => {
        if (!active) return
        receivedEvent = true
        setState({ value, error: '' })
      })
      if (!active) {
        await disconnect()
        return
      }
      if (receivedEvent) return
      const value = await load()
      if (active && !receivedEvent) setState({ value, error: '' })
    }

    void connect().catch(reason => {
      // An event supersedes any pending snapshot, including a snapshot error.
      if (active && !(unlisten && receivedEvent)) {
        const error = reason instanceof Error ? reason.message : String(reason)
        setState(current => ({ ...current, error }))
      }
    })
    return () => {
      active = false
      void disconnect()
    }
  }, [listen, load])

  return state
}

export function useStage(initial: Stage = emptyStage) {
  const { value: stage, error } = useSubscribedValue(initial, listenStage, getStage)
  return { stage, error }
}

export function useKioskBackground() {
  const { value: background, error } = useSubscribedValue<BackgroundImage | null>(null, listenKioskBackground, loadKioskBackground)
  return { background, error }
}
