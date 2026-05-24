import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export interface BarDatum {
  label: string;
  value: number;
  suffix?: string;
}

export function MiniBarChart({ data, height = 180, color = ['#1c7c54', '#d95d39'] }: { data: BarDatum[]; height?: number; color?: string[] }) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(value: any, name: any, props: any) => {
          // Try to find the correct index for the suffix
          let idx = 0;
          if (props && props.payload && Array.isArray(props.payload)) {
            idx = props.payload.findIndex((d: any) => d.label === name);
          }
          const suffix = data[idx]?.suffix ?? '';
          return [`${value}${suffix}`, name];
        }} />
        <Bar dataKey="value">
          {data.map((entry, idx) => (
            <Cell key={`cell-${entry.label}-${idx}`} fill={color[idx % color.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
