export const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export function smoothLevel(previous, target, elapsedMs) {
  const duration = target > previous ? 35 : 160;
  const amount = 1 - Math.exp(-Math.max(0, elapsedMs) / duration);
  return previous + (target - previous) * amount;
}

// YouTube delivers stereo (sometimes mono). A true 7.1.4 decode is impossible
// from that, so these 11 zones are an approximation: stereo balance gives the
// side, bass/mid/treble decide front, side, rear and height emphasis.
export const ZONE_POSITIONS = {
  center: [0, 0],
  leftFront: [-0.5, 0.25],
  rightFront: [0.5, 0.25],
  leftSide: [-1, 0],
  rightSide: [1, 0],
  leftRear: [-0.6, -0.55],
  rightRear: [0.6, -0.55],
  leftFrontHeight: [-0.4, 0.9],
  rightFrontHeight: [0.4, 0.9],
  leftRearHeight: [-0.5, -0.9],
  rightRearHeight: [0.5, -0.9],
};

export const ZONE_NAMES = Object.keys(ZONE_POSITIONS);

export function spatialize(audio) {
  if (!audio || typeof audio !== 'object')
    return Object.fromEntries(ZONE_NAMES.map((name) => [name, 0]));
  const level = clamp(audio.level);
  const left = clamp(audio.left ?? level);
  const right = clamp(audio.right ?? level);
  const bass = clamp(audio.bass ?? 0);
  const mid = clamp(audio.mid ?? 0);
  const treble = clamp(audio.treble ?? 0);
  const leftBass = clamp(audio.leftBass ?? bass);
  const rightBass = clamp(audio.rightBass ?? bass);
  const leftTreble = clamp(audio.leftTreble ?? treble);
  const rightTreble = clamp(audio.rightTreble ?? treble);
  const correlation = clamp(audio.correlation ?? 1, -1, 1);
  const transient = clamp(audio.transient ?? 0);

  // Correlation gives stereo width: 1=mono, 0=stereo, -1=antiphase surround.
  const stereoWidth = Math.max(0, 1 - correlation) / 2;
  const diffuse = Math.max(0, -correlation);
  const punch = 1 + transient * 0.35;

  const common = Math.min(left, right);
  const leftOnly = Math.max(0, left - right);
  const rightOnly = Math.max(0, right - left);
  const frontWeight = (0.35 + 0.65 * mid) * (1 - diffuse * 0.4);
  const heightWeight = 0.4 + 0.6 * level;
  return {
    center: common * (0.5 + 0.5 * mid) * Math.max(0, correlation),
    leftFront: left * frontWeight * (1 - 0.4 * leftBass) * punch,
    rightFront: right * frontWeight * (1 - 0.4 * rightBass) * punch,
    leftSide: (leftOnly * frontWeight + left * stereoWidth * 0.4) * punch,
    rightSide: (rightOnly * frontWeight + right * stereoWidth * 0.4) * punch,
    leftRear: (left * leftBass * 0.8 + left * diffuse * 0.5) * punch,
    rightRear: (right * rightBass * 0.8 + right * diffuse * 0.5) * punch,
    leftFrontHeight: left * leftTreble * heightWeight * punch,
    rightFrontHeight: right * rightTreble * heightWeight * punch,
    leftRearHeight: (left * heightWeight * leftBass + left * diffuse * 0.5) * punch,
    rightRearHeight: (right * heightWeight * rightBass + right * diffuse * 0.5) * punch,
  };
}

export function zoneCentroid(zones) {
  let weight = 0;
  let x = 0;
  let y = 0;
  let peak = 'center';
  let peakValue = 0;
  for (const name of ZONE_NAMES) {
    const value = clamp(zones?.[name] ?? 0);
    if (value > peakValue) {
      peakValue = value;
      peak = name;
    }
    weight += value;
    x += (ZONE_POSITIONS[name]?.[0] ?? 0) * value;
    y += (ZONE_POSITIONS[name]?.[1] ?? 0) * value;
  }
  if (weight < 0.001) return { x: 0, y: 0, peak, peakValue: 0 };
  return { x: x / weight, y: y / weight, peak, peakValue };
}

