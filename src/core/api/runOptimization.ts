/**
 * Core orchestration for running the optimizer end to end: parses the
 * request, runs the baseline pipeline, and -- when upgrades are enabled --
 * searches for the upgrade depth combination that leaves the most gem power
 * (see `upgradeSearch.ts`) before producing the final response. When bonus mode 'budget' is selected, a post-pipeline
 * swap pass (see `bonusBudget.ts`) then spends any remaining surplus
 * activating bonuses, and the upgrade bookkeeping and display inventory are
 * re-derived from its result. See docs/SPEC.md ("Bonus activation modes").
 */

import { bagsFromAssignments, budgetActivateBonuses, type BudgetEvaluation, type BudgetEvaluator } from '../bonusBudget';
import type { BonusMode, InventoryGem, MainGem, SocketAssignment, UpgradeDelta, UpgradeOptimizationResult } from '../models';
import { type CopyEntry, expandInventory } from '../optimizer';
import { materializeResult, runPipeline } from '../pipeline';
import { nullReporter, type ProgressReporter } from '../progress';
import { sumDormantPower } from '../rules';
import { DEFAULT_UPGRADE_SEARCH_OPTIONS, type DepthScore, searchUpgradeDepths } from '../upgradeSearch';
import { buildUpgradeChains, computeSocketCounts, filterUpgradesToSocketed, materializeUpgrades } from '../upgrades';
import { alreadyDormantCounter, domainToResponse, requestToDomain } from './converters';
import type { ConvertedGemItem, OptimizeRequest, OptimizeResponse, RemainingInventoryItem } from './types';
import { ValidationError } from './validate';

/**
 * Reconciles pre-extracted rank-1 1-star gems with the optimization
 * result. Before optimization, rank-1 1-star gems were removed from the
 * inventory and their count added to the available power pool; this
 * determines how many were actually needed, reports them as converted,
 * and returns the rest to the remaining inventory.
 */
function finalizeRankOneConversion(
  response: OptimizeResponse,
  originalAvailablePower: number,
  rankOneGems: readonly InventoryGem[],
): OptimizeResponse {
  if (rankOneGems.length === 0) return response;

  const totalResidual = response.summary.total_residual_cost;
  const dormantPower = response.summary.dormant_gem_power;
  const gemsUsed = Math.min(rankOneGems.length, Math.max(0, totalResidual - originalAvailablePower - dormantPower));

  const unused = rankOneGems.slice(gemsUsed);
  const restored: RemainingInventoryItem[] = unused.map((gem) => ({
    gem_id: gem.gemId,
    star_rating: gem.starRating,
    rank: gem.rank,
    active_stars: gem.activeStars,
    contribution: gem.contribution,
  }));

  const newAvailable = originalAvailablePower + gemsUsed;
  const newSurplus = newAvailable + dormantPower - totalResidual;

  const patchedSummary = {
    ...response.summary,
    available_power: newAvailable,
    status: (newSurplus >= 0 ? 'feasible' : 'shortfall') as 'feasible' | 'shortfall',
    surplus_or_shortfall: newSurplus,
  };

  // The upgrades block's baseline summary was computed with the same
  // rank-1-inflated available power and needs the same reconciliation, so
  // the "without upgrades" surplus isn't overstated.
  let patchedUpgrades = response.upgrades;
  if (response.upgrades !== null) {
    const baselineResidual = response.upgrades.baseline_summary.total_residual_cost;
    const baselineDormantPower = response.upgrades.baseline_summary.dormant_gem_power;
    const baselineGemsUsed = Math.min(rankOneGems.length, Math.max(0, baselineResidual - originalAvailablePower - baselineDormantPower));
    const baselineNewAvailable = originalAvailablePower + baselineGemsUsed;
    const baselineNewSurplus = baselineNewAvailable + baselineDormantPower - baselineResidual;
    const patchedBaselineSummary = {
      ...response.upgrades.baseline_summary,
      available_power: baselineNewAvailable,
      status: (baselineNewSurplus >= 0 ? 'feasible' : 'shortfall') as 'feasible' | 'shortfall',
      surplus_or_shortfall: baselineNewSurplus,
    };
    patchedUpgrades = { ...response.upgrades, baseline_summary: patchedBaselineSummary };
  }

  if (gemsUsed === 0) {
    return {
      ...response,
      summary: patchedSummary,
      upgrades: patchedUpgrades,
      remaining_inventory: [...response.remaining_inventory, ...restored],
    };
  }

  const countByGemId = new Map<number, number>();
  for (const gem of rankOneGems.slice(0, gemsUsed)) {
    countByGemId.set(gem.gemId, (countByGemId.get(gem.gemId) ?? 0) + 1);
  }
  const convertedGems: ConvertedGemItem[] = [...countByGemId].map(([gemId, quantity]) => ({
    gem_id: gemId,
    quantity,
    gem_power_gained: quantity,
  }));

  return {
    ...response,
    summary: patchedSummary,
    upgrades: patchedUpgrades,
    remaining_inventory: [...response.remaining_inventory, ...restored],
    converted_gems: convertedGems,
  };
}

