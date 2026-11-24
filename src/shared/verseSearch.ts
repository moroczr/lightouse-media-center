import type { Book } from './model'
import type { PassageVerse } from './scripture'

export type BibleVerseRow = [book: string, chapter: number, verse: number, text: string]

const commonWords = new Set(
  'a am an and are as at be but by can for from had has have he her him his i in into is it me my not of on or our shall she so that the thee their them they this thou thy to unto us was we were will with ye you your'.split(' '),
)
const maxResults = 50

function words(text: string) {
  return text.toLowerCase().normalize('NFKD').replace(/\p{M}|['’]/gu, '').match(/[\p{L}\p{N}]+/gu) ?? []
}

export function canSearchVerseText(query: string) {
  return words(query).join('').length >= 3
}

function oneEditApart(shorter: string, longer: string) {
  if (shorter.length > longer.length) [shorter, longer] = [longer, shorter]
  if (longer.length - shorter.length > 1) return false
  let i = 0
  while (i < shorter.length && shorter[i] === longer[i]) i++
  if (shorter.length < longer.length) return shorter.slice(i) === longer.slice(i + 1)
  return shorter.slice(i + 1) === longer.slice(i + 1)
    || (shorter[i] === longer[i + 1] && shorter[i + 1] === longer[i]
      && shorter.slice(i + 2) === longer.slice(i + 2))
}

function matchingWords(term: string, vocabulary: Iterable<string>) {
  const matches = new Map([[term, 10]])
  if (term.length < 3 || commonWords.has(term)) return matches

  for (const word of vocabulary) {
    if (word === term) continue
    if (word.startsWith(term)) matches.set(word, 8)
    else if (term.length >= 4 && oneEditApart(term, word)) matches.set(word, 7)
  }
  return matches
}

function orderedProximity(tokens: readonly string[], terms: readonly Map<string, number>[]) {
  if (terms.length < 2) return 0
  // Track the latest start of each matched prefix so repeated words don't widen the best span.
  const starts = terms.map(() => -1)
  let best = 0
  tokens.forEach((word, index) => {
    for (let term = terms.length - 1; term > 0; term--) {
      const start = starts[term - 1]
      if (start === -1 || !terms[term].has(word)) continue
      starts[term] = start
      if (term === terms.length - 1) best = Math.max(best, terms.length / (index - start + 1))
    }
    if (terms[0].has(word)) starts[0] = index
  })
  return best
}

function sharedPhraseLength(tokens: readonly string[], query: readonly string[]) {
  const lengths = query.map(() => 0)
  let longest = 0
  for (const token of tokens) {
    for (let index = query.length - 1; index >= 0; index--) {
      const length = token === query[index] ? (lengths[index - 1] ?? 0) + 1 : 0
      if (length === query.length) return length
      lengths[index] = length
      longest = Math.max(longest, length)
    }
  }
  return longest
}

export function createVerseSearch(books: readonly Book[], verses: readonly BibleVerseRow[]) {
  const booksById = new Map(books.map(book => [book.id, book]))
  const postings = new Map<string, number[]>()
  const rows: { passage: PassageVerse; tokens: string[] }[] = []

  for (const [bookId, chapter, verse, text] of verses) {
    const book = booksById.get(bookId)
    if (!book) continue
    const tokens = words(text)
    const index = rows.length
    rows.push({ passage: { book, chapter, verse, text }, tokens })
    for (const token of new Set(tokens)) {
      const positions = postings.get(token)
      if (positions) positions.push(index)
      else postings.set(token, [index])
    }
  }

  return (input: string): PassageVerse[] => {
    const query = words(input)
    if (query.join('').length < 3) return []
    const distinctive = query.filter(word => !commonWords.has(word))
    const terms = [...new Set(distinctive.length ? distinctive : query)]
      .map(term => matchingWords(term, postings.keys()))
    const minimum = Math.ceil(terms.length * 2 / 3)
    const coverage = new Uint16Array(rows.length)
    const strength = new Uint16Array(rows.length)
    const bestMatch = new Uint8Array(rows.length)

    for (const term of terms) {
      bestMatch.fill(0)
      for (const [word, score] of term) {
        for (const index of postings.get(word) ?? []) {
          bestMatch[index] = Math.max(bestMatch[index], score)
        }
      }
      bestMatch.forEach((score, index) => {
        if (!score) return
        coverage[index]++
        strength[index] += score
      })
    }

    const matches: { index: number; exact: boolean; score: number }[] = []
    rows.forEach((row, index) => {
      if (coverage[index] < minimum) return
      const sharedPhrase = sharedPhraseLength(row.tokens, query)
      const proximity = orderedProximity(row.tokens, terms)
      matches.push({
        index,
        exact: sharedPhrase === query.length,
        score: strength[index] + 3 * proximity + 2 * sharedPhrase,
      })
    })
    return matches.sort((a, b) => Number(b.exact) - Number(a.exact)
      || b.score - a.score || coverage[b.index] - coverage[a.index])
      .slice(0, maxResults)
      .map(({ index }) => rows[index].passage)
  }
}
