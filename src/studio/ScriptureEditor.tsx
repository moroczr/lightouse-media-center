import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { bible } from '../shared/bridge'
import { type Book, type Cue, type Theme, type Translation, type Verse } from '../shared/model'
import {
  deleteReferenceSegment, lookupReference, normalizeBook, readVerseWindow, referenceSuggestions, verseLabel, verseWindowSize,
  type PassageVerse, type ReferenceSuggestion,
} from '../shared/scripture'
import { EditorActions, ThemePicker } from './Editors'

const segmentLabels = { book: 'Bible books', chapter: 'Chapters', verse: 'Verses' }

type Draft = { text: string; auto: boolean; complete?: boolean }
type Navigation = { search: PassageVerse; start: PassageVerse; selected: PassageVerse; visible: PassageVerse[] }
type VerseWindow = Awaited<ReturnType<typeof readVerseWindow>>
type LoadResult<T> = { key: string; values: T[] } | { key: string; error: string }

export function ScriptureEditor({ existing, busy, onSave, onLive }: {
  existing?: Extract<Cue, { kind: 'scripture' }>;
  busy: boolean;
  onSave: (cue: Cue) => void;
  onLive: (cue: Cue) => void;
}) {
  const initial = existing?.reference
  const [translation, setTranslation] = useState(initial?.translation ?? 'WEBP')
  const [translations, setTranslations] = useState<Translation[]>([])
  const [translationError, setTranslationError] = useState('')
  const [theme, setTheme] = useState<Theme>(existing?.theme ?? 'violet')
  const [draft, setDraft] = useState<Draft>()
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
  const remainingLetters = useRef('')
  const verseResults = useRef<HTMLUListElement>(null)
  const selectedRow = useRef<HTMLButtonElement>(null)
  const focusSelectedRow = useRef(false)

  const books = bookList?.key === translation ? bookList : undefined
  const bookValues = books && 'values' in books ? books.values : undefined
  const original = bookValues?.find(book => book.id === initial?.book)
  const text = draft?.text ?? (initial ? `${original?.name ?? initial.book} ${initial.chapter}:${initial.verse}` : '')
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
  const suggestionsOpen = focused && !dismissed && !finished && options.length > 0
  const activeSuggestion = suggestionsOpen ? options[activeIndex] : undefined
  const search = useMemo(() => book && chapter !== undefined && foundVerse
    ? { book, chapter, ...foundVerse } : undefined, [book, chapter, foundVerse])
  const browse = navigation?.search === search ? navigation : undefined
  const start = browse?.start ?? search
  const selected = browse?.selected ?? search
  const currentWindow = verseWindow?.start === start ? verseWindow?.value : undefined
  const visible = currentWindow?.visible ?? browse?.visible ?? (start ? [start] : [])
  const title = selected ? verseLabel(selected) : ''
  const selectedIndex = visible.findIndex(verse => verseLabel(verse) === title)
  const previousVerse = selectedIndex > 0 ? visible[selectedIndex - 1] : currentWindow?.previous
  const nextVerse = visible[selectedIndex + 1] ?? currentWindow?.following
  const error = translationError || (books && 'error' in books ? books.error : '')
    || (verses && 'error' in verses ? verses.error : '')

  useEffect(() => {
    let active = true
    void bible.translations().then(values => {
      if (active) setTranslations(values)
    }).catch(reason => { if (active) setTranslationError(String(reason)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void bible.books(translation).then(values => {
      if (active) setBookList({ key: translation, values })
    }).catch(reason => { if (active) setBookList({ key: translation, error: String(reason) }) })
    return () => { active = false }
  }, [translation])

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
    if (segment === 'book') remainingLetters.current = option.remainingLetters ?? ''
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
    remainingLetters.current = ''
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
      if (letters && remainingLetters.current.startsWith(letters)) {
        remainingLetters.current = remainingLetters.current.slice(letters.length)
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
    remainingLetters.current = ''
    setDraft({ text: value, auto: !change.isComposing })
    setDismissed(false)
    setActiveIndex(-1)
  }

  function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      const start = event.currentTarget.selectionStart ?? text.length
      const end = event.currentTarget.selectionEnd ?? start
      const offset = start === end && (event.key === 'Backspace' || start === text.length) ? start - 1 : start
      removeSegment(offset)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = activeSuggestion ?? (suggestionsOpen
        ? options.find(candidate => candidate.exact) ?? (options.length === 1 ? options[0] : undefined)
        : undefined)
      if (option) completeSegment(option)
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
    if (search && start) setNavigation({ search, start, selected: verse, visible })
  }

  function moveVerse(direction: -1 | 1, focusRow = false) {
    const verse = direction === -1 ? previousVerse : nextVerse
    if (!search || !start || !currentWindow || !verse) return

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

  function makeCue(): Cue | undefined {
    if (busy || !selected) return
    return {
      id: existing?.id ?? crypto.randomUUID(), title, kind: 'scripture', theme,
      reference: { translation, book: selected.book.id, chapter: selected.chapter, verse: selected.verse },
    }
  }

  let status = 'Type a book name or abbreviation.'
  if (!books) status = 'Loading Bible books…'
  else if (segment === 'chapter' && book) {
    status = options.length ? `Choose a chapter of ${book.name}.` : `${book.name} has chapters 1–${book.chapters}.`
  } else if (segment === 'verse') {
    status = !verses ? 'Loading verses…' : options.length ? 'Choose a verse.' : 'Verse not found.'
  } else if (options.length) status = 'Choose a book to continue.'
  else if (bookText) status = 'Book not found. Try a book name or abbreviation.'

  return (
    <form className="editor" onSubmit={event => {
      event.preventDefault()
      const cue = makeCue()
      if (cue) onSave(cue)
    }}>
      <div className="scripture-toolbar">
        <div className="scripture-reference">
          <label htmlFor={`${listId}-input`}>Reference</label>
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input id={`${listId}-input`} role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen}
              aria-controls={suggestionsOpen ? listId : undefined}
              aria-activedescendant={activeSuggestion ? `${listId}-${activeSuggestion.id}` : undefined}
              ref={element => {
                inputRef.current = element
                if (element) element.autofocus = true
              }}
              autoComplete="off" spellCheck={false} maxLength={80}
              value={text} placeholder="e.g. 1 Pet 2:24"
              onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActiveIndex(-1) }}
              onChange={changeReference}
              onKeyDown={searchKeys} />
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
              onChange={event => { setTranslation(event.target.value); setActiveIndex(-1); setDismissed(false) }}>
              {!translations.some(option => option.id === translation) && (
                <option value={translation}>{translations.length || translationError ? translation : 'Loading translations…'}</option>
              )}
              {translations.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </span>
        </label>
      </div>
      {selected && start ? (
        <section className="verse-browser" aria-label="Verse results" onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          moveVerse(event.key === 'ArrowUp' ? -1 : 1, event.target instanceof HTMLElement && event.target.closest('.verse-result') !== null)
        }}>
          <header className="verse-browser-header">
            <p aria-live="polite"><BookOpen size={17} aria-hidden="true" /><strong>{title}</strong></p>
            <div role="group" aria-label="Navigate verses">
              <button type="button" className="icon-button" aria-label="Move up one verse" title="Previous verse (↑)"
                disabled={!previousVerse || !currentWindow} onClick={() => moveVerse(-1)}><ChevronUp size={17} aria-hidden="true" /></button>
              <button type="button" className="icon-button" aria-label="Move down one verse" title="Next verse (↓)"
                disabled={!nextVerse || !currentWindow} onClick={() => moveVerse(1)}><ChevronDown size={17} aria-hidden="true" /></button>
            </div>
          </header>
          <ul className="verse-results" ref={verseResults} aria-label="Verses" aria-busy={!currentWindow}>
            {visible.map(verse => {
              const label = verseLabel(verse)
              return <li key={label}>
                <button type="button" className="verse-result" aria-pressed={label === title}
                  ref={label === title ? selectedRow : undefined} onClick={event => {
                    event.currentTarget.focus({ preventScroll: true })
                    selectVerse(verse)
                  }}>
                  <strong>{label}</strong><span>{verse.text}</span>
                </button>
              </li>
            })}
          </ul>
          {currentWindow?.incomplete && <p className="verse-browser-error" role="status">Some nearby verses could not be loaded.</p>}
        </section>
      ) : (
        <div className="verse-preview" aria-live="polite">
          <BookOpen size={17} aria-hidden="true" /><span>{error || status}</span>
        </div>
      )}
      <ThemePicker value={theme} onChange={setTheme} />
      <EditorActions editing={!!existing} valid={!!selected && !busy} onLive={existing ? undefined : () => {
        const cue = makeCue()
        if (cue) onLive(cue)
      }} />
    </form>
  )
}
