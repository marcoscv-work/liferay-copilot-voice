#!/usr/bin/env node
/* Tiny dev server for the Liferay Copilot Voice prototype.
 *
 *   - Serves index.html / styles.css / app.js / flows.{lang}.json /
 *     config.json / language/ and other assets from the project root.
 *   - Transparently proxies any request that starts with one of
 *     PROXY_PREFIXES to the Liferay instance at TARGET. That makes the
 *     browser see everything as same-origin, sidestepping CORS without
 *     touching Liferay's config.
 *   - Authenticates those proxied requests so the prototype can talk to
 *     a Liferay backend during local development. The auth piece is
 *     boxed into a separate "DEV-ONLY LIFERAY AUTH" block below — see
 *     the banner there for the rationale and why it does NOT belong in
 *     a production deployment.
 *   - Exposes a /config page and /api/dev-config endpoint so you can
 *     override the Liferay target at runtime without touching config.json.
 *     That piece is boxed into a "DEV-ONLY RUNTIME CONFIG" block.
 *
 * Run with `npm start`. No npm dependencies — only Node built-ins.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8765;
const ROOT = __dirname;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.properties': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
};

/* Anything matching one of these prefixes is forwarded to TARGET as-is. */
const PROXY_PREFIXES = [
	'/o/', // Headless APIs
	'/c/', // Liferay legacy controllers
	'/documents/', // Document downloads (cover images, files)
	'/api/', // jsonws and friends
];

function shouldProxy(url) {
	return PROXY_PREFIXES.some((p) => url.startsWith(p));
}

function serveStatic(req, res) {
	let urlPath = req.url.split('?')[0].split('#')[0];
	if (urlPath.endsWith('/')) urlPath += 'index.html';
	const filePath = path.normalize(
		path.join(ROOT, decodeURIComponent(urlPath))
	);
	if (!filePath.startsWith(ROOT)) {
		res.writeHead(403);
		res.end('Forbidden');
		return;
	}
	fs.stat(filePath, (err, stat) => {
		if (err || !stat.isFile()) {
			res.writeHead(404, {'Content-Type': 'text/plain'});
			res.end('Not found');
			return;
		}
		const ext = path.extname(filePath).toLowerCase();
		const mime = MIME[ext] || 'application/octet-stream';
		res.writeHead(200, {'Content-Type': mime, 'Cache-Control': 'no-store'});
		fs.createReadStream(filePath).pipe(res);
	});
}

/* ─────────────────────────────────────────────────────────────────────
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DEV-ONLY LIFERAY AUTH  ── this whole section is a workaround.   ║
 * ║                                                                  ║
 * ║  The prototype runs at localhost:8765 and the browser cannot     ║
 * ║  reach Liferay's image binaries cross-origin: SameSite=Lax       ║
 * ║  strips the user's session cookie on subresource requests like   ║
 * ║  <img>, and Liferay's BasicAuthHeaderAutoLogin filter does NOT   ║
 * ║  cover /documents/* in default DXP — Authorization: Basic is     ║
 * ║  honoured for /o/* and /api/* but ignored for binary downloads,  ║
 * ║  so images returned a portal "Page not found" with Basic alone.  ║
 * ║                                                                  ║
 * ║  To work around both, the proxy logs into Liferay once at        ║
 * ║  startup with hardcoded credentials, caches the resulting        ║
 * ║  authenticated `Set-Cookie` payload, and rewrites the Cookie     ║
 * ║  header on every proxied request. Liferay then treats every      ║
 * ║  proxied request — including /documents/* — as the logged-in     ║
 * ║  user, with no further auth dance from the browser.              ║
 * ║                                                                  ║
 * ║  When the prototype lands inside Liferay (portlet / fragment /   ║
 * ║  widget), this entire dev-server.js disappears. The browser is   ║
 * ║  already same-origin with Liferay, the user's real session       ║
 * ║  cookie carries through naturally, and Object permissions /      ║
 * ║  field validations are enforced server-side by Liferay itself.   ║
 * ║                                                                  ║
 * ║  What dies with this file: the proxy, this auth block, lrFetch's ║
 * ║  Basic-auth header logic, and the connection-error banner as a   ║
 * ║  primary surface (server-side validation errors stay).           ║
 * ║  What survives: app.js (speech, MODES, flows, announce, format   ║
 * ║  pass, AI review), flows.*.json, config.json, language/,         ║
 * ║  index.html, styles.css, and the `api` object's contract —       ║
 * ║  only its implementation changes (no more proxy fetch).          ║
 * ║                                                                  ║
 * ║  Single integration point: the proxy() function calls            ║
 * ║  `applyLiferayDevAuth(headers)` once before forwarding. Nothing  ║
 * ║  else in this file knows about credentials, cookies, or login.   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

/* Read credentials from config.json (canonical) or a legacy locale config
   as fallback. Returned shape: { user, pass, basic } or null. */
