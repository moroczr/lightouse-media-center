import { useEffect, useRef, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronRight, Clapperboard,
  Ellipsis, Folder, ListMusic, Music2, Pencil, Plus, Trash2, Type,
} from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { flatten, kindNames, textSlideCues, type Cue, type Group, type Item, type ItemKind } from '../shared/model'
import type { CueDragStart } from './useCueDrag'

export const itemIcons = {
  text: Type,
  scripture: BookOpen,
  playlist: Folder,
  video: Clapperboard,
  audio: Music2,
}

export function ItemIcon({ kind, size = 16 }: { kind: ItemKind; size?: number }) {
  const Icon = itemIcons[kind]
  return <span className={`item-icon item-icon--${kind}`}><Icon size={size} strokeWidth={1.9} /></span>
}

export function Menu({ label, trigger, children }: {
  label: string; trigger: ReactNode; children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const stopPositioning = useRef<(() => void) | null>(null)

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const element = details.current
      if (element?.open && !element.contains(event.target as Node)) element.open = false
    }

    document.addEventListener('pointerdown', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      stopPositioning.current?.()
    }
  }, [])

  return (
    <details className="menu" ref={details} onToggle={event => {
      const menu = event.currentTarget
      stopPositioning.current?.()
      stopPositioning.current = null
      if (!menu.open) {
        menu.style.removeProperty('--menu-visibility')
        return
      }

      const scrollArea = menu.closest('.cue-scroll, .cue-panel')
      const panel = menu.querySelector<HTMLElement>('.menu-body')
      if (!scrollArea || !panel) return

      const positionPanel = () => {
        if (!menu.open) return
        const trigger = menu.getBoundingClientRect()
        const scrollBounds = scrollArea.getBoundingClientRect()
        const viewportHeight = window.innerHeight
        if (trigger.bottom <= Math.max(0, scrollBounds.top)
          || trigger.top >= Math.min(viewportHeight, scrollBounds.bottom)) {
          menu.open = false
          return
        }

        const gap = 6
        const above = trigger.top - gap * 2
        const below = viewportHeight - trigger.bottom - gap * 2
        const panelHeight = panel.scrollHeight + panel.offsetHeight - panel.clientHeight
        const opensUp = below < panelHeight && above > below
        const left = Math.max(gap, Math.min(trigger.right, window.innerWidth - gap) - panel.offsetWidth)

        menu.style.setProperty('--menu-left', `${left}px`)
        menu.style.setProperty('--menu-top', opensUp ? 'auto' : `${trigger.bottom + gap}px`)
        menu.style.setProperty('--menu-bottom', opensUp ? `${viewportHeight - trigger.top + gap}px` : 'auto')
        menu.style.setProperty('--menu-max-height', `${Math.max(0, opensUp ? above : below)}px`)
        menu.style.setProperty('--menu-visibility', 'visible')
      }

      function followScroll(event: Event) {
        if (event.target !== panel) positionPanel()
      }

      positionPanel()
      document.addEventListener('scroll', followScroll, true)
      window.addEventListener('resize', positionPanel)
      stopPositioning.current = () => {
        document.removeEventListener('scroll', followScroll, true)
        window.removeEventListener('resize', positionPanel)
      }
    }} onKeyDown={event => {
      if (event.key === 'Escape' && details.current?.open) {
        details.current.open = false
        details.current.querySelector('summary')?.focus()
      }
    }}>
      <summary aria-label={label} title={label} className="icon-button">{trigger}</summary>
      <div className="menu-body" onClick={event => {
        if ((event.target as HTMLElement).closest('button') && details.current) details.current.open = false
      }}>
        {children}
      </div>
    </details>
  )
}

interface CueListProps {
  root: Group
  selectedId: string | null
  current: { id: string; status: 'Live' | 'Staged' | 'Blackout' } | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onCue: (id: string | undefined, branchId?: string) => void
  onGoLive: (id: string) => void
  onCuePointerDown: CueDragStart
  onEdit: (item: Item, parentId: string) => void
  onAdd: (groupId: string) => void
  onMove: (parentId: string, index: number, direction: -1 | 1) => void
  onRemove: (item: Item, parentId: string) => void
}

