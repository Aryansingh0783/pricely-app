/* Inline every source into one self-contained dist/index.html.
   Why a build step at all: the engine must exist exactly ONCE. The prototype
   needs to run from file:// (no server, no npm), and file:// blocks ES module
   imports — so we inline rather than duplicate. One source of truth, two
   consumers: node tests import the module, the browser gets the inlined copy. */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(root, "src", f), "utf8");

/** Turn an ES module into plain script source + the list of names it exports. */
function demodule(code) {
  const names = [];
  const re = /^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(code))) names.push(m[1]);
  const body = code
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export\s+/gm, "");
  return { body, names };
}

const engine = demodule(src("engine.mjs"));
const seed = demodule(src("seed.mjs"));
const all = [...new Set([...engine.names, ...seed.names])];

const bundle =
  `/* Pricely engine bundle. Do not edit — source lives in src/engine.mjs. */\n` +
  `var NS = (function () {\n${engine.body}\n${seed.body}\n` +
  `return { ${all.join(", ")} };\n})();\n`;

const html = src("app.template.html")
  .replace("/*__TOKENS__*/", () => src("tokens.css"))
  .replace("/*__APPCSS__*/", () => src("app.css"))
  .replace("/*__ENGINE__*/", () => bundle)
  .replace("/*__APPJS__*/", () => src("app.js"));

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "index.html"), html);
for (const f of ["manifest.webmanifest", "sw.js"]) {
  copyFileSync(join(root, "public", f), join(root, "dist", f));
}

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`built dist/index.html  ${kb(html.length)}`);
console.log(`  engine exports:  ${all.length}`);
console.log(`  products ${(src("seed.mjs").match(/^\s*P\(/gm) || []).length}, services ${(src("seed.mjs").match(/^\s*id: "/gm) || []).length}`);
