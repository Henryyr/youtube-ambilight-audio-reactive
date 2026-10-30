import {
  analyzeAudio,
  analyzeBands,
  analyzeCorrelation,
  analyzeTransient,
} from './audio-analyzer';
import { smoothLevel } from './audio-modulation';

export const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export const modulation = (level, depth = 250) =>
  65 + Math.pow(clamp(level), 0.65) * clamp(depth, 0, 300);

export default class AudioReactive {
  constructor(onLevel, getVideo = () => document.querySelector('video')) {
    this.onLevel = onLevel;
    this.getVideo = getVideo;
    this.running = false;
    this.external = false;
    this.generation = 0;
    this.heartbeat = 0;
    this.capture = null;
    this.onMessage = (event) => {
      if (!this.running) return;
      if (!this.external) {
        this.external = true;
        this.stopLocalCapture();
      }
      if (!this.heartbeat) {
        this.heartbeat = setInterval(() => {
          chrome.runtime.sendMessage({ type: 'audio-reactive-heartbeat' }).catch(() => {});
        }, 1000);
      }
      this.onLevel(event.detail && typeof event.detail === 'object'
        ? event.detail
        : { level: clamp(event.detail), left: clamp(event.detail), right: clamp(event.detail) });
    };
    this.onStatus = (event) => {
      if (event.detail !== false) return;
      clearInterval(this.heartbeat);
      this.heartbeat = 0;
      this.external = false;
      this.onLevel(0);
      this.startLocalCapture();
    };
    this.onPlayback = (event) => {
      if (event.target !== this.getVideo()) return;
      if (event.type === 'emptied' || event.type === 'ended') {
        this.stopLocalCapture();
        this.onLevel(0);
      } else if (event.type === 'pause') {
        this.stopTimer();
        if (this.capture) this.capture.previous = [0, 0, 0];
        this.onLevel(0);
      } else {
        this.startLocalCapture();
      }
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener('ytal-audio-level', this.onMessage);
    document.addEventListener('ytal-audio-status', this.onStatus);
    for (const type of ['loadeddata', 'playing', 'pause', 'emptied', 'ended'])
      document.addEventListener(type, this.onPlayback, true);
    this.startLocalCapture();
  }

  refreshLocalCapture() {
    this.stopLocalCapture();
    this.onLevel(0);
    return this.startLocalCapture();
  }

  async startLocalCapture() {
    const video = this.getVideo();
    if (!this.running || this.external || !video || video.paused || video.ended) return;
    if (this.capture?.video === video) {
      if (this.capture.ready) this.startTimer();
      return;
    }
    this.stopLocalCapture();
    const captureStream = video.captureStream || video.mozCaptureStream;
    if (typeof captureStream !== 'function') return;
    const generation = this.generation;
    let stream;
    try {
      stream = captureStream.call(video);
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop());
        return; // loadeddata/playing retries once the new source has audio tracks.
      }
      const context = new AudioContext();
      const capture = { video, stream, context, nodes: [], previous: [0, 0, 0], ready: false };
      this.capture = capture;
      const source = context.createMediaStreamSource(stream);
      const splitter = context.createChannelSplitter(2);
      const analysers = Array.from({ length: 3 }, () => context.createAnalyser());
      const frequency = context.createAnalyser();
      capture.nodes.push(source, splitter, ...analysers, frequency);
      for (const analyser of analysers) analyser.fftSize = 512;
      frequency.fftSize = 1024;
      frequency.smoothingTimeConstant = 0.55;
      source.connect(analysers[0]);
      source.connect(frequency);
      // Upmix mono before the splitter, whose channel interpretation is discrete.
      const stereo = context.createGain();
      stereo.channelCount = 2;
      stereo.channelCountMode = 'explicit';
      stereo.channelInterpretation = 'speakers';
      capture.nodes.push(stereo);
      source.connect(stereo);
      stereo.connect(splitter);
      splitter.connect(analysers[1], 0);
      splitter.connect(analysers[2], 1);
      capture.analysers = analysers;
      capture.frequency = frequency;
      capture.samples = analysers.map((analyser) => new Float32Array(analyser.fftSize));
      capture.bins = new Uint8Array(frequency.frequencyBinCount);
      capture.leftBins = new Uint8Array(analysers[1].frequencyBinCount);
      capture.rightBins = new Uint8Array(analysers[2].frequencyBinCount);
      capture.onEnded = () => {
        if (this.capture === capture) this.refreshLocalCapture();
      };
      stream.getAudioTracks().forEach((track) => track.addEventListener('ended', capture.onEnded));
      await context.resume();
      if (!this.running || this.generation !== generation || this.capture !== capture) return;
      capture.ready = true;
      this.startTimer();
    } catch (error) {
      if (generation !== this.generation) return;
      console.warn('[YTAL] Local audio capture failed:', error);
      stream?.getTracks().forEach((track) => track.stop());
      this.stopLocalCapture();
      this.onLevel(0);
    }
  }

  startTimer() {
    const capture = this.capture;
    if (!capture?.ready || this.localTimer || capture.video.paused) return;
    this.localTimer = setInterval(() => {
      if (!this.running || this.capture !== capture) return;
      if (capture.video !== this.getVideo()) return this.refreshLocalCapture();
      if (capture.video.paused || capture.video.ended) {
        this.stopTimer();
        this.onLevel(0);
        return;
      }
      const previousLevel = capture.previous[0];
      const levels = capture.analysers.map((analyser, index) => {
        analyser.getFloatTimeDomainData(capture.samples[index]);
        const raw = Math.min(1, analyzeAudio(capture.samples[index]) * 1.35);
        return smoothLevel(capture.previous[index], raw, 33);
      });
      capture.previous = levels;
      capture.frequency.getByteFrequencyData(capture.bins);
      capture.analysers[1].getByteFrequencyData(capture.leftBins);
      capture.analysers[2].getByteFrequencyData(capture.rightBins);
      const globalBands = analyzeBands(capture.bins, capture.context.sampleRate);
      const leftBands = analyzeBands(capture.leftBins, capture.context.sampleRate);
      const rightBands = analyzeBands(capture.rightBins, capture.context.sampleRate);
      const correlation = analyzeCorrelation(capture.samples[1], capture.samples[2]);
      const transient = analyzeTransient(levels[0], previousLevel);
      this.onLevel({
        level: levels[0],
        left: levels[1],
        right: levels[2],
        ...globalBands,
        leftBass: leftBands.bass,
        rightBass: rightBands.bass,
        leftTreble: leftBands.treble,
        rightTreble: rightBands.treble,
        correlation,
        transient,
      });
    }, 33);
  }

  stopTimer() {
    clearInterval(this.localTimer);
    this.localTimer = 0;
  }

  stopLocalCapture() {
    this.generation++;
    this.stopTimer();
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;
    capture.stream.getAudioTracks().forEach((track) => track.removeEventListener('ended', capture.onEnded));
    capture.nodes.forEach((node) => node.disconnect());
    capture.stream.getTracks().forEach((track) => track.stop());
    capture.context.close().catch((error) => console.warn('[YTAL] Audio cleanup failed:', error));
  }

  stop() {
    this.running = false;
    this.external = false;
    clearInterval(this.heartbeat);
    this.heartbeat = 0;
    this.stopLocalCapture();
    document.removeEventListener('ytal-audio-level', this.onMessage);
    document.removeEventListener('ytal-audio-status', this.onStatus);
    for (const type of ['loadeddata', 'playing', 'pause', 'emptied', 'ended'])
      document.removeEventListener(type, this.onPlayback, true);
    this.onLevel(0);
  }
}
