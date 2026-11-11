---
name: upgrade-feature
description: Describes the gem upgrade search (chain construction and depth search). Use this to cross reference the implementation with the intended behavior of the upgrade feature.
---

# Gem Upgrade Feature

An optional pass (off by default) that spends spare inventory copies to raise a socketed gem's rank,
trading gem power and spare copies for higher contribution. See `docs/SPEC.md` ("4. Upgrading gems",
"5. Feasibility") for the game rules; this skill covers the search's shape.

## Chain construction

A **chain** is one gem type at one star rating: a starting copy plus an ordered sequence of
sub-rank steps it could be raised through, each step snapshotting that type's sub-inventory at that
depth so any depth applies directly, without replaying earlier steps.

Only **5-star** main gem sockets count as upgrade targets — 1/2-star sockets never reduce residual,
so they can't justify an upgrade; gems of an unsocketable star are left untouched. Among the rest,
only the highest-value gem types are kept, one chain per available socket, ranked by contribution
then by copy count; the remainder stays ordinary inventory.

The highest-contribution copy in a chosen group is the upgrade target; the rest are spare copies.
Each step advances the target to the next rank needing strictly more cumulative spare copies,
consuming exactly that many of the cheapest spares. The chain stops once no rank needs more copies
or spares run out — it never proposes a step it can't fully fund.

## Depth search

A candidate is a chosen depth per chain, materialized into a working inventory and re-run through
the base assignment to score it (`searchUpgradeDepths` in `src/core/upgradeSearch.ts`, wired up by
`runOptimization`).

Only upgrades that end up socketed in a 5-star main gem count toward cost. That cost is added to
the base residual for the gross _effective residual_ shown to the player; recoverable power from
everything left unsocketed is then subtracted to get a _net residual_. The search minimizes net
residual (that is, maximizes surplus), breaking ties by lower five-star upgrade cost, then lower total
upgrade cost. That tie-break is how two-star material is preferred (`docs/SPEC.md` §4). It never
outranks surplus. The player's pool plays no part in the search, so the chosen depths are the same
whatever the pool.

The search is cyclic coordinate descent starting from "no upgrades" (every depth 0): each chain in
turn is set to its best depth, scanning all of its depths with the other chains fixed, until a full
sweep changes nothing. Seeded restarts then randomly redraw some chains' depths from the best
combination so far and descend again, keeping any improvement. Evaluations are cached by depth
combination and capped, so the result is deterministic. Two-star chains come before five-star chains
in the sweep order.

`runOptimization` finally compares the winner against the baseline (the no-upgrade pipeline run) and
keeps the baseline unless the winner has a strictly lower net residual, so enabling upgrades never
leaves less surplus before the bonus `budget` pass. That pass runs on the chosen plan afterwards and
may spend the extra surplus on bonuses or drop upgrades, so its final surplus can be lower with
upgrades than without (see `docs/SPEC.md` §3, "Bonus activation modes").

## Unwinding dropped upgrades

Each socketed rank is traced back through its chain twice, against two different definitions of
"socketed": a multi-step upgrade is kept in full (and charged) if its final rank is socketed in a
five-star main gem, or dropped in full (uncharged) if not. A dropped chain's spare copies are only
marked for restoration if its final rank isn't socketed anywhere at all — a rank that landed in a
1/2-star main gem's socket instead is uncharged but still in use, so its spare copies aren't
fabricated back into the display inventory. The gems shown to the player revert each dropped
upgrade's target rank to its pre-upgrade rank, most recent step first, then append the restored
spare copies — only unassigned copies are touched.
