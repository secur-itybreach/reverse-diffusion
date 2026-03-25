/**
 * Manages the list of active object tracks.
 * When an object's height changes beyond the threshold, fires onFractalTrigger
 * with { id, x, y } — the track id and the fractal root position.
 * Tracker has no knowledge of Branch or rendering.
 */
export class TrackerUpgrade {
  /**
   * @param {object}   opts
   * @param {number}   opts.matchDistance
   * @param {number}   opts.smoothingFactor
   * @param {number}   opts.heightThreshold
   * @param {number}   opts.maxMissingFrames
   * @param {number}   opts.colorThreshold
   * @param {number}   opts.stabilityFrames             - Frames needed before locking a box
   * @param {number}   opts.stabilityPositionThreshold  - Max center movement to count as stable
   * @param {number}   opts.stabilitySizeThreshold      - Max width/height change to count as stable
   * @param {number}   opts.crushBrightnessGain         - Brightness increase (0-255) the zone must gain vs lock baseline to fire onCrushed (default 30)
   * @param {function} opts.onFractalTrigger
   * @param {function} opts.onCrushed                   - Called with { id, label, lockedBox, baselineBrightness, currentBrightness }
   */
  constructor({
    matchDistance = 80,
    smoothingFactor = 0.15,
    heightThreshold = 100,
    maxMissingFrames = 15,
    colorThreshold = 60,
    stabilityFrames = 20,
    stabilityPositionThreshold = 8,
    stabilitySizeThreshold = 8,
    crushBrightnessGain = 30,
    onFractalTrigger = () => {},
    onCrushed = () => {},
  } = {}) {
    this.matchDistance = matchDistance;
    this.smoothingFactor = smoothingFactor;
    this.heightThreshold = heightThreshold;
    this.maxMissingFrames = maxMissingFrames;
    this.colorThreshold = colorThreshold;

    this.stabilityFrames = stabilityFrames;
    this.stabilityPositionThreshold = stabilityPositionThreshold;
    this.stabilitySizeThreshold = stabilitySizeThreshold;

    this.crushBrightnessGain = crushBrightnessGain;

    this.onFractalTrigger = onFractalTrigger;
    this.onCrushed = onCrushed;

    this.tracks = [];
    this.nextTrackId = 0;
  }

  _colorDist(a, b) {
    if (!a || !b) return 0;
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  _sampleAvgColor(p, x, y, w, h) {
    const pw = p.width;
    const ph = p.height;
    const d = p.pixels;
    const density = p.pixelDensity();

    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(pw, Math.floor(x + w));
    const y1 = Math.min(ph, Math.floor(y + h));

    let rSum = 0, gSum = 0, bSum = 0, wSum = 0;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = 4 * ((py * density) * (pw * density) + (px * density));
        const r = d[i], g = d[i + 1], b = d[i + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max - min;

        if (max < 30 || sat < 20) continue;

        const weight = sat * sat;

        rSum += r * weight;
        gSum += g * weight;
        bSum += b * weight;
        wSum += weight;
      }
    }

    if (wSum === 0) return { r: 200, g: 200, b: 200 };

    return {
      r: Math.round(rSum / wSum),
      g: Math.round(gSum / wSum),
      b: Math.round(bSum / wSum),
    };
  }

