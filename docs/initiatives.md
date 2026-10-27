# Play Park — Initiatives v1

**Status:** Approved for implementation  
**Owner:** Project manager (AI)  
**Human acceptance:** Repository owner / live tester  
**Baseline:** commit `4e3a626`, 56/56 tests passing  
**Target build window:** 60 minutes wall-clock (30-minute checkpoint, 60-minute handoff)

---

## 1. Executive summary

Three initiatives are approved for a single v1 delivery:

1. **Mini-game contract** — standardize how mini-games plug into Play Park so 10–20 future games need rules + data only, not core rewrites.
2. **Effect items** — standardize data-driven items with visual, movement, and reward effects; ship 10 basic items.
3. **AI behaviors** — standardize data-driven avatar behavior: greet, auto-friend, auto-mini-game, and style-specific companion follow.

The plan uses **eight coding sub-agents plus one verifier**, working in four short waves with strict file ownership. The project manager owns interfaces, sequencing, integration decisions, commits, and communication with the human tester. Sub-agents do not commit.

**Reality check:** 60 minutes is enough for a complete, test-green v1 implementation of the approved slice, but not for visual polish across every effect and behavior. Anything not finished inside the window is reported explicitly as a known gap rather than silently dropped.

---

## 2. Success criteria

The v1 delivery is accepted when:

- `npm test` is green, including new contract/effects/behavior suites.
- All four existing mini-games run through the new host contract with no gameplay regression.
- The 10 effect items exist in data; the 3 headline items (Big-O-Bracelet, Chamo Clip, Teleport Tricorder) are visibly functional.
- Greet, auto-friend, and four style-specific companion follows are demonstrable in the park.
- NPC-vs-NPC Tic-Tac-Toe works if the contract lands cleanly; otherwise it is reported as the single deferred behavior.
- Save v2 migration loads an existing v1 save without data loss.
- The human tester can run the same smoke checklist used after the last chess delivery.

---

## 3. Approved decisions

| Area | Decision |
| --- | --- |
| Sequencing | Contract first; effects in parallel at the data/runtime layer; behaviors foundation next; social/NPC games after the seat model exists. |
| Shared files | One owner per wave; PM resolves cross-cutting hooks. |
| Mini-game sessions | One active session globally. Player start is denied with a toast if a board is open; player start auto-packs an ambient NPC board. |
| Session persistence | Not persisted in v1. Reload packs up; toast informs the player. |
| Table-game eligibility | Friends only, from both dialogue and backpack. |
| Outcomes | `win / loss / draw / complete / abandoned`; scored/ranked outcomes deferred. |
| NPC-vs-NPC | Seat/controller model designed now; auto-play shipped for Tic-Tac-Toe only. |
| Chamo Clip | Sprite alpha **0.1**; nameplate, selection ring, and faint outline stay visible. |
| Big-O | Scale sprite + hitbox + nameplate; camera/minimap unchanged. |
| Teleport | Cosmetic only; same collision/reservation/bump rules. |
| Effect acquisition | 3 headline items in starter + debug; remaining 7 via mini-game loot and debug. Item reward branch fixed first. |
| Effect slots | Ship proposed slots; capacity 1 except charm (2); multiple effects may be active. |
| Effect duration | Permanent until unequipped in v1. |
| Companion gear | One `buddy` slot; player-assigned; party effects inherit from owner. |
| NPC effects | Debug-only initially. |
| NPC friendships | Strictly separate from the player’s friend list. |
| Social suppression | 3 tiles for greet/befriend; 4 tiles for auto-mini-game. |
| Friend acceptance | Deterministic threshold (two greetings + one shared activity), cooldown, no invisible success RNG. |
| Friendship cap | 6 per NPC; 256 pair records maximum. |
| Style follows | Dog, gaze, clay, skeleton, plus generic fallback. |
| Hologram collision | Remains tile-bound in v1. |
| Persistence | One save v2 migration; keep `playpark.save.v1` key; persist gear, NPC friendships, cooldowns; never persist live sessions/paths/behaviors. |
| Scope cut order | NPC-vs-NPC → non-headline effects → auto-friend → greet. Never cut the contract, save migration, or seat model. |

---

## 4. Scope

### 4.1 In scope

