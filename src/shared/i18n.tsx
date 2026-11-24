import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { isLanguageChange, readLanguage, translate, writeLanguage, type Language, type Translate } from './messages'

interface Localization {
  language: Language
  setLanguage: (language: Language) => void
  t: Translate
}

const LanguageContext = createContext<Localization | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(readLanguage)

  useEffect(() => {
    function sync(event: StorageEvent) {
      if (isLanguageChange(event)) setLanguage(readLanguage())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo<Localization>(() => ({
    language,
    setLanguage(next) {
      writeLanguage(next)
      setLanguage(next)
    },
    t: (message, values) => translate(language, message, values),
  }), [language])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('LanguageProvider is missing')
  return value
}
