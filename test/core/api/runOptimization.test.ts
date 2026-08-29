/**
 * End-to-end coverage for `runOptimization`'s `activated_dormant_gems`
 * reporting: gems the player marked dormant on input that the optimizer
 * assigned to a socket this run. See `converters.test.ts` for
 * `domainToResponse`-level coverage of the tally itself, and
 * `upgrades.test.ts` for the one InventoryGem-reconstruction site
 * (`buildUpgradeChains`'s target-advance step) that must carry `dormant`
 * forward explicitly.
 */

import { describe, expect, it } from 'vitest';
import { runOptimization } from '../../../src/core/api/runOptimization';
import type { OptimizeRequest } from '../../../src/core/api/types';

describe('runOptimization: activated_dormant_gems', () => {
  it('reports a dormant-marked copy assigned to a socket by the greedy pass (no upgrades)', () => {
    const request: OptimizeRequest = {
      gem_power: 10_000,
      gem_setup: { head: { gem_id: 5001, target_rank: '6', active_stars: 2 } },
      inventory: [{ gem_id: 5001, rank: '6', active_stars: 2, dormant: true }],
    };

    const response = runOptimization(request, false, false, 'off');

    expect(response.gem_results.head?.sockets[3].assigned_gem_id).toBe(5001);
    expect(response.activated_dormant_gems).toEqual([
      { gem_id: 5001, star_rating: 5, rank: '6', active_stars: 2, quantity: 1, gem_power_cost: 850 },
    ]);
  });

  it('keeps dormant provenance across the upgrade depth walk', () => {
    // Only 4 spare rank-"1" copies of the main gem's own type exist, all
    // dormant on input; buildUpgradeChains picks the highest-contribution
    // copy as the chain target and (at whatever depth the search settles
    // on) it remains the sole candidate for the socket, so it gets
    // assigned regardless of the exact depth chosen.
    const request: OptimizeRequest = {
      gem_power: 5_000,
      gem_setup: { head: { gem_id: 5001, target_rank: '6', active_stars: 2 } },
      inventory: Array.from({ length: 4 }, () => ({ gem_id: 5001, rank: '1', active_stars: 2, dormant: true })),
    };

    const response = runOptimization(request, true, false, 'off');

    expect(response.gem_results.head?.sockets[3].assigned_gem_id).toBe(5001);
    const activated = response.activated_dormant_gems.find((g) => g.gem_id === 5001);
    expect(activated?.quantity).toBe(1);
  });
});
