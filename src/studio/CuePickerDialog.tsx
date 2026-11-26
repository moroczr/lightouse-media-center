import { useEffect, useState } from 'react'
import { BookOpen, FolderPlus, LibraryBig, Type } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { copyLibraryTextSlide, mediaCue, type Item, type Project, type Theme } from '../shared/model'
import { Dialog } from './Editors'
import { MediaBrowser, type MediaFilter } from './MediaBrowser'
import { ScriptureEditor } from './ScriptureEditor'
import { TextSlideLibrary } from './TextSlideLibrary'
import type { ViewMode } from './ViewModeSwitch'
import { defineTabs, TabList } from './TabList'

const tabs = defineTabs('cue-picker', [
  { id: 'media', label: 'Media', icon: LibraryBig },
  { id: 'text', label: 'Slides', icon: Type },
  { id: 'scripture', label: 'Bible lookup', icon: BookOpen },
])

export type CuePickerTab = (typeof tabs.options)[number]['id']

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
  const [mediaView, setMediaView] = useState<ViewMode>('list')
  const [scriptureView, setScriptureView] = useState<ViewMode>('list')
  const [textView, setTextView] = useState<ViewMode>('list')

  useEffect(() => {
    tabs.focus(tab)
  }, [tab])

  return (
    <Dialog title={t('Add cue')} className="cue-picker-dialog" onClose={onClose}>
      {destination && <p className="cue-picker-destination">{t('Adding to {name}', { name: destination })}</p>}
      <TabList tabs={tabs} selected={tab} onChange={onTabChange} label="Cue sources" />
      <section {...tabs.panelProps('media', tab)}>
        <MediaBrowser sources={project.sources} filter={filter} onFilterChange={setFilter} view={mediaView} onViewChange={setMediaView}
          busy={busy} onSave={file => onAdd(mediaCue(file))} />
      </section>
      <section {...tabs.panelProps('text', tab)}>
        <TextSlideLibrary active={tab === 'text'} items={project.textLibrary} libraries={project.slideLibraries} theme={textTheme}
          view={textView} onViewChange={setTextView} busy={busy} saving={false} error=""
          actions={{ kind: 'pick', onAdd: item => onAdd(copyLibraryTextSlide(item)) }} />
      </section>
      <section {...tabs.panelProps('scripture', tab)} className="scripture-panel">
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
