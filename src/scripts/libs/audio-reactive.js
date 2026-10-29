import { analyzeAudio, analyzeBands } from './audio-analyzer';
import { smoothLevel } from './audio-modulation';

export const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export const modulation = (level, depth = 250) =>
  65 + Math.pow(clamp(level), 0.65) * clamp(depth, 0, 300);

if (typeof globalThis.AudioReactiveSelfCheck === 'undefined') {
  globalThis.AudioReactiveSelfCheck =
    modulation(1) === 315 && modulation(-1) === 65;
}

export default class AudioReactive {
  constructor(onLevel) {
    this.onLevel = onLevel;
    this.running = false;
    this.heartbeat = 0;
    this.localContext = null;
    this.localTimer = 0;
    this.localSource = null;
    this.localAnalyser = null;
    this.localLeftAnalyser = null;
    this.localRightAnalyser = null;
    this.localSamples = null;
    this.localLeftSamples = null;
    this.localRightSamples = null;
    this.localFrequency = null;
    this.localFrequencySamples = null;
    this.localStream = null;
    this.previousLevel = 0;
    this.onMessage = (event) => {
      if (!this.heartbeat) {
        this.heartbeat = setInterval(() => {
          chrome.runtime
            .sendMessage({ type: 'audio-reactive-heartbeat' })
            .catch(() => {});
        }, 1000);
      }
      this.onLevel(
        event.detail && typeof event.detail === 'object'
          ? event.detail
          : {
              level: clamp(event.detail),
              left: clamp(event.detail),
              right: clamp(event.detail),
            },
      );
    };
    this.onStatus = (event) => {
      if (event.detail !== false) return;
      clearInterval(this.heartbeat);
      this.heartbeat = 0;
      this.onLevel(0);
    };
  }

  async start() {
    if (this.running) return;

    this.running = true;

    document.addEventListener('ytal-audio-level', this.onMessage);

    document.addEventListener('ytal-audio-status', this.onStatus);

    await this.startLocalCapture();
  }

  async startLocalCapture() {
    const video = document.querySelector('video');

    if (
      !video ||
      typeof video.captureStream !== 'function' ||
      this.localContext
    ) {
      return;
    }

    try {
      const stream = video.captureStream();

      if (stream.getAudioTracks().length === 0) {
        return;
      }

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      const splitter = context.createChannelSplitter(2);
      const frequency = context.createAnalyser();
      frequency.fftSize = 1024;
      frequency.smoothingTimeConstant = 0.55;
      const leftAnalyser = context.createAnalyser();
      const rightAnalyser = context.createAnalyser();
      analyser.fftSize = leftAnalyser.fftSize = rightAnalyser.fftSize = 512;
      analyser.smoothingTimeConstant = leftAnalyser.smoothingTimeConstant = rightAnalyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      source.connect(frequency);
      source.connect(splitter);
      splitter.connect(leftAnalyser, 0);
      splitter.connect(rightAnalyser, 1);

      await context.resume();

      this.localContext = context;
      this.localSource = source;
      this.localAnalyser = analyser;
      this.localLeftAnalyser = leftAnalyser;
      this.localRightAnalyser = rightAnalyser;
      this.localFrequency = frequency;
      this.localStream = stream;

      this.localSamples = new Float32Array(analyser.fftSize);
      this.localLeftSamples = new Float32Array(leftAnalyser.fftSize);
      this.localRightSamples = new Float32Array(rightAnalyser.fftSize);
      this.localFrequencySamples = new Uint8Array(frequency.frequencyBinCount);

      this.previousLevel = 0;

      this.localTimer = setInterval(() => {
        if (!this.running) return;

        if (video.paused || video.ended) {
          this.previousLevel = 0;

          this.onLevel({
            level: 0,
            left: 0,
            right: 0,
          });

          return;
        }

        analyser.getFloatTimeDomainData(this.localSamples);

        this.localLeftAnalyser.getFloatTimeDomainData(this.localLeftSamples);
        this.localRightAnalyser.getFloatTimeDomainData(this.localRightSamples);
        this.localFrequency.getByteFrequencyData(this.localFrequencySamples);
        const rawLevel = Math.min(1, analyzeAudio(this.localSamples) * 1.35);
        const left = Math.min(1, analyzeAudio(this.localLeftSamples) * 1.35);
        const right = Math.min(1, analyzeAudio(this.localRightSamples) * 1.35);
        const bands = analyzeBands(this.localFrequencySamples, context.sampleRate);

        const level = smoothLevel(this.previousLevel, rawLevel, 33);

        this.previousLevel = level;

        this.onLevel({
          level,
          left: smoothLevel(0, left, 33),
          right: smoothLevel(0, right, 33),
          ...bands,
        });
      }, 33);
    } catch (error) {
      console.warn('[YTAL] Local audio capture failed:', error);

      await this.stopLocalCapture();
    }
  }

  async stopLocalCapture() {
    if (this.localTimer != null) {
      clearInterval(this.localTimer);
      this.localTimer = null;
    }

    this.localSource?.disconnect();
    this.localAnalyser?.disconnect();
    this.localLeftAnalyser?.disconnect();
    this.localRightAnalyser?.disconnect();
    this.localFrequency?.disconnect();

    if (this.localContext) {
      await this.localContext.close().catch(() => {});
    }

    this.localContext = null;
    this.localSource = null;
    this.localAnalyser = null;
    this.localLeftAnalyser = null;
    this.localRightAnalyser = null;
    this.localSamples = null;
    this.localLeftSamples = null;
    this.localRightSamples = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.previousLevel = 0;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.heartbeat);
    clearInterval(this.localTimer);
    this.localTimer = 0;
    this.localSource?.mediaStream?.getTracks().forEach((track) => track.stop());
    this.localContext?.close();
    this.localContext =
      this.localSource =
      this.localAnalyser =
      this.localSamples =
        null;
    this.heartbeat = 0;
    document.removeEventListener('ytal-audio-level', this.onMessage);
    document.removeEventListener('ytal-audio-status', this.onStatus);
    this.onLevel(0);
  }
}
