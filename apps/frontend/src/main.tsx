import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { App } from './App';
import LoginPage from './pages/LoginPage';
import './styles/theme.css';

const isAuthenticated = (): boolean => Boolean(localStorage.getItem('token'));

type RequireAuthProps = {
  children: React.ReactNode;
};

const RequireAuth = ({ children }: RequireAuthProps) => {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={(
            <RequireAuth>
              <App />
            </RequireAuth>
          )}
        />
        <Route
          path="/"
          element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />}
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
