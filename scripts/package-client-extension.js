/* Packages the app as a Liferay custom element client extension:
 *   1. Copies the runtime files from the repo root into
 *      client-extension/liferay-copilot-voice/assets/
 *   2. Zips the whole client extension folder into
 *      dist/liferay-copilot-voice.zip
 *
 * The zip is a *source* client extension — drop the inner folder into a
 * Liferay Workspace's client-extensions/ dir and `gradlew assemble` builds
 * the deployable artifact, or upload it where source zips are accepted.
 * No dependencies beyond node + the system `zip` binary.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CX_DIR = path.join(ROOT, 'client-extension', 'liferay-copilot-voice');
const ASSETS = path.join(CX_DIR, 'assets');
const DIST = path.join(ROOT, 'dist');

const RUNTIME_FILES = [
  'element.js',
  'markup.js',
  'styles.css',
  'config.json',
  'flows.es.json',
  'flows.en.json',
  'flows.it.json',
];
const RUNTIME_DIRS = ['language', 'src'];

fs.rmSync(ASSETS, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

const BUILD_STAMP = String(Date.now());

for (const f of RUNTIME_FILES) {
  if (f === 'element.js') {
    /* Stamp the build id so every module/data URL gets a cache-busting ?v=
       that changes on each package — see BUILD in element.js. */
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    fs.writeFileSync(path.join(ASSETS, f), src.replace("'__CV_BUILD__'", `'${BUILD_STAMP}'`));
    continue;
  }
  fs.copyFileSync(path.join(ROOT, f), path.join(ASSETS, f));
}
for (const d of RUNTIME_DIRS) {
  fs.cpSync(path.join(ROOT, d), path.join(ASSETS, d), { recursive: true });
}

fs.mkdirSync(DIST, { recursive: true });
const zipPath = path.join(DIST, 'liferay-copilot-voice.zip');
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-q', zipPath, 'liferay-copilot-voice', '-x', '*.DS_Store'], {
  cwd: path.join(ROOT, 'client-extension'),
  stdio: 'inherit',
});

/* Mirror the client extension into the Liferay Workspace so
   `npm run build:cx` (scripts/build-client-extension.js) can produce the
   deployable zip via `gradlew assemble`. The workspace copy is generated —
   never edit it directly. */
const WS_CX = path.join(ROOT, 'liferay-workspace', 'client-extensions', 'liferay-copilot-voice');
if (fs.existsSync(path.join(ROOT, 'liferay-workspace'))) {
  fs.rmSync(WS_CX, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(WS_CX), { recursive: true });
  fs.cpSync(CX_DIR, WS_CX, { recursive: true });
  console.log(`Synced   → ${path.relative(ROOT, WS_CX)}`);
}

console.log(`Packaged → ${path.relative(ROOT, zipPath)}`);