- Mini-game host contract, staging service, settlement pipeline, registry metadata.
- Migration of tic-tac-toe, checkers, chess, and fetch.
- Seat/controller model (human vs AI; human vs human not shipped).
- Effects data + runtime + save migration + backpack/card UX.
- Ten effect items with working data definitions.
- Behavior config + runtime + arbiter + speech bubbles.
- Greet, auto-friend, style follows, TTT NPC-vs-NPC.
- Debug instrumentation for games, effects, and behaviors.
- Tests and this planning document.

### 4.2 Out of scope

- NPC-vs-NPC checkers/chess.
- Hotseat/local multiplayer.
- Live-session survive-reload.
- Timed, consumable, or charge-based effects.
- Shop/economy.
- Observe-and-gather spectator behavior.
- Bespoke follow profiles for every companion style.
- Audio.
- Browser automation or committed screenshots.

---

## 5. Target architecture

### 5.1 Mini-game contract

New modules:

- `src/minigames/contract.js` — `MiniGameBase`, canonical phases (`opening`, `ready`, `playing`, `ending`, `closing`), `GameEvent`, `StepResult`, metadata validation.
- `src/minigames/host.js` — registry, single active session, input routing, lifecycle, pause/resume, timer facade, event dispatch.
- `src/minigames/staging.js` — placement search, margin validation, seat targets, companion spectator staging, evacuation, session-scoped release.
- `src/minigames/settlement.js` — winner-seat → outcome, stats, rewards, end dialogue, cheer/toast events.
- `data/minigames.json` — per-game metadata: kind, item, dialogue key, reward key, seats, board, input, render layers, timing, persistence flag.

Game responsibilities:

- Rules/state only; no `document`, `window`, `setTimeout`, `recordGameResult`, `rollReward`, or `game.player` identity checks.
- Return events such as `{ type: 'finish', winnerSeat }`; host settles.
- Declare a board footprint or omit it for activities such as fetch.

Core integration:

- `Game` delegates blocked tiles, on-board checks, participant checks, updates, actions, and rendering layers to the host.
- `main.js`, `panels.js`, and `dialogue.js` dispatch by metadata, not game id.
- Renderer gains `ground`, `object`, `overlay`, `hud` layers; world layers use the already-translated context and a shared `view` object.

### 5.2 Effect items

New modules/data:

- `data/effects.json` — slots, stacking/composition rules, motions, transition defaults, 10 effect definitions.
- `src/effects.js` — pure equip/unequip, active effect resolution, composition, transition weights, motion priority.
- `src/inventory.js` — item instances (`uid`, `id`, overrides) and catalog lookup.
- `src/render.js`/renderer helper — shared character height and effect composition.

Core hooks:

- One renderer composition point: base animation → motion override → offsets/scale/rotate/alpha → aura/trail → tint/outline.
- One movement hook in `tryStep` and `interpolated`; teleport never bypasses collision.
- One save migration from full item objects to instances plus `equipped`.
- One bag/card UI path driven by item effect data.

Ten items:

| # | Item | Slot | Effect |
| --- | --- | --- | --- |
| 1 | Big-O-Bracelet | charm | 1.5× sprite/hitbox/nameplate, pop transition |
| 2 | Chamo Clip | face | alpha 0.1, fade in/out, faint outline |
| 3 | Teleport Tricorder | hand | blink movement style |
| 4 | Hover Halo | head | float motion + glow |
| 5 | Prism Pin | charm | slow tint cycle |
| 6 | Echo Bell | charm | fading afterimages on move |
| 7 | Bouncy Boots | feet | squash landing + dust + faster cadence |
| 8 | Buddy Cape | back | party companions scale/tint |
| 9 | Glowworm Jar | hand | pulsing aura |
| 10 | Lucky Clover | charm | +1 coin on reward |

### 5.3 AI behaviors

New modules/data:

- `data/behaviors.json` — behavior FSMs, selectors, predicates, assignments, limits.
- `src/behavior/config.js` — validation, freezing, assignment resolution.
- `src/behavior/blackboard.js` — world snapshot, spatial buckets, pair facts.
- `src/behavior/predicates.js` — `all/any/not` predicate evaluation.
- `src/behavior/selectors.js` — nearest, by id, mutual friend, buddy, midpoint.
- `src/behavior/actions.js` — `wait`, `wanderStep`, `seek`, `followTarget`, `faceTarget`, `emote`, `say`, `startGame`, `awaitGame`, `resolveFriendship`, `abort`.
- `src/behavior/cooldowns.js` — actor/pair/global cooldowns.
- `src/behavior/arbiter.js` — dialogue, pair, actor, and mini-game locks.
- `src/behavior/runtime.js` — scheduler and FSM execution.
- `src/behavior/events.js` — bounded event log for debug.
- `src/ui/speech.js` — non-modal world-space bubbles.

