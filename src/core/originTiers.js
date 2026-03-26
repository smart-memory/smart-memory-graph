/**
 * Lightweight JS tier lookup for origin provenance display.
 * Derives tiers from origin-contract.json — does NOT duplicate the full
 * Python origin_policy.py, just enough for UI labels.
 */
import originContract from '../../contracts/origin-contract.json';

const tierCache = new Map();

// Conceptual group → tier for OriginLegend (these groups don't exist as
// concrete origins in the contract, so exact/prefix lookup would miss them).
const GROUP_TIERS = {
  user: 1,
  conversation: 3,
  code: 1,
  evolver: 2,
  enricher: 3,
  hook: 4,
  import: 1,
  unknown: 4,
};

export function getOriginTier(origin) {
  if (!origin) return 4;
  if (tierCache.has(origin)) return tierCache.get(origin);

  // 1. Exact match in contract
  if (originContract.origins[origin]) {
    const tier = originContract.origins[origin].tier;
    tierCache.set(origin, tier);
    return tier;
  }

  // 2. Prefix match against concrete origins
  for (const [fullOrigin, info] of Object.entries(originContract.origins)) {
    if (origin.startsWith(fullOrigin + ':') || fullOrigin.startsWith(origin + ':')) {
      tierCache.set(origin, info.tier);
      return info.tier;
    }
  }

  // 3. Conceptual group match (for legend labels)
  if (GROUP_TIERS[origin] !== undefined) {
    tierCache.set(origin, GROUP_TIERS[origin]);
    return GROUP_TIERS[origin];
  }

  tierCache.set(origin, 4);
  return 4;
}

export function getTierLabel(tier) {
  return originContract.tiers[String(tier)]?.label ?? 'Unknown';
}
