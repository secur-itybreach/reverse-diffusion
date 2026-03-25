/**
 * Manages the list of active object tracks.
 * When an object's height changes beyond the threshold, fires onFractalTrigger
 * with { id, x, y } — the track id and the fractal root position.
 * Tracker has no knowledge of Branch or rendering.
 */
export class Tracker {
  /**
   * @param {object}   opts
   * @param {number}   opts.matchDistance     - Max px to associate a detection with an existing track
   * @param {number}   opts.smoothingFactor   - Lerp factor for height smoothing (0–1)
   * @param {number}   opts.heightThreshold   - Height-diff (px) that triggers a fractal
   * @param {number}   opts.maxMissingFrames  - Frames before a track is dropped
   * @param {function} opts.onFractalTrigger  - Called with { id, x, y } when threshold is crossed
   */
  constructor({
    matchDistance = 80,
    smoothingFactor = 0.15,
    heightThreshold = 100,
    maxMissingFrames = 15,
    onFractalTrigger = () => {},
  } = {}) {
    this.matchDistance = matchDistance;
    this.smoothingFactor = smoothingFactor;
    this.heightThreshold = heightThreshold;
    this.maxMissingFrames = maxMissingFrames;
    this.onFractalTrigger = onFractalTrigger;

    this.tracks = [];
    this.nextTrackId = 0;
  }

  /**
   * Update tracks with the latest batch of detections.
   * @param {Array} detections - ml5 detection results (persons already filtered out)
   */
  update(detections) {
    for (const track of this.tracks) {
      track.matched = false;
      track.missingFrames++;
    }

    for (const det of detections) {
      const detCX = det.x + det.width / 2;
      const detCY = det.y + det.height / 2;

      let bestTrack = null;
      let bestDist = Infinity;

      for (const track of this.tracks) {
        if (track.label !== det.label) continue;
        const d = Math.hypot(detCX - track.cx, detCY - track.cy);
        if (d < this.matchDistance && d < bestDist) {
          bestDist = d;
          bestTrack = track;
        }
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
          this.onFractalTrigger({ id: bestTrack.id, x: bestTrack.cx, y: bestTrack.cy });
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
    }
  }
}
