import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import Kiosk from './kiosk/Kiosk'
import Studio from './studio/Studio'
import { LanguageProvider } from './shared/i18n'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(
  <LanguageProvider>{location.hash.startsWith('#kiosk') ? <Kiosk /> : <Studio />}</LanguageProvider>,
)
