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

## Agents and programmatic access

Three ways in, all producing the same labels:

1. **MCP server** for Claude and other agents: `claude mcp add eggsim -- node /path/to/eggsim/scripts/mcp-server.mjs`
   (this repo's `.mcp.json` registers it automatically). Tools: `list_presets`, `describe_settings`,
   `start_session`, `set_settings`, `step`, `capture_frame`, `export_dataset`, `end_session`.
   `capture_frame` returns a downscaled preview inline, or writes full-resolution PNG, JSON, instance mask
   and YOLO txt with `save_dir`.
2. **Export CLI**: `node scripts/export.mjs` (above).
3. **In-page API** at `window.eggsim.api` (version 1) for browser automation:
   `startSession({preset, settings, seed})`, `set(settings)`, `step(seconds)`,
   `capture({image, labels, mask, ids, shapes, imageScale, imageFormat})`, `presets()`, `schema()`.

The page loaded is `dist/index.html` if built, otherwise the GitHub Pages copy; set `EGGSIM_URL` to override
and `EGGSIM_GPU=1` to render on the GPU.

### What a capture contains

- `session_id` (new per session) and `frame_index`.
- Per object: `class`, `class_id`, `track_id` (stable for the session), `instance_id` (1..N in this frame,
  equal to the value in the instance mask), `global_track_id` (`session_id:track_id`), `bbox_xywh`,
  `obb_xy`, `polygons`, `area_px`, `truncated`, `visible_fraction`, and egg size, velocity, rolling and
  stacked flags. Dirt patches carry `parent_track_id` and `parent_instance_id`. `ids: false` drops the ids.
- Instance mask PNG: red + 256 × green = `instance_id`, 0 = background.

### Visible only

Labels come from an ID render through the same lens distortion as the image, taken at mid-exposure so they
line up with motion blur. Anything covered by another egg, the gate, a feather or the frame edge is cut away.
`visible_fraction` is visible pixels over the egg's full projected outline. Objects under
`labelMinPx` (default 60 px) or `labelMinVisible` (default 15%) are left out of the labels; raise
`labelMinVisible` for cleaner detection sets, lower it if your model must find barely visible eggs.
