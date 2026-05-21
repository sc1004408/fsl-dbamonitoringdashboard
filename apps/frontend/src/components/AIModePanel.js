import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const AIModePanel = ({ enabled, onToggle, content, loading }) => {
    return (_jsxs("section", { className: "ai-panel", children: [_jsxs("div", { className: "ai-title-row", children: [_jsx("h2", { children: "AI Mode" }), _jsx("button", { onClick: onToggle, className: enabled ? 'btn-on' : 'btn-off', children: enabled ? 'Enabled' : 'Enable AI' })] }), _jsx("pre", { children: loading ? 'Generating insights...' : content })] }));
};
