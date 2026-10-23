# Play Park

A tiny browser playground at [pp.livive.net](https://pp.livive.net). A 64 × 64 tile park,
locally generated **DiceBear Voxel Art** characters, and a crowd of wandering neighbours.

Everything runs in the browser. DiceBear is vendored into `vendor/dicebear-voxel.js`, so
avatar generation makes **no network requests at runtime**. The site is plain HTML, CSS,
and ES modules — there is no build step to serve it.

## Features

- **Seeded 64 × 64 park** — grass, dirt paths, sand, ponds, and flower fields.
- **Follow camera and minimap** — the world is larger than the viewport; the minimap shows
  your position, neighbours, and the visible area.
- **Local character creator** — generate a DiceBear Voxel Art character from a seed and
  customise hair, outfit, glasses, beard, skin, and clothing colours.
- **Neighbour generator** — roll a crowd, reroll individuals, and add more later.
- **Tile-based collision** — no two characters can occupy the same tile, including while
  one of them is moving. Movement destinations are reserved.
- **Bump-to-talk dialogue** — walking into a neighbour pauses the park and starts a short
  conversation with a Yes / No choice.
- **Friend list** — a live `Friends n/m` counter and a panel listing everyone you've
  friended.
- **Wander AI** — neighbours stroll around, avoid water and each other, and pause
  automatically during dialogue.
- **Keyboard and click movement** — WASD/arrow keys, or click a tile to pathfind there.
- **Autosave** — the park, characters, positions, and friendships persist in
  `localStorage`.

## Quick start

```sh
npm start
```

Open <http://localhost:4173>. No install or build is required to run the site.

To run the tests:

```sh
npm test
```

To rebuild the local DiceBear bundle (only needed after changing its entry point or
upgrading the package):

```sh
npm install
npm run vendor
```

Requires Node.js 20 or newer for the tooling; the game itself only needs a modern browser.

## Controls

| Action | Input |
| --- | --- |
| Walk | `WASD` or arrow keys |
| Walk to a tile | Click the ground |
| Inspect a character | Click them |
| Talk | Walk into them |
| Close a panel or dialogue | `Escape` |
| Pause/start wandering | **Wander on/off** |
| Add a neighbour | **+ Neighbour** |
| View friends | **Friends n/m** |

## How it works

```text
index.html              Canvas, HUD, setup wizard, dialogue, friend list
css/app.css             Layout, panels, responsive rules
src/main.js             App state, wizard, dialogue/friends UI, persistence
src/game.js             Camera, rendering loop, movement, collision, NPC AI
src/world.js            Seeded world generation, terrain encoding, pathfinding
src/avatar.js           DiceBear recipes, local SVG generation, image cache
src/characters.js       Pure tile-occupancy and reservation helpers
src/facing.js           Direction mapping and left/right mirroring
src/names.js            Neighbour names and flavour text
vendor-src/dicebear.js  Entry point for the vendored bundle
vendor/dicebear-voxel.js Generated DiceBear + Voxel Art bundle (committed)
test/                   Node test runner suites for pure logic
```

### Characters

A character is stored as a compact recipe:

```js
{
  seed: 'clover-4pxbyrw',
  look: {
    top: 'random',
    outfit: 'hoodie',
    glasses: 'none',
    beard: 'random',
    skin: '#c08457',
    hair: '#241a14',
    shirt: '#f76707',
    pants: '#2f4160',
    shoes: '#6741d9'
  }
}
```

The recipe is passed to the bundled DiceBear renderer to produce a deterministic SVG,
which is cached as a data URL and drawn onto the canvas. No uploaded images are stored.

### World and save format

`generateWorld(seed)` creates the terrain deterministically from a seed. The save format
stores the terrain compactly as a 4,096-character string (`g`, `d`, `s`, `w`, `f` for
grass, dirt, sand, water, field) plus character recipes, positions, friendships, and the
wander flag. State is saved under `playpark.save.v1` in `localStorage`.

### Collision rules

- A character on a tile occupies it.
- A moving character also reserves its destination tile.
- Player steps and NPC steps are rejected if either tile is reserved by someone else.
- Bumping into an NPC starts a dialogue instead of moving into their tile.

## Tests

The pure logic is tested with Node's built-in test runner:

```sh
npm test
```

Coverage includes world generation, terrain round-tripping, pathfinding, blocked paths,
tile reservation/collision helpers, facing/mirroring rules, avatar determinism, and name
generation. `src/game.js` is intentionally import-safe in Node so the module can at least
be smoke-tested without a browser.

## DiceBear attribution

The [Voxel Art](https://www.dicebear.com/styles/voxel-art/) style is by
[DiceBear](https://www.dicebear.com) and licensed under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The vendored bundle is
generated from `@dicebear/core` and `@dicebear/styles` in `vendor-src/dicebear.js`.

## Deployment

The site is static and can be served from the repository root. The `CNAME` file points
GitHub Pages at `pp.livive.net`. Pushes to `main` are the only deployment step.

## License

The application code is MIT licensed. See [LICENSE](LICENSE).
