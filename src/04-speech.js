/* Liferay Copilot Voice — module 4/8: speech
 * Provider seams: speech recognition (web-speech) and the optional writing-assist (Gemini).
 * Modules share one global scope and load strictly in order (element.js
 * chains them with async=false) — this file was split from the original
 * app.js without reordering, so cross-module references resolve at call
 * time exactly as before.
 */
  /* ── Speech recognition provider seam ──
     The rest of the app talks to a single `speech` object with this contract:

       speech.start()         — begin listening (idempotent)
       speech.stop()          — stop listening (idempotent)
       speech.setLocale(loc)  — switch BCP-47 locale at runtime
       speech.available       — boolean, is this provider supported here?
       speech.name            — provider id, e.g. 'web-speech'

     Providers receive these callbacks via the factory options:

       onResult({ interim, final })  — empty string when not present in this update
       onEnd()                        — provider stopped emitting (manual or network)
       onError(err)                   — optional, any unrecoverable error

     To swap to Deepgram / AssemblyAI / Google STT / Whisper / etc., implement
     a `createXProvider(opts)` returning the same shape and register it in
     `createSpeechProvider`. No other file needs to change. */

  function createWebSpeechProvider({ locale, onResult, onEnd, onError }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return { available: false, name: 'web-speech', start(){}, stop(){}, setLocale(){} };

    const r = new SR();
    r.lang           = locale ?? 'es-ES';
    r.continuous     = true;
    r.interimResults = true;

    r.onresult = e => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        (e.results[i].isFinal ? (str => final += str) : (str => interim += str))
          (e.results[i][0].transcript);
      }
      onResult?.({ interim, final });
    };
    r.onend   = () => onEnd?.();
    r.onerror = err => onError?.(err);

    return {
      available: true,
      name: 'web-speech',
      start()  { try { r.start(); } catch (_) {} },
      stop()   { try { r.stop();  } catch (_) {} },
      setLocale(loc) { r.lang = loc; },
    };
  }

  function createSpeechProvider(name, opts) {
    /* Add new providers here:
       if (name === 'deepgram')   return createDeepgramProvider(opts);
       if (name === 'assemblyai') return createAssemblyAIProvider(opts);
       if (name === 'google')     return createGoogleSpeechProvider(opts);
       if (name === 'whisper')    return createWhisperProvider(opts); */
    return createWebSpeechProvider(opts);
  }

  let speech = null;

  /* ── Writing-assist provider seam (OPTIONAL, fully additive) ──
     Deliberately separate from the speech seam above. The prototype is
     FULLY FUNCTIONAL without it: when appConfig.assist.provider is absent
     or 'none', createAssistProvider() returns null and the "review" step
     uses the built-in deterministic format pass (formatAsTitle /
     formatAsBody) exactly as it always has — nothing is replaced.

     When set to 'gemini', review() POSTs the dictated fields to the
     dev-server's /assist/review route, which calls Gemini server-side so
     the API key never reaches the browser. ANY failure (no key, network
     down, malformed response) is caught by the caller, which falls back to
     the deterministic pass — so turning this on can only add value, never
     block a submit.

     Contract (mirrors the speech seam's shape):
       assist.review({ title, subtitle, body }) → Promise<{ title, subtitle, body }>
       assist.available  — boolean
       assist.name       — provider id, e.g. 'gemini'

     To add another provider (OpenAI, Claude, …) implement the same shape
     and register it in createAssistProvider — no other file changes. */

  function createGeminiAssistProvider({ model, endpoint, locale }) {
    const url = endpoint || '/assist/review';
    return {
      available: true,
      name: 'gemini',
      async review({ title, subtitle, body }) {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        try {
          const res = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ title, subtitle, body, locale, model }),
            signal:  ctrl.signal,
          });
          if (!res.ok) throw new Error('assist HTTP ' + res.status);
          const data = await res.json();
          if (!data || data.ok === false) throw new Error('assist returned not-ok');
          return { title: data.title, subtitle: data.subtitle, body: data.body };
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }

  function createAssistProvider(name, opts) {
    if (name === 'gemini') return createGeminiAssistProvider(opts);
    return null; /* 'none' / absent → deterministic format pass only */
  }

  let assist            = null;
  let assistInitialized = false;

  function ensureAssist() {
    if (assistInitialized) return;
    assistInitialized = true;
    const name     = appConfig.assist?.provider ?? 'none';
    const endpoint = appConfig.assist?.endpoint;
    /* The default /assist/review endpoint is a dev-server route — inside the
       portal it doesn't exist. Only an absolute endpoint (a real host-provided
       service) enables the LLM path there; otherwise the deterministic
       format pass runs, exactly as with provider 'none'. */
    if (inLiferayPortal() && !/^https?:\/\//.test(endpoint || '')) {
      assist = null;
      return;
    }
    assist = createAssistProvider(name, {
      model:    appConfig.assist?.model,
      endpoint,
      locale:   appConfig.locale,
    });
  }

