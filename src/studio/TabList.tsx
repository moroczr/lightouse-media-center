import type { KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import type { Message } from '../shared/messages'

type TabOption<Id extends string> = {
  id: Id
  label: Message
  icon: LucideIcon
  keyShortcut?: string
}

export function defineTabs<Id extends string>(prefix: string, options: readonly TabOption<Id>[]) {
  const tabId = (id: Id) => `${prefix}-tab-${id}`
  const panelId = (id: Id) => `${prefix}-panel-${id}`
  return {
    options,
    tabId,
    panelId,
    focus: (id: Id) => document.getElementById(tabId(id))?.focus(),
    panelProps: (id: Id, selected: Id) => ({
      id: panelId(id), role: 'tabpanel', 'aria-labelledby': tabId(id), hidden: id !== selected,
    }),
  }
}

export function TabList<Id extends string>({ tabs, selected, onChange, label, workspace = false }: {
  tabs: ReturnType<typeof defineTabs<Id>>
  selected: Id
  onChange: (id: Id) => void
  label: Message
  workspace?: boolean
}) {
  const { t } = useLanguage()

  function select(id: Id) {
    onChange(id)
    tabs.focus(id)
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const count = tabs.options.length
    let next: number
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % count; break
      case 'ArrowLeft': next = (index + count - 1) % count; break
      case 'Home': next = 0; break
      case 'End': next = count - 1; break
      default: return
    }
    event.preventDefault()
    select(tabs.options[next].id)
  }

  return (
    <div className={workspace ? 'workspace-tabs' : 'settings-tabs'} role="tablist" aria-label={t(label)}>
      {tabs.options.map(({ id, label, icon: Icon, keyShortcut }, index) => (
        <button key={id} type="button" role="tab" id={tabs.tabId(id)} aria-controls={tabs.panelId(id)}
          aria-selected={selected === id} tabIndex={selected === id ? 0 : -1} aria-keyshortcuts={keyShortcut}
          onClick={() => select(id)} onKeyDown={event => navigate(event, index)}>
          <Icon size={workspace ? 15 : 16} aria-hidden="true" /><span>{t(label)}</span>
        </button>
      ))}
    </div>
  )
}
