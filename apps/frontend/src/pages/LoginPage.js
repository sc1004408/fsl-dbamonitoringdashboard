import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
const LoginPage = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const navigate = useNavigate();
    const handleLogin = async (e) => {
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
        }
        catch {
            setErrorMessage('Unable to reach authentication service.');
        }
        finally {
            setIsSubmitting(false);
        }
    };
    const handleResetCredentials = () => {
        setUsername('');
        setPassword('');
        setErrorMessage('');
    };
    return (_jsx("main", { className: "login-shell", children: _jsxs("section", { className: "login-panel", children: [_jsx("p", { className: "login-tag", children: "SQL Server Operations Portal" }), _jsx("h1", { children: "DBA Console Sign-In" }), _jsx("p", { className: "login-subtitle", children: "Authenticate with your DBA account to access monitoring dashboards and administrative tools." }), _jsxs("form", { className: "login-form", onSubmit: handleLogin, children: [_jsx("label", { htmlFor: "username", children: "DBA Username" }), _jsx("input", { id: "username", type: "text", value: username, onChange: (e) => setUsername(e.target.value), autoComplete: "username", required: true }), _jsx("label", { htmlFor: "password", children: "Password" }), _jsx("input", { id: "password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), autoComplete: "current-password", required: true }), errorMessage && _jsx("p", { className: "login-error", children: errorMessage }), _jsxs("div", { className: "login-actions", children: [_jsx("button", { type: "submit", disabled: isSubmitting, children: isSubmitting ? 'Signing In...' : 'Sign In' }), _jsx("button", { type: "button", className: "login-reset-btn", onClick: handleResetCredentials, disabled: isSubmitting, children: "Reset" })] })] })] }) }));
};
export default LoginPage;
