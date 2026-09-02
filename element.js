/* <liferay-copilot-voice> custom element — the single entry point for both
 * runtimes:
 *   - Standalone: index.html places the tag and loads markup.js + element.js
 *     + app.js relative to the page.
 *   - Liferay portal: deployed as a customElement client extension; the
 *     portal injects the tag wherever the widget is placed and loads the
 *     files listed in client-extension.yaml `urls`/`cssURLs`.
 *
 * The element renders the shared markup (markup.js) into its light DOM —
 * the app addresses everything by id, and screen-reader live regions need to
 * stay in the page's accessibility tree, so shadow DOM is deliberately not
 * used. The runtime modules (src/*.js) share one global scope and are loaded
 * here in strict order (async=false) after the markup exists, because the
 * first module queries the DOM at parse time. Single-instance by design
 * (client-extension.yaml sets instanceable: false); a second tag renders
 * nothing and warns.
 */
(function () {
  'use strict';

  /* Captured at load time — inside the portal the document URL is the page,
     not the client extension's static dir, so every asset (src modules,
     config.json, flows.*.json, language/*.properties) must resolve against
     the URL this script was served from. Under SennaJS (the portal's SPA
     navigation) scripts are re-evaluated with document.currentScript = null,
     so fall back to finding our own script tag in the swapped-in DOM. */
  const scriptSrc =
    (document.currentScript && document.currentScript.src)
    || document.querySelector('script[src*="element.js"]')?.src
    || '';
  const BASE_URL = scriptSrc ? scriptSrc.slice(0, scriptSrc.lastIndexOf('/') + 1) : './';

  /* Stamped by scripts/package-client-extension.js at packaging time and
     appended as ?v= to every module/data URL — a redeploy busts browser
     caches so new JS never runs against stale JSON/properties. Stays 'dev'
     when running from the repo (the dev server sends no-store anyway). */
  const BUILD = '__CV_BUILD__';
  window.__copilotVoiceBuild = BUILD.indexOf('__') === 0 ? 'dev' : BUILD;

  function inLiferayPortal() {
    return typeof window.Liferay === 'object'
        && window.Liferay !== null
        && !!window.Liferay.ThemeDisplay;
  }

  /* The runtime modules capture their DOM nodes in top-level consts at load
     time, so they can boot against exactly one document. SennaJS page swaps
     break that contract in both directions (arriving without a full load, or
     coming back after navigating away). When we detect a swapped document we
     force ONE real navigation — guarded so it can never loop. */
  function forceFullLoad(reason) {
    try {
      if (sessionStorage.getItem('cvForcedReload') === location.pathname) {
        console.error('[copilot-voice] still broken after a forced reload (' + reason + ')');
        return;
      }
      sessionStorage.setItem('cvForcedReload', location.pathname);
    } catch (_) {}
    console.warn('[copilot-voice] SPA navigation detected (' + reason + ') — forcing a full page load');
    window.location.reload();
  }

  class CopilotVoiceElement extends HTMLElement {
    connectedCallback() {
      if (window.__copilotVoiceBooted) {
        /* Same document, second tag → duplicate, ignore. Fresh document but
           modules already ran (Senna round-trip) → their DOM refs are stale;
           only a real load can rebind. The app's live region is the marker
           for "the booted DOM is still here". */
        if (document.getElementById('liveStatus')) {
          console.warn('[copilot-voice] already booted — ignoring extra <liferay-copilot-voice> instance');
        } else {
          forceFullLoad('modules bound to a previous document');
        }
        return;
      }
      if (!window.CopilotVoiceMarkup) {
        /* markup.js should have executed before us (client-extension.yaml
           order); a swapped-in fragment can miss it. */
        forceFullLoad('markup.js not executed');
        return;
      }
      window.__copilotVoiceBooted = true;
      window.__copilotVoiceBaseURL = BASE_URL;
      try { sessionStorage.removeItem('cvForcedReload'); } catch (_) {}

      this.classList.add('copilot-voice-root');
      if (inLiferayPortal()) this.classList.add('in-portal');
      window.CopilotVoiceMarkup.render(this);

      /* Load order is the dependency order — dynamically-inserted scripts
         default to async, so async=false forces the in-order queue. */
      const MODULES = [
        'src/01-core.js',
        'src/02-liferay.js',
        'src/03-flows.js',
        'src/04-speech.js',
        'src/05-ui.js',
        'src/06-panels.js',
        'src/07-dispatch.js',
        'src/08-boot.js',
      ];
      for (const module of MODULES) {
        const script = document.createElement('script');
        script.src = BASE_URL + module + '?v=' + window.__copilotVoiceBuild;
        script.async = false;
        document.body.appendChild(script);
      }
    }
  }

  if (!customElements.get('liferay-copilot-voice')) {
    customElements.define('liferay-copilot-voice', CopilotVoiceElement);
  }
})();
