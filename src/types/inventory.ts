import type { StarRating, InventoryItem, RemainingInventoryItem } from './api';
import { canBeDormant } from '../utils/rankUtils';

export interface InventoryGemStack {
  id: string;
  gem_id: number;
  star_rating: StarRating;
  rank: string;
  active_stars: number;
  quantity: number;
  dormant?: boolean;
}

export function inventoryStackKey(item: Pick<InventoryGemStack, 'gem_id' | 'rank' | 'active_stars' | 'dormant'>): string {
  return `${item.gem_id}|${item.rank}|${item.active_stars}|${item.dormant ? 1 : 0}`;
}

/**
 * Expands stacks above rank 1 into one quantity-1 stack per copy, so each
 * copy -- dormant or not -- can be reactivated/edited individually instead
 * of being locked behind a shared quantity. Rank-1 stacks always stay
 * merged: they can't be made dormant at all (see `canBeDormant`), so there's
 * nothing to split them for. Split ids are the source stack's id plus an
 * index (see `sourceStackId`), so a click on a split tile can be mapped
 * back to the stack it came from.
 */
export function splitStacksAboveRankOne(stacks: InventoryGemStack[]): InventoryGemStack[] {
  return stacks.flatMap((stack) => {
    if (!canBeDormant(stack.rank) || stack.quantity <= 1) return [stack];
    return Array.from({ length: stack.quantity }, (_, i) => ({ ...stack, id: `${stack.id}::${i}`, quantity: 1 }));
  });
}

/** Given a stack id, possibly one produced by `splitStacksAboveRankOne`, returns the id of its source stack. */
export function sourceStackId(id: string): string {
  const separatorIndex = id.indexOf('::');
  return separatorIndex === -1 ? id : id.slice(0, separatorIndex);
}

export function stacksToInventoryItems(stacks: InventoryGemStack[]): InventoryItem[] {
  return stacks
    .filter((stack) => !stack.dormant)
    .flatMap((stack) =>
      Array.from({ length: stack.quantity }, () => ({
        gem_id: stack.gem_id,
        rank: stack.rank,
        active_stars: stack.active_stars,
      })),
    );
}

/** Convert all stacks — including dormant ones — to active inventory items.
 *  Used for the upgrade walk, where dormant gems are re-activated and their
 *  GP cost is subtracted from the pool before sending the request. */
export function allStacksToInventoryItems(stacks: InventoryGemStack[]): InventoryItem[] {
  return stacks.flatMap((stack) =>
    Array.from({ length: stack.quantity }, () => ({
      gem_id: stack.gem_id,
      rank: stack.rank,
      active_stars: stack.active_stars,
      dormant: !!stack.dormant,
    })),
  );
}

export function remainingItemsToStacks(items: RemainingInventoryItem[]): InventoryGemStack[] {
  const map = new Map<string, InventoryGemStack>();
  for (const item of items) {
    const key = inventoryStackKey(item);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      map.set(key, {
        id: key,
        gem_id: item.gem_id,
        star_rating: item.star_rating as StarRating,
        rank: item.rank,
        active_stars: item.active_stars,
        quantity: 1,
      });
    }
  }
  return Array.from(map.values());
}
