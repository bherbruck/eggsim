# Egg Belt Simulator

**Live:** https://bherbruck.github.io/eggsim/ · original 2D prototype: https://bherbruck.github.io/eggsim/2d/

Synthetic overhead camera feed of eggs on a conveyor, with physics (Three.js + Rapier) and pixel-accurate
ground truth for detection, rotated-box, segmentation and tracking models. The original 2D canvas prototype
is in `legacy-2d/`.

```bash
npm install
npm run dev            # live app at http://localhost:5173
npm run build          # dist/index.html, a single self-contained file
npm run artifact       # also writes dist/artifact.html for claude.ai publishing
```

## Export a dataset

```bash
npm run build
node scripts/export.mjs --frames 500 --preset jam --format seg --out data/jam
node scripts/export.mjs --frames 300 --settings my-profile.json --format obb --gpu
```

- `--format detect | obb | seg` picks the YOLO label layout. `data.yaml` is written for Ultralytics.
- `--settings` takes the JSON from **Copy settings JSON** in the app; `--set k=v,...` overrides single values.
- `--sequences K` renders K runs with different seeds; the last one becomes the val split.
- Every frame also gets `json/<seq>/<frame>.json` (bbox, rotated box, all polygons, egg size, velocity,
  rolling, stacked) and `mot/<seq>/gt/gt.txt` for tracker evaluation.
- Labels come from an ID render, so they cover only the visible part of each object. Dirt patches are
  separate `dirt` objects with a `parent` egg id.
- Without `--gpu`, Chromium renders in software at roughly 0.5 frames per second.
