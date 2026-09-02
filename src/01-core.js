/* Liferay Copilot Voice — module 1/8: core
 * Animation engine + shared state: keycap, bars, mic/audio analysis, sounds, state transitions, DOM refs and flow state shared by every other module.
 * Modules share one global scope and load strictly in order (element.js
 * chains them with async=false) — this file was split from the original
 * app.js without reordering, so cross-module references resolve at call
 * time exactly as before.
 */
  const shadow    = document.getElementById('keycapShadow');
  const keycap    = document.getElementById('keycap');
  const micWrap   = document.getElementById('micWrap');
  const micOuter  = document.getElementById('micOuter');
  const barsEl    = document.getElementById('bars');
  const hint      = document.getElementById('hint');
  const spaceLabel = document.getElementById('spaceLabel');
  const barEls    = [1,2,3,4,5].map(i => document.getElementById('bar'+i));

  let appState   = 'idle';
  let morphTimer = null;
  let barsTimer  = null;
  let fieldMicMuted = false;

  /* ─── MICROPHONE + AUDIO ANALYSIS ─── */
  let audioCtx     = null;
  let analyser     = null;
  let micStream    = null;
  let freqData     = null;
  let silenceTimer = null;

  async function initMic() {
    // Resume suspended context (no new permission prompt)
    if (audioCtx) { audioCtx.resume(); return; }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser  = audioCtx.createAnalyser();
      analyser.fftSize               = 512;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);
      freqData = new Uint8Array(analyser.frequencyBinCount); // 256 bins
    } catch (e) {
      console.warn('Mic unavailable, using sine fallback:', e);
      /* Surface the real reason for SR users — the bars-only fallback is
         fine visually but blind users have no way to know the dictation
         pipeline is broken until they try and nothing happens. */
      const key = e?.name === 'NotAllowedError' ? 'announceMicDenied' : 'announceMicError';
      announce(s(key), 'alert');
    }
  }

  function pauseMic() {
    // Only clear the silence timer — do NOT suspend the AudioContext.
    // Suspending requires a user gesture to resume, which breaks from setTimeout chains.
    // The RAF stops reading from it so CPU cost is negligible while idle.
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  function avgBins(start, end) {
    let s = 0;
    for (let i = start; i < end; i++) s += freqData[i];
    return s / (end - start);
  }

  // Frequency bands for 5 bars (bin ≈ 86Hz at 44100/512)
  const BANDS = [
    [1,  5 ],  // ~86–430Hz    bar1
    [5,  12],  // ~430–1032Hz  bar2
    [12, 28],  // ~1032–2408Hz bar3 (core voice)
    [28, 52],  // ~2408–4472Hz bar4
    [52, 96],  // ~4472–8256Hz bar5
  ];
  const SPEECH_THRESHOLD = 62;  // out of 255 — energy above this flips bars to active mode
  const NOISE_GATE       = 56;  // out of 255 — bars ignore audio energy below this for visual reactivity
  const SILENCE_DELAY    = 700; // ms

  function playSound(kind = 'command') {
    if (!audioCtx) return;
    const g = audioCtx.createGain();
    g.connect(audioCtx.destination);
    function tone(freq, startOffset, dur, vol = 0.12) {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(g);
      const t = audioCtx.currentTime + startOffset;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
    }
    if (kind === 'fieldChange') {
      tone(520, 0,    0.10, 0.07);
      tone(700, 0.05, 0.12, 0.05);
    } else if (kind === 'ack') {
      /* Short acknowledgement chirp for low-priority commands ("help",
         "exit") — conveys "I heard you" without competing with the
         "command" tone reserved for actions that change content state. */
      tone(880, 0, 0.07, 0.05);
    } else {
      tone(660, 0,    0.12);
      tone(880, 0.10, 0.18);
    }
  }

  function detectSpeech(energy) {
    if (performance.now() < commandBoostUntil) return;
    if (energy > SPEECH_THRESHOLD) {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      if (appState === 'listening') toSpeaking();
    } else if (appState === 'speaking' && !silenceTimer) {
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        if (appState === 'speaking') toStopSpeaking();
      }, SILENCE_DELAY);
    }
  }

  /* ─── BAR ANIMATION
     When mic is active: audio-driven heights + auto speech detection.
     Fallback: sine wave simulation (barMode controls idle vs active).
     ─── */
  let rafId   = null;
  let t0      = null;
  let prevNow = null;
  let barMode = 'idle';

  const IDLE_CFG = [
    [28, 14, 2.8, 0.00],
    [55, 22, 2.4, 0.90],
    [38, 17, 3.1, 0.40],
    [55, 22, 2.6, 1.30],
    [28, 14, 2.9, 0.60],
  ];
  const ACTIVE_CFG = [
    [58, 44, 0.56, 0.00],
    [60, 36, 0.44, 0.25],
    [65, 50, 0.38, 0.10],
    [60, 36, 0.50, 0.50],
    [58, 44, 0.62, 0.18],
  ];

  const liveH = [28, 55, 38, 55, 28];

  function startBarAnim() {
    if (rafId) return;
    t0 = prevNow = performance.now();
    (function tick(now) {
      const dt = Math.min((now - prevNow) / 1000, 0.05);
      prevNow  = now;

      if (now < commandBoostUntil) {
        // ── Purple phase: fixed large heights, no audio reactivity ──
        const PURPLE_H = [72, 88, 100, 88, 72];
        PURPLE_H.forEach((target, i) => {
          liveH[i] += (target - liveH[i]) * (1 - Math.exp(-12 * dt));
          barEls[i].style.height = Math.max(6, liveH[i]) + 'px';
        });
      } else if (!fieldMicMuted && analyser && freqData && audioCtx && audioCtx.state === 'running') {
        // ── Audio-driven ──
        analyser.getByteFrequencyData(freqData);

        let total = 0;
        BANDS.forEach(([lo, hi]) => { total += avgBins(lo, hi); });
        const energy = total / BANDS.length;
        detectSpeech(energy);

        /* Noise gate: ignore low-amplitude audio for the visual reactivity so
           ambient noise doesn't make the bars wiggle. The Web Speech API has
           its own VAD and is unaffected by this. */
        const gatedEnergy = Math.max(0, energy - NOISE_GATE);

        const t         = (now - t0) / 1000;
        const cfg       = barMode === 'active' ? ACTIVE_CFG : IDLE_CFG;
        const k         = barMode === 'active' ? 10 : 5;
        const amplBoost = 1 + (gatedEnergy / 255) * 2.5;
        const freqNudge = BANDS.map(([lo, hi]) => Math.max(0, avgBins(lo, hi) - NOISE_GATE) / 255 * 14);

        cfg.forEach(([ctr, amp, period, phase], i) => {
          const target = ctr + amp * amplBoost * Math.sin(2 * Math.PI * t / period + phase) + freqNudge[i];
          liveH[i] += (target - liveH[i]) * (1 - Math.exp(-k * dt));
          barEls[i].style.height = Math.max(6, liveH[i]) + 'px';
        });
      } else {
        // ── Sine fallback ──
        const t   = (now - t0) / 1000;
        const cfg = barMode === 'active' ? ACTIVE_CFG : IDLE_CFG;
        const k   = barMode === 'active' ? 10 : 4;
        cfg.forEach(([ctr, amp, period, phase], i) => {
          const target = ctr + amp * Math.sin(2 * Math.PI * t / period + phase);
          liveH[i] += (target - liveH[i]) * (1 - Math.exp(-k * dt));
          barEls[i].style.height = Math.max(6, liveH[i]) + 'px';
        });
      }

      rafId = requestAnimationFrame(tick);
    })(t0);
  }

  function stopBarAnim() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function setBarMode(mode) { barMode = mode; }

  const GRAY_COLS   = ['#E7E7ED','#E7E7ED','#E7E7ED','#E7E7ED','#E7E7ED'];
  const BLUE_COLS   = ['#D7E4FF','#B3CDFF','#80ACFF','#B3CDFF','#D7E4FF'];
  const PURPLE_COLS = ['#DDD6FE','#C4B5FD','#7B6FEE','#C4B5FD','#DDD6FE'];

  let commandBoostUntil = 0; // performance.now() timestamp until which bars are boosted

  function setBarColors(cols, ms = 0) {
    barEls.forEach((b, i) => {
      b.style.transition = ms ? `background ${ms}ms ease` : 'none';
      b.style.background = cols[i];
    });
  }

  /* ─── Keycap helpers ─── */
  const SPRING   = 'cubic-bezier(0.34,1.56,0.64,1)';
  const BOUNCE   = 'cubic-bezier(0.34,2.2,0.64,1)';
  const EASE_OUT = 'cubic-bezier(0.25,0.46,0.45,0.94)';

  function keycapT(props) {
    const parts = Object.entries(props).map(([p,[d,e]]) => `${p} ${d}s ${e}`);
    keycap.style.transition = parts.join(', ');
    shadow.style.transition = parts.join(', ');
  }

  function applyKeycap({
    tx = 'translate(-50%,-50%)', w = 656, h = 222, r = 24,
    bc = '#CDCED9', sh = '0 20px 60px 0 rgba(39,40,51,0.15)', op = '1'
  } = {}) {
    keycap.style.transform    = tx;
    keycap.style.width        = w + 'px';
    keycap.style.height       = h + 'px';
    keycap.style.borderRadius = r + 'px';
    keycap.style.borderColor  = bc;
    keycap.style.opacity      = op;
    shadow.style.transform    = tx;
    shadow.style.width        = w + 'px';
    shadow.style.height       = h + 'px';
    shadow.style.borderRadius = r + 'px';
    shadow.style.boxShadow    = sh;
    shadow.style.opacity      = op;
  }

  /* ─── Reset bars to idle/oval state (bar3 = mic oval, others invisible) ─── */
  function setBarsOval() {
    barsEl.style.transition = 'none';
    barsEl.style.top        = '119px';
    barsEl.style.gap        = '0px';
    barEls.forEach((b, i) => {
      b.style.transition   = 'none';
      b.style.borderRadius = i === 2 ? '24px' : '10px';
      b.style.width        = i === 2 ? '48px' : '0px';
      b.style.height       = i === 2 ? '80px' : '4px';
      b.style.background   = i === 2 ? '#5791FF' : '#E7E7ED';
      b.style.opacity      = i === 2 ? '1'     : '0';
    });
  }

  /* ─── STATE TRANSITIONS ─── */

  function toIdle() {
    const fromListening = appState === 'listening' || appState === 'speaking';
    appState = 'idle';
    newFlowSession();
    clearTimeout(morphTimer);
    clearTimeout(barsTimer);
    stopBarAnim();
    pauseMic();
    stopSpeech();
    clearHintTimer();
    resetContentFlow();
    setFieldMicMuted(false, { silent: true, skipSpeech: true });

    /* Belt-and-braces: hide any transient overlays/labels that aren't covered
       by clearHintTimer/resetContentFlow (e.g. mid-flash bars-label, "Enviado"). */
    document.getElementById('barsLabel').classList.remove('visible');
    document.getElementById('sentMsg').classList.remove('visible');
    commandBoostUntil = 0;

    hint.classList.remove('hidden');
    spaceLabel.style.opacity = '1';
    micOuter.style.opacity   = '1';

    if (fromListening) {
      /* Bar3 springs from bar → oval. Other bars shrink. Container snaps back up. */
      barsEl.style.transition = 'none';
      barsEl.style.top        = '119px';
      void barsEl.offsetWidth;
      barsEl.style.transition = 'gap 0.35s ease';
      barsEl.style.gap        = '0px';

      barEls.forEach((b, i) => {
        if (i === 2) {
          b.style.transition   =
            `width 0.38s ${SPRING}, height 0.38s ${SPRING},` +
            `border-radius 0.38s ${SPRING}, background 0.3s ease`;
          b.style.width        = '48px';
          b.style.height       = '80px';
          b.style.borderRadius = '24px';
          b.style.background   = '#5791FF';
        } else {
          b.style.transition = 'width 0.25s ease, opacity 0.2s ease';
          b.style.width      = '0px';
          b.style.opacity    = '0';
        }
      });

      /* Snap keycap to rect (invisible) then fade in */
      keycap.style.transition   = 'none';
      shadow.style.transition   = 'none';
      keycap.style.width        = '656px';
      keycap.style.height       = '222px';
      keycap.style.borderRadius = '24px';
      keycap.style.transform    = 'translate(-50%,-50%)';
      keycap.style.borderColor  = '#CDCED9';
      keycap.style.background   = '#F7F8F9';
      keycap.style.opacity      = '0';
      shadow.style.width        = '656px';
      shadow.style.height       = '222px';
      shadow.style.borderRadius = '24px';
      shadow.style.transform    = 'translate(-50%,-50%)';
      shadow.style.boxShadow    = '0 20px 60px 0 rgba(39,40,51,0.15)';
      shadow.style.opacity      = '0';
      micWrap.style.opacity     = '1';
      micWrap.style.transform   = '';
      void keycap.offsetWidth;
      keycap.style.transition   = 'opacity 0.28s ease';
      shadow.style.transition   = 'opacity 0.28s ease';
      keycap.style.opacity      = '1';
      shadow.style.opacity      = '1';

    } else {
      /* From pressed/morphing: spring keycap back, reset bars instantly */
      micWrap.style.opacity   = '1';
      micWrap.style.transform = '';
      setBarsOval();
      keycapT({
        transform:       [0.45, SPRING],
        width:           [0.45, SPRING],
        height:          [0.45, SPRING],
        'border-radius': [0.45, SPRING],
        opacity:         [0.3, 'ease'],
      });
      applyKeycap({ op: '1' });
      keycap.style.background = '#F7F8F9';
    }

    /* All overlay/visibility/cleanup state is owned by setUiMode now. */
    setUiMode('idle');
  }

  function toPressed() {
    if (appState !== 'idle') return;
    appState = 'pressed';
    hint.classList.add('hidden');

    keycapT({ transform: [0.10, EASE_OUT], 'box-shadow': [0.10, 'ease'] });
    applyKeycap({
      tx: 'translate(-50%, calc(-50% + 4px))',
      sh: '0 4px 40px 0 rgba(39,40,51,0.08)',
    });
    micWrap.style.transform = 'translateY(4px) scale(0.97)';
    morphTimer = setTimeout(toMorph, 100);
  }

  function toMorph() {
    appState = 'morphing';

    /* Keycap springs to circle and fades */
    keycapT({
      transform:       [0.44, SPRING],
      width:           [0.44, SPRING],
      height:          [0.44, SPRING],
      'border-radius': [0.44, SPRING],
      opacity:         [0.28, 'ease'],
    });
    applyKeycap({ w: 280, h: 280, r: 140, sh: 'none', op: '0' });
    micWrap.style.transform  = '';
    spaceLabel.style.opacity = '0';
    micOuter.style.opacity   = '0';

    /* bar3 springs oval → bar; container top eases to center at the same time */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (appState !== 'morphing') return;
      barEls[2].style.transition =
        `width 0.42s ${BOUNCE}, height 0.42s ${BOUNCE}, border-radius 0.42s ${BOUNCE}`;
      barEls[2].style.width        = '20px';
      barEls[2].style.height       = '38px';
      barEls[2].style.borderRadius = '10px';

      /* Include gap in transition now so we can animate it later without interrupting top */
      barsEl.style.transition = 'top 0.50s ease, gap 0.35s ease';
      barsEl.style.top        = '150px';
    }));

    /* At 300ms: expand gap + show side bars. Do NOT touch bar3's transition —
       cancelling a running CSS spring snaps it to final value instantly (the jump).
       Let bar3's spring finish on its own; start RAF 140ms later when it's settled. */
    barsTimer = setTimeout(() => {
      if (appState !== 'morphing') return;
      barsEl.style.gap = '20px';

      /* Append background to bar3 without removing active spring transitions */
      barEls[2].style.transition += ', background 0.4s ease';
      barEls[2].style.background  = '#E7E7ED';

      liveH[0] = 4; liveH[1] = 4; liveH[3] = 4; liveH[4] = 4; liveH[2] = 38;
      [0,1,3,4].forEach(i => {
        barEls[i].style.transition = 'width 0.3s ease, opacity 0.3s ease';
        barEls[i].style.width      = '20px';
        barEls[i].style.height     = '4px';
        barEls[i].style.opacity    = '1';
        barEls[i].style.background = '#E7E7ED';
      });

      /* Spring finishes ~130ms from now; start RAF after it settles */
      barsTimer = setTimeout(() => {
        if (appState !== 'morphing') return;
        setBarMode('idle');
        startBarAnim();
        toListening();
      }, 140);
    }, 300);
  }

  function toListening() {
    appState = 'listening';
    barEls.forEach(b => b.style.transition = 'background 0.35s ease');
    initMic();
    startSpeech();
    setUiMode('listening:command');
    startHintTimer();
  }

  function toSpeaking() {
    if (appState !== 'listening') return;
    appState = 'speaking';
    setBarColors(BLUE_COLS, 350);
    setBarMode('active');
  }

  function toStopSpeaking() {
    if (appState !== 'speaking') return;
    appState = 'listening';
    setBarColors(GRAY_COLS, 350);
    setBarMode('idle');
  }

  function isDictationPhase(p) {
    return p === 'title' || p === 'subtitle' || p === 'body' || p === 'dynamicText';
  }
  function isFieldDictationPhase() {
    return isDictationPhase(voicePhase);
  }

  function getActiveDictationInput() {
    if (voicePhase === 'title') return titleText;
    if (voicePhase === 'subtitle') return subtitleText;
    if (voicePhase === 'body') return bodyText;
    if (voicePhase === 'dynamicText' && dynamicTextStepId) {
      return Array.from(dynamicTextFieldsContainer?.querySelectorAll('.field-input') || [])
        .find(el => el.dataset.stepId === dynamicTextStepId);
    }
    return null;
  }

  /* Commit whatever tentative (blue/interim) text is showing in the active
     field as final, fixed text. The on-screen value is already the
     live-formatted text, so we just promote it into the backing state and
     drop the interim colour — no extra final or keypress needed. */
  function commitActiveDictationField() {
    const el = getActiveDictationInput();
    if (!el || !el.classList.contains('field-interim')) return;
    const v = el.value;
    if      (voicePhase === 'title')    titleValue    = v;
    else if (voicePhase === 'subtitle') subtitleValue = v;
    else if (voicePhase === 'body')     bodyValue     = v;
    else if (voicePhase === 'dynamicText' && dynamicTextStepId) dynamicFieldValues[dynamicTextStepId] = v;
    el.classList.remove('field-interim');
  }

  function updateFieldMicButtons() {
    document.querySelectorAll('[data-field-mic]').forEach(btn => {
      btn.classList.toggle('muted', fieldMicMuted);
      btn.setAttribute('aria-pressed', fieldMicMuted ? 'true' : 'false');
      btn.setAttribute('aria-label', fieldMicMuted
        ? (s('fieldMicResume') || 'Resume voice input')
        : (s('fieldMicMute') || 'Pause voice input'));
    });
    document.querySelectorAll('.field-box').forEach(box => {
      box.classList.toggle('mic-muted', fieldMicMuted);
    });
  }

  function setFieldMicMuted(muted, opts = {}) {
    const next = !!muted;
    fieldMicMuted = next;
    updateFieldMicButtons();
    if (next) {
      /* Freeze any tentative (blue) text as final before we stop listening,
         so pausing leaves it fixed instead of waiting for a keypress. */
      commitActiveDictationField();
      skipNextFinal = true;
      dropResidualInterims = true;
      pauseMic();
      setBarMode('idle');
      setBarColors(GRAY_COLS, 350);
      if (!opts.skipSpeech) stopSpeech();
      getActiveDictationInput()?.focus({ preventScroll: true });
      if (!opts.silent) announce(s('announceFieldMicMuted') || 'Voice input paused.');
    } else {
      skipNextFinal = false;
      dropResidualInterims = false;
      if (!opts.skipSpeech && isListeningPhase()) startSpeech();
      if (!opts.silent) announce(s('announceFieldMicResumed') || 'Voice input resumed.');
    }
  }

  function toggleFieldMicCapture() {
    if (!isFieldDictationPhase()) return;
    setFieldMicMuted(!fieldMicMuted);
  }

  /* ─── VOICE COMMAND SYSTEM ─── */
  const contentPanel = document.getElementById('contentPanel');
  const titleField   = document.getElementById('titleField');
  const subtitleField = document.getElementById('subtitleField');
  const bodyField    = document.getElementById('bodyField');
  const dynamicTextFieldsContainer = document.getElementById('dynamicTextFields');

  /* Real <input> / <textarea> elements. STT writes via renderField(),
     and the user can also type directly — both paths sync through the
     `input` event listener installed at the bottom of this IIFE. */
  const titleText    = document.getElementById('titleInput');
  const subtitleText = document.getElementById('subtitleInput');
  const bodyText     = document.getElementById('bodyInput');
  bodyText.addEventListener('input', () => autoResizeTextarea(bodyText));

  const keycapWrap = document.querySelector('.keycap-wrap');
  const cmdHint    = document.getElementById('cmdHint');
  const cmdList    = document.getElementById('cmdList');

  let voicePhase           = 'command';
  let titleValue           = '';
  let subtitleValue        = '';
  let bodyValue            = '';
  let reviewedTitle        = '';
  let reviewedSubtitle     = '';
  let reviewedBody         = '';
  let selectedSpace        = null;
  let selectedCoverImage   = null;
  let selectedFile         = null;
  let imagePhaseReturnTo   = null;
  let formatListReturnTo   = null;
  /* Per-step values for dynamic Object-driven flows. Indexed by step.id.
     Text/textarea steps still mirror to titleValue/subtitleValue/bodyValue
     (so the existing rendering path works), but anything that doesn't fit
     those slots — currently just Picklist selections — lives here.
     Reset by resetContentFlow. */
  let dynamicFieldValues = {};
  let optionsPhaseStepId  = null;
  let dynamicTextStepId   = null;
  let numberInputStepId   = null;
  let dateInputStepId     = null;
  let dateInputParts      = { d: null, m: null, y: null };
  let skipNextFinal        = false;
  /* Companion to skipNextFinal: when set, also drops `interim` events
     until the next `final` arrives (which clears both flags). Used after
     selecting a space from an interim match so the rest of the same
     utterance ("crear contenido marketing" continuing past the mode
     transition) doesn't leak into the next phase's input. skipNextFinal
     alone only catches the residual final; interims kept arriving and
     polluted the title field. */
  let dropResidualInterims = false;
  /* Live mirror of the speech recogniser: true while an utterance is being
     spoken (interims arriving, no final yet), false once its final lands.
     Read when a content field becomes visible to decide whether the user is
     mid-utterance — if so, that in-flight residual is dropped so it can't
     paint into the freshly-shown field. */
  let utteranceInFlight    = false;
  let hintTimer            = null;
  let flowsConfig          = null;
  let currentFlow          = null;
  let currentFlowId        = null;

  /* Strings helper — lookup + {var} interpolation. Falls back to empty string. */
  function s(key, vars) {
    let v = appConfig.strings?.[key] ?? '';
    if (vars) for (const k of Object.keys(vars)) {
      v = v.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    }
    return v;
  }

  function normalize(text) {
    return (text || '').toLowerCase().trim()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function matchPhrase(normalizedText, phrases) {
    return (phrases || []).some(p => normalizedText.includes(normalize(p)));
  }

  /* Flow session token — incremented when listening is deactivated or the flow ends.
     `flowTimeout` captures the current token at scheduling time and skips its body
     if the token has changed by the time it fires. Prevents stale timeouts from
     re-showing UI after toIdle / cancelFlow / finalizeSubmit. */
  let flowSessionId = 0;
  function newFlowSession() { flowSessionId++; }
  function flowTimeout(fn, ms) {
    const sid = flowSessionId;
    return setTimeout(() => { if (sid === flowSessionId) fn(); }, ms);
  }

  /* Two-press SPACE cancel inside a flow:
     first press shows a confirmation pill, second press (within the timeout)
     actually cancels. Auto-dismisses after 5 s, or on any voice command match. */
  const CANCEL_CONFIRM_MS = 5000;
  let cancelConfirmPending = false;
  let cancelConfirmTimer   = null;

  function isInFlow() {
    return appState !== 'idle' && voicePhase !== 'command';
  }

  function showCancelConfirm() {
    cancelConfirmPending = true;
    const el      = document.getElementById('cancelConfirm');
    const textEl  = document.getElementById('cancelConfirmText');
    const keyName = appConfig.activationKey?.label ?? 'SPACE';
    const tpl     = appConfig.strings?.cancelConfirm ?? '';
    const text    = String(tpl).replace(/\{key\}/g, keyName);
    if (textEl) textEl.innerHTML = text;
    if (el) el.hidden = false;
    clearTimeout(cancelConfirmTimer);
    cancelConfirmTimer = setTimeout(hideCancelConfirm, CANCEL_CONFIRM_MS);
    /* Strip any HTML so the announcement reads cleanly. */
    announce(text.replace(/<[^>]+>/g, ''), 'alert');
  }

  function hideCancelConfirm() {
    cancelConfirmPending = false;
    const el = document.getElementById('cancelConfirm');
    if (el) el.hidden = true;
    clearTimeout(cancelConfirmTimer);
    cancelConfirmTimer = null;
  }

  /* ── Liferay integration ──
     Talks to Headless Delivery / Headless Admin User APIs over fetch.
     Spaces are pre-fetched once at boot and cached. Cover images are fetched
     when entering the image step (per selected space) and cached per space.
     Anything that fails falls back to the mock data in config.json so the
     prototype keeps working when Liferay is unreachable. */

  /* Set to true once preloadLiferaySpaces lands at least one space — used as
     a gate by activationToggle. Voice can't be activated until we've proven
     the Liferay backend is reachable; otherwise the user dictates a full
     post just to get a "could not connect" error on submit. */
  let liferayHealthy = false;
  let spacesCache  = null;
  let imagesCache  = null;
  let imagesCacheSpaceId = null;
  /* True when the last cover-images fetch failed — the carousel then shows
     an explicit "couldn't load" message instead of a misleading empty state. */
  let imagesLoadError = false;
  /* Custom Objects living under the CMS Site Builder folder, keyed by
     internal name (`Marcos`, `CMSBlog`, …). Populated once at boot by
     discoverDynamicFlows(). Each entry is the raw Object Definition. */
  let objectDefsCache  = null;
  /* Picklist (list-type-definition) entries cached by id. Each value is
     the array returned by fetchPicklistEntries — `[{key, name}, …]`. */
  const picklistCache  = new Map();