function readLiferayDevCreds() {
	for (const name of ['config.json', 'config.es.json', 'config.en.json']) {
		try {
			const cfg = JSON.parse(
				fs.readFileSync(path.join(ROOT, name), 'utf8')
			);
			const u = cfg.liferay?.auth?.username,
				p = cfg.liferay?.auth?.password;
			if (u && p)
				return {
					user: u,
					pass: p,
					basic:
						'Basic ' + Buffer.from(u + ':' + p).toString('base64'),
				};
		} catch (_) {}
	}
	return null;
}

function buildCreds(user, pass) {
	return {
		user,
		pass,
		basic: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64'),
	};
}

/* Mutable runtime proxy config. Updated by the DEV-ONLY RUNTIME CONFIG
   API below. The proxy() and liferayDevLogin() functions always read
   these variables, never capture them at startup. */
let devTarget = process.env.LIFERAY_URL || 'http://localhost:8080';
let devTargetURL = new URL(devTarget);
/* Default to the stock local-bundle admin account so a fresh clone works
   against a vanilla Liferay on localhost:8080 with zero setup. Override
   via the /config page (persisted to dev-config.local.json). */
function isLoopbackTarget() {
	return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(devTargetURL.hostname);
}

/* Stock local-bundle admin creds are a zero-setup convenience for LOCAL
   targets only — never assumed for remote instances. */
let devCreds =
	readLiferayDevCreds() ||
	(isLoopbackTarget() ? buildCreds('test@liferay.com', 'test') : null);

/* Pick http/https to match the target protocol — plain http.request against
   an https target hangs/fails. */
function targetRequest(opts, cb) {
	const mod = devTargetURL.protocol === 'https:' ? https : http;
	return mod.request(opts, cb);
}

/* Local-only guard for the dev API endpoints (config, assist): the server
   binds to loopback by default, but defence in depth — reject requests whose
   Host/Origin isn't local so a hostile page can't drive the dev API. */
function isLocalRequest(req) {
	const host = String(req.headers.host || '').replace(/:\d+$/, '');
	const okHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
	const origin = req.headers.origin;
	const okOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
	return okHost && okOrigin;
}
function rejectNonLocal(req, res) {
	if (isLocalRequest(req)) return false;
	res.writeHead(403, {'Content-Type': 'application/json'});
	res.end(JSON.stringify({ok: false, error: 'Local requests only'}));
	return true;
}

/* Shared body collector with a hard cap. */
const MAX_BODY_BYTES = 1024 * 1024;
function collectBody(req, res, onDone) {
	let body = '';
	let overflow = false;
	req.on('data', (chunk) => {
		if (overflow) return;
		body += chunk;
		if (body.length > MAX_BODY_BYTES) {
			overflow = true;
			res.writeHead(413, {'Content-Type': 'application/json'});
			res.end(JSON.stringify({ok: false, error: 'Body too large'}));
			req.destroy();
		}
	});
	req.on('end', () => {
		if (!overflow) onDone(body);
	});
}

/* Cached authenticated session cookies from /c/portal/login. */
let liferayDevCookie = '';

/* POST /c/portal/login with form-encoded credentials. Capture every
   `Set-Cookie` from the response — Liferay sets JSESSIONID, COMPANY_ID,
   ID, COOKIE_SUPPORT, GUEST_LANGUAGE_ID; we forward all of them since
   different DXP versions key auth off slightly different combinations. */
