import './CostBadge.css';

function formatUSD(n) {
  if (!n || n <= 0) return '$0.00';
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

export default function CostBadge({ total = 0, estimated = false, label = 'Cost' }) {
  const formatted = formatUSD(total);
  return (
    <span
      className={`cost-badge${estimated ? ' cost-badge--estimated' : ''}`}
      title={estimated ? 'Estimated cost' : 'Actual cost (OpenRouter)'}
    >
      <span className="cost-badge-label">{label}</span>
      <span className="cost-badge-value">
        {estimated ? '~' : ''}{formatted}
      </span>
    </span>
  );
}
