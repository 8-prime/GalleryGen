import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Dashboard } from './pages/Dashboard'
import { Images } from './pages/Images'
import { PortfolioEditor } from './pages/PortfolioEditor'
import { PublicPortfolio } from './pages/PublicPortfolio'
import { ProtectedRoute } from './components/ProtectedRoute'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/app/login" element={<Login />} />
          <Route path="/app/register" element={<Register />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/app/dashboard" element={<Dashboard />} />
            <Route path="/app/images" element={<Images />} />
            <Route path="/app/portfolios/:id/edit" element={<PortfolioEditor />} />
          </Route>
          <Route path="/p/:slug" element={<PublicPortfolio />} />
          <Route path="*" element={<Navigate to="/app/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
