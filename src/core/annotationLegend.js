import { ANNOTATION_COLORS } from './graphColors';
import annotationContract from '../../contracts/graph-annotations.json';

/**
 * Build legend items from graph data + annotations.
 * Returns flat LegendItem[] — grouping by kind is caller responsibility.
 *
 * @param {object} graphData - { nodes, edges }
 * @param {object} annotations - GraphAnnotations
 * @param {object} [config] - { showEmpty?, kinds?, visibleIds?: Set<string> }
 * @returns {Array<{kind, key, label, color, count, styleToken}>}
 */
export function buildAnnotationLegend(graphData, annotations, config = {}) {
  if (!annotations?.activeKinds?.length) return [];

  const { showEmpty = false, kinds: filterKinds, visibleIds } = config;
  const activeKinds = filterKinds || annotations.activeKinds;
  const items = [];

  // Count annotations per (kind, value)
  const counts = {};

  const countAnnotations = (annoMap) => {
    for (const [id, annoList] of Object.entries(annoMap || {})) {
      if (visibleIds && !visibleIds.has(id)) continue;
      for (const anno of annoList) {
        if (!activeKinds.includes(anno.kind)) continue;
        const key = `${anno.kind}::${anno.value}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
  };

  countAnnotations(annotations.nodes);
  countAnnotations(annotations.edges);

  for (const kind of activeKinds) {
    const kindDef = annotationContract.annotationKinds[kind];
    if (!kindDef) continue;

    for (const value of kindDef.values) {
      const count = counts[`${kind}::${value}`] || 0;
      if (!showEmpty && count === 0) continue;

      const colorEntry = ANNOTATION_COLORS[kind]?.[value];
      const color = typeof colorEntry === 'string' ? colorEntry : colorEntry?.color || '#6b7280';

      items.push({
        kind,
        key: value,
        label: kindDef.labels?.[value] || value,
        color,
        count,
        styleToken: `anno-fill-${kind}-${value}`,
      });
    }
  }

  return items;
}