Scenarios:

- Greet: nearby idle NPCs wave, pair cooldown, player-proximity suppression.
- Auto-friend: separate NPC-NPC relation, score threshold, cap, bubbles only.
- Auto-mini-game: TTT between friends via the seat-based contract; no player rewards/stats/dialogue.
- Style follow: dog roam, hologram beside, clay hop/roll cadence, skeleton shamble, generic trail.

---

## 6. Delivery model

### 6.1 Constraints

- Sub-agents code; PM coordinates, reviews, and commits.
- Agents must not commit, push, create branches, or run destructive git commands.
- Agents may edit **only** their assigned files. Cross-file changes are requested through the PM.
- Interface and data schemas are frozen at kickoff; agents code against the plan, not against each other’s unfinished files.
- Existing behavior and tests must remain green. No opportunistic refactors.
- No runtime network access, no browser automation, no screenshots in the repo.
- Each agent returns: files changed, tests run, deviations, remaining work, and risks.

### 6.2 Sub-agent roster and assignments

| ID | Agent handle | Wave | Owns / writes | Deliverable | Depends on |
| --- | --- | --- | --- | --- | --- |
| **A1** | `contract-core` | 1 | `src/minigames/contract.js`, `host.js`, `staging.js`, `settlement.js`, `data/minigames.json`, new contract/host tests | Host lifecycle, single-session registry, staging/release, settlement pipeline, metadata validation | Approved interface only |
| **A2** | `contract-games` | 2 | `src/games/tic-tac-toe.js`, `checkers.js`, `chess.js`, `fetch.js`, game-specific tests | Migrate all four games to the contract; extract rules only where necessary; no core edits | A1 interface |
| **B1** | `effects-core` | 1 | `data/effects.json`, `src/effects.js`, `src/inventory.js`, `test/effects.test.js`, `test/inventory.test.js` | Slots, composition, equip/unequip, transitions, motion resolution, 10 effect definitions, instance helpers | Approved schema |
| **B2** | `effects-content` | 2 | `data/items.json`, `src/rewards.js`, `data/rewards.json`, `test/features.test.js` reward section | 10 item entries, starter/debug/acquisition wiring, item loot-table branch fixed | B1 schema |
| **C1** | `behaviors-core` | 1 | `data/behaviors.json`, `src/behavior/config.js`, `blackboard.js`, `predicates.js`, `selectors.js`, `actions.js`, `cooldowns.js`, `arbiter.js`, `runtime.js`, `events.js`, `test/behavior-*.test.js` | Behavior schema + runtime + wander/follow migration definitions + greet/befriend/invite definitions | Approved schema |
| **C2** | `behaviors-social` | 2 | `src/ui/speech.js`, `src/behavior/actions/social.js`, social tests | World-space bubbles, social action verbs, resolve-friendship, NPC-game adapter hooks | C1 interface, A1 seat model |
| **D1** | `integration-runtime` | 3 | `src/game.js`, `src/renderer.js`, `src/storage.js`, `test/gameplay.test.js`, `test/storage.test.js` | Wire host/effects/behaviors into runtime; render layers; height/hitbox helper; save v2 migration | A1, B1, C1 |
| **D2** | `integration-ux` | 3 | `src/main.js`, `src/ui/panels.js`, `src/dialogue.js`, `data/dialogues.json`, `css/app.css` | Data-driven dialogue/item/host dispatch; bag & effects UI; card chips; debug panel; NPC-game suppression | A1, B1, C1, D1 |
| **E1** | `qa-verifier` | 3 | New tests only: `test/data-validation.test.js`, `test/acceptance.test.js` | Cross-data validation, full-suite run, acceptance matrix, regression report | All feature agents |
| **PM** | Project manager | 0–4 | `docs/initiatives.md`, final commits | Interfaces, sequencing, merges, decisions, tester communication | All |

### 6.3 File ownership matrix (conflict avoidance)

