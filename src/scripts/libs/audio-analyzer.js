export function analyzeAudio(samples) {
  let sum = 0;
  for (const sample of samples || []) {
    const value = Number.isFinite(sample) ? sample : 0;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / (samples?.length || 1)) * 4);
}

export function analyzeBands(samples, sampleRate) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0)
    return { bass: 0, mid: 0, treble: 0 };
  const hzPerBin = sampleRate / (samples.length * 2);
  const average = (from, to) => {
    const start = Math.max(1, Math.floor(from / hzPerBin));
    const end = Math.min(samples.length, Math.ceil(to / hzPerBin));
    let sum = 0;
    for (let index = start; index < end; index++) sum += samples[index] || 0;
    return end > start ? Math.min(1, sum / (end - start) / 128) : 0;
  };
  return {
    bass: average(40, 250),
    mid: average(250, 4000),
    treble: average(4000, 16000),
  };
}

export function analyzeCorrelation(left, right) {
  if (!left?.length || !right?.length) return 1;
  let sumL2 = 0;
  let sumR2 = 0;
  let sumLR = 0;
  const len = Math.min(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
  }
  const denom = Math.sqrt(sumL2 * sumR2);
  return denom > 0.0001 ? Math.max(-1, Math.min(1, sumLR / denom)) : 1;
}

export function analyzeTransient(current, previous, threshold = 0.08) {
  const diff = Math.max(0, (current || 0) - (previous || 0));
  return diff > threshold ? Math.min(1, diff / 0.3) : 0;
}
