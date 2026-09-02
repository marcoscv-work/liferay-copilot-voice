/* Liferay Copilot Voice — product site interactions.
   The hero demo re-creates the app's real animation model: bar3 doubles as
   the idle mic oval, heights follow an exponential spring toward sine
   targets, and recognised commands flash the bars purple for ~900 ms. */
(function () {
  'use strict';

  /* ── Hero voice-bars demo ─────────────────────────────────────────── */
  const stage   = document.getElementById('vdStage');
  const caption = document.getElementById('vdCaption');
  const demo    = document.getElementById('voiceDemo');
  const bars    = stage ? [...stage.querySelectorAll('.vd-bar')] : [];

  const BLUE   = ['#D7E4FF', '#B3CDFF', '#80ACFF', '#B3CDFF', '#D7E4FF'];
  const PURPLE = ['#DDD6FE', '#C4B5FD', '#7B6FEE', '#C4B5FD', '#DDD6FE'];
  const FLASH_HEIGHTS = [72, 88, 100, 88, 72];
  const PHASES = [0.0, 1.3, 2.6, 0.7, 1.9];
  const SPEEDS = [2.1, 2.9, 3.6, 2.7, 2.2];

  const CHECK = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* One scripted "conversation" that loops while the demo runs. */
  const SCRIPT = [
    { at: 0.0,  caption: '<strong>Listening…</strong> say a command' },
    { at: 2.6,  flash: 'Create content' },
    { at: 3.6,  caption: 'Dictating the title…' },
    { at: 6.4,  flash: 'Go to content' },
    { at: 7.4,  caption: 'Dictating the body…' },
    { at: 10.4, flash: 'Send' },
    { at: 11.4, caption: '<strong>Published.</strong> Hands never left the coffee.' },
    { at: 14.0, restart: true },
  ];

  let running = false;
  let rafId = null;
  let liveH = [20, 20, 20, 20, 20];
  let lastT = 0;
  let scriptT = 0;
  let scriptIdx = 0;
  let flashUntil = 0;

  function setColors(cols) {
    bars.forEach((b, i) => { b.style.background = cols[i]; });
  }

  function flash(label) {
    flashUntil = performance.now() + 900;
    setColors(PURPLE);
    caption.innerHTML = `<span class="vd-pill">${CHECK}${label}</span>`;
    setTimeout(() => { if (running) setColors(BLUE); }, 900);
  }

  function tick(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
    lastT = now;

    scriptT += dt;
    while (scriptIdx < SCRIPT.length && scriptT >= SCRIPT[scriptIdx].at) {
      const ev = SCRIPT[scriptIdx++];
      if (ev.flash)   flash(ev.flash);
      if (ev.caption) caption.innerHTML = ev.caption;
      if (ev.restart) { scriptT = 0; scriptIdx = 0; }
    }

    const boosted = now < flashUntil;
    for (let i = 0; i < 5; i++) {
      const target = boosted
        ? FLASH_HEIGHTS[i]
        : 30 + 34 * (0.5 + 0.5 * Math.sin(PHASES[i] + now / 1000 * SPEEDS[i]))
             + 10 * Math.sin(now / 1000 * (SPEEDS[i] * 2.7) + i);
      liveH[i] += (target - liveH[i]) * (1 - Math.exp(-14 * dt));
      bars[i].style.height = liveH[i].toFixed(1) + 'px';
    }
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running || !stage) return;
    running = true;
    stage.classList.remove('idle');
    bars.forEach(b => {
      b.style.width = '';
      b.style.borderRadius = '';
      b.style.transition = 'background 0.4s ease';
    });
    setColors(BLUE);
    liveH = [20, 20, 20, 20, 20];
    scriptT = 0;
    scriptIdx = 0;
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    bars.forEach(b => { b.style.height = ''; b.style.background = ''; });
    stage.classList.add('idle');
    caption.innerHTML = '&nbsp;';
  }

  /* Interacting never kills the demo — while it runs, a press fires an
     instant command flash (the fun part of the real app); from idle it
     starts listening. Pausing is reserved for scrolling out of view. */
  const USER_FLASHES = ['Create content', 'New blog', 'Create space', 'Send'];
  let userFlashIdx = 0;
  function interact() {
    if (!running) { start(); return; }
    flash(USER_FLASHES[userFlashIdx++ % USER_FLASHES.length]);
  }

  if (demo) {
    demo.tabIndex = 0;
    demo.addEventListener('click', interact);
    demo.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); interact(); }
    });
    /* Auto-start when the hero is on screen, pause when it scrolls away —
       and respect reduced-motion preferences entirely. */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && 'IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        entries.forEach(en => { en.isIntersecting ? start() : stop(); });
      }, { threshold: 0.35 }).observe(demo);
    }
  }

  /* ── Command reference (ES / EN / IT) ─────────────────────────────── */
  const COMMANDS = {
    es: {
      'Global — start something': ['crear contenido', 'crear blog', 'subir archivo', 'crear espacio', 'ayuda', 'salir'],
      'While dictating': ['ir a título', 'borrar título', 'ir a contenido', 'borrar contenido', 'borrar última palabra', 'ver comandos de formato'],
      'Content extras': ['añadir imagen', 'imagen dos', 'quitar imagen', 'revisar formato'],
      'Finish or leave': ['enviar', 'guardar', 'publicar', 'cancelar', 'volver'],
      'Spoken punctuation': ['punto', 'coma', 'dos puntos', 'punto y coma', 'abrir interrogación', 'exclamación'],
    },
    en: {
      'Global — start something': ['create content', 'create blog', 'upload file', 'create space', 'help', 'exit'],
      'While dictating': ['go to title', 'clear title', 'go to content', 'clear content', 'delete last word', 'show format commands'],
      'Content extras': ['add image', 'image two', 'remove image', 'review formatting'],
      'Finish or leave': ['send', 'save', 'publish', 'cancel', 'back'],
      'Spoken punctuation': ['period', 'comma', 'colon', 'semicolon', 'question mark', 'exclamation mark'],
    },
    it: {
      'Global — start something': ['crea contenuto', 'crea blog', 'carica file', 'crea spazio', 'aiuto', 'esci'],
      'While dictating': ['vai al titolo', 'cancella titolo', 'vai al contenuto', 'cancella contenuto', "cancella l'ultima parola", 'mostra comandi di formato'],
      'Content extras': ['aggiungi immagine', 'immagine due', 'rimuovi immagine', 'rivedi formato'],
      'Finish or leave': ['invia', 'salva', 'pubblica', 'annulla', 'torna'],
      'Spoken punctuation': ['punto', 'virgola', 'due punti', 'punto e virgola', 'punto interrogativo', 'punto esclamativo'],
    },
  };
  const PILL_STYLES = { 'Global — start something': 'blue', 'Finish or leave': 'green', 'Spoken punctuation': '' };

  const groupsEl = document.getElementById('cmdGroups');
  const tabsEl   = document.getElementById('langTabs');

  function renderCommands(lang) {
    if (!groupsEl) return;
    groupsEl.innerHTML = Object.entries(COMMANDS[lang]).map(([group, phrases]) => {
      const style = PILL_STYLES[group] ?? 'blue';
      return `<div class="cmd-group reveal in">
        <h3>${group}</h3>
        <div class="pill-row">${phrases.map(p => `<span class="pill ${style}">${p}</span>`).join('')}</div>
      </div>`;
    }).join('');
  }
  function activateTab(btn) {
    tabsEl.querySelectorAll('button').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    groupsEl?.setAttribute('aria-labelledby', btn.id);
    renderCommands(btn.dataset.lang);
  }
  if (tabsEl) {
    tabsEl.addEventListener('click', e => {
      const btn = e.target.closest('button[data-lang]');
      if (btn) activateTab(btn);
    });
    /* Arrow-key navigation with roving tabindex (WAI-ARIA tabs pattern). */
    tabsEl.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = [...tabsEl.querySelectorAll('button[data-lang]')];
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      activateTab(next);
    });
    renderCommands('es');
  }

  /* ── Mobile nav (burger) ──────────────────────────────────────────── */
  const nav    = document.querySelector('.nav');
  const burger = document.getElementById('navBurger');
  if (nav && burger) {
    const setOpen = open => {
      nav.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    burger.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    document.getElementById('navLinks')?.addEventListener('click', e => {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') setOpen(false);
    });
    document.addEventListener('click', e => {
      if (nav.classList.contains('open') && !e.target.closest('.nav')) setOpen(false);
    });
  }

  /* ── Copy buttons on code blocks ──────────────────────────────────── */
  document.querySelectorAll('pre').forEach(pre => {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      navigator.clipboard?.writeText(pre.querySelector('code')?.innerText || '').then(() => {
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      });
    });
    pre.appendChild(btn);
  });

  /* ── Scroll reveal ────────────────────────────────────────────────── */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
  }
})();
