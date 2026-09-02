/* Builds the DEPLOYABLE client extension zip — the artifact you drop into a
 * Liferay bundle's deploy/ dir, upload to LXC, or submit to the Marketplace.
 *
 *   1. Runs package-client-extension.js (refreshes assets + syncs the
 *      liferay-workspace/client-extensions/ copy).
 *   2. Runs `gradlew assemble` in the workspace (official Liferay tooling).
 *   3. Copies the built zip to dist/liferay-copilot-voice-deployable.zip.
 *
 * Optional: set LIFERAY_HOME to also copy the zip into $LIFERAY_HOME/deploy.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WS = path.join(ROOT, 'liferay-workspace');
const DIST = path.join(ROOT, 'dist');

execFileSync('node', [path.join(__dirname, 'package-client-extension.js')], { stdio: 'inherit' });

console.log('\nAssembling with Liferay Workspace (gradlew)…');
execFileSync('./gradlew', [':client-extensions:liferay-copilot-voice:assemble', '-q'], {
  cwd: WS,
  stdio: 'inherit',
});

const builtDir = path.join(WS, 'client-extensions', 'liferay-copilot-voice', 'dist');
const built = fs.readdirSync(builtDir).find(f => f.endsWith('.zip'));
if (!built) throw new Error(`no zip produced in ${builtDir}`);

const out = path.join(DIST, 'liferay-copilot-voice-deployable.zip');
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(path.join(builtDir, built), out);
console.log(`\nDeployable → ${path.relative(ROOT, out)}`);

const bundle = process.env.LIFERAY_HOME;
if (bundle) {
  const deployDir = path.join(bundle, 'deploy');
  if (fs.existsSync(deployDir)) {
    fs.copyFileSync(out, path.join(deployDir, path.basename(out)));
    console.log(`Deployed   → ${path.join(deployDir, path.basename(out))}`);
  } else {
    console.warn(`LIFERAY_HOME set but ${deployDir} does not exist — skipped deploy`);
  }
}
