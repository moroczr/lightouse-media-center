import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import Kiosk from './kiosk/Kiosk'
import Studio from './studio/Studio'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(location.hash.startsWith('#kiosk') ? <Kiosk /> : <Studio />)
