#!/usr/bin/env node
// MCP server (stdio) that lets agents drive the egg belt simulator: start sessions, step time,
// capture frames with pixel-accurate labels, and export whole datasets.
//
//   claude mcp add eggsim -- node /path/to/eggsim/scripts/mcp-server.mjs
//
// Env: EGGSIM_URL (page to load; defaults to dist/index.html, else the GitHub Pages copy),
//      EGGSIM_GPU=1 (use the real GPU instead of software rendering).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { launch, write, yoloLines, exportDataset } from "./lib/sim.mjs";

let simP = null;
const sim = () => (simP ??= launch());
const sessions = new Map();
const get = (id) => {
  const s = sessions.get(id);
  if (!s) throw new Error(`No session "${id}". Start one with start_session; open sessions: ${[...sessions.keys()].join(", ") || "none"}.`);
  return s;
};
const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });
const safe = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

const server = new McpServer({ name: "eggsim", version: "1.0.0" }, {
  instructions:
    "Egg belt simulator: a synthetic overhead camera on an egg conveyor with physics. " +
    "Typical flow: list_presets -> start_session (preset, settings, seed) -> step / capture_frame (repeat) -> end_session. " +
    "Labels cover only visible pixels; objects below labelMinPx / labelMinVisible are left out and visible_fraction says how much of each egg shows. " +
    "track_id is stable for a whole session, instance_id is 1..N within one frame and matches the instance mask. " +
    "For datasets use export_dataset, or capture_frame with save_dir, so images go to disk instead of the conversation.",
});

server.registerTool("list_presets", {
  description: "List the built-in scene presets (belt type, flow, lighting) by key and description.",
  inputSchema: {},
}, safe(async () => {
  const s = await (await sim()).session();
  try { return text(await s.presets()); } finally { await s.close(); }
}));

server.registerTool("describe_settings", {
  description: "Every simulator setting with its group, range or allowed values. Pass any of them in `settings`.",
  inputSchema: {},
}, safe(async () => {
  const s = await (await sim()).session();
  try { return text(await s.schema()); } finally { await s.close(); }
}));

server.registerTool("start_session", {
  description: "Start a simulation session. Returns session_id, image size and the class list for its label settings. Track ids restart per session.",
  inputSchema: {
    preset: z.string().optional().describe("Preset key from list_presets, e.g. jam, rod, tracker"),
    settings: z.record(z.any()).optional().describe("Setting overrides, e.g. {eggClasses: 'split', res: '1920x1080', labelMinVisible: 0.3}"),
    seed: z.number().int().optional().describe("Random seed; same preset + settings + seed reproduces the same scene"),
  },
}, safe(async ({ preset, settings, seed }) => {
  const s = await (await sim()).session({ preset, settings, seed });
  sessions.set(s.id, s);
  return text({ ...s.info, settings: undefined, renderer: s.renderer });
}));

server.registerTool("set_settings", {
  description: "Change settings in a running session without restarting it (lighting, camera, flow rate, label options...).",
  inputSchema: { session_id: z.string(), settings: z.record(z.any()) },
}, safe(async ({ session_id, settings }) => text(await get(session_id).set(settings))));

server.registerTool("step", {
  description: "Advance simulated time and render the next camera frame.",
  inputSchema: { session_id: z.string(), seconds: z.number().positive().max(600).default(1 / 30) },
}, safe(async ({ session_id, seconds }) => text(await get(session_id).step(seconds))));

