# Liferay Copilot Voice

**Product site: <https://marcoscv-work.github.io/liferay-copilot-voice/>** (served from [`docs/`](docs/))

Voice-driven content creation copilot for Liferay CMS. Press a configurable key to activate voice input, then create web content, blog entries, upload files or fill custom Object entries via natural-language commands — in Spanish, English, Italian, Portuguese, German or French.

Runs in two modes from the same codebase:

- **Standalone** — a local dev server proxies to any Liferay instance (`npm start`). This is the development setup.
- **Inside Liferay** — packaged as a **custom element client extension** (`npm run package`). The app renders wherever the `<liferay-copilot-voice>` widget is placed, authenticates with the logged-in user's session, and follows the portal's language.

## Quick start (standalone)

```bash
npm install
npm start
```

Visit <http://localhost:8765> in a browser with the Web Speech API — Chrome, Edge or Safari (Firefox does not ship it yet). By default it targets a local Liferay bundle at `http://localhost:8080` with the stock `test@liferay.com`/`test` admin — a vanilla local instance works with zero setup. To point elsewhere, use <http://localhost:8765/config> (stored in the gitignored `dev-config.local.json`), or an env var:

```bash
LIFERAY_URL=http://my-liferay:8080 npm start
```

No build step — plain HTML + CSS + JS.

## Deploy to Liferay (client extension)

```bash
npm run build:cx
```

This produces `dist/liferay-copilot-voice-deployable.zip` — the built custom element client extension, assembled with the official Liferay Workspace tooling (the `liferay-workspace/` dir in this repo). This is the artifact you drop into a bundle's `deploy/` dir, upload to Liferay SaaS/PaaS, or submit to the Marketplace "Client Extension" app type.

```bash
LIFERAY_HOME=/path/to/bundle npm run build:cx   # also copies it into $LIFERAY_HOME/deploy
```

(`npm run package` alone produces `dist/liferay-copilot-voice.zip`, the *source* extension — useful to hand the folder to another workspace.)

Once deployed, add the **Liferay Copilot Voice** widget (category *Client Extensions*) to a page — ideally a blank full-width page, since the app is a full-viewport experience.

Inside the portal there is no proxy and no credentials: requests go same-origin with the user's session + CSRF token (`Liferay.authToken`), the UI language follows `Liferay.ThemeDisplay`, and the dev-only corner toggles are hidden automatically.

## How it works

Press the activation key (default: `SPACE`) to toggle listening on/off. Voice activity drives the animated bars. When the system recognises a command, the bars flash purple and a check-icon pill confirms the action.

When the prototype is in the middle of a flow (anything past the initial command screen), pressing the activation key once shows a confirmation pill — press again within 5 seconds to cancel. This prevents accidental cancellation while you're dictating. From the initial command screen, a single press toggles off directly.

## Flows

### Built-in flows

| Command | Flow | Steps |
|---|---|---|
| `crear contenido` | Web content | Espacio → Título → Contenido → Imagen de portada (opcional) |
| `nuevo blog` | Blog entry | Same structure, blog-specific labels |
| `subir archivo` | File upload | Espacio → Archivo |

### Dynamic flows from Liferay Object Definitions

Any **CMS Content Structure** (Liferay Object Definition stored in the `L_CMS_CONTENT_STRUCTURES` asset-library folder) is automatically discovered at startup and turned into a voice flow. No code changes needed — the engine reads the structure and generates steps for every field. Required fields are validated before submit; the flow jumps back to the first missing one.

Supported field types:

| Liferay field type | Voice / UI |
|---|---|
| `Text` / `String` (1st) | Title input — dictation appends |
| `Text` / `String` (2nd) | Subtitle input |
| `Text` / `String` (3rd+) | Extra text inputs injected into the form |
| `LongText` / `RichText` | Body textarea |
| `Picklist` | Options picker — cards shown, voice or click to select |
| `Boolean` | Options picker with `Sí / No` cards; submits as `true`/`false` |
| `Integer` / `Long` | Number input (whole numbers only) |
| `Double` / `BigDecimal` / `Decimal` | Number input (decimals allowed) |
| `Date` | Date input — voice or native date picker |
| `DateTime` | Date+time input — voice or native datetime picker |

