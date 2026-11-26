import { useEffect, useState } from 'react'
import { BookOpen, Globe, Images, Plus } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError, type Language } from '../shared/messages'
import { bible } from '../shared/bridge'
import type { BibleSettings } from '../shared/model'
import { Dialog } from './Editors'
import { SlidesSettings } from './SlidesSettings'
import { defineTabs, TabList } from './TabList'

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

const tabs = defineTabs('settings', [
  { id: 'general', label: 'General', icon: Globe },
  { id: 'bible', label: 'Bible', icon: BookOpen },
  { id: 'slides', label: 'Slides', icon: Images },
])

type Tab = (typeof tabs.options)[number]['id']

export function SettingsDialog({ onClose, onBibleChange }: { onClose: () => void; onBibleChange: () => void }) {
  const { language, setLanguage, t } = useLanguage()
  const [tab, setTab] = useState<Tab>('general')
  const [settings, setSettings] = useState<BibleSettings>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const enabled = settings?.databases.filter(item => item.enabled) ?? []

  useEffect(() => {
    let active = true
    void bible.settings().then(data => {
      if (active) setSettings(data)
    }).catch(reason => {
      if (active) setError(errorMessage(reason))
    })
    return () => { active = false }
  }, [])

  async function update(operation: () => Promise<BibleSettings | null>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const data = await operation()
      if (data) {
        setSettings(data)
        onBibleChange()
      }
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  function save(defaultId: string | null, toggledId?: string) {
    if (!settings) return
    const disabledIds = settings.databases
      .filter(item => item.id === toggledId ? item.enabled : !item.enabled)
      .map(item => item.id)
    void update(() => bible.saveSettings({ defaultId, disabledIds }))
  }

  return (
    <Dialog title={t('Settings')} onClose={() => { if (!busy) onClose() }}>
      <TabList tabs={tabs} selected={tab} onChange={setTab} label="Settings sections" />
      <section {...tabs.panelProps('general', tab)}>
        <div className="editor">
          <label>
            {t('Language')}
            <select value={language} onChange={event => setLanguage(event.currentTarget.value as Language)}>
              <option value="en" lang="en">English</option>
              <option value="hu" lang="hu">Magyar</option>
            </select>
          </label>
        </div>
      </section>
      <section {...tabs.panelProps('bible', tab)}>
        <div className="editor bible-settings">
          <div className="bible-settings-heading">
            <h3>{t('Bible databases')}</h3>
            <button type="button" className="button" disabled={!settings || busy}
              onClick={() => void update(() => bible.importFile())}>
              <Plus size={16} /> {t('Add database')}
            </button>
          </div>

          {settings ? <>
            <ul className="bible-database-list" aria-label={t('Bible databases')}>
              {settings.databases.map(database => (
                <li key={database.id}>
                  <label className="bible-database">
                    <input type="checkbox" checked={database.enabled} disabled={busy}
                      onChange={() => save(settings.defaultId, database.id)} />
                    <span className="bible-database-name">
                      <strong>{database.name}</strong>
                      <small title={database.fileName ?? undefined}>{database.fileName ?? t('Bundled')}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <label>{t('Default Bible database')}
              <select value={settings.defaultId ?? ''} disabled={busy || !enabled.length}
                onChange={event => save(event.target.value)}>
                {!enabled.length && <option value="">{t('No databases enabled')}</option>}
                {enabled.map(database => <option key={database.id} value={database.id}>{database.name}</option>)}
              </select>
            </label>
          </> : !error && <p role="status">{t('Loading Bible databases…')}</p>}

          {error && <p className="settings-error" role="alert">{translateError(t, error)}</p>}
        </div>
      </section>
      <section {...tabs.panelProps('slides', tab)}>
        <SlidesSettings busy={busy} onBusyChange={setBusy} />
      </section>
      <div className="dialog-actions settings-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={onClose}>{t('Done')}</button>
      </div>
    </Dialog>
  )
}
