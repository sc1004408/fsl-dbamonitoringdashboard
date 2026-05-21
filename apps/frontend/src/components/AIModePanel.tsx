type AIModePanelProps = {
  enabled: boolean;
  onToggle: () => void;
  content: string;
  loading: boolean;
};

export const AIModePanel = ({ enabled, onToggle, content, loading }: AIModePanelProps) => {
  return (
    <section className="ai-panel">
      <div className="ai-title-row">
        <h2>AI Mode</h2>
        <button onClick={onToggle} className={enabled ? 'btn-on' : 'btn-off'}>
          {enabled ? 'Enabled' : 'Enable AI'}
        </button>
      </div>
      <pre>{loading ? 'Generating insights...' : content}</pre>
    </section>
  );
};
