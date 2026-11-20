/** Shared extension-page → background service worker RPC helper. */
export function send(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!response) return reject(new Error('No response from background worker'));
      if (response.ok === false) return reject(new Error(response.error));
      return resolve(response.data);
    });
  });
}