  /**
   * Returns the average perceived brightness (0–255) of all pixels in the box,
   * using the fast luminance approximation (0.299R + 0.587G + 0.114B).
   * Background-colour-agnostic: we only ever compare this value against the
   * baseline captured at lock time, so the absolute level doesn't matter.
   * @param {object} p  - p5 instance (pixels must already be loaded)
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @returns {number} average brightness in [0, 255]
   */
  _sampleAvgBrightness(p, x, y, w, h) {
    const pw = p.width;
    const ph = p.height;
    const d = p.pixels;
    const density = p.pixelDensity();

    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(pw, Math.floor(x + w));
    const y1 = Math.min(ph, Math.floor(y + h));

    let sum = 0;
    let total = 0;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = 4 * ((py * density) * (pw * density) + (px * density));
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        total++;
      }
    }

    return total === 0 ? 255 : sum / total;
  }

  _isInsideZone(det, zone) {
    const cx = det.x + det.width / 2;
    const cy = det.y + det.height / 2;

    return (
      cx >= zone.x &&
      cx <= zone.x + zone.width &&
      cy >= zone.y &&
      cy <= zone.y + zone.height
    );
  }

  _isDetectionInLockedZone(det) {
    for (const track of this.tracks) {
      if (!track.locked) continue;
      const zone = track.lockedBox;
      if (zone && this._isInsideZone(det, zone)) return true;
    }
    return false;
  }

  _updateStability(track, detCX, detCY, det) {
    const moveDist = Math.hypot(detCX - track.prevCX, detCY - track.prevCY);
    const widthDiff = Math.abs(det.width - track.prevWidth);
    const heightDiff = Math.abs(det.height - track.prevHeight);

    const positionStable = moveDist <= this.stabilityPositionThreshold;
    const sizeStable =
      widthDiff <= this.stabilitySizeThreshold &&
      heightDiff <= this.stabilitySizeThreshold;

    if (positionStable && sizeStable) {
      track.stableFrames++;
    } else {
      track.stableFrames = 0;
    }

    track.prevCX = detCX;
    track.prevCY = detCY;
    track.prevWidth = det.width;
    track.prevHeight = det.height;

    if (!track.locked && track.stableFrames >= this.stabilityFrames) {
      track.locked = true;
      track.lockedBox = {
        x: track.x,
        y: track.y,
        width: track.width,
        height: track.height,
      };
      // baseline is set on the first update() frame after lock
      track.baselineBrightness = null;
      track.currentBrightness = null;
      track.crushTriggered = false;
    }
  }

  /**
   * Returns all frozen no-detection zones.
   * Useful for further analysis.
   */
  getLockedZones() {
    return this.tracks
      .filter((t) => t.locked && t.lockedBox)
      .map((t) => ({
        id: t.id,
        label: t.label,
        x: t.lockedBox.x,
        y: t.lockedBox.y,
        width: t.lockedBox.width,
        height: t.lockedBox.height,
        cx: t.lockedBox.x + t.lockedBox.width / 2,
        cy: t.lockedBox.y + t.lockedBox.height / 2,
      }));
  }

  /**
   * Optional helper if you want just one zone by id
   */
  getLockedZoneById(id) {
    const track = this.tracks.find((t) => t.id === id && t.locked && t.lockedBox);
    if (!track) return null;

    return {
      id: track.id,
      label: track.label,
      x: track.lockedBox.x,
      y: track.lockedBox.y,
      width: track.lockedBox.width,
      height: track.lockedBox.height,
      cx: track.lockedBox.x + track.lockedBox.width / 2,
      cy: track.lockedBox.y + track.lockedBox.height / 2,
    };
  }

  /**
   * Update tracks with the latest batch of detections.
   * Call p.loadPixels() before this if you want color sampling.
   * @param {Array}  detections - ml5 detection results (persons already filtered out)
   * @param {object} [p]        - p5 instance, required for color sampling
   */
  update(detections, p = null) {
    // ── Crush detection for locked zones ──────────────────────────────────
    if (p) {
      for (const track of this.tracks) {
        if (!track.locked || !track.lockedBox || track.crushTriggered) continue;

        const { x, y, width, height } = track.lockedBox;
        const brightness = this._sampleAvgBrightness(p, x, y, width, height);

        // First frame after lock: record baseline
        if (track.baselineBrightness === null) {
          track.baselineBrightness = brightness;
          continue;
        }

        track.currentBrightness = brightness;

        const gain = brightness - track.baselineBrightness;
        if (gain >= this.crushBrightnessGain) {
          track.crushTriggered = true;
          this.onCrushed({
            id: track.id,
            label: track.label,
            lockedBox: { ...track.lockedBox },
            baselineBrightness: track.baselineBrightness,
            currentBrightness: brightness,
          });
          this.onFractalTrigger({
            id: track.id,
            x: track.lockedBox.x + track.lockedBox.width / 2,
            y: track.lockedBox.y + track.lockedBox.height / 2,
            avgColor: track.avgColor ?? null,
          });
        }
      }
    }
    // ──────────────────────────────────────────────────────────────────────
    for (const track of this.tracks) {
      track.matched = false;
      track.missingFrames++;
    }

    for (const det of detections) {
      // Ignore new detections inside already locked zones
      if (this._isDetectionInLockedZone(det)) continue;

      const detCX = det.x + det.width / 2;
      const detCY = det.y + det.height / 2;

      const detColor = p
        ? this._sampleAvgColor(p, det.x, det.y, det.width, det.height)
        : null;

      let bestTrack = null;
      let bestDist = Infinity;

      for (const track of this.tracks) {
        if (track.locked) continue; // locked tracks are frozen
        if (track.label !== det.label) continue;

        const d = Math.hypot(detCX - track.cx, detCY - track.cy);
        if (d >= bestDist) continue;

        const posMatch = d < this.matchDistance;
        const colorMatch =
          this._colorDist(track.avgColor, detColor) < this.colorThreshold;

        if (!posMatch && !colorMatch) continue;

        bestDist = d;
        bestTrack = track;
      }

      if (bestTrack) {
        bestTrack.matched = true;
        bestTrack.missingFrames = 0;

        bestTrack.x = det.x;
        bestTrack.y = det.y;
        bestTrack.width = det.width;
        bestTrack.height = det.height;
        bestTrack.cx = detCX;
        bestTrack.cy = detCY;

        bestTrack.smoothedHeight +=
          (det.height - bestTrack.smoothedHeight) * this.smoothingFactor;

        const diff = Math.abs(bestTrack.smoothedHeight - bestTrack.initialHeight);
        bestTrack.heightDiff = diff;

        this._updateStability(bestTrack, detCX, detCY, det);

        if (!bestTrack.heightTriggered && diff > this.heightThreshold) {
          bestTrack.heightTriggered = true;
          this.onFractalTrigger({
            id: bestTrack.id,
            x: bestTrack.cx,
            y: bestTrack.cy,
            avgColor: bestTrack.avgColor ?? null,
          });
        }
      } else {
        this.tracks.push({
          id: this.nextTrackId++,
          label: det.label,
          x: det.x,
          y: det.y,
          width: det.width,
          height: det.height,
          cx: detCX,
          cy: detCY,

          prevCX: detCX,
          prevCY: detCY,
          prevWidth: det.width,
          prevHeight: det.height,
          stableFrames: 0,
          locked: false,
          lockedBox: null,

          initialHeight: det.height,
          smoothedHeight: det.height,
          heightDiff: 0,
          heightTriggered: false,
          missingFrames: 0,
          matched: true,
          avgColor: detColor,
        });
      }
    }

    this.tracks = this.tracks.filter((t) => {
      // keep locked tracks permanently, or change this if you want expiry
      if (t.locked) return true;
      return t.missingFrames < this.maxMissingFrames;
    });
  }

  /**
   * Draw bounding boxes and debug labels for all active tracks.
   * Locked tracks are shown in red.
   * @param {object} p - p5 instance
   */
  draw(p) {
    for (const track of this.tracks) {
      if (track.locked && track.lockedBox) {
        p.stroke(255, 0, 0);
        p.strokeWeight(3);
        p.noFill();
        p.rect(
          track.lockedBox.x,
          track.lockedBox.y,
          track.lockedBox.width,
          track.lockedBox.height
        );

        p.noStroke();
        p.fill(255, 0, 0);
        p.textSize(14);
        p.text(
          `LOCKED ID: ${track.id} | ${track.label}`,
          track.lockedBox.x + 8,
          track.lockedBox.y + 18
        );

        if (track.baselineBrightness !== null) {
          const base = track.baselineBrightness.toFixed(1);
          const cur  = (track.currentBrightness ?? track.baselineBrightness).toFixed(1);
          p.text(`bright base: ${base}`, track.lockedBox.x + 8, track.lockedBox.y + 36);
          p.text(`bright now:  ${cur}`,  track.lockedBox.x + 8, track.lockedBox.y + 54);
          if (track.crushTriggered) {
            p.fill(255, 140, 0);
            p.text(`CRUSHED`, track.lockedBox.x + 8, track.lockedBox.y + 72);
          }
        }
        continue;
      }

      p.stroke(0, 255, 0);
      p.strokeWeight(3);
      p.noFill();
      p.rect(track.x, track.y, track.width, track.height);

      p.noStroke();
      p.fill(255);
      p.textSize(14);
      p.text(`ID: ${track.id} | ${track.label}`, track.x + 8, track.y + 18);
      p.text(`initial h: ${track.initialHeight.toFixed(1)}`, track.x + 8, track.y + 36);
      p.text(`current h: ${track.smoothedHeight.toFixed(1)}`, track.x + 8, track.y + 54);
      p.text(`diff: ${track.heightDiff.toFixed(1)}`, track.x + 8, track.y + 72);
      p.text(`stable: ${track.stableFrames}/${this.stabilityFrames}`, track.x + 8, track.y + 90);

      if (track.avgColor) {
        const { r, g, b } = track.avgColor;
        p.fill(r, g, b);
        p.noStroke();
        p.rect(track.x + 8, track.y + 100, 18, 12);

        p.fill(255);
        p.text(`rgb(${r},${g},${b})`, track.x + 30, track.y + 111);
      }
    }
  }
}