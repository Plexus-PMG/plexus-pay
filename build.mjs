// Build step: precompile app.jsx -> app.js (no @babel/standalone in the browser).
// Run this before every deploy:  node build.mjs   (then commit app.jsx + app.js + index.html, push)
// Edit the APP in app.jsx (JSX). index.html is the shell (CSS, logo, CDN libs, <script defer src="app.js">).
import esbuild from "esbuild";
import { readFileSync, writeFileSync } from "fs";
import crypto from "crypto";

const src = readFileSync("app.jsx", "utf8");
const out = await esbuild.transform(src, {
  loader: "jsx",
  jsx: "transform",                 // classic React.createElement (uses the global React from the CDN)
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  // target left at esnext: modern Apple browsers run it natively (same as the old data-presets="react")
});
if (out.warnings?.length) for (const w of out.warnings) console.warn("warn:", w.text);
writeFileSync("app.js", out.code);

const hash = crypto.createHash("sha1").update(out.code).digest("hex").slice(0, 8);
let html = readFileSync("index.html", "utf8");
html = html.replace(/app\.js\?v=[^"]*/g, "app.js?v=" + hash);
writeFileSync("index.html", html);

console.log("built app.js (" + out.code.length + " bytes), cache-bust v=" + hash);