/** Restricts `gemAssignments` to the slots in `fiveStarSlots` -- only those sockets reduce residual cost (see docs/SPEC.md). */
function restrictToFiveStarSlots(
  gemAssignments: ReadonlyMap<string, SocketAssignment[]>,
  fiveStarSlots: ReadonlySet<string>,
): Map<string, SocketAssignment[]> {
  const result = new Map<string, SocketAssignment[]>();
  for (const [slot, assignments] of gemAssignments) {
    if (fiveStarSlots.has(slot)) result.set(slot, assignments);
  }
  return result;
}

/**
 * Reverts each dropped upgrade operation's target rank back to its
 * pre-upgrade rank (most recent step first, so multi-step chains unwind
 * correctly), skipping any index already claimed by a socket assignment,
 * then appends the restored spare copies for display.
 */
function buildDisplayInventory(
  working: readonly InventoryGem[],
  droppedOps: ReadonlyArray<readonly [UpgradeDelta[], UpgradeDelta]>,
  gemsToRestore: readonly InventoryGem[],
  assignedCopyIds: ReadonlySet<number>,
): InventoryGem[] {
  const displayInventory: InventoryGem[] = working.map((gem) => ({ ...gem }));
  for (let i = droppedOps.length - 1; i >= 0; i--) {
    const [, mainDelta] = droppedOps[i];
    if (mainDelta.preUpgradeGem === null) continue;
    for (let index = 0; index < displayInventory.length; index++) {
      const gem = displayInventory[index];
      if (
        !assignedCopyIds.has(index) &&
        gem.gemId === mainDelta.gemId &&
        gem.starRating === mainDelta.starRating &&
        gem.rank === mainDelta.targetRank
      ) {
        displayInventory[index] = mainDelta.preUpgradeGem;
        break;
      }
    }
  }
  displayInventory.push(...gemsToRestore);
  return displayInventory;
}

/** Returns the copy ids of every inventory copy occupying a socket. */
function collectAssignedCopyIds(gemAssignments: ReadonlyMap<string, readonly SocketAssignment[]>): Set<number> {
  const assignedCopyIds = new Set<number>();
  for (const assignments of gemAssignments.values()) {
    for (const assignment of assignments) {
      if (assignment.copyId >= 0) assignedCopyIds.add(assignment.copyId);
    }
  }
  return assignedCopyIds;
}

/** The inputs `deriveFromResult` needs for one candidate: the base pipeline call, an upgrade depth combination, or a budget swap trial. */
interface DerivationContext {
  mainGems: readonly MainGem[];
  skippedSlots: readonly string[];
  availablePower: number;
  bonusTable: Map<number, number[]>;
  working: readonly InventoryGem[];
  appliedDeltas: readonly UpgradeDelta[];
  fiveStarSlots: ReadonlySet<string>;
}

