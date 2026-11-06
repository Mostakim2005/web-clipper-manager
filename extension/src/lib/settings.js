export const DEFAULTS = {
  // Vault
  vaultPath: '',
  notesFolder: 'Clippings',

  // Attachments
  attachmentMode: 'fixed', // fixed | noteRelative | sameAsNote
  attachmentFolder: '_assets',

  // Note shape
  filenameTemplate: '{{date}} {{title}}',
  embedStyle: 'wikilink', // wikilink | markdown
  embedWidth: 0,
  includeId: true,
  includeEngagement: true,
  includeSourceCallout: true,

  // Capture
  imageFormat: 'png', // png | jpeg

  // Service
  serviceUrl: 'http://127.0.0.1:8787',
  preferNativeHost: true,
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.sync.set(patch);
  return getSettings();
}
