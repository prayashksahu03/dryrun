import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import App from './App'
import HomePage from './pages/HomePage'
import LearnPage from './pages/LearnPage'
import SolvePage from './pages/SolvePage'
import SiteLayout from './components/site/SiteLayout'
import './index.css'

// When the app is served under a sub-path (e.g. /dryrun/ on the OA box), Vite's
// BASE_URL carries that prefix; the router must match it. Defaults to '/' for the
// normal root deploy, so this is a no-op there.
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={BASENAME}>
      <Routes>
        <Route path="/" element={<SiteLayout><HomePage /></SiteLayout>} />
        <Route path="/learn" element={<SiteLayout><LearnPage /></SiteLayout>} />
        <Route path="/app" element={<App />} />
        <Route path="/solve/:id" element={<SolvePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  </React.StrictMode>,
)
