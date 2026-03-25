import p5 from 'p5';
import { Tracker } from './Tracker.js';
import { LSystem } from './LSystem.js';
import { TrackerUpgrade } from './TrackerUpgrade.js';

// ── Sketch ─────────────────────────────────────────────────────────────────

const sketch = (p) => {
  let video;
  let detector;
  let detectorReady = false;
  let videoReady    = false;

  /** @type {Map<number, LSystem>}  trackId → LSystem instance */
  const trees = new Map();

  // ── Tracker ──────────────────────────────────────────────────────────────

  const tracker = new TrackerUpgrade({
    colorThreshold: 60,
    matchDistance:    80,
    smoothingFactor:  0.15,
    heightThreshold:  50,
    maxMissingFrames: 30,
    onFractalTrigger({ id, x, y, avgColor }) {
      if (!trees.has(id)) {
        trees.set(id, new LSystem(p, x, y,avgColor));
        console.log(`Added tree with id ${id} at (${x}, ${y}), avgColor: ${avgColor.r}, ${avgColor.g}, ${avgColor.b}`); // debug log
      }
    },
  });

  // ── helpers ───────────────────────────────────────────────────────────────

  function onDetections(err, results) {
    if (err) { console.error(err); return; }
    p.loadPixels();
    tracker.update(results.filter(d => d.label !== 'person'),p);
    detector.detect(video, onDetections);
  }

  function maybeStartDetection() {
    if (detectorReady && videoReady) {
      detector.detect(video, onDetections);
    }
  }

  // ── setup ─────────────────────────────────────────────────────────────────

  p.setup = () => {
    const canvas = p.createCanvas(520, 520);
    canvas.parent('app');
    p.background(0);

    video = p.createCapture(p.VIDEO, () => {
      videoReady = true;
      maybeStartDetection();
    });
    video.size(520, 520);
    video.hide();

    detector = window.ml5.objectDetector('cocossd', () => {
      detectorReady = true;
      maybeStartDetection();
    });
  };

   p.mousePressed = () => {
    const id = -(trees.size + 1); // negative ids to avoid colliding with tracker ids
    trees.set(id, new LSystem(p, p.width / 2, p.height));
    console.log(`Manually added tree with id ${id}`);
  };

  // ── draw ──────────────────────────────────────────────────────────────────

  p.draw = () => {
    // 1. Live camera feed
    p.image(video, 0, 0);
    //p.background(0);
    // 2. Tracker bounding boxes + debug labels
    tracker.draw(p);

    // 3. Grow and draw each tree
    for (const tree of trees.values()) {
      tree.update();
      tree.draw(p);
    }
  };
};

new p5(sketch);