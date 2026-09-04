/* Liferay Copilot Voice — module 8/8: boot
 * Boot: config + language loading, locale resolution, dev toggles, event listeners, loadAll().
 * Modules share one global scope and load strictly in order (element.js
 * chains them with async=false) — this file was split from the original
 * app.js without reordering, so cross-module references resolve at call
 * time exactly as before.
 */
  /* ─── Init ─── */
  setBarsOval();

  /* ─── Config + flows ─── */
  const DEFAULT_CONFIG = {
    activationKey: { code: 'Space', label: 'SPACE' },
    locales: { es: 'es-ES', en: 'en-US', it: 'it-IT' },
  };
  let appConfig = DEFAULT_CONFIG;

  function applyConfig() {
    const label = appConfig.activationKey?.label ?? 'SPACE';
    spaceLabel.textContent = label;
    applyStrings();
    updateFieldMicButtons();
    if (speech && appConfig.locale) speech.setLocale(appConfig.locale);
  }

  /* Walks every [data-language] node, looks up the key in appConfig.strings,
     interpolates {key} with the activation key label, and writes textContent
     (or innerHTML when [data-language-html] is present).
     [data-language-aria-label="key"] is a separate attribute that sets the
     element's aria-label from a string (used for icon-only buttons whose
     visual content stays as a glyph). */
  function applyStrings() {
    const keyLabel = appConfig.activationKey?.label ?? 'SPACE';
    document.querySelectorAll('[data-language]').forEach(el => {
      const key = el.dataset.language;
      let value = appConfig.strings?.[key];
      if (value == null) return;
      value = String(value).replace(/\{key\}/g, keyLabel);
      if (el.dataset.languageHtml !== undefined) el.innerHTML = value;
      else                                   el.textContent = value;
    });
    document.querySelectorAll('[data-language-aria-label]').forEach(el => {
      const key = el.dataset.languageAriaLabel;
      const value = appConfig.strings?.[key];
      if (value != null) el.setAttribute('aria-label', value);
    });
    /* Native placeholder text on real <input>/<textarea>. */
    document.querySelectorAll('[data-language-placeholder]').forEach(el => {
      const key = el.dataset.languagePlaceholder;
      const value = appConfig.strings?.[key];
      if (value != null) el.setAttribute('placeholder', value);
    });
  }

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  }

  function buildCmdList() {
    const ul = document.getElementById('cmdListUl');
    if (!ul || !flowsConfig) return;
    /* Dynamic flows register commands whose phrases/ids derive from Liferay
       Object names — escape everything. */
    ul.innerHTML = flowsConfig.globalCommands
      .filter(c => !c.hidden && !isCommandDisabled(c.id))
      .map(c => `<li><button type="button" class="cmd-pill" data-cmd-id="${escapeHTML(c.id)}">${escapeHTML(capitalize(c.phrases[0]))}</button></li>`)
      .join('');

    ul.querySelectorAll('button[data-cmd-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cmd = flowsConfig.globalCommands.find(c => c.id === btn.dataset.cmdId);
        if (!cmd) return;
        cmdList.classList.remove('visible');
        if (cmd.id === 'exit')                { ackCommand(); toIdle(); return; }
        if (cmd.action === 'createSpace')     { flashCommandDetected(cmd.label); enterSpaceCreate(); return; }
        if (cmd.triggersFlow)         { startContentFlow(cmd.triggersFlow, cmd.label); }
      });
    });
  }

  function updateFieldFocus() {
    const titleBox    = titleField.querySelector('.field-box');
    const subtitleBox = subtitleField?.querySelector('.field-box');
    const bodyBox     = bodyField.querySelector('.field-box');
    if (titleBox)    titleBox.classList.toggle('dictating',    voicePhase === 'title');
    if (subtitleBox) subtitleBox.classList.toggle('dictating', voicePhase === 'subtitle');
    if (bodyBox)     bodyBox.classList.toggle('dictating',     voicePhase === 'body');
    dynamicTextFieldsContainer?.querySelectorAll('.field-box').forEach(box => {
      const stepId = box.closest('[data-step-id]')?.dataset.stepId;
      box.classList.toggle('dictating',
        voicePhase === 'dynamicText' && stepId === dynamicTextStepId);
    });
    updateFieldMicButtons();
  }

  /* Per-style icon registry for the side-panel pills. Inline SVG so the icon
     inherits color via `currentColor` from the pill's CSS variant. Add a new
     entry here when adding a new icon-bearing style; the matching CSS lives
     in styles.css under `.cmd-pill.cmd-pill-<style>`. */
  const PILL_ICONS = {
    format:
      '<svg class="cmd-pill-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
      + '<path d="M12 2.5l1.8 5.7 5.7 1.8-5.7 1.8L12 17.5l-1.8-5.7L4.5 10l5.7-1.8z'
      + ' M19 14.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"/>'
      + '</svg>',
    image:
      '<svg class="cmd-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<rect x="3" y="5" width="18" height="14" rx="2"/>'
      + '<circle cx="9" cy="11" r="1.6" fill="currentColor" stroke="none"/>'
      + '<path d="m21 17-5-5-7 7"/>'
      + '</svg>',
  };

  function renderSidePanel() {
    updateFieldFocus();
    const ul = document.getElementById('sidePanelList');
    if (!ul || !flowsConfig) return;
    const commands = getActiveCommands();
    /* Labels/ids may derive from Liferay Object names in dynamic flows —
       escape all data; only PILL_ICONS (static, ours) goes in raw. */
    let html = commands
      .filter(c => !c.hidden)
      .map(c => {
        const cls  = c.style ? `cmd-pill cmd-pill-${escapeHTML(c.style)}` : 'cmd-pill';
        const icon = (c.style && PILL_ICONS[c.style]) || '';
        return `<li><button type="button" class="${cls}" data-cmd-id="${escapeHTML(c.id)}">${icon}${escapeHTML(c.label)}</button></li>`;
      })
      .join('');

    if (voicePhase === 'image') {
      const help = getStep('coverImage')?.voiceHelp ?? [];
      if (help.length) {
        html += `<li class="voice-help-divider">${escapeHTML(s('voiceHelpDivider'))}</li>`;
        html += help.map(h =>
          `<li class="voice-help-item">
             <span class="voice-help-label">${escapeHTML(h.label)}</span>
             <span class="voice-help-example">${escapeHTML(h.example)}</span>
           </li>`
        ).join('');
      }
    }
    ul.innerHTML = html;

    ul.querySelectorAll('button[data-cmd-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cmd = getActiveCommands().find(c => c.id === btn.dataset.cmdId);
        if (!cmd) return;
        const sound = FIELD_CHANGE_ACTIONS.has(cmd.action) ? 'fieldChange' : 'command';
        if (!NO_FLASH_ACTIONS.has(cmd.action)) flashCommandDetected(cmd.label, sound);
        else playSound(sound);
        dispatchFlowAction(cmd);
      });
    });
  }

  async function loadJSON(path, fallback) {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error();
      return await r.json();
    } catch {
      return fallback;
    }
  }

  async function loadProperties(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error();
      const text = await r.text();
      const result = {};
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq < 0) continue;
        result[t.slice(0, eq).trim()] = t.slice(eq + 1);
      }
      return result;
    } catch {
      return {};
    }
  }

  /* Supported UI locales. The first one is the fallback default when
     auto-detection turns up something we don't have a translation for. */
  const SUPPORTED_LOCALES = ['en', 'es', 'it', 'pt', 'de', 'fr'];

  /* Resolve the active locale by priority:
       1. ?lang=xx in the URL (explicit override, useful for sharing)
       2. Portal only — Liferay.ThemeDisplay language (the user already chose
          their language in the portal; the corner toggle is hidden there)
       3. localStorage.lang (standalone user preference, set by the toggle)
       4. navigator.language (auto-detect first visit)
       5. SUPPORTED_LOCALES[0] (fallback)
     Returns one of SUPPORTED_LOCALES — anything else is mapped or dropped. */
  function resolveLocale() {
    const fromAny = (raw) => {
      if (!raw) return null;
      const base = String(raw).toLowerCase().split(/[-_]/)[0];
      return SUPPORTED_LOCALES.includes(base) ? base : null;
    };
    const url = new URLSearchParams(location.search).get('lang');
    if (inLiferayPortal()) {
      const td = window.Liferay.ThemeDisplay;
      const portalLang = td.getBCP47LanguageId?.() || td.getLanguageId?.();
      return fromAny(url) || fromAny(portalLang) || fromAny(navigator.language) || SUPPORTED_LOCALES[0];
    }
    let pref = null;
    try { pref = localStorage.getItem('lang'); } catch (_) {}
    return fromAny(url) || fromAny(pref) || fromAny(navigator.language) || SUPPORTED_LOCALES[0];
  }

  /* Persist a chosen locale and reload so every language surface picks it up. */
  function setLocaleAndReload(loc) {
    if (!SUPPORTED_LOCALES.includes(loc)) return;
    try { localStorage.setItem('lang', loc); } catch (_) {}
    /* Strip ?lang from URL so localStorage wins next time. */
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url.toString());
  }
  /* Corner-toggle listeners — no inline handlers (CSP-friendly, audit P2-7). */
  document.querySelectorAll('.language-toggle [data-lang]').forEach(btn => {
    btn.addEventListener('click', () => setLocaleAndReload(btn.dataset.lang));
  });

  /* ─── DEV TOGGLE: live region viewer ───
     Toggles a `debug-live-regions` class on <body>. CSS rules in styles.css
     unhide #liveStatus and #liveAlert as floating panels so a sighted dev
     can watch the same text the screen reader is reading without enabling
     VoiceOver's caption panel. State persists in localStorage. */
  function applyLiveDebug(enabled) {
    document.body.classList.toggle('debug-live-regions', !!enabled);
    document.querySelectorAll('.dev-toggle [data-debug="live-regions"]').forEach(btn => {
      btn.classList.toggle('active', !!enabled);
      btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    });
  }
  function toggleLiveDebug() {
    let cur = false;
    try { cur = localStorage.getItem('debugLiveRegions') === '1'; } catch (_) {}
    const next = !cur;
    try { localStorage.setItem('debugLiveRegions', next ? '1' : '0'); } catch (_) {}
    applyLiveDebug(next);
  }
  document.querySelector('.dev-toggle [data-debug="live-regions"]')
    ?.addEventListener('click', toggleLiveDebug);

  /* Assets resolve against the URL element.js was served from — inside the
     portal the document URL is the page, not the client extension's static
     dir. Standalone this is just './'. */
  const ASSET_BASE = window.__copilotVoiceBaseURL || './';

  async function loadAll() {
    const lang = resolveLocale();
    /* lang lands on the element (covers everything a screen reader visits
       inside the app); only the standalone page owns the whole document. */
    document.querySelector('liferay-copilot-voice')?.setAttribute('lang', lang);
    if (!inLiferayPortal()) document.documentElement.lang = lang;
    /* ?v= mirrors the build stamp on the JS modules so a redeploy busts the
       browser cache on data files too — mixed old-data/new-code sessions
       (e.g. a banner string missing) were real. */
    const v = `?v=${window.__copilotVoiceBuild || 'dev'}`;
    const [cfg, strings, flows] = await Promise.all([
      loadJSON(`${ASSET_BASE}config.json${v}`,                               DEFAULT_CONFIG),
      loadProperties(`${ASSET_BASE}language/Language_${lang}.properties${v}`),
      loadJSON(`${ASSET_BASE}flows/flows.${lang}.json${v}`,                        null),
    ]);
    let sttLocale = cfg.locales?.[lang] ?? 'es-ES';
    if (inLiferayPortal()) {
      /* Prefer the portal's full BCP-47 tag when it matches the resolved
         language — es-MX portal users get es-MX speech recognition. */
      const bcp = window.Liferay.ThemeDisplay.getBCP47LanguageId?.();
      if (bcp && bcp.toLowerCase().startsWith(lang)) sttLocale = bcp;
    }
    appConfig   = { ...cfg, locale: sttLocale, strings };
    flowsConfig = flows;
    applyConfig();
    buildCmdList();
    renderSidePanel();
    paintLocaleToggle(lang);
    /* Establish the idle mode explicitly so every overlay starts inert —
       before the first mode change the DOM would otherwise be visually
       hidden (CSS) but still exposed to screen readers and Tab. */
    setUiMode('idle');
    /* Restore the live-region debug toggle's persisted state. */
    let liveDebug = false;
    try { liveDebug = localStorage.getItem('debugLiveRegions') === '1'; } catch (_) {}
    applyLiveDebug(liveDebug);
    /* Fire-and-forget Liferay site preload — does not block boot. After it
       lands, kick off discovery of dynamic Object-driven flows (the ones
       authored in CMS Site Builder beyond the three Liferay built-ins).
       Discovery just registers extra global commands; if it fails the user
       still has the hardcoded flows. */
    preloadLiferaySpaces().then(() => discoverDynamicFlows());
  }

  /* Highlight the current locale's button in the corner toggle. */
  function paintLocaleToggle(lang) {
    document.querySelectorAll('.language-toggle [data-lang]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  }

  loadAll();

  /* ─── AI modal click handlers ─── */
  document.getElementById('aiConfirmYes')
    .addEventListener('click', () => answerAiConfirm(true));
  document.getElementById('aiConfirmNo')
    .addEventListener('click', () => answerAiConfirm(false));
  document.getElementById('aiResultAccept')
    .addEventListener('click', () => answerAiReview(true));
  document.getElementById('aiResultCancel')
    .addEventListener('click', () => answerAiReview(false));

  /* ─── File picker handlers ─── */
  document.getElementById('filePickerBtn')
    .addEventListener('click', () => openFileDialog());
  document.getElementById('fileInput')
    .addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) {
        setSelectedFile(file);
        hideFormError();
      }
    });

  /* ─── Format list click-to-dismiss ─── */
  document.getElementById('formatList')
    .addEventListener('click', () => hideFormatList());

  /* ─── Liferay error banner — dismiss + retry ─── */
  document.getElementById('liferayErrorDismiss')
    ?.addEventListener('click', hideLiferayError);
  document.getElementById('liferayErrorCreateSpace')
    ?.addEventListener('click', () => enterSpaceCreate());
  document.getElementById('liferayErrorRetry')
    ?.addEventListener('click', async () => {
      const btn   = document.getElementById('liferayErrorRetry');
      const label = btn?.textContent;
      if (btn) {
        btn.disabled    = true;
        btn.textContent = s('errorRetryingLabel') || '…';
      }
      try { await preloadLiferaySpaces(); }
      finally {
        if (btn) {
          btn.disabled    = false;
          btn.textContent = label || s('errorRetryLabel') || 'Retry';
        }
      }
    });

  /* ─── Input — single press toggles listening on/off; mid-flow needs confirm ─── */
  function activationToggle() {
    if (appState === 'idle') {
      /* Boot connectivity gate. If we couldn't reach Liferay at startup
         (or via Retry), don't activate the mic — every flow would dead-end
         on submit. Re-show the banner if dismissed and announce
         assertively so SR users hear feedback for their key press. */
      if (!liferayHealthy) {
        if (spacesEmpty) {
          showLiferayNoSpaces();
          announce(s('errorNoSpaces'), 'alert');
        } else {
          const key = needsSignIn ? 'errorSignIn' : 'errorLiferayConnection';
          showLiferayError(s(key));
          announce(s(key), 'alert');
        }
        playSound('fieldChange');
        return;
      }
      hideCancelConfirm();
      toPressed();
      return;
    }
    if (isInFlow() && !cancelConfirmPending) {
      showCancelConfirm();
      return;
    }
    hideCancelConfirm();
    toIdle();
  }

  /* The keycap is a real button: click / Enter / Space-on-focus all toggle.
     preventDefault in the global Space handler below stops the double fire
     (keydown prevents the button's native activation). */
  document.getElementById('keycap')
    ?.addEventListener('click', () => activationToggle());

  /* Escape dismisses whichever modal is open — same as answering "no" /
     "cancel" / "volver" by voice. */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (voicePhase === 'submitConfirm')      { e.preventDefault(); dismissAiConfirm(); }
    else if (voicePhase === 'aiReview')      { e.preventDefault(); answerAiReview(false); }
    else if (voicePhase === 'formatList')    { e.preventDefault(); hideFormatList(); }
  });

  document.addEventListener('keydown', e => {
    if (e.code !== (appConfig.activationKey?.code ?? 'Space')) return;
    if (e.repeat) return;
    /* Don't hijack SPACE while the user is typing into one of the dictation
       inputs — they need it as a literal space character. The activation
       key still works everywhere else. */
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    activationToggle();
  });

  /* ─── Manual typing → state sync + Enter to advance ─── */
  function bindFieldInput(el, getValue, setValue, onAdvance) {
    el.addEventListener('input', () => {
      setValue(el.value);
      el.classList.remove('field-interim');
      hideFormError();
    });
    el.addEventListener('keydown', e => {
      /* Enter advances title/subtitle to the next step. The body field is
         a textarea — Enter inserts a newline as expected. */
      if (e.key === 'Enter' && el.tagName === 'INPUT') {
        e.preventDefault();
        if (getValue().trim()) onAdvance();
      }
    });
  }
  bindFieldInput(titleText,
    () => titleValue,
    v => { titleValue = v; },
    () => { if (hasSubtitleStep()) startSubtitlePhase(); else startBodyPhase(); });
  bindFieldInput(subtitleText,
    () => subtitleValue,
    v => { subtitleValue = v; },
    () => startBodyPhase());
  bindFieldInput(bodyText,
    () => bodyValue,
    v => { bodyValue = v; },
    () => {});

  /* Number and date input bindings. */
  const numberInputField = document.getElementById('numberInputField');
  if (numberInputField) {
    numberInputField.addEventListener('input', () => {
      if (numberInputStepId) dynamicFieldValues[numberInputStepId] = numberInputField.value;
    });
    numberInputField.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); confirmNumberInput(); }
    });
  }
  const spaceCreateField = document.getElementById('spaceCreateField');
  if (spaceCreateField) {
    spaceCreateField.addEventListener('input', () => {
      spaceCreateValue = spaceCreateField.value;
      spaceCreateField.classList.remove('field-interim');
      spaceCreateField.classList.toggle('overflowing',
        spaceCreateField.scrollWidth > spaceCreateField.clientWidth);
    });
    spaceCreateField.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); confirmSpaceCreate(); }
      if (e.key === 'Escape') { e.preventDefault(); exitSpaceCreate(); }
    });
  }
  const spaceColorPanel = document.getElementById('spaceColorPanel');
  if (spaceColorPanel) {
    spaceColorPanel.addEventListener('click', e => {
      const btn = e.target.closest('.space-color-swatch');
      if (btn) selectSpaceColor(btn.dataset.color, btn);
    });
    spaceColorPanel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); backToSpaceName(); }
    });
  }
  const dateInputField = document.getElementById('dateInputField');
  if (dateInputField) {
    dateInputField.addEventListener('input', () => {
      if (dateInputStepId) dynamicFieldValues[dateInputStepId] = dateInputField.value;
    });
    dateInputField.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); confirmDateInput(); }
    });
  }

  const TOUCH_INTERACTIVE = '.keycap, .field-box, .carousel-card, .space-card, .cmd-pill, .img-carousel, .side-panel, .content-panel, .space-picker, .file-picker, .number-input-panel, .date-input-panel, .cmd-list, .ai-overlay';
  document.addEventListener('click', e => {
    const btn = e.target.closest?.('[data-field-mic]');
    if (!btn) return;
    e.preventDefault();
    toggleFieldMicCapture();
  });

  document.addEventListener('touchstart', e => {
    if (e.target.closest && e.target.closest(TOUCH_INTERACTIVE)) return;
    e.preventDefault();
    activationToggle();
  }, { passive: false });
