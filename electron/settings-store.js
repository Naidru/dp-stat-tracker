'use strict';
// Persists user preferences and hotkey configurations across launches.
// Saved in the main process under userData/settings.json.
// Same atomic write-then-rename pattern as match-archive.js and store.js.

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const DEFAULT_SETTINGS = {
  overlayHotkey: config.OVERLAY_HOTKEY || 'Control+Shift+Y',
};

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  get(key) {
    return this.data[key] ?? DEFAULT_SETTINGS[key];
  }

  set(key, value) {
    if (this.data[key] === value) return value;
    this.data[key] = value;
    this._save();
    return value;
  }

  reset(key) {
    const defaultVal = DEFAULT_SETTINGS[key];
    if (defaultVal !== undefined) {
      return this.set(key, defaultVal);
    }
    return undefined;
  }

  getAll() {
    return { ...this.data };
  }

  getDefault(key) {
    return DEFAULT_SETTINGS[key];
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };
