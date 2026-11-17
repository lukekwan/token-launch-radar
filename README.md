# Token Radar

[![bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lukekwan/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lukekwan/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01): every pre-token protocol in the sealed DefiLlama snapshot, ranked by implied value, with a farm plan for each one.

## What it does

`main.ts` reads the sealed snapshot (`/input/snapshot.json`), scores every pre-token protocol, and writes:

- `board.json` — the ranked board: all 40 watchlist protocols plus the 160 strongest pre-token protocols below the $50M floor, ranked by implied value.
- `data.js` — the same board, compact, for the dashboard.
- `dashboard/` — a static page (no framework, no network): the ranked board, a live-token view, the model, and a sandbox that re-runs the model under different constants.
- `screenshots/` — the board, a detail view, and a filtered view.
- `dossier.json` — the summary the judge reads, built with the vendored make.fun library.

## The model (radar-2)

Implied value follows from the snapshot's own figures, priced at the multiple the market already pays for a token in the same category:

```
implied = round( tvl_usd x multiple(category)
               x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
               x (0.6 + min(age_days, 1095) / 1095 x 0.4) )
```

`multiple(category)` is the median market-cap-to-TVL ratio of the live-token protocols in that category, shrunk toward the overall median so one or two comps cannot set the price:

```
multiple = (n x median + 4 x overall) / (n + 4), clamped to [0.01, 1.00]
```

A category with no live-token comps takes the overall median. No protocol name is special-cased: the same function scores every row. The dashboard states every multiple, with the comp count, so the pricing is visible, not hidden.

## Farm plans

Each row carries a six-step farm plan derived from the protocol's own record — its category, chains, TVL and age — with a cost and a time for every step. The plan is a derivation, never a hand-written list of names.

## Running it

Node 22, standard library only, no install:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Inside the grader's container the snapshot is mounted at `/input` and the output goes to `/output` by default. The run is deterministic: the same snapshot always produces the same board.

## Layout

```
main.ts                  the entry: reads the snapshot, writes the board and the dossier
lib/model.ts             the model: scoring, multiples, farm plans, the gate check
vendor/makefun-board.ts  make.fun's dossier library (vendored, as the kit instructs)
dashboard/               the static page: index.html, app.css, app.js
screenshots/             board, detail, filtered
.makefun/owner.json      the wallet that owns this entry
```

## Source

Snapshot: DefiLlama protocol index, 2026-11-14. Implied value is an estimate from the snapshot, not a price, and not investment advice.
