// End-to-end check of the MCP server: sessions, captures, ids, visible-only filtering, instance masks.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const client = new Client({ name: "eggsim-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["scripts/mcp-server.mjs"] }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(name + ": " + r.content[0].text);
  return r;
};
const json = (r) => JSON.parse(r.content.find((c) => c.type === "text").text);
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };

const tools = (await client.listTools()).tools.map((t) => t.name);
ok(tools.length === 8, "8 tools: " + tools.join(", "));
const start = json(await call("start_session", { preset: "jam", seed: 3, settings: { labelMinVisible: 0.25, labelMinPx: 100, eggClasses: "split", dirty: 0.3 } }));
ok(!!start.session_id, `session ${start.session_id} on ${start.renderer}, classes ${start.classes.join(",")}`);

const f1 = json(await call("capture_frame", { session_id: start.session_id, advance_seconds: 1, include_image: false }));
const f2 = json(await call("capture_frame", { session_id: start.session_id, advance_seconds: 0.2, include_image: false }));
const ids1 = new Set(f1.objects.filter((o) => o.class !== "dirt").map((o) => o.track_id));
const shared = f2.objects.filter((o) => ids1.has(o.track_id)).length;
ok(f2.frame_index === f1.frame_index + 1 && f2.session_id === f1.session_id, `frame_index ${f1.frame_index} -> ${f2.frame_index}, same session`);
ok(shared > 3, `${shared} track_ids carried over between frames`);
const eggs = f2.objects.filter((o) => o.class === "egg" || o.class === "dirty_egg");
ok(eggs.every((o) => o.visible_fraction >= 0.25 && o.area_px >= 100), `all ${eggs.length} eggs meet visibility >= 25% and >= 100 px (min ${Math.min(...eggs.map((o) => o.visible_fraction))})`);
const inst = f2.objects.filter((o) => o.instance_id).map((o) => o.instance_id).sort((a, b) => a - b);
ok(inst.every((v, i) => v === i + 1), `instance_ids are 1..${inst.length}`);
const dirt = f2.objects.filter((o) => o.class === "dirt");
ok(dirt.every((d) => f2.objects.some((o) => o.instance_id === d.parent_instance_id)), `${dirt.length} dirt patches all point at a labeled parent egg`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eggsim-mcp-"));
const saved = json(await call("capture_frame", { session_id: start.session_id, include_mask: true, save_dir: dir, yolo_format: "seg" }));
ok(fs.existsSync(saved.files.image) && fs.existsSync(saved.files.mask) && fs.existsSync(saved.files.yolo), "save_dir wrote png, mask and yolo txt");
const inline = await call("capture_frame", { session_id: start.session_id, include_labels: false });
const img = inline.content.find((c) => c.type === "image");
ok(img && img.data.length < 400000, `inline preview image ${(img.data.length / 1024).toFixed(0)} KB base64`);
console.log("saved:", JSON.stringify(saved.files));
await call("end_session", { session_id: start.session_id });
await client.close();
