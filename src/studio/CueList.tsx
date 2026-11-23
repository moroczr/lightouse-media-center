import { useEffect, useRef, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronRight, Clapperboard,
  Ellipsis, Folder, ListMusic, Music2, Pencil, Plus, Trash2, Type,
} from 'lucide-react'
import { flatten, kindNames, type Group, type Item, type ItemKind } from '../shared/model'

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

export function Menu({ label, trigger, children, primary = false }: {
  label: string; trigger: ReactNode; children: ReactNode; primary?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const element = details.current
      if (element?.open && !element.contains(event.target as Node)) element.open = false
    }

    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  return (
    <details className="menu" ref={details} onToggle={event => {
      const menu = event.currentTarget
      const scrollArea = menu.closest('.cue-scroll')
      const panel = menu.querySelector('.menu-body')
      if (!menu.open || !scrollArea || !panel) return

      const container = scrollArea.getBoundingClientRect()
      const trigger = menu.getBoundingClientRect()
      const above = trigger.top - Math.max(0, container.top) - 6
      const below = Math.min(window.innerHeight, container.bottom) - trigger.bottom - 6
      const openUp = below < panel.scrollHeight && above > below
      menu.classList.toggle('menu--opens-up', openUp)
      menu.style.setProperty('--menu-max-height', `${Math.max(32, Math.floor(openUp ? above : below))}px`)
    }} onKeyDown={event => {
      if (event.key === 'Escape' && details.current?.open) {
        details.current.open = false
        details.current.querySelector('summary')?.focus()
      }
    }}>
      <summary aria-label={label} title={label} className={primary ? 'button button-primary' : 'icon-button'}>{trigger}</summary>
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
  liveId: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onCue: (item: Item) => void
  onEdit: (item: Item, parentId: string) => void
  onAdd: (groupId: string) => void
  onMove: (parentId: string, index: number, direction: -1 | 1) => void
  onRemove: (item: Item, parentId: string) => void
}

function GroupRows({ group, depth, props }: { group: Group; depth: number; props: CueListProps }) {
  return (
    <ul className="cue-rows">
      {group.children.map((item, index) => {
        const isGroup = item.kind === 'playlist'
        const open = isGroup && props.expanded.has(item.id)
        const live = props.liveId === item.id
        const next = props.selectedId === item.id
        const count = isGroup ? flatten(item.children).length : 0
        const subtitle = isGroup ? `${count} ${count === 1 ? 'cue' : 'cues'}` : kindNames[item.kind]
        return (
          <li key={item.id}>
            <div className={`cue-row${live ? ' cue-row--live' : ''}${next ? ' cue-row--next' : ''}`} style={{ '--depth': depth } as React.CSSProperties}>
              {isGroup ? (
                <button className="cue-expand" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${item.title}`} onClick={() => props.onToggle(item.id)}>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
              ) : <span className="cue-rail" />}
              <button className="cue-select" onClick={() => props.onCue(item)} title={`Cue ${item.title}`}>
                <ItemIcon kind={item.kind} />
                <span className="cue-title">{item.title}</span>
                <span className="cue-kind">{subtitle}</span>
              </button>
              {live && <span className="cue-badge live">Live</span>}
              {next && <span className="cue-badge next">Next</span>}
              <Menu label={`Actions for ${item.title}`} trigger={<Ellipsis size={17} />}>
                {isGroup && <button onClick={() => props.onAdd(item.id)}><Plus size={15} /> Add cue here</button>}
                <button onClick={() => props.onEdit(item, group.id)}><Pencil size={14} /> {item.kind === 'text' || item.kind === 'scripture' ? 'Edit cue' : 'Rename'}</button>
                <button disabled={index === 0} onClick={() => props.onMove(group.id, index, -1)}><ArrowUp size={15} /> Move up</button>
                <button disabled={index === group.children.length - 1} onClick={() => props.onMove(group.id, index, 1)}><ArrowDown size={15} /> Move down</button>
                <button className="danger" onClick={() => props.onRemove(item, group.id)}><Trash2 size={14} /> Remove</button>
              </Menu>
            </div>
            {isGroup && open && (item.children.length
              ? <GroupRows group={item} depth={depth + 1} props={props} />
              : <button className="empty-group" style={{ marginLeft: 48 + depth * 23 }} onClick={() => props.onAdd(item.id)}><Plus size={14} /> Add a cue to {item.title}</button>)}
          </li>
        )
      })}
    </ul>
  )
}

export function CueList(props: CueListProps) {
  if (!props.root.children.length) {
    return <div className="empty-list"><ListMusic size={27} /><p>This playlist is empty</p><button className="button" onClick={() => props.onAdd(props.root.id)}><Plus size={16} /> Add cue</button></div>
  }
  return <GroupRows group={props.root} depth={0} props={props} />
}
