/**
 * Manages the list of active object tracks.
 * When an object's height changes beyond the threshold, fires onFractalTrigger
 * with { id, x, y } — the track id and the fractal root position.
 * Tracker has no knowledge of Branch or rendering.
 */
export class TrackerColor {
  /**
   * @param {object}   opts
   * @param {number}   opts.matchDistance     - Max px to associate a detection with an existing track
   * @param {number}   opts.smoothingFactor   - Lerp factor for height smoothing (0–1)
   * @param {number}   opts.heightThreshold   - Height-diff (px) that triggers a fractal
   * @param {number}   opts.maxMissingFrames  - Frames before a track is dropped
   * @param {function} opts.onFractalTrigger  - Called with { id, x, y, r, g, b } when threshold is crossed
   * @param {number}   opts.colorThreshold    - Max RGB distance to still consider same track (0–441)
   */
  constructor({
    matchDistance = 80,
    smoothingFactor = 0.15,
    heightThreshold = 100,
    maxMissingFrames = 15,
    colorThreshold = 60,
    onFractalTrigger = () => {},
  } = {}) {
    this.matchDistance = matchDistance;
    this.smoothingFactor = smoothingFactor;
    this.heightThreshold = heightThreshold;
    this.maxMissingFrames = maxMissingFrames;
    this.colorThreshold = colorThreshold;
    this.onFractalTrigger = onFractalTrigger;

    this.tracks = [];
    this.nextTrackId = 0;
  }

  /**
   * Euclidean RGB distance between two { r, g, b } colors (0–441).
   * Returns 0 if either color is missing so absence never blocks a match.
   */
  _colorDist(a, b) {
    if (!a || !b) return 0;
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  /**
   * Sample the average RGBA color of pixels inside a bounding box.
   * @param {object} p      - p5 instance (loadPixels must have been called)
   * @param {number} x      - box left edge
   * @param {number} y      - box top edge
   * @param {number} w      - box width
   * @param {number} h      - box height
   * @returns {{ r, g, b, a }} - averaged color components (0–255)
   */
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
        const sat = max - min; // 0 = grey/black, 255 = fully vivid

        // Skip near-black and near-grey pixels entirely
        if (max < 30 || sat < 20) continue;

        // Square saturation so vivid pixels dominate
        const weight = sat * sat;

        rSum += r * weight;
        gSum += g * weight;
        bSum += b * weight;
        wSum += weight;
      }
    }

    if (wSum === 0) return { r: 200, g: 200, b: 200 }; // fallback: light grey

    return {
      r: Math.round(rSum / wSum),
      g: Math.round(gSum / wSum),
      b: Math.round(bSum / wSum),
    };
  }

  /**
   * Update tracks with the latest batch of detections.
   * Call p.loadPixels() before this if you want color sampling.
   * @param {Array}  detections - ml5 detection results (persons already filtered out)
   * @param {object} [p]        - p5 instance, required for color sampling
   */
  update(detections, p = null) {
    for (const track of this.tracks) {
      track.matched = false;
      track.missingFrames++;
    }

    for (const det of detections) {
      const detCX = det.x + det.width / 2;
      const detCY = det.y + det.height / 2;

      // Sample detection color once for matching (cheap — only when p available)
      const detColor = p
        ? this._sampleAvgColor(p, det.x, det.y, det.width, det.height)
        : null;

      let bestTrack = null;
      let bestDist = Infinity;

      for (const track of this.tracks) {
        if (track.label !== det.label) continue;
        const d = Math.hypot(detCX - track.cx, detCY - track.cy);
        if (d >= bestDist) continue;
        // Match if close enough in position OR close enough in color
        const posMatch   = d < this.matchDistance;
        const colorMatch = this._colorDist(track.avgColor, detColor) < this.colorThreshold;
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

    this.tracks = this.tracks.filter(
      (t) => t.missingFrames < this.maxMissingFrames
    );
  }

  /**
   * Draw bounding boxes and debug labels for all active tracks.
   * @param {object} p - p5 instance
   */
  draw(p) {
    for (const track of this.tracks) {
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

      if (track.avgColor) {
        const { r, g, b } = track.avgColor;
        // Color swatch
        p.fill(r, g, b);
        p.noStroke();
        p.rect(track.x + 8, track.y + 82, 18, 12);
        // Label
        p.fill(255);
        p.text(`rgb(${r},${g},${b})`, track.x + 30, track.y + 93);
      }
    }
  }
}