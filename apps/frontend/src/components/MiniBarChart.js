import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
export function MiniBarChart({ data, height = 180, color = ['#1c7c54', '#d95d39'] }) {
    if (!data.length)
        return null;
    return (_jsx(ResponsiveContainer, { width: "100%", height: height, children: _jsxs(BarChart, { data: data, layout: "vertical", margin: { top: 8, right: 24, left: 8, bottom: 8 }, children: [_jsx(XAxis, { type: "number", hide: true, domain: [0, 'dataMax'] }), _jsx(YAxis, { type: "category", dataKey: "label", width: 120, tick: { fontSize: 12 } }), _jsx(Tooltip, { formatter: (value, name, props) => {
                        // Try to find the correct index for the suffix
                        let idx = 0;
                        if (props && props.payload && Array.isArray(props.payload)) {
                            idx = props.payload.findIndex((d) => d.label === name);
                        }
                        const suffix = data[idx]?.suffix ?? '';
                        return [`${value}${suffix}`, name];
                    } }), _jsx(Bar, { dataKey: "value", children: data.map((entry, idx) => (_jsx(Cell, { fill: color[idx % color.length] }, `cell-${entry.label}-${idx}`))) })] }) }));
}
