import { LayoutGrid, List } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import type { Message } from '../shared/messages'

const modes = [
  { value: 'list', icon: List },
  { value: 'grid', icon: LayoutGrid },
] as const

export type ViewMode = (typeof modes)[number]['value']

export function ViewModeSwitch({ view, onChange, label, gridLabel }: {
  view: ViewMode
  onChange: (view: ViewMode) => void
  label: Message
  gridLabel: 'Tile view' | 'Mosaic view'
}) {
  const { t } = useLanguage()
  return (
    <div className="media-segment" role="group" aria-label={t(label)}>
      {modes.map(({ value, icon: Icon }) => {
        const name = t(value === 'list' ? 'List view' : gridLabel)
        return (
          <button key={value} type="button" className="icon-button" title={name} aria-label={name}
            aria-pressed={view === value} onClick={() => onChange(value)}>
            <Icon size={17} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
