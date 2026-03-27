import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const inputStyle = {
  width: '100%', padding: '11px 14px',
  border: '1.5px solid #e2e8f0', borderRadius: '9px',
  fontSize: '14px', color: '#0f172a', background: '#f8fafc',
  fontFamily: 'Inter, system-ui, sans-serif', outline: 'none',
  transition: 'all 0.15s', boxSizing: 'border-box',
};

const applyFocusStyle = (e) => {
  e.target.style.borderColor = '#10b981';
  e.target.style.background = '#f0fdf4';
  e.target.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.12)';
};

const removeFocusStyle = (e) => {
  e.target.style.borderColor = '#e2e8f0';
  e.target.style.background = '#f8fafc';
  e.target.style.boxShadow = 'none';
};

const FieldGroup = ({ label, rightSlot, children }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
      <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>{label}</label>
      {rightSlot}
    </div>
    {children}
  </div>
);

const Login = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({ email: '', password: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const endpoint = isLogin ? 'login' : 'signup';
      const response = await fetch(`http://localhost:5000/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        navigate('/dashboard');
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error: Could not connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:5000/api/auth/login';
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'Inter, system-ui, sans-serif', background: '#f0fdf4' }}>

      {/* ── LEFT PANEL ── */}
      <div style={{
        flex: '0 0 480px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '56px 52px',
        background: '#ffffff',
        boxShadow: '4px 0 40px rgba(0,0,0,0.06)',
        position: 'relative',
        zIndex: 2,
      }}>

        {/* Top accent bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #059669, #10b981, #34d399)' }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '44px' }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #059669, #10b981)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(16,185,129,0.35)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="white"/>
            </svg>
          </div>
          <span style={{ fontSize: '22px', fontWeight: 700, color: '#064e3b', letterSpacing: '-0.02em' }}>Tryver</span>
        </div>

        {/* Heading */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '30px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p style={{ fontSize: '14px', color: '#64748b', margin: 0, fontWeight: 400 }}>
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); }}
              style={{ background: 'none', border: 'none', color: '#059669', fontWeight: 600, fontSize: '14px', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: '3px' }}
            >
              {isLogin ? 'Create one now' : 'Sign in here'}
            </button>
          </p>
        </div>

        {/* Google Button */}
        <button
          onClick={handleGoogleLogin}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '10px', padding: '11px 16px', border: '1.5px solid #e2e8f0',
            borderRadius: '10px', background: '#fff', color: '#334155',
            fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              color: '#dc2626', padding: '11px 14px', borderRadius: '8px',
              fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" style={{ flexShrink: 0 }}>
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
              </svg>
              {error}
            </div>
          )}

          {!isLogin && (
            <FieldGroup label="Full Name">
              <input
                id="name" name="name" type="text" required={!isLogin}
                value={formData.name} onChange={handleChange}
                placeholder="Your full name"
                style={inputStyle}
                onFocus={applyFocusStyle}
                onBlur={removeFocusStyle}
              />
            </FieldGroup>
          )}

          <FieldGroup label="Email address">
            <input
              id="email" name="email" type="email" autoComplete="email" required
              value={formData.email} onChange={handleChange}
              placeholder="you@example.com"
              style={inputStyle}
              onFocus={applyFocusStyle}
              onBlur={removeFocusStyle}
            />
          </FieldGroup>

          <FieldGroup
            label="Password"
            rightSlot={isLogin && (
              <a href="#" style={{ fontSize: '12.5px', color: '#059669', textDecoration: 'none', fontWeight: 500 }}>
                Forgot password?
              </a>
            )}
          >
            <input
              id="password" name="password" type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required value={formData.password} onChange={handleChange}
              placeholder={isLogin ? '••••••••' : 'Min. 6 characters'}
              minLength="6"
              style={inputStyle}
              onFocus={applyFocusStyle}
              onBlur={removeFocusStyle}
            />
          </FieldGroup>

          {isLogin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" name="remember-me" style={{ accentColor: '#059669', width: '15px', height: '15px', cursor: 'pointer' }} />
              <span style={{ fontSize: '13.5px', color: '#64748b' }}>Remember me</span>
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px 20px', border: 'none',
              borderRadius: '10px', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? '#6ee7b7' : 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              color: 'white', fontSize: '14px', fontWeight: 600,
              fontFamily: 'inherit', letterSpacing: '0.01em',
              boxShadow: '0 4px 15px rgba(16,185,129,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              marginTop: '4px',
            }}
          >
            {loading ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3"/>
                  <path d="M12 2a10 10 0 0110 10" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                {isLogin ? 'Signing in…' : 'Creating account…'}
              </>
            ) : (
              isLogin ? 'Sign in to your account' : 'Create your account'
            )}
          </button>

          {!isLogin && (
            <p style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
              By signing up, you agree to our{' '}
              <a href="#" style={{ color: '#059669', textDecoration: 'none', fontWeight: 500 }}>Terms of Service</a>
              {' '}and{' '}
              <a href="#" style={{ color: '#059669', textDecoration: 'none', fontWeight: 500 }}>Privacy Policy</a>
            </p>
          )}
        </form>

        <p style={{ position: 'absolute', bottom: '24px', left: 0, right: 0, textAlign: 'center', fontSize: '12px', color: '#d1fae5' }}>
          © 2025 Tryver · Accessible navigation for all
        </p>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

        {/* Background image */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url('https://static0.howtogeekimages.com/wordpress/wp-content/uploads/2023/09/apple-maps-iphone.jpg?w=1600&h=900&fit=crop')`,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }} />

        {/* Dark green gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, rgba(4,47,46,0.88) 0%, rgba(6,78,59,0.78) 50%, rgba(5,150,105,0.55) 100%)',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 10, maxWidth: '400px', padding: '40px', width: '100%' }}>

          {/* Live badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px',
            background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)',
            borderRadius: '20px', padding: '5px 14px', marginBottom: '20px',
          }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#6ee7b7', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Live & Active</span>
          </div>

          {/* Hero text */}
          <h2 style={{ fontSize: '42px', fontWeight: 700, color: '#ffffff', lineHeight: 1.15, margin: '0 0 14px', letterSpacing: '-0.03em' }}>
            Navigate the city<br />
            <span style={{ color: '#34d399' }}>confidently.</span>
          </h2>
          <p style={{ fontSize: '15px', color: 'rgba(167,243,208,0.8)', margin: '0 0 36px', lineHeight: 1.6, fontWeight: 400 }}>
            Real-time safety alerts, accessible routing, and community-powered hazard detection.
          </p>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '28px' }}>
            {[
              { value: '50K+', label: 'Active Users' },
              { value: '4.9★', label: 'App Rating' },
              { value: '30+', label: 'Cities' },
            ].map(({ value, label }) => (
              <div key={label} style={{
                flex: 1, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
                padding: '14px 10px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>{value}</div>
                <div style={{ fontSize: '11px', color: 'rgba(167,243,208,0.65)', marginTop: '3px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Testimonial card */}
          <div style={{
            background: 'rgba(255,255,255,0.09)', backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: '16px',
            padding: '24px',
          }}>
            <div style={{ display: 'flex', gap: '3px', marginBottom: '14px' }}>
              {[...Array(5)].map((_, i) => (
                <svg key={i} width="14" height="14" viewBox="0 0 20 20" fill="#fbbf24">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              ))}
            </div>
            <p style={{ fontSize: '14.5px', color: 'rgba(240,253,244,0.9)', lineHeight: 1.65, margin: '0 0 18px', fontStyle: 'italic', fontWeight: 300 }}>
              "Tryver has completely changed how I navigate the city as a blind person. The real-time safety alerts are life-changing."
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #10b981, #059669)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '13px', fontWeight: 700, color: 'white',
              }}>S</div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f0fdf4' }}>Sarah M.</div>
                <div style={{ fontSize: '12px', color: 'rgba(167,243,208,0.6)', marginTop: '1px' }}>Verified Tryver User</div>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};

export default Login;