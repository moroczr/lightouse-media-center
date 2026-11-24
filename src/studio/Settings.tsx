import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { BookOpen, Globe, Images, Plus } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError, type Language } from '../shared/messages'
import { bible } from '../shared/bridge'
import type { BibleSettings } from '../shared/model'
import { Dialog } from './Editors'
import { SlidesSettings } from './SlidesSettings'

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

const tabs = [
  { id: 'general', label: 'General', icon: Globe },
  { id: 'bible', label: 'Bible', icon: BookOpen },
  { id: 'slides', label: 'Slides', icon: Images },
] as const

type Tab = (typeof tabs)[number]['id']

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { language, setLanguage, t } = useLanguage()
  const [tab, setTab] = useState<Tab>('general')
  const tabList = useRef<HTMLDivElement>(null)
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
      if (data) setSettings(data)
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

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex(item => item.id === tab)
    const last = tabs.length - 1
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + last) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last : undefined
    if (next === undefined) return
    event.preventDefault()
    setTab(tabs[next].id)
    tabList.current?.querySelectorAll('button')[next]?.focus()
  }

  return (
    <Dialog title={t('Settings')} onClose={() => { if (!busy) onClose() }}>
      <div className="settings-tabs" role="tablist" aria-label={t('Settings sections')} ref={tabList}
        onKeyDown={navigateTabs}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" id={`${id}-tab`} role="tab" aria-selected={tab === id}
            aria-controls={`${id}-settings`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>
            <Icon size={16} aria-hidden="true" /> {t(label)}
          </button>
        ))}
      </div>
      <section id="general-settings" role="tabpanel" aria-labelledby="general-tab" hidden={tab !== 'general'}>
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
      <section id="bible-settings" role="tabpanel" aria-labelledby="bible-tab" hidden={tab !== 'bible'}>
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
      <section id="slides-settings" role="tabpanel" aria-labelledby="slides-tab" hidden={tab !== 'slides'}>
        <SlidesSettings busy={busy} onBusyChange={setBusy} />
      </section>
      <div className="dialog-actions settings-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={onClose}>{t('Done')}</button>
      </div>
    </Dialog>
  )
}