function liferayDevLogin() {
	return new Promise((resolve, reject) => {
		if (!devCreds) return reject(new Error('no credentials configured'));
		const body =
			`login=${encodeURIComponent(devCreds.user)}` +
			`&password=${encodeURIComponent(devCreds.pass)}`;
		const opts = {
			protocol: devTargetURL.protocol,
			hostname: devTargetURL.hostname,
			port:
				devTargetURL.port ||
				(devTargetURL.protocol === 'https:' ? 443 : 80),
			method: 'POST',
			path: '/c/portal/login',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(body),
			},
		};
		const req = targetRequest(opts, (res) => {
			const setCookies = res.headers['set-cookie'] || [];
			const pairs = [];
			for (const c of setCookies) {
				const m = String(c).match(/^([^=]+)=([^;]+)/);
				if (m) pairs.push(`${m[1].trim()}=${m[2].trim()}`);
			}
			liferayDevCookie = pairs.join('; ');
			const location = res.headers.location || '';
			res.resume();
			res.on('end', () => {
				if (!/JSESSIONID=/.test(liferayDevCookie)) {
					return reject(
						new Error(
							`login response had no JSESSIONID (status ${res.statusCode})`
						)
					);
				}
				/* Liferay returns 302 on both success and failure. The difference
           is the redirect target: back to /c/portal/login means wrong
           credentials; anywhere else means authenticated. */
				if (/\/c\/portal\/login/.test(location)) {
					liferayDevCookie = '';
					return reject(
						new Error(
							'wrong credentials — Liferay redirected back to login'
						)
					);
				}
				if (res.statusCode !== 302) {
					liferayDevCookie = '';
					return reject(
						new Error(
							`unexpected login status ${res.statusCode} — account may be locked or Liferay error`
						)
					);
				}
				resolve(res.statusCode);
			});
		});
		req.on('error', reject);
		req.write(body);
		req.end();
	});
}

/* Single integration point. Mutates `headers` in place:
     - Replaces any browser-side Liferay session cookies with the cached
       authenticated ones (other cookies pass through untouched).
     - Adds Authorization: Basic if the browser didn't send one — kept
       as a defence-in-depth fallback for /o/* and /api/* paths where
       Basic auth is honoured even without the session cookie. */
function applyLiferayDevAuth(headers) {
	if (liferayDevCookie) {
		const existing = headers.cookie || '';
		const stripped = existing
			.split(';')
			.map((s) => s.trim())
			.filter(
				(s) =>
					s &&
					!/^(JSESSIONID|COMPANY_ID|ID|COOKIE_SUPPORT|GUEST_LANGUAGE_ID)=/i.test(
						s
					)
			)
			.join('; ');
		headers.cookie = stripped
			? `${stripped}; ${liferayDevCookie}`
			: liferayDevCookie;
	}
	if (devCreds && !headers.authorization && !headers.Authorization) {
		headers.Authorization = devCreds.basic;
	}
}

/* Detect whether a Liferay response indicates the dev session expired
   (Liferay 302s to /c/portal/login when JSESSIONID is no longer
   authenticated). Used by the proxy to fire a background re-login. */
function isLiferayDevSessionExpiry(upstreamResponse) {
	if (upstreamResponse.statusCode !== 302) return false;
	const loc = upstreamResponse.headers.location || '';
	return /\/c\/portal\/login/.test(loc);
}

/* ─── END DEV-ONLY LIFERAY AUTH ─────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DEV-ONLY RUNTIME CONFIG  ── also a workaround.                  ║
 * ║                                                                  ║
 * ║  Lets you switch the Liferay target URL and credentials while    ║
 * ║  the server is running — without editing config.json and         ║
 * ║  restarting. Useful during demos where you need to point at a    ║
 * ║  different Liferay instance on the fly.                          ║
 * ║                                                                  ║
 * ║  The override is stored in dev-config.local.json (gitignored)    ║
 * ║  so it survives server restarts but is never committed.          ║
 * ║                                                                  ║
 * ║  Endpoints:                                                      ║
 * ║    GET  /config          → serves config.html (the UI)           ║
 * ║    GET  /api/dev-config  → current runtime config (JSON)         ║
 * ║    POST /api/dev-config  → apply new config + re-login (JSON)    ║
 * ║                                                                  ║
 * ║  None of this belongs in production. The endpoint has no auth    ║
 * ║  because the dev server itself has no auth — it is assumed to    ║
 * ║  be running on a trusted local or demo network.                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const DEV_CONFIG_FILE = path.join(ROOT, 'dev-config.local.json');

/* Load a previously saved override if it exists, and apply it so the
   server starts with the last-used Liferay target. */
