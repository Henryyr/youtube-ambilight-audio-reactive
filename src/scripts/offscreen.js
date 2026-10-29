import { analyzeAudio } from './libs/audio-analyzer';
import { smoothLevel } from './libs/audio-modulation';
const debug = (...args) => console.log('[audio-reactive:offscreen]', ...args);
let ctx, source, stream, analyser, splitter, leftAnalyser, rightAnalyser, timer, tabId, lastHeartbeat = Date.now(), level = 0, paused = false;
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m.type === 'audio-reactive-offscreen-start') {
    start(m).then(
      () => reply({ ok: true }),
      (error) => reply({ error: error.message || 'Unable to start audio capture.' })
    );
    return true;
  }
  if (m.type === 'audio-reactive-offscreen-stop') stop();
  if (m.type === 'audio-reactive-playback') {
    paused = m.paused === true;
    if (paused) emitLevel(0);
  }
  if (m.type === 'audio-reactive-heartbeat') lastHeartbeat = Date.now();
  return false;
});
async function start(m) {
  debug('start requested', { tabId: m.tabId, hasStreamId: typeof m.streamId === 'string' });
  stop(); tabId = m.tabId; paused = false; ctx = new AudioContext();
  stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId } } });
  debug('stream acquired', { tracks: stream.getAudioTracks().length, contextState: ctx.state });
  source = ctx.createMediaStreamSource(stream); source.connect(ctx.destination);
  analyser = ctx.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
  splitter = ctx.createChannelSplitter(2);
  leftAnalyser = ctx.createAnalyser(); rightAnalyser = ctx.createAnalyser();
  leftAnalyser.fftSize = rightAnalyser.fftSize = 512;
  source.connect(splitter);
  splitter.connect(leftAnalyser, 0); splitter.connect(rightAnalyser, 1);
  const samples = new Float32Array(analyser.fftSize);
  const leftSamples = new Float32Array(leftAnalyser.fftSize);
  const rightSamples = new Float32Array(rightAnalyser.fftSize);
  lastHeartbeat = Date.now();
  timer = setInterval(() => {
    if (Date.now() - lastHeartbeat > 4000) { debug('heartbeat timeout', { lastHeartbeat, tabId }); return stop(); }
    if (paused) return;
    analyser.getFloatTimeDomainData(samples);
    leftAnalyser.getFloatTimeDomainData(leftSamples);
    rightAnalyser.getFloatTimeDomainData(rightSamples);
    level = smoothLevel(level, analyzeAudio(samples), 33);
    emitLevel(level, analyzeAudio(leftSamples), analyzeAudio(rightSamples));
  }, 33);
  stream.getAudioTracks()[0]?.addEventListener('ended', () => stop());
}
function emitLevel(nextLevel, left = nextLevel, right = nextLevel) {
  level = nextLevel;
  chrome.runtime.sendMessage({ type: 'audio-reactive-offscreen-level', tabId, level, left, right }).catch(() => {});
}
function stop() {
  const stoppedTabId = tabId;
  debug('stop', { tabId: stoppedTabId });
  if (timer) clearInterval(timer);
  timer = null;
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  ctx = source = stream = analyser = null;
  paused = false;
  tabId = null;
  if (stoppedTabId != null) chrome.runtime.sendMessage({ type: 'audio-reactive-offscreen-ended', tabId: stoppedTabId });
}
