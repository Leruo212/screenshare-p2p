#!/usr/bin/env node
// Build script: inlines styles.css and src/*.js into screenshare.template.html.
// Pure ESM, no dependencies, no build step needed to run.
//
// CLI: node build.js [outputPath]
//   - Reads screenshare.template.html, styles.css, src/*.js from cwd.
//   - Writes screenshare.html (or the given outputPath) to cwd.
//
// Importable: import { build } from './build.js'; build({ ...paths })
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function readText(path) {
  return readFileSync(path, 'utf8');
}

function readSrcScripts(srcDir) {
  const files = readdirSync(srcDir)
    .filter((name) => name.endsWith('.js'))
    .sort();
  return files
    .map((name) => `// === ${name} ===\n` + readText(join(srcDir, name)))
    .join('\n');
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
  const scripts = readSrcScripts(src);

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
