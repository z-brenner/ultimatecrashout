# Add a stage pack

An open stage lives entirely in `stages/<id>/`. The manifest describes the
deterministic geometry used by the engine, while the files in `assets/` provide
its visuals. Once the pack is marked `ready`, the registry, the `StageId` type,
the selection menu, and the Test Lab are synchronized without manual changes
under `src/`.

## Quick start

```sh
npm run stage:new -- my-stage --kind 2d
# complete stage.json and PROVENANCE.md, add preview.png, arena.webp, backdrop.webp
npm run stage:build -- my-stage   # derives preview.thumb.webp and SHA256SUMS
npm run stage:check
```

`stage:build -- <id>` needs `cwebp` (see `npm run content:doctor`). Without an
id, `stage:build` only re-syncs the registry; `npm run dev` does that by itself
whenever a `stage.json` is saved. [`crash-course`](crash-course/)
is a complete original reference pack; its art is drawn by
`scripts/starter_stage/generate_crash_course.py`.

A draft is intentionally excluded from the game. The build still requires at
least one other `ready` pack because a match always needs a default stage.

Image and scene size limits are centralized in `stages/pipeline.config.json` so
contributions remain fast to load without burying those limits in the script.

## Pack contents

```text
stages/my-stage/
├── stage.json
├── PROVENANCE.md
├── LICENSE.txt        # copy of the upstream license, when provided
├── SHA256SUMS
└── assets/
    ├── preview.png
    ├── preview.thumb.webp
    ├── arena.webp
    ├── backdrop.webp
    └── scene.glb          # only for kind: 3d
```

Manifest paths are relative to the pack. Absolute paths, remote URLs, `..`
traversals, and symbolic links are rejected. Vite imports these files; never
copy them into `public/assets/stages/`, which is reserved for the local private
overlay.

## Geometry

Gameplay coordinates use world units. A `ground` platform is solid on every
side; a `platform` can be passed through from below or with a downward input.
The pack must provide exactly one solid platform named `main`. Ledges are
declared explicitly and must reference a `ground` platform.

`render.art` maps the `arena` image to the world: `originPx` is the pixel that
represents the `(0, 0)` origin, and `worldUnitsPerPixel` defines the scale. The
blast zone must surround the platforms and both spawn points.

### Smash proportions

The engine runs Melee physics: one Melee unit is 7.80 world units across and
6.79 up (`MELEE_HORIZONTAL_WORLD_SCALE`, `MELEE_VERTICAL_WORLD_SCALE`). To
lay out a stage that plays like Smash, design it in Melee units and convert.
Melee's Battlefield is a good reference:

| | Battlefield (Melee units) | In world units |
| --- | --- | --- |
| Main stage edges | x = ±68.4 | ±533 |
| Side platforms | top y = 27.2, x from ±20 to ±57.6 | 185, ±156 to ±449 |
| Top platform | top y = 54.4, x = ±18.8 | 369, ±147 |
| Blast lines | x = ±224, top 200, bottom −108.8 | ±1747, 1357, −738 |
| Spawns | under the side platforms | |

Fighters are 11–16 Melee units tall (78–105 world units), so a fighter is
about half a side platform's height, as in Smash. Verdant Grove is about
Final Destination's width (edges at ±91 Melee units) with Battlefield's
platforms.

### Camera

The camera frames the fighters as Smash does: in close when they are close,
out as they separate, keeping the ground in view while they are near it. It
never leaves the stage's camera range, which sits inside the blast zone (in
from each side by 10% of its width, from the top by 9% and the bottom by 10%
of its height; a 3D stage's range also stops at its art, where its model
ends); a fighter beyond it shows in a magnifying bubble at the screen edge.
Framing is defined for a 1280×720 view and scaled by the limiting dimension,
so every window size sees the same part of the stage (wider windows see more
to the sides, narrower ones more above and below).

## 2D and 3D rendering

All four images are required for every pack. A 2D stage draws `backdrop` in
world space at the arena's calibration and `arena` over it. Beyond the arena,
the backdrop repeats mirrored tile by tile, and the top and bottom rows of
both images carry on to the screen edges, so the scene continues without a
seam however far the camera goes. That only works if `backdrop` is the arena
scene without the stage: the same size, with its left, right, and top edges
matching the arena's. A 3D stage also provides `render.scene`; if WebGL or the GLB
fails, the same images provide the fallback.

Packs cannot provide executable code. Moving platforms and hazards are
audited, data-driven engine mechanics (below); anything else needs a new one.

## Moving platforms

Give a one-way platform (`kind: "platform"`, not `main`) a `motion`:

```json
{ "id": "top", "x": -260, "y": 330, "width": 300, "height": 24, "kind": "platform",
  "motion": {
    "path": [{ "x": -260, "y": 330 }, { "x": 260, "y": 330 }],
    "periodFrames": 480,
    "easing": "sine",
    "sprite": "assets/top-platform.png"
  } }
```

- The centre travels the `path` (2-8 points) and back once per `periodFrames`
  (`"mode": "pingpong"`, the default; `"easing": "sine"` slows into each
  end), or around the path and straight back to its start (`"mode": "loop"`).
  `phaseFrames` offsets the start. `x`/`y` must be where it is on frame 0.
- Position depends only on the match frame, so matches replay identically.
  Fighters and items standing on it ride along, and a platform rising into a
  falling fighter catches them.
- Limits keep it fair and robust: at most 12 world units per frame (the
  build reports the actual peak), inside the blast zone along the whole path,
  flat (no `surfaceY`), and never a ledge.
- Leave moving platforms out of `arena`. The game draws `sprite` (in
  `assets/`, at the arena's pixel scale, top row on the walking surface), or
  a slab in the stage `colors` when there is none. List the sprite in
  `SHA256SUMS`; `stage:build -- <id>` does that for you.

## Hazards

```json
"hazards": [{
  "id": "laser-gate",
  "kind": "zone",
  "area": { "x": 0, "y": 125, "width": 36, "height": 250 },
  "schedule": { "periodFrames": 900, "warningFrames": 90, "activeFrames": 60, "phaseFrames": 300 },
  "hit": { "damage": 14, "angle": 60, "baseKnockback": 55, "knockbackGrowth": 0.75, "mirrorX": true },
  "color": "#ff3b3b"
}]
```

- Each period ends with a visible warning (at least 30 frames) and then the
  active window. A fighter inside the zone while it is active is launched
  once per activation with the authored `hit` (`angle` in degrees, 0 = right,
  90 = up; `mirrorX` launches fighters on the left side leftward).
- Intangibility (dodges, respawn invincibility) avoids it; shields and super
  armor do not. A hazard KO keeps the last attacker's KO credit.
- Players can turn hazards off with the **Hazards** switch on the stage
  select screen. Moving platforms always move: they are part of the layout.
- CPU fighters step out of live zones; levels 2 and 3 already react to the
  warning.

Tune in the Lab: the **Collisions** overlay draws each moving platform's path
and every hazard zone over the arena art. Crash Course (`crash-course/`) uses
both mechanics; `scripts/starter_stage/generate_crash_course.py` draws its
moving-platform sprite.

## License and provenance

Use only sources with explicit redistribution and modification rights.
`stage.json`, `PROVENANCE.md`, and `SHA256SUMS` must remain consistent. The
validator checks the runtime files, but the author remains responsible for
verifying the source license.

## Commands

```sh
npm run stage:build  # validate and regenerate openStageRegistry.ts
npm run stage:build -- <id>  # also derive that pack's thumbnail and SHA256SUMS
npm run stage:check  # also verify that the registry is not stale
```