export function audioVisuals(audio, options = {}) {
  const silent = { gate: 0, spread: { left: 0, right: 0, top: 0, bottom: 0 } };
  if (!audio || typeof audio !== 'object') return silent;
  const sensitivity = clamp(options.sensitivity ?? 1, 0.25, 2);
  const expansion = clamp(options.expansion ?? 1, 0, 2.5);
  const level = clamp(audio.level * sensitivity);
  const left = clamp((audio.left ?? level) * sensitivity);
  const right = clamp((audio.right ?? level) * sensitivity);
  const bass = clamp((audio.bass ?? 0) * sensitivity);
  const mid = clamp((audio.mid ?? 0) * sensitivity);
  const treble = clamp((audio.treble ?? 0) * sensitivity);
  const leftBass = clamp((audio.leftBass ?? bass) * sensitivity);
  const rightBass = clamp((audio.rightBass ?? bass) * sensitivity);
  const leftTreble = clamp((audio.leftTreble ?? treble) * sensitivity);
  const rightTreble = clamp((audio.rightTreble ?? treble) * sensitivity);
  const correlation = clamp(audio.correlation ?? 1, -1, 1);
  const transient = clamp(audio.transient ?? 0);

  // Silence gate: when peak audio drops below noise floor (~0.012 or adaptive),
  // gate smoothly ramps to 0. Silence completely hides the ambient glow.
  const peak = level > 0 ? level : Math.max(left, right);
  const noiseFloor = clamp(options.noiseFloor ?? 0.012, 0, 0.05);
  const gate = clamp((peak - noiseFloor) / 0.045);
  if (gate === 0) return silent;

  // Use spatialized pseudo-surround zones to enrich edge weights.
  const zones = spatialize({
    level,
    left,
    right,
    bass,
    mid,
    treble,
    leftBass,
    rightBass,
    leftTreble,
    rightTreble,
    correlation,
    transient,
  });

  // Map 11 zones to edge spreads:
  // Left: leftFront, leftSide, leftRear, leftFrontHeight
  // Right: rightFront, rightSide, rightRear, rightFrontHeight
  // Top: front heights + rear heights + direct treble
  // Bottom: rears + bass
  const leftZoneWeight = clamp(
    zones.leftSide * 0.45 +
    zones.leftFront * 0.35 +
    zones.leftRear * 0.2 +
    zones.leftFrontHeight * 0.2
  );
  const rightZoneWeight = clamp(
    zones.rightSide * 0.45 +
    zones.rightFront * 0.35 +
    zones.rightRear * 0.2 +
    zones.rightFrontHeight * 0.2
  );
  const topZoneWeight = clamp(
    (zones.leftFrontHeight + zones.rightFrontHeight) * 0.35 +
    (zones.leftRearHeight + zones.rightRearHeight) * 0.25 +
    treble * 0.4
  );
  return {
    gate,
    zones,
    spread: {
      // Dynamic audio energy blooming outward per edge:
      left: Math.max(left, leftZoneWeight) * gate * expansion,
      right: Math.max(right, rightZoneWeight) * gate * expansion,
      top: Math.max(treble, topZoneWeight) * gate * expansion,
      bottom: Math.max(
        bass,
        clamp((zones.leftRear + zones.rightRear) * 0.5 + bass * 0.5)
      ) * gate * expansion,
    },
  };
}

// Average the non-black pixels of each edge band, skipping letterbox bars.
// Black bars and black frames contribute no color, so they cannot leave a stale glow behind.
export function sampleEdgeColors(data, width, height, barsClip = [0, 0]) {
  if (
    !data?.length ||
    width < 2 ||
    height < 2 ||
    data.length < width * height * 4
  )
    return null;

  const clipX = Math.max(0, Math.min(Math.floor(width * 0.35), Math.round((barsClip?.[0] || 0) * width)));
  const clipY = Math.max(0, Math.min(Math.floor(height * 0.35), Math.round((barsClip?.[1] || 0) * height)));
  const contentW = Math.max(1, width - clipX * 2);
  const contentH = Math.max(1, height - clipY * 2);

  const bands = {
    left: (x, y) =>
      x >= clipX && x < clipX + contentW * 0.2 && y >= clipY && y < height - clipY,
    right: (x, y) =>
      x >= width - clipX - contentW * 0.2 && x < width - clipX && y >= clipY && y < height - clipY,
    top: (x, y) =>
      y >= clipY && y < clipY + contentH * 0.2 && x >= clipX && x < width - clipX,
    bottom: (x, y) =>
      y >= height - clipY - contentH * 0.2 && y < height - clipY && x >= clipX && x < width - clipX,
  };
  const colors = {};
  for (const [edge, inBand] of Object.entries(bands)) {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!inBand(x, y)) continue;
        const index = (y * width + x) * 4;
        const pr = data[index];
        const pg = data[index + 1];
        const pb = data[index + 2];
        if (0.2126 * pr + 0.7152 * pg + 0.0722 * pb < 10) continue;
        r += pr;
        g += pg;
        b += pb;
        count++;
      }
    }
    colors[edge] = count
      ? [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
      : null;
  }
  return colors;
}
