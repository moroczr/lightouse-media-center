import { useEffect, useState } from 'react'
import { BookOpen, Download, Globe, Images } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import type { Language, Message } from '../shared/messages'
import { bible, desktop } from '../shared/bridge'
import { translationName, type BibleSettings } from '../shared/model'
import { Dialog } from './Editors'
import { BibleDownloads } from './BibleDownloads'
import { SlidesSettings } from './SlidesSettings'
import { defineTabs, TabList } from './TabList'

const tabs = defineTabs('settings', [
  { id: 'general', label: 'General', icon: Globe },
  { id: 'bible', label: 'Bible', icon: BookOpen },
  { id: 'slides', label: 'Slides', icon: Images },
])

const bibleTabs = defineTabs('bible-settings', [
  { id: 'available', label: 'Available translations', icon: BookOpen },
  { id: 'download', label: 'Download translations', icon: Download },
])

type BibleTab = (typeof bibleTabs.options)[number]['id']
type Tab = (typeof tabs.options)[number]['id']

export function SettingsDialog({ onClose, onBibleChange }: { onClose: () => void; onBibleChange: () => void }) {
  const { language, setLanguage, t } = useLanguage()
  const [tab, setTab] = useState<Tab>('general')
  const [settings, setSettings] = useState<BibleSettings>()
  const [busy, setBusy] = useState(false)
  const [bibleTab, setBibleTab] = useState<BibleTab>('available')
  const [visitedDownloads, setVisitedDownloads] = useState(false)
  const [error, setError] = useState<Message>()
  const enabled = settings?.databases.filter(item => item.enabled) ?? []

  useEffect(() => {
    let active = true
    void bible.settings().then(data => {
      if (active) setSettings(data)
    }).catch(() => {
      if (active) setError('Could not load Bible translations.')
    })
    return () => { active = false }
  }, [])

  async function update(operation: () => Promise<BibleSettings | null>) {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      const data = await operation()
      if (data) applySettings(data)
    } catch {
      setError('Could not save translation settings.')
    } finally {
      setBusy(false)
    }
  }

  function applySettings(data: BibleSettings) {
    setSettings(data)
    onBibleChange()
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
          <TabList tabs={bibleTabs} selected={bibleTab} label="Bible translations"
            onChange={id => {
              setBibleTab(id)
              if (id === 'download') setVisitedDownloads(true)
            }} />
          <section {...bibleTabs.panelProps('available', bibleTab)}>
            {desktop && settings && <div className="editor">
              {settings.databases.length ? <ul className="translation-list" aria-label={t('Available translations')}>
                {settings.databases.map(edition => (
                  <li key={edition.id}>
                    <label className="translation-option">
                      <input type="checkbox" checked={edition.enabled} disabled={busy}
                        onChange={() => save(settings.defaultId, edition.id)} />
                      <strong>{translationName(edition)}</strong>
                    </label>
                  </li>
                ))}
              </ul> : <p>{t('No translations downloaded yet.')}</p>}
              <label>{t('Default Bible translation')}
                <select value={settings.defaultId ?? ''} disabled={busy || !enabled.length}
                  onChange={event => save(event.target.value)}>
                  {!enabled.length && <option value="">{t('No translations enabled')}</option>}
                  {enabled.map(edition => <option key={edition.id} value={edition.id}>{translationName(edition)}</option>)}
                </select>
              </label>
            </div>}
          </section>
          <section {...bibleTabs.panelProps('download', bibleTab)}>
            {desktop && settings && visitedDownloads &&
              <BibleDownloads settings={settings} busy={busy} onBusyChange={setBusy} onChange={applySettings} />}
          </section>
          {!desktop && <p>{t('Bible translations are available in the desktop app.')}</p>}
          {desktop && !settings && !error && <p role="status">{t('Loading Bible translations…')}</p>}
          {error && <p className="settings-error" role="alert">{t(error)}</p>}
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
