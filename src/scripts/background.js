import { getBrowser } from './libs/utils';

const DEBUG_AUDIO = true;
const debug = (...args) => DEBUG_AUDIO && console.log('[audio-reactive]', ...args);
const capture = { tabId: null };
const youtube = (url) => /^https:\/\/www\.youtube\.com\/(watch|embed\/)/.test(url || '');
const status = (tabId, active, error) => tabId != null && chrome.tabs.sendMessage(tabId, { type: 'audio-reactive-status', active, ...(error ? { error } : {}) }).catch(() => {});
async function stop(tabId = capture.tabId) {
  debug('stop', { tabId, activeTab: capture.tabId });
  if (tabId == null) return;
  capture.tabId = null; status(tabId, false);
  try { await chrome.runtime.sendMessage({ type: 'audio-reactive-offscreen-stop' }); } catch {}
  try { await chrome.offscreen.closeDocument(); } catch {}
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  debug('message', message.type, { tabId: message.tabId, senderTab: sender.tab?.id ?? 'extension' });
  if (sender.id !== chrome.runtime.id) return false;
  if (message.type === 'audio-reactive-status') {
    debug('status', capture);
    reply({ active: capture.tabId != null, tabId: capture.tabId });
    return false;
  }
  if (message.type === 'audio-reactive-start') {
    if (getBrowser() === 'Firefox') { reply({ error: 'Audio capture is unsupported in Firefox.' }); return false; }
    chrome.tabs.get(message.tabId).then(async (tab) => {
      if (!youtube(tab.url) || typeof message.streamId !== 'string') throw new Error('Capture requires an active YouTube watch tab.');
      if (capture.tabId != null && capture.tabId !== tab.id) await stop();
      capture.tabId = tab.id;
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Analyze audio levels without recording or persisting audio.' }).catch((e) => { if (!/already exists/i.test(e.message)) throw e; });
      debug('offscreen ready', { tabId: tab.id });
      const result = await chrome.runtime.sendMessage({ type: 'audio-reactive-offscreen-start', tabId: tab.id, streamId: message.streamId });
      if (!result?.ok) throw new Error(result?.error || 'Offscreen capture did not start.');
      debug('capture active', { tabId: tab.id });
      status(tab.id, true); reply({ ok: true });
    }).catch((e) => { debug('capture failed', e); capture.tabId = null; reply({ error: e.message }); });
    return true;
  }
  if (message.type === 'audio-reactive-stop') { stop().then(() => reply({ ok: true })); return true; }
  if (message.type === 'audio-reactive-heartbeat' && sender.tab?.id === capture.tabId) { chrome.runtime.sendMessage(message); return false; }
  if (message.type === 'audio-reactive-playback' && sender.tab?.id === capture.tabId) { chrome.runtime.sendMessage(message); return false; }
  if (message.type === 'audio-reactive-offscreen-level' && message.tabId === capture.tabId) {
    chrome.tabs.sendMessage(capture.tabId, {
      type: 'audio-reactive-level',
      level: message.level,
      left: message.left,
      right: message.right,
      bass: message.bass,
      mid: message.mid,
      treble: message.treble,
      leftBass: message.leftBass,
      rightBass: message.rightBass,
      leftTreble: message.leftTreble,
      rightTreble: message.rightTreble,
      correlation: message.correlation,
      transient: message.transient,
    }).catch((error) => debug('level delivery failed', error.message));
  }
  if (message.type === 'audio-reactive-offscreen-ended' && message.tabId === capture.tabId) stop();
  return false;
});
chrome.tabs.onRemoved.addListener((id) => id === capture.tabId && stop(id));
chrome.tabs.onUpdated.addListener((id, info) => id === capture.tabId && info.url && !youtube(info.url) && stop(id));
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  if (chrome.runtime.setUninstallURL) chrome.runtime.setUninstallURL('');
  if (details.reason === 'install' && getBrowser() === 'Firefox') chrome.runtime.openOptionsPage();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
