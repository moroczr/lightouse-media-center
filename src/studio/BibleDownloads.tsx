import { useEffect, useState } from 'react'
import { Check, Download, RefreshCw, Trash2 } from 'lucide-react'
import { bible } from '../shared/bridge'
import { useLanguage } from '../shared/i18n'
import type { Message } from '../shared/messages'
import { translationName, type BibleCatalog, type BibleDownloadProgress, type BibleSettings } from '../shared/model'

export function BibleDownloads({ settings, busy, onBusyChange, onChange }: {
  settings: BibleSettings
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onChange: (settings: BibleSettings) => void
}) {
  const { t, language } = useLanguage()
  const [catalog, setCatalog] = useState<BibleCatalog>()
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [catalogError, setCatalogError] = useState(false)
  const [failure, setFailure] = useState<{ id: string; message: Message }>()
  const [progress, setProgress] = useState<BibleDownloadProgress>()
  const installed = new Map(settings.databases.map(item => [item.id.toLowerCase(), item.id]))
  const languages = new Intl.DisplayNames(language, { type: 'language' })
  const sizes = new Intl.NumberFormat(language, { maximumFractionDigits: 1 })

  useEffect(() => {
    let active = true
    setLoading(true)
    setCatalogError(false)
    void bible.catalog().then(result => {
      if (active) setCatalog(result)
    }).catch(() => {
      if (active) setCatalogError(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [refresh])

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    void bible.onDownloadProgress(event => {
      if (active) setProgress(current => current?.id === event.id ? event : current)
    }).then(stop => {
      if (active) unlisten = stop
      else stop()
    }).catch(() => {})
    return () => { active = false; unlisten?.() }
  }, [])

  async function toggle(edition: BibleCatalog['translations'][number], installedId?: string) {
    if (!catalog || busy) return
    onBusyChange(true)
    setFailure(undefined)
    try {
      if (installedId) {
        onChange(await bible.remove(installedId))
      } else {
        setProgress({ id: edition.id, received: 0, total: edition.bytes })
        onChange(await bible.download(catalog.revision, edition.id))
      }
    } catch {
      setFailure({ id: edition.id, message: installedId ? 'Could not remove the translation.' : 'Download failed.' })
    } finally {
      setProgress(undefined)
      onBusyChange(false)
    }
  }

  return (
    <div className="bible-downloads">
      <button type="button" className="button refresh-catalog" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>
        <RefreshCw size={15} />{t('Refresh catalog')}
      </button>
      {loading && <p role="status">{t('Loading translation catalog…')}</p>}
      {catalogError && <p className="settings-error" role="alert">{t('Could not load the translation catalog.')}</p>}
      {catalog?.translations.length === 0 && <p>{t('No translations are available to download.')}</p>}
      {!!catalog?.translations.length && <ul className="translation-list" aria-label={t('Download translations')}>
        {catalog.translations.map(edition => {
          const installedId = installed.get(edition.id.toLowerCase())
          const name = translationName(edition)
          const action = installedId ? t('Remove {name}', { name }) : t('Download {name}', { name })
          const coverage = edition.collection === 'Complete Bible' || edition.collection === 'Old Testament' || edition.collection === 'New Testament'
            ? t(edition.collection) : edition.collection
          return (
            <li key={edition.id} className={installedId ? 'translation-downloaded' : undefined}>
              <div className="translation-row">
                <div className="translation-details">
                  <strong>{name}</strong>
                  <small>{[languages.of(edition.language), coverage, t('{count} books', { count: edition.books }),
                    `${sizes.format(edition.bytes / 1048576)} MiB`].filter(Boolean).join(' · ')}</small>
                  {installedId && <span className="translation-status"><Check size={13} />{t('Downloaded')}</span>}
                </div>
                <button type="button" className="icon-button" title={action} aria-label={action} disabled={busy || loading}
                  onClick={() => void toggle(edition, installedId)}>
                  {installedId ? <Trash2 size={16} /> : <Download size={16} />}
                </button>
              </div>
              {progress?.id === edition.id && <progress aria-label={t('Downloading {name}', { name })}
                value={progress.received} max={progress.total} />}
              {failure?.id === edition.id && <p className="settings-error" role="alert">{t(failure.message)}</p>}
            </li>
          )
        })}
      </ul>}
    </div>
  )
}