| File / area | Owner |
| --- | --- |
| `docs/initiatives.md` | PM |
| `src/minigames/*`, `data/minigames.json` | A1 |
| `src/games/*` | A2 |
| `data/effects.json`, `src/effects.js`, `src/inventory.js` | B1 |
| `data/items.json`, `src/rewards.js`, `data/rewards.json` | B2 |
| `data/behaviors.json`, `src/behavior/{config,blackboard,predicates,selectors,actions,cooldowns,arbiter,runtime,events}.js` | C1 |
| `src/ui/speech.js`, `src/behavior/actions/social.js` | C2 |
| `src/game.js`, `src/renderer.js`, `src/storage.js` | D1 |
| `src/main.js`, `src/ui/panels.js`, `src/dialogue.js`, `data/dialogues.json`, `css/app.css` | D2 |
| New verification tests | E1 |
| Shared tests | D1/D2 by area; PM resolves |

**Escalation rule:** if an agent needs a change outside its ownership, it sends a precise patch request to the PM. The PM either applies it or assigns it to the owner. No agent edits another agent’s file.

### 6.4 60-minute execution schedule

| Clock | Wave | Active agents | Output / gate |
| --- | --- | --- | --- |
| 0–5 min | Kickoff | PM | Freeze interfaces, baseline `npm test`, create doc, assign agents, confirm clean tree |
| 5–25 min | Wave 1 — foundations | A1, B1, C1 | Contract/host, effects runtime, behavior runtime + tests in owned files |
| 15–40 min | Wave 2 — feature completion | A2, B2, C2 (start as dependencies land) | Four games migrated, 10 items wired, social actions/bubbles + TTT NPC adapter |
| 35–55 min | Wave 3 — integration | D1, D2, E1 | Runtime/UI wiring, save v2, validation/acceptance tests |
| 45–60 min | Fix loop | All owners on failures | PM triages test/runtime failures to owning agent; no scope expansion |
| 55–60 min | Handoff | PM | Final `npm test`, commit, change summary, tester checklist, known gaps |

**30-minute checkpoint:** PM reports foundation status and any interface drift. If Wave 1 is not coherent at 25 minutes, PM cuts scope in the approved order before integration starts.

### 6.5 Agent working agreements

1. Read `AGENTS.md` and this document before coding.
2. Work only in assigned files; preserve existing style and data-driven patterns.
3. No commits, pushes, branch changes, or dependency installs.
4. Run the smallest relevant test command; full `npm test` before returning.
5. If a dependency is missing, code to the documented interface and flag the assumption in the handoff.
6. Do not invent product decisions; log open questions for the PM.
7. Keep additions small and reversible; no drive-by refactors.
8. Every new data file must be valid JSON and have a matching validation test.

---

## 7. Integration and quality gates

### 7.1 Gates

| Gate | When | Requirement |
| --- | --- | --- |
| G0 — Baseline | Kickoff | Clean tree, 56/56 tests pass |
| G1 — Contract core | 25 min | A1 tests pass; metadata validates; host lifecycle test green |
| G2 — Effects runtime | 25 min | B1 tests pass; unknown ids fail safe; composition deterministic |
| G3 — Behavior runtime | 25 min | C1 tests pass; deterministic tie-break; no oscillation in fixture |
| G4 — Feature completion | 40 min | A2/B2/C2 handoffs reviewed; no ownership violations |
| G5 — Integration | 55 min | `npm test` green; save v1 → v2 migration test green |
| G6 — Handoff | 60 min | PM commit; tester checklist issued; known gaps listed |

### 7.2 Required tests

- Contract lifecycle, single-session, staging/release, generic collision, settlement called once.
- Each migrated game's existing rules tests still pass.
- Effects: schema validity, slot capacity, composition, transition weights, motion priority, unknown ids.
- Inventory/save: instance round-trip, v1 → v2 migration, missing gear fields.
- Behaviors: predicate evaluation, priority/tie-break, cooldowns, arbiter locks, greet/friend thresholds, style follow params.
- Data cross-checks: every item's effect, slot, game id, reward key, and dialogue key resolve.
- Runtime hooks: teleport still respects water/occupancy/board blocking; Big-O height used by hitbox/nameplate; NPC game grants no player reward.

### 7.3 Manual smoke checklist (human tester)

1. Load an existing v1 save: park, inventory, friends, coins intact.
2. Unfurl/play tic-tac-toe, checkers, chess with a friend; pack up; verify rewards/stats.
3. Throw the ball; verify fetch still works.
4. Equip/unequip Big-O, Chamo, Teleport; verify scale, fade, blink, hitbox, nameplate.
5. Verify the other seven items via debug/backpack; no crashes.
6. Watch two NPCs greet; verify speech bubbles and cooldown.
7. Let two NPC friends start Tic-Tac-Toe; verify no player dialogue/reward and board packing.
8. Verify dog/gaze/clay/skeleton companions follow differently.
9. Open Debug: behavior state, effect state, game session state visible.
10. Reload mid-session: no stale board, no stuck staging, save still loads.