/** Everything derived from one candidate per-slot bag assignment: the materialized result, upgrade bookkeeping, display inventory, and the response-accurate surplus/bonus count. */
interface DerivedAssignment {
  result: ReturnType<typeof materializeResult>;
  filtered: UpgradeDelta[];
  upgradeCost: number;
  effectiveResidual: number;
  displayInventory: InventoryGem[];
  /** Gem power recoverable from every copy of the display inventory left unsocketed. */
  dormantPower: number;
  surplus: number;
  bonuses: number;
}

/**
 * Derives a full `DerivedAssignment` from an already materialized result:
 * filters upgrades down to what is actually socketed in a five-star main
 * gem, rebuilds the display inventory, and computes surplus and total
 * activated bonuses exactly as the final response will report them.
 */
function deriveFromResult(ctx: DerivationContext, result: ReturnType<typeof materializeResult>): DerivedAssignment {
  const relevant = restrictToFiveStarSlots(result.gemAssignments, ctx.fiveStarSlots);
  const { filtered, droppedOps, gemsToRestore } = filterUpgradesToSocketed(ctx.appliedDeltas, relevant, result.gemAssignments);
  const upgradeCost = filtered.reduce((sum, delta) => sum + delta.additionalGemPower, 0);
  const effectiveResidual = result.totalResidualCost + upgradeCost;

  const assignedCopyIds = collectAssignedCopyIds(result.gemAssignments);
  const displayInventory = buildDisplayInventory(ctx.working, droppedOps, gemsToRestore, assignedCopyIds);
  const dormantPower = sumDormantPower(displayInventory, assignedCopyIds);
  const surplus = result.availablePower + dormantPower - effectiveResidual;
  const bonuses = result.gemResults.reduce((sum, gemResult) => sum + gemResult.bonusesActivated, 0);

  return { result, filtered, upgradeCost, effectiveResidual, displayInventory, dormantPower, surplus, bonuses };
}

/**
 * Materializes sockets (phase 3) for a candidate per-slot bag assignment,
 * then derives it as `deriveFromResult` does. The bonus budget pass calls
 * this once per swap trial.
 */
function deriveFromBags(ctx: DerivationContext, perSlotGems: ReadonlyMap<string, readonly CopyEntry[]>): DerivedAssignment {
  const allCopies = expandInventory(ctx.working);
  const result = materializeResult(ctx.availablePower, ctx.mainGems, ctx.skippedSlots, allCopies, perSlotGems, ctx.bonusTable);
  return deriveFromResult(ctx, result);
}

/** Effective residual minus recoverable dormant power: the gem power a plan draws from the player's pool. */
function netResidual(derived: DerivedAssignment): number {
  return derived.effectiveResidual - derived.dormantPower;
}

/**
 * Finalizes one candidate per-slot bag assignment into a response: derives
 * the result, runs the bonus budget pass when selected, assembles the
 * upgrades block (when `baseline` is given), and reconciles rank-1
 * conversion last. Used by every return path in `runOptimization` (no
 * upgrades, no viable upgrade chains, and the winning upgrade depth).
 *
 * The budget pass, if it accepts a swap, re-derives the upgrade bookkeeping
 * from its winning bags -- see docs/SPEC.md ("Bonus activation modes"). It
 * never runs against `baseline` (the "without upgrades" comparison).
 */
