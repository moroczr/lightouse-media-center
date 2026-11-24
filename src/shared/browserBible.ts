import type { BibleVerseRow } from './verseSearch'
import type { BibleDatabase, BiblePreferences, BibleSettings, Book } from './model'

type BibleData = { books: Book[]; verses: BibleVerseRow[] }
type DatabaseFile = Omit<BibleDatabase, 'enabled'>

const preferencesKey = 'nemesa-bible-preferences'
const bundled: DatabaseFile[] = [
  { id: 'WEBP', name: 'World English Bible', fileName: null },
  { id: 'WEBPB', name: 'World English Bible (British)', fileName: null },
]
const cache = new Map<string, Promise<BibleData>>()
let connection: Promise<IDBDatabase> | undefined

function connect(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nemesa-bibles', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('databases', { keyPath: 'id' })
      request.result.createObjectStore('contents')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch(reason => {
    connection = undefined
    throw reason
  })
  return connection
}

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function loadPreferences(): BiblePreferences {
  const stored = localStorage.getItem(preferencesKey)
  return stored ? JSON.parse(stored) : { disabledIds: [], defaultId: 'WEBP' }
}

export async function browserBibleSettings(preferences = loadPreferences()): Promise<BibleSettings> {
  const db = await connect()
  const imported: DatabaseFile[] = await read(db.transaction('databases').objectStore('databases').getAll())
  const databases = [...bundled, ...imported].sort((a, b) => Number(!!a.fileName) - Number(!!b.fileName) || a.id.localeCompare(b.id))
    .map(item => ({ ...item, enabled: !preferences.disabledIds.includes(item.id) }))
  const enabled = databases.filter(item => item.enabled)
  const defaultId = enabled.find(item => item.id === preferences.defaultId)?.id ?? enabled[0]?.id ?? null
  return { databases, defaultId }
}

export async function saveBrowserBibleSettings(preferences: BiblePreferences) {
  const settings = await browserBibleSettings(preferences)
  localStorage.setItem(preferencesKey, JSON.stringify({
    disabledIds: settings.databases.filter(item => !item.enabled).map(item => item.id),
    defaultId: settings.defaultId,
  }))
  return settings
}

function validBook(value: unknown): value is Book {
  if (!value || typeof value !== 'object') return false
  const { id, name, chapters } = value as Book
  return typeof id === 'string' && !!id.trim() && typeof name === 'string' && !!name.trim()
    && Number.isInteger(chapters) && chapters > 0 && chapters <= 999
}

function validData(books: unknown, verses: unknown): boolean {
  if (!Array.isArray(books) || !books.length || !books.every(validBook)
    || !Array.isArray(verses) || !verses.length) return false
  const byBook = new Map(books.map(book => [book.id, book.chapters]))
  if (books.length !== byBook.size) return false
  const seen = new Set<string>()
  for (const row of verses) {
    if (!Array.isArray(row) || row.length !== 4) return false
    const [book, chapter, verse, text] = row
    const key = JSON.stringify([book, chapter, verse])
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > (byBook.get(book) ?? 0)
      || !Number.isInteger(verse) || verse < 1 || verse > 0xffffffff
      || typeof text !== 'string' || !text.trim() || seen.has(key)) return false
    seen.add(key)
  }
  return true
}

export async function importBrowserBible(file: File): Promise<BibleSettings> {
  if (!/\.json$/i.test(file.name)) throw new Error('The browser preview supports Bible JSON files.')
  const data = JSON.parse(await file.text())
  const stem = file.name.replace(/\.json$/i, '')
  const { books, verses } = data ?? {}
  const id = data?.id ?? stem.replace(/[^a-z0-9_-]/gi, '_')
  const name = data?.name ?? stem
  if (typeof id !== 'string' || !/^[a-z0-9_-]+$/i.test(id) || typeof name !== 'string' || !name.trim() || !validData(books, verses)) {
    throw new Error('This file does not contain valid Bible books and verses.')
  }
  const duplicate = new Error(`A Bible database with the ID “${id}” is already available.`)
  if (bundled.some(item => item.id.toLowerCase() === id.toLowerCase())) throw duplicate
  const db = await connect()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['databases', 'contents'], 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error?.name === 'ConstraintError' ? duplicate : transaction.error)
    transaction.objectStore('databases').add({ id, name, fileName: file.name })
    transaction.objectStore('contents').add({ books, verses }, id)
  })
  return browserBibleSettings()
}

async function load(translation: string): Promise<BibleData> {
  if (bundled.some(item => item.id === translation)) {
    const response = await fetch(`/bible-${translation}.json`)
    if (!response.ok) throw new Error('Could not load the Scripture database.')
    return response.json()
  }
  const db = await connect()
  const data = await read(db.transaction('contents').objectStore('contents').get(translation))
  if (!data) throw new Error('Could not find the Scripture database.')
  return data
}

export function loadBrowserBible(translation: string) {
  let request = cache.get(translation)
  if (!request) {
    request = load(translation)
    cache.set(translation, request)
    request.catch(() => cache.delete(translation))
  }
  return request
}
