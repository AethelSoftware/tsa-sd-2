import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { 
  Navigation, 
  Map, 
  Brain, 
  User, 
  LogOut,
  Home,
  Shield,
  Bell,
  Settings
} from 'lucide-react'
import Dashboard from './Dashboard.jsx'
import AdminPage from './AdminPage.jsx'
import Login from './Login.jsx'
import LiveNavigation from './LiveNavigation.jsx';
import './index.css'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userRole, setUserRole] = useState('user')
  const location = useLocation()

  useEffect(() => {
    // Check authentication on mount
    const token = localStorage.getItem('tryver_token')
    const role = localStorage.getItem('tryver_role')
    if (token) {
      setIsAuthenticated(true)
      setUserRole(role || 'user')
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('tryver_token')
    localStorage.removeItem('tryver_role')
    setIsAuthenticated(false)
    setUserRole('user')
  }

  // Protected Route wrapper
  const ProtectedRoute = ({ children, requiredRole = 'user' }) => {
    if (!isAuthenticated) {
      return <Navigate to="/login" replace />
    }
    
    if (requiredRole === 'admin' && userRole !== 'admin') {
      return <Navigate to="/dashboard" replace />
    }
    
    return children
  }

  if (!isAuthenticated && location.pathname !== '/login') {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      {/* Navigation */}
      {isAuthenticated && (
        <nav className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-8">
                <Link to="/dashboard" className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-500 rounded-lg">
                    <Navigation className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-xl font-bold text-slate-900">Tryver</span>
                </Link>
                
                <div className="hidden md:flex items-center space-x-6">
                  <Link 
                    to="/dashboard" 
                    className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                      location.pathname === '/dashboard' 
                        ? 'bg-blue-50 text-blue-600' 
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Map className="h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                  
                  <Link 
                    to="/navigation" 
                    className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                      location.pathname === '/navigation' 
                        ? 'bg-blue-50 text-blue-600' 
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Navigation className="h-4 w-4" />
                    <span>Live Navigation</span>
                  </Link>
                  
                  {userRole === 'admin' && (
                    <Link 
                      to="/admin" 
                      className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                        location.pathname === '/admin' 
                          ? 'bg-blue-50 text-blue-600' 
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Brain className="h-4 w-4" />
                      <span>Admin</span>
                    </Link>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <User className="h-4 w-4 text-slate-600" />
                  </div>
                  <div className="hidden md:block">
                    <div className="text-sm font-medium text-slate-900">
                      {userRole === 'admin' ? 'Administrator' : 'User'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {userRole === 'admin' ? 'Full Access' : 'Standard Access'}
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden md:inline">Logout</span>
                </button>
              </div>
            </div>
          </div>
        </nav>
      )}
      
      {/* Mobile Navigation */}
      {isAuthenticated && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50">
          <div className="flex justify-around items-center h-16">
            <Link 
              to="/dashboard" 
              className={`flex flex-col items-center p-2 ${location.pathname === '/dashboard' ? 'text-blue-600' : 'text-slate-600'}`}
            >
              <Map className="h-5 w-5" />
              <span className="text-xs mt-1">Dashboard</span>
            </Link>
            
            <Link 
              to="/navigation" 
              className={`flex flex-col items-center p-2 ${location.pathname === '/navigation' ? 'text-blue-600' : 'text-slate-600'}`}
            >
              <Navigation className="h-5 w-5" />
              <span className="text-xs mt-1">Navigation</span>
            </Link>
            
            {userRole === 'admin' && (
              <Link 
                to="/admin" 
                className={`flex flex-col items-center p-2 ${location.pathname === '/admin' ? 'text-blue-600' : 'text-slate-600'}`}
              >
                <Brain className="h-5 w-5" />
                <span className="text-xs mt-1">Admin</span>
              </Link>
            )}
            
            <button
              onClick={handleLogout}
              className="flex flex-col items-center p-2 text-slate-600"
            >
              <LogOut className="h-5 w-5" />
              <span className="text-xs mt-1">Logout</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 ${isAuthenticated ? 'pb-20 md:pb-6' : ''}`}>
        <Routes>
          <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated} setUserRole={setUserRole} />} />
          
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          
          <Route path="/navigation" element={
            <ProtectedRoute>
              <LiveNavigation />
            </ProtectedRoute>
          } />
          
          <Route path="/admin" element={
            <ProtectedRoute requiredRole="admin">
              <AdminPage />
            </ProtectedRoute>
          } />
          
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>

      {/* Footer */}
      {isAuthenticated && (
        <footer className="border-t border-slate-200 bg-white/50 backdrop-blur-sm mt-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-col md:flex-row justify-between items-center">
              <div className="flex items-center space-x-3 mb-4 md:mb-0">
                <Shield className="h-5 w-5 text-blue-500" />
                <span className="text-sm text-slate-600">Tryver Safety Routing System v2.1.0</span>
              </div>
              <div className="flex items-center space-x-6">
                <a href="#" className="text-sm text-slate-500 hover:text-slate-900">Privacy</a>
                <a href="#" className="text-sm text-slate-500 hover:text-slate-900">Terms</a>
                <a href="#" className="text-sm text-slate-500 hover:text-slate-900">Support</a>
                <a href="#" className="text-sm text-slate-500 hover:text-slate-900">API Docs</a>
              </div>
            </div>
            <div className="mt-4 text-center md:text-left">
              <p className="text-xs text-slate-500">
                © {new Date().getFullYear()} Tryver. All rights reserved. Safety first, always.
              </p>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}

export default App