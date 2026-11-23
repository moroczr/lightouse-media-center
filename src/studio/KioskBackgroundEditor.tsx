import { useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { pickKioskBackground, saveKioskBackground } from '../shared/bridge'
import { type KioskBackground } from '../shared/model'

export function KioskBackgroundEditor({ background, loadError }: {
  background: KioskBackground | null
  loadError: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function update(chooseImage: boolean) {
    setBusy(true)
    setError('')
    try {
      const image = chooseImage ? await pickKioskBackground() : null
      if (!chooseImage || image) await saveKioskBackground(image)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="editor">
      <p>This image appears in Kiosk whenever there’s no live cue.</p>
      <div className="kiosk-background-preview">
        {background ? <img src={background.url} alt="Current Kiosk background" /> : <span>No background image</span>}
      </div>
      {background && <p className="kiosk-background-name" title={background.name}>{background.name}</p>}
      {(error || loadError) && <p className="media-warning" role="alert">{error || loadError}</p>}
      <div className="dialog-actions">
        {background && (
          <button type="button" className="button" disabled={busy} onClick={() => void update(false)}>
            <Trash2 size={15} /> Remove image
          </button>
        )}
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void update(true)}>
          <ImagePlus size={16} /> {background ? 'Change image' : 'Choose image'}
        </button>
      </div>
    </div>
  )
}