function loadDevConfigOverride() {
	try {
		const saved = JSON.parse(fs.readFileSync(DEV_CONFIG_FILE, 'utf8'));
		if (saved.url) {
			devTarget = saved.url;
			devTargetURL = new URL(devTarget);
		}
		if (saved.username && saved.password) {
			devCreds = buildCreds(saved.username, saved.password);
		}
		if (saved.geminiKey) runtimeGeminiKey = saved.geminiKey;
		if (saved.geminiModel) runtimeGeminiModel = saved.geminiModel;
		console.log(
			`[dev-config] loaded override from dev-config.local.json → ${devTarget}` +
				(runtimeGeminiKey ? ' (+ Gemini key)' : '')
		);
	} catch (_) {
		/* File absent or malformed — start with config.json defaults. */
	}
}

/* Persist the current runtime config to disk so the next server start
   picks it up automatically. Merges with any existing file so independent
   sections (Liferay target vs Gemini key) don't clobber each other. */
function saveDevConfigOverride(patch) {
	try {
		let existing = {};
		try {
			existing = JSON.parse(fs.readFileSync(DEV_CONFIG_FILE, 'utf8'));
		} catch (_) {}
		fs.writeFileSync(
			DEV_CONFIG_FILE,
			JSON.stringify({...existing, ...patch}, null, 2)
		);
	} catch (e) {
		console.warn('[dev-config] could not save override file:', e.message);
	}
}

/* Handle GET /api/dev-config — returns current target URL and username.
   Password is intentionally omitted from the response. */
function handleDevConfigGet(res) {
	const body = JSON.stringify({
		url: devTarget,
		username: devCreds?.user ?? '',
		geminiModel: runtimeGeminiModel || '',
		hasGeminiKey: !!geminiApiKey(),
	});
	res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
	res.end(body);
}

/* Quick API smoke-test after login: hit the asset-libraries endpoint
   (same one preloadLiferaySpaces uses) and report status + body snippet. */
function testLiferayApi() {
	return new Promise((resolve) => {
		const headers = {};
		applyLiferayDevAuth(headers);
		const opts = {
			protocol: devTargetURL.protocol,
			hostname: devTargetURL.hostname,
			port:
				devTargetURL.port ||
				(devTargetURL.protocol === 'https:' ? 443 : 80),
			method: 'GET',
			path: '/o/headless-asset-library/v1.0/asset-libraries?pageSize=1',
			headers,
		};
		const req = targetRequest(opts, (res) => {
			let raw = '';
			res.on('data', (c) => {
				if (raw.length < 200) raw += c;
			});
			res.on('end', () =>
				resolve({
					ok: res.statusCode >= 200 && res.statusCode < 300,
					status: res.statusCode,
					snippet: raw.slice(0, 120),
				})
			);
		});
		req.on('error', (err) => resolve({ok: false, error: err.message}));
		req.end();
	});
}

/* Handle POST /api/dev-config — applies new url / username / password,
   saves to disk, re-logs into Liferay, and reports the result including
   a real API smoke-test so the user knows end-to-end connectivity works. */
function handleDevConfigPost(req, res) {
	if (rejectNonLocal(req, res)) return;
	collectBody(req, res, async (body) => {
		let payload;
		try {
			payload = JSON.parse(body);
		} catch (_) {
			res.writeHead(400, {'Content-Type': 'application/json'});
			res.end(JSON.stringify({ok: false, error: 'Invalid JSON'}));
			return;
		}
		const {url, username, password} = payload;
		if (!url || !username || !password) {
			res.writeHead(400, {'Content-Type': 'application/json'});
			res.end(
				JSON.stringify({
					ok: false,
					error: 'url, username and password are required',
				})
			);
			return;
		}
		try {
			new URL(url);
		} catch (_) {
			res.writeHead(400, {'Content-Type': 'application/json'});
			res.end(JSON.stringify({ok: false, error: 'Invalid URL'}));
			return;
		}
		devTarget = url;
		devTargetURL = new URL(url);
		devCreds = buildCreds(username, password);
		liferayDevCookie = '';
		saveDevConfigOverride({url, username, password});
		console.log(
			`[dev-config] target updated → ${devTarget} (user: ${username})`
		);
		let loginStatus = null,
			loginError = null,
			apiTest = null;
		try {
			loginStatus = await liferayDevLogin();
			console.log(`[dev-config] re-login OK (${loginStatus})`);
		} catch (e) {
			loginError = e.message;
			console.warn(
				'[dev-config] re-login failed (will try Basic auth):',
				e.message
			);
		}
		/* Always run the API test — Basic auth may work even when cookie
       login fails (e.g. mock servers or non-standard Liferay setups). */
		apiTest = await testLiferayApi();
		console.log(
			`[dev-config] API test → status ${apiTest.status} ok=${apiTest.ok}`
		);
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end(JSON.stringify({ok: true, loginStatus, loginError, apiTest}));
	});
}