function finalizeResponse(
  ctx: DerivationContext,
  initialPerSlotGems: ReadonlyMap<string, readonly CopyEntry[]>,
  baseline: ReturnType<typeof materializeResult> | null,
  bonusMode: BonusMode,
  progress: ProgressReporter,
  alreadyDormant: ReadonlyMap<string, number>,
  originalAvailablePower: number,
  rankOneGems: readonly InventoryGem[],
): OptimizeResponse {
  let derived = deriveFromBags(ctx, initialPerSlotGems);

  if (bonusMode === 'budget') {
    progress.report('bonus_budget', 'running', { detail: 'Activating gem bonuses...' });
    // Dropping an upgrade frees its spare copies, which only become socket
    // candidates once the display inventory replaces the working one. Repeat
    // the pass on that inventory until a round activates no further bonus.
    let roundCtx = ctx;
    for (;;) {
      const evaluate: BudgetEvaluator = (bags) => {
        const trial = deriveFromBags(roundCtx, bags);
        return { result: trial.result, surplus: trial.surplus, bonuses: trial.bonuses };
      };
      const initialEvaluation: BudgetEvaluation = { result: derived.result, surplus: derived.surplus, bonuses: derived.bonuses };
      const winner = budgetActivateBonuses(
        roundCtx.mainGems,
        roundCtx.bonusTable,
        expandInventory(roundCtx.working),
        initialEvaluation,
        evaluate,
      );
      const next = deriveFromBags(roundCtx, bagsFromAssignments(winner.result));
      const improved = next.bonuses > derived.bonuses;
      derived = next;
      if (!improved) break;
      roundCtx = { ...roundCtx, working: derived.displayInventory, appliedDeltas: derived.filtered };
      derived = deriveFromBags(roundCtx, bagsFromAssignments(derived.result));
    }
  }

  const upgradeResult: UpgradeOptimizationResult | null =
    baseline === null
      ? null
      : {
          baseline,
          upgraded: derived.result,
          upgradesApplied: derived.filtered,
          totalUpgradeCost: derived.upgradeCost,
          effectiveResidual: derived.effectiveResidual,
          improvement: baseline.totalResidualCost - derived.effectiveResidual,
        };

  const response = domainToResponse(derived.result, upgradeResult, derived.displayInventory, alreadyDormant);
  return finalizeRankOneConversion(response, originalAvailablePower, rankOneGems);
}

/**
 * Runs the optimizer end to end: parses and validates the request, runs
 * the baseline pipeline, and -- when `enableUpgrades` is set -- searches
 * for the upgrade depth combination that leaves the most gem power, never
 * settling for less than the plan without upgrades, before producing the
 * final response. `bonusMode` selects the bonus activation
 * strategy: 'off' (default, tie-break only), 'forced' (biases gem
 * selection inside the pipeline itself), or 'budget' (a post-pipeline swap
 * pass, see `finalizeResponse`). Throws ValidationError if the request has
 * no valid main gems.
 */
