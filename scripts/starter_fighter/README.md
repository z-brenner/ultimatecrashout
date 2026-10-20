# Starter fighter art

`generate_sprites.py` draws **Buckle**, the original Ultimate Crashout starter
fighter, from a small procedural skeleton. Every frame is reproducible from the
script, so the art carries no third-party rights and is published as CC0-1.0.

```sh
python3 -m pip install Pillow     # once
python3 scripts/starter_fighter/generate_sprites.py
npm run fighter:build -- buckle
```

Poses are keyframed per animation slot inside `build()`. Joint angles are in
degrees from straight down; positive values rotate toward the facing direction
and a positive `torso` leans forward. Treat it as placeholder art and a worked
example of the sprite-strip workflow: replacing `fighters/buckle/sprites/*.png`
with hand-drawn strips of the same names needs no code change.
