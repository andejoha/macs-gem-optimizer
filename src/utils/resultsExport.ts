import type { GemSetup, OptimizeResponse } from '../types/api';
import { inventoryStackKey, remainingItemsToStacks } from '../types/inventory';
import type { InventoryGemStack } from '../types/inventory';
import { SLOT_ORDER } from './gearAssets';
import type { CodecState } from './setupCodec';

/** Converts an optimization result into a setup that can be exported and imported again. */
export function buildResultCodecState(response: OptimizeResponse): CodecState {
  const { summary, gem_results, remaining_inventory, dormant_gems } = response;

  // Build gem setup from results
  const gemSetup: GemSetup = {};
  for (const slot of SLOT_ORDER) {
    const result = gem_results[slot];
    if (!result) continue;
    gemSetup[slot] = {
      gem_id: result.gem_id,
      target_rank: result.target_rank,
      active_stars: result.active_stars,
    };
  }

  // Build a set of dormant keys so we can mark remaining stacks as dormant.
  // Key: "gem_id|rank|active_stars" (without dormant flag) — matches the
  // identity used by DormantGemItem.
  const dormantKeySet = new Set((dormant_gems ?? []).map((d) => `${d.gem_id}|${d.rank}|${d.active_stars}`));

  // Merge remaining inventory and socketed gems into stacks.
  // Dormant gems are marked so the codec round-trips their GP contribution.
  const stackMap = new Map<string, InventoryGemStack>();
  for (const stack of remainingItemsToStacks(remaining_inventory)) {
    const isDormant = dormantKeySet.has(`${stack.gem_id}|${stack.rank}|${stack.active_stars}`);
    const dormantStack = isDormant ? { ...stack, dormant: true } : stack;
    stackMap.set(inventoryStackKey(dormantStack), dormantStack);
  }
  for (const slot of SLOT_ORDER) {
    const result = gem_results[slot];
    if (!result) continue;
    for (const socket of result.sockets) {
      if (
        socket.status !== 'assigned' ||
        socket.assigned_gem_id == null ||
        socket.assigned_gem_star_rating == null ||
        socket.assigned_gem_rank == null
      )
        continue;

      const activeStars = socket.assigned_gem_active_stars ?? socket.assigned_gem_star_rating;
      const key = inventoryStackKey({
        gem_id: socket.assigned_gem_id,
        rank: socket.assigned_gem_rank,
        active_stars: activeStars,
        locked: socket.assigned_gem_locked,
      });
      const existing = stackMap.get(key);
      if (existing) {
        existing.quantity += 1;
      } else {
        stackMap.set(key, {
          id: key,
          gem_id: socket.assigned_gem_id,
          star_rating: socket.assigned_gem_star_rating as 1 | 2 | 5,
          rank: socket.assigned_gem_rank,
          active_stars: activeStars,
          quantity: 1,
          locked: socket.assigned_gem_locked,
        });
      }
    }
  }

  const upgradeCost = response.upgrades?.total_upgrade_cost ?? 0;
  // Dormant GP is already folded into summary.surplus_or_shortfall; add it back
  // to available_power so the exported pool matches what the input side expects
  // (dormant stacks are excluded from the optimize request but their GP is part
  // of the gem power input field).
  const gemPower = Math.max(0, summary.available_power - upgradeCost + (summary.dormant_gem_power ?? 0));

  return { gemSetup, gemPower, stacks: Array.from(stackMap.values()) };
}
