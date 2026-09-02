/* Liferay Copilot Voice — module 2/8: liferay
 * Liferay integration: portal runtime detection, lrFetch, the api object, spaces preload, connection banner state, space creation.
 * Modules share one global scope and load strictly in order (element.js
 * chains them with async=false) — this file was split from the original
 * app.js without reordering, so cross-module references resolve at call
 * time exactly as before.
 */
  /* ─── Portal runtime detection ───
     True when the app runs inside a Liferay page as a custom element client
     extension: the portal exposes the `Liferay` global. In that mode requests
     go same-origin authenticated by the user's session + CSRF token
     (Liferay.authToken), the locale comes from ThemeDisplay, and the
     dev-server surfaces (proxy config, corner toggles) don't apply. */
  function inLiferayPortal() {
    return typeof window.Liferay === 'object'
        && window.Liferay !== null
        && !!window.Liferay.ThemeDisplay;
  }

  function liferayEnabled() {
    if (inLiferayPortal()) return true;
    /* `baseUrl` may be an empty string when same-origin (proxied via the dev
       server). Only `enabled === true` and a string baseUrl are required. */
    return appConfig.liferay?.enabled === true
        && typeof appConfig.liferay?.baseUrl === 'string';
  }

  function liferayAuthHeader() {
    const a = appConfig.liferay?.auth;
    if (!a?.username || !a?.password) return null;
    return 'Basic ' + btoa(a.username + ':' + a.password);
  }

  /* Throws a structured error so callers can tell network outages
     apart from server-side validation/permission failures.
       err.kind = 'network'  → fetch itself rejected (offline, DNS, etc.)
       err.kind = 'server'   → HTTP arrived with status outside 2xx
       err.status, err.body  → only set on 'server' kind */
  async function lrFetch(path, opts = {}) {
    const base = inLiferayPortal()
      ? ''
      : appConfig.liferay.baseUrl.replace(/\/+$/, '');
    const headers = { 'Accept': 'application/json', ...(opts.headers || {}) };
    if (inLiferayPortal()) {
      headers['x-csrf-token'] = window.Liferay.authToken;
    } else {
      const auth = liferayAuthHeader();
      if (auth) headers['Authorization'] = auth;
    }
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    let r;
    try {
      r = await fetch(base + path, { ...opts, headers });
    } catch (e) {
      const err = new Error(`Network error ${path}: ${e.message}`);
      err.kind = 'network';
      throw err;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const err  = new Error(`Liferay ${r.status} ${r.statusText} ${path}: ${body.slice(0, 200)}`);
      err.kind   = 'server';
      err.status = r.status;
      err.body   = body;
      throw err;
    }
    return r.json();
  }

  /* Liferay's REST errors come back as JSON like
       { "status": "BAD_REQUEST", "title": "The value is invalid for ...", "type": "..." }
     Pull a friendly single-line summary, fall back to the raw body. */
  function liferayErrorMessage(err) {
    if (!err) return '';
    if (err.kind === 'network') return s('errorLiferayConnection');
    const body = err.body || '';
    try {
      const j = JSON.parse(body);
      return j.title || j.message || j.detail || err.message;
    } catch (_) {
      return body || err.message;
    }
  }

  /* Map a Liferay AssetLibrary → the shape the UI expects.
       - `siteId` (not `id`) is what CMS object endpoints use as the scope id.
       - `settings.logoColor` is a Lexicon outline class (e.g. "outline-4");
         we pass it through verbatim. CSS has the matching .sticker-outline-N
         rules that mirror Liferay CMS exactly. Falls back to round-robin
         when missing. */
  function mapAssetLibrary(al, i) {
    return {
      id:    String(al.siteId),
      name:  al.name || al.assetLibraryKey || ('Space ' + (al.id ?? i + 1)),
      color: al.settings?.logoColor || SPACE_COLORS[i % SPACE_COLORS.length],
    };
  }

  async function fetchSpaces() {
    const data = await lrFetch('/o/headless-asset-library/v1.0/asset-libraries?pageSize=50');
    let items = data.items || [];
    /* Modern CMS builds type real Spaces as `type: "Space"`; plain
       `AssetLibrary` groups are rejected by the L_CMS object endpoints
       ("Group ID X is not valid for domain \"space\""). Keep only Spaces
       when the instance distinguishes them; older instances (everything
       reports AssetLibrary) keep the whole list. */
    const spaces = items.filter(al => al.type === 'Space');
    if (spaces.length) items = spaces;
    return items.map(mapAssetLibrary);
  }

  /* List CMS basic-documents in a scope, filtered to images.
     Object response shape (per `?pageSize=3` curl):
       {
         id: 36241,           // basic-document Object id
         title: "...",
         file: {
           id: 36230,         // Documents-and-Media FileEntry id (for cover refs)
           name: "...png",
           mimeType: "image/png",
           fileURL: "http://localhost:8080/documents/.../?...&imageThumbnail=1",
           link: { href: "/documents/.../?...&download=true&..." },
           ...
         }
       }
     We extract the path from fileURL so the dev-server proxy handles it
     same-origin (avoids the absolute http://localhost:8080 url breaking on
     the browser via CORS). */
  function looksLikeImage(d) {
    const ct = d.contentType || d.mimeType || d.file?.mimeType || d.file?.contentType || '';
    if (/^image\//i.test(ct)) return true;
    const fn = (d.file?.name || d.file?.fileName || d.fileName || d.title || '').toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(fn);
  }

  function pathOnly(url) {
    if (!url) return '';
    if (!/^https?:\/\//.test(url)) return url;
    try { const u = new URL(url); return u.pathname + u.search; }
    catch (_) { return url; }
  }

  /* Liferay's `file.fileURL` comes with `&imageThumbnail=1`, which serves
     a downscaled preview. We want both URLs:
       - full-size for the cover-thumb above the title and for embedding
         inline in web-content bodies
       - thumbnail for the carousel cards (faster to fetch and decode,
         and CSS scales it to 192×120 anyway) */
  function stripThumbnailParam(url) {
    if (!url) return url;
    const [path, query] = url.split('?');
    if (!query) return url;
    const params = new URLSearchParams(query);
    if (!params.has('imageThumbnail')) return url;
    params.delete('imageThumbnail');
    const q = params.toString();
    return q ? `${path}?${q}` : path;
  }
  function withThumbnailParam(url) {
    if (!url) return url;
    const [path, query] = url.split('?');
    const params = new URLSearchParams(query || '');
    params.set('imageThumbnail', '1');
    return `${path}?${params.toString()}`;
  }

  /* For images we want a relative path the browser can fetch same-origin
     against the dev-server proxy. The proxy injects Basic auth on the upstream
     Liferay request, so `<img src="/documents/...">` and
     `background:url(/documents/...)` both render without any cross-origin /
     cookie / 401 dance. Absolute liferay URLs would fail in <img> because the
     browser doesn't send Basic auth nor a session cookie cross-site. */
  /* Use a same-origin relative path so the browser hits the dev-server proxy
     (`localhost:8765`). The proxy injects `Authorization: Basic` on the
     upstream request to Liferay, so `<img>` and `background-image` render
     without dragging cross-site cookies (which `SameSite=Lax` blocks anyway)
     or trying to send Basic auth from the browser (which `<img>` can't). */
  async function fetchImagesForSpace(scopeId) {
    const data = await lrFetch(`/o/cms/basic-documents/scopes/${scopeId}?pageSize=50`);
    return (data.items || [])
      .filter(looksLikeImage)
      .map(d => {
        const file    = d.file || {};
        const rawPath = pathOnly(file.fileURL || file.link?.href || file.fileUrl || '');
        const fullUrl = stripThumbnailParam(rawPath);
        return {
          id:           String(d.id),
          fileEntryId:  file.id != null ? String(file.id) : null,
          name:         d.title || file.name || file.fileName || ('Image ' + d.id),
          url:          fullUrl,
          thumbnailUrl: fullUrl ? withThumbnailParam(fullUrl) : '',
        };
      });
  }

  /* Minimal HTML escaper for content we're about to inject into a string
     destined for Liferay's rich-text field. We don't need a full sanitiser
     — the source is the user's own dictation + their own image picks —
     just safety against `<`, `>`, `&`, `"` breaking the HTML structure. */
  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* L_CMS_BASIC_WEB_CONTENT → fields: title, content.
     Web content has no native cover-image field, so when the user picks an
     image from the carousel we embed it inline at the top of the body —
     matching how Liferay's CKEditor inserts images. The body itself is
     plain text from dictation, so we wrap it in a <p> and HTML-escape it
     so any literal <, >, & in the dictation don't break the markup. */
  async function postWebContent({ spaceId, title, content, coverImage }) {
    const bodyHtml = content
      ? `<p>${escapeHtml(content).replace(/\n+/g, '<br>')}</p>`
      : '';
    const imgHtml = coverImage?.url
      ? `<p><img src="${escapeHtml(coverImage.url)}" alt="${escapeHtml(coverImage.name || '')}"></p>`
      : '';
    return lrFetch(`/o/cms/basic-web-contents/scopes/${spaceId}`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        content: imgHtml + bodyHtml,
      }),
    });
  }

  /* L_CMS_BLOG → fields: title, subtitle, content, coverImage.
     `coverImage` is an Attachment field (DBType: Long). Empirically
     confirmed via curl matrix: Liferay expects the *DLFileEntry id* —
     i.e. `file.id` from a /o/cms/basic-documents/... item, NOT the
     basic-document Object Entry id (`d.id`). Both raw Long and
     `{ id: <Long> }` work; we pick raw to match the UI's hidden input
     (which posts the value as a single number). The `fileSource`
     setting on the field is enforced server-side from the Object
     definition, not something we send in the payload. */
  async function postBlog({ spaceId, title, subtitle, content, coverImage }) {
    const body = {
      title,
      subtitle: subtitle || '',
      content:  content  || '',
    };
    if (coverImage?.fileEntryId) {
      body.coverImage = Number(coverImage.fileEntryId);
    }
    return lrFetch(`/o/cms/blogs/scopes/${spaceId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /* ── Generic Object endpoint (dynamic CMS structures) ──
     Liferay's "CMS Site Builder → Structures" UI creates Custom Objects under
     the hood, all parented to the Object Folder `L_CMS_CONTENT_STRUCTURES`.
     `CMSBasicWebContent`, `CMSBlog`, `CMSBasicDocument` are the three
     Liferay ships out of the box; user-created structures (e.g. "Instalación")
     are extra Object Definitions in the same folder. From the REST side they
     all expose:
       GET  /o/object-admin/v1.0/object-definitions               → list
       GET  /o/object-admin/v1.0/object-definitions/{id}          → schema
       POST {restContextPath}/scopes/{groupId}/                   → create entry
     Picklists referenced from `objectFields[].listTypeDefinitionId` come from
     the headless-admin-list-type module.
     This block adds the three primitives the dynamic flow factory needs. */
  async function fetchObjectDefinitions() {
    const data = await lrFetch(
      '/o/object-admin/v1.0/object-definitions?pageSize=200'
    );
    return (data.items || []);
  }

  async function fetchPicklistEntries(listTypeDefinitionId) {
    if (!listTypeDefinitionId) return [];
    const data = await lrFetch(
      `/o/headless-admin-list-type/v1.0/list-type-definitions/${listTypeDefinitionId}`
    );
    return (data.listTypeEntries || []).map(e => ({
      key:  e.key,
      name: e.name_i18n
        ? (e.name_i18n[appConfig.locale]
            || e.name_i18n[String(appConfig.locale).replace('-', '_')]
            || e.name_i18n['en-US']
            || e.name_i18n['en_US']
            || e.name)
        : e.name,
    }));
  }

  /* POST a new Object entry. Liferay Objects with `scope: 'depot'` (Asset
     Library) and `acceptAllGroups: true` accept their groupId (the same
     siteId we use for spaces) in the URL. `fields` is a flat object of
     field-name → value, exactly the shape Liferay expects for plain
     (non-attachment, non-relationship) fields. */
  async function postObjectEntry({ restContextPath, scopeId, fields }) {
    if (!restContextPath) throw new Error('Missing restContextPath');
    const path = `${restContextPath.replace(/\/+$/, '')}/scopes/${scopeId}/`;
    return lrFetch(path, {
      method: 'POST',
      body: JSON.stringify(fields || {}),
    });
  }

  /* L_CMS_BASIC_DOCUMENT → fields: file, title.
     Liferay Objects with a file field accept multipart/form-data with the
     binary in the `file` part and other Object fields as plain form parts. */
  async function postFile({ spaceId, file }) {
    if (!file) throw new Error('No file selected');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', file.name || 'Untitled');
    /* FormData boundary is set by the browser — must NOT pass Content-Type. */
    const headers = {};
    let base;
    if (inLiferayPortal()) {
      headers['x-csrf-token'] = window.Liferay.authToken;
      base = '';
    } else {
      const auth = liferayAuthHeader();
      if (auth) headers['Authorization'] = auth;
      base = appConfig.liferay.baseUrl.replace(/\/+$/, '');
    }
    const r = await fetch(`${base}/o/cms/basic-documents/scopes/${spaceId}`, {
      method: 'POST', headers, body: fd,
    });
    if (!r.ok) throw new Error(`Liferay ${r.status} ${r.statusText} file upload`);
    return r.json();
  }

  const api = {
    getSpaces() {
      return spacesCache ?? [];
    },
    getCoverImages() {
      return imagesCache ?? [];
    },
    /* Triggered from showImageCarousel — async refresh of the per-space
       images cache. Carousel re-renders when it lands. On any failure the
       cache is left empty so the carousel shows its empty state instead of
       a stale or fake list. */
    async refreshCoverImagesFor(spaceId) {
      if (!liferayEnabled() || !spaceId) {
        imagesCache = [];
        imagesCacheSpaceId = spaceId;
        return;
      }
      if (imagesCacheSpaceId === spaceId && imagesCache && !imagesLoadError) return;
      try {
        imagesCache = await fetchImagesForSpace(spaceId);
        imagesCacheSpaceId = spaceId;
        imagesLoadError = false;
      } catch (err) {
        console.warn('[liferay] cover images:', err.message);
        imagesCache = [];
        imagesCacheSpaceId = spaceId;
        imagesLoadError = true;
        announce(s('carouselError'), 'alert');
        /* Only the connectivity case warrants the global banner — a 4xx
           on a single endpoint shouldn't make the user think Liferay is
           unreachable. The carousel shows its own error message. */
        if (err.kind === 'network') showLiferayError(s('errorLiferayConnection'));
      }
    },
    async submitWebContent(payload) {
      try {
        const r = await postWebContent(payload);
        console.log('[liferay] structured content created:', r.id);
        return r;
      } catch (err) {
        console.warn('[liferay] submitWebContent failed:', err.message);
        if (err.kind === 'network') showLiferayError(s('errorLiferayConnection'));
        return { ok: false, error: liferayErrorMessage(err), kind: err.kind };
      }
    },
    async submitBlog(payload) {
      try {
        const r = await postBlog(payload);
        console.log('[liferay] blog posting created:', r.id);
        return r;
      } catch (err) {
        console.warn('[liferay] submitBlog failed:', err.message);
        if (err.kind === 'network') showLiferayError(s('errorLiferayConnection'));
        return { ok: false, error: liferayErrorMessage(err), kind: err.kind };
      }
    },
    async uploadFile(payload) {
      try {
        const r = await postFile(payload);
        console.log('[liferay] document uploaded:', r.id);
        return r;
      } catch (err) {
        console.warn('[liferay] uploadFile failed:', err.message);
        if (err.kind === 'network') showLiferayError(s('errorLiferayConnection'));
        return { ok: false, error: liferayErrorMessage(err), kind: err.kind };
      }
    },
    /* Dynamic Object-driven flows. The factory in app.js reads these. */
    getContentObjectDefinitions() {
      return objectDefsCache ?? [];
    },
    getPicklistEntries(id) {
      return picklistCache.get(id) ?? [];
    },
    async submitObjectEntry(payload) {
      try {
        const r = await postObjectEntry(payload);
        console.log('[liferay] object entry created:', r?.id);
        return r;
      } catch (err) {
        console.warn('[liferay] submitObjectEntry failed:', err.message);
        if (err.kind === 'network') showLiferayError(s('errorLiferayConnection'));
        return { ok: false, error: liferayErrorMessage(err), kind: err.kind };
      }
    },
  };

  /* Pre-fetch the spaces once on boot — also serves as the connectivity
     check that gates voice activation. Called from loadAll() and from the
     "Retry" button on the connection-error banner. */
  /* True when the last preload reached Liferay fine but found zero spaces —
     a setup problem, not a connectivity one. Drives the banner variant with
     the "Create space" action. */
  let spacesEmpty = false;
  /* Portal only: the preload failed because the viewer is a guest — the
     honest message is "sign in", not "server unreachable". */
  let needsSignIn = false;

  /* When the copilot can't work (guest, no connection, no spaces) the UI
     shouldn't invite interaction: grey the keycap and hide the "press SPACE"
     hint — the banner carries the reason and the fix. */
  function setBlockedState(blocked) {
    document.querySelector('.stage')?.classList.toggle('copilot-blocked', !!blocked);
  }

  function viewerIsGuest() {
    return inLiferayPortal()
        && window.Liferay.ThemeDisplay.isSignedIn
        && !window.Liferay.ThemeDisplay.isSignedIn();
  }

  async function preloadLiferaySpaces() {
    /* Blocked while checking — unblocked only on a successful preload. */
    setBlockedState(true);
    if (!liferayEnabled()) {
      liferayHealthy = false;
      spacesEmpty = false;
      needsSignIn = false;
      setBlockedState(true);
      showLiferayError(s('errorLiferayConnection'));
      return;
    }
    try {
      spacesCache = await fetchSpaces();
      liferayHealthy = (spacesCache?.length ?? 0) > 0;
      spacesEmpty = !liferayHealthy && !viewerIsGuest();
      needsSignIn = !liferayHealthy && viewerIsGuest();
      console.log('[liferay] sites loaded:', spacesCache.map(s => s.name).join(', '));
      setBlockedState(!liferayHealthy);
      if (liferayHealthy)      hideLiferayError();
      else if (needsSignIn)    showLiferayError(s('errorSignIn'));
      else                     showLiferayNoSpaces();
    } catch (err) {
      liferayHealthy = false;
      spacesEmpty = false;
      needsSignIn = viewerIsGuest();
      setBlockedState(true);
      console.warn('[liferay] sites failed:', err.message);
      /* Guests get a 401/403 from the API — the fix is signing in, not
         checking the server. Everything else counts as connectivity: if we
         can't list spaces, the prototype can't do anything useful. */
      showLiferayError(s(needsSignIn ? 'errorSignIn' : 'errorLiferayConnection'));
    }
  }

  function showLiferayNoSpaces() {
    showLiferayError(s('errorNoSpaces'), { showCreateSpace: true });
  }

  /* Creates a real CMS Space (asset library with type "Space"). The API path
     skips the UI wizard entirely — collaborators can be added later from the
     CMS admin. */
  function createSpaceRequest(name) {
    return lrFetch('/o/headless-asset-library/v1.0/asset-libraries', {
      method: 'POST',
      /* Liferay validates the request locale against the instance's
         available languages when creating a space — a browser tag like
         en-GB gets rejected ("No locales match the accepted languages").
         Send the app's resolved BCP-47 locale explicitly instead. */
      headers: { 'Accept-Language': (appConfig.locale || 'en-US').replace('_', '-') },
      body: JSON.stringify({ name, type: 'Space' }),
    });
  }

  /* ─── SPACE CREATION PANEL ───
     Reached from the "crear espacio" global voice command, the cmd-list pill,
     or the empty-instance banner button (which also works with the mic off —
     type the name and press Enter). Dictation appends into the field; say
     "confirmar" (or press Enter) to create, "cancelar" (or Escape) to back
     out. */
  let spaceCreateValue = '';
  const SPACE_CREATE_CONFIRM = ['confirmar', 'confirm', 'conferma', 'aceptar', 'accept', 'accetta'];
  const SPACE_CREATE_CANCEL  = ['cancelar', 'cancel', 'annulla', 'volver', 'back', 'torna'];

  /* Long names overflow the centered input clipping both edges — switch to
     left alignment and keep the tail (what's being dictated) in view. */
  function syncSpaceCreateOverflow(field) {
    if (!field) return;
    field.classList.toggle('overflowing', field.scrollWidth > field.clientWidth);
    field.scrollLeft = field.scrollWidth;
  }

  function enterSpaceCreate() {
    hideLiferayError();
    spaceCreateValue = '';
    const field = document.getElementById('spaceCreateField');
    if (field) {
      field.value = '';
      field.disabled = false;
      field.classList.remove('field-interim', 'overflowing');
    }
    setUiMode('space-create');
    /* The command usually matches on an interim — the same utterance's final
       ("create space") would otherwise land in the name field. Same drain the
       content fields use: drop the in-flight utterance, keep fresh speech. */
    if (utteranceInFlight) {
      skipNextFinal        = true;
      dropResidualInterims = true;
    }
    document.getElementById('spaceCreatePanel')?.classList.add('dictating');
    /* Reached from the banner button while idle: the mic is off and the
       full-size keycap would float over the panel — hide it; the user types
       the name and presses Enter. Voice-initiated entry keeps the corner
       keycap as usual. */
    document.querySelector('.stage')?.classList.toggle('hide-keycap', appState === 'idle');
    if (field) requestAnimationFrame(() => field.focus());
  }

  function exitSpaceCreate() {
    document.getElementById('spaceCreatePanel')?.classList.remove('dictating');
    document.querySelector('.stage')?.classList.remove('hide-keycap');
    spaceCreateValue = '';
    if (appState === 'idle') toIdle();
    else setUiMode('listening:command');
  }

  async function confirmSpaceCreate() {
    const field = document.getElementById('spaceCreateField');
    /* spaceCreateValue is the committed name — the field itself may still be
       showing an interim preview that includes the spoken "confirm". Typed
       input stays in sync via the input listener. */
    const name = spaceCreateValue.trim();
    if (!name) {
      announce(s('spaceCreatePrompt'), 'alert');
      return;
    }
    if (field) field.disabled = true;
    try {
      await createSpaceRequest(name);
      await preloadLiferaySpaces();
      flashCommandDetected(s('spaceFlash', { name }));
      announce(s('announceSpaceCreated', { name }));
      exitSpaceCreate();
    } catch (err) {
      console.warn('[liferay] create space failed:', err.message);
      showLiferayError(liferayErrorMessage(err) || s('errorLiferayConnection'));
    } finally {
      if (field) field.disabled = false;
    }
  }

