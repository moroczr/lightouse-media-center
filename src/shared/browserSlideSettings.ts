import { isBuiltInTheme, type BackgroundImage, type SlideBackground, type SlideKind, type SlideSettings, type Theme } from './model'

const defaultThemeKey = 'lighthouse-default-slide-theme'
const backgroundsStore = 'backgrounds'
let connection: Promise<IDBDatabase> | undefined

function connect() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lighthouse-slide-themes', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(backgroundsStore, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch(reason => {
    connection = undefined
    throw reason
  })
  return connection
}

export async function loadBrowserSlideSettings(): Promise<SlideSettings> {
  const db = await connect()
  const backgrounds = await new Promise<SlideBackground[]>((resolve, reject) => {
    const request = db.transaction(backgroundsStore).objectStore(backgroundsStore).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const previousDefault = localStorage.getItem(defaultThemeKey)
  function readDefault(kind: SlideKind): Theme | null {
    const saved = localStorage.getItem(`${defaultThemeKey}:${kind}`) ?? previousDefault
    if (saved && isBuiltInTheme(saved)) return saved
    return backgrounds.find(image => image.id === saved)?.id ?? null
  }

  return { defaultThemes: { text: readDefault('text'), scripture: readDefault('scripture') }, backgrounds }
}

export async function addBrowserSlideBackground(image: BackgroundImage) {
  const db = await connect()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(backgroundsStore, 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.objectStore(backgroundsStore).add({ ...image, id: `image:${crypto.randomUUID()}` })
  })
}

export function saveBrowserDefaultSlideTheme(kind: SlideKind, theme: Theme | null) {
  // An empty value records an explicit reset and takes precedence over the former shared default.
  localStorage.setItem(`${defaultThemeKey}:${kind}`, theme ?? '')
}
