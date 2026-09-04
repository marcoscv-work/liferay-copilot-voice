/* Single source of the Copilot Voice markup. Rendered by the custom
 * element (element.js) both in the standalone page and inside Liferay as
 * a client extension. Keep ids/classes in sync with app.js and styles.css. */
(function () {
  'use strict';
  const MARKUP = `
<div class="stage">
  <!-- Screen-reader live regions. Visually hidden but always present in the
       a11y tree. Every user-facing announcement goes through one of these
       via the \`announce(text, level)\` helper in app.js. Non-modal status
       messages use \`liveStatus\` (polite); errors / cancel-confirms / blocking
       confirmations use \`liveAlert\` (assertive). -->
  <div id="liveStatus" role="status" aria-live="polite"    aria-atomic="true" class="sr-only"></div>
  <div id="liveAlert"  role="alert"  aria-live="assertive" aria-atomic="true" class="sr-only"></div>

  <div class="language-toggle" role="group" aria-label="Language">
    <button type="button" data-lang="es">ES</button>
    <button type="button" data-lang="en">EN</button>
    <button type="button" data-lang="it">IT</button>
    <button type="button" data-lang="pt">PT</button>
    <button type="button" data-lang="de">DE</button>
    <button type="button" data-lang="fr">FR</button>
  </div>

  <!-- Developer toggles. Hidden by default (hover the bottom-right corner
       to reveal). The bottom-right is reserved for dev / debug switches. -->
  <div class="dev-toggle" role="group" aria-label="Developer tools">
    <button type="button" data-debug="live-regions">Live regions</button>
    <a href="/config" class="dev-toggle-link">Liferay config</a>
  </div>

  <!-- Top-of-screen banner for Liferay connectivity issues. role=alert is
       handled at announce() time (we send to liveAlert separately so the
       banner itself can stay polite-status to avoid double-announcement). -->
  <div class="liferay-error" id="liferayError" role="status" aria-live="polite" hidden>
    <svg class="liferay-error-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      <path d="M12 8v5M12 16v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span class="liferay-error-text" id="liferayErrorText"></span>
    <a class="liferay-error-config" href="/config" data-language="errorConfigLabel"></a>
    <button class="liferay-error-retry" id="liferayErrorCreateSpace" type="button" data-language="errorCreateSpaceLabel" hidden></button>
    <button class="liferay-error-retry" id="liferayErrorRetry" type="button" data-language="errorRetryLabel"></button>
    <button class="liferay-error-dismiss" id="liferayErrorDismiss" type="button" data-language-aria-label="errorDismissLabel">×</button>
  </div>
  <p class="hint" id="hint" data-language="hint" data-language-html></p>
  <div class="img-carousel" id="imgCarousel">
    <div class="carousel-empty" id="carouselEmpty" role="status" hidden></div>
    <div class="carousel-track" id="carouselTrack"></div>
  </div>

  <div class="side-panel" id="sidePanel">
    <div class="side-panel-title" data-language="sidePanelTitle"></div>
    <ul id="sidePanelList"></ul>
  </div>

  <div class="space-picker" id="spacePicker">
    <div class="space-picker-prompt" id="spacePickerPrompt"></div>
    <ul class="space-list" id="spaceList"></ul>
  </div>

  <!-- Options picker — used by \`flow:options\` for Picklist fields in dynamic
       Object-driven flows. Same pattern as space-picker (cards + voice +
       click), different DOM ids so the two can coexist if ever needed. -->
  <div class="options-picker" id="optionsPicker">
    <div class="options-picker-prompt" id="optionsPickerPrompt"></div>
    <ul class="options-list" id="optionsList"></ul>
  </div>

  <!-- Number input panel — Integer / Long / Double / BigDecimal fields. -->
  <div class="number-input-panel" id="numberInputPanel">
    <div class="number-input-prompt" id="numberInputPrompt"></div>
    <div class="number-input-card">
      <input type="number" id="numberInputField" class="number-input-field"
             inputmode="numeric" autocomplete="off" step="any"
             aria-labelledby="numberInputPrompt" aria-describedby="numberInputHint">
    </div>
    <p class="number-input-hint" id="numberInputHint"></p>
  </div>

  <!-- Date input panel — Date / DateTime fields.
       input.type is switched to datetime-local dynamically for DateTime. -->
  <!-- Space creation panel — reached via the "crear espacio" global command
       or the empty-instance banner button. Reuses the number-input styling. -->
  <div class="number-input-panel" id="spaceCreatePanel">
    <div class="number-input-prompt" data-language="spaceCreatePrompt"></div>
    <div class="number-input-card">
      <input type="text" id="spaceCreateField" class="number-input-field" autocomplete="off" spellcheck="false" data-language-aria-label="spaceCreatePrompt">
    </div>
    <p class="number-input-hint" data-language="spaceCreateHint"></p>
  </div>

  <!-- Space color step — the CMS sticker palette, picked by number or click. -->
  <div class="number-input-panel space-color-panel" id="spaceColorPanel">
    <div class="number-input-prompt" data-language="spaceColorPrompt"></div>
    <div class="space-color-grid" role="group" data-language-aria-label="spaceColorPrompt">
      <button type="button" class="space-color-swatch sticker-outline-0" data-color="outline-0">1</button>
      <button type="button" class="space-color-swatch sticker-outline-1" data-color="outline-1">2</button>
      <button type="button" class="space-color-swatch sticker-outline-2" data-color="outline-2">3</button>
      <button type="button" class="space-color-swatch sticker-outline-3" data-color="outline-3">4</button>
      <button type="button" class="space-color-swatch sticker-outline-4" data-color="outline-4">5</button>
      <button type="button" class="space-color-swatch sticker-outline-5" data-color="outline-5">6</button>
      <button type="button" class="space-color-swatch sticker-outline-6" data-color="outline-6">7</button>
      <button type="button" class="space-color-swatch sticker-outline-7" data-color="outline-7">8</button>
      <button type="button" class="space-color-swatch sticker-outline-8" data-color="outline-8">9</button>
      <button type="button" class="space-color-swatch sticker-outline-9" data-color="outline-9">10</button>
    </div>
    <p class="number-input-hint" data-language="spaceColorHint"></p>
  </div>

  <div class="date-input-panel" id="dateInputPanel">
    <div class="date-input-prompt" id="dateInputPrompt"></div>
    <div class="date-input-card">
      <input type="date" id="dateInputField" class="date-input-field"
             aria-labelledby="dateInputPrompt" aria-describedby="dateInputHint">
    </div>
    <p class="date-input-hint" id="dateInputHint"></p>
  </div>

  <div class="file-picker" id="filePicker">
    <div class="file-picker-prompt" id="filePickerPrompt"></div>
    <div class="file-picker-card" id="filePickerCard">
      <button type="button" class="file-picker-btn" id="filePickerBtn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span data-language="filePickerButton"></span>
      </button>
      <div class="file-picker-info">
        <span class="file-picker-info-name" id="filePickerInfoName" data-language="fileNoSelection"></span>
        <span class="file-picker-info-size" id="filePickerInfoSize"></span>
      </div>
    </div>
    <input type="file" id="fileInput" hidden>
  </div>

  <div class="sent-msg" id="sentMsg" role="status" aria-live="polite">
    <svg class="sent-msg-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#5791ff"/>
      <path d="M7 12.5l3.5 3.5L17 9" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span class="sent-msg-text" data-language="sentMessage"></span>
  </div>

  <div class="cancel-confirm" id="cancelConfirm" role="alert" hidden>
    <svg class="cancel-confirm-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      <path d="M12 8v5M12 16v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span class="cancel-confirm-text" id="cancelConfirmText"></span>
  </div>

  <div class="ai-overlay" id="aiConfirm">
    <div class="ai-card" role="dialog" aria-modal="true" aria-labelledby="aiConfirmTitleText" tabindex="-1">
      <p class="ai-card-title" id="aiConfirmTitleText" data-language="aiConfirmTitle"></p>
      <div class="ai-card-actions">
        <button class="ai-btn ai-btn-secondary" id="aiConfirmNo"  data-language="aiConfirmNo"></button>
        <button class="ai-btn ai-btn-primary"   id="aiConfirmYes" data-language="aiConfirmYes"></button>
      </div>
    </div>
  </div>

  <div class="ai-overlay" id="aiModal">
    <div class="ai-card" id="aiModalCard" role="dialog" aria-modal="true" tabindex="-1">
      <div id="aiModalLoading">
        <div class="ai-spinner"></div>
        <p class="ai-loading-text" data-language="aiLoadingTitle"></p>
        <p class="ai-loading-sub"   data-language="aiLoadingSub"></p>
        <p class="ai-loading-model" id="aiLoadingModel"></p>
      </div>
      <div id="aiModalResult" hidden>
        <span class="ai-result-tag">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span data-language="aiReviewTag"></span>
        </span>
        <div class="ai-result-content">
          <h4 data-language="aiReviewLabelTitle"></h4>
          <p id="aiResultTitle"></p>
          <div id="aiResultSubtitleRow" hidden>
            <h4 data-language="aiReviewLabelSubtitle"></h4>
            <p id="aiResultSubtitle"></p>
          </div>
          <h4 data-language="aiReviewLabelBody"></h4>
          <p id="aiResultBody"></p>
        </div>
        <div class="ai-card-actions">
          <button class="ai-btn ai-btn-danger"  id="aiResultCancel" data-language="aiReviewCancel"></button>
          <button class="ai-btn ai-btn-primary" id="aiResultAccept" data-language="aiReviewAccept"></button>
        </div>
      </div>
    </div>
  </div>
  <p class="cmd-hint" id="cmdHint" data-language="cmdHint" data-language-html></p>

  <div class="cmd-list" id="cmdList">
    <div class="cmd-list-title" data-language="cmdListTitle"></div>
    <ul id="cmdListUl"></ul>
  </div>

  <div class="format-list" id="formatList" role="dialog" aria-modal="true" aria-labelledby="formatListTitleText" tabindex="-1">
    <div class="format-list-title" id="formatListTitleText" data-language="formatListTitle"></div>
    <div class="format-list-content" id="formatListContent"></div>
    <div class="format-list-back" data-language="formatBackHint" data-language-html></div>
  </div>

  <div class="content-panel" id="contentPanel">
    <div class="form-error" id="formError" role="status" aria-live="polite" hidden></div>
    <!-- Summary row for non-text field selections in dynamic Object-driven
         flows. One chip per Picklist (and later Date/Boolean) value picked,
         so the user sees "Estado: New" in the form context — same role as
         coverThumb plays for the cover image. -->
    <div class="field-summary" id="fieldSummary" role="status" aria-live="polite" hidden></div>
    <div class="cover-thumb" id="coverThumb"></div>
    <div class="content-field" id="titleField">
      <div class="field-box">
        <input class="field-input" id="titleInput" type="text" autocomplete="off" spellcheck="true" data-language-placeholder="placeholderTitle" data-language-aria-label="placeholderTitle">
        <button class="field-mic" type="button" data-field-mic>
          <svg class="field-mic-icon field-mic-on-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>
            <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M12 18v3M9 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <svg class="field-mic-icon field-mic-muted-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="content-field" id="subtitleField">
      <div class="field-box">
        <input class="field-input" id="subtitleInput" type="text" autocomplete="off" spellcheck="true" data-language-placeholder="placeholderSubtitle" data-language-aria-label="placeholderSubtitle">
        <button class="field-mic" type="button" data-field-mic>
          <svg class="field-mic-icon field-mic-on-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>
            <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M12 18v3M9 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <svg class="field-mic-icon field-mic-muted-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="content-field" id="bodyField">
      <div class="field-box body-box">
        <textarea class="field-textarea" id="bodyInput" rows="1" autocomplete="off" spellcheck="true" data-language-placeholder="placeholderContent" data-language-aria-label="placeholderContent"></textarea>
        <button class="field-mic" type="button" data-field-mic>
          <svg class="field-mic-icon field-mic-on-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>
            <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M12 18v3M9 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <svg class="field-mic-icon field-mic-muted-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  </div>

  <div class="keycap-wrap">
    <div class="keycap-shadow" id="keycapShadow"></div>

    <button type="button" class="keycap" id="keycap" aria-pressed="false" data-language-aria-label="keycapToggleLabel">
      <span class="space-label" id="spaceLabel">SPACE</span>
      <span class="mic-wrap" id="micWrap">
        <!-- Only micOuter (arc + stand). micBody is replaced by bar3. -->
        <svg class="mic-svg" viewBox="0 0 82 127" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path id="micOuter"
            d="M81.222 51.041v10.3c.005 10.87-4.272 21.305-11.904 29.045-3.688 3.758-8.07 6.765-12.903 8.853-3.643 1.574-7.502 2.592-11.448 3.019v14.931h18.178c1.156 0 2.264.459 3.08 1.276.817.817 1.276 1.925 1.276 3.08 0 1.156-.459 2.264-1.276 3.081-.816.817-1.924 1.276-3.08 1.276H18.077c-1.156 0-2.264-.459-3.08-1.276C14.18 124.809 13.72 123.7 13.72 122.545c0-1.155.46-2.263 1.276-3.08.817-.817 1.925-1.276 3.081-1.276h18.178v-14.931c-3.946-.428-7.804-1.446-11.448-3.019-4.833-2.088-9.215-5.095-12.903-8.853C4.27 83.628-.007 73.19 0 62.317V52.017c0-.573.113-1.14.332-1.668.219-.529.54-1.01.945-1.415.405-.405.886-.726 1.415-.945.529-.219 1.096-.332 1.668-.332.573 0 1.14.113 1.669.332.529.219 1.009.54 1.414.945.405.405.726.886.945 1.415.219.528.332 1.095.332 1.668v10.3c-.023 8.587 3.355 16.833 9.396 22.935 2.923 3.009 6.42 5.401 10.284 7.034 3.864 1.633 8.016 2.475 12.211 2.475 4.195 0 8.347-.842 12.211-2.475 3.864-1.633 7.361-4.025 10.284-7.034 6.039-6.103 9.417-14.349 9.396-22.935v-10.3c0-1.156.459-2.265 1.277-3.083.818-.818 1.927-1.277 3.083-1.277 1.156 0 2.265.459 3.083 1.277.817.818 1.277 1.935 1.277 3.091z"
            fill="#80ACFF" style="transition:opacity 0.2s ease"/>
        </svg>
      </span>
    </button>

    <!-- bar3 starts as the mic oval (blue pill). bar1,2,4,5 are invisible at first. -->
    <div class="bars" id="bars">
      <div class="bar" id="bar1"></div>
      <div class="bar" id="bar2"></div>
      <div class="bar" id="bar3"></div>
      <div class="bar" id="bar4"></div>
      <div class="bar" id="bar5"></div>
    </div>

    <div class="bars-label" id="barsLabel"></div>
  </div>
</div>
`;
  window.CopilotVoiceMarkup = {
    render(root) {
      root.innerHTML = MARKUP;
    },
  };
})();