export function runOptimization(
  request: OptimizeRequest,
  enableUpgrades: boolean,
  convert1Star: boolean,
  bonusMode: BonusMode = 'off',
  progress: ProgressReporter = nullReporter,
): OptimizeResponse {
  const { availablePower: parsedAvailablePower, mainGems, skippedSlots, inventory: parsedInventory } = requestToDomain(request);
  const alreadyDormant = alreadyDormantCounter(request);

  if (mainGems.length === 0) {
    throw new ValidationError('No valid main gems found in gem_setup. Provide at least one slot with a valid gem_id and target_rank.');
  }

  // When convert1Star is set, rank-1 1-star gems are removed from the
  // inventory up front and their count is added to the available power
  // pool, so the optimizer (including the upgrade search below) sees
  // their gem-power equivalent from the start.
  const originalAvailablePower = parsedAvailablePower;
  let availablePower = parsedAvailablePower;
  let inventory = parsedInventory;
  let rankOneGems: InventoryGem[] = [];
  if (convert1Star) {
    const isConvertible = (gem: InventoryGem) => gem.starRating === 1 && gem.rank === '1' && !gem.locked;
    rankOneGems = inventory.filter(isConvertible);
    inventory = inventory.filter((gem) => !isConvertible(gem));
    availablePower = availablePower + rankOneGems.length;
  }

  const baseline = runPipeline(availablePower, mainGems, skippedSlots, inventory, { progress, bonusMode });

  // Only sockets in five-star main gems reduce residual cost; gems placed
  // in two-star main gem sockets must not be counted as "used" when
  // deciding which upgrades to keep, nor as activatable by the budget pass.
  const fiveStarSlots = new Set(mainGems.filter((mainGem) => mainGem.starRating === 5).map((mainGem) => mainGem.slotName));

  const noUpgradeCtx: DerivationContext = {
    mainGems,
    skippedSlots,
    availablePower,
    bonusTable: baseline.bonusTable,
    working: inventory,
    appliedDeltas: [],
    fiveStarSlots,
  };

  if (!enableUpgrades) {
    return finalizeResponse(
      noUpgradeCtx,
      bagsFromAssignments(baseline),
      null,
      bonusMode,
      progress,
      alreadyDormant,
      originalAvailablePower,
      rankOneGems,
    );
  }

  // Build upgrade chains (one per socketable gem type) and search for the
  // depth combination that leaves the most gem power.
  const socketCounts = computeSocketCounts(mainGems);
  const { chains, leftover } = buildUpgradeChains(inventory, socketCounts);

  if (!chains.some((chain) => chain.steps.length > 0)) {
    return finalizeResponse(
      noUpgradeCtx,
      bagsFromAssignments(baseline),
      baseline,
      bonusMode,
      progress,
      alreadyDormant,
      originalAvailablePower,
      rankOneGems,
    );
  }

  progress.report('upgrades', 'running', { detail: 'Evaluating upgrade potential...' });

  // Two-star chains come first so the search sweeps them before five-star
  // chains; the five-star preference itself is a tie-break in the search.
  const allChains = [...chains.filter((chain) => chain.starRating === 2), ...chains.filter((chain) => chain.starRating === 5)];

  let firstPipelineRun = true;
  /** Runs the pipeline on the inventory one depth combination produces. */
  const runCandidate = (depths: readonly number[]) => {
    const { working, appliedDeltas } = materializeUpgrades(allChains, depths, leftover);
    const result = runPipeline(availablePower, mainGems, skippedSlots, working, {
      progress: firstPipelineRun ? progress : nullReporter,
      bonusMode,
    });
    firstPipelineRun = false;
    const ctx: DerivationContext = { ...noUpgradeCtx, working, appliedDeltas };
    return { ctx, result, derived: deriveFromResult(ctx, result) };
  };

  // The search caches every score, so it only sees the scores; the winner's
  // pipeline result is rebuilt afterwards.
  const scoreDepths = (depths: readonly number[]): DepthScore => {
    const { derived } = runCandidate(depths);
    return {
      netResidual: netResidual(derived),
      fiveStarUpgradeCost: derived.filtered
        .filter((delta) => delta.starRating === 5)
        .reduce((sum, delta) => sum + delta.additionalGemPower, 0),
      upgradeCost: derived.upgradeCost,
    };
  };

  const { depths: chosenDepths, score: chosenScore } = searchUpgradeDepths(
    allChains.map((chain) => chain.steps.length),
    scoreDepths,
    {
      ...DEFAULT_UPGRADE_SEARCH_OPTIONS,
      onRestart: (index, total) =>
        progress.report('upgrades_rerun', 'running', {
          iteration: index,
          detail: `Searching upgrade combinations (${index} of ${total})...`,
        }),
    },
  );

  // Upgrades must never leave less gem power than not upgrading at all.
  const baselineNetResidual = netResidual(deriveFromResult(noUpgradeCtx, baseline));
  if (baselineNetResidual <= chosenScore.netResidual) {
    return finalizeResponse(
      noUpgradeCtx,
      bagsFromAssignments(baseline),
      baseline,
      bonusMode,
      progress,
      alreadyDormant,
      originalAvailablePower,
      rankOneGems,
    );
  }

  // finalizeResponse re-derives the upgrade bookkeeping and display
  // inventory from the winner (and applies the bonus budget pass, if
  // selected).
  const chosen = runCandidate(chosenDepths);
  return finalizeResponse(
    chosen.ctx,
    bagsFromAssignments(chosen.result),
    baseline,
    bonusMode,
    progress,
    alreadyDormant,
    originalAvailablePower,
    rankOneGems,
  );
}
