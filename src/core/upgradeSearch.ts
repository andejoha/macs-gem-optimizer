/**
 * Searches for the upgrade depth combination (one depth per upgrade chain)
 * that leaves the player the most gem power. Independent of the pipeline:
 * the caller supplies an `evaluate` function that scores a depth vector.
 *
 * The search runs cyclic coordinate descent from "no upgrades" (every
 * depth 0), then a fixed number of seeded restarts that perturb the best
 * combination found so far and descend again. The result is deterministic
 * for a given input and options. See docs/SPEC.md ("4. Upgrading gems").
 */

import { makeSeededRandom } from './util/random';
import { compareTuples } from './util/tupleCompare';

/** How good one depth combination is; lower is better on every field. */
export interface DepthScore {
  /** Effective residual minus recoverable dormant power. */
  netResidual: number;
  /** Gem power charged for kept five-star upgrades. */
  fiveStarUpgradeCost: number;
  /** Gem power charged for all kept upgrades. */
  upgradeCost: number;
}

export interface UpgradeSearchOptions {
  /** Number of perturb-and-descend rounds after the first descent. */
  restarts: number;
  /** Probability that a restart redraws each chain's depth at random. */
  perturbationRate: number;
  /** Seed for the restarts' random perturbations. */
  seed: number;
  /** Upper bound on distinct depth combinations evaluated. */
  maxEvaluations: number;
  /** Called before each restart, with a one-based index. */
  onRestart?: (index: number, total: number) => void;
}

/** The options `runOptimization` searches with. */
export const DEFAULT_UPGRADE_SEARCH_OPTIONS: UpgradeSearchOptions = {
  restarts: 12,
  perturbationRate: 0.15,
  seed: 1,
  maxEvaluations: 10_000,
};

/**
 * Orders scores by net residual, then by five-star upgrade cost (two-star
 * material is preferred when the surplus is equal), then by total upgrade
 * cost.
 */
function isBetter(candidate: DepthScore, current: DepthScore): boolean {
  return (
    compareTuples(
      [candidate.netResidual, candidate.fiveStarUpgradeCost, candidate.upgradeCost],
      [current.netResidual, current.fiveStarUpgradeCost, current.upgradeCost],
    ) < 0
  );
}

/**
 * Returns the best depth combination found, where `maxDepths[i]` is the
 * deepest depth chain `i` supports. Never returns a combination scored
 * worse than every depth at 0.
 */
export function searchUpgradeDepths<T extends DepthScore>(
  maxDepths: readonly number[],
  evaluate: (depths: readonly number[]) => T,
  options: UpgradeSearchOptions = DEFAULT_UPGRADE_SEARCH_OPTIONS,
): { depths: number[]; score: T } {
  const cache = new Map<string, T>();
  const budgetExhausted = () => cache.size >= options.maxEvaluations;

  function score(depths: readonly number[]): T {
    const key = depths.join(',');
    let cached = cache.get(key);
    if (cached === undefined) {
      cached = evaluate(depths);
      cache.set(key, cached);
    }
    return cached;
  }

  /** Sets each chain in turn to its best depth until a full sweep changes nothing. */
  function descend(start: readonly number[]): { depths: number[]; score: T } {
    const depths = [...start];
    let current = score(depths);
    let changed = true;
    while (changed && !budgetExhausted()) {
      changed = false;
      for (let chainIndex = 0; chainIndex < depths.length; chainIndex++) {
        const originalDepth = depths[chainIndex];
        let bestDepth = originalDepth;
        for (let depth = 0; depth <= maxDepths[chainIndex] && !budgetExhausted(); depth++) {
          if (depth === originalDepth) continue;
          depths[chainIndex] = depth;
          const candidate = score(depths);
          if (isBetter(candidate, current)) {
            current = candidate;
            bestDepth = depth;
          }
        }
        depths[chainIndex] = bestDepth;
        if (bestDepth !== originalDepth) changed = true;
      }
    }
    return { depths, score: current };
  }

  let best = descend(maxDepths.map(() => 0));
  if (!maxDepths.some((maxDepth) => maxDepth > 0)) return best;

  const random = makeSeededRandom(options.seed);
  for (let restart = 1; restart <= options.restarts && !budgetExhausted(); restart++) {
    options.onRestart?.(restart, options.restarts);
    const start = best.depths.map((depth, chainIndex) =>
      random() < options.perturbationRate ? Math.floor(random() * (maxDepths[chainIndex] + 1)) : depth,
    );
    const candidate = descend(start);
    if (isBetter(candidate.score, best.score)) best = candidate;
  }
  return best;
}
