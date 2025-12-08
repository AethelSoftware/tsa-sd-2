import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Eye, 
  EyeOff, 
  Mail, 
  Lock, 
  User, 
  Shield, 
  CheckCircle, 
  AlertCircle,
  Navigation,
  Star,
  ArrowLeft
} from 'lucide-react';

const Login = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
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

    // Basic validation
    if (!formData.email || !formData.password || (!isLogin && !formData.name)) {
      setError('Please fill in all required fields');
      setLoading(false);
      return;
    }

    if (!isLogin && formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      setLoading(false);
      return;
    }

    try {
      // For demo purposes - in real app, you'd call your backend
      if (isLogin) {
        // Simulate login API call
        console.log('Logging in:', { email: formData.email, rememberMe });
        setTimeout(() => {
          navigate('/dashboard');
        }, 1500);
      } else {
        // Simulate signup API call
        console.log('Signing up:', formData);
        setTimeout(() => {
          navigate('/dashboard');
        }, 1500);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    // Redirect to Flask OAuth endpoint
    window.location.href = 'http://127.0.0.1:5000/api/auth/login';
  };

  const MobileSidebar = () => (
    <div className="lg:hidden fixed inset-0 z-50">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50"
        onClick={() => setShowMobileSidebar(false)}
      />
      
      {/* Sidebar Content */}
      <div className="absolute right-0 top-0 h-full w-80 bg-gradient-to-br from-blue-600/95 to-indigo-700/95 backdrop-blur-sm">
        {/* Close Button */}
        <button
          onClick={() => setShowMobileSidebar(false)}
          className="absolute left-4 top-4 p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
          aria-label="Close sidebar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="h-full flex flex-col justify-center p-6 text-center text-white space-y-8">
          {/* Single Testimonial */}
          <div className="bg-white/10 rounded-xl p-6 backdrop-blur-sm border border-white/10">
            <div className="flex items-center justify-center mb-3" aria-hidden="true">
              <div className="flex text-amber-400">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
            </div>
            <p className="text-blue-100 italic text-sm mb-4 leading-relaxed">
              "Tryver has completely changed how I navigate the city as a blind person. The real-time safety alerts are life-changing."
            </p>
            <div className="text-center">
              <p className="text-white font-semibold text-sm">Sarah M.</p>
              <p className="text-blue-200 text-xs">Tryver User</p>
            </div>
          </div>

          {/* Feature Highlights */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: Shield, text: 'Safety First' },
              { icon: Navigation, text: 'Smart Routing' },
              { icon: CheckCircle, text: 'Free Forever' },
              { icon: User, text: 'Accessible' }
            ].map((feature, index) => (
              <div key={index} className="flex items-center gap-2 text-blue-100">
                <feature.icon className="h-4 w-4 text-blue-200" />
                <span className="text-sm font-medium">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-white/80 backdrop-blur-sm border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-2 rounded-lg">
            <Navigation className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Tryver
          </h1>
        </div>
        <button
          onClick={() => setShowMobileSidebar(true)}
          className="text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium"
        >
          Learn More
        </button>
      </div>

      {/* Left Side - Form Section */}
      <div className="flex-1 flex items-center justify-center py-8 px-4 sm:px-6 lg:px-8 lg:py-8">
        <div className="max-w-md w-full space-y-6">
          {/* Header - Hidden on mobile, shown on desktop */}
          <div className="hidden lg:block text-center space-y-3">
            <div className="flex items-center justify-center gap-3">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-2 rounded-lg">
                <Navigation className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Tryver
              </h1>
            </div>
            
            <div className="space-y-1">
              <h2 className="text-xl lg:text-2xl font-bold text-slate-900">
                {isLogin ? 'Welcome back' : 'Join Tryver today'}
              </h2>
              <p className="text-slate-600 text-xs lg:text-sm">
                {isLogin ? "Don't have an account? " : "Already have an account? "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="font-semibold text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg px-1 transition-colors"
                  aria-label={isLogin ? 'Switch to sign up' : 'Switch to sign in'}
                >
                  {isLogin ? 'Create one now' : 'Sign in here'}
                </button>
              </p>
            </div>
          </div>

          {/* Mobile-only header */}
          <div className="lg:hidden text-center space-y-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-slate-900">
                {isLogin ? 'Welcome back' : 'Join Tryver today'}
              </h2>
              <p className="text-slate-600 text-sm">
                {isLogin ? "Don't have an account? " : "Already have an account? "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="font-semibold text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg px-1 transition-colors"
                  aria-label={isLogin ? 'Switch to sign up' : 'Switch to sign in'}
                >
                  {isLogin ? 'Create one now' : 'Sign in here'}
                </button>
              </p>
            </div>
          </div>

          {/* Google OAuth Button */}
          <div className="mt-6">
            <button
              onClick={handleGoogleLogin}
              className="w-full flex justify-center items-center px-4 py-3 border border-slate-300 rounded-lg shadow-sm bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
              aria-label="Continue with Google"
            >
              <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </div>

          {/* Divider */}
          <div className="relative mt-6" aria-hidden="true">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 bg-transparent text-slate-500 font-medium">Or continue with email</span>
            </div>
          </div>

          {/* Form */}
          <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
            {error && (
              <div 
                className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium flex items-start gap-3"
                role="alert"
                aria-live="polite"
              >
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              {!isLogin && (
                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-slate-900 mb-2">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required={!isLogin}
                      value={formData.name}
                      onChange={handleChange}
                      className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-400 bg-white disabled:bg-slate-50 disabled:text-slate-500 text-base"
                      placeholder="Enter your full name"
                      disabled={loading}
                      aria-required={!isLogin}
                    />
                  </div>
                </div>
              )}
              
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-900 mb-2">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-400 bg-white disabled:bg-slate-50 disabled:text-slate-500 text-base"
                    placeholder="Enter your email"
                    disabled={loading}
                    aria-required="true"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-900 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    required
                    value={formData.password}
                    onChange={handleChange}
                    className="w-full pl-11 pr-12 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-400 bg-white disabled:bg-slate-50 disabled:text-slate-500 text-base"
                    placeholder={isLogin ? "Enter your password" : "Create a password (min. 6 characters)"}
                    minLength="6"
                    disabled={loading}
                    aria-required="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded p-1"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>

            {isLogin && (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded disabled:opacity-50"
                    disabled={loading}
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-700">
                    Remember me
                  </label>
                </div>

                <div className="text-sm">
                  <a 
                    href="/forgot-password" 
                    className="font-semibold text-blue-600 hover:text-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded px-1"
                    aria-label="Reset your password"
                  >
                    Forgot password?
                  </a>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center py-3.5 px-4 border border-transparent text-sm font-semibold rounded-lg text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:-translate-y-0.5 hover:shadow-lg disabled:hover:transform-none"
              aria-live="polite"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" aria-hidden="true"></div>
                  {isLogin ? 'Signing in...' : 'Creating account...'}
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" aria-hidden="true" />
                  {isLogin ? 'Sign in to your account' : 'Create your account'}
                </>
              )}
            </button>

            {!isLogin && (
              <div className="text-sm text-slate-500 text-center">
                By signing up, you agree to our{' '}
                <a 
                  href="/terms" 
                  className="font-semibold text-blue-600 hover:text-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-0.5"
                >
                  Terms of Service
                </a>
                {' '}and{' '}
                <a 
                  href="/privacy" 
                  className="font-semibold text-blue-600 hover:text-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-0.5"
                >
                  Privacy Policy
                </a>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Right Side - Image & Single Review (Desktop Only) */}
      <div className="hidden lg:flex flex-1 relative bg-gradient-to-br from-blue-600/90 to-indigo-700/90 items-center justify-center p-8">
        {/* Background Image */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url('https://static0.howtogeekimages.com/wordpress/wp-content/uploads/2023/09/apple-maps-iphone.jpg?w=1600&h=900&fit=crop')`
          }}
          aria-hidden="true"
        />
        
        {/* Overlay */}
        <div className="absolute inset-0 bg-blue-900/70" aria-hidden="true"></div>
        
        {/* Content */}
        <div className="relative z-10 max-w-sm text-center text-white space-y-6">
          {/* Single Testimonial */}
          <div className="bg-white/10 rounded-xl p-6 backdrop-blur-sm border border-white/10">
            <div className="flex items-center justify-center mb-3" aria-hidden="true">
              <div className="flex text-amber-400">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
            </div>
            <p className="text-blue-100 italic text-sm mb-4 leading-relaxed">
              "Tryver has completely changed how I navigate the city as a blind person. The real-time safety alerts are life-changing."
            </p>
            <div className="text-center">
              <p className="text-white font-semibold text-sm">Sarah M.</p>
              <p className="text-blue-200 text-xs">Tryver User</p>
            </div>
          </div>

          {/* Feature Highlights */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Shield, text: 'Safety First' },
              { icon: Navigation, text: 'Smart Routing' },
              { icon: CheckCircle, text: 'Free Forever' },
              { icon: User, text: 'Accessible' }
            ].map((feature, index) => (
              <div key={index} className="flex items-center gap-1.5 text-blue-100">
                <feature.icon className="h-3 w-3 text-blue-200" />
                <span className="text-xs font-medium">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile Sidebar */}
      {showMobileSidebar && <MobileSidebar />}
    </div>
  );
};

export default Login;