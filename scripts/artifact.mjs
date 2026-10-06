// Makes dist/artifact.html: a body fragment with <title> first (claude.ai artifact pages scan the first 8 KB for it)
// and the inlined bundle moved to the end.
import fs from "node:fs";
let html = fs.readFileSync("dist/index.html", "utf8");
html = html.replace(/<!doctype html>|<\/?(html|head|body)[^>]*>/gi, "");
const scripts = [];
html = html.replace(/<script\b[\s\S]*?<\/script>/g, (m) => { scripts.push(m); return ""; });
fs.writeFileSync("dist/artifact.html", html.trim() + "\n" + scripts.join("\n") + "\n");
console.log("dist/artifact.html", (fs.statSync("dist/artifact.html").size / 1e6).toFixed(2), "MB");
