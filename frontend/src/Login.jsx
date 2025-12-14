import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = isLogin ? '/api/auth/email-login' : '/api/auth/signup';
      
      const response = await fetch(`http://127.0.0.1:5000${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
        credentials: 'include' // Important for sessions
      });

      const data = await response.json();

      if (response.ok) {
        // Success - redirect to dashboard
        navigate('/dashboard');
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch (err) {
      setError('Network error: Could not connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    // Redirect to Flask OAuth endpoint
    window.location.href = 'http://127.0.0.1:5000/api/auth/login';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50/30 flex">
      <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
              Tryver
            </h1>
            <h2 className="mt-6 text-3xl font-extrabold text-slate-900">
              {isLogin ? 'Welcome back' : 'Join Tryver today'}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="font-semibold text-emerald-600 hover:text-emerald-500 focus:outline-none transition-colors"
              >
                {isLogin ? 'Create one now' : 'Sign in here'}
              </button>
            </p>
          </div>

          {/* Google OAuth Button */}
          <div className="mt-8">
            <button
              onClick={handleGoogleLogin}
              className="w-full flex justify-center items-center px-4 py-3.5 border border-slate-300 rounded-xl shadow-sm bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-all duration-200 hover:shadow-md"
            >
              <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </div>

          {/* Divider */}
          <div className="relative mt-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 bg-transparent text-slate-500 font-medium">Or continue with email</span>
            </div>
          </div>

          {/* Form */}
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {!isLogin && (
                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-slate-900 mb-2">
                    Full Name
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required={!isLogin}
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder-slate-400"
                    placeholder="Enter your full name"
                  />
                </div>
              )}
              
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-900 mb-2">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder-slate-400"
                  placeholder="Enter your email"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-900 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder-slate-400"
                  placeholder={isLogin ? "Enter your password" : "Create a password"}
                  minLength="6"
                />
              </div>
            </div>

            {isLogin && (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="h-4 w-4 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded"
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-700">
                    Remember me
                  </label>
                </div>

                <div className="text-sm">
                  <a href="#" className="font-semibold text-emerald-600 hover:text-emerald-500 transition-colors">
                    Forgot password?
                  </a>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3.5 px-4 border border-transparent text-sm font-semibold rounded-xl text-white bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:-translate-y-0.5 hover:shadow-lg"
            >
              {loading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {isLogin ? 'Signing in...' : 'Creating account...'}
                </div>
              ) : (
                isLogin ? 'Sign in to your account' : 'Create your account'
              )}
            </button>

            {!isLogin && (
              <div className="text-xs text-slate-500 text-center">
                By signing up, you agree to our{' '}
                <a href="#" className="font-semibold text-emerald-600 hover:text-emerald-500 transition-colors">Terms of Service</a>
                {' '}and{' '}
                <a href="#" className="font-semibold text-emerald-600 hover:text-emerald-500 transition-colors">Privacy Policy</a>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Right Side - Image/Visual Area */}
      <div className="hidden lg:flex flex-1 relative bg-gradient-to-br from-emerald-600/90 to-green-700/90 items-center justify-center p-12">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url('https://static0.howtogeekimages.com/wordpress/wp-content/uploads/2023/09/apple-maps-iphone.jpg?w=1600&h=900&fit=crop')`
          }}
        />
        
        <div className="relative z-10 max-w-lg text-center text-white space-y-8">
          <div className="bg-white/10 rounded-2xl p-6 backdrop-blur-sm border border-white/10">
            <div className="flex items-center justify-center mb-4">
              <div className="flex text-amber-400">
                {"★".repeat(5)}
              </div>
            </div>
            <p className="text-emerald-100 italic mb-4">
              "Tryver has completely changed how I navigate the city as a blind person. The real-time safety alerts are life-changing."
            </p>
            <p className="text-sm text-emerald-200 font-semibold">- Sarah M., Tryver User</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;