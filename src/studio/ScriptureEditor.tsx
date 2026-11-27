import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type Ref } from 'react'
import { BookOpen, ChevronDown, ChevronRight, ChevronUp, Folder, Search, X } from 'lucide-react'
import { useLanguage } from '../shared/i18n'
import { translateError } from '../shared/messages'
import { bible, desktop } from '../shared/bridge'
import { builtInSlideDefaults, translationName, type AudienceScriptureCue, type BibleSettings, type Book, type ScriptureCue, type Theme, type Verse } from '../shared/model'
import {
  deleteReferenceSegment, formatScriptureCue, lookupReference, normalizeBook, readVerseWindow, referenceSuggestions, verseLabel, verseWindowSize,
  type PassageVerse, type ReferenceSuggestion,
} from '../shared/scripture'
import { useSlideThemes } from '../shared/SlideThemes'
import { canSearchVerseText } from '../shared/verseSearch'
import { EditorActions, EditorForm } from './Editors'
import { BackgroundPicker } from './BackgroundPicker'
import { ResultBrowser, useResultBrowser, type BrowserItem } from './ResultBrowser'
import { ViewModeSwitch, type ViewMode } from './ViewModeSwitch'
import type { CueDragStart } from './useCueDrag'

const segmentLabels = { book: 'Bible books', chapter: 'Chapters', verse: 'Verses' } as const

const searchModes = [
  { label: 'Reference', shortcut: '@', byText: false },
  { label: 'Verse text', shortcut: '/', byText: true },
] as const

type Draft = {
  text: string
  auto: boolean
  complete?: boolean
  location?: { book: string; suffix: string }
}

type BibleLocation = { bookId: string; chapter?: number }
type Navigation = { search: PassageVerse; start: PassageVerse; selected: PassageVerse; visible: PassageVerse[] }
type VerseWindow = Awaited<ReturnType<typeof readVerseWindow>>
type LoadResult<T> = { key: string; values: T[] } | { key: string; error: string }

export type ScriptureLookup = { presentSelection: () => void }

