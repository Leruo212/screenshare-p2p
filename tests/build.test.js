import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const buildScript = join(projectRoot, 'build.js');

describe('build.js (template inliner)', () => {
  let workDir;
  let outFile;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'screenshare-build-test-'));
    outFile = join(workDir, 'screenshare.html');

    // Minimal source layout for the build to consume
    const srcDir = join(workDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'app.js'), "console.log('STUB_APP_JS_MARKER');\n");
    writeFileSync(join(srcDir, 'a-first.js'), "// A_FIRST_MODULE_MARKER\n");

    writeFileSync(join(workDir, 'styles.css'), 'body { font-family: sans-serif; }\n');
    writeFileSync(
      join(workDir, 'screenshare.template.html'),
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ScreenShare P2P</title>
  <style>/* __CSS__ */</style>
</head>
<body>
  <div id="app">App</div>
  <script>/* __SCRIPTS__ */</script>
</body>
</html>
`
    );

    const result = spawnSync('node', [buildScript, outFile], {
      cwd: workDir,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `build.js exited with status ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );
    }
  });

  afterAll(() => {
    if (workDir && existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('produces an output file at the given path', () => {
    expect(existsSync(outFile)).toBe(true);
  });

  it('produces valid HTML (has <!DOCTYPE html>, <html>, </html>)', () => {
    const html = readFileSync(outFile, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('inlines the CSS content from styles.css', () => {
    const html = readFileSync(outFile, 'utf8');
    expect(html).toContain('body { font-family: sans-serif; }');
    expect(html).not.toContain('/* __CSS__ */');
  });

  it('inlines every src/*.js file in alphabetical order', () => {
    const html = readFileSync(outFile, 'utf8');
    expect(html).toContain('A_FIRST_MODULE_MARKER');
    expect(html).toContain('STUB_APP_JS_MARKER');
    // a-first.js comes before app.js alphabetically
    expect(html.indexOf('A_FIRST_MODULE_MARKER')).toBeLessThan(
      html.indexOf('STUB_APP_JS_MARKER')
    );
    expect(html).not.toContain('/* __SCRIPTS__ */');
  });

  it('uses a plain (non-module) script tag', () => {
    const html = readFileSync(outFile, 'utf8');
    // Should be <script>...</script>, NOT <script type="module">
    expect(/<script(?![^>]*type=["']module["'])[^>]*>/.test(html)).toBe(true);
  });
});

describe('build.js (ESM → classic script transform)', () => {
  // The build must turn ES module syntax into plain script so the bundle
  // works from file:// (where Chrome blocks <script type="module"> without
  // a flag). This is the test for that transform.
  it('strips `import { ... } from "./x.js"` and rewrites to local destructure (with `as` → `:` for JS compat)', async () => {
    const { transform } = await import('../build.js');
    const out = transform(
      `import { a, b as c } from './foo.js';\nconsole.log(a, c);\n`,
      'bar.js',
    );
    expect(out).not.toMatch(/^import /m);
    // `b as c` is Python-style; JS destructuring needs `b: c`.
    expect(out).toContain('const { a, b: c } = __foo');
    expect(out).toContain('console.log(a, c)');
  });

  it('strips `export function` and registers the name on the module binding', async () => {
    const { transform } = await import('../build.js');
    const out = transform(
      `export function greet() { return 'hi'; }\n`,
      'm.js',
    );
    expect(out).not.toMatch(/^export /m);
    expect(out).toContain('function greet()');
    expect(out).toContain('__m.greet = greet');
  });

  it('strips `export const` and registers the name on the module binding', async () => {
    const { transform } = await import('../build.js');
    const out = transform(
      `export const X = 42;\n`,
      'm.js',
    );
    expect(out).toContain('const X = 42');
    expect(out).toContain('__m.X = X');
  });
});
