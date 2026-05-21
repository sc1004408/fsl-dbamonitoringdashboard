import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const MetricCard = ({ title, titleProps, children }) => {
    return (_jsxs("section", { className: "metric-card", children: [_jsx("h3", { ...titleProps, children: title }), _jsx("div", { children: children })] }));
};