/* ─── END DEV-ONLY RUNTIME CONFIG ───────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DEV-ONLY GEMINI ASSIST  ── optional writing-improvement pass.   ║
 * ║                                                                  ║
 * ║  Powers the OPTIONAL Gemini path of the "review" step in app.js. ║
 * ║  It is OFF unless BOTH are true:                                 ║
 * ║    1. config.json sets   assist.provider = "gemini"              ║
 * ║    2. the env var        GEMINI_API_KEY   is present             ║
 * ║                                                                  ║
 * ║  When off (the default), this route returns 503 and the browser  ║
 * ║  falls back to its built-in deterministic format pass — so the   ║
 * ║  prototype is fully functional with nothing configured here.     ║
 * ║                                                                  ║
 * ║  The API key lives ONLY in the server environment — never in the ║
 * ║  browser, never in a committed file. In a real Liferay           ║
 * ║  deployment this route is replaced by a server-side call from    ║
 * ║  the host (OSGi component / Headless extension); app.js's assist ║
 * ║  seam contract is unchanged, only the endpoint moves.            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const GEMINI_HOST = 'generativelanguage.googleapis.com';
const ASSIST_SYSTEM = [
	'You are an editorial assistant that improves short CMS content captured by voice dictation.',
	'Fix grammar, spelling, capitalization and punctuation, and lightly improve clarity and flow.',
	'Hard rules: do NOT change the meaning, do NOT add facts or invent content, do NOT translate.',
	'Keep the original language. If a field is empty return it empty. Keep the title concise and without a trailing period.',
].join(' ');

/* Runtime overrides set via the /config page (POST /api/dev-assist) and
   persisted to dev-config.local.json. An env var, when present, always wins
   so scripted / CI runs stay deterministic and ignore the saved file. */
let runtimeGeminiKey = '';
let runtimeGeminiModel = '';

function geminiApiKey() {
	return (
		process.env.GEMINI_API_KEY ||
		process.env.GOOGLE_API_KEY ||
		runtimeGeminiKey
	);
}

/* Lightweight key check — list one model. A 2xx means the key works. */
function testGeminiKey() {
	return new Promise((resolve) => {
		const key = geminiApiKey();
		if (!key) return resolve({ok: false, status: 0, error: 'no key'});
		const r = https.request(
			{
				hostname: GEMINI_HOST,
				path: `/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`,
				method: 'GET',
			},
			(ures) => {
				let raw = '';
				ures.on('data', (c) => {
					if (raw.length < 200) raw += c;
				});
				ures.on('end', () =>
					resolve({
						ok: ures.statusCode >= 200 && ures.statusCode < 300,
						status: ures.statusCode,
						snippet: raw.slice(0, 120),
					})
				);
			}
		);
		r.on('error', (e) => resolve({ok: false, error: e.message}));
		r.end();
	});
}

/* Handle POST /api/dev-assist — set or clear the Gemini key + model at
   runtime (no server restart). Empty key clears it → deterministic pass. */
