import { useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError } from '../shared/messages'
import { pickKioskBackground, saveKioskBackground } from '../shared/bridge'
import { type BackgroundImage } from '../shared/model'

export function KioskBackgroundEditor({ background, loadError }: {
  background: BackgroundImage | null
  loadError: string
}) {
  const { t } = useLanguage()
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
      <p>{t('This image appears in Kiosk whenever there’s no live cue.')}</p>
      <div className="kiosk-background-preview">
        {background ? <img src={background.url} alt={t('Current Kiosk background')} /> : <span>{t('No background image')}</span>}
      </div>
      {background && <p className="kiosk-background-name" title={background.name}>{background.name}</p>}
      {(error || loadError) && <p className="media-warning" role="alert">{translateError(t, error || loadError)}</p>}
      <div className="dialog-actions">
        {background && (
          <button type="button" className="button" disabled={busy} onClick={() => void update(false)}>
            <Trash2 size={15} /> {t('Remove image')}
          </button>
        )}
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void update(true)}>
          <ImagePlus size={16} /> {background ? t('Change image') : t('Choose image')}
        </button>
      </div>
    </div>
  )
}