#### Date voice input

Saying a full date in one breath is hard. The date panel accepts components in separate utterances:

```
"quince"   → Día: 15
"mayo"     → Mes: may
"2025"     → Año: 2025  →  auto-confirms
```

Full dates also work: `15 de mayo de 2025`, `hoy`, `mañana`, `15/05/2025`.
The hint below the input tracks progress in real time.

#### Navigation commands in pickers and input panels

While in an options picker, number input, or date input you can say:

| Phrase | Action |
|---|---|
| `volver` / `back` / `anterior` | Go back to the previous field |
| `cancelar` | Cancel the whole flow |

## Voice commands

### Global (initial screen, after pressing the activation key)

| Phrase | Action |
|---|---|
| `crear contenido` | Start the web content flow |
| `nuevo blog` | Start the blog flow |
| `subir archivo` | Start the file upload flow |
| `ayuda` / `comandos` | Show the available commands list |
| `salir` | Stop voice capture (same as pressing the activation key) |

### Common flow commands

| Phrase | Action |
|---|---|
| `ir a título` / `volver al título` | Move to title field (text preserved, dictation appends) |
| `borrar título` | Clear title |
| `ir a contenido` / `volver al contenido` | Move to content field (text preserved, dictation appends) |
| `borrar contenido` | Clear content |
| `añadir imagen` / `añadir imagen de portada` | Open the cover-image carousel |
| `borrar imagen` / `quitar imagen` | Remove the picked cover image |
| `revisar formato` | Apply a format pass (capitalisation, commas, punctuation) |
| `ver comandos de formato` | Open the punctuation/edit cheatsheet overlay — say `volver` to dismiss |
| `borrar palabra` / `borrar última palabra` | Drop the last dictated word from the active field |
| `enviar` / `guardar` / `publicar` | Submit (validates, then asks "¿Quieres revisar el formato?") |
| `cancelar` / `salir` | Cancel and return to idle |

During the **image carousel** only `volver` / `cancelar` / `atrás` work as commands — everything else is interpreted as an image selection (see below).

During the **file picker** only `elegir archivo` (and variants) and `enviar` / `cancelar` are accepted.

During the **AI/format review modal**: `sí` / `revisar` to confirm, `no` / `enviar` to skip; on the result modal `aceptar` / `aplicar` / `ok` to accept the formatted text, `cancelar` / `volver` to dismiss.

### Image selection (in the carousel)

The carousel shows numbered cards. Match by:

- **Number**: `"2"`, `"imagen 2"`, `"número 2"`
- **Spanish word**: `"dos"`, `"segunda"`, `"primero"` … up to `"diez"`
- **Name**: `"Liferay Brand 01"`, `"Liferay Concept"`, etc.
- **Click** a card

The carousel auto-scrolls; on selection it briefly stops and centres the chosen card so you can confirm the choice before it animates into a thumbnail above the title field.

### Inline punctuation while dictating

You can dictate punctuation by name in either Spanish or English. They're substituted in place:

| Spoken | Result |
|---|---|
| `punto` / `punto final` / `period` / `full stop` | `.` |
| `coma` / `comma` | `,` |
| `dos puntos` / `colon` | `:` |
| `punto y coma` / `semicolon` | `;` |
| `interrogación` / `signo de interrogación` / `question mark` | `?` |
| `exclamación` / `exclamation mark` / `exclamation point` | `!` |
| `abrir interrogación` | `¿` |
| `abrir exclamación` | `¡` |

Trade-off: if you dictate prose that mentions these words literally (e.g. *"hablamos de la coma de Oxford"*) they will get substituted. This is the conventional dictation behaviour (Google Docs Voice, Apple Dictation work the same).

## "Revisar formato" — what it actually does

Two implementations behind one seam:

- **Deterministic format pass** (default): inline punctuation substitution, whitespace cleanup, capitalisation, comma before transitional connectors, question wrapping (`¿…?` on Spanish locale), final period. No network involved.
- **Gemini writing assist** (optional): when `config.json` sets `assist.provider = "gemini"`, the review calls a server-side endpoint that runs Gemini with a conservative prompt (improve wording, keep meaning and language). Any failure falls back to the deterministic pass — it can never block a submit. In standalone mode the dev server provides the endpoint (`/assist/review`, key configured at `/config` or via `GEMINI_API_KEY`); inside the portal the LLM path only activates when an absolute `assist.endpoint` URL points at a real service.

Two entry paths:

- **Submit flow** (`enviar` → "¿Revisar formato?" → `sí`): the modal accept button reads "Aceptar y enviar" — accept applies the formatted text and sends.
- **Direct command** (`revisar formato`): accept button reads just "Aceptar" — accept applies the formatted text to the fields and returns to the body step. **No submit.**

## Configuration

Edit [`config.json`](config.json):

```json
{
  "activationKey": { "code": "Space", "label": "SPACE" },
  "locales":       { "es": "es-ES", "en": "en-US", "it": "it-IT" },
  "speech":        { "provider": "web-speech" },
  "assist":        { "provider": "gemini", "model": "gemini-flash-latest", "endpoint": "/assist/review" },
  "submit":        { "askFormatReview": false },
  "commands":      { "disabled": [] },
  "liferay":       { "enabled": true, "baseUrl": "" }
}
```