---

## 8. Human tester loop

**PM responsibilities**

- Provide one consolidated build per checkpoint, not per agent.
- Report exactly what changed, what was tested, and what is intentionally unfinished.
- Convert tester bug reports into owner assignments by file area.
- Protect the approved scope; reject unapproved expansions during the fix loop.
- Keep commits green and messages descriptive.

**Tester checkpoints**

1. **T+30 min (optional smoke):** foundations available; tester may inspect the park for obvious regressions.
2. **T+60 min (acceptance):** full smoke checklist, prioritized bug list.
3. **Fix wave (if needed):** 15–20 minutes, routed to owning agents, limited to reported regressions and incomplete acceptance criteria.

**Bug report format**

- What I did
- What I expected
- What happened
- Save state / seed if relevant
- Screenshot or console text if available

---

## 9. Acceptance criteria

### Contract

- All four games register through the host and run with no behavior change.
- One active session; no cross-game staging clobbering; action routing deterministic.
- Host owns stats/rewards/dialogue; games emit events only.
- Non-board activity (fetch) works without board assumptions.

### Effects

- 10 items defined in data and grantable.
- Big-O, Chamo, and Teleport visually work end-to-end.
- Save v1 loads and migrates; gear round-trips for player, NPC, companion.
- No effect bypasses collision, dialogue, or mini-game blocking.
- Hitbox and nameplate match scaled characters.

### Behaviors

- Greet and auto-friend occur between idle NPCs with cooldowns and no modal dialogue.
- NPC-NPC Tic-Tac-Toe runs, then packs up; no player rewards/stats.
- Four style profiles visibly differ and preserve collision.
- Debug tab exposes behavior state; no oscillation or runaway cooldown loops.

### Overall

- `npm test` green.
- No new runtime network requests.
- No commits of ignored artifacts.
- PM final report includes known gaps.

---

## 10. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| 60-minute window is too tight | High | Partial scope | Approved cut order; foundation-first gates; report gaps honestly |
| Shared-file contention between agents | Medium | Merge conflicts / broken tests | Ownership matrix; PM-only cross-file edits; no commits by agents |
| Contract migration changes game feel | Medium | Regression | Keep rules code intact; migrate integration only; existing tests as guardrails |
| Save migration breaks existing saves | Medium | Data loss | Migration test with a real v1 fixture; keep storage key; reject future versions gracefully |
| Effects visual bugs not caught by unit tests | High | Tester friction | Headline items first; manual checklist; visual checks in the tester loop |
| Behavior loops / oscillation | Medium | Frame churn / odd NPCs | Cooldowns, hysteresis, retry budget, deterministic tie-break, debug log |
| NPC games interfere with player | Medium | Player agency | Single-board rule, proximity suppression, pack-up on player start, no player rewards |
| Performance regression | Low–Medium | Frame drops | Decision tick budget, spatial buckets, limit trail/aura draws, no O(n²) per frame |
| Scope creep during fix loop | Medium | Slips past window | PM gate: only acceptance failures and tester-reported bugs |

---

## 11. Deferred backlog

- NPC-vs-NPC checkers and chess.
- Hotseat and remote seats.
- Active-session persistence.
- Timed/consumable effects, shops, gifting.
- Observe-and-gather spectators.
- Bespoke follows for cat, critters, voxel-bot, sprouts, and other pets/creatures.
- Scored/ranked game outcomes and leaderboards.
- Audio and reduced-motion settings.
- Effect previews in wizard/companion DOM surfaces.
- Multiple simultaneous boards.

---

## 12. Decision log

