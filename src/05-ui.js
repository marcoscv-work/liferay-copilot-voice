/* Liferay Copilot Voice — module 5/8: ui
 * UI chrome: command flash, cmd/format lists, field rendering, MODES table, setUiMode, announce() and its builders.
 * Modules share one global scope and load strictly in order (element.js
 * chains them with async=false) — this file was split from the original
 * app.js without reordering, so cross-module references resolve at call
 * time exactly as before.
 */
  const CHECK_ICON_SVG =
    '<svg class="bars-label-icon" viewBox="0 0 24 24" fill="none">' +
      '<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="3" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function flashCommandDetected(label, soundKind = 'command') {
    playSound(soundKind);
    commandBoostUntil = performance.now() + 900;
    setBarColors(PURPLE_COLS, 150);

    if (label) {
      const el = document.getElementById('barsLabel');
      /* label may carry Liferay data (space/image names) — textContent it. */
      el.innerHTML = CHECK_ICON_SVG + '<span></span>';
      el.querySelector('span').textContent = label;
      el.classList.toggle('long', label.length > 8);
      el.classList.add('visible');
    }

    flowTimeout(() => {
      commandBoostUntil = 0;
      setBarColors(BLUE_COLS, 350);
      setBarMode('active');
      appState = 'speaking';
      document.getElementById('barsLabel').classList.remove('visible');
    }, 900);
  }

  const HINT_IDLE_DELAY = 5000;

  function isListeningPhase() {
    return appState === 'listening' || appState === 'speaking';
  }

  function startHintTimer() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      if (voicePhase === 'command' && isListeningPhase()) {
        cmdHint.classList.add('visible');
      }
    }, HINT_IDLE_DELAY);
  }

  function clearHintTimer() {
    clearTimeout(hintTimer);
    hintTimer = null;
    cmdHint.classList.remove('visible');
    cmdList.classList.remove('visible');
    cmdList.inert = true;
  }

  function showCommandList({ persist = false } = {}) {
    /* Defensive: never show the command list when the app is idle. */
    if (appState === 'idle') return;
    cmdHint.classList.remove('visible');
    cmdList.classList.add('visible');
    cmdList.inert = false; /* shown outside setUiMode — undo the idle inert */
    /* Read the available commands aloud — the visual list is useless to a
       SR user and "ayuda" is the most explicit moment they ask for it. */
    announce(ANNOUNCE_BUILDERS.helpCommandList());
    /* Without speech recognition the clickable list is the only way to
       start a flow — keep it open instead of auto-hiding. */
    if (persist) return;
    flowTimeout(() => {
      cmdList.classList.remove('visible');
      cmdList.inert = true;
      if (voicePhase === 'command' && isListeningPhase()) startHintTimer();
    }, 7000);
  }

  /* Builds the "Comandos de formato" panel from flowsConfig.formatCommands. */
  function buildFormatList() {
    const root = document.getElementById('formatListContent');
    const fc   = flowsConfig?.formatCommands;
    if (!root || !fc) return;
    /* Audited template: formatCommands come only from the packaged
       flows.{lang}.json — dynamic flow discovery never adds to them. */
    root.innerHTML = (fc.groups || []).map(g => `
      <div class="format-group">
        <div class="format-group-title">${g.title}</div>
        <ul>
          ${(g.items || []).map(it => {
            const isLong = (it.result || '').length > 2;
            const cls = isLong ? 'format-result is-text' : 'format-result';
            return `<li>
              <span class="format-say">${it.say}</span>
              <span class="format-arrow">→</span>
              <span class="${cls}">${it.result}</span>
            </li>`;
          }).join('')}
        </ul>
      </div>`).join('');
  }

  function showFormatList() {
    if (appState === 'idle') return;
    if (uiMode === 'flow:format-list') return;
    buildFormatList();
    formatListReturnTo = uiMode;
    setUiMode('flow:format-list');
  }

  function hideFormatList() {
    if (uiMode !== 'flow:format-list') return;
    setUiMode(formatListReturnTo || 'listening:command');
    formatListReturnTo = null;
  }

  /* Reflects the current value of a dictation field on its <input> or
     <textarea>. Native placeholder + caret handle the empty / focused
     states, so we just push `text` into `value` and toggle the
     `.field-interim` colour while STT is delivering tentative output.
     `showCursor` is preserved as a parameter for compatibility with the
     existing call sites but is now a no-op — focus alone determines
     whether the caret is visible. */
  function autoResizeTextarea(el) {
    el.style.height = 'auto';
    const scrollH = el.scrollHeight;
    el.style.height = scrollH + 'px';
    el.scrollTop = scrollH;
    el.closest('.field-box')?.classList.toggle('mic-hidden', el.offsetHeight < scrollH);
  }

  function renderField(el, text, isInterim, _showCursor = true) {
    const value = text || '';
    /* Don't clobber the user's selection / caret position if the value
       already matches what's about to be set. Matters when STT and a
       focused input race against each other (handleSpeechResult skips
       focused fields, but defensive check is cheap). */
    if (el.value !== value) el.value = value;
    el.classList.toggle('field-interim', !!isInterim);
    if (el.tagName === 'TEXTAREA') autoResizeTextarea(el);
    else el.scrollLeft = el.scrollWidth;
  }

  /* True if the user is actively typing in any of the dictation inputs.
     STT writes are suppressed for whichever field has focus so we don't
     overwrite manual edits mid-keystroke. */
  function fieldIsFocused(el) {
    return document.activeElement === el;
  }

  /* ─── UI MODES (single source of truth for visual state) ───
     Each mode declares: which voicePhase is active, whether the keycap is
     in-corner, whether the .hint is visible, and which overlays are shown.
     `keepFields: true` means the mode is an overlay-style (image carousel,
     modals) — leaves the dictation field cursors untouched, including any
     fields that were already visible in the previous mode.
     `includeSubtitleIfHas` lets the body mode pick up the subtitleField only
     when the active flow has a subtitle step.

     `setUiMode(mode)` is the *renderer*: it makes the DOM match the mode.
     Animation primitives (toMorph, toIdle's keycap morph, flashCommandDetected)
     are independent — they fire from the activation key handler and the
     dispatcher. Mode transitions within listening:command ↔ flow:* are
     instant (corner toggle + overlay add/remove). */
  const TRACKED_OVERLAYS = [
    'sidePanel', 'spacePicker', 'filePicker', 'imgCarousel',
    'optionsPicker', 'numberInputPanel', 'dateInputPanel', 'spaceCreatePanel', 'spaceColorPanel',
    'aiConfirm', 'aiModal', 'formatList',
    'cmdList', 'cmdHint',
    'contentPanel', 'titleField', 'subtitleField', 'bodyField', 'dynamicTextFields',
    'sentMsg',
  ];

  /* `announce` field describes how to speak the mode aloud to a screen
     reader. Three shapes:
       { stepRef: 'title' }     → use getStep(stepRef).voicePrompt
       { stringKey: 'xyz' }     → use s('xyz') from config.{lang}.json
       { fn: 'aiReviewSummary' } → use ANNOUNCE_BUILDERS[fn]() (dynamic)
       null / undefined         → silent (no announcement)
     New modes that need a screen-reader cue MUST declare announce. */
  const MODES = {
    'idle':              { voicePhase: 'command',       corner: false, hint: true,  visible: [],                                                                                            announce: null },
    'listening:command': { voicePhase: 'command',       corner: false, hint: false, visible: [],                                                                                            announce: { stringKey: 'announceListening' } },
    'flow:space':        { voicePhase: 'space',         corner: true,  hint: false, visible: ['spacePicker'],                                                                               announce: { fn: 'flowSpacePrompt' } },
    'flow:file':         { voicePhase: 'file',          corner: true,  hint: false, visible: ['sidePanel', 'filePicker'],                                                                   announce: { stepRef: 'file' } },
    'flow:title':        { voicePhase: 'title',         corner: true,  hint: false, visible: ['sidePanel', 'contentPanel', 'titleField', 'dynamicTextFields'], focusField: 'title',                              announce: { stepRef: 'title' } },
    'flow:subtitle':     { voicePhase: 'subtitle',      corner: true,  hint: false, visible: ['sidePanel', 'contentPanel', 'titleField', 'subtitleField', 'dynamicTextFields'], focusField: 'subtitle',          announce: { stepRef: 'subtitle' } },
    'flow:body':         { voicePhase: 'body',          corner: true,  hint: false, visible: ['sidePanel', 'contentPanel', 'titleField', 'bodyField', 'dynamicTextFields'], includeSubtitleIfHas: true, focusField: 'body', announce: { stepRef: 'content' } },
    'flow:dynamic-text': { voicePhase: 'dynamicText',   corner: true,  hint: false, visible: ['sidePanel', 'contentPanel', 'titleField', 'dynamicTextFields'], includeSubtitleIfHas: true,                    announce: { fn: 'flowDynamicTextPrompt' } },
    'flow:number-input': { voicePhase: 'numberInput',   corner: true,  hint: false, visible: ['sidePanel', 'numberInputPanel'],                                                                                announce: { fn: 'flowNumberInputPrompt' } },
    'flow:date-input':   { voicePhase: 'dateInput',     corner: true,  hint: false, visible: ['sidePanel', 'dateInputPanel'],                                                                                   announce: { fn: 'flowDateInputPrompt' } },
    'space-create':      { voicePhase: 'spaceCreate',   corner: true,  hint: false, visible: ['spaceCreatePanel'],                                                                            announce: { fn: 'spaceCreatePrompt' } },
    'space-create-color':{ voicePhase: 'spaceCreateColor', corner: true, hint: false, visible: ['spaceColorPanel'],                                                                          announce: { fn: 'spaceColorPrompt' } },
    'flow:image':        { voicePhase: 'image',         corner: true,  hint: false, visible: ['sidePanel', 'imgCarousel'],   keepFields: true,                                              announce: { fn: 'flowImagePrompt' } },
    'flow:options':      { voicePhase: 'options',       corner: true,  hint: false, visible: ['sidePanel', 'optionsPicker'],                                                                 announce: { fn: 'flowOptionsPrompt' } },
    'flow:ai-confirm':   { voicePhase: 'submitConfirm', corner: true,  hint: false, visible: ['sidePanel', 'aiConfirm'],     keepFields: true, modal: true, focusTarget: 'aiConfirmYes',   announce: { stringKey: 'announceAiConfirm' } },
    /* Silent — would step on the ai-review announcement that lands ~500 ms
       later. The user already gets visual feedback (spinner) for this short
       interstitial. */
    'flow:ai-loading':   { voicePhase: 'aiLoading',     corner: true,  hint: false, visible: ['sidePanel', 'aiModal'],       keepFields: true, modal: true, focusTarget: 'aiModalCard',    announce: null },
    'flow:ai-review':    { voicePhase: 'aiReview',      corner: true,  hint: false, visible: ['sidePanel', 'aiModal'],       keepFields: true, modal: true, focusTarget: 'aiResultAccept', announce: { fn: 'aiReviewSummary' } },
    'flow:format-list':  { voicePhase: 'formatList',    corner: true,  hint: false, visible: ['sidePanel', 'formatList'],    keepFields: true, modal: true, focusTarget: 'formatList',     announce: { stringKey: 'announceFormatList' } },
    'submitted':         { voicePhase: 'command',       corner: false, hint: false, visible: ['sentMsg'],                                                                                   announce: { stringKey: 'announceSubmitted' } },
  };

  const FIELD_IDS = ['contentPanel', 'titleField', 'subtitleField', 'bodyField', 'dynamicTextFields'];

  /* The overlays that ARE the dialog in modal modes — everything else goes
     inert while one of them is open. */
  const MODAL_SURFACE_IDS = new Set(['aiConfirm', 'aiModal', 'formatList']);

  let uiMode = 'idle';
  /* Element that held focus before a modal opened — restored on close. */
  let modalReturnFocus = null;

  /* ─── ACCESSIBILITY ANNOUNCEMENTS ───
     Single primitive: announce(text, level). Two SR-only live regions in the
     DOM (#liveStatus polite, #liveAlert assertive) consume the text. Every
     visible UI surface should mirror through here.

     Convention for adding a new surface:
       - Mode change → declare `announce` in the MODES entry.
       - Step prompt → make sure flows.json `voicePrompt` is autocontained.
       - Error / cancel-confirm → call announce(text, 'alert').
       - Selection / clear / dictation final → call announce(text).
     If you forget the announce, the surface is silent for SR users — that's
     a deliberate fail-loud signal, not a default. */
  function announce(text, level = 'status') {
    if (!text) return;
    const id = level === 'alert' ? 'liveAlert' : 'liveStatus';
    const el = document.getElementById(id);
    if (!el) return;
    /* Some screen readers skip identical content; clear-then-set on the
       next frame guarantees a fresh announcement even if the text repeats. */
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = text; });
  }

  /* Joins parts with ". " and skips empty / falsy entries. Helper for
     building multi-line announcements (prompt + options + actions). */
  function joinAnnounce(...parts) {
    return parts.filter(Boolean).map(p => String(p).trim()).filter(Boolean).join('. ');
  }

  /* Dynamic announcement builders. Used by MODES entries with `announce.fn`.
     Each returns the string to announce (or '' to skip).
     Convention: when the user lands on a picker / modal / list, the
     announcement should cover three things — the question (prompt), the
     suggestion (available items), and the actions (cancel / back / etc.).
     A SR user lands on the surface knowing what they're being asked, what
     the choices are, and how to exit. */
  const ANNOUNCE_BUILDERS = {
    flowSpacePrompt() {
      const prompt = getStep('space')?.voicePrompt || '';
      const names  = api.getSpaces().map(sp => sp.name).join(', ');
      const list   = names ? s('announceSpacesAvailable', { list: names }) : '';
      const cancel = s('announceCancelHint');
      return joinAnnounce(prompt, list, cancel);
    },
    spaceCreatePrompt() {
      return joinAnnounce(s('spaceCreatePrompt'), s('spaceCreateHint'), s('announceCancelHint'));
    },
    spaceColorPrompt() {
      return joinAnnounce(s('spaceColorPrompt'), s('spaceColorHint'), s('announceBackHint'));
    },
    flowImagePrompt() {
      const prompt = getStep('coverImage')?.voicePrompt || '';
      /* Number first, then name. The number is what the SR user repeats to
         pick the image ("imagen 5"), so it has to land in the announcement
         next to the name to be useful. Just listing names made fast picking
         impossible — the user would have to count their position by ear. */
      const names  = api.getCoverImages()
        .map((im, i) => im.name ? `${i + 1}, ${im.name}` : null)
        .filter(Boolean)
        .join('. ');
      const list   = names ? s('announceImagesAvailable', { list: names }) : '';
      const back   = s('announceBackHint');
      return joinAnnounce(prompt, list, back);
    },
    aiReviewSummary() {
      const tag = s('aiReviewTag');
      const lt  = s('aiReviewLabelTitle');
      const ls  = s('aiReviewLabelSubtitle');
      const lb  = s('aiReviewLabelBody');
      const parts = [tag];
      if (reviewedTitle)    parts.push(`${lt}: ${reviewedTitle}`);
      if (reviewedSubtitle) parts.push(`${ls}: ${reviewedSubtitle}`);
      if (reviewedBody)     parts.push(`${lb}: ${reviewedBody}`);
      parts.push(s('announceAiReviewActions'));
      return joinAnnounce(...parts);
    },
    helpCommandList() {
      const title = s('cmdListTitle');
      const labels = (flowsConfig?.globalCommands || [])
        .filter(c => !c.hidden)
        .map(c => c.label)
        .filter(Boolean)
        .join(', ');
      return joinAnnounce(title, labels);
    },
    flowDynamicTextPrompt() {
      return dynamicTextStepId ? (getStep(dynamicTextStepId)?.voicePrompt || '') : '';
    },
    flowNumberInputPrompt() {
      return numberInputStepId ? (getStep(numberInputStepId)?.voicePrompt || '') : '';
    },
    flowDateInputPrompt() {
      return dateInputStepId ? (getStep(dateInputStepId)?.voicePrompt || '') : '';
    },
    flowOptionsPrompt() {
      const step = optionsPhaseStepId ? getStep(optionsPhaseStepId) : null;
      if (!step) return '';
      const tpl    = dynamicTpl();
      const opts   = step.__options || [];
      const lblL   = String(step.label).toLowerCase();
      const prompt = step.voicePrompt || fillTpl(tpl.optionsPrompt, { label: lblL });
      /* Number-prefixed enumeration so the SR user can repeat the position
         to pick (`opción 2` / `dos`). Same pattern as flowImagePrompt. */
      const list   = opts
        .map((o, i) => o.name ? `${i + 1}, ${o.name}` : null)
        .filter(Boolean)
        .join('. ');
      const listed = list ? fillTpl(tpl.announceListing, { list }) : '';
      const cancel = s('announceCancelHint');
      return joinAnnounce(prompt, listed, cancel);
    },
  };

  /* Resolve an `announce` descriptor (from MODES) into a final string. */
  function resolveAnnounce(desc) {
    if (!desc) return '';
    if (desc.stringKey) return s(desc.stringKey) || '';
    if (desc.stepRef)   return getStep(desc.stepRef)?.voicePrompt || '';
    if (desc.fn)        return ANNOUNCE_BUILDERS[desc.fn]?.() || '';
    return '';
  }

  function setUiMode(mode) {
    const def = MODES[mode];
    if (!def) { console.warn('[ui] unknown mode:', mode); return; }
    const prevMode = uiMode;
    const prevDict = isDictationPhase(MODES[prevMode]?.voicePhase);
    uiMode     = mode;
    voicePhase = def.voicePhase;
    if (fieldMicMuted && !isFieldDictationPhase()) {
      setFieldMicMuted(false, { silent: true });
    }
    /* Entering a dictation field from a non-dictation phase (space picker, or
       a modal like the format review). The recogniser keeps running, but any
       utterance still in flight was spoken while this field was backgrounded —
       drop it so it isn't written into the field. Speech that starts fresh
       once the field is shown is kept. */
    if (isFieldDictationPhase() && !prevDict && utteranceInFlight) {
      skipNextFinal        = true;
      dropResidualInterims = true;
    }

    /* 1. Overlays — declarative add/remove. keepFields modes don't touch
       the dictation field overlays so existing field state survives the
       transition (e.g. opening the carousel from flow:body keeps title/body
       visible underneath).
       Visibility is CSS (opacity/transitions) but `inert` is the source of
       truth for the accessibility tree and Tab order: hidden overlays must
       not be focusable or readable, and during a modal everything except
       the dialog goes inert — that IS the focus trap. */
    const visible = new Set(def.visible || []);
    if (def.includeSubtitleIfHas && hasSubtitleStep()) visible.add('subtitleField');
    const isModal = !!def.modal;
    for (const id of TRACKED_OVERLAYS) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (def.keepFields && FIELD_IDS.includes(id)) {
        /* Kept visible in the background; non-interactive under a modal. */
        el.inert = isModal;
        continue;
      }
      const show = visible.has(id);
      el.classList.toggle('visible', show);
      el.inert = !show || (isModal && !MODAL_SURFACE_IDS.has(id));
    }
    /* Untracked chrome (corner toggles, banner, keycap) joins the trap. */
    for (const el of [
      document.querySelector('.language-toggle'),
      document.querySelector('.dev-toggle'),
      document.getElementById('liferayError'),
      document.getElementById('keycap'),
    ]) {
      if (el) el.inert = isModal;
    }

    /* 1b. Modal focus management: remember where focus was, move it into
       the dialog on open, give it back on close. */
    const wasModal = !!MODES[prevMode]?.modal;
    if (isModal && !wasModal) modalReturnFocus = document.activeElement;
    if (isModal && prevMode !== mode) {
      const target = def.focusTarget && document.getElementById(def.focusTarget);
      /* setTimeout, not rAF — rAF starves in hidden/backgrounded tabs. */
      if (target) setTimeout(() => target.focus(), 0);
    }
    if (!isModal && wasModal) {
      const back = modalReturnFocus;
      modalReturnFocus = null;
      if (back && document.contains(back) && !back.closest('[inert]')) {
        setTimeout(() => back.focus(), 0);
      }
    }

    /* 2. Corner — instant transform/class. */
    if (def.corner) toCorner(); else fromCorner();

    /* 3. Idle hint ("Pulsa SPACE para hablar"). */
    hint.classList.toggle('hidden', !def.hint);

    /* 4. Field cursors. Skip when keepFields (e.g. carousel/modal overlays). */
    if (!def.keepFields) {
      renderField(titleText,    titleValue,    false, def.focusField === 'title');
      if (hasSubtitleStep()) renderField(subtitleText, subtitleValue, false, def.focusField === 'subtitle');
      renderField(bodyText,     bodyValue,     false, def.focusField === 'body');
    }

    /* 5. Out-of-band cleanup when leaving any flow:*. Resets the bits that
       aren't .visible toggles (form error, file picker selection, carousel
       inline transform, transient labels). */
    if (mode === 'idle' || mode === 'listening:command') {
      const fe = document.getElementById('formError');
      if (fe) fe.hidden = true;
      document.getElementById('filePickerCard')?.classList.remove('has-file');
      const track = document.getElementById('carouselTrack');
      if (track) {
        track.style.transition = '';
        track.style.transform  = '';
        track.style.animation  = '';
      }
      document.getElementById('barsLabel').classList.remove('visible');
      document.getElementById('coverThumb').classList.remove('visible');
      hideCancelConfirm();
    }

    /* 6. Side panel reflects the active commands for the new voicePhase. */
    renderSidePanel();

    /* 6b. Field-summary chip row above the title — stays in sync with any
       Picklist (and future Date/Boolean) selections in dynamic flows.
       Cheap to compute: walks the active flow's options steps. Hidden when
       no values are set or when the flow isn't dynamic. */
    renderFieldSummary();

    /* 7. Screen-reader announcement. Only fire when the mode actually
       changed — re-entering the same mode (e.g. clear-and-stay-in-title)
       shouldn't repeat the prompt and steal focus from incoming dictation. */
    if (prevMode !== mode) {
      const text = resolveAnnounce(def.announce);
      if (text) announce(text);
    }
  }

  function toCorner() {
    /* Offsets derive from the keycap's real size so the corner position fits
       any viewport (fixed 80/60px margins pushed it offscreen on phones). */
    const s      = window.innerWidth < 720 ? 0.28 : 0.34;
    const kw     = (keycap?.offsetWidth  || 350) * s;
    const kh     = (keycap?.offsetHeight || 230) * s;
    const margin = window.innerWidth < 720 ? 10 : 24;
    const tx =  (window.innerWidth  - kw) / 2 - margin;
    const ty = -((window.innerHeight - kh) / 2 - margin);
    keycapWrap.style.transform       = `translate(${tx}px, ${ty}px) scale(${s})`;
    keycapWrap.style.transformOrigin = 'center center';
    keycapWrap.classList.add('in-corner');
  }

  function fromCorner() {
    keycapWrap.style.transform = '';
    keycapWrap.classList.remove('in-corner');
  }

  let spaceMatchOnInterim = false;

  function spaceNamesAreAmbiguous(spaces) {
    /* The voice matcher uses `t.includes(normalize(sp.name))`, so any name
       that is a substring of another creates a conflict on partial input —
       both "Marketing" / "Marketing Digital" (word-overlap) and "Mac" /
       "Macarena" (prefix overlap, no shared word). One pairwise pass over
       normalized names catches both cases. */
    const norms = spaces.map(sp => normalize(sp.name)).filter(Boolean);
    for (let i = 0; i < norms.length; i++) {
      for (let j = 0; j < norms.length; j++) {
        if (i !== j && norms[i].includes(norms[j])) return true;
      }
    }
    return false;
  }

  function startContentFlow(flowId, label) {
    currentFlowId = flowId || currentFlowId || 'createWebContent';
    currentFlow   = getFlow();
    selectedSpace = null;
    skipNextFinal = true;
    clearHintTimer();
    /* Sync the in-DOM field placeholders with the real field labels of
       the flow we just entered (so a dynamic Object's "Descripción"
       replaces the static "Contenido", etc.). */
    applyFlowFieldLabels();
    buildDynamicTextFields(getFlow());
    flashCommandDetected(label || s('submitFlash') || '');
    /* Refresh spaces in the background so newly-created Asset Libraries
       in Liferay show up without forcing a hard reload. We don't await —
       we render the picker with whatever cache we already have, and if
       fresh data lands while the user is still on flow:space we re-render
       transparently. The user-perceived latency stays at 500 ms. */
    preloadLiferaySpaces().then(() => {
      if (uiMode === 'flow:space') {
        buildSpacePicker();
        const spaces = api.getSpaces();
        spaceMatchOnInterim = !spaceNamesAreAmbiguous(spaces);
      }
    }).catch(() => {});
    flowTimeout(() => {
      const step   = getStep('space');
      const spaces = api.getSpaces();
      if (!step || spaces.length === 0) { enterNextStep(); return; }
      spaceMatchOnInterim = !spaceNamesAreAmbiguous(spaces);
      buildSpacePicker();
      document.getElementById('spacePickerPrompt').textContent = step.voicePrompt || '';
      setUiMode('flow:space');
    }, 500);
  }

  /* Liferay CMS sticker palette names — see styles.css for the matching
     `.sticker-outline-N` rules. Used both for round-robin fallback and as
     the colour values stored on each space. */
  const SPACE_COLORS = ['outline-1', 'outline-2', 'outline-3', 'outline-4', 'outline-5', 'outline-6'];

  function buildSpacePicker() {
    const ul = document.getElementById('spaceList');
    ul.innerHTML = '';
    api.getSpaces().forEach((sp, i) => {
      const li    = document.createElement('li');
      const card  = document.createElement('button');
      card.type = 'button';
      const color = sp.color || SPACE_COLORS[i % SPACE_COLORS.length];
      card.className = 'space-card sticker-' + color;
      card.textContent = sp.name;
      card.dataset.spaceId = sp.id;
      card.setAttribute('aria-pressed', 'false');
      card.addEventListener('click', () => selectSpace(sp));
      li.appendChild(card);
      ul.appendChild(li);
    });
  }

  function selectSpace(space) {
    if (!space || selectedSpace?.id === space.id) return;
    selectedSpace = space;
    spaceMatchOnInterim = false;
    document.querySelectorAll('.space-card').forEach(c => {
      const sel = c.dataset.spaceId === space.id;
      c.classList.toggle('selected', sel);
      c.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });
    flashCommandDetected(s('spaceFlash', { name: space.name }));
    announce(s('announceSpaceSelected', { name: space.name }));
    /* Pre-warm the cover-image cache as soon as the space is picked, so the
       carousel can open with the images already in place (no flash of empty
       state when the user later asks for "añadir imagen"). */
    if (space.id) api.refreshCoverImagesFor(space.id).catch(() => {});
    flowTimeout(() => enterNextStep(), 950);
  }

  /* Pick the right step to enter after space is chosen, based on the current flow.
     Walks the steps array in declared order, skipping the space step itself
     and any optional image-carousel steps (those are reached via the side-panel
     "añadir imagen" command, not as a default progression). For hardcoded
     flows this resolves to title / file as before; for dynamic flows it
     respects whatever step order the factory produced. */
  function enterNextStep() {
    const flow = getFlow();
    const next = flow?.steps?.find(st => st.id !== 'space' && st.type !== 'image');
    if (!next) { enterTitleStep(); return; }
    enterStep(next);
  }

