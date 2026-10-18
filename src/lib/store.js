/*
 * Thin wrapper over extension storage. `data` is what was read from FAP and is
 * overwritten on every sync; `state` is the user's choices and survives syncs.
 */
(function (root) {
  'use strict';

  const ext = root.browser && root.browser.storage ? root.browser : root.chrome;
  const DATA_KEY = 'fgpa:data';
  const STATE_KEY = 'fgpa:state';

  function normalizeState(raw) {
    const base = root.FapGpa.emptyState();
    if (!raw) return base;
    return {
      selection: raw.selection || base.selection,
      overrides: raw.overrides || base.overrides,
      manual: raw.manual || base.manual,
      settings: { ...base.settings, ...raw.settings },
    };
  }

  async function load() {
    const result = await ext.storage.local.get([DATA_KEY, STATE_KEY]);
    return { data: result[DATA_KEY] || null, state: normalizeState(result[STATE_KEY]) };
  }

  function saveData(data) {
    return ext.storage.local.set({ [DATA_KEY]: data });
  }

  function saveState(state) {
    return ext.storage.local.set({ [STATE_KEY]: state });
  }

  function clearAll() {
    return ext.storage.local.remove([DATA_KEY, STATE_KEY]);
  }

  /** Calls `listener()` whenever data or state changes, from any extension page or tab. */
  function onChange(listener) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (DATA_KEY in changes || STATE_KEY in changes)) listener();
    });
  }

  root.FapGpaStore = { load, saveData, saveState, clearAll, onChange };
})(globalThis);
