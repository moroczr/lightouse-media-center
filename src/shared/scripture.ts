import type { AudienceScriptureCue, Book, ScriptureCue, Verse } from './model'

const abbreviations: Readonly<Record<string, string>> = {
  JDG: 'judg',
  SOL: 'songofsongs',
  MAT: 'mt',
  MAR: 'mk',
  LUK: 'lk',
  JOH: 'jn',
  PHI: 'php',
  JAM: 'jas',
}

// The book must contain a letter so the leading number in "1 Peter" stays with the book.
const referencePattern = /^([1-3]?\s*\p{L}[\p{L}\s.'’-]*?)\s*(\d+)(?:\s*:\s*(.*))?$/u

export function normalizeBook(value: string) {
  return value.toLowerCase().replace(/[.\s]/g, '')
}

function numericPrefix(value: string) {
  return value.replace(/^0+(?=\d)/, '')
}

export function lookupReference(input: string, books: readonly Book[]) {
  const text = input.trim()
  const match = referencePattern.exec(text)
  const bookText = normalizeBook(match?.[1] ?? text)
  const candidates = bookText ? books.filter(book => (
    normalizeBook(book.name).startsWith(bookText)
    || book.id.toLowerCase() === bookText
    || abbreviations[book.id] === bookText
  )) : []
  const exact = candidates.find(book => normalizeBook(book.name) === bookText)
    ?? candidates.find(book => book.id.toLowerCase() === bookText || abbreviations[book.id] === bookText)
  const book = exact ?? (candidates.length === 1 ? candidates[0] : undefined)
  const chapterText = match?.[2] ?? ''
  const verseText = match?.[3]
  const chapter = book && Number(chapterText) >= 1 && Number(chapterText) <= book.chapters
    ? Number(chapterText) : undefined
  const bookComplete = book && (match || (exact && /\s$/.test(input)))
  const segment = !bookComplete ? 'book' : chapter !== undefined && verseText !== undefined ? 'verse' : 'chapter'

  return { book, bookText, candidates, chapter, chapterText, verseText, segment } as const
}

export interface ReferenceSuggestion {
  id: string
  label: string
  value: string
  exact?: boolean
  remainingLetters?: string
}

export function referenceSuggestions(reference: ReturnType<typeof lookupReference>, verses: readonly Verse[]): ReferenceSuggestion[] {
  const { book, bookText, candidates, chapter, chapterText, verseText, segment } = reference
  const verseSuffix = verseText === undefined ? '' : `:${verseText}`
  if (segment === 'book' || !book) {
    return candidates.map(option => {
      const name = normalizeBook(option.name)
      return {
        id: option.id,
        label: option.name,
        value: `${option.name} ${chapterText}${verseSuffix}`,
        exact: name === bookText || option.id.toLowerCase() === bookText || abbreviations[option.id] === bookText,
        remainingLetters: !chapterText && name.startsWith(bookText) ? name.slice(bookText.length) : undefined,
      }
    })
  }
  if (segment === 'chapter') {
    return Array.from({ length: book.chapters }, (_, index) => String(index + 1))
      .filter(number => number.startsWith(numericPrefix(chapterText)))
      .map(number => ({
        id: number, label: number, exact: number === numericPrefix(chapterText),
        value: `${book.name} ${number}:${verseText ?? ''}`,
      }))
  }
  const prefix = numericPrefix(verseText ?? '')
  return verses.map(row => String(row.verse)).filter(number => number.startsWith(prefix)).map(number => ({
    id: number, label: number, exact: number === prefix, value: `${book.name} ${chapter}:${number}`,
  }))
}

export function deleteReferenceSegment(input: string, offset: number) {
  const text = input.trimEnd()
  const match = referencePattern.exec(text.trimStart())
  if (!match) return ''
  const colon = text.indexOf(':')
  if (match[3] && offset > colon) return text.slice(0, colon + 1)
  const chapterStart = text.slice(0, colon < 0 ? undefined : colon).lastIndexOf(match[2])
  return offset >= chapterStart ? `${text.slice(0, chapterStart).trimEnd()} ` : ''
}

type ChapterPosition = { book: Book; chapter: number }
export type PassageVerse = ChapterPosition & Verse

export function verseLabel({ book, chapter, verse }: PassageVerse) {
  return `${book.name} ${chapter}:${verse}`
}

export function formatScriptureCue(cue: ScriptureCue, text: string): AudienceScriptureCue {
  return { ...cue, text, caption: `${cue.title} · ${cue.reference.translation}` }
}

function adjacentChapter(books: readonly Book[], position: ChapterPosition, direction: -1 | 1): ChapterPosition | undefined {
  const { book } = position
  const chapter = position.chapter + direction
  if (chapter >= 1 && chapter <= book.chapters) return { book, chapter }
  const neighbor = books[books.findIndex(candidate => candidate.id === book.id) + direction]
  if (neighbor) return { book: neighbor, chapter: direction === -1 ? neighbor.chapters : 1 }
}

export async function readAdjacentVerses(
  books: readonly Book[],
  start: ChapterPosition & Pick<Verse, 'verse'>,
  readChapter: (bookId: string, chapter: number) => Promise<Verse[]>,
) {
  const { book, chapter, verse } = start
  const current = await readChapter(book.id, chapter)
  const index = current.findIndex(row => row.verse === verse)
  if (index < 0) throw new Error('This verse is unavailable in the selected translation.')

  async function readNeighbor(direction: -1 | 1): Promise<PassageVerse | undefined> {
    const adjacent = current[index + direction]
    if (adjacent) return { ...adjacent, book, chapter }

    let position = adjacentChapter(books, start, direction)
    while (position) {
      const rows = await readChapter(position.book.id, position.chapter)
      const nearest = rows.at(direction === -1 ? -1 : 0)
      if (nearest) return { ...nearest, ...position }
      position = adjacentChapter(books, position, direction)
    }
  }

  const [previous, next] = await Promise.all([readNeighbor(-1), readNeighbor(1)])
  return { previous, next }
}

// Ten rows cover the tallest verse panel even when every verse fits on one line.
export const verseWindowSize = 10

export async function readVerseWindow(
  books: readonly Book[],
  start: PassageVerse,
  readChapter: (bookId: string, chapter: number) => Promise<Verse[]>,
) {
  const current = await readChapter(start.book.id, start.chapter)
  const index = current.findIndex(row => row.verse === start.verse)
  const limit = verseWindowSize + 1
  const rows: PassageVerse[] = current.slice(index, index + limit)
    .map(row => ({ ...row, book: start.book, chapter: start.chapter }))
  let incomplete = false

  try {
    let position = adjacentChapter(books, start, 1)
    while (position && rows.length < limit) {
      const chapter = await readChapter(position.book.id, position.chapter)
      const location = position
      rows.push(...chapter.slice(0, limit - rows.length).map(row => ({ ...row, ...location })))
      position = adjacentChapter(books, position, 1)
    }
  } catch {
    incomplete = true
  }

  // Fill from earlier verses when there are too few verses left at the end of the Bible.
  const backfill = incomplete ? 0 : Math.max(0, verseWindowSize - rows.length)
  const beforeLimit = backfill + 1
  const earlier: PassageVerse[] = current.slice(Math.max(0, index - beforeLimit), index)
    .map(row => ({ ...row, book: start.book, chapter: start.chapter }))
  try {
    let position = adjacentChapter(books, start, -1)
    while (position && earlier.length < beforeLimit) {
      const chapter = await readChapter(position.book.id, position.chapter)
      const location = position
      earlier.unshift(...chapter.slice(earlier.length - beforeLimit).map(row => ({ ...row, ...location })))
      position = adjacentChapter(books, position, -1)
    }
  } catch {
    incomplete = true
  }

  return {
    visible: [...earlier.slice(earlier.length - backfill), ...rows.slice(0, verseWindowSize)],
    previous: earlier.at(-(backfill + 1)),
    following: rows.at(verseWindowSize),
    incomplete,
  }
}