server.registerTool("capture_frame", {
  description:
    "Capture the current frame: image plus visible-only labels (bbox_xywh, obb_xy, polygons, visible_fraction, track_id, instance_id). " +
    "With save_dir, files are written there (PNG, JSON, optional instance mask and YOLO txt) and only paths and a summary come back.",
  inputSchema: {
    session_id: z.string(),
    advance_seconds: z.number().min(0).max(600).default(0).describe("Step this much simulated time first"),
    include_image: z.boolean().default(true),
    include_labels: z.boolean().default(true),
    include_mask: z.boolean().default(false).describe("Instance mask PNG: red + 256 × green = instance_id"),
    include_ids: z.boolean().default(true).describe("session/track/instance ids on every object"),
    shapes: z.array(z.enum(["bbox", "obb", "polygon"])).default(["bbox", "obb", "polygon"]),
    preview_scale: z.number().min(0.1).max(1).default(0.5).describe("Inline image only: downscale to save context (labels stay full-res)"),
    save_dir: z.string().optional().describe("Write files here instead of returning the image inline"),
    yolo_format: z.enum(["detect", "obb", "seg"]).optional().describe("With save_dir: also write a YOLO label file"),
  },
}, safe(async (a) => {
  const s = get(a.session_id);
  if (a.advance_seconds > 0) await s.step(a.advance_seconds);
  const inline = a.include_image && !a.save_dir;
  const f = await s.capture({
    image: a.include_image, labels: a.include_labels || !!a.yolo_format, mask: a.include_mask, ids: a.include_ids,
    shapes: a.yolo_format ? ["bbox", "obb", "polygon"] : a.shapes,
    imageScale: inline ? a.preview_scale : 1, imageFormat: inline ? "jpeg" : "png",
  });
  const summary = {
    session_id: f.session_id, frame_index: f.frame_index, sim_time_s: f.sim_time_s, width: f.width, height: f.height, classes: f.classes,
    object_counts: (f.objects ?? []).reduce((m, o) => ((m[o.class] = (m[o.class] ?? 0) + 1), m), {}),
  };
  if (a.save_dir) {
    const dir = path.resolve(a.save_dir), base = `${f.session_id.slice(0, 8)}_${String(f.frame_index).padStart(6, "0")}`;
    const files = {};
    if (f.image) write((files.image = path.join(dir, base + ".png")), f.image);
    if (f.instance_mask) write((files.mask = path.join(dir, base + "_mask.png")), f.instance_mask);
    if (a.yolo_format) write((files.yolo = path.join(dir, base + ".txt")), yoloLines(f, a.yolo_format));
    const { image, instance_mask, ...json } = f;
    write((files.json = path.join(dir, base + ".json")), JSON.stringify(json));
    return text({ ...summary, files });
  }
  const content = [];
  if (f.image) content.push({ type: "image", data: f.image.toString("base64"), mimeType: "image/jpeg" });
  if (f.instance_mask) content.push({ type: "image", data: f.instance_mask.toString("base64"), mimeType: "image/png" });
  const { image, instance_mask, ...json } = f;
  content.push({ type: "text", text: JSON.stringify(a.include_labels ? json : summary) });
  return { content };
}));

server.registerTool("export_dataset", {
  description:
    "Render a whole labeled dataset to disk: YOLO images/labels + data.yaml, per-frame JSON with ids, MOT tracks, optional instance masks. " +
    "Each sequence is its own session and seed; the last is the val split. Software rendering runs at roughly 0.5 frames/s.",
  inputSchema: {
    out: z.string().describe("Output directory"),
    preset: z.string().optional(), settings: z.record(z.any()).optional(),
    frames: z.number().int().min(1).max(100000).default(200),
    interval: z.number().positive().default(0.5).describe("Simulated seconds between frames"),
    sequences: z.number().int().min(1).default(2),
    format: z.enum(["detect", "obb", "seg"]).default("seg"),
    masks: z.boolean().default(false),
  },
}, safe(async (a) => {
  const res = await exportDataset(await sim(), { ...a, out: path.resolve(a.out), mask: a.masks });
  return text(res);
}));

server.registerTool("end_session", {
  description: "Close a session and free its browser page.",
  inputSchema: { session_id: z.string() },
}, safe(async ({ session_id }) => { await get(session_id).close(); sessions.delete(session_id); return text({ closed: session_id }); }));

await server.connect(new StdioServerTransport());
const shutdown = async () => { try { await (await simP)?.close(); } catch {} process.exit(0); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown); process.stdin.on("close", shutdown);
