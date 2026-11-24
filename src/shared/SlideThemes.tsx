import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { slideSettings } from './bridge'
import { useLanguage } from './i18n'
import { builtInThemes, isBuiltInTheme, type SlideSettings, type Theme } from './model'

interface SlideThemesState {
  settings?: SlideSettings
  error: string
  reload: () => Promise<void>
}

const SlideThemesContext = createContext<SlideThemesState | null>(null)

export function SlideThemesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<SlideThemesState, 'reload'>>({ error: '' })
  const request = useRef(0)

  const reload = useCallback(async () => {
    const id = ++request.current
    try {
      const settings = await slideSettings.load()
      if (id === request.current) setState({ settings, error: '' })
    } catch (reason) {
      if (id === request.current) setState(previous => ({
        ...previous, error: reason instanceof Error ? reason.message : String(reason),
      }))
    }
  }, [])

  useEffect(() => {
    let active = true
    let cleanup: (() => void) | undefined

    void slideSettings.listen(() => { if (active) void reload() }).then(unlisten => {
      if (!active) {
        unlisten()
        return
      }
      cleanup = unlisten
      void reload()
    }).catch(() => { if (active) void reload() })

    return () => {
      active = false
      request.current++
      cleanup?.()
    }
  }, [reload])

  return <SlideThemesContext.Provider value={{ ...state, reload }}>{children}</SlideThemesContext.Provider>
}

export function useSlideThemes() {
  const value = useContext(SlideThemesContext)
  if (!value) throw new Error('SlideThemesProvider is missing')
  return value
}

export function ThemeSwatch({ theme, url }: { theme: Theme; url?: string }) {
  return (
    <span className={`theme-swatch slide--${isBuiltInTheme(theme) ? theme : 'plain'}`} aria-hidden="true">
      {url && <img src={url} alt="" loading="lazy" />}
    </span>
  )
}

export function ThemePreview({ theme }: { theme: Theme }) {
  const { t } = useLanguage()
  const { settings } = useSlideThemes()
  const builtIn = builtInThemes.find(option => option.id === theme)
  const image = settings?.backgrounds.find(option => option.id === theme)
  const name = builtIn ? t(builtIn.label) : image?.name
  if (!name) return null

  return (
    <figure className="theme-preview" aria-label={t('{name} background preview', { name })}>
      <div className={`theme-preview-image slide--${builtIn?.id ?? 'plain'}`}>
        {image && <img src={image.url} alt="" />}
      </div>
      <figcaption>{name}</figcaption>
    </figure>
  )
}
