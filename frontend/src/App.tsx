import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import DiaryPage from './components/DiaryPage'
import SessionEntryPage from './components/SessionEntryPage'
import { SessionProvider } from './session'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<SessionEntryPage />} />
          <Route path="/trade" element={<Dashboard />} />
          <Route path="/diary" element={<DiaryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  )
}

export default App
