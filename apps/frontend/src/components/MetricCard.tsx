
type MetricCardProps = {
  title: string;
  titleProps?: React.HTMLAttributes<HTMLHeadingElement>;
  children: React.ReactNode;
};

export const MetricCard = ({ title, titleProps, children }: MetricCardProps) => {
  return (
    <section className="metric-card">
      <h3 {...titleProps}>{title}</h3>
      <div>{children}</div>
    </section>
  );
};
