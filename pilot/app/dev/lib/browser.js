'use strict';
const fs = require('fs');
const path = require('path');

// One discovery path for every browser check. An explicit but invalid override is
// a configuration error, not evidence that an optional check was skipped.
function browserSupport({ env = process.env, platform = process.platform, websocket = typeof WebSocket === 'function', executable } = {}) {
  executable ||= file => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
  const onPath = name => (env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name));
  let candidates;
  if (env.CHROME) {
    candidates = env.CHROME.includes('/') || env.CHROME.includes('\\') ? [env.CHROME] : onPath(env.CHROME);
    if (!candidates.some(executable)) return { status: 'error', reason: 'CHROME does not name an executable browser' };
  } else {
    candidates = [
      ...['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge'].flatMap(onPath),
      ...(platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : []),
    ];
  }
  if (!websocket) return { status: 'skip', reason: 'browser checks need Node 22+ (global WebSocket)' };
  const chrome = candidates.find(executable);
  return chrome ? { status: 'ready', chrome } : { status: 'skip', reason: 'no Chromium browser found; set CHROME to its executable' };
}
module.exports = { browserSupport };
