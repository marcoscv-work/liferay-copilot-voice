/* Liferay Copilot Voice — module 6/8: panels
 * Interactive surfaces: file picker, image carousel, options picker, dynamic text fields, number and date input panels.
 * Modules share one global scope and load strictly in order (element.js
 * chains them with async=false) — this file was split from the original
 * app.js without reordering, so cross-module references resolve at call
 * time exactly as before.
 */
  /* ─── FILE PICKER (createFile flow) ─── */
  function enterFileStep() {
    playSound('fieldChange');
    const step = getStep('file');
    const promptEl = document.getElementById('filePickerPrompt');
    if (promptEl) promptEl.textContent = step?.voicePrompt || '';
    setUiMode('flow:file');
  }

  /* Browsers block <input type="file">.click() unless triggered from a *trusted*
     user gesture; Web Speech API events don't qualify, so a voice "elegir archivo"
     would silently do nothing. We try the click anyway (works when invoked from a
     real button click), and we always pulse the button so the user knows where to
     click when voice can't open the dialog. */
  function openFileDialog() {
    const btn   = document.getElementById('filePickerBtn');
    const input = document.getElementById('fileInput');
    if (btn) {
      btn.classList.remove('flash');
      void btn.offsetWidth;
      btn.classList.add('flash');
      setTimeout(() => btn.classList.remove('flash'), 1500);
    }
    try { input?.click(); } catch (_) {}
  }

  function setSelectedFile(file) {
    selectedFile = file;
    const card = document.getElementById('filePickerCard');
    const name = document.getElementById('filePickerInfoName');
    const size = document.getElementById('filePickerInfoSize');
    if (file) {
      card?.classList.add('has-file');
      if (name) name.textContent = file.name;
      if (size) size.textContent = formatFileSize(file.size);
      flashCommandDetected(s('fileFlash', { name: file.name }), 'fieldChange');
      announce(s('announceFileSelected', { name: file.name }));
    } else {
      card?.classList.remove('has-file');
      if (name) name.textContent = s('fileNoSelection');
      if (size) size.textContent = '';
    }
  }

  function clearSelectedFile() {
    selectedFile = null;
    const card = document.getElementById('filePickerCard');
    const name = document.getElementById('filePickerInfoName');
    const size = document.getElementById('filePickerInfoSize');
    const input = document.getElementById('fileInput');
    if (card) card.classList.remove('has-file');
    if (name) name.textContent = s('fileNoSelection');
    if (size) size.textContent = '';
    if (input) input.value = '';
  }

  function formatFileSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function enterTitleStep() {
    playSound('fieldChange');
    setUiMode('flow:title');
  }

  function startBodyPhase() {
    playSound('fieldChange');
    setUiMode('flow:body');
  }

  /* True for flows whose step list contains a `subtitle` text step (currently
     only createBlog). The subtitle field stays hidden for the other flows. */
  function hasSubtitleStep() {
    return !!getStep('subtitle');
  }

  function startSubtitlePhase() {
    playSound('fieldChange');
    setUiMode('flow:subtitle');
  }

  function goToSubtitle() {
    if (!hasSubtitleStep()) { goToTitle(); return; }
    setUiMode('flow:subtitle');
  }

  function clearSubtitle() {
    if (!hasSubtitleStep()) return;
    subtitleValue = '';
    setUiMode('flow:subtitle');
    announce(s('announceFieldCleared', { field: getStep('subtitle')?.label || '' }));
  }

  /* ─── IMAGE CAROUSEL ─── */
  function buildCarousel(state = 'ready') {
    const track = document.getElementById('carouselTrack');
    const empty = document.getElementById('carouselEmpty');
    const list  = api.getCoverImages();

    /* Empty / loading state — hide the track, show the message. */
    if (state === 'loading' || (state === 'ready' && list.length === 0)) {
      track.innerHTML = '';
      if (empty) {
        empty.textContent = state === 'loading' ? s('carouselLoading')
          : imagesLoadError ? s('carouselError')
          : s('carouselEmpty');
        empty.hidden = false;
      }
      return;
    }
    if (empty) empty.hidden = true;

    /* Decide how many copies of the list we need so the track is always
       longer than `viewport + one set`. Without this, when the screen is
       tall the visible viewport exceeds one set's height and the bottom
       cards run out — the wrap-around shows a blank gap until the loop
       resets, which reads as the duplicate card "popping in" at the bottom. */
    const carousel = document.getElementById('imgCarousel');
    const viewportPx = carousel ? carousel.clientHeight : 0;
    /* CSS card-img is 120px + name row ~28px = ~148px. Refined after the
       first paint via offsetHeight measurement below. */
    const ESTIMATED_CARD_PX = 148;
    const GAP_PX = 12; /* must match --carousel-gap in styles.css */
    const estimatedPeriod = list.length * (ESTIMATED_CARD_PX + GAP_PX);
    const setsNeeded = Math.max(2, Math.ceil((viewportPx + GAP_PX) / estimatedPeriod) + 1);

    const items = [];
    for (let s = 0; s < setsNeeded; s++) items.push(...list);

    track.innerHTML = items.map(({ name, gradient, url, thumbnailUrl }, i) => {
      const num      = (i % list.length) + 1;
      /* Carousel cards get the cheaper thumbnail variant — CSS scales them
         to 192×120 anyway. The full-size URL is reserved for the cover-thumb
         above the title and for inline embed in web-content bodies. */
      const cardSrc  = thumbnailUrl || url;
      /* Layer the gradient behind the URL so we have a solid fill while the
         image bytes are still in flight. */
      const fallback = gradient || '#E7E7ED';
      const bg       = cardSrc ? `url(${cardSrc}) center/cover, ${fallback}` : fallback;
      return `
        <div class="carousel-card" data-image-idx="${i % list.length}">
          <div class="carousel-card-img" style="background:${bg}">
            <span class="carousel-card-number">${num}</span>
          </div>
          <div class="carousel-card-name">${name}</div>
        </div>`;
    }).join('');
    track.querySelectorAll('.carousel-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.imageIdx, 10);
        selectCoverImage(list[idx], card);
      });
    });

    /* Now that the cards are laid out, measure the real card height and
       set the exact period as a CSS custom property. The keyframe animates
       `translateY(0)` -> `translateY(calc(-1 * var(--carousel-period)))`,
       so the loop ends exactly one set higher than it started — regardless
       of how many sets we duplicated. */
    const firstCard = track.querySelector('.carousel-card');
    if (firstCard) {
      const cardPx = firstCard.offsetHeight || ESTIMATED_CARD_PX;
      const period = list.length * (cardPx + GAP_PX);
      track.style.setProperty('--carousel-period', period + 'px');
      /* Speed must be constant — independent of how many images. With a
         fixed CSS animation duration, more cards = same duration over a
         longer track = faster perceived scroll. We instead derive the
         duration from the period at a constant velocity in pixels per
         second, so 6 images and 60 images move past the viewport at the
         same speed. ~55 px/s reads comfortably. */
      const PX_PER_SECOND = 55;
      track.style.animationDuration = (period / PX_PER_SECOND) + 's';
    }

    /* Prefetch + force-decode every unique image. CSS `background-image`
       fetches the file but browsers defer the actual decode for elements
       that aren't on screen — when the duplicated card scrolls into view
       the decode has to happen just-in-time and you see a pop-in. Calling
       `Image.decode()` here makes the bitmap fully ready up-front so the
       second pass through the carousel paints instantly.
       We preload the thumbnail variant — that's what the cards render. */
    list.forEach(img => {
      const src = img.thumbnailUrl || img.url;
      if (!src) return;
      const probe = new Image();
      probe.src = src;
      if (probe.decode) probe.decode().catch(() => {});
    });
  }

  function showImageCarousel() {
    if (uiMode === 'flow:image') return;
    /* Remember the dictation mode to return to once a card is picked or
       the user dismisses the carousel. Default to flow:title when invoked
       from somewhere unexpected. */
    imagePhaseReturnTo = ['flow:title', 'flow:subtitle', 'flow:body'].includes(uiMode) ? uiMode : 'flow:title';

    /* If we don't yet have images cached for this space, render the
       loading state and kick the fetch. The normal case after pre-warming
       in selectSpace is that the cache is already populated and we render
       the cards immediately. */
    const cacheReady = imagesCacheSpaceId === selectedSpace?.id && imagesCache != null;
    buildCarousel(cacheReady ? 'ready' : 'loading');

    /* Reset any inline overrides from a previous selection so the auto-scroll
       animation runs cleanly from the top. */
    const track = document.getElementById('carouselTrack');
    if (track) {
      track.style.transition = '';
      track.style.transform  = '';
      track.style.animation  = '';
    }
    setUiMode('flow:image');
    if (selectedSpace?.id) {
      api.refreshCoverImagesFor(selectedSpace.id).then(() => {
        if (uiMode === 'flow:image') buildCarousel('ready');
      });
    }
  }

  function exitImageStep() {
    if (uiMode !== 'flow:image') return;
    setUiMode(imagePhaseReturnTo || 'flow:title');
    imagePhaseReturnTo = null;
  }

  function selectCoverImage(img, cardEl) {
    if (!img) return;
    selectedCoverImage = img;
    if (cardEl) {
      document.querySelectorAll('.carousel-card').forEach(c => c.classList.remove('selected'));
      cardEl.classList.add('selected');
      scrollCarouselToCard(cardEl);
    }
    flashCommandDetected(s('imageFlash', { name: img.name }), 'command');
    announce(s('announceImageSelected', { name: img.name }));
    flowTimeout(() => {
      showCoverThumb(img);
      setUiMode(imagePhaseReturnTo || 'flow:title');
      imagePhaseReturnTo = null;
    }, 950);
  }

  /* Stop the auto-scroll, snap the track to its current visual position,
     then animate it so the selected card is centred in the carousel viewport. */
  function scrollCarouselToCard(cardEl) {
    const track    = document.getElementById('carouselTrack');
    const carousel = document.getElementById('imgCarousel');
    if (!track || !carousel || !cardEl) return;

    const cs = getComputedStyle(track).transform;
    let currentY = 0;
    const m2 = cs && cs.match(/^matrix\(([^)]+)\)$/);
    const m3 = cs && cs.match(/^matrix3d\(([^)]+)\)$/);
    if (m2) {
      const v = m2[1].split(',').map(x => parseFloat(x.trim()));
      currentY = v[5] || 0;
    } else if (m3) {
      const v = m3[1].split(',').map(x => parseFloat(x.trim()));
      currentY = v[13] || 0;
    }

    const cardRect     = cardEl.getBoundingClientRect();
    const carouselRect = carousel.getBoundingClientRect();
    const cardCenter   = cardRect.top     + cardRect.height     / 2;
    const targetCenter = carouselRect.top + carouselRect.height / 2;
    const delta        = targetCenter - cardCenter;

    track.style.transition = 'none';
    track.style.animation  = 'none';
    track.style.transform  = `translateY(${currentY}px)`;
    void track.offsetHeight;
    track.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
    track.style.transform  = `translateY(${currentY + delta}px)`;
  }

  function findClosestCardByIdx(idx) {
    const cards = document.querySelectorAll(`.carousel-card[data-image-idx="${idx}"]`);
    if (!cards.length) return null;
    if (cards.length === 1) return cards[0];
    const carousel = document.getElementById('imgCarousel');
    const cRect = carousel.getBoundingClientRect();
    const targetY = cRect.top + cRect.height / 2;
    let closest = cards[0], minDist = Infinity;
    cards.forEach(c => {
      const r = c.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      const d = Math.abs(cy - targetY);
      if (d < minDist) { minDist = d; closest = c; }
    });
    return closest;
  }

  function showCoverThumb(img) {
    const el = document.getElementById('coverThumb');
    const bg = img.url ? `url(${img.url}) center/cover` : (img.gradient || '#E7E7ED');
    el.style.background = bg;
    el.classList.add('visible');
  }

  function clearCoverThumb() {
    selectedCoverImage = null;
    const el = document.getElementById('coverThumb');
    el.classList.remove('visible');
    el.style.background = '';
  }

  /* ─── OPTIONS PICKER (Picklist fields in dynamic Object-driven flows) ─── */

  function buildOptionsPicker(step) {
    const ul = document.getElementById('optionsList');
    if (!ul) return;
    ul.innerHTML = '';
    const opts = step.__options || [];
    opts.forEach((o, i) => {
      const li   = document.createElement('li');
      const card = document.createElement('div');
      card.className = 'option-card';
      card.dataset.optionKey   = o.key;
      card.dataset.optionIdx   = String(i + 1);
      card.innerHTML =
        `<span class="option-card-number">${i + 1}</span>` +
        `<span class="option-card-name">${o.name}</span>`;
      if (dynamicFieldValues[step.id] === o.key) card.classList.add('selected');
      card.addEventListener('click', () => selectOption(step, o, card));
      li.appendChild(card);
      ul.appendChild(li);
    });
  }

  function enterOptionsStep(step) {
    if (!step) return;
    /* Field-change tone on the way in — same audio cue as enterTitleStep /
       enterFileStep / startBodyPhase. flashCommandDetected from the
       dispatcher fires too but with a long delay window; this gives an
       immediate "we're entering a new field" beep. */
    playSound('fieldChange');
    optionsPhaseStepId = step.id;
    const promptEl = document.getElementById('optionsPickerPrompt');
    if (promptEl) promptEl.textContent = step.voicePrompt || '';
    buildOptionsPicker(step);
    setUiMode('flow:options');
  }

  function selectOption(step, option, cardEl) {
    if (!step || !option) return;
    dynamicFieldValues[step.id] = option.key;
    if (cardEl) {
      document.querySelectorAll('#optionsList .option-card')
        .forEach(c => c.classList.toggle('selected', c === cardEl));
    }
    /* Render the summary chip immediately so the visual confirmation is up
       even before the 950 ms transition out fires. */
    renderFieldSummary();
    const tpl = dynamicTpl();
    flashCommandDetected(fillTpl(tpl.announceSelected, { label: step.label, value: option.name }));
    announce(fillTpl(tpl.announceSelected, { label: step.label, value: option.name }));
    /* Auto-advance to the next step (same UX as space + image pickers). If
       there's no next, fall back to body — that's the most likely place to
       continue dictating in flows that put options between text fields.
       Plays a fieldChange tone on the transition out so the user gets the
       same audio cue as title→body / subtitle→body auto-advance does. */
    flowTimeout(() => {
      const next = nextStepAfter(step.id);
      optionsPhaseStepId = null;
      if (next) {
        enterStep(next);
      } else {
        playSound('fieldChange');
        setUiMode(getStep('content') ? 'flow:body' : 'flow:title');
      }
    }, 950);
  }

  /* Match a spoken phrase against the active options-step. Order:
       1. Exact name match (normalize-insensitive)
       2. Numeric digit ("opción 1")
       3. Spanish/English number word ("uno", "two")
       4. The picklist `key` itself ("new", "old") — useful when names are
          unilingual english and the user is on the ES locale. */
  function matchOptionFromVoice(text, step) {
    const t = normalize(text);
    const opts = step?.__options || [];
    if (!opts.length) return null;
    const byName = opts.find(o => o.name && t.includes(normalize(o.name)));
    if (byName) return byName;
    const digit = t.match(/\d+/);
    if (digit) {
      const idx = parseInt(digit[0], 10) - 1;
      if (idx >= 0 && idx < opts.length) return opts[idx];
    }
    const tokens = t.split(/\s+/);
    for (const tok of tokens) {
      const n = NUM_WORDS[tok];
      if (n != null && n - 1 < opts.length) return opts[n - 1];
    }
    const byKey = opts.find(o => o.key && t.includes(normalize(o.key)));
    if (byKey) return byKey;
    return null;
  }

  function clearOptionsStep(stepId) {
    delete dynamicFieldValues[stepId];
    renderFieldSummary();
    const step = getStep(stepId);
    if (!step) return;
    /* Re-enter the step so the picker is shown clean (selection wiped, prompt
       re-announced) — matches clearTitle / clearBodyContent semantics. */
    enterOptionsStep(step);
    announce(s('announceFieldCleared', { field: step.label }));
  }

  /* ─── DYNAMIC TEXT FIELDS (3rd+ Text fields in Object-driven flows) ─── */

  const MIC_SVG_INLINE =
    '<button class="field-mic" type="button" data-field-mic>' +
      '<svg class="field-mic-icon field-mic-on-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>' +
        '<path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M12 18v3M9 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>' +
      '<svg class="field-mic-icon field-mic-muted-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>' +
        '<path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>' +
    '</button>';

  function buildDynamicTextFields(flow) {
    const container = dynamicTextFieldsContainer;
    if (!container) return;
    container.innerHTML = '';
    if (!flow?.__dynamic) return;
    for (const step of flow.steps) {
      if (!step.id.startsWith('text:')) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'dynamic-text-field';
      wrapper.dataset.stepId = step.id;
      const box = document.createElement('div');
      box.className = 'field-box';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'field-input';
      input.autocomplete = 'off';
      input.spellcheck = true;
      input.placeholder = step.placeholder || step.label || '';
      input.setAttribute('aria-label', step.label || '');
      input.dataset.stepId = step.id;
      box.innerHTML = MIC_SVG_INLINE;
      box.insertBefore(input, box.firstChild);
      wrapper.appendChild(box);
      container.appendChild(wrapper);
      const capturedStep = step;
      input.addEventListener('input', () => {
        dynamicFieldValues[capturedStep.id] = input.value;
        input.classList.remove('field-interim');
        hideFormError();
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (input.value.trim()) {
            const next = nextStepAfter(capturedStep.id);
            if (next) enterStep(next);
          }
        }
      });
    }
  }

  function enterDynamicTextField(step) {
    if (!step) return;
    playSound('fieldChange');
    dynamicTextStepId = step.id;
    setUiMode('flow:dynamic-text');
    const dynInput = dynamicTextFieldsContainer
      ?.querySelector(`input[data-step-id="${step.id}"]`);
    if (dynInput) requestAnimationFrame(() => dynInput.focus());
    announce(step.voicePrompt || '');
  }

  function clearDynamicTextField(stepId) {
    delete dynamicFieldValues[stepId];
    const dynInput = dynamicTextFieldsContainer
      ?.querySelector(`input[data-step-id="${stepId}"]`);
    if (dynInput) { dynInput.value = ''; dynInput.classList.remove('field-interim'); }
    const step = getStep(stepId);
    if (step) enterDynamicTextField(step);
    announce(s('announceFieldCleared', { field: step?.label || '' }));
  }

  /* ─── NUMBER INPUT (Integer, Long, Double, BigDecimal fields) ─── */

  function enterNumberStep(step) {
    if (!step) return;
    playSound('fieldChange');
    numberInputStepId = step.id;
    const promptEl = document.getElementById('numberInputPrompt');
    if (promptEl) promptEl.textContent = step.voicePrompt || '';
    const hintEl = document.getElementById('numberInputHint');
    if (hintEl) hintEl.textContent = dynamicTpl().numberInputHint || '';
    const field = document.getElementById('numberInputField');
    if (field) {
      field.step  = (step.__businessType === 'Integer' || step.__businessType === 'Long') ? '1' : 'any';
      field.value = dynamicFieldValues[step.id] ?? '';
      field.classList.remove('field-interim');
    }
    setUiMode('flow:number-input');
    document.getElementById('numberInputPanel')?.classList.add('dictating');
    if (field) requestAnimationFrame(() => field.focus());
  }

  function confirmNumberInput() {
    const step = numberInputStepId ? getStep(numberInputStepId) : null;
    if (!step) return;
    const field = document.getElementById('numberInputField');
    const raw = String(field?.value ?? '').trim();
    if (!raw || isNaN(Number(raw))) {
      announce(s('errorInvalidNumber') || 'Número inválido', 'alert');
      return;
    }
    dynamicFieldValues[step.id] = raw;
    renderFieldSummary();
    const tpl = dynamicTpl();
    const label = fillTpl(tpl.announceSelected, { label: step.label, value: raw });
    flashCommandDetected(label);
    announce(label);
    flowTimeout(() => {
      numberInputStepId = null;
      const next = nextStepAfter(step.id);
      if (next) { enterStep(next); }
      else { playSound('fieldChange'); setUiMode(getStep('content') ? 'flow:body' : 'flow:title'); }
    }, 950);
  }

  function clearNumberStep(stepId) {
    delete dynamicFieldValues[stepId];
    const field = document.getElementById('numberInputField');
    if (field) field.value = '';
    renderFieldSummary();
    const step = getStep(stepId);
    if (step) enterNumberStep(step);
    announce(s('announceFieldCleared', { field: step?.label || '' }));
  }

  function parseNumberFromVoice(text) {
    const t = normalize(text);
    const cleaned = t.replace(/,/g, '.').replace(/[^\d.+\-]/g, '');
    if (cleaned && !isNaN(Number(cleaned))) return Number(cleaned);
    const tokens = t.split(/\s+/);
    for (const tok of tokens) {
      const n = NUM_WORDS[tok];
      if (n != null) return n;
    }
    return null;
  }

  /* ─── DATE INPUT (Date, DateTime fields) ─── */

  function enterDateStep(step) {
    if (!step) return;
    playSound('fieldChange');
    dateInputStepId = step.id;
    dateInputParts  = { d: null, m: null, y: null };
    const promptEl = document.getElementById('dateInputPrompt');
    if (promptEl) promptEl.textContent = step.voicePrompt || '';
    const hintEl = document.getElementById('dateInputHint');
    if (hintEl) hintEl.textContent = dynamicTpl().dateInputHint || '';
    const field = document.getElementById('dateInputField');
    if (field) {
      field.type  = step.type === 'datetime' ? 'datetime-local' : 'date';
      field.value = dynamicFieldValues[step.id] ?? '';
    }
    setUiMode('flow:date-input');
    document.getElementById('dateInputPanel')?.classList.add('dictating');
  }

  function confirmDateInput() {
    const step = dateInputStepId ? getStep(dateInputStepId) : null;
    if (!step) return;
    const field = document.getElementById('dateInputField');
    const raw = String(field?.value ?? '').trim();
    if (!raw) {
      announce(s('errorInvalidDate') || 'Fecha inválida', 'alert');
      return;
    }
    dynamicFieldValues[step.id] = raw;
    renderFieldSummary();
    const display = formatDateForDisplay(raw, step.type === 'datetime');
    const tpl = dynamicTpl();
    const label = fillTpl(tpl.announceSelected, { label: step.label, value: display });
    flashCommandDetected(label);
    announce(label);
    flowTimeout(() => {
      dateInputStepId = null;
      const next = nextStepAfter(step.id);
      if (next) { enterStep(next); }
      else { playSound('fieldChange'); setUiMode(getStep('content') ? 'flow:body' : 'flow:title'); }
    }, 950);
  }

  function clearDateStep(stepId) {
    delete dynamicFieldValues[stepId];
    const field = document.getElementById('dateInputField');
    if (field) field.value = '';
    renderFieldSummary();
    const step = getStep(stepId);
    if (step) enterDateStep(step);
    announce(s('announceFieldCleared', { field: step?.label || '' }));
  }

  function formatDateForDisplay(isoStr, includeTime = false) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr + (includeTime ? '' : 'T00:00:00'));
      const pad = n => String(n).padStart(2, '0');
      const base = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      if (!includeTime) return base;
      return `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return isoStr; }
  }

  function parseDateFromVoice(text) {
    const toISO = d => {
      if (isNaN(d)) return null;
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const now = new Date();
    let t = normalize(text).replace(/^(el|la|the)\s+/g, '');

    if (/\b(hoy|today|oggi)\b/.test(t))             return toISO(now);
    if (/\b(ma[nñ]ana|tomorrow|domani)\b/.test(t)) {
      const d = new Date(now); d.setDate(d.getDate() + 1); return toISO(d);
    }

    const slashMatch = t.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (slashMatch) {
      const [, a, b, year] = slashMatch;
      const locale = String(appConfig?.locale || 'es').split(/[-_]/)[0];
      const [day, month] = locale === 'en' ? [b, a] : [a, b];
      const d = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      if (!isNaN(d)) return toISO(d);
    }

    const isoMatch = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);
      return toISO(d);
    }

    const MONTH_NAMES = {
      enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6,
      julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12,
      january:1, february:2, march:3, april:4, may:5, june:6,
      july:7, august:8, september:9, october:10, november:11, december:12,
      gennaio:1, febbraio:2, aprile:4, maggio:5, giugno:6,
      luglio:7, settembre:9, ottobre:10, novembre:11,
    };
    const spoken = t.match(/(\d+|[a-z]+)\s+(?:del?\s+|of\s+)?(\d+|[a-z]+)(?:\s+(?:del?\s+|of\s+|,\s*)?(\d{4}))?/);
    if (spoken) {
      const [, dayRaw, monthRaw, yearRaw] = spoken;
      let day = parseInt(dayRaw, 10);
      if (isNaN(day)) day = NUM_WORDS[dayRaw];
      let month = MONTH_NAMES[monthRaw];
      if (!month) {
        const n = parseInt(monthRaw, 10);
        if (!isNaN(n) && n >= 1 && n <= 12) month = n;
        else { const nw = NUM_WORDS[monthRaw]; if (nw >= 1 && nw <= 12) month = nw; }
      }
      if (month && day) {
        const year = yearRaw ? parseInt(yearRaw, 10) : now.getFullYear();
        const d = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        return toISO(d);
      }
    }
    return null;
  }

  /* Extract a single date component (day, month, or year) from a spoken
     utterance. Returns { d } | { m } | { y } | null.
     Ambiguous numbers (1–12) are assigned to whichever slot isn't filled yet:
     day first, then month. */
  function extractDatePart(text) {
    const t = normalize(text).trim();
    const MNAMES = {
      enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,
      julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12,
      january:1,february:2,march:3,april:4,may:5,june:6,
      july:7,august:8,september:9,october:10,november:11,december:12,
      gennaio:1,febbraio:2,aprile:4,maggio:5,giugno:6,
      luglio:7,settembre:9,ottobre:10,novembre:11,
    };
    // Year: 4-digit number 1900-2100
    const yM = t.match(/\b((?:19|20)\d{2})\b/);
    if (yM) return { y: parseInt(yM[1]) };
    // Month name
    for (const [name, num] of Object.entries(MNAMES)) {
      if (new RegExp(`\\b${name}\\b`).test(t)) return { m: num };
    }
    // Explicit "día N" / "day N" / "mes N" / "month N"
    const diaM = t.match(/\b(?:dia|day)\s+(\d{1,2})\b/);
    if (diaM) { const n = parseInt(diaM[1]); if (n >= 1 && n <= 31) return { d: n }; }
    const mesM = t.match(/\b(?:mes|month)\s+(\d{1,2})\b/);
    if (mesM) { const n = parseInt(mesM[1]); if (n >= 1 && n <= 12) return { m: n }; }
    // Number word (1–31)
    for (const [word, num] of Object.entries(NUM_WORDS)) {
      if (new RegExp(`\\b${word}\\b`).test(t) && num >= 1 && num <= 31) {
        if (!dateInputParts.d) return { d: num };
        if (!dateInputParts.m && num <= 12) return { m: num };
      }
    }
    // Bare digit
    const nM = t.match(/\b(\d{1,2})\b/);
    if (nM) {
      const n = parseInt(nM[1]);
      if (!dateInputParts.d && n >= 1 && n <= 31) return { d: n };
      if (!dateInputParts.m && n >= 1 && n <= 12) return { m: n };
    }
    return null;
  }

  /* Update the date hint text to reflect which parts have been collected. */
  function updateDateHintFromParts() {
    const hint = document.getElementById('dateInputHint');
    if (!hint) return;
    hint.classList.remove('input-hint-error');
    const { d, m, y } = dateInputParts;
    if (!d && !m && !y) { hint.textContent = dynamicTpl().dateInputHint || ''; return; }
    const MS = ['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const parts = [
      d != null ? `Día: ${d}` : 'Día: —',
      m != null ? `Mes: ${MS[m]}` : 'Mes: —',
      y != null ? `Año: ${y}` : 'Año: —',
    ];
    hint.textContent = parts.join('  ·  ');
  }

  /* Render the field-summary chip row above the title field. One pill per
     non-text field with a value (today: Picklist; later: Date, Boolean,
     Relationship). Auto-hides when no values are set. Mirrors how the
     cover-thumb stays visible while the user dictates other fields. */