- `activationKey.code` — `KeyboardEvent.code` (`"Space"`, `"KeyF"`, `"AltLeft"`, …).
- `locales` — UI language → BCP-47 tag for the speech recogniser. Inside the portal the portal's own BCP-47 tag wins when it matches the resolved language.
- `speech.provider` — registered speech provider id. Currently `"web-speech"` (browser-native). See [Speech provider seam](#speech-provider-seam).
- `assist.provider` — `"none"` (or absent) for the deterministic format pass, `"gemini"` for the LLM path.
- `liferay.baseUrl` — empty for same-origin (dev proxy / portal). Credentials never live here: standalone auth is handled by the dev server (`dev-config.local.json`, gitignored), portal auth by the user's session.
- `commands.disabled` — global command ids this deployment doesn't offer. The same ids can be set per placement via the `disabled-commands` attribute on the element (both sources merge):

  ```html
  <!-- only simple web content: everything else disappears from voice, help and banners -->
  <liferay-copilot-voice
    disabled-commands="create-blog, create-file, create-space, create-structured">
  </liferay-copilot-voice>
  ```

  In the portal the same thing can be declared in `client-extension.yaml` — custom element `properties` render as attributes on the element:

  ```yaml
  properties:
      disabled-commands: create-blog, create-file, create-space, create-structured
  ```

  Disable-able ids: `create-web-content`, `create-blog`, `create-file`, `create-space`, the reserved token `create-structured` (turns off Object-driven flow discovery entirely — content structures are never fetched) and `dynamic:{ObjectName}` for one specific structure. `exit` can never be disabled. This is UX configuration, not security — Liferay permissions still gate every API call.

UI text lives in `language/Language_{lang}.properties` (Liferay-style properties bundles, including all `announce*` screen-reader strings). Voice commands, flows and step structure live in `flows/flows.{lang}.json` — no JS edits needed for new phrases.

## File structure

```
index.html          Standalone page: <liferay-copilot-voice> + script tags
markup.js           Single source of the app markup (rendered by the element)
element.js          <liferay-copilot-voice> custom element — boots the app in both modes
src/                Runtime JS in 8 ordered modules sharing one global scope:
                    01-core (engine) · 02-liferay (API) · 03-flows · 04-speech
                    05-ui · 06-panels · 07-dispatch · 08-boot
styles.css          All CSS, scoped under the custom element; --cv-* design tokens
flows/                       flows.{lang}.json — voice commands, flows, steps, dispatch contract
language/Language_*.properties  UI + screen-reader strings per locale
config.json         Activation key, locales, speech/assist providers
config.html         Dev-only /config page (Liferay target + Gemini key)
dev-server.js       Dev-only: static server + authenticated proxy to Liferay
client-extension/   client-extension.yaml (custom element descriptor)
scripts/            npm run package → dist/liferay-copilot-voice.zip
CLAUDE.md           Architecture notes for dev sessions
```

## Liferay integration

The app talks to Liferay through a small `api` object in `src/02-liferay.js` with a structured error contract (`err.kind === 'network' | 'server'`).

**Standalone**: the dev server proxies `/o/`, `/c/`, `/documents/`, `/api/` to the configured Liferay instance and holds an authenticated session cookie server-side — the browser never handles credentials. **Portal**: same-origin `fetch` with `x-csrf-token: Liferay.authToken`.

### API endpoints used

| Concern | Endpoint | Notes |
|---|---|---|
| Spaces | `GET /o/headless-asset-library/v1.0/asset-libraries` | Uses `siteId` as scope everywhere |
| Object Definitions | `GET /o/object-admin/v1.0/object-definitions` | Used by dynamic flow discovery |
| Picklists | `GET /o/headless-admin-list-type/v1.0/list-type-definitions/{id}` | Fetches Picklist values |
| Images | `GET /o/cms/basic-documents/scopes/{siteId}` | Filtered to `image/*` mimeTypes |
| Web content | `POST /o/cms/basic-web-contents/scopes/{siteId}` | Body: `{ title, content }` |
| Blog | `POST /o/cms/blogs/scopes/{siteId}` | Body: `{ title, subtitle, content, coverImage? }` — `coverImage` is the **DLFileEntry id** (`file.id`), not the Object Entry id |
| File | `POST /o/cms/basic-documents/scopes/{siteId}` | `multipart/form-data` with `file` + `title` |
| Dynamic submit | `POST /o/c/{objectName}s/scopes/{siteId}` | Payload built from `dynamicFieldValues`; field names match the Object's `name` property |

### Preparing Liferay for dynamic flows

1. Create an **Asset Library** and name it `L_CMS_CONTENT_STRUCTURES` (or configure the lookup key in `src/03-flows.js`).
2. Inside it, create **CMS Content Structures** (Liferay Object Definitions). The app discovers them automatically on startup.
3. Supported field types: `Text`, `LongText`, `RichText`, `Picklist`, `Boolean`, `Integer`, `Long`, `Double`, `BigDecimal`, `Decimal`, `Date`, `DateTime`. Other types are skipped with a console warning.
4. Field **labels** are used as voice prompts (e.g. "Di el texto de Título del artículo"). Keep them concise.
5. For **Picklist** fields, make sure the `listTypeDefinitionId` is set — the app fetches the options at flow-start time.

## Speech provider seam

The recogniser is behind a small interface in [`src/04-speech.js`](src/04-speech.js):

```js
provider.start()           // begin listening (idempotent)
provider.stop()            // stop listening
provider.setLocale(loc)    // change BCP-47 locale at runtime
provider.available         // boolean — supported in this environment
provider.name              // 'web-speech' / 'deepgram' / etc.

// Provider receives via factory opts:
opts.onResult({ interim, final })
opts.onEnd()
opts.onError(err)
```

To swap to Deepgram, AssemblyAI, Google STT, Whisper, etc.:

1. Implement `createXProvider(opts)` returning the contract above.
2. Register it in `createSpeechProvider(name, opts)`.
3. Set `appConfig.speech.provider = 'X'` in `config.json`.
4. For cloud providers, point at a backend that mints short-lived tokens (don't hardcode API keys in the browser).

The phase routing (`handleSpeechResult`) is provider-agnostic — no other file changes when switching.

## Browser requirements

- A browser with the Web Speech API + AudioContext: Chrome, Edge or Safari (Firefox does not ship speech recognition yet)
- Microphone permission
- Served over HTTP/HTTPS (not `file://`)
