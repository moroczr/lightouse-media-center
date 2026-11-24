import { useEffect, useState } from 'react'
import { BookOpen, Plus } from 'lucide-react'
import { bible } from '../shared/bridge'
import type { BibleSettings } from '../shared/model'
import { Dialog } from './Editors'

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
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

  return (
    <Dialog title="Settings" onClose={() => { if (!busy) onClose() }}>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button type="button" id="bible-tab" role="tab" aria-selected="true" aria-controls="bible-settings">
          <BookOpen size={16} /> Bible
        </button>
      </div>
      <section className="editor bible-settings" id="bible-settings" role="tabpanel" aria-labelledby="bible-tab">
        <div className="bible-settings-heading">
          <h3>Bible databases</h3>
          <button type="button" className="button" disabled={!settings || busy}
            onClick={() => void update(() => bible.importFile())}>
            <Plus size={16} /> Add database
          </button>
        </div>

        {settings ? <>
          <ul className="bible-database-list" aria-label="Bible databases">
            {settings.databases.map(database => (
              <li key={database.id}>
                <label className="bible-database">
                  <input type="checkbox" checked={database.enabled} disabled={busy}
                    onChange={() => save(settings.defaultId, database.id)} />
                  <span className="bible-database-name">
                    <strong>{database.name}</strong>
                    <small title={database.fileName ?? undefined}>{database.fileName ?? 'Bundled'}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label>Default Bible database
            <select value={settings.defaultId ?? ''} disabled={busy || !enabled.length}
              onChange={event => save(event.target.value)}>
              {!enabled.length && <option value="">No databases enabled</option>}
              {enabled.map(database => <option key={database.id} value={database.id}>{database.name}</option>)}
            </select>
          </label>
        </> : !error && <p role="status">Loading Bible databases…</p>}

        {error && <p className="settings-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={onClose}>Done</button>
        </div>
      </section>
    </Dialog>
  )
}
