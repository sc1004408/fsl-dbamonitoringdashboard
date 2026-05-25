import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('token', data.token);
        navigate('/dashboard');
        return;
      }

      const payload = await response.json().catch(() => ({}));
      setErrorMessage(payload?.message ?? 'Sign-in failed. Verify your credentials.');
    } catch {
      setErrorMessage('Unable to reach authentication service.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetCredentials = () => {
    setUsername('');
    setPassword('');
    setErrorMessage('');
  };

  return (
    <main className="login-shell">
      <section className="login-panel">
        <p className="login-tag">SQL Server Operations Portal</p>
        <h1>DBA Console Sign-In</h1>
        <p className="login-subtitle">Authenticate with your DBA account to access monitoring dashboards and administrative tools.</p>

        <form className="login-form" onSubmit={handleLogin}>
          <label htmlFor="username">DBA Username</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {errorMessage && <p className="login-error">{errorMessage}</p>}

          <div className="login-actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing In...' : 'Sign In'}
            </button>
            <button type="button" className="login-reset-btn" onClick={handleResetCredentials} disabled={isSubmitting}>
              Reset
            </button>
          </div>
        </form>
      </section>
    </main>
  );
};

export default LoginPage;