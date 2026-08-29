/**
 * Tests the request/response conversion boundary (core/api/converters.ts),
 * focused on `dormant` provenance: `requestToDomain` must preserve the
 * wire `InventoryItem.dormant` flag 1:1 per copy (no merging across
 * identical identities), and `domainToResponse` must report copies that
 * were dormant on input but ended up assigned to a socket this run as
 * `activated_dormant_gems`, without disturbing the existing `dormant_gems`
 * no-op/newly-dormant split.
 */

import { describe, expect, it } from 'vitest';
import { COST_TABLES } from '../../../src/core/data';
import { runPipeline } from '../../../src/core/pipeline';
import { computeContribution, numSocketsUnlocked } from '../../../src/core/rules';
import { computeUpgradeDelta } from '../../../src/core/upgrades';
import { requestToDomain, domainToResponse } from '../../../src/core/api/converters';
import type { OptimizeRequest } from '../../../src/core/api/types';
import type { MainGem, UpgradeOptimizationResult } from '../../../src/core/models';

describe('requestToDomain', () => {
  it('preserves the dormant flag per inventory item without merging identical identities', () => {
    const request: OptimizeRequest = {
      gem_power: 0,
      gem_setup: {},
      inventory: [
        { gem_id: 5001, rank: '1', active_stars: 2, dormant: true },
        { gem_id: 5001, rank: '1', active_stars: 2 },
        { gem_id: 5001, rank: '1', active_stars: 2, dormant: false },
      ],
    };

    const { inventory } = requestToDomain(request);

    expect(inventory).toHaveLength(3);
    expect(inventory[0].dormant).toBe(true);
    expect(inventory[1].dormant).toBe(false);
    expect(inventory[2].dormant).toBe(false);
  });
});

describe('domainToResponse: activated_dormant_gems', () => {
  it('reports only assigned copies that were dormant on input, grouped by identity', () => {
    // Rank "6" unlocks 1 five-star socket (index 3); a single rank-"6"
    // copy of the same gem exactly fills it.
    const mainGem: MainGem = {
      slotName: 'head',
      gemId: 5001,
      starRating: 5,
      targetRank: '6',
      requiredPower: COST_TABLES.get(5)!.get('6')!.requiredGemPower,
      numSockets: numSocketsUnlocked('6', 5),
      activeStars: 2,
    };
    const contribution = computeContribution(5, '6', COST_TABLES.get(5)!);

    const request: OptimizeRequest = {
      gem_power: 10_000,
      gem_setup: { head: { gem_id: 5001, target_rank: '6', active_stars: 2 } },
      inventory: [
        // Assigned + dormant on input -> should be reported as activated.
        // Its rank exactly matches the socket's requirement, so the greedy
        // closest-fit pass prefers it over the much-lower-rank second copy.
        { gem_id: 5001, rank: '6', active_stars: 2, dormant: true },
        // Unassigned + dormant on input (poor closest-fit match) -> stays a
        // dormant no-op, not activated.
        { gem_id: 5002, rank: '1', active_stars: 2, dormant: true },
      ],
    };

    const { availablePower, mainGems, skippedSlots, inventory } = requestToDomain(request);
    expect(mainGems).toEqual([mainGem]);

    const result = runPipeline(availablePower, mainGems, skippedSlots, inventory);
    const response = domainToResponse(result, null, inventory);

    // Sanity: the dormant-input copy actually got socketed (index 3 is the
    // single five-star socket unlocked at rank "6"; indices 0-2 are
    // two-star sockets fillEmptySockets may or may not fill from a
    // separate, unrelated candidate pool).
    expect(response.gem_results.head?.sockets[3].assigned_gem_id).toBe(5001);
    expect(response.gem_results.head?.sockets[3].contribution).toBe(contribution);

    // gem_power_cost mirrors gem_power_gained's formula (requiredGemPower
    // for the rank) -- the same amount would be recovered if this copy
    // were made dormant again.
    expect(response.activated_dormant_gems).toEqual([
      { gem_id: 5001, star_rating: 5, rank: '6', active_stars: 2, quantity: 1, gem_power_cost: 850 },
    ]);

    // The unassigned dormant gem 5002 stays out of activated_dormant_gems
    // and is still reported as a dormant no-op via already_dormant_quantity
    // when the caller passes alreadyDormantCounter's output.
    expect(response.dormant_gems.find((d) => d.gem_id === 5002)).toBeUndefined();
  });

  it('reports the pre-upgrade rank and cost for a dormant copy that was also upgraded this run', () => {
    // Simulates a dormant rank-"2" copy that the upgrade search advanced to
    // rank "4" before socketing it -- the inventory passed to
    // domainToResponse already reflects the post-upgrade rank.
    const request: OptimizeRequest = {
      gem_power: 10_000,
      gem_setup: { head: { gem_id: 5001, target_rank: '6', active_stars: 2 } },
      inventory: [{ gem_id: 5001, rank: '4', active_stars: 2, dormant: true }],
    };

    const { availablePower, mainGems, skippedSlots, inventory } = requestToDomain(request);
    const result = runPipeline(availablePower, mainGems, skippedSlots, inventory);

    const upgradeDelta = computeUpgradeDelta(5, '2', '4', 0, 5001);
    const upgradeResult: UpgradeOptimizationResult = {
      baseline: result,
      upgraded: result,
      upgradesApplied: [upgradeDelta],
      totalUpgradeCost: upgradeDelta.additionalGemPower,
      effectiveResidual: result.totalResidualCost + upgradeDelta.additionalGemPower,
      improvement: 0,
    };

    const response = domainToResponse(result, upgradeResult, inventory);

    expect(response.gem_results.head?.sockets[3].assigned_gem_rank).toBe('4');
    // Reported at rank "2" (its rank when it was dormant, requiredGemPower
    // 50), not rank "4" (the rank the upgrade search advanced it to before
    // socketing it, requiredGemPower 225).
    expect(response.activated_dormant_gems).toEqual([
      { gem_id: 5001, star_rating: 5, rank: '2', active_stars: 2, quantity: 1, gem_power_cost: 50 },
    ]);
  });
});
