#!/usr/bin/env node
// Build script: bundles ESM source modules into a single non-module script
// and inlines it + styles.css into screenshare.template.html.
//
// Why not just <script type="module">: ES modules loaded from file:// have
// CORS restrictions in Chrome (require --allow-file-access-from-files), and
// the user wants the file to work via double-click with no flags. So we
// transform the modules into a single classic script at build time.
//
// Pure ESM, no dependencies, no bundler.
//
// Transform rules (sufficient for our small codebase):
//   import { a, b as c } from './foo.js'  →  const { a, c } = __foo;
//   export function name(...)            →  function name(...)
//                                            + __this.name = name;
//   export const name = ...              →  const name = ...
//                                            + __this.name = name;
//   export class Foo {}                  →  class Foo {}
//                                            + __this.Foo = Foo;
//   export { a, b }                      →  __this.a = a; __this.b = b;
//
// Each file's body is wrapped in an IIFE that assigns its exports to a
// top-level `__<modname>` binding. All bindings are pre-declared with `var`
// at the top of the bundle so files can reference each other regardless of
// alphabetical order.
//
// CLI: node build.js [outputPath]
// Importable: import { build } from './build.js'; build({ ...paths })

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, isAbsolute, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function readText(path) {
  return readFileSync(path, 'utf8');
}

// ---- Module transform -------------------------------------------------------

// Map from import path like './room-id.js' to the module's local binding
// (e.g., '__room_id').
function localNameFor(file) {
  return '__' + basename(file, extname(file)).replace(/[^a-zA-Z0-9_]/g, '_');
}

// Strip ESM syntax and rewrite into classic-script equivalents.
// Returns the transformed source plus a list of exported names that the
// caller will append as `__this.X = X;` assignments inside the IIFE.
// Exported for tests; called by bundleSrc.
export function transform(source, fromFile) {
  const self = localNameFor(fromFile);
  const exports = [];

  // 1) Rewrite import statements.
  //    import { a, b as c } from './foo.js';
  //    → const { a, b: c } = __foo;   (JS uses ':' for alias, not 'as')
  let out = source.replace(
    /^[ \t]*import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm,
    (_m, names, spec) => {
      const target = spec.replace(/^\.\//, '').replace(/\.js$/, '');
      const local = '__' + target.replace(/[^a-zA-Z0-9_]/g, '_');
      // Normalize "x as y" → "x: y" (Python-style alias → JS-style alias)
      const jsNames = names
        .trim()
        .split(',')
        .map((s) => {
          const t = s.trim();
          const m = t.match(/^(\S+)\s+as\s+(\S+)$/);
          return m ? `${m[1]}: ${m[2]}` : t;
        })
        .join(', ');
      return `const { ${jsNames} } = ${local};`;
    },
  );

  // 2) Rewrite `export function name(...)` → `function name(...)` and capture.
  out = out.replace(
    /^[ \t]*export\s+function\s+([A-Za-z_$][\w$]*)/gm,
    (_m, name) => {
      exports.push(name);
      return `function ${name}`;
    },
  );

  // 3) Rewrite `export const|let|var name = ...` and capture.
  out = out.replace(
    /^[ \t]*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    (_m, kw, name) => {
      exports.push(name);
      return `${kw} ${name}`;
    },
  );

  // 4) Rewrite `export class Foo {}` and capture.
  out = out.replace(
    /^[ \t]*export\s+class\s+([A-Za-z_$][\w$]*)/gm,
    (_m, name) => {
      exports.push(name);
      return `class ${name}`;
    },
  );

  // 5) Strip `export { a, b, c };` (we'll re-add the assignments ourselves).
  out = out.replace(/^[ \t]*export\s*\{[^}]+\}\s*;?[ \t]*$/gm, '');

  // Build the IIFE body. The original file's top-level code runs, then we
  // attach the captured exports to the module's local binding.
  const exportLines = exports.map((n) => `  ${self}.${n} = ${n};`).join('\n');
  // Initialize the module binding as an empty object BEFORE the body runs,
  // so any property assignments later in the IIFE have something to attach
  // to (the top-level `var` declaration leaves it `undefined`).
  const wrapped = `(function() {\n${self} = {};\n${out}\n${exportLines}\n})();`;

  return wrapped;
}

// Read all src/*.js files, transform each, and emit them in an order that
// ensures cross-references resolve at runtime.
//
// File naming convention:
//   - Library modules (anything NOT named `app.js`) come first, in
//     alphabetical order. They only DEFINE exports; their IIFEs run early
//     and populate their `__<name>` binding.
//   - `app.js` is the entry point. Its IIFE runs LAST, so all imports it
//     references are guaranteed to be populated by then. (If `app.js` ran
//     first, the destructured imports would resolve to `undefined`.)
function bundleSrc(srcDir) {
  const files = readdirSync(srcDir)
    .filter((name) => name.endsWith('.js'))
    .sort();

  const libs = files.filter((n) => n !== 'app.js');
  const entry = files.find((n) => n === 'app.js');

  const bindings = files.map(localNameFor);
  const pre = `// Auto-generated bundle. Do not edit by hand.\nvar ${bindings.join(', ')};\n`;

  const libBodies = libs
    .map((name) => `// --- ${name} ---\n` + transform(readText(join(srcDir, name)), name))
    .join('\n');

  let entryBody = '';
  if (entry) {
    entryBody = '\n// --- entry: ' + entry + ' ---\n' + transform(readText(join(srcDir, entry)), entry);
  }

  return pre + libBodies + entryBody + '\n';
}

const CSS_PLACEHOLDER = '/* __CSS__ */';
const SCRIPTS_PLACEHOLDER = '/* __SCRIPTS__ */';

export function build({ templatePath, cssPath, srcDir, outputPath, baseDir = process.cwd() }) {
  const resolveIn = (p) => (isAbsolute(p) ? p : resolve(baseDir, p));

  const tpl = resolveIn(templatePath);
  const css = resolveIn(cssPath);
  const src = resolveIn(srcDir);
  const out = resolveIn(outputPath);

  let html = readText(tpl);
  const cssBody = readText(css);
  const scripts = bundleSrc(src);

  if (!html.includes(CSS_PLACEHOLDER)) {
    throw new Error(`Template missing CSS placeholder: ${CSS_PLACEHOLDER}`);
  }
  if (!html.includes(SCRIPTS_PLACEHOLDER)) {
    throw new Error(`Template missing scripts placeholder: ${SCRIPTS_PLACEHOLDER}`);
  }

  html = html.replace(CSS_PLACEHOLDER, cssBody);
  html = html.replace(SCRIPTS_PLACEHOLDER, scripts);

  writeFileSync(out, html, 'utf8');
  return out;
}

// CLI entry point
const isMain = (() => {
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
  } catch {
    return false;
  }
})();

if (isMain) {
  const cwd = process.cwd();
  const outputPath = process.argv[2] || 'screenshare.html';
  const result = build({
    templatePath: 'screenshare.template.html',
    cssPath: 'styles.css',
    srcDir: 'src',
    outputPath,
    baseDir: cwd,
  });
  console.log(`Built: ${result}`);
}
