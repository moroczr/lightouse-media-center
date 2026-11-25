import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { BookOpen, FolderPlus, LibraryBig, Type } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { copyLibraryTextSlide, mediaCue, type Item, type Project, type Theme } from '../shared/model'
import { Dialog } from './Editors'
import { MediaBrowser, type MediaFilter, type MediaView } from './MediaBrowser'
import { ScriptureEditor, type ScriptureView } from './ScriptureEditor'
import { TextSlideLibrary, type TextLibraryView } from './TextSlideLibrary'

const tabs = [
  { id: 'media', label: 'Media', icon: LibraryBig },
  { id: 'text', label: 'Slides', icon: Type },
  { id: 'scripture', label: 'Bible lookup', icon: BookOpen },
] as const

export type CuePickerTab = (typeof tabs)[number]['id']

export function CuePickerDialog({
  tab, onTabChange, destination, project, busy, settingsRevision, textTheme, onAdd, onCreateText, onCreatePlaylist, onClose,
}: {
  tab: CuePickerTab
  onTabChange: (tab: CuePickerTab) => void
  destination?: string
  project: Pick<Project, 'sources' | 'slideLibraries' | 'textLibrary'>
  busy: boolean
  settingsRevision: number
  textTheme: Theme
  onAdd: (item: Item) => void
  onCreateText: () => void
  onCreatePlaylist: () => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [mediaView, setMediaView] = useState<MediaView>('list')
  const [scriptureView, setScriptureView] = useState<ScriptureView>('list')
  const [textView, setTextView] = useState<TextLibraryView>('list')
  const tabList = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tabList.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
  }, [tab])

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
    const index = tabs.findIndex(item => item.id === tab)
    const last = tabs.length - 1
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + last) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last : undefined
    if (next === undefined) return
    event.preventDefault()
    onTabChange(tabs[next].id)
    tabList.current?.querySelectorAll('button')[next]?.focus()
  }

  return (
    <Dialog title={t('Add cue')} className="cue-picker-dialog" onClose={onClose}>
      {destination && <p className="cue-picker-destination">{t('Adding to {name}', { name: destination })}</p>}
      <div className="settings-tabs" role="tablist" aria-label={t('Cue sources')} ref={tabList} onKeyDown={navigateTabs}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" id={`cue-picker-tab-${id}`} aria-controls={`cue-picker-panel-${id}`}
            aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => onTabChange(id)}>
            <Icon size={16} aria-hidden="true" /> {t(label)}
          </button>
        ))}
      </div>
      <section id="cue-picker-panel-media" role="tabpanel" aria-labelledby="cue-picker-tab-media" hidden={tab !== 'media'}>
        <MediaBrowser sources={project.sources} filter={filter} onFilterChange={setFilter} view={mediaView} onViewChange={setMediaView}
          busy={busy} onSave={file => onAdd(mediaCue(file))} />
      </section>
      <section id="cue-picker-panel-text" role="tabpanel" aria-labelledby="cue-picker-tab-text" hidden={tab !== 'text'}>
        <TextSlideLibrary active={tab === 'text'} items={project.textLibrary} libraries={project.slideLibraries} theme={textTheme}
          view={textView} onViewChange={setTextView} busy={busy} saving={false} error=""
          actions={{ kind: 'pick', onAdd: item => onAdd(copyLibraryTextSlide(item)) }} />
      </section>
      <section id="cue-picker-panel-scripture" role="tabpanel" aria-labelledby="cue-picker-tab-scripture" className="scripture-panel" hidden={tab !== 'scripture'}>
        <ScriptureEditor active={tab === 'scripture'} settingsRevision={settingsRevision} busy={busy}
          view={scriptureView} onViewChange={setScriptureView} onSave={onAdd} pickOnly />
      </section>
      <div className="cue-picker-create">
        <button type="button" className="button button-quiet" onClick={onCreateText}>
          <Type size={15} aria-hidden="true" /> {t('One-off text slide')}
        </button>
        <button type="button" className="button button-quiet" onClick={onCreatePlaylist}>
          <FolderPlus size={15} aria-hidden="true" /> {t('New nested playlist')}
        </button>
      </div>
    </Dialog>
  )
}
