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
