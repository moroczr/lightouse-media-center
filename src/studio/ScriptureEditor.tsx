import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { bible } from '../shared/bridge'
import { type BibleSettings, type Book, type ScriptureCue, type Theme, type Verse } from '../shared/model'
import {
  deleteReferenceSegment, lookupReference, normalizeBook, readVerseWindow, referenceSuggestions, verseLabel, verseWindowSize,
  type PassageVerse, type ReferenceSuggestion,
} from '../shared/scripture'
import { canSearchVerseText } from '../shared/verseSearch'
import { EditorActions, ThemePicker } from './Editors'

const segmentLabels = { book: 'Bible books', chapter: 'Chapters', verse: 'Verses' }

type Draft = {
  text: string
  auto: boolean
  complete?: boolean
  location?: { book: string; suffix: string }
}
type Navigation = { search: PassageVerse; start: PassageVerse; selected: PassageVerse; visible: PassageVerse[] }
type VerseWindow = Awaited<ReturnType<typeof readVerseWindow>>
type LoadResult<T> = { key: string; values: T[] } | { key: string; error: string }

export function ScriptureEditor({ existing, busy, onSave, onLive }: {
  existing?: ScriptureCue;
  busy: boolean;
  onSave: (cue: ScriptureCue) => void;
  onLive: (cue: ScriptureCue) => void;
}) {
  const initial = existing?.reference
  const [requestedTranslation, setTranslation] = useState(initial?.translation)
  const [settings, setSettings] = useState<BibleSettings>()
  const [translationError, setTranslationError] = useState('')
  const [theme, setTheme] = useState<Theme>(existing?.theme ?? 'violet')
  const [draft, setDraft] = useState<Draft>()
  const [byText, setByText] = useState(false)
  const [query, setQuery] = useState('')
  const [textResult, setTextResult] = useState<LoadResult<PassageVerse>>()
  const [textMatch, setTextMatch] = useState<{ key: string; verse: PassageVerse }>()
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
  const verseResults = useRef<HTMLUListElement>(null)
  const selectedRow = useRef<HTMLButtonElement>(null)
  const focusSelectedRow = useRef(false)

  const translations = settings?.databases.filter(item => item.enabled) ?? []
  const translation = translations.find(item => item.id === (requestedTranslation ?? settings?.defaultId))?.id ?? ''
  const unavailable = settings && !translation
    ? translations.length ? 'Choose an enabled translation to edit this cue.' : 'Enable a Bible database in Settings to look up verses.'
    : ''
  const books = bookList?.key === translation ? bookList : undefined
  const bookValues = books && 'values' in books ? books.values : undefined
  const original = bookValues?.find(book => book.id === initial?.book)
  const location = draft?.location
  const translatedBook = location && bookValues?.find(book => book.id === location.book)
  const text = translatedBook && location ? `${translatedBook.name} ${location.suffix}`
    : draft?.text ?? (initial ? `${original?.name ?? initial.book} ${initial.chapter}:${initial.verse}` : '')
  const referenceExample = bookValues?.find(book => book.id === '1PE')?.name ?? '1 Peter'
  const reference = useMemo(
    () => lookupReference(text, bookValues ?? []),
    [text, bookValues],
  )
  const { book, bookText, chapter, chapterText, verseText, segment } = reference
  const bookId = book?.id
  const chapterKey = bookId && chapter !== undefined && segment === 'verse' ? `${translation}/${bookId}/${chapter}` : ''
  const verses = verseList?.key === chapterKey ? verseList : undefined
  const foundVerse = verseText && verses && 'values' in verses
    ? verses.values.find(row => row.verse === Number(verseText)) : undefined
  const options = useMemo(() => referenceSuggestions(reference, verses && 'values' in verses ? verses.values : []), [reference, verses])
  const finished = draft?.complete ?? !!initial
  const suggestionsOpen = !byText && focused && !dismissed && !finished && options.length > 0
  const activeSuggestion = suggestionsOpen ? options[activeIndex] : undefined
  const search = useMemo(() => book && chapter !== undefined && foundVerse
    ? { book, chapter, ...foundVerse } : undefined, [book, chapter, foundVerse])
  const browse = navigation?.search === search ? navigation : undefined
  const start = browse?.start ?? search
  const currentWindow = verseWindow?.start === start ? verseWindow?.value : undefined
  const phrase = query.trim()
  const textKey = translation && byText && canSearchVerseText(phrase) ? `${translation}/${phrase}` : ''
  const result = textResult?.key === textKey ? textResult : undefined
  const hits = result && 'values' in result ? result.values : []
  const activeMatch = textMatch?.key === textKey && hits.includes(textMatch.verse) ? textMatch.verse : hits[0]
  const selected = byText ? activeMatch : browse?.selected ?? search
  const visible = byText ? hits : currentWindow?.visible ?? browse?.visible ?? (start ? [start] : [])
  const title = selected ? verseLabel(selected) : ''
  const selectedIndex = visible.findIndex(verse => verseLabel(verse) === title)
  const previousVerse = visible[selectedIndex - 1] ?? (byText ? undefined : currentWindow?.previous)
  const nextVerse = visible[selectedIndex + 1] ?? (byText ? undefined : currentWindow?.following)
  const canNavigate = byText || !!currentWindow
  const error = translationError || (books && 'error' in books ? books.error : '')
    || (verses && 'error' in verses ? verses.error : '')

  useEffect(() => {
    let active = true
    void bible.settings().then(values => {
      if (active) setSettings(values)
    }).catch(reason => { if (active) setTranslationError(String(reason)) })
    return () => { active = false }
  }, [])

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
    if (!chapterKey || !bookId || chapter === undefined) return
    let active = true
    void readChapter(bookId, chapter).then(values => {
      if (active) setVerseList({ key: chapterKey, values })
    }).catch(reason => { if (active) setVerseList({ key: chapterKey, error: String(reason) }) })
    return () => { active = false }
  }, [bookId, chapter, chapterKey, readChapter])

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
    if (!list || !row) return
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
  }, [selected, currentWindow])

  function removeSegment(offset: number) {
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
      const offset = start === end && (event.key === 'Backspace' || start === text.length) ? start - 1 : start
      removeSegment(offset)
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
      if (!finished && options.length) {
        event.preventDefault()
        setDismissed(false)
        setActiveIndex(index => index < 0
          ? (direction === 1 ? 0 : options.length - 1)
          : (index + direction + options.length) % options.length)
      } else if (selected) {
        event.preventDefault()
        moveVerse(direction)
      }
    }
  }

  function selectVerse(verse: PassageVerse) {
    if (byText) setTextMatch({ key: textKey, verse })
    else if (search && start) setNavigation({ search, start, selected: verse, visible })
  }

  function moveVerse(direction: -1 | 1, focusRow = false) {
    const verse = direction === -1 ? previousVerse : nextVerse
    if (!verse) return
    if (byText) {
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

  function textKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (selected && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      moveVerse(event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  function changeTranslation(next: string) {
    if (draft && book && segment !== 'book') {
      const suffix = verseText === undefined ? chapterText : `${chapterText}:${verseText}`
      setDraft({ ...draft, location: { book: book.id, suffix } })
    }
    remainingLetters.current = []
    setTranslation(next)
    setActiveIndex(-1)
    setDismissed(false)
  }

  function changeMode(next: boolean) {
    setByText(next)
    setActiveIndex(-1)
    setDismissed(false)
    inputRef.current?.focus()
  }

  function submitCue(action: (cue: ScriptureCue) => void) {
    if (busy || !selected) return
    action({
      id: existing?.id ?? crypto.randomUUID(), title, kind: 'scripture', theme,
      reference: { translation, book: selected.book.id, chapter: selected.chapter, verse: selected.verse },
    })
  }

  function actionKeys(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing
      || event.altKey || event.metaKey || event.shiftKey) return
    const target = event.target
    const onVerse = target === inputRef.current || (target instanceof HTMLElement && target.closest('.verse-result'))
    if (!onVerse && !event.ctrlKey) return
    event.preventDefault()
    if (event.repeat || (event.ctrlKey && existing)) return
    submitCue(event.ctrlKey ? onLive : onSave)
  }

  let status = 'Type a book name or abbreviation.'
  if (!books) status = 'Loading Bible books…'
  else if (segment === 'chapter' && book) {
    status = options.length ? `Choose a chapter of ${book.name}.` : `${book.name} has chapters 1–${book.chapters}.`
  } else if (segment === 'verse') {
    status = !verses ? 'Loading verses…' : options.length ? 'Choose a verse.' : 'Verse not found.'
  } else if (options.length) status = 'Choose a book to continue.'
  else if (bookText) status = 'Book not found. Try a book name or abbreviation.'

  if (byText) {
    if (!textKey) status = 'Enter a few letters or words from a verse.'
    else if (!result) status = 'Searching verses…'
    else if ('error' in result) status = result.error
    else status = 'No matching verses. Try fewer words or a different phrase.'
  }

  return (
    <form className="editor" onKeyDown={actionKeys} onSubmit={event => {
      event.preventDefault()
      submitCue(onSave)
    }}>
      <div className="scripture-toolbar">
        <div className="scripture-reference">
          <div className="scripture-search-heading">
            <label htmlFor={`${listId}-input`}>{byText ? 'Verse text' : 'Reference'}</label>
            <div className="scripture-modes" role="group" aria-label="Search by">
              <button type="button" className="button button-quiet" aria-pressed={!byText} onClick={() => changeMode(false)}>Reference</button>
              <button type="button" className="button button-quiet" aria-pressed={byText} onClick={() => changeMode(true)}>Verse text</button>
            </div>
          </div>
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input id={`${listId}-input`} role={byText ? undefined : 'combobox'}
              aria-autocomplete={byText ? undefined : 'list'} aria-expanded={byText ? undefined : suggestionsOpen}
              aria-controls={suggestionsOpen ? listId : undefined}
              aria-activedescendant={activeSuggestion ? `${listId}-${activeSuggestion.id}` : undefined}
              ref={element => {
                inputRef.current = element
                if (element) element.autofocus = true
              }}
              disabled={!translation} autoComplete="off" spellCheck={false} maxLength={byText ? 200 : 80}
              value={byText ? query : text} placeholder={byText ? 'e.g. love your enemies' : `e.g. ${referenceExample} 2:24`}
              onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActiveIndex(-1) }}
              onChange={byText ? event => setQuery(event.target.value) : changeReference}
              onKeyDown={byText ? textKeys : referenceKeys} />
          </div>
          {suggestionsOpen && (
            <ul id={listId} className="scripture-suggestions" role="listbox" aria-label={segmentLabels[segment]}>
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
        <label>
          Translation
          <span className="scripture-translation">
            <select value={translation} disabled={!translations.length}
              onChange={event => changeTranslation(event.target.value)}>
              {!translation && <option value="" disabled>
                {translations.length ? 'Choose a translation' : settings ? 'No enabled translations' : translationError ? 'Translations unavailable' : 'Loading translations…'}
              </option>}
              {translations.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </span>
        </label>
      </div>
      {selected ? (
        <section className="verse-browser" aria-label="Verse results" onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          moveVerse(event.key === 'ArrowUp' ? -1 : 1, event.target instanceof HTMLElement && event.target.closest('.verse-result') !== null)
        }}>
          <header className="verse-browser-header">
            <p aria-live="polite"><BookOpen size={17} aria-hidden="true" /><strong>{title}</strong></p>
            <div role="group" aria-label={byText ? 'Navigate matches' : 'Navigate verses'}>
              <button type="button" className="icon-button" aria-label={byText ? 'Previous match' : 'Move up one verse'}
                title={byText ? 'Previous match (↑)' : 'Previous verse (↑)'}
                disabled={!previousVerse || !canNavigate} onClick={() => moveVerse(-1)}><ChevronUp size={17} aria-hidden="true" /></button>
              <button type="button" className="icon-button" aria-label={byText ? 'Next match' : 'Move down one verse'}
                title={byText ? 'Next match (↓)' : 'Next verse (↓)'}
                disabled={!nextVerse || !canNavigate} onClick={() => moveVerse(1)}><ChevronDown size={17} aria-hidden="true" /></button>
            </div>
          </header>
          <ul className="verse-results" ref={verseResults} aria-label={byText ? 'Matching verses' : 'Verses'} aria-busy={!canNavigate}>
            {visible.map(verse => {
              const label = verseLabel(verse)
              return <li key={label}>
                <button type="button" className="verse-result" aria-pressed={label === title}
                  ref={label === title ? selectedRow : undefined}
                  onFocus={() => { if (label !== title) selectVerse(verse) }}
                  onClick={event => {
                    event.currentTarget.focus({ preventScroll: true })
                    selectVerse(verse)
                  }}>
                  <strong>{label}</strong><span>{verse.text}</span>
                </button>
              </li>
            })}
          </ul>
          {!byText && currentWindow?.incomplete && <p className="verse-browser-error" role="status">Some nearby verses could not be loaded.</p>}
        </section>
      ) : (
        <div className="verse-preview" aria-live="polite">
          <BookOpen size={17} aria-hidden="true" /><span>{unavailable || error || status}</span>
        </div>
      )}
      <ThemePicker value={theme} onChange={setTheme} />
      <EditorActions editing={!!existing} valid={!!selected && !busy} showShortcuts
        onLive={existing ? undefined : () => submitCue(onLive)} />
    </form>
  )
}
