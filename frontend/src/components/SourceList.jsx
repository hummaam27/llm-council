import './SourceList.css';

/**
 * Renders a list of web search citations returned by OpenRouter's web plugin.
 *
 * Each annotation has shape:
 *   { type: "url_citation", url_citation: { url, title, content, start_index, end_index } }
 *
 * Renders nothing when there are no citations.
 */
export default function SourceList({ annotations }) {
  if (!annotations || !Array.isArray(annotations) || annotations.length === 0) {
    return null;
  }

  // Filter, dedupe by URL, keep first occurrence
  const seen = new Set();
  const citations = [];
  for (const a of annotations) {
    const c = a?.url_citation;
    if (!c?.url) continue;
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    citations.push(c);
  }

  if (citations.length === 0) return null;

  return (
    <div className="source-list">
      <div className="source-list-header">
        <span className="source-list-icon">🌐</span>
        <span>Sources ({citations.length})</span>
      </div>
      <ol className="source-list-items">
        {citations.map((c, i) => (
          <li key={i}>
            <a href={c.url} target="_blank" rel="noopener noreferrer" title={c.url}>
              {c.title || c.url}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
