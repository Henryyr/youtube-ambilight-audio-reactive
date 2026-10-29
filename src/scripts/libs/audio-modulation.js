export const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export function smoothLevel(previous, target, elapsedMs) {
  const duration = target > previous ? 35 : 160;
  const amount = 1 - Math.exp(-Math.max(0, elapsedMs) / duration);
  return previous + (target - previous) * amount;
}

export function audioVisuals(audio) {
  if (!audio || typeof audio !== 'object')
    return { scale: 1, brightness: 1, opacity: 1, blur: 0, pan: 0 };
  const level = clamp(audio.level);
  const left = clamp(audio.left ?? level);
  const right = clamp(audio.right ?? level);
  const total = left + right;
  const balance = total > 0.001 ? (right - left) / total : 0;
  return {
    scale: 0.82 + 0.58 * level,
    brightness: 0.8 + 1.6 * level,
    opacity: 0.6 + 0.4 * level,
    blur: 6 * level,
    pan: balance * level * 8,
  };
}
