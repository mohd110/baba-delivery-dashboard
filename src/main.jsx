// Build marker: 2026-07-23 — order timeline + unified Mark Ready / Order Late.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initDevice } from './lib/device.js'

// Service worker + install-prompt capture, before React mounts.
initDevice()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
