import graphColors from '@contracts/graph-colors.json';

export const MEMORY_COLORS = {
  memory: graphColors.special.memory,
  ...graphColors.memoryTypes,
};

export const ENTITY_COLORS = { ...graphColors.entityTypes };

export const SPECIAL_COLORS = {
  grounding: graphColors.special.grounding,
  default: graphColors.special.default,
};

export const NODE_SIZES = { memory: 14, entity: 8, grounding: 8 };

export function getNodeColor(type, category) {
  if (category === 'memory' || MEMORY_COLORS[type]) return MEMORY_COLORS[type] || MEMORY_COLORS.memory;
  if (ENTITY_COLORS[type]) return ENTITY_COLORS[type];
  if (SPECIAL_COLORS[type]) return SPECIAL_COLORS[type];
  return SPECIAL_COLORS.default;
}

export function getNodeSize(category) {
  return NODE_SIZES[category] || NODE_SIZES.entity;
}

export const ALL_MEMORY_TYPES = Object.keys(MEMORY_COLORS);
export const ALL_ENTITY_TYPES = Object.keys(ENTITY_COLORS);

// Set of actual memory types (excludes 'memory' which is just a fallback color key)
export const MEMORY_TYPE_SET = new Set(ALL_MEMORY_TYPES.filter((t) => t !== 'memory'));
