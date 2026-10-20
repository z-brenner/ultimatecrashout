# Ultimate Crashout

<p align="center">
  <strong>A browser platform fighter where fighters and stages are drop-in content packs.</strong>
</p>

<p align="center">
  <a href="https://github.com/z-brenner/ultimatecrashout/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/z-brenner/ultimatecrashout/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/code-MIT-4d8cff"></a>
</p>

![Gameplay on Verdant Grove](docs/media/gameplay.webp)

Ultimate Crashout is a fast local platform fighter that runs in a desktop
browser. The engine supports keyboard and controllers, configurable controls,
CPU opponents, shields, rolls, air dodges, grabs, throws, ledges, projectiles,
items, stock matches, timed matches, and sudden death.

Its defining feature is the content system: a fighter or stage lives in one
folder, is validated by the project tools, and joins the game, including the
character and stage select screens, without any engine edit.

> [!IMPORTANT]
> Multiplayer is **local only**: two players on one machine (keyboard and/or
> controllers) or one player against the CPU. There is no online play.

## Project status

The current public preview is a playable foundation, not a finished competitive
game. It includes:

- Buckle, an original fighter with all 50 animations and authored moves;
- 14 open-licensed fighter prototypes;
- one CC0 stage;
- 20 original items and a redistributable audio library;
- local multiplayer, CPU play, configurable controls, and controller support;
- fighter and stage pack generators, validators, and an Animation Lab;
- automated public-content, history, test, build, and performance checks.

See [docs/ULTIMATE_CRASHOUT_PLAN.md](docs/ULTIMATE_CRASHOUT_PLAN.md) for the
current plan, known limitations, and technical debt.

## Project origin

Ultimate Crashout is a fork of [Super Bash Folds](https://github.com/Swarek/Super_Bash_Folds)
by Swarek and contributors (MIT). Its engine, content-pack tooling, generated
interface art, and original item art come from that project; see
[LICENSE](LICENSE), [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md), and the
per-asset provenance records.

## Play or run locally

Install Node.js 20.19+ or 22.12+:

```sh
git clone https://github.com/z-brenner/ultimatecrashout.git
cd ultimatecrashout
npm ci
npm run dev
```

Vite prints the local address, which defaults to
[`http://localhost:4173/`](http://localhost:4173/).

Default keyboard controls: P1 moves with **WASD**, jumps with **H**, attacks
with **F**, specials with **G**, shields with **R**, grabs with **T**. P2 uses
the **arrow keys**, **;**, **K**, **L**, **O**, **P**. **Esc** pauses. Any
standard controller works and can be rebound under *Controls*. During a match,
**F9** toggles the hitbox overlay.

## Build and deploy

```sh
npm run build        # type-check, bundle to dist/, verify budgets and assets
npm run preview      # serve dist/ locally
```

`dist/` is a fully static site with no server-side code, built with relative
URLs, so the same build works at a domain root or under any sub-path (for
example a GitHub Pages project site at `user.github.io/ultimatecrashout/`).
Upload the contents of `dist/` as-is. If a host requires absolute URLs, build
with an explicit prefix instead:

```sh
UC_BASE_PATH=/games/crashout/ npm run build
```

The browser tests (`npm run test:e2e`) serve the build under
`/ultimatecrashout/` and fail on any request outside that path; set
`E2E_BASE_PATH=/` to test the domain-root case.

## Choose a contribution

| If you enjoy… | A useful first contribution |
| --- | --- |
| Character art or animation | Help design and animate the first flagship original fighter |
| Game design | Review a move set, hitboxes, knockback, and competitive counterplay |
| TypeScript | Improve pack tooling, engine mechanics, accessibility, or tests |
| Level art | Create a redistributable stage pack |
| Playing platform fighters | Test controllers, movement, match rules, and report reproducible issues |
| Documentation | Turn one pack workflow into a smaller, clearer tutorial |

Start with the [contribution guide](CONTRIBUTING.md), browse
[`good first issue`](https://github.com/z-brenner/ultimatecrashout/issues?q=is%3Aissue+state%3Aopen+label%3A%22good+first+issue%22),
or propose an idea in
[GitHub Discussions](https://github.com/z-brenner/ultimatecrashout/discussions).
The current direction is tracked in [ROADMAP.md](ROADMAP.md).

## Add a fighter

```sh
npm run fighter:new -- my-fighter --kind 2d
# complete fighters/my-fighter/fighter.json and render.json
npm run fighter:build -- my-fighter
npm run fighter:check
```

The pack directory is the source of truth. The project generates registries,
render manifests, portraits, and atlases from it. The 50-animation contract,
licensing rules, and troubleshooting steps are documented in
[`fighters/README.md`](fighters/README.md).

## Add a stage

```sh
npm run stage:new -- my-stage --kind 2d
# complete stages/my-stage/stage.json, PROVENANCE.md, and assets/
npm run stage:build
npm run stage:check
```

A stage pack owns its collisions, ledges, spawn points, blast zone, rendering,
and license metadata. See [`stages/README.md`](stages/README.md).

## Verify a contribution

Install the tools reported by `npm run content:doctor`, then run the check
closest to your change while iterating. Before opening a pull request, run:

```sh
npm run validate:public
```

This command validates packs and asset policy, runs the public test suite,
checks Git history, builds the game, and verifies the distributable output and
performance budgets.

## Licenses and provenance

- Code: [MIT](LICENSE).
- Original project assets under `public/assets/open/`: CC0-1.0.
- Third-party assets: [credits, licenses, and source links](THIRD_PARTY_ASSETS.md).
- Asset contributions: [asset policy](ASSET_POLICY.md).
- Naming and content boundaries: [IP and content policy](IP_AND_CONTENT_POLICY.md).

Every distributed asset must have a verifiable source and compatible license.
Generated files must not be edited directly.

## Community

Please read the [Code of Conduct](CODE_OF_CONDUCT.md). Use
[Discussions](https://github.com/z-brenner/ultimatecrashout/discussions) for ideas
and design questions, and [Issues](https://github.com/z-brenner/ultimatecrashout/issues)
for reproducible bugs or accepted work.
