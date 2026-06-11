import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout/Layout'
import AuthPage from './components/Auth/AuthPage'
import Spinner from './components/UI/Spinner'
import Home from './pages/Home'
import AddPrice from './pages/AddPrice'
import Ranking from './pages/Ranking'
import Validate from './pages/Validate'
import Profile from './pages/Profile'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner fullscreen />
  if (!user) return <Navigate to="/auth" replace />
  return children
}

function ValidatorRoute({ children }) {
  const { user, isValidator, loading } = useAuth()
  if (loading) return <Spinner fullscreen />
  if (!user) return <Navigate to="/auth" replace />
  if (!isValidator) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <Spinner fullscreen />

  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />

      <Route element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Home />} />
        <Route path="add" element={<AddPrice />} />
        <Route path="ranking" element={<Ranking />} />
        <Route path="report" element={<Navigate to="/ranking?tab=reportes" replace />} />
        <Route path="benefits" element={<Navigate to="/profile?tab=beneficios" replace />} />
        <Route path="profile" element={<Profile />} />
        <Route path="validate" element={
          <ValidatorRoute>
            <Validate />
          </ValidatorRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
