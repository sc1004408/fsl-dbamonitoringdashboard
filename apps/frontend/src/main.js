import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { App } from './App';
import LoginPage from './pages/LoginPage';
import './styles/theme.css';
const isAuthenticated = () => Boolean(localStorage.getItem('token'));
const RequireAuth = ({ children }) => {
    if (!isAuthenticated()) {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return _jsx(_Fragment, { children: children });
};
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/dashboard", element: (_jsx(RequireAuth, { children: _jsx(App, {}) })) }), _jsx(Route, { path: "/", element: _jsx(Navigate, { to: isAuthenticated() ? '/dashboard' : '/login', replace: true }) })] }) }) }));