function handleDevAssistPost(req, res) {
	if (rejectNonLocal(req, res)) return;
	collectBody(req, res, async (body) => {
		let payload;
		try {
			payload = JSON.parse(body || '{}');
		} catch (_) {
			res.writeHead(400, {'Content-Type': 'application/json'});
			res.end(JSON.stringify({ok: false, error: 'Invalid JSON'}));
			return;
		}
		if (typeof payload.key === 'string') runtimeGeminiKey = payload.key.trim();
		if (typeof payload.model === 'string')
			runtimeGeminiModel = payload.model.trim();
		saveDevConfigOverride({
			geminiKey: runtimeGeminiKey,
			geminiModel: runtimeGeminiModel,
		});
		const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
		console.log(
			`[assist] key ${runtimeGeminiKey ? 'set' : 'cleared'} via /config, model=${runtimeGeminiModel || '(default)'}`
		);
		const keyTest = await testGeminiKey();
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end(
			JSON.stringify({
				ok: true,
				hasGeminiKey: !!geminiApiKey(),
				usingEnvKey: !!envKey,
				model: runtimeGeminiModel || '',
				keyTest,
			})
		);
	});
}

/* POST the fields to Gemini's generateContent and resolve { status, raw }. */
function callGemini(model, payload) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(payload);
		const opts = {
			hostname: GEMINI_HOST,
			path: `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiApiKey())}`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(data),
			},
		};
		const r = https.request(opts, (ures) => {
			let raw = '';
			ures.on('data', (c) => (raw += c));
			ures.on('end', () => resolve({status: ures.statusCode, raw}));
		});
		r.on('error', reject);
		r.write(data);
		r.end();
	});
}

/* Handle POST /assist/review. On any failure responds non-2xx so the
   browser falls back to the deterministic format pass. */
function handleAssistReview(req, res) {
	if (!geminiApiKey()) {
		res.writeHead(503, {'Content-Type': 'application/json'});
		res.end(JSON.stringify({ok: false, reason: 'GEMINI_API_KEY not set'}));
		return;
	}
	if (rejectNonLocal(req, res)) return;
	collectBody(req, res, async (body) => {
		let payload;
		try {
			payload = JSON.parse(body || '{}');
		} catch (_) {
			res.writeHead(400, {'Content-Type': 'application/json'});
			res.end(JSON.stringify({ok: false, error: 'Invalid JSON'}));
			return;
		}
		const title = String(payload.title || '');
		const subtitle = String(payload.subtitle || '');
		const text = String(payload.body || '');
		const locale = String(payload.locale || '');
		/* Model precedence: /config override > client config.json > default.
		   The id is interpolated into the Google URL path — sanitize it. */
		const model = String(
			runtimeGeminiModel || payload.model || 'gemini-flash-latest'
		).replace(/[^a-zA-Z0-9.\-]/g, '');

		const userText =
			`Target language (BCP-47): ${locale || 'unknown'}\n\n` +
			`TITLE: ${title}\nSUBTITLE: ${subtitle}\nBODY: ${text}`;

		const geminiPayload = {
			systemInstruction: {parts: [{text: ASSIST_SYSTEM}]},
			contents: [{role: 'user', parts: [{text: userText}]}],
			generationConfig: {
				temperature: 0.2,
				responseMimeType: 'application/json',
				responseSchema: {
					type: 'OBJECT',
					properties: {
						title: {type: 'STRING'},
						subtitle: {type: 'STRING'},
						body: {type: 'STRING'},
					},
					required: ['title', 'body'],
				},
			},
		};

		try {
			const {status, raw} = await callGemini(model, geminiPayload);
			if (status < 200 || status >= 300) {
				console.warn(`[assist] Gemini HTTP ${status}: ${raw.slice(0, 200)}`);
				res.writeHead(502, {'Content-Type': 'application/json'});
				res.end(JSON.stringify({ok: false, error: `Gemini HTTP ${status}`}));
				return;
			}
			const parsed = JSON.parse(raw);
			const out = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
			const fields = JSON.parse(out);
			res.writeHead(200, {'Content-Type': 'application/json'});
			res.end(
				JSON.stringify({
					ok: true,
					title: typeof fields.title === 'string' ? fields.title : title,
					subtitle:
						typeof fields.subtitle === 'string' ? fields.subtitle : subtitle,
					body: typeof fields.body === 'string' ? fields.body : text,
				})
			);
		} catch (e) {
			console.warn('[assist] Gemini call failed:', e.message);
			res.writeHead(502, {'Content-Type': 'application/json'});
			res.end(JSON.stringify({ok: false, error: e.message}));
		}
	});
}

/* ─── END DEV-ONLY GEMINI ASSIST ────────────────────────────────── */

