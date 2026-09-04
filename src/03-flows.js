/* Liferay Copilot Voice — module 3/8: flows
 * Flow model: getFlow/getStep, dynamic Object-driven flow discovery and construction, step navigation.
 * Modules share one global scope and load strictly in order (element.js
 * chains them with async=false) — this file was split from the original
 * app.js without reordering, so cross-module references resolve at call
 * time exactly as before.
 */
  /* Deployment-level action filter. Sources: the element's disabled-commands
     attribute (set by whoever places the widget) merged with config.json
     commands.disabled. Accepts global command ids ("create-space"), the
     reserved "create-structured" token (turns off Object-driven flow
     discovery entirely) and per-structure "dynamic:{ObjectName}" ids.
     This is UX configuration, NOT security — Liferay permissions still gate
     every API call. "exit" is never filtered: voice-off must always work. */
  function disabledCommandIds() {
    const attr = String(window.__copilotVoiceDisabledCommands || '');
    const cfg  = appConfig?.commands?.disabled || [];
    return new Set(
      [...attr.split(/[\s,]+/), ...cfg].map(x => String(x).trim()).filter(Boolean)
    );
  }

  function isCommandDisabled(id) {
    if (id === 'exit') return false;
    return disabledCommandIds().has(id);
  }

  function getFlow() {
    if (!flowsConfig) return null;
    return flowsConfig.flows?.[currentFlowId]
        ?? flowsConfig.flows?.createWebContent  /* fallback for help text */
        ?? null;
  }

  function getStep(stepId) {
    return getFlow()?.steps?.find(st => st.id === stepId) ?? null;
  }

  /* ── Dynamic Object-driven flows ──
     Liferay's "CMS Site Builder → Structures" UI creates Custom Objects
     parented to the `L_CMS_CONTENT_STRUCTURES` Object Folder. Built-ins
     (`CMSBasicWebContent`, `CMSBlog`, `CMSBasicDocument`) are already
     covered by the hardcoded createWebContent / createBlog / createFile
     flows; we discover the rest at boot, build a flow per Object, and
     register a "crear {label}" global voice command for each.

     We NEVER replace the hardcoded flows — keeping them stable while we
     iterate on the dynamic factory. Phase 2 (later) will migrate them
     to the same factory once it covers all field types they need. */

  /* Internal names of the three Liferay-shipped CMS Objects we already
     handle natively. Filtered out at discovery so we don't double-register. */
  const NATIVE_CMS_OBJECTS = new Set([
    'CMSBasicWebContent',
    'CMSBlog',
    'CMSBasicDocument',
  ]);

  /* Pull a localised label out of a `label` / `name_i18n` map, falling back
     across locale variants (`es-ES` / `es_ES`) and finally to `en_US` / the
     raw `name`. Liferay uses both separator styles inconsistently across
     headless modules. */
  function localizeLabel(map, fallback) {
    if (!map || typeof map !== 'object') return fallback || '';
    const loc = appConfig.locale || 'en-US';
    const dash = loc;
    const usc  = loc.replace('-', '_');
    const baseDash = dash.split('-')[0];
    const baseUsc  = usc.split('_')[0];
    return map[dash] || map[usc] || map[baseDash] || map[baseUsc]
        || map['en-US'] || map['en_US'] || map['en']
        || fallback || '';
  }

  /* Hardcoded ES/EN/IT phrase templates for the dynamic factory. Kept inline
     for now — once the factory matures these should move to a `dynamicPhrases`
     block in flows.<lang>.json so localisation work doesn't require a code
     change. {label} is the field's localised label, lowercased. */
  const DYNAMIC_TEMPLATES = {
    es: {
      createPhrases: ['crear {label}', 'nuevo {label}', 'nueva {label}'],
      createLabel:   'Crear {label}',
      goPhrases:     ['ir a {label}', 'volver a {label}', 'ir al {label}', 'volver al {label}'],
      goLabel:       'Ir a {label}',
      clearPhrases:  ['borrar {label}', 'borrar el {label}', 'borrar la {label}'],
      clearLabel:    'Borrar {label}',
      voicePromptText:    'Di {label}',
      voicePromptOptions: 'Di la opción de {label}',
      errorMissing:  'Falta {label}. Complétalo antes de enviar.',
      optionsPrompt: '¿Qué {label}?',
      announceListing: 'Opciones disponibles: {list}.',
      announceSelected: '{label} seleccionado: {value}.',
      booleanYes: 'Sí', booleanNo: 'No',
      voicePromptNumber: 'Di el número de {label}',
      voicePromptDate:   'Di la fecha de {label}',
      dateInputHint:     'Puedes escribir o decir la fecha',
      numberInputHint:   'Puedes escribir o decir el número',
      dateDayLabel: 'Día', dateMonthLabel: 'Mes', dateYearLabel: 'Año',
    },
    en: {
      createPhrases: ['create {label}', 'new {label}'],
      createLabel:   'Create {label}',
      goPhrases:     ['go to {label}', 'back to {label}'],
      goLabel:       'Go to {label}',
      clearPhrases:  ['clear {label}', 'delete {label}', 'remove {label}'],
      clearLabel:    'Clear {label}',
      voicePromptText:    'Say the {label}',
      voicePromptOptions: 'Say the {label} option',
      errorMissing:  'Missing {label}. Complete it before sending.',
      optionsPrompt: 'Which {label}?',
      announceListing: 'Available options: {list}.',
      announceSelected: '{label} selected: {value}.',
      booleanYes: 'Yes', booleanNo: 'No',
      voicePromptNumber: 'Say the number for {label}',
      voicePromptDate:   'Say the date for {label}',
      dateInputHint:     'You can type or say the date',
      numberInputHint:   'You can type or say the number',
      dateDayLabel: 'Day', dateMonthLabel: 'Month', dateYearLabel: 'Year',
    },
    it: {
      createPhrases: ['crea {label}', 'creare {label}', 'nuovo {label}', 'nuova {label}'],
      createLabel:   'Crea {label}',
      goPhrases:     ['vai a {label}', 'torna a {label}'],
      goLabel:       'Vai a {label}',
      clearPhrases:  ['cancella {label}', 'cancella il {label}', 'cancella la {label}'],
      clearLabel:    'Cancella {label}',
      voicePromptText:    'Pronuncia {label}',
      voicePromptOptions: 'Pronuncia l\'opzione di {label}',
      errorMissing:  'Manca {label}. Completalo prima di inviare.',
      optionsPrompt: 'Quale {label}?',
      announceListing: 'Opzioni disponibili: {list}.',
      announceSelected: '{label} selezionato: {value}.',
      booleanYes: 'Sì', booleanNo: 'No',
      voicePromptNumber: 'Pronuncia il numero di {label}',
      voicePromptDate:   'Pronuncia la data di {label}',
      dateInputHint:     'Puoi scrivere o dire la data',
      numberInputHint:   'Puoi scrivere o dire il numero',
      dateDayLabel: 'Giorno', dateMonthLabel: 'Mese', dateYearLabel: 'Anno',
    },
    pt: {
      createPhrases: ['criar {label}', 'novo {label}', 'nova {label}'],
      createLabel:   'Criar {label}',
      goPhrases:     ['ir para {label}', 'ir para o {label}', 'ir para a {label}', 'voltar ao {label}'],
      goLabel:       'Ir para {label}',
      clearPhrases:  ['apagar {label}', 'apagar o {label}', 'apagar a {label}', 'limpar {label}'],
      clearLabel:    'Apagar {label}',
      voicePromptText:    'Diga {label}',
      voicePromptOptions: 'Diga a opção de {label}',
      errorMissing:  'Falta {label}. Complete antes de enviar.',
      optionsPrompt: 'Qual {label}?',
      announceListing: 'Opções disponíveis: {list}.',
      announceSelected: '{label} selecionado: {value}.',
      booleanYes: 'Sim', booleanNo: 'Não',
      voicePromptNumber: 'Diga o número de {label}',
      voicePromptDate:   'Diga a data de {label}',
      dateInputHint:     'Você pode digitar ou dizer a data',
      numberInputHint:   'Você pode digitar ou dizer o número',
      dateDayLabel: 'Dia', dateMonthLabel: 'Mês', dateYearLabel: 'Ano',
    },
    de: {
      createPhrases: ['{label} erstellen', 'neuer {label}', 'neue {label}', 'neues {label}'],
      createLabel:   '{label} erstellen',
      goPhrases:     ['zu {label}', 'gehe zu {label}', 'zurück zu {label}', 'zurueck zu {label}'],
      goLabel:       'Zu {label}',
      clearPhrases:  ['{label} löschen', '{label} loeschen', '{label} entfernen'],
      clearLabel:    '{label} löschen',
      voicePromptText:    'Sage {label}',
      voicePromptOptions: 'Sage die Option für {label}',
      errorMissing:  '{label} fehlt. Vervollständige es vor dem Senden.',
      optionsPrompt: 'Welche(r) {label}?',
      announceListing: 'Verfügbare Optionen: {list}.',
      announceSelected: '{label} ausgewählt: {value}.',
      booleanYes: 'Ja', booleanNo: 'Nein',
      voicePromptNumber: 'Sage die Zahl für {label}',
      voicePromptDate:   'Sage das Datum für {label}',
      dateInputHint:     'Du kannst das Datum tippen oder sagen',
      numberInputHint:   'Du kannst die Zahl tippen oder sagen',
      dateDayLabel: 'Tag', dateMonthLabel: 'Monat', dateYearLabel: 'Jahr',
    },
    fr: {
      createPhrases: ['créer {label}', 'creer {label}', 'nouveau {label}', 'nouvelle {label}'],
      createLabel:   'Créer {label}',
      goPhrases:     ['aller à {label}', 'aller au {label}', 'retour à {label}', 'retour au {label}'],
      goLabel:       'Aller à {label}',
      clearPhrases:  ['effacer {label}', 'effacer le {label}', 'effacer la {label}', 'supprimer {label}'],
      clearLabel:    'Effacer {label}',
      voicePromptText:    'Dites {label}',
      voicePromptOptions: "Dites l'option de {label}",
      errorMissing:  "{label} manquant. Complétez-le avant d'envoyer.",
      optionsPrompt: 'Quel {label} ?',
      announceListing: 'Options disponibles : {list}.',
      announceSelected: '{label} sélectionné : {value}.',
      booleanYes: 'Oui', booleanNo: 'Non',
      voicePromptNumber: 'Dites le nombre pour {label}',
      voicePromptDate:   'Dites la date pour {label}',
      dateInputHint:     'Vous pouvez taper ou dire la date',
      numberInputHint:   'Vous pouvez taper ou dire le nombre',
      dateDayLabel: 'Jour', dateMonthLabel: 'Mois', dateYearLabel: 'Année',
    },
  };

  function dynamicTpl() {
    const base = String(appConfig.locale || 'en').toLowerCase().split(/[-_]/)[0];
    return DYNAMIC_TEMPLATES[base] || DYNAMIC_TEMPLATES.en;
  }

  function fillTpl(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
  }

  /* Build the steps + flowCommands of a dynamic flow from one Object Definition.
     Allocation rules (so we can render in the existing DOM without inventing
     new field elements):
       - First Text field      → step id 'title'    (titleField + titleValue)
       - Second Text field     → step id 'subtitle' (subtitleField + subtitleValue)
       - First LongText/RichText → step id 'content' (bodyField + bodyValue)
       - Picklist field        → step id 'picklist:<name>' (options overlay)
     Anything else (Date, Boolean, Attachment, Relationship, additional Text
     past slots) is skipped with a console.warn — Phase 2 / 3 territory.
     `title` is a special system field in CMS Objects: marked system but
     editable + required. We always include it; all other system fields
     (createDate, modifiedDate, status, …) are skipped. */
  function buildFlowFromObjectDefinition(def) {
    const tpl  = dynamicTpl();
    const name = localizeLabel(def.label, def.name);

    let titleSlot    = false;
    let subtitleSlot = false;
    let bodySlot     = false;
    const skipped    = [];

    /* Reuse the localised "in which space?" prompt from the hardcoded
       createWebContent flow if it's available — saves us from translating
       a sentence-level prompt in the inline templates. */
    const seedSpace = flowsConfig?.flows?.createWebContent?.steps?.find(s => s.id === 'space');
    const steps = [{
      id:    'space',
      type:  'picker',
      label: seedSpace?.label || 'Espacio',
      voicePrompt: seedSpace?.voicePrompt || fillTpl(tpl.optionsPrompt, { label: 'espacio' }),
      source: 'spaces',
    }];

    for (const f of def.objectFields || []) {
      /* Skip Liferay-managed system fields except the canonical title. */
      if (f.system && f.name !== 'title') continue;

      const fLabel  = localizeLabel(f.label, f.name);
      const fLabelL = fLabel.toLowerCase();
      let stepId, stepType, stepExtra = {};

      if (f.businessType === 'LongText' || f.businessType === 'RichText') {
        if (bodySlot) { skipped.push(`${f.name} (${f.businessType}, second body slot)`); continue; }
        stepId = 'content'; stepType = 'textarea'; bodySlot = true;
      } else if (f.businessType === 'Text' || (f.businessType === 'String' && f.DBType === 'String')) {
        if (!titleSlot)         { stepId = 'title';    stepType = 'text'; titleSlot    = true; }
        else if (!subtitleSlot) { stepId = 'subtitle'; stepType = 'text'; subtitleSlot = true; }
        else { stepId = `text:${f.name}`; stepType = 'text'; }
      } else if (f.businessType === 'Picklist') {
        stepId    = `picklist:${f.name}`;
        stepType  = 'options';
        const opts = picklistCache.get(f.listTypeDefinitionId) || [];
        stepExtra = { __pickId: f.listTypeDefinitionId, __options: opts };
      } else if (f.businessType === 'Boolean') {
        stepId   = `bool:${f.name}`;
        stepType = 'options';
        stepExtra = { __options: [
          { key: 'true',  name: tpl.booleanYes },
          { key: 'false', name: tpl.booleanNo  },
        ]};
      } else if (['Integer', 'Long', 'Double', 'BigDecimal', 'Decimal'].includes(f.businessType)) {
        stepId   = `number:${f.name}`;
        stepType = 'number';
        stepExtra = { __businessType: f.businessType };
      } else if (f.businessType === 'Date') {
        stepId   = `date:${f.name}`;
        stepType = 'date';
        stepExtra = { __businessType: 'Date' };
      } else if (f.businessType === 'DateTime') {
        stepId   = `date:${f.name}`;
        stepType = 'datetime';
        stepExtra = { __businessType: 'DateTime' };
      } else {
        skipped.push(`${f.name} (${f.businessType})`);
        continue;
      }

      const promptTpl =
        stepType === 'options'           ? tpl.optionsPrompt :
        stepType === 'number'            ? tpl.voicePromptNumber :
        (stepType === 'date' || stepType === 'datetime') ? tpl.voicePromptDate :
        tpl.voicePromptText;
      steps.push({
        id:           stepId,
        type:         stepType,
        label:        fLabel,
        placeholder:  fLabel,
        voicePrompt:  fillTpl(promptTpl, { label: fLabelL }),
        __field:      f.name,
        __required:   !!f.required,
        ...stepExtra,
      });
    }

    if (skipped.length) {
      console.warn(`[dynamic-flow ${def.name}] skipped fields:`, skipped.join(', '));
    }

    /* flowCommands: per-step go/clear (skipping space + the rare "no
       extra steps" case) plus the universal delete-last-word / send /
       cancel set. The factory deliberately doesn't add ai-review or
       show-format-commands to keep the side panel short for v1; they
       can be re-added once the dynamic flow has stabilised. */
    const flowCommands = [];
    for (const st of steps) {
      if (st.id === 'space') continue;
      const lblL = String(st.label).toLowerCase();
      flowCommands.push({
        id:      `go-to-${st.id}`,
        phrases: tpl.goPhrases.map(p => fillTpl(p, { label: lblL })),
        label:   fillTpl(tpl.goLabel,   { label: st.label }),
        action:  'goToStep',
        params:  { step: st.id },
      });
      flowCommands.push({
        id:      `clear-${st.id}`,
        phrases: tpl.clearPhrases.map(p => fillTpl(p, { label: lblL })),
        label:   fillTpl(tpl.clearLabel, { label: st.label }),
        action:  'clearStep',
        params:  { step: st.id },
      });
    }
    /* Delete-last-word + send + cancel: copy the phrasings from the existing
       createWebContent flow so the user gets identical voice UX whether the
       flow is hardcoded or dynamic. Falls back to a minimal hardcoded set
       if the source flow can't be located. */
    const seedFlow = flowsConfig?.flows?.createWebContent;
    const seedCmd  = (id) => seedFlow?.flowCommands?.find(c => c.id === id);
    const dlw  = seedCmd('delete-last-word');
    const send = seedCmd('send');
    const can  = seedCmd('cancel');
    flowCommands.push(dlw  || { id: 'delete-last-word', phrases: ['borrar palabra'], label: 'Borrar palabra', action: 'deleteLastWord' });
    flowCommands.push(send || { id: 'send',             phrases: ['enviar'],          label: 'Enviar',          action: 'submit', style: 'success' });
    flowCommands.push(can  || { id: 'cancel',           phrases: ['cancelar'],        label: 'Cancelar',        action: 'cancel', style: 'danger' });

    return {
      id:    `dynamic:${def.name}`,
      name,
      submitApi:          'submitObjectEntry',
      __dynamic:          true,
      __def:              def,
      __restContextPath:  def.restContextPath || `/o/c/${(def.name || '').toLowerCase()}`,
      steps,
      flowCommands,
    };
  }

  /* Discover Object Definitions in the CMS Site Builder folder, prefetch
     any picklists they reference, build a dynamic flow per Object, and
     register a global voice command per flow. Fire-and-forget: a failure
     just means no dynamic flows get registered, and the user can still
     use the hardcoded ones. */
  async function discoverDynamicFlows() {
    if (!liferayEnabled() || !flowsConfig) return;
    if (isCommandDisabled('create-structured')) {
      console.log('[dynamic-flow] discovery disabled (create-structured)');
      return;
    }
    let defs;
    try {
      defs = await fetchObjectDefinitions();
    } catch (err) {
      console.warn('[dynamic-flow] discovery failed:', err.message);
      return;
    }
    const eligible = defs.filter(d =>
      d?.active
      && !d.system
      && d.objectFolderExternalReferenceCode === 'L_CMS_CONTENT_STRUCTURES'
      && !NATIVE_CMS_OBJECTS.has(d.name)
      && !isCommandDisabled('dynamic:' + d.name)
    );
    objectDefsCache = eligible;
    if (eligible.length === 0) {
      console.log('[dynamic-flow] no custom CMS Objects discovered');
      return;
    }
    /* Prefetch every distinct picklist referenced by any field. */
    const picklistIds = new Set();
    for (const d of eligible) {
      for (const f of d.objectFields || []) {
        if (f.businessType === 'Picklist' && f.listTypeDefinitionId) {
          picklistIds.add(f.listTypeDefinitionId);
        }
      }
    }
    await Promise.all([...picklistIds].map(async (id) => {
      try {
        picklistCache.set(id, await fetchPicklistEntries(id));
      } catch (err) {
        console.warn(`[dynamic-flow] picklist ${id} fetch failed:`, err.message);
        picklistCache.set(id, []);
      }
    }));
    /* Now we can safely build the flows — each one captures the picklists
       that were just cached. Register them on flowsConfig + globalCommands
       so the existing engine treats them like any other flow.
       Insertion point: just BEFORE the `exit` command so the visible "Salir"
       pill always stays last in the help/cmd list. New "create" commands
       slot between the existing creators and the meta exit/help block. */
    const tpl = dynamicTpl();
    const exitIdx = flowsConfig.globalCommands.findIndex(c => c.id === 'exit');
    let insertAt = exitIdx >= 0 ? exitIdx : flowsConfig.globalCommands.length;
    for (const d of eligible) {
      const flow = buildFlowFromObjectDefinition(d);
      flowsConfig.flows[flow.id] = flow;
      const lblL = flow.name.toLowerCase();
      flowsConfig.globalCommands.splice(insertAt, 0, {
        id:           flow.id,
        phrases:      tpl.createPhrases.map(p => fillTpl(p, { label: lblL })),
        label:        fillTpl(tpl.createLabel, { label: flow.name }),
        description:  fillTpl(tpl.createLabel, { label: flow.name }),
        triggersFlow: flow.id,
        __dynamic:    true,
      });
      insertAt++;
      console.log(`[dynamic-flow] registered "${flow.name}" → ${flow.steps.length} steps,`,
                  `command "${tpl.createPhrases[0].replace('{label}', lblL)}"`);
    }
    /* The cmd list overlay was rendered before discovery — refresh so the new
       commands show up under "ayuda" / "comandos". */
    buildCmdList();
  }

  /* Read a step's current value from wherever it actually lives.
     Dynamic flows allocate text values to titleValue/subtitleValue/bodyValue
     and Picklist selections to dynamicFieldValues[stepId]. */
  function readStepValue(step) {
    if (!step) return '';
    if (step.id === 'title')    return titleValue;
    if (step.id === 'subtitle') return subtitleValue;
    if (step.id === 'content')  return bodyValue;
    if (step.type === 'options')  return dynamicFieldValues[step.id] || '';
    if (step.id.startsWith('text:'))    return dynamicFieldValues[step.id] || '';
    if (step.type === 'number')         return dynamicFieldValues[step.id] || '';
    if (step.type === 'date' || step.type === 'datetime') return dynamicFieldValues[step.id] || '';
    return '';
  }

  /* The next step after `stepId` in the current flow's declared order, or
     null if `stepId` was the last one. Skips space (always handled before
     the regular walk) but otherwise honours the order from the JSON / from
     buildFlowFromObjectDefinition. */
  function nextStepAfter(stepId) {
    const flow = getFlow();
    if (!flow) return null;
    const idx = flow.steps.findIndex(st => st.id === stepId);
    if (idx < 0) return null;
    for (let i = idx + 1; i < flow.steps.length; i++) {
      const st = flow.steps[i];
      if (st.id === 'space') continue;
      return st;
    }
    return null;
  }

  function prevStepBefore(stepId) {
    const flow = getFlow();
    if (!flow) return null;
    const idx = flow.steps.findIndex(st => st.id === stepId);
    if (idx < 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
      const st = flow.steps[i];
      if (st.id === 'space') continue;
      return st;
    }
    return null;
  }

  /* The DOM placeholders + aria-labels on the title / subtitle / body fields
     are wired to fixed strings (`placeholderTitle`, `placeholderSubtitle`,
     `placeholderContent`). When a dynamic flow is active those generic
     names ("Contenido") don't match the real Liferay field name
     ("Descripción"), which confuses the user and the screen reader.
     Update them in-place on flow start and reset on flow end. */
  function applyFlowFieldLabels() {
    const flow         = getFlow();
    const titleStep    = flow?.steps?.find(st => st.id === 'title');
    const subtitleStep = flow?.steps?.find(st => st.id === 'subtitle');
    const bodyStep     = flow?.steps?.find(st => st.id === 'content');
    const setLbl = (el, lbl) => {
      if (!el || !lbl) return;
      el.setAttribute('placeholder', lbl);
      el.setAttribute('aria-label',  lbl);
    };
    setLbl(titleText,    titleStep?.label    || s('placeholderTitle'));
    setLbl(subtitleText, subtitleStep?.label || s('placeholderSubtitle'));
    setLbl(bodyText,     bodyStep?.label     || s('placeholderContent'));
  }

  function resetFlowFieldLabels() {
    titleText   .setAttribute('placeholder', s('placeholderTitle')    || '');
    titleText   .setAttribute('aria-label',  s('placeholderTitle')    || '');
    subtitleText.setAttribute('placeholder', s('placeholderSubtitle') || '');
    subtitleText.setAttribute('aria-label',  s('placeholderSubtitle') || '');
    bodyText    .setAttribute('placeholder', s('placeholderContent')  || '');
    bodyText    .setAttribute('aria-label',  s('placeholderContent')  || '');
  }

  /* Generic "enter this step" — picks the right setUiMode based on step type.
     Used by auto-advance after a text field is dictated and by goToStep.
     Each branch routes through a helper that plays the fieldChange tone so
     every step transition has the same audio cue (parity with the original
     hardcoded enterTitleStep / startSubtitlePhase / startBodyPhase). */
  function enterStep(step) {
    if (!step) return;
    if (step.id === 'title')    { enterTitleStep(); return; }
    if (step.id === 'subtitle') { startSubtitlePhase(); return; }
    if (step.id === 'content')  { startBodyPhase(); return; }
    if (step.id === 'file')     { enterFileStep(); return; }
    if (step.type === 'options')  { enterOptionsStep(step); return; }
    if (step.type === 'image')   { showImageCarousel(); return; }
    if (step.type === 'text' && step.id.startsWith('text:')) { enterDynamicTextField(step); return; }
    if (step.type === 'number')  { enterNumberStep(step); return; }
    if (step.type === 'date' || step.type === 'datetime') { enterDateStep(step); return; }
    /* Unknown step type — do nothing, log so it's debuggable. */
    console.warn('[flow] enterStep: unknown step', step);
  }