function CueRow({ item, depth, subtitle, cues, props, children }: {
  item: Pick<Item, 'id' | 'title' | 'kind'>
  depth: number
  subtitle?: string
  cues?: Cue[]
  props: CueListProps
  children?: ReactNode
}) {
  const { t } = useLanguage()
  const open = !!cues && props.expanded.has(item.id)
  const cueId = cues ? cues[0]?.id : item.id
  const contains = (id: string | null) => item.id === id || (!open && cues?.some(cue => cue.id === id))
  const current = props.current && contains(props.current.id) ? props.current : null
  const next = contains(props.selectedId)

  return (
    <div className={`cue-row${current ? ' cue-row--current' : ''}${next ? ' cue-row--next' : ''}`} style={{ '--depth': depth } as React.CSSProperties}>
      {cues ? (
        <button className="cue-expand" aria-expanded={open} aria-label={t(open ? 'Collapse {name}' : 'Expand {name}', { name: item.title })} onClick={() => props.onToggle(item.id)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      ) : <span className="cue-rail" />}
      <button
        className={cueId ? 'cue-select cue-draggable' : 'cue-select'}
        aria-current={current ? true : undefined}
        title={t(cueId ? 'Cue {name} (double-click to go live)' : 'Cue {name}', { name: item.title })}
        onPointerDown={cueId ? event => props.onCuePointerDown(event, { cueId, title: item.title, kind: item.kind }) : undefined}
        onClick={() => props.onCue(cueId, cues ? item.id : undefined)}
        onDoubleClick={cueId ? () => props.onGoLive(cueId) : undefined}
      >
        <ItemIcon kind={item.kind} />
        <span className="cue-title">{item.title}</span>
        {subtitle && <span className="cue-kind">{subtitle}</span>}
      </button>
      {current && <span className="cue-badge current">{t(current.status)}</span>}
      {next && <span className="cue-badge next">{t('Next')}</span>}
      {children}
    </div>
  )
}

function GroupRows({ group, depth, props }: { group: Group; depth: number; props: CueListProps }) {
  const { t } = useLanguage()
  return (
    <ul className="cue-rows">
      {group.children.map((item, index) => {
        const cues = item.kind === 'playlist' ? flatten(item.children)
          : item.kind === 'text' ? textSlideCues(item) : undefined
        const count = cues?.length ?? 0
        const subtitle = item.kind === 'text' ? t(count === 1 ? '{count} slide' : '{count} slides', { count })
          : item.kind === 'playlist' ? t(count === 1 ? '{count} cue' : '{count} cues', { count })
          : t(kindNames[item.kind])
        const open = props.expanded.has(item.id)

        return (
          <li key={item.id}>
            <CueRow item={item} depth={depth} subtitle={subtitle} cues={cues} props={props}>
              <Menu label={t('Actions for {name}', { name: item.title })} trigger={<Ellipsis size={17} />}>
                {item.kind === 'playlist' && <button onClick={() => props.onAdd(item.id)}><Plus size={15} /> {t('Add cue here')}</button>}
                <button onClick={() => props.onEdit(item, group.id)}><Pencil size={14} /> {item.kind === 'text' ? t('Edit text slide') : item.kind === 'scripture' ? t('Edit cue') : t('Rename')}</button>
                <button disabled={index === 0} onClick={() => props.onMove(group.id, index, -1)}><ArrowUp size={15} /> {t('Move up')}</button>
                <button disabled={index === group.children.length - 1} onClick={() => props.onMove(group.id, index, 1)}><ArrowDown size={15} /> {t('Move down')}</button>
                <button className="danger" onClick={() => props.onRemove(item, group.id)}><Trash2 size={14} /> {t('Remove')}</button>
              </Menu>
            </CueRow>
            {item.kind === 'playlist' && open && (item.children.length
              ? <GroupRows group={item} depth={depth + 1} props={props} />
              : <button className="empty-group" style={{ marginLeft: 48 + depth * 23 }} onClick={() => props.onAdd(item.id)}><Plus size={14} /> {t('Add a cue to {name}', { name: item.title })}</button>)}
            {item.kind === 'text' && open && (
              <ul className="cue-rows" aria-label={t('Slides in {name}', { name: item.title })}>
                {cues?.map(entry => <li key={entry.id}><CueRow item={entry} depth={depth + 1} props={props} /></li>)}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function CueList(props: CueListProps) {
  const { t } = useLanguage()
  if (!props.root.children.length) {
    return <div className="empty-list"><ListMusic size={27} /><p>{t('This playlist is empty')}</p></div>
  }
  return <GroupRows group={props.root} depth={0} props={props} />
}