function proxy(req, res) {
	const headers = {...req.headers, host: devTargetURL.host};
	applyLiferayDevAuth(headers);
	const opts = {
		protocol: devTargetURL.protocol,
		hostname: devTargetURL.hostname,
		port:
			devTargetURL.port ||
			(devTargetURL.protocol === 'https:' ? 443 : 80),
		method: req.method,
		path: req.url,
		headers,
	};
	const upstream = targetRequest(opts, (ures) => {
		if (isLiferayDevSessionExpiry(ures)) {
			console.warn('[liferay-dev-auth] session expired — re-logging in');
			liferayDevLogin().catch((e) =>
				console.warn('[liferay-dev-auth] re-login failed:', e.message)
			);
		}
		res.writeHead(ures.statusCode || 502, ures.headers);
		ures.pipe(res);
	});
	upstream.on('error', (err) => {
		if (!res.headersSent) {
			res.writeHead(502, {'Content-Type': 'text/plain'});
		}
		res.end('Upstream error: ' + err.message);
	});
	req.pipe(upstream);
}

function requestHandler(req, res) {
	/* DEV-ONLY runtime config API — checked before shouldProxy because
     /api/dev-config starts with /api/ which is a proxy prefix. */
	if (req.url === '/config')
		return serveStatic({...req, url: '/config.html'}, res);
	if (req.url === '/api/dev-config' && req.method === 'GET')
		return handleDevConfigGet(res);
	if (req.url === '/api/dev-config' && req.method === 'POST')
		return handleDevConfigPost(req, res);
	/* DEV-ONLY optional Gemini writing-assist routes. */
	if (req.url === '/api/dev-assist' && req.method === 'POST')
		return handleDevAssistPost(req, res);
	if (req.url === '/assist/review' && req.method === 'POST')
		return handleAssistReview(req, res);
	if (shouldProxy(req.url)) return proxy(req, res);
	return serveStatic(req, res);
}

/* Use HTTPS when cert files are present at certs/server.key + certs/server.crt.
   Web Speech API (getUserMedia) requires a secure context — either localhost
   or HTTPS. When running on a remote machine HTTPS is mandatory.
   Generate a self-signed cert with:
     mkdir -p certs
     openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
       -keyout certs/server.key -out certs/server.crt \
       -subj "/CN=localhost" */
const CERT_KEY = path.join(ROOT, 'certs', 'server.key');
const CERT_CRT = path.join(ROOT, 'certs', 'server.crt');
const hasCerts = fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT);
const server = hasCerts
	? https.createServer(
			{key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT)},
			requestHandler
		)
	: http.createServer(requestHandler);
const protocol = hasCerts ? 'https' : 'http';
if (!hasCerts) {
	console.warn(
		'[https] No certs found at certs/server.key + certs/server.crt — running HTTP.'
	);
	console.warn(
		'[https] Web Speech API requires HTTPS on non-localhost. See comment above for cert generation.'
	);
}

loadDevConfigOverride();

const HOST = process.env.DEV_HOST || '127.0.0.1';
if (HOST !== '127.0.0.1') {
	console.warn(`[security] dev server exposed on ${HOST} — it proxies an authenticated Liferay session; loopback (default) is strongly recommended.`);
}
server.listen(PORT, HOST, async () => {
	console.log(`Voice prototype:  ${protocol}://localhost:${PORT}`);
	console.log(`Proxying ${PROXY_PREFIXES.join(', ')} → ${devTarget}`);
	if (devCreds) {
		try {
			const code = await liferayDevLogin();
			console.log(`[liferay-dev-auth] session warmed up (login ${code})`);
		} catch (e) {
			console.warn(
				'[liferay-dev-auth] initial login failed — Basic auth fallback only:',
				e.message
			);
		}
		/* Proactive re-login. Liferay's default JSESSIONID timeout is 30 min
		   idle; we refresh every 25 min so the cached session never goes
		   stale while the dev-server is running. The reactive 302→/c/portal/login
		   handler in proxy() stays as a safety net for the cases this misses
		   (unexpected timeout, server restart on the Liferay side, etc.). */
		const REFRESH_MS = 25 * 60 * 1000;
		setInterval(() => {
			liferayDevLogin()
				.then((code) => console.log(`[liferay-dev-auth] session refreshed (login ${code})`))
				.catch((e) => console.warn('[liferay-dev-auth] refresh failed:', e.message));
		}, REFRESH_MS);
	}
});
