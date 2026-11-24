import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { slideSettings } from '../shared/bridge'
import { useLanguage } from '../shared/i18n'
import { translateError } from '../shared/messages'
import { builtInSlideDefaults, builtInThemes, type Theme } from '../shared/model'
import { ThemePreview, ThemeSwatch, useSlideThemes } from '../shared/SlideThemes'

const defaultSelectors = [
  { kind: 'text', label: 'Default text slide theme' },
  { kind: 'scripture', label: 'Default Bible verse theme' },
] as const

export function SlidesSettings({ busy, onBusyChange }: { busy: boolean; onBusyChange: (busy: boolean) => void }) {
  const { t } = useLanguage()
  const { settings, error: loadError, reload } = useSlideThemes()
  const [error, setError] = useState('')
  const [previewTheme, setPreviewTheme] = useState<Theme>()
  const backgrounds = settings?.backgrounds ?? []

  async function update(operation: () => Promise<void>) {
    if (busy) return
    onBusyChange(true)
    setError('')
    try {
      await operation()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <div className="editor">
      <div className="slide-defaults">
        {defaultSelectors.map(({ kind, label }) => {
          const theme = settings?.defaultThemes[kind]
          return (
            <div className="slide-default" key={kind}>
              <label>
                {t(label)}
                <select value={theme ?? ''} disabled={busy || !settings} onChange={event => {
                  const choice = event.currentTarget.value as Theme | ''
                  void update(async () => {
                    await slideSettings.saveDefault(kind, choice || null)
                    await reload()
                  })
                }}>
                  <option value="">{t('Use built-in default')}</option>
                  <optgroup label={t('Built-in themes')}>
                    {builtInThemes.map(option => <option key={option.id} value={option.id}>{t(option.label)}</option>)}
                  </optgroup>
                  {!!backgrounds.length && <optgroup label={t('Custom backgrounds')}>
                    {backgrounds.map(image => <option key={image.id} value={image.id}>{image.name}</option>)}
                  </optgroup>}
                </select>
              </label>
              {settings && <ThemePreview theme={theme ?? builtInSlideDefaults[kind]} />}
            </div>
          )
        })}
      </div>
      <div className="slide-settings-heading">
        <h3>{t('Background images')}</h3>
        <button type="button" className="button" disabled={busy || !settings} onClick={() => {
          void update(async () => {
            if (await slideSettings.importBackground()) await reload()
          })
        }}>
          <ImagePlus size={16} aria-hidden="true" /> {t('Add background image')}
        </button>
      </div>
      {previewTheme && <div className="slide-theme-previews"><ThemePreview theme={previewTheme} /></div>}
      {backgrounds.length ? (
        <ul className="slide-background-list" aria-label={t('Background images')}>
          {backgrounds.map(image => (
            <li key={image.id}>
              <button type="button" title={image.name} aria-pressed={previewTheme === image.id}
                onClick={() => setPreviewTheme(current => current === image.id ? undefined : image.id)}>
                <ThemeSwatch theme={image.id} url={image.url} />
                <span>{image.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : settings ? (
        <p className="slide-settings-status">{t('No custom background images')}</p>
      ) : !loadError && (
        <p className="slide-settings-status" role="status">{t('Loading slide themes…')}</p>
      )}
      {(error || loadError) && <p className="settings-error" role="alert">{translateError(t, error || loadError)}</p>}
      {loadError && <button type="button" className="button" disabled={busy} onClick={() => void update(reload)}>{t('Retry')}</button>}
    </div>
  )
}
