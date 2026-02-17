import { useMemo } from 'react';
import { buildAnnotationLegend } from '../core/annotationLegend';

/**
 * Annotation legend component. Groups items by kind with color swatches and counts.
 *
 * @param {{ graphData: object, annotations: object, config?: object, className?: string }} props
 */
export default function AnnotationLegend({ graphData, annotations, config, className = '' }) {
  const items = useMemo(
    () => buildAnnotationLegend(graphData, annotations, config),
    [graphData, annotations, config]
  );

  if (items.length === 0) return null;

  // Group by kind for display
  const groups = {};
  for (const item of items) {
    if (!groups[item.kind]) groups[item.kind] = [];
    groups[item.kind].push(item);
  }

  return (
    <div className={`annotation-legend ${className}`}>
      {Object.entries(groups).map(([kind, groupItems]) => (
        <div key={kind} className="annotation-legend-group">
          <div className="annotation-legend-header">{kind.replace(/_/g, ' ')}</div>
          {groupItems.map((item) => (
            <div key={item.key} className="annotation-legend-item">
              <span
                className="annotation-legend-swatch"
                style={{ backgroundColor: item.color }}
              />
              <span className="annotation-legend-label">{item.label}</span>
              <span className="annotation-legend-count">{item.count}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
