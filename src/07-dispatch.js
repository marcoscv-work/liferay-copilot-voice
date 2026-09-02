/* Liferay Copilot Voice — module 7/8: dispatch
 * Command dispatch + content pipeline: voice matching, format pass, AI review, submit, speech result routing.
 * Modules share one global scope and load strictly in order (element.js
 * chains them with async=false) — this file was split from the original
 * app.js without reordering, so cross-module references resolve at call
 * time exactly as before.
 */
  function renderFieldSummary() {
    const el = document.getElementById('fieldSummary');
    if (!el) return;
    const flow = getFlow();
    /* Hardcoded flows don't use this surface — coverThumb already covers
       their non-text selection (image). Keep the row hidden so they don't
       see an empty container. */
    if (!flow?.__dynamic) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const pills = [];
    for (const st of flow.steps) {
      const isOption   = st.type === 'options';
      const isNumber   = st.type === 'number';
      const isDate     = st.type === 'date' || st.type === 'datetime';
      if (!isOption && !isNumber && !isDate) continue;
      const raw = dynamicFieldValues[st.id];
      if (!raw) continue;
      let displayVal;
      if (isOption) {
        const opt = (st.__options || []).find(o => o.key === raw);
        if (!opt) continue;
        displayVal = opt.name;
      } else if (isDate) {
        displayVal = formatDateForDisplay(raw, st.type === 'datetime');
      } else {
        displayVal = raw;
      }
      /* st.label and displayVal carry Liferay Object labels / picklist
         values / user dictation — escape everything. */
      pills.push({ stepId: st.id, html:
        `<button type="button" class="field-summary-pill" data-step-id="${escapeHTML(st.id)}">` +
          `<span class="field-summary-label">${escapeHTML(st.label)}:</span>` +
          `<span class="field-summary-value">${escapeHTML(displayVal)}</span>` +
        `</button>`
      });
    }
    if (pills.length === 0) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.innerHTML = pills.map(p => p.html).join('');
    el.hidden = false;
    el.querySelectorAll('button[data-step-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = getFlow()?.steps.find(s => s.id === btn.dataset.stepId);
        if (step) { playSound('fieldChange'); enterStep(step); }
      });
    });
  }

  /* Spanish + English cardinals and ordinals up to ten. Used to map a
     spoken number word to a 1-based image index in the carousel.
     Keys overlap-free across languages; we merge both so the matcher
     works regardless of which locale Web Speech is transcribing in. */
  const NUM_WORDS = {
    /* Spanish 1–31 */
    uno: 1, una: 1, primero: 1, primera: 1,
    dos: 2, segundo: 2, segunda: 2,
    tres: 3, tercero: 3, tercera: 3,
    cuatro: 4, cuarto: 4, cuarta: 4,
    cinco: 5, quinto: 5, quinta: 5,
    seis: 6, sexto: 6, sexta: 6,
    siete: 7, septimo: 7, septima: 7,
    ocho: 8, octavo: 8, octava: 8,
    nueve: 9, noveno: 9, novena: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
    dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
    veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
    treinta: 30, treintayuno: 31,
    /* English 1–31 */
    one: 1, first: 1,
    two: 2, second: 2,
    three: 3, third: 3,
    four: 4, fourth: 4,
    five: 5, fifth: 5,
    six: 6, sixth: 6,
    seven: 7, seventh: 7,
    eight: 8, eighth: 8,
    nine: 9, ninth: 9,
    ten: 10, tenth: 10,
    eleven: 11, eleventh: 11,
    twelve: 12, twelfth: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19,
    twenty: 20, twentyone: 21, twentytwo: 22, twentythree: 23, twentyfour: 24,
    twentyfive: 25, twentysix: 26, twentyseven: 27, twentyeight: 28, twentynine: 29,
    thirty: 30, thirtyone: 31,
    /* Italian 1–31 (words shared with Spanish — uno, sei, quarto… — already
       map to the same value above) */
    primo: 1, prima: 1,
    due: 2, secondo: 2, seconda: 2,
    tre: 3, terzo: 3, terza: 3,
    quattro: 4, quarto: 4, quarta: 4,
    cinque: 5,
    sei: 6,
    sesto: 6, sesta: 6,
    sette: 7, settimo: 7, settima: 7,
    otto: 8,
    nove: 9, nono: 9, nona: 9,
    dieci: 10, decimo: 10, decima: 10,
    undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15,
    sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19,
    venti: 20, ventuno: 21, ventidue: 22, ventitre: 23, ventiquattro: 24,
    venticinque: 25, ventisei: 26, ventisette: 27, ventotto: 28, ventinove: 29,
    trenta: 30, trentuno: 31,
  };

  function matchImageFromVoice(text) {
    const t = normalize(text);
    const list = api.getCoverImages();
    if (!list.length) return null;

    const byName = list.find(img => t.includes(normalize(img.name)));
    if (byName) return byName;

    const digit = t.match(/\d+/);
    if (digit) {
      const idx = parseInt(digit[0], 10) - 1;
      if (idx >= 0 && idx < list.length) return list[idx];
    }

    const tokens = t.split(/\s+/);
    for (const tok of tokens) {
      const n = NUM_WORDS[tok];
      if (n != null && n - 1 < list.length) return list[n - 1];
    }

    return null;
  }

  const FORM_ERROR_ICON_SVG =
    '<svg class="form-error-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M12 8v5M12 16v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';

  function showFormError(message) {
    const el = document.getElementById('formError');
    if (!el) return;
    /* message can be server-provided text (liferayErrorMessage) — textContent. */
    el.innerHTML = FORM_ERROR_ICON_SVG + '<span></span>';
    el.querySelector('span').textContent = message;
    el.hidden = false;
    announce(message, 'alert');
  }

  function hideFormError() {
    const el = document.getElementById('formError');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  /* Persistent banner for any Liferay connectivity failure (preload, image
     fetch, submit). Shown at top-of-screen until manually dismissed or
     until a successful operation calls hideLiferayError(). The visible
     banner is `aria-live=polite` so it updates without yelling at the SR;
     `announce(msg, 'alert')` separately fires the assertive read so the
     user knows immediately something blocked. */
  function showLiferayError(message, { showCreateSpace = false } = {}) {
    const el   = document.getElementById('liferayError');
    const text = document.getElementById('liferayErrorText');
    if (!el || !text) return;
    /* Never render a mute banner — a stale cached language file can leave a
       freshly-added key missing (s() → ''). Fall back to the connection
       string, and to a hardcoded last resort if even that one is absent. */
    if (!message) message = s('errorLiferayConnection') || 'Could not reach Liferay.';
    const createBtn = document.getElementById('liferayErrorCreateSpace');
    if (createBtn) createBtn.hidden = !showCreateSpace;
    if (text.textContent === message && !el.hidden) return; /* dedupe noise */
    text.textContent = message;
    el.hidden = false;
    announce(message, 'alert');
  }
  function hideLiferayError() {
    const el = document.getElementById('liferayError');
    if (el) el.hidden = true;
  }

  function submitContent() {
    if (!titleValue.trim()) {
      showFormError(s('errorMissingTitle'));
      goToTitle();
      return;
    }
    if (!bodyValue.trim()) {
      showFormError(s('errorMissingContent'));
      setUiMode('flow:body');
      return;
    }
    hideFormError();
    /* Optional "do you want to review formatting first?" gate. Default off
       (user can still ask explicitly via "revisar formato"). Toggle in
       config.<lang>.json via submit.askFormatReview. */
    if (appConfig.submit?.askFormatReview) showAiConfirm();
    else                                   finalizeSubmit();
  }

  /* Mode to return to when the submit-confirm dialog is DISMISSED (Escape)
     rather than answered — answering "no" submits, so dismissal must be a
     third path that just goes back to editing. */
  let aiConfirmReturnTo = null;

  function dismissAiConfirm() {
    if (voicePhase !== 'submitConfirm') return;
    playSound('fieldChange');
    setUiMode(aiConfirmReturnTo || 'flow:body');
    aiConfirmReturnTo = null;
  }

  function showAiConfirm() {
    aiConfirmReturnTo = uiMode;
    setUiMode('flow:ai-confirm');
  }

  function answerAiConfirm(yes) {
    flowTimeout(() => {
      if (yes) startAiReview(true);    /* came from submit flow → accept = submit */
      else     finalizeSubmit();
    }, 650);
  }

  /* ── Format pass (Spanish + English) ──
     A deterministic post-process applied on AI review. Idempotent.
       1. Inline punctuation commands ("punto" → "." etc., "comma" → "," etc.).
       2. Trim + collapse whitespace.
       3. Capitalize first letter (skipping leading ¿ ¡ " ').
       4. Capitalize after sentence-ending punctuation.
       5. Insert comma before common transitional connectors.
       6. Wrap as question if it starts with a question word.
       7. Add final period when no terminal punctuation (and not a question). */

  /* Inline punctuation: spoken word → glyph. ORDER MATTERS: longer / more
     specific phrases must run before their substring counterparts, or the
     shorter ones consume the keyword first. E.g. "abrir interrogación"
     has to land before "interrogación" alone, otherwise "interrogación"
     becomes "?" and "abrir interrogación" never matches → output reads
     "abrir ?" instead of "¿". */
  const INLINE_PUNCT = [
    { re: /\babrir interrogaci[oó]n\b/gi,                                                ch: '¿' },
    { re: /\babrir exclamaci[oó]n\b/gi,                                                  ch: '¡' },
    { re: /\bpunto y coma\b/gi,                                                          ch: ';' },
    { re: /\bpunto e virgola\b/gi,                                                       ch: ';' },
    { re: /\bsemicolon\b/gi,                                                             ch: ';' },
    { re: /\bdos puntos\b/gi,                                                            ch: ':' },
    { re: /\bdue punti\b/gi,                                                             ch: ':' },
    { re: /\bcolon\b/gi,                                                                 ch: ':' },
    { re: /\b(?:signo de interrogaci[oó]n|interrogaci[oó]n|question mark|punto (?:interrogativo|di domanda))\b/gi, ch: '?' },
    { re: /\b(?:signo de exclamaci[oó]n|exclamaci[oó]n|exclamation (?:mark|point)|punto esclamativo)\b/gi, ch: '!' },
    { re: /\b(?:coma|comma|virgola)\b/gi,                                                ch: ',' },
    { re: /\b(?:punto final|punto|period|full stop)\b/gi,                                ch: '.' },
  ];

  /* Question starters in Spanish + English. Catches both question words and
     English auxiliary-fronted yes/no questions. */
  const QUESTION_STARTERS = /^[\s¿¡"'`]*(qué|que|cómo|como|dónde|donde|cuándo|cuando|por\s+qu[eé]|cuál(?:es)?|cual(?:es)?|quién(?:es)?|quien(?:es)?|cuánt[oa]s?|cuant[oa]s?|acaso|what|how|where|when|why|which|who(?:m|se)?|do|does|did|can|could|would|should|will|won['’]?t|is|are|am|was|were|has|have|had|may|might|must|cosa|che(?:\s+cosa)?|dove|perch[eé]|quale|quali|chi|quant[oaie])(?=[\s.,;:!?]|$)/i;

  function applyInlinePunctuation(text) {
    let t = String(text);
    for (const { re, ch } of INLINE_PUNCT) t = t.replace(re, ch);
    /* Closing punctuation: drop whitespace before, ensure one space after. */
    t = t.replace(/\s+([.,!?;:])/g, '$1');
    t = t.replace(/([.,!?;:])(?=\S)/g, '$1 ');
    /* Opening Spanish punctuation: stick to the next word, no space after.
       The space *before* a mid-sentence ¿/¡ is left intact by this rule;
       it only collapses what was inserted by the inline-punct replacements
       themselves (e.g. "abrir interrogación hola" → "¿ hola" → "¿hola"). */
    t = t.replace(/([¿¡])\s+/g, '$1');
    t = t.replace(/ +/g, ' ');
    return t;
  }

  /* Lightweight format pass for real-time dictation. Applies what makes sense
     while the user is still talking: inline punctuation substitutions and
     capitalization. Skips question wrapping, comma-before-transitions and the
     final-period heuristic — those are reserved for the full "Revisar formato"
     review where the text is considered finished. Idempotent. */
  function formatLive(text) {
    if (!text) return '';
    let t = applyInlinePunctuation(text);
    t = t.replace(/^(\W*)(\w)/, (_, p, c) => p + c.toUpperCase());
    t = t.replace(/([.!?]\s+)([a-záéíóúñü])/g, (_, p, c) => p + c.toUpperCase());
    return t;
  }

  function isSpanish() {
    return /^es/i.test(appConfig.locale || '');
  }

  function wrapAsQuestion(t) {
    if (/[?]$/.test(t)) return t;
    t = t.replace(/[.!]$/, '');
    if (isSpanish() && !t.startsWith('¿')) t = '¿' + t;
    return t + '?';
  }

  function formatAsTitle(text) {
    if (!text) return '';
    let t = applyInlinePunctuation(text).trim().replace(/\s+/g, ' ');
    if (!t) return '';
    t = t.replace(/^(\W*)(\w)/, (_, p, c) => p + c.toUpperCase());
    if (QUESTION_STARTERS.test(t)) t = wrapAsQuestion(t);
    return t;
  }

  function formatAsBody(text) {
    if (!text) return '';
    let t = applyInlinePunctuation(text).trim().replace(/\s+/g, ' ');
    if (!t) return '';
    /* Capitalize first letter (skip leading punctuation like ¿ ¡). */
    t = t.replace(/^(\W*)(\w)/, (_, p, c) => p + c.toUpperCase());
    /* Capitalize after sentence-ending punctuation. */
    t = t.replace(/([.!?]\s+)([a-záéíóúñü])/g, (_, p, c) => p + c.toUpperCase());
    /* Comma before common transitional connectors (ES + EN) when missing. */
    t = t.replace(
      /(\S) (pero|aunque|sin embargo|por (?:lo )?tanto|porque|but|although|however|therefore|because|per[oò]|tuttavia|quindi|perch[eé])\b/gi,
      (_, prev, conn) => prev + ', ' + conn
    );
    /* Question wrap if starts with a question word, else final period. */
    if (QUESTION_STARTERS.test(t)) {
      t = wrapAsQuestion(t);
    } else if (!/[.!?…]$/.test(t)) {
      t += '.';
    }
    return t;
  }

  /* When true, "Aceptar" in the review modal also submits the content.
     When false, it just applies the format-reviewed text to the fields and
     returns the user to the body step (no submit). */
  let aiReviewAcceptSubmits = false;

  function startAiReview(submitOnAccept) {
    aiReviewAcceptSubmits = !!submitOnAccept;
    ensureAssist();
    /* The dialog's accessible name follows the state it shows. */
    document.getElementById('aiModalCard')
      ?.setAttribute('aria-label', s('aiLoadingTitle') || 'Reviewing');
    const loading = document.getElementById('aiModalLoading');
    const result  = document.getElementById('aiModalResult');
    const btn     = document.getElementById('aiResultAccept');
    if (btn) {
      btn.textContent = submitOnAccept
        ? (s('aiReviewAccept')     || 'Aceptar y enviar')
        : (s('aiReviewAcceptOnly') || 'Aceptar');
    }
    /* Show which reviewer is running: the Gemini model when configured, or
       a "local formatting" label for the built-in deterministic pass. */
    const modelEl = document.getElementById('aiLoadingModel');
    if (modelEl) {
      modelEl.textContent = assist?.review
        ? s('aiLoadingModel', { model: appConfig.assist?.model || assist.name })
        : s('aiLoadingModelLocal');
    }
    loading.hidden = false;
    result.hidden  = true;
    setUiMode('flow:ai-loading');

    /* ── Two clearly separated review paths ──

       DETERMINISTIC (default, always present): formatAsTitle / formatAsBody,
       a <1 ms regex/rules pass. Wrapped in a 500 ms delay only so the
       loading modal doesn't flash. This is the path when NO assist provider
       is configured — the prototype is fully functional here on its own.

       GEMINI (optional, only when `assist` is configured): a real network
       call that improves the wording. The result modal fires when the
       response lands (no fake delay). ANY failure falls back to the
       deterministic pass, so the feature is purely additive. */
    if (assist?.review) {
      runGeminiReview();
    } else {
      flowTimeout(() => showAiReviewResult(deterministicReview()), 500);
    }
  }

  /* The built-in, always-available reviewer. */
  function deterministicReview() {
    return {
      title:    formatAsTitle(titleValue),
      subtitle: hasSubtitleStep() ? formatAsTitle(subtitleValue) : '',
      body:     formatAsBody(bodyValue),
    };
  }

  /* The optional Gemini reviewer. Guards against the flow ending mid-request
     via flowSessionId, and falls back to the deterministic pass on any error
     so a failed/slow call can never strand the user in the loading modal. */
  function runGeminiReview() {
    const sid = flowSessionId;
    assist.review({ title: titleValue, subtitle: subtitleValue, body: bodyValue })
      .then(r => {
        if (sid !== flowSessionId) return;
        showAiReviewResult({
          title:    r.title ?? titleValue,
          subtitle: hasSubtitleStep() ? (r.subtitle ?? subtitleValue) : '',
          body:     r.body  ?? bodyValue,
        });
      })
      .catch(err => {
        console.warn('[assist] Gemini review failed — using deterministic format pass:', err);
        if (sid !== flowSessionId) return;
        showAiReviewResult(deterministicReview());
      });
  }

  /* Render reviewed values into the result modal. Shared by both paths so
     the UI wiring lives in exactly one place. */
  function showAiReviewResult({ title, subtitle, body }) {
    reviewedTitle    = title;
    reviewedSubtitle = hasSubtitleStep() ? subtitle : '';
    reviewedBody     = body;
    document.getElementById('aiResultTitle').textContent    = reviewedTitle;
    document.getElementById('aiResultSubtitle').textContent = reviewedSubtitle;
    document.getElementById('aiResultBody').textContent     = reviewedBody;
    /* Show the subtitle row only when the current flow has a subtitle step
       AND the user actually dictated something there. */
    document.getElementById('aiResultSubtitleRow').hidden = !(hasSubtitleStep() && reviewedSubtitle);
    document.getElementById('aiModalLoading').hidden = true;
    document.getElementById('aiModalResult').hidden  = false;
    document.getElementById('aiModalCard')
      ?.setAttribute('aria-label', s('aiReviewTag') || 'Review');
    setUiMode('flow:ai-review');
  }

  function answerAiReview(accept) {
    const wasSubmitting = aiReviewAcceptSubmits;
    flowTimeout(() => {
      if (accept) {
        if (reviewedTitle)    titleValue    = reviewedTitle;
        if (reviewedSubtitle) subtitleValue = reviewedSubtitle;
        if (reviewedBody)     bodyValue     = reviewedBody;
        if (wasSubmitting) { finalizeSubmit(); return; }
      }
      /* Either accept-only or reject — return to the body step with the
         (possibly updated) values. setUiMode('flow:body') re-renders the
         field cursors. */
      setUiMode('flow:body');
      reviewedTitle    = '';
      reviewedSubtitle = '';
      reviewedBody     = '';
      aiReviewAcceptSubmits = false;
    }, 650);
  }

  async function finalizeSubmit() {
    /* Pick the right API method based on the flow's submitApi declaration. */
    const flow    = getFlow();
    const apiName = flow?.submitApi || 'submitWebContent';
    let payload;
    if (flow?.__dynamic) {
      /* Walk the flow's steps and build a flat field map, keyed by the
         backend field name (step.__field). Empty values are dropped so the
         server keeps its defaults / leaves them null. */
      const fields = {};
      for (const st of flow.steps) {
        if (st.id === 'space' || !st.__field) continue;
        let v = readStepValue(st);
        if (v == null || String(v).trim() === '') continue;
        if (st.id.startsWith('bool:'))   v = (v === 'true');
        else if (st.type === 'number')   { v = Number(v); if (isNaN(v)) continue; }
        else if (st.type === 'date')     v = String(v).slice(0, 10) + 'T00:00:00.000Z';
        else if (st.type === 'datetime') {
          const s = String(v);
          const base = s.length === 16 ? s + ':00' : s.slice(0, 19);
          v = base + '.000Z';
        }
        fields[st.__field] = v;
      }
      payload = {
        restContextPath: flow.__restContextPath,
        scopeId:         selectedSpace?.id ?? null,
        fields,
      };
    } else {
      payload = {
        spaceId:      selectedSpace?.id ?? null,
        title:        titleValue,
        subtitle:     subtitleValue,
        content:      bodyValue,
        coverImage:   selectedCoverImage ?? null,
        coverImageId: selectedCoverImage?.id ?? null,
        file:         selectedFile,
      };
    }
    const fn = typeof api[apiName] === 'function' ? api[apiName] : api.submitWebContent;

    /* No flashCommandDetected here — the keycap traveling from the corner
       back to the centre + the prominent "Enviado" message already
       telegraph the action. The purple flash + label would just stack
       visually with the bars settling and the sent-msg animating in.
       The command sound has already been played by handleFlowCommand
       (voice path) or by the modal click handler (button path), so we
       don't repeat it here either. */
    /* Await the actual call. The api method has already shown the
       connection banner if it was a network failure; for server errors
       (4xx/5xx — wrong shape, missing permission, etc.) we surface the
       message inline as a form error and KEEP the form state so the user
       can fix and retry. Only on success do we wipe and play the
       "Enviado" cascade. */
    const result = await fn(payload);
    if (result && result.ok === false) {
      if (result.kind !== 'network') showFormError(result.error || s('errorLiferayConnection'));
      return;
    }

    newFlowSession();
    skipNextFinal = true;
    resetContentFlow();
    setUiMode('submitted');

    flowTimeout(() => {
      setUiMode('listening:command');
      startHintTimer();
    }, 2950);
  }

  function cancelFlow() {
    newFlowSession();
    skipNextFinal = true;
    spaceMatchOnInterim = false;
    resetContentFlow();
    setUiMode('listening:command');
    startHintTimer();
  }

  function goToTitle() {
    setUiMode('flow:title');
  }

  function clearTitle() {
    titleValue = '';
    setUiMode('flow:title');
    announce(s('announceFieldCleared', { field: getStep('title')?.label || '' }));
  }

  function goToContent() {
    if (voicePhase === 'title' || voicePhase === 'subtitle') {
      startBodyPhase();
      return;
    }
    if (voicePhase === 'body') setUiMode('flow:body');
  }

  function clearBodyContent() {
    bodyValue = '';
    setUiMode('flow:body');
    announce(s('announceFieldCleared', { field: getStep('content')?.label || '' }));
  }

  /* Lightweight acknowledgement for low-priority global commands ("help",
     "exit") — single short chirp + dedup of the rest of the utterance.
       - `commandBoostUntil` blocks re-match for 900 ms.
       - `skipNextFinal` drops the residual final ("ayuda" / "salir").
       - `dropResidualInterims` drops the residual interims of the same
         utterance — STT often emits several before the final lands.
     Without all three, the final ~1 s later (or any interim past the
     boost window) re-fires the command and you hear a second chirp. */
  function ackCommand() {
    playSound('ack');
    commandBoostUntil    = performance.now() + 900;
    skipNextFinal        = true;
    dropResidualInterims = true;
  }

  const FIELD_CHANGE_ACTIONS = new Set(['goToStep', 'clearStep', 'exitStep', 'selectFile', 'deleteLastWord']);

  /* Actions whose recognition shouldn't fire the purple flash + bars-label
     pill. Today only `submit`: the keycap traveling from corner back to
     centre + the prominent "Enviado" message already telegraph the action,
     and the flash visually collides with the bars settling. The matcher
     still plays the command sound for non-visual feedback. */
  const NO_FLASH_ACTIONS = new Set(['submit']);

  function dispatchFlowAction(cmd) {
    const action = cmd.action;
    const stepId = cmd.params?.step;
    if (action === 'goBack') {
      const sid = cmd.params?.stepId;
      const prev = sid ? prevStepBefore(sid) : null;
      if (prev) { playSound('fieldChange'); enterStep(prev); }
      return;
    }
    if (action === 'cancel')         return cancelFlow();
    if (action === 'submit')         return submitFlow();
    if (action === 'selectFile')     return openFileDialog();
    if (action === 'exitStep')       return exitImageStep();
    if (action === 'aiReview')       return startAiReview(false);
    if (action === 'aiYes')          return answerAiConfirm(true);
    if (action === 'aiNo')           return answerAiConfirm(false);
    if (action === 'aiAccept')       return answerAiReview(true);
    if (action === 'aiCancel')       return answerAiReview(false);
    if (action === 'deleteLastWord') return deleteLastWord();
    if (action === 'showFormatCommands')  return showFormatList();
    if (action === 'closeFormatCommands') return hideFormatList();
    if (action === 'goToStep') {
      if (stepId === 'title')        return goToTitle();
      if (stepId === 'subtitle')     return goToSubtitle();
      if (stepId === 'coverImage')   return showImageCarousel();
      /* For 'content' and any dynamic step id (picklist:*, file, etc.) just
         route through enterStep — mapping step.type to the right setUiMode.
         The old `goToContent` had a `voicePhase ∈ {title|subtitle|body}` guard
         that silently no-op'd when invoked from options/space; enterStep
         doesn't gate on phase. */
      const st = getStep(stepId);
      if (st) return enterStep(st);
    }
    if (action === 'clearStep') {
      if (stepId === 'title')        return clearTitle();
      if (stepId === 'subtitle')     return clearSubtitle();
      if (stepId === 'content')      return clearBodyContent();
      if (stepId === 'coverImage')   return clearCoverImage();
      const st = getStep(stepId);
      if (st?.type === 'options')    return clearOptionsStep(stepId);
      if (st?.id?.startsWith('text:'))              return clearDynamicTextField(stepId);
      if (st?.type === 'number')                    return clearNumberStep(stepId);
      if (st?.type === 'date' || st?.type === 'datetime') return clearDateStep(stepId);
    }
  }

  function clearCoverImage() {
    clearCoverThumb();
    document.querySelectorAll('.carousel-card.selected').forEach(c => c.classList.remove('selected'));
    announce(s('announceImageCleared'));
  }

  /* Drop the last word from the active dictation field. Strips one trailing
     "word" (any non-whitespace run) plus any trailing punctuation/space left
     dangling. Language-agnostic — works in ES, EN, etc. */
  function deleteLastWord() {
    const drop = (text) => {
      let t = String(text || '').trim();
      t = t.replace(/\s*\S+\s*$/, '');
      t = t.replace(/[\s,;:]+$/, '');
      return t;
    };
    if (voicePhase === 'title') {
      titleValue = drop(titleValue);
      renderField(titleText, titleValue, false, true);
    } else if (voicePhase === 'subtitle') {
      subtitleValue = drop(subtitleValue);
      renderField(subtitleText, subtitleValue, false, true);
    } else if (voicePhase === 'body') {
      bodyValue = drop(bodyValue);
      renderField(bodyText, bodyValue, false, true);
    } else if (voicePhase === 'dynamicText' && dynamicTextStepId) {
      dynamicFieldValues[dynamicTextStepId] = drop(dynamicFieldValues[dynamicTextStepId] || '');
      const dynInput = dynamicTextFieldsContainer
        ?.querySelector(`input[data-step-id="${dynamicTextStepId}"]`);
      if (dynInput) renderField(dynInput, dynamicFieldValues[dynamicTextStepId], false);
    }
    announce(s('announceWordRemoved'));
  }

  /* Top-level submit dispatcher — picks the right submit logic based on the
     current flow's `submitApi` (matches an api method name). Defaults to
     submitContent for content/blog flows. */
  function submitFlow() {
    const flow    = getFlow();
    const apiName = flow?.submitApi;
    if (apiName === 'uploadFile')        return submitFile();
    if (apiName === 'submitObjectEntry') return submitDynamic();
    return submitContent();
  }

  /* Validate every required step in a dynamic flow before submitting. On
     first missing required value, jump back to that step + show an inline
     form error (or announce it for the options step where there's no
     content panel). */
  function submitDynamic() {
    const flow = getFlow();
    const tpl  = dynamicTpl();
    if (!flow?.__dynamic) return submitContent();
    for (const st of flow.steps) {
      if (st.id === 'space') continue;
      if (!st.__required) continue;
      const v = readStepValue(st);
      if (v == null || String(v).trim() === '') {
        const msg = fillTpl(tpl.errorMissing, { label: st.label });
        if (st.type === 'options') {
          announce(msg, 'alert');
          enterStep(st);
        } else {
          showFormError(msg);
          enterStep(st);
        }
        return;
      }
    }
    hideFormError();
    finalizeSubmit();
  }

  function submitFile() {
    if (!selectedFile) {
      showFormError(s('errorMissingFile'));
      return;
    }
    hideFormError();
    /* File uploads skip the AI review confirmation — go straight to upload. */
    finalizeSubmit();
  }

  function getActiveCommands() {
    const flow = getFlow();
    if (!flow) return [];
    if (voicePhase === 'submitConfirm') return flowsConfig?.modalCommands?.aiConfirm ?? [];
    if (voicePhase === 'aiReview')      return flowsConfig?.modalCommands?.aiReview  ?? [];
    if (voicePhase === 'aiLoading')     return [];
    if (voicePhase === 'formatList')    return flowsConfig?.modalCommands?.formatList ?? [];
    if (voicePhase === 'image') {
      return getStep('coverImage')?.flowCommands ?? [];
    }
    const backCmd = stepId => ({
      id: 'go-back', label: 'Volver', action: 'goBack', params: { stepId },
      phrases: ['volver', 'back', 'torna', 'anterior', 'go back'],
    });
    if (voicePhase === 'options') {
      const cmds = flow.flowCommands.filter(c => c.action === 'cancel');
      if (optionsPhaseStepId && prevStepBefore(optionsPhaseStepId)) cmds.push(backCmd(optionsPhaseStepId));
      return cmds;
    }
    if (voicePhase === 'space') {
      return flow.flowCommands.filter(c => c.action === 'cancel');
    }
    if (voicePhase === 'numberInput' || voicePhase === 'dateInput') {
      const stepId = voicePhase === 'numberInput' ? numberInputStepId : dateInputStepId;
      const cmds = flow.flowCommands.filter(c => c.action === 'cancel');
      if (stepId && prevStepBefore(stepId)) cmds.push(backCmd(stepId));
      return cmds;
    }
    return flow.flowCommands;
  }

  function handleFlowCommand(text) {
    const t = normalize(text);
    for (const cmd of getActiveCommands()) {
      const phrases = [...(cmd.phrases || []), ...(cmd.aliases || [])];
      if (matchPhrase(t, phrases)) {
        hideCancelConfirm();
        dispatchFlowAction(cmd);
        const sound = FIELD_CHANGE_ACTIONS.has(cmd.action) ? 'fieldChange' : 'command';
        /* `submit` skips the flash — the action's own visuals (keycap
           returning to centre + "Enviado") already cover it. Sound stays. */
        if (NO_FLASH_ACTIONS.has(cmd.action)) playSound(sound);
        else                                  flashCommandDetected(cmd.label, sound);
        return true;
      }
    }
    return false;
  }

  function matchSpaceFromVoice(text) {
    const t = normalize(text);
    return api.getSpaces().find(sp => t.includes(normalize(sp.name))) || null;
  }

  /* Wipes flow-local state. DOM is owned by setUiMode — callers should
     follow this with setUiMode('idle' | 'listening:command' | 'submitted'). */
  function resetContentFlow() {
    skipNextFinal        = false;
    dropResidualInterims = false;
    utteranceInFlight    = false;
    imagePhaseReturnTo   = null;
    formatListReturnTo   = null;
    optionsPhaseStepId   = null;
    dynamicTextStepId    = null;
    numberInputStepId    = null;
    dateInputStepId      = null;
    dateInputParts       = { d: null, m: null, y: null };
    titleValue    = '';
    subtitleValue = '';
    bodyValue     = '';
    selectedSpace = null;
    selectedCoverImage = null;
    selectedFile  = null;
    dynamicFieldValues = {};
    if (dynamicTextFieldsContainer) dynamicTextFieldsContainer.innerHTML = '';
    document.getElementById('numberInputPanel')?.classList.remove('dictating');
    document.getElementById('dateInputPanel')?.classList.remove('dictating');
    document.getElementById('spaceCreatePanel')?.classList.remove('dictating');
    document.querySelector('.stage')?.classList.remove('hide-keycap');
    spaceCreateValue = '';
    /* Reset placeholders to the locale defaults — a dynamic flow may have
       mutated them to its own field labels via applyFlowFieldLabels. */
    resetFlowFieldLabels();
  }

  /* Provider-agnostic speech result handler. Receives interim and/or final
     text (either may be empty). All voicePhase routing lives here. */
  function handleSpeechResult({ interim, final }) {
    interim = interim || '';
    final   = final   || '';
    if (fieldMicMuted) return;

    /* Track whether an utterance is currently being spoken: a final ends it,
       a bare interim means it's still going. Read by enterNextStep to drop a
       residual that's in flight when a content field appears. */
    if (final)        utteranceInFlight = false;
    else if (interim) utteranceInFlight = true;

    /* Drain pending residuals from the previous utterance: a `final` clears
       both flags (utterance has ended); a bare `interim` while
       `dropResidualInterims` is on gets discarded so it can't leak into
       the next phase's input. */
    if (final && skipNextFinal) {
      skipNextFinal = false;
      dropResidualInterims = false;
      return;
    }
    if (interim && dropResidualInterims && !final) return;

    const text = (final || interim).trim();
    const norm = normalize(text);

    if (voicePhase === 'command') {
      if (!flowsConfig) return;
      /* Dedupe rapid re-matches: Web Speech often emits multiple `interim`
         events that already contain the matched phrase ("crear blog")
         before the `final` lands. Without a gate every one of those
         interims re-fires the command sound + flash. We piggy-back on
         `commandBoostUntil` (set by `flashCommandDetected` for 900 ms) —
         while the purple flash is active, ignore further matches. Keeps
         recognition fast (still on interim) but caps it to one fire per
         utterance. */
      if (performance.now() < commandBoostUntil) return;
      for (const cmd of flowsConfig.globalCommands) {
        const phrases = [...(cmd.phrases || []), ...(cmd.aliases || [])];
        if (matchPhrase(norm, phrases)) {
          if (cmd.id === 'help')                  { ackCommand(); showCommandList(); return; }
          if (cmd.id === 'exit')                  {
            ackCommand();
            hideCancelConfirm();
            toIdle();
            /* toIdle → resetContentFlow clears skipNextFinal +
               dropResidualInterims that ackCommand just set. Reapply so
               the residual final of "salir" still gets dropped on its
               way through the top guard. */
            skipNextFinal        = true;
            dropResidualInterims = true;
            return;
          }
          if (cmd.action === 'createSpace')       { flashCommandDetected(cmd.label); enterSpaceCreate(); return; }
          if (cmd.triggersFlow)                   { startContentFlow(cmd.triggersFlow, cmd.label); return; }
        }
      }

    } else if (voicePhase === 'submitConfirm' || voicePhase === 'aiReview' || voicePhase === 'formatList') {
      if (final) handleFlowCommand(final);

    } else if (voicePhase === 'aiLoading') {
      return;

    } else if (voicePhase === 'space') {
      if (final && handleFlowCommand(final)) return;
      const space = matchSpaceFromVoice(text);
      if (space && final) selectSpace(space);
      else if (space && interim && spaceMatchOnInterim) selectSpace(space);

    } else if (voicePhase === 'image') {
      if (final && handleFlowCommand(final)) return;
      const img = final ? matchImageFromVoice(final) : null;
      if (img) {
        const idx  = api.getCoverImages().indexOf(img);
        const card = findClosestCardByIdx(idx);
        selectCoverImage(img, card);
      }

    } else if (voicePhase === 'options') {
      if (final && handleFlowCommand(final)) return;
      const step = optionsPhaseStepId ? getStep(optionsPhaseStepId) : null;
      if (!step) return;
      const opt = final ? matchOptionFromVoice(final, step) : null;
      if (opt) {
        const card = document.querySelector(
          `#optionsList .option-card[data-option-key="${opt.key}"]`
        );
        selectOption(step, opt, card);
      }

    } else if (voicePhase === 'spaceCreate') {
      const field = document.getElementById('spaceCreateField');
      if (!field || field.disabled) return;
      if (final) {
        const n = normalize(final);
        if (matchPhrase(n, SPACE_CREATE_CANCEL))  { playSound('fieldChange'); exitSpaceCreate(); return; }
        if (matchPhrase(n, SPACE_CREATE_CONFIRM)) {
          /* The command word itself was previewed into the field as an
             interim ("Pablito confirm") — restore the committed value
             before creating. */
          field.value = spaceCreateValue;
          field.classList.remove('field-interim');
          confirmSpaceCreate();
          return;
        }
        spaceCreateValue = (spaceCreateValue + ' ' + final).trim();
        field.value = spaceCreateValue;
        field.classList.remove('field-interim');
        syncSpaceCreateOverflow(field);
        announce(spaceCreateValue);
      } else if (interim) {
        field.value = (spaceCreateValue + ' ' + interim).trim();
        field.classList.add('field-interim');
        syncSpaceCreateOverflow(field);
      }

    } else if (voicePhase === 'file') {
      if (final) handleFlowCommand(final);

    } else if (voicePhase === 'title') {
      if (final && handleFlowCommand(final)) {
        renderField(titleText, titleValue, false, voicePhase === 'title');
        return;
      }
      /* Don't pipe STT into a field the user is typing into. Manual edits
         win for whichever field has the real focus. */
      if (fieldIsFocused(titleText)) return;
      const rawTitle  = titleValue ? titleValue + ' ' + (interim || final) : (interim || final);
      const liveTitle = formatLive(rawTitle).trim();
      renderField(titleText, liveTitle, !!interim);
      if (final) {
        const wasEmpty   = !titleValue;
        const combined   = titleValue ? titleValue + ' ' + final.trim() : final.trim();
        titleValue       = formatLive(combined).trim();
        renderField(titleText, titleValue, false);
        if (titleValue) hideFormError();
        announce(final.trim());
        if (wasEmpty) {
          /* Auto-advance: dynamic flows respect their declared step order;
             hardcoded flows go title → subtitle → body. */
          const flow = getFlow();
          if (flow?.__dynamic) {
            const next = nextStepAfter('title');
            if (next) enterStep(next);
          } else if (hasSubtitleStep()) {
            startSubtitlePhase();
          } else {
            startBodyPhase();
          }
        }
      }

    } else if (voicePhase === 'subtitle') {
      if (final && handleFlowCommand(final)) {
        renderField(subtitleText, subtitleValue, false, voicePhase === 'subtitle');
        return;
      }
      if (fieldIsFocused(subtitleText)) return;
      const rawSub  = subtitleValue ? subtitleValue + ' ' + (interim || final) : (interim || final);
      const liveSub = formatLive(rawSub).trim();
      renderField(subtitleText, liveSub, !!interim);
      if (final) {
        const wasEmpty = !subtitleValue;
        const combined = subtitleValue ? subtitleValue + ' ' + final.trim() : final.trim();
        subtitleValue  = formatLive(combined).trim();
        renderField(subtitleText, subtitleValue, false);
        announce(final.trim());
        if (wasEmpty) {
          const flow = getFlow();
          if (flow?.__dynamic) {
            const next = nextStepAfter('subtitle');
            if (next) enterStep(next); else startBodyPhase();
          } else {
            startBodyPhase();
          }
        }
      }

    } else if (voicePhase === 'body') {
      if (final && handleFlowCommand(final)) {
        renderField(bodyText, bodyValue, false, voicePhase === 'body');
        return;
      }
      if (fieldIsFocused(bodyText)) return;
      const rawBody  = bodyValue ? bodyValue + ' ' + (interim || final) : (interim || final);
      const liveBody = formatLive(rawBody).trim();
      renderField(bodyText, liveBody, !!interim);
      if (final) {
        const wasEmpty = !bodyValue;
        const combined = bodyValue ? bodyValue + ' ' + final.trim() : final.trim();
        bodyValue      = formatLive(combined).trim();
        renderField(bodyText, bodyValue, false);
        if (bodyValue) hideFormError();
        announce(final.trim());
        /* Hardcoded flows (createWebContent / createBlog) leave body open
           so the user can keep dictating sentences. Dynamic flows usually
           have more steps after body (Picklist, Date, …) that would
           otherwise get silently skipped — auto-advance to the next step
           on first non-empty dictation, same heuristic as title. The user
           can still navigate back via "ir a {bodyLabel}". */
        if (wasEmpty) {
          const flow = getFlow();
          if (flow?.__dynamic) {
            const next = nextStepAfter('content');
            if (next) enterStep(next);
          }
        }
      }

    } else if (voicePhase === 'dynamicText') {
      if (final && handleFlowCommand(final)) return;
      const step = dynamicTextStepId ? getStep(dynamicTextStepId) : null;
      if (!step) return;
      const dynInput = dynamicTextFieldsContainer
        ?.querySelector(`input[data-step-id="${step.id}"]`);
      if (dynInput && document.activeElement === dynInput) return;
      const current = dynamicFieldValues[step.id] || '';
      const rawVal  = current ? current + ' ' + (interim || final) : (interim || final);
      const liveVal = formatLive(rawVal).trim();
      if (dynInput) renderField(dynInput, liveVal, !!interim);
      if (final) {
        const wasEmpty = !current;
        const combined = current ? current + ' ' + final.trim() : final.trim();
        dynamicFieldValues[step.id] = formatLive(combined).trim();
        if (dynInput) renderField(dynInput, dynamicFieldValues[step.id], false);
        if (dynamicFieldValues[step.id]) hideFormError();
        announce(final.trim());
        if (wasEmpty) {
          const next = nextStepAfter(step.id);
          if (next) enterStep(next);
        }
      }

    } else if (voicePhase === 'numberInput') {
      if (final && handleFlowCommand(final)) return;
      const numHint = document.getElementById('numberInputHint');
      if (interim && numHint) numHint.textContent = interim;
      if (final) {
        const parsed = parseNumberFromVoice(final);
        if (parsed !== null) {
          if (numHint) numHint.textContent = dynamicTpl().numberInputHint || '';
          const field = document.getElementById('numberInputField');
          if (field) { field.value = String(parsed); field.classList.add('field-interim'); }
          dynamicFieldValues[numberInputStepId] = String(parsed);
          document.getElementById('numberInputPanel')?.classList.add('dictating');
          flowTimeout(() => {
            document.getElementById('numberInputPanel')?.classList.remove('dictating');
            if (field) field.classList.remove('field-interim');
            confirmNumberInput();
          }, 900);
        } else {
          if (numHint) { numHint.textContent = `"${final}" — número no reconocido`; numHint.classList.add('input-hint-error'); }
          announce(s('errorInvalidNumber') || 'Número no reconocido', 'alert');
          flowTimeout(() => { if (numHint) { numHint.textContent = dynamicTpl().numberInputHint || ''; numHint.classList.remove('input-hint-error'); } }, 2500);
        }
      }

    } else if (voicePhase === 'dateInput') {
      if (final && handleFlowCommand(final)) return;
      const dateHint = document.getElementById('dateInputHint');
      if (interim && dateHint && !dateInputParts.d && !dateInputParts.m && !dateInputParts.y) {
        dateHint.textContent = interim;
      }
      if (final) {
        // Try full date first
        let iso = parseDateFromVoice(final);
        if (iso) {
          const stepDt = dateInputStepId ? getStep(dateInputStepId) : null;
          if (stepDt?.type === 'datetime' && iso.length === 10) iso = iso + 'T00:00';
          dateInputParts = { d: null, m: null, y: null };
          updateDateHintFromParts();
          const field = document.getElementById('dateInputField');
          if (field) field.value = iso;
          dynamicFieldValues[dateInputStepId] = iso;
          const step = dateInputStepId ? getStep(dateInputStepId) : null;
          announce(formatDateForDisplay(iso, step?.type === 'datetime'));
          flowTimeout(() => {
            document.getElementById('dateInputPanel')?.classList.remove('dictating');
            confirmDateInput();
          }, 900);
        } else {
          // Try extracting a single component (day, month, or year)
          const part = extractDatePart(final);
          if (part) {
            dateInputParts = { ...dateInputParts, ...part };
            const { d, m, y } = dateInputParts;
            if (d && m && y) {
              // All parts collected — build ISO and confirm
              const step = dateInputStepId ? getStep(dateInputStepId) : null;
              const base = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              const iso2 = step?.type === 'datetime' ? `${base}T00:00` : base;
              const field = document.getElementById('dateInputField');
              if (field) field.value = iso2;
              dynamicFieldValues[dateInputStepId] = iso2;
              updateDateHintFromParts();
              announce(formatDateForDisplay(iso2, step?.type === 'datetime'));
              flowTimeout(() => {
                document.getElementById('dateInputPanel')?.classList.remove('dictating');
                confirmDateInput();
              }, 900);
            } else {
              playSound('fieldChange');
              updateDateHintFromParts();
            }
          } else {
            if (dateHint) { dateHint.textContent = `"${final}" — no reconocido`; dateHint.classList.add('input-hint-error'); }
            announce(s('errorInvalidDate') || 'Fecha no reconocida', 'alert');
            flowTimeout(() => updateDateHintFromParts(), 2500);
          }
        }
      }
    }
  }

  function handleSpeechEnd() {
    /* Auto-restart while we're still listening — Web Speech API stops the
       session every now and then on its own. */
    if (fieldMicMuted) return;
    if (appState === 'listening' || appState === 'speaking') speech?.start();
  }

  function ensureSpeech() {
    if (speech) return;
    const providerName = appConfig.speech?.provider ?? 'web-speech';
    speech = createSpeechProvider(providerName, {
      locale:   appConfig.locale,
      onResult: handleSpeechResult,
      onEnd:    handleSpeechEnd,
      onError:  err => {
        console.warn('[speech]', providerName, 'error:', err?.error || err);
        /* `no-speech` and `aborted` are normal idle/restart noise — don't
           bother SR users. Real errors do get announced. */
        const code = err?.error || '';
        if (code && code !== 'no-speech' && code !== 'aborted') {
          announce(s('announceSpeechError'), 'alert');
        }
      },
    });
  }

  /* Browsers without SpeechRecognition (e.g. Firefox today) get an explicit
     degraded mode instead of a silent dead mic: an informative banner, an
     assertive announcement, and the command list opened right away so every
     flow can be started by click — the rest of the app (typing, pickers,
     pills, Enter) is already mouse/keyboard operable. */
  let speechUnavailableNotified = false;
  function notifySpeechUnavailable() {
    showLiferayError(s('errorNoSpeech') || 'Speech recognition is not available in this browser.');
    if (!speechUnavailableNotified) {
      speechUnavailableNotified = true;
      announce(s('errorNoSpeech'), 'alert');
    }
    /* Deferred: startSpeech runs before setUiMode('listening:command'),
       which would immediately re-hide the list. */
    setTimeout(() => {
      if (isListeningPhase() && voicePhase === 'command') showCommandList();
    }, 150);
  }

  function startSpeech() {
    if (fieldMicMuted) return;
    ensureSpeech();
    if (speech && speech.available === false) {
      notifySpeechUnavailable();
      return;
    }
    speech?.start();
  }

  function stopSpeech() {
    speech?.stop();
  }

