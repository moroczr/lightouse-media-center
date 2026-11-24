import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import Kiosk from './kiosk/Kiosk'
import Studio from './studio/Studio'
import { LanguageProvider } from './shared/i18n'
import { SlideThemesProvider } from './shared/SlideThemes'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(
  <LanguageProvider>
    <SlideThemesProvider>{location.hash.startsWith('#kiosk') ? <Kiosk /> : <Studio />}</SlideThemesProvider>
  </LanguageProvider>,
)
