/**
 * Unit coverage for `searchUpgradeDepths` against synthetic scoring
 * functions. See `api/runOptimization.test.ts` for the search wired to the
 * real pipeline.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_UPGRADE_SEARCH_OPTIONS, type DepthScore, searchUpgradeDepths } from '../../src/core/upgradeSearch';

function score(netResidual: number, upgradeCost = 0, fiveStarUpgradeCost = 0): DepthScore {
  return { netResidual, fiveStarUpgradeCost, upgradeCost };
}

/** A score whose net residual grows with each depth's distance from its target. */
function distanceFrom(targets: readonly number[]) {
  return (depths: readonly number[]) => score(depths.reduce((sum, depth, index) => sum + Math.abs(depth - targets[index]), 0));
}

describe('searchUpgradeDepths', () => {
  it('finds the best depth of each chain', () => {
    const { depths } = searchUpgradeDepths([5, 8, 3], distanceFrom([3, 0, 2]));

    expect(depths).toEqual([3, 0, 2]);
  });

  it('keeps every depth at 0 when no upgrade improves the score', () => {
    const { depths, score: best } = searchUpgradeDepths([4, 4], (candidate) => score(candidate[0] + candidate[1] === 0 ? 0 : 10));

    expect(depths).toEqual([0, 0]);
    expect(best.netResidual).toBe(0);
  });

  // In the two tie-break cases below, the first chain is swept first and
  // its upgrade is dropped (uncharged) once the second chain's upgrade
  // takes its socket, leaving the net residual unchanged.

  it('prefers two-star upgrades over five-star upgrades when the net residual is equal', () => {
    // Chain 0 is a five-star chain, chain 1 a two-star chain.
    const evaluate = ([fiveStar, twoStar]: readonly number[]) => {
      if (twoStar > 0) return score(5, 15, 0);
      if (fiveStar > 0) return score(5, 60, 60);
      return score(10);
    };

    const { score: best } = searchUpgradeDepths([1, 1], evaluate);

    expect(best).toEqual(score(5, 15, 0));
  });

  it('prefers the cheaper upgrade when the net residual is equal', () => {
    const evaluate = ([first, second]: readonly number[]) => {
      if (second > 0) return score(5, 15);
      if (first > 0) return score(5, 30);
      return score(10);
    };

    const { score: best } = searchUpgradeDepths([1, 1], evaluate);

    expect(best).toEqual(score(5, 15));
  });

  it('returns the same result for the same input', () => {
    // An irregular landscape, so the restarts' random perturbations matter.
    const evaluate = (depths: readonly number[]) =>
      score(depths.reduce((sum, depth, index) => sum + ((depth * 7919 + index * 104729) % 13) - depth, 0));

    const first = searchUpgradeDepths([9, 9, 9, 9], evaluate);
    const second = searchUpgradeDepths([9, 9, 9, 9], evaluate);

    expect(second).toEqual(first);
  });

  it('stops evaluating once the evaluation limit is reached', () => {
    let evaluations = 0;
    const evaluate = (depths: readonly number[]) => {
      evaluations++;
      return distanceFrom([5, 5, 5])(depths);
    };

    searchUpgradeDepths([10, 10, 10], evaluate, { ...DEFAULT_UPGRADE_SEARCH_OPTIONS, maxEvaluations: 5 });

    expect(evaluations).toBe(5);
  });

  it('evaluates only the starting point when no chain has an upgrade step', () => {
    let evaluations = 0;
    let restarts = 0;
    const evaluate = () => {
      evaluations++;
      return score(0);
    };

    searchUpgradeDepths([0, 0], evaluate, { ...DEFAULT_UPGRADE_SEARCH_OPTIONS, onRestart: () => restarts++ });

    expect(evaluations).toBe(1);
    expect(restarts).toBe(0);
  });

  it('reports every restart', () => {
    const reported: [number, number][] = [];

    searchUpgradeDepths([3, 3], distanceFrom([1, 2]), {
      ...DEFAULT_UPGRADE_SEARCH_OPTIONS,
      restarts: 3,
      onRestart: (index, total) => reported.push([index, total]),
    });

    expect(reported).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});