export function ScriptureEditor({ ref, existing, active, settingsRevision, busy, view, onViewChange, onSave, onPreview, onLive, onCuePointerDown, pickOnly = false }: {
  ref?: Ref<ScriptureLookup>;
  existing?: ScriptureCue;
  active: boolean;
  settingsRevision: number;
  busy: boolean;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onSave?: (cue: ScriptureCue) => void;
  onPreview?: (cue: AudienceScriptureCue | undefined) => void;
  onLive?: (cue: ScriptureCue) => Promise<boolean>;
  onCuePointerDown?: CueDragStart;
  pickOnly?: boolean;
}) {
  const { t } = useLanguage()
  const { settings: slideSettings, error: themeError } = useSlideThemes()
  const mosaic = view === 'grid'
  const initial = existing?.reference
  const [requestedTranslation, setTranslation] = useState(initial?.translation)
  const [settings, setSettings] = useState<BibleSettings>()
  const [translationError, setTranslationError] = useState('')
  const [chosenTheme, setTheme] = useState<Theme>()
  const theme = chosenTheme ?? existing?.theme ?? slideSettings?.defaultThemes.scripture ?? builtInSlideDefaults.scripture
  const themeReady = !!(chosenTheme || existing || slideSettings || themeError)
  const [location, setLocation] = useState<BibleLocation>()
  const [folderIndex, setFolderIndex] = useState(-1)
  const [draft, setDraft] = useState<Draft>()
  const [byText, setByText] = useState(false)
  const [query, setQuery] = useState('')
  const [textResult, setTextResult] = useState<LoadResult<PassageVerse>>()
  const [directMatch, setDirectMatch] = useState<{ key: string; verse: PassageVerse }>()
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [bookList, setBookList] = useState<LoadResult<Book>>()
  const [verseList, setVerseList] = useState<LoadResult<Verse>>()
  const [navigation, setNavigation] = useState<Navigation>()
  const [verseWindow, setVerseWindow] = useState<{ start: PassageVerse; value: VerseWindow }>()
  const chapters = useRef(new Map<string, Promise<Verse[]>>())
  const listId = useId()
  const activeOption = useRef<HTMLLIElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const moveCaret = useRef(false)
  const remainingLetters = useRef<string[]>([])
  const selectedRow = useRef<HTMLButtonElement>(null)
  const focusSelectedRow = useRef(false)

  const translations = settings?.databases.filter(item => item.enabled) ?? []
  const translation = translations.find(item => item.id === (requestedTranslation ?? settings?.defaultId))?.id ?? ''
  const loadingSettings = !settings && !translationError
  let unavailable = ''
  if (settings && !translation) {
    if (translations.length) unavailable = t('Choose an enabled translation to edit this cue.')
    else if (!desktop && !settings.databases.length) unavailable = t('Bible translations are available in the desktop app.')
    else if (!settings.databases.length) unavailable = t('Download a Bible translation in Settings to look up verses.')
    else unavailable = t('Enable a Bible translation in Settings to look up verses.')
  }
  const books = bookList?.key === translation ? bookList : undefined
  const bookValues = books && 'values' in books ? books.values : undefined
  const original = bookValues?.find(book => book.id === initial?.book)
  const draftLocation = draft?.location
  const translatedBook = draftLocation && bookValues?.find(book => book.id === draftLocation.book)
  const text = translatedBook && draftLocation ? `${translatedBook.name} ${draftLocation.suffix}`
    : draft?.text ?? (initial ? `${original?.name ?? initial.book} ${initial.chapter}:${initial.verse}` : '')
  const phrase = query.trim()
  const filtering = !!(byText ? phrase : text.trim())
  const searchingText = filtering && byText
  const byReference = filtering && !byText
  const openBook = !filtering ? bookValues?.find(book => book.id === location?.bookId) : undefined
  const openChapter = openBook && location?.chapter && location.chapter <= openBook.chapters ? location.chapter : undefined
  const openChapterLabel = openChapter === undefined ? '' : t('Chapter {number}', { number: openChapter })
  const reference = useMemo(
    () => lookupReference(text, bookValues ?? []),
    [text, bookValues],
  )
  const { book, bookText, chapter, chapterText, verseText, segment } = reference
  const chapterBookId = openChapter !== undefined ? openBook?.id : byReference && segment === 'verse' ? book?.id : undefined
  const chapterNumber = openChapter ?? chapter
  const chapterKey = chapterBookId && chapterNumber !== undefined ? `${translation}/${chapterBookId}/${chapterNumber}` : ''
  const verses = verseList?.key === chapterKey ? verseList : undefined
  const chapterRows = verses && 'values' in verses ? verses.values : undefined
  const foundVerse = byReference && verseText ? chapterRows?.find(row => row.verse === Number(verseText)) : undefined
  const options = useMemo(() => referenceSuggestions(reference, chapterRows ?? []), [reference, chapterRows])
  const finished = draft?.complete ?? !!initial
  const suggestionsOpen = !byText && focused && !dismissed && !finished && options.length > 0
  const activeSuggestion = suggestionsOpen ? options[activeIndex] : undefined
  const search = useMemo(() => book && chapter !== undefined && foundVerse
    ? { book, chapter, ...foundVerse } : undefined, [book, chapter, foundVerse])
  const browse = navigation?.search === search ? navigation : undefined
  const start = browse?.start ?? search
  const currentWindow = verseWindow?.start === start ? verseWindow?.value : undefined
  const textKey = translation && byText && canSearchVerseText(phrase) ? `${translation}/${phrase}` : ''
  const activeTextSearch = useRef('')
  useLayoutEffect(() => {
    activeTextSearch.current = active ? textKey : ''
    return () => { activeTextSearch.current = '' }
  }, [active, textKey])
  const result = textResult?.key === textKey ? textResult : undefined
  const folderVerses = useMemo(() => openBook && openChapter !== undefined
    ? chapterRows?.map(row => ({ ...row, book: openBook, chapter: openChapter })) : undefined, [openBook, openChapter, chapterRows])
  const directKey = textKey ? `text:${textKey}` : openChapter !== undefined ? `chapter:${chapterKey}` : ''
  const directVerses = folderVerses ?? (result && 'values' in result ? result.values : [])
  const activeMatch = directMatch?.key === directKey && directVerses.includes(directMatch.verse) ? directMatch.verse : directVerses[0]
  const selected = byReference ? browse?.selected ?? search : activeMatch
  const visible = byReference ? currentWindow?.visible ?? browse?.visible ?? (start ? [start] : []) : directVerses
  const folders = filtering || openChapter !== undefined ? [] : openBook
    ? Array.from({ length: openBook.chapters }, (_, index) => ({
      label: t('Chapter {number}', { number: index + 1 }), location: { bookId: openBook.id, chapter: index + 1 },
    }))
    : (bookValues ?? []).map(book => ({ label: book.name, location: { bookId: book.id, chapter: undefined } }))
  const title = selected ? verseLabel(selected) : ''
  const selectedIndex = visible.findIndex(verse => verseLabel(verse) === title)
  const previousVerse = visible[selectedIndex - 1] ?? currentWindow?.previous
  const nextVerse = visible[selectedIndex + 1] ?? currentWindow?.following
  const canNavigate = !byReference || !!currentWindow
  const error = translationError || (books && 'error' in books ? books.error : '')
    || (verses && 'error' in verses ? verses.error : '')

  const cueForVerse = useCallback((verse: PassageVerse): ScriptureCue => ({
    id: existing?.id ?? crypto.randomUUID(), title: verseLabel(verse), kind: 'scripture', theme,
    reference: { translation, book: verse.book.id, chapter: verse.chapter, verse: verse.verse },
  }), [existing?.id, theme, translation])

  const browser = useResultBrowser({
    active, grid: mosaic, selectedIndex: selected ? selectedIndex : Math.min(folderIndex, folders.length - 1),
    disabled: busy || (!!selected && !themeReady),
    loading: loadingSettings || !!(translation && !books) || !!(chapterKey && !verses) || !!(textKey && !result),
    onBoundary: byReference ? direction => moveVerse(direction, true) : undefined,
    items: selected ? visible.map((verse): BrowserItem => ({
      key: verseLabel(verse), label: verseLabel(verse), description: verse.text, kind: 'scripture',
      select: () => selectVerse(verse),
      live: onLive && (() => void presentVerse(verse)), pick: onSave && (() => submitCue(onSave, verse)),
    })) : folders.map(({ label, location }, index): BrowserItem => ({
      key: `${location.bookId}/${location.chapter ?? ''}`, label, title: label,
      select: () => setFolderIndex(index), open: () => openFolder(location),
      icon: <span className="item-icon media-folder-icon">
        {openBook ? <Folder size={mosaic ? 30 : 18} aria-hidden="true" /> : <BookOpen size={mosaic ? 30 : 18} aria-hidden="true" />}
      </span>,
    })),
  })
  useImperativeHandle(ref, () => ({ presentSelection: () => { if (selected) void presentVerse(selected) } }))
  const verseResults = browser.listRef

  useEffect(() => {
    onPreview?.(selected && themeReady ? formatScriptureCue(cueForVerse(selected), selected) : undefined)
  }, [onPreview, selected, themeReady, cueForVerse])

  useEffect(() => {
    if (!active) return
    let current = true
    void bible.settings().then(values => {
      if (current) {
        setSettings(values)
        setTranslationError('')
      }
    }).catch(reason => { if (current) setTranslationError(String(reason)) })
    return () => { current = false }
  }, [active, settingsRevision])

  useEffect(() => {
    if (!translation) return
    let active = true
    void bible.books(translation).then(values => {
      if (active) setBookList({ key: translation, values })
    }).catch(reason => { if (active) setBookList({ key: translation, error: String(reason) }) })
    return () => { active = false }
  }, [translation])

  useEffect(() => {
    if (!textKey) return
    let active = true
    const timer = window.setTimeout(() => {
      void bible.search(translation, phrase).then(values => {
        if (active) setTextResult({ key: textKey, values })
      }).catch(reason => {
        if (active) setTextResult({ key: textKey, error: String(reason) })
      })
    }, 140)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [textKey, translation, phrase])

  const readChapter = useCallback((id: string, number: number) => {
    const key = `${translation}/${id}/${number}`
    const cached = chapters.current.get(key)
    if (cached) return cached
    const request = bible.verses(translation, id, number)
    chapters.current.set(key, request)
    void request.catch(() => chapters.current.delete(key))
    return request
  }, [translation])

  useEffect(() => {
    if (!chapterKey || !chapterBookId || chapterNumber === undefined) return
    let active = true
    void readChapter(chapterBookId, chapterNumber).then(values => {
      if (active) setVerseList({ key: chapterKey, values })
    }).catch(reason => { if (active) setVerseList({ key: chapterKey, error: String(reason) }) })
    return () => { active = false }
  }, [chapterBookId, chapterNumber, chapterKey, readChapter])

  useEffect(() => {
    if (!start || !bookValues) return
    let active = true
    void readVerseWindow(bookValues, start, readChapter).then(value => {
      if (active) setVerseWindow({ start, value })
    }).catch(() => {
      if (active) setVerseWindow({ start, value: { visible: [start], previous: undefined, following: undefined, incomplete: true } })
    })
    return () => { active = false }
  }, [start, bookValues, readChapter])

  const completeSegment = useCallback((option: ReferenceSuggestion) => {
    if (segment === 'book') remainingLetters.current = option.remainingLetters ?? []
    moveCaret.current = true
    setDraft({ text: option.value, auto: true, complete: segment === 'verse' })
    setDismissed(false)
    setActiveIndex(-1)
  }, [segment])

  useLayoutEffect(() => {
    if (moveCaret.current) {
      inputRef.current?.setSelectionRange(text.length, text.length)
      moveCaret.current = false
    }
    if (suggestionsOpen && draft?.auto && options.length === 1) completeSegment(options[0])
  }, [text, suggestionsOpen, draft, options, completeSegment])

  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: 'nearest' })
  }, [activeSuggestion])

  useLayoutEffect(() => {
    const list = verseResults.current
    const row = selectedRow.current
    if (!active || !list || !row) return
    if (focusSelectedRow.current) {
      row.focus({ preventScroll: true })
      focusSelectedRow.current = false
    }
    const view = list.getBoundingClientRect()
    const bounds = row.getBoundingClientRect()
    // Keep the highlight visible if the verse extends beyond the visible part of the list.
    if (bounds.top < view.top || bounds.height > view.height) {
      list.scrollTop += bounds.top - view.top
    } else if (bounds.bottom > view.bottom) {
      list.scrollTop += bounds.bottom - view.bottom
    }
  }, [active, selected, currentWindow, mosaic, verseResults])

  function removeSegment(offset: number) {
    browser.cancelPendingFocus()
    remainingLetters.current = []
    moveCaret.current = true
    setDraft({ text: deleteReferenceSegment(text, offset), auto: false })
    setDismissed(false)
    setActiveIndex(-1)
  }

  function changeReference(event: ChangeEvent<HTMLInputElement>) {
    const { selectionStart } = event.currentTarget
    let value = event.currentTarget.value
    const change = event.nativeEvent as InputEvent
    if (change.inputType?.startsWith('delete')) {
      removeSegment(selectionStart ?? value.length)
      return
    }
    if (value.startsWith(text) && !change.isComposing) {
      const added = value.slice(text.length)
      const letters = normalizeBook(added)
      // Keep accepting a book name or abbreviation after autocomplete has advanced to the chapter.
      if (letters) {
        const matching = remainingLetters.current.filter(ending => ending.startsWith(letters))
        if (matching.length) {
          remainingLetters.current = matching.map(ending => ending.slice(letters.length)).filter(Boolean)
          return
        }
      } else if (added === '.' && remainingLetters.current.length) {
        return
      }
      // Accept a separator that the typist enters immediately after autocomplete added it.
      if ((text.endsWith(' ') && /^\s+$/.test(added)) || (text.endsWith(':') && added === ':')) return
      if (book?.chapters === 1 && verseText === chapterText && added === ':') {
        // A fully typed citation can repeat the chapter that a single-chapter book already supplied.
        value = text.slice(0, text.indexOf(':') + 1)
        moveCaret.current = true
      }
    }
    remainingLetters.current = []
    setDraft({ text: value, auto: !change.isComposing })
    setDismissed(false)
    setActiveIndex(-1)
  }

  function referenceKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      const start = event.currentTarget.selectionStart ?? text.length
      const end = event.currentTarget.selectionEnd ?? start
      if (start === 0 && end === text.length) {
        clearSearch()
      } else {
        const offset = start === end && (event.key === 'Backspace' || start === text.length) ? start - 1 : start
        removeSegment(offset)
      }
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      const option = activeSuggestion ?? (!selected && suggestionsOpen
        ? options.find(candidate => candidate.exact) ?? (options.length === 1 ? options[0] : undefined)
        : undefined)
      if (option) {
        event.preventDefault()
        if (!event.repeat) completeSegment(option)
      }
    } else if (event.key === 'Escape' && suggestionsOpen) {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
      setActiveIndex(-1)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1
      if (!selected && !finished && options.length) {
        event.preventDefault()
        setDismissed(false)
        setActiveIndex(index => index < 0
          ? (direction === 1 ? 0 : options.length - 1)
          : (index + direction + options.length) % options.length)
      }
    }
  }

  function openFolder(next?: BibleLocation) {
    if (location?.bookId === next?.bookId && location?.chapter === next?.chapter) return
    browser.cancelPendingFocus()
    setFolderIndex(-1)
    setDirectMatch(undefined)
    setLocation(next)
    inputRef.current?.focus({ preventScroll: true })
  }

  function clearSearch(textMode = byText) {
    if (textMode) setQuery('')
    else {
      remainingLetters.current = []
      setDraft({ text: '', auto: false })
    }
    changeMode(textMode)
  }

  function selectVerse(verse: PassageVerse) {
    if (search && start) setNavigation({ search, start, selected: verse, visible })
    else setDirectMatch({ key: directKey, verse })
  }

  function moveVerse(direction: -1 | 1, focusRow = false) {
    const verse = direction === -1 ? previousVerse : nextVerse
    if (!verse) {
      if (focusRow) selectedRow.current?.focus({ preventScroll: true })
      return
    }
    if (!byReference) {
      focusSelectedRow.current = focusRow
      selectVerse(verse)
      return
    }
    if (!search || !start || !currentWindow) return

    let rows = visible
    if (direction === -1 && selectedIndex === 0) {
      rows = [verse, ...visible].slice(0, verseWindowSize)
    } else if (direction === 1 && selectedIndex === visible.length - 1) {
      rows = [...visible.slice(1), verse]
    }
    focusSelectedRow.current = focusRow
    setNavigation({
      search, start: rows === visible ? start : rows[0], selected: verse, visible: rows,
    })
  }

  function changeTranslation(next: string) {
    if (draft && book && segment !== 'book') {
      const suffix = verseText === undefined ? chapterText : `${chapterText}:${verseText}`
      setDraft({ ...draft, location: { book: book.id, suffix } })
    }
    remainingLetters.current = []
    setFolderIndex(-1)
    setTranslation(next)
    setActiveIndex(-1)
    setDismissed(false)
  }

  function changeMode(next: boolean) {
    browser.cancelPendingFocus()
    setByText(next)
    setActiveIndex(-1)
    setDismissed(false)
    inputRef.current?.focus()
  }

  function applyModeShortcut(character: string | null) {
    const mode = searchModes.find(mode => mode.shortcut === character)
    if (!mode) return false
    clearSearch(mode.byText)
    return true
  }

  function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (!event.metaKey && (!event.ctrlKey || event.getModifierState('AltGraph')) && applyModeShortcut(event.key)) {
      event.preventDefault()
      return
    }
    browser.onSearchKeyDown(event)
    if (!byText && !event.defaultPrevented) referenceKeys(event)
  }

  function changeSearch(event: ChangeEvent<HTMLInputElement>) {
    browser.cancelPendingFocus()
    // Virtual keyboards can insert a character without sending a matching keydown.
    const input = event.nativeEvent as InputEvent
    if (!input.isComposing && input.inputType === 'insertText' && applyModeShortcut(input.data)) return
    if (byText) setQuery(event.target.value)
    else changeReference(event)
  }

  async function presentVerse(verse: PassageVerse) {
    if (!onLive || busy || !themeReady) return
    const presented = await onLive(cueForVerse(verse))
    if (!presented || !textKey || activeTextSearch.current !== textKey) return

    remainingLetters.current = []
    focusSelectedRow.current = true
    setNavigation(undefined)
    setDraft({ text: verseLabel(verse), auto: false, complete: true })
    setActiveIndex(-1)
    setByText(false)
  }

  function submitCue(action: (cue: ScriptureCue) => void, verse = selected) {
    if (busy || !verse || !themeReady) return
    action(cueForVerse(verse))
  }

  let status = t('Type a book name or abbreviation.')
  if (!books) status = t('Loading Bible books…')
  else if (segment === 'chapter' && book) {
    status = options.length ? t('Choose a chapter of {book}.', { book: book.name })
      : t('{book} has chapters 1–{count}.', { book: book.name, count: book.chapters })
  } else if (segment === 'verse') {
    status = !verses ? t('Loading verses…') : options.length ? t('Choose a verse.') : t('Verse not found.')
  } else if (options.length) status = t('Choose a book to continue.')
  else if (bookText) status = t('Book not found. Try a book name or abbreviation.')

  if (openChapter !== undefined) {
    status = chapterRows ? t('No verses in this chapter.') : t('Loading verses…')
  } else if (!filtering && bookValues) {
    status = t('No Bible books available.')
  } else if (searchingText) {
    if (!textKey) status = t('Enter a few letters or words from a verse.')
    else if (!result) status = t('Searching verses…')
    else if ('error' in result) status = translateError(t, result.error)
    else status = t('No matching verses. Try fewer words or a different phrase.')
  }

  return (
    <EditorForm className="scripture-editor-form" onKeyDown={browser.onKeyDown} onSubmit={event => {
      event.preventDefault()
      if (onSave) submitCue(onSave)
    }} actions={
      onSave && <EditorActions editing={!!existing} valid={!!selected && !busy && themeReady} showShortcuts />
    }>
      <div className="scripture-toolbar">
        <div className="scripture-reference">
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input aria-label={byText ? t('Verse text') : t('Reference')} role={byText ? undefined : 'combobox'}
              aria-autocomplete={byText ? undefined : 'list'} aria-expanded={byText ? undefined : suggestionsOpen}
              aria-controls={suggestionsOpen ? listId : undefined}
              aria-activedescendant={activeSuggestion ? `${listId}-${activeSuggestion.id}` : undefined}
              ref={element => {
                inputRef.current = element
                if (element) element.autofocus = true
              }}
              disabled={!loadingSettings && !translation} autoComplete="off" spellCheck={false} maxLength={byText ? 200 : 80}
              value={byText ? query : text} placeholder={byText ? t('e.g. love your enemies') : t('e.g. Rome 10:9')}
              onFocus={() => setFocused(true)} onBlur={() => { browser.cancelPendingFocus(); setFocused(false); setActiveIndex(-1) }}
              onChange={changeSearch} onKeyDown={searchKeys} />
            {filtering && <button type="button" className="icon-button scripture-clear" aria-label={t('Clear search')}
              title={t('Clear search')} onClick={() => clearSearch()}><X size={15} aria-hidden="true" /></button>}
          </div>
          {suggestionsOpen && (
            <ul id={listId} className="scripture-suggestions" role="listbox" aria-label={t(segmentLabels[segment])}>
              {options.map(option => (
                <li key={option.id} id={`${listId}-${option.id}`} role="option" aria-selected={option === activeSuggestion}
                  ref={option === activeSuggestion ? activeOption : undefined}
                  onMouseDown={event => event.preventDefault()} onClick={() => completeSegment(option)}>
                  {option.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="scripture-modes" role="group" aria-label={t('Search by')}>
          {searchModes.map(mode => (
            <button key={mode.label} type="button" className="button button-quiet" aria-pressed={byText === mode.byText}
              aria-keyshortcuts={mode.shortcut} onClick={() => changeMode(mode.byText)}>
              {t(mode.label)} <kbd className="cue-shortcut" aria-hidden="true">{mode.shortcut}</kbd>
            </button>
          ))}
        </div>
        <div className="scripture-translation">
          <select aria-label={t('Translation')} value={translation} disabled={!translations.length}
            onChange={event => changeTranslation(event.target.value)}>
            {!translation && <option value="" disabled>
              {translations.length ? t('Choose a translation') : settings ? t('No enabled translations') : translationError ? t('Translations unavailable') : t('Loading translations…')}
            </option>}
            {translations.map(option => <option key={option.id} value={option.id}>{translationName(option)}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </div>
      </div>
      <div className="scripture-options">
        {!filtering && <nav className="text-library-path" aria-label={t('Bible books')}>
          {openBook
            ? <button type="button" className="button button-quiet" onClick={() => openFolder()}>{t('Bible books')}</button>
            : <span aria-current="location">{t('Bible books')}</span>}
          {openBook && <>
            <ChevronRight size={14} aria-hidden="true" />
            {openChapter === undefined
              ? <span aria-current="location">{openBook.name}</span>
              : <button type="button" className="button button-quiet" title={openBook.name}
                onClick={() => openFolder({ bookId: openBook.id })}>{openBook.name}</button>}
          </>}
          {openChapter !== undefined && <>
            <ChevronRight size={14} aria-hidden="true" />
            <span aria-current="location">{openChapterLabel}</span>
          </>}
        </nav>}
        <div className="scripture-options-controls">
          {!pickOnly && <BackgroundPicker active={active} value={theme} onChange={setTheme} />}
          <ViewModeSwitch view={view} onChange={onViewChange} label="Bible view" gridLabel="Mosaic view" />
        </div>
      </div>
      <section className="scripture-results" aria-label={t(filtering || openChapter !== undefined ? 'Verse results' : openBook ? 'Chapters' : 'Bible books')}>
        {selected ? (
          <>
            <header className="verse-browser-header">
              <p aria-live="polite"><BookOpen size={17} aria-hidden="true" /><strong>{title}</strong></p>
              <div role="group" aria-label={byText ? t('Navigate matches') : t('Navigate verses')}>
                <button type="button" className="icon-button" aria-label={byText ? t('Previous match') : t('Move up one verse')}
                  title={byText ? t('Previous match (↑)') : t('Previous verse (↑)')}
                  disabled={!previousVerse || !canNavigate} onClick={() => moveVerse(-1)}><ChevronUp size={17} aria-hidden="true" /></button>
                <button type="button" className="icon-button" aria-label={byText ? t('Next match') : t('Move down one verse')}
                  title={byText ? t('Next match (↓)') : t('Next verse (↓)')}
                  disabled={!nextVerse || !canNavigate} onClick={() => moveVerse(1)}><ChevronDown size={17} aria-hidden="true" /></button>
              </div>
            </header>
            <ResultBrowser browser={browser} variant="passage" selectedRef={selectedRow} onCuePointerDown={onCuePointerDown}
              label={byText && filtering ? t('Matching verses') : t('Verses')} loading={!canNavigate} />
            {!byText && currentWindow?.incomplete && <p className="verse-browser-error" role="status">{t('Some nearby verses could not be loaded.')}</p>}
          </>
        ) : folders.length ? (
          <ResultBrowser key={`${translation}/${openBook?.id ?? ''}`} browser={browser}
            className="scripture-scroll" label={t(openBook ? 'Chapters' : 'Bible books')} />
        ) : (
          <div className="verse-preview scripture-scroll" role="status">
            <BookOpen size={17} aria-hidden="true" /><span>{unavailable || (error ? translateError(t, error) : status)}</span>
          </div>
        )}
      </section>
    </EditorForm>
  )
}
