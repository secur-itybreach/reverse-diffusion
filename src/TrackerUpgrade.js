/**
 * Tracks detected objects across frames.
 * Once an object stays stable for enough frames it is locked (frozen bounding box + palette).
 * Call triggerOnLocked() — e.g. on keypress — to fire onFractalTrigger for the next locked track.
 */
export class TrackerUpgrade {
  /**
   * @param {object}   opts
   * @param {number}   opts.matchDistance              - Max px between detections to count as same track
   * @param {number}   opts.maxMissingFrames           - Frames before an unlocked track is dropped
   * @param {number}   opts.stabilityFrames            - Consecutive stable frames needed to lock
   * @param {number}   opts.stabilityPositionThreshold - Max center movement (px) to count as stable
   * @param {number}   opts.stabilitySizeThreshold     - Max size change (px) to count as stable
   * @param {function} opts.onFractalTrigger           - Called with { id, x, y, palette }
   */
  constructor({
    matchDistance = 80,
    maxMissingFrames = 15,
    stabilityFrames = 20,
    stabilityPositionThreshold = 8,
    stabilitySizeThreshold = 8,
    onFractalTrigger = () => {},
  } = {}) {
    this.matchDistance = matchDistance;
    this.maxMissingFrames = maxMissingFrames;
    this.stabilityFrames = stabilityFrames;
    this.stabilityPositionThreshold = stabilityPositionThreshold;
    this.stabilitySizeThreshold = stabilitySizeThreshold;
    this.onFractalTrigger = onFractalTrigger;

    this.tracks = [];
    this.nextTrackId = 0;
    this.locked = false; // true once any track locks — pauses all detection
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _sampleDominantColors(video, x, y, w, h, count = 3) {
    const pw = video.width, ph = video.height;
    const d = video.pixels; // video pixels are always density 1
    const inset = 5; // skip the bbox border pixels

    const x0 = Math.max(0,  Math.floor(x + inset));
    const y0 = Math.max(0,  Math.floor(y + inset));
    const x1 = Math.min(pw, Math.floor(x + w - inset));
    const y1 = Math.min(ph, Math.floor(y + h - inset));

    const buckets = new Map();
    const step = 2, quant = 24;

    for (let py = y0; py < y1; py += step) {
      for (let px = x0; px < x1; px += step) {
        const i = 4 * (py * pw + px); // no pixelDensity for video
        const r = d[i], g = d[i + 1], b = d[i + 2];

        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const brightness = (r + g + b) / 3;
        if (brightness < 25 || brightness > 245 || sat < 18) continue;

        const key = `${Math.round(r/quant)*quant},${Math.round(g/quant)*quant},${Math.round(b/quant)*quant}`;
        const weight = sat + 1;

        if (!buckets.has(key)) buckets.set(key, { rSum: 0, gSum: 0, bSum: 0, weightSum: 0, count: 0 });
        const bucket = buckets.get(key);
        bucket.rSum += r * weight;
        bucket.gSum += g * weight;
        bucket.bSum += b * weight;
        bucket.weightSum += weight;
        bucket.count += 1;
      }
    }

    if (buckets.size === 0) {
      return [{ r: 200, g: 200, b: 200 }, { r: 160, g: 160, b: 160 }, { r: 120, g: 120, b: 120 }];
    }

    const colors = Array.from(buckets.values())
      .map((b) => ({
        r: Math.round(b.rSum / b.weightSum),
        g: Math.round(b.gSum / b.weightSum),
        b: Math.round(b.bSum / b.weightSum),
        score: b.count * 0.7 + b.weightSum * 0.3,
      }))
      .sort((a, b) => b.score - a.score);

    const merged = [];
    for (const color of colors) {
      const tooClose = merged.some((c) => {
        const dr = c.r - color.r, dg = c.g - color.g, db = c.b - color.b;
        return Math.sqrt(dr*dr + dg*dg + db*db) < 35;
      });
      if (!tooClose) merged.push(color);
      if (merged.length >= count) break;
    }

    while (merged.length < count) merged.push(merged.at(-1) ?? { r: 200, g: 200, b: 200 });

    return merged.map(({ r, g, b }) => ({ r, g, b }));
  }

  _updateStability(track, detCX, detCY, det) {
    const positionStable = Math.hypot(detCX - track.prevCX, detCY - track.prevCY) <= this.stabilityPositionThreshold;
    const sizeStable     = Math.abs(det.width  - track.prevWidth)  <= this.stabilitySizeThreshold &&
                           Math.abs(det.height - track.prevHeight) <= this.stabilitySizeThreshold;

    track.stableFrames = (positionStable && sizeStable) ? track.stableFrames + 1 : 0;
    track.prevCX = detCX; track.prevCY = detCY;
    track.prevWidth = det.width; track.prevHeight = det.height;

    if (track.stableFrames >= this.stabilityFrames) {
      track.locked    = true;
      track.lockedBox = { x: track.x, y: track.y, width: track.width, height: track.height };
      this.locked     = true; // freeze the whole tracker
      console.log(`Object Locked`);
    }
  }

  // ── Draw helpers ───────────────────────────────────────────────────────────

  _drawLockedTrack(p, track) {
    const { x, y, width, height } = track.lockedBox;
    p.stroke(255, 0, 0);
    p.strokeWeight(2);
    p.noFill();
    p.rect(x, y, width, height);

    p.noStroke();
    p.fill(255, 0, 0);
    p.textSize(14);
    p.text(`LOCKED  ID:${track.id}  ${track.label}`, x + 8, y + 18);

    if (track.triggered) {
      p.fill(255, 140, 0);
      p.text('TRIGGERED', x + 8, y + 36);
    }
  }

  _drawActiveTrack(p, track) {
    p.stroke(0, 255, 0);
    p.strokeWeight(2);
    p.noFill();
    p.rect(track.x, track.y, track.width, track.height);

    p.noStroke();
    p.fill(255);
    p.textSize(14);
    p.text(`ID:${track.id}  ${track.label}`, track.x + 8, track.y + 18);
    p.text(`stable: ${track.stableFrames}/${this.stabilityFrames}`, track.x + 8, track.y + 36);

    if (track.palette?.length) {
      track.palette.forEach((c, i) => {
        p.fill(c.r, c.g, c.b);
        p.noStroke();
        p.rect(track.x + 8 + i * 22, track.y + 46, 18, 12);
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Fire onFractalTrigger for the next locked, untriggered track.
   * Pass a specific id to target one, or omit to use the first available.
   * @param {number} [id]
   */
  triggerOnLocked(id) {
    const track = id !== undefined
      ? this.tracks.find((t) => t.locked && !t.triggered && t.id === id)
      : this.tracks.find((t) => t.locked && !t.triggered);

    if (!track) return;

    track.triggered = true;
    this.onFractalTrigger({
      id:      track.id,
      x:       track.lockedBox.x + track.lockedBox.width  / 2,
      y:       track.lockedBox.y + track.lockedBox.height / 2,
      palette: track.palette ?? null,
    });
    console.log(`Sent Trigger for tree`);
  }

  /**
   * Update tracks from the latest ml5 detections.
   * Pass the p5 video element for colour sampling (its pixels are independent of the canvas).
   * @param {Array}  detections - ml5 results (persons already filtered out)
   * @param {object} [video]    - p5 video element (call video.loadPixels() before this)
   */
  update(detections, video = null) {
    if (this.locked) return; // frozen until reset() is called
    for (const track of this.tracks) track.missingFrames++;

    for (const det of detections) {
      const detCX = det.x + det.width  / 2;
      const detCY = det.y + det.height / 2;

      // Find the closest unlocked track of the same label within matchDistance
      let bestTrack = null;
      let bestDist  = this.matchDistance;

      for (const track of this.tracks) {
        if (track.locked || track.label !== det.label) continue;
        const d = Math.hypot(detCX - track.cx, detCY - track.cy);
        if (d < bestDist) { bestDist = d; bestTrack = track; }
      }

      if (bestTrack) {
        bestTrack.missingFrames = 0;
        bestTrack.x = det.x; bestTrack.y = det.y;
        bestTrack.width = det.width; bestTrack.height = det.height;
        bestTrack.cx = detCX; bestTrack.cy = detCY;

        this._updateStability(bestTrack, detCX, detCY, det);

        // sample palette only while still unlocked — frozen at lock time
        if (video && !bestTrack.locked) bestTrack.palette = this._sampleDominantColors(video, det.x, det.y, det.width, det.height);
      } else {
        this.tracks.push({
          id: this.nextTrackId++,
          label: det.label,
          x: det.x, y: det.y, width: det.width, height: det.height,
          cx: detCX, cy: detCY,
          prevCX: detCX, prevCY: detCY,
          prevWidth: det.width, prevHeight: det.height,
          stableFrames: 0,
          locked: false, lockedBox: null,
          triggered: false,
          missingFrames: 0,
          palette: video ? this._sampleDominantColors(video, det.x, det.y, det.width, det.height) : null,
        });
      }
    }

    // locked tracks are kept forever; unlocked ones expire after maxMissingFrames
    this.tracks = this.tracks.filter((t) => t.locked || t.missingFrames < this.maxMissingFrames);
  }

  /**
   * Clear all tracks and unlock the tracker. Call on 'r' keypress.
   */
  reset() {
    this.tracks = [];
    this.locked = false;
    console.log(`Tracker Reset`);
  }

  /**
   * @param {object} p - p5 instance
   */
  draw(p) {
    for (const track of this.tracks) {
      if (track.locked) this._drawLockedTrack(p, track);
      else              this._drawActiveTrack(p, track);
    }
  }
}