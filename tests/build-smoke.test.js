// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const buildScript = join(projectRoot, 'build.js');

describe('build smoke test (end-to-end production build)', () => {
  let workDir;
  let outFile;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'screenshare-build-smoke-'));
    outFile = join(workDir, 'screenshare.html');

    // Mirror the real project layout so the build sees the actual template,
    // css, and src/ files — no shortcuts, no inline strings.
    const srcDir = join(workDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    for (const f of [
      'app.js',
      'constraints.js',
      'peer-flow.js',
      'room-id.js',
      'state-machine.js',
      'ui-controller.js',
      'url.js',
    ]) {
      copyFileSync(join(projectRoot, 'src', f), join(srcDir, f));
    }
    copyFileSync(join(projectRoot, 'styles.css'), join(workDir, 'styles.css'));
    copyFileSync(
      join(projectRoot, 'screenshare.template.html'),
      join(workDir, 'screenshare.template.html')
    );

    const result = spawnSync('node', [buildScript, outFile], {
      cwd: workDir,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `build.js failed: status=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );
    }
  });

  afterAll(() => {
    if (workDir && existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('produces an output file', () => {
    expect(existsSync(outFile)).toBe(true);
  });

  it('output is at least 20KB (rough sanity check for content)', () => {
    const html = readFileSync(outFile, 'utf8');
    expect(html.length).toBeGreaterThan(20_000);
  });

  it('contains the required element IDs from the UI contract', () => {
    const html = readFileSync(outFile, 'utf8');
    const required = [
      'statusText',
      'statusDot',
      'errorToast',
      'shareLink',
      'remoteVideo',
      'createBtn',
      'joinBtn',
      'copyBtn',
      'startShareBtn',
      'stopShareBtn',
      'reconnectBtn',
      'landingPanel',
      'hostLobbyPanel',
      'viewerWaitingPanel',
      'viewerStreamPanel',
    ];
    for (const id of required) {
      // Match `id="<id>"` or `id='<id>'`
      const re = new RegExp(`id=["']${id}["']`);
      expect(html, `expected element id="${id}" in built HTML`).toMatch(re);
    }
  });

  it('contains the PeerJS <script> tag with a valid https URL', () => {
    const html = readFileSync(outFile, 'utf8');
    const m = html.match(/<script\s+src=["']([^"']+)["']\s*><\/script>/i);
    expect(m, 'expected at least one <script src=...> tag').toBeTruthy();
    expect(m[1]).toMatch(/^https:\/\//);
    expect(m[1]).toContain('peerjs');
  });

  it('contains an inline (non-module) <script> block with the inlined src code', () => {
    const html = readFileSync(outFile, 'utf8');
    // No <script type="module"> tags.
    expect(/<script[^>]*type=["']module["']/i.test(html)).toBe(false);
    // The CSS placeholder and scripts placeholder must both be gone.
    expect(html).not.toContain('/* __CSS__ */');
    expect(html).not.toContain('/* __SCRIPTS__ */');
    // Sanity: real code from each src file should be present.
    expect(html).toContain('generateRoomId');
    expect(html).toContain('getRoomIdFromHash');
    expect(html).toContain('createStateMachine');
    expect(html).toContain('buildDisplayMediaConstraints');
    expect(html).toContain('createHost');
    expect(html).toContain('connectAsViewer');
    expect(html).toContain('initUI');
  });

  it('inlines the CSS body from styles.css', () => {
    const html = readFileSync(outFile, 'utf8');
    // Should have at least one recognizable style rule.
    expect(html).toMatch(/body\s*\{[^}]*background/);
    expect(html).toMatch(/\.status-dot/);
  });
});