| # | Decision | Approved |
| --- | --- | --- |
| 1 | Contract first; effects parallel; behaviors after foundation | Yes |
| 2 | One global mini-game session; no live-session persistence | Yes |
| 3 | Friends-only table games | Yes |
| 4 | Seat/controller model now; NPC-vs-NPC TTT only | Yes |
| 5 | Chamo alpha 0.1 with visible affordances | Yes |
| 6 | Big-O scales sprite, hitbox, and nameplate | Yes |
| 7 | Teleport cosmetic; collision unchanged | Yes |
| 8 | 10 effect items; 3 headline polished, rest data-grantable | Yes |
| 9 | Permanent effects until unequip | Yes |
| 10 | Companion buddy slot; player-assigned | Yes |
| 11 | NPC friendships separate from player friends | Yes |
| 12 | Deterministic friend threshold; no invisible success RNG | Yes |
| 13 | Four style follows + generic | Yes |
| 14 | Holograms remain tile-bound | Yes |
| 15 | One save v2 migration; keep storage key | Yes |
| 16 | 60-minute target; 30-minute checkpoint; fix wave if needed | Yes |

---

## Appendix A — Interface highlights for agents

### Mini-game base (required shape)

```js
open({ seats, placement, options }) -> { ok, phase?, durationMs?, message? }
ready()
update(dtMs) -> { handled, changed, events? }
handleInput(input) -> { handled, changed, events? }
pause(reason) / resume(reason)
close({ reason })
serialize() / restore(state)
getFootprint() / getHiddenZones() / getRenderables()
render(ctx, layer, view)
```

### Effect channels

```text
scale (multiply) · alpha (multiply) · offsetX/Y (add) · rotate (add)
motion (priority) · tint (blend) · aura/trail (list) · outline (last)
stepDurationScale (multiply) · coinBonus (add)
```

### Behavior FSM

```text
behavior = priority, when, target, states{ action, params, duration, next, transitions }, cooldowns, onComplete
actor = behavior, state, target, elapsed, lockedBy
runtime = choose > arbitrate > run state > advance/complete/interrupt
```

---

## 13. Implementation status (v1 delivery)

**Delivered**

- Mini-game host contract, registry, staging, settlement, and metadata for all four games.
- Tic-Tac-Toe, checkers, chess, and fetch adapters; single-session rule; friend-gated table games.
- Effect schema/runtime, 10 effect items, equip/unequip UI, save v2 migration, Big-O/Chamo/Teleport visuals.
- Behavior schema/runtime/arbiter/cooldowns, greet, auto-friend, style-specific follow, NPC speech bubbles, NPC-vs-NPC Tic-Tac-Toe.
- Debug controls for effect grants, NPC game, host state, and behavior summary.
- Tests: **220 passing**, plus data-validation, acceptance, and v1→v2 save-fixture suites.

**Fixed during live browser verification**

- Negative first-frame delta stopped the game loop now clamped.
- Equip timestamps used `Date.now()` while rendering used `game.time`; effects never faded in — clocks aligned.
- Host called `game.getCompanionsFor` unbound; game starts crashed — resolver bound.
- Fetch treated its companion as a parked board participant; fetch froze — boardless activities no longer claim companions.
- NPC Tic-Tac-Toe did not stage seat 0, placed the board around the human, and the human blocked the seat — NPC placement/staging and seat blocking fixed; NPC TTT driver added.
- Debug NPC games picked far-apart neighbours; now picks the closest pair.
- Reward companions had no behavior entry until reload — rewards and companion bench/activate now resync the behavior world.
- Scenery on mini-game boards stayed visible — host hidden zones now include the full board footprint with a 2-tile visual margin.
- NPC mini-games yanked the player next to the board — the human stays put and gets a 5-second "want to watch?" prompt; Watch walks them over instead of teleporting.
- Chamo Clip drew an oval outline — removed; it is now a clean 60% fade.
- Buddies converged on the same follow tile — companions now use stable distinct follow slots (right/left/down/up ring) plus per-actor cadence jitter.

**Known gaps / follow-ups**

- Effect visuals are now deliberately strong (60% Chamo, four-echo trail, 3-tile blink, rainbow Prism ring, bounce/dust boots, glow sparks), but still use canvas primitives rather than bespoke art.
- Effect items can be applied to the player or an active companion from the backpack target picker; stabled companions remain readable/unequippable from the same list.
- Fetch auto-packs on ball return without a reward settlement.
- NPC-vs-NPC checkers/chess remain deferred.
- Behaviors use the existing animation families; style-specific follow cadence is data-tunable but not yet bespoke art.
- No audio, reduced-motion setting, or live-session persistence (as scoped).

**Tester entry points**

- Backpack: equip/unequip effects, throw ball, unfurl table games.
- Debug: grant all effects, trigger NPC Tic-Tac-Toe, inspect host/behavior state.
- Console: `window.playPark.getDebugState()`, `window.playPark.host`, `window.playPark.behaviorRuntime`.
