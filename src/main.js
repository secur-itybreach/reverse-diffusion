import p5 from 'p5';
import { LSystem } from './LSystem.js';
import { TrackerUpgrade } from './TrackerUpgrade.js';

let socket;

function initSocket() {
  socket = new WebSocket("ws://127.0.0.1:9980");

  socket.onopen = () => console.log("WS connected");
  socket.onclose = () => console.log("WS closed");
  socket.onerror = (e) => console.error("WS error", e);
}


const sketch = (p) => {
  let video;
  let detector;
  let detectorReady = false;
  let videoReady    = false;

  /** @type {Map<number, LSystem>}  trackId → LSystem instance */
  const trees = new Map();

  // ── Tracker ───────────────────────────────────────────────────────────────

  const tracker = new TrackerUpgrade({
    matchDistance:    80,
    maxMissingFrames: 30,
    stabilityFrames:  20,
    onFractalTrigger({ id, x, y, palette }) {
      if (!trees.has(id)) {
        trees.set(id, new LSystem(p, 520/2, 520, palette));
        console.log(`Added tree with id ${id}, palette: ${palette.map(c => `rgb(${c.r},${c.g},${c.b})`).join(' | ')}`); // debug log
      }
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function onDetections(err, results) {
    if (err) { console.error(err); return; }
    p.loadPixels();
    tracker.update(results.filter(d => d.label !== 'person'), p);
    detector.detect(video, onDetections);
  }

  function maybeStartDetection() {
    if (detectorReady && videoReady) detector.detect(video, onDetections);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  p.setup = () => {
    const canvas = p.createCanvas(520, 520);
    canvas.parent('app');
    p.background(0);

    initSocket(); // WEB SOCKET TOUCHDESIGNER INIT

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

  // ── Input ─────────────────────────────────────────────────────────────────

  /** Click: spawn a debug tree at cursor position. */
  p.mousePressed = () => {
    const id = -(trees.size + 1); // negative ids avoid colliding with tracker ids
    trees.set(id, new LSystem(p, p.mouseX, p.mouseY));
    console.log(`Manually added tree`); // debug log
     // 🔥 envoi WebSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "prompt",
            prompt: p.random(["flower", "shadows", "oranges"])
          }));
        }
  };

  /** t: trigger the next locked tracked object. */
 p.keyPressed = () => {
    if (p.key === 't' || p.key === 'T') tracker.triggerOnLocked();
    if (p.key === 'r' || p.key === 'R') tracker.reset();
  };

  // ── Draw ──────────────────────────────────────────────────────────────────

  p.draw = () => {
    p.image(video, 0, 0);
    tracker.draw(p);

    for (const tree of trees.values()) {
      tree.update();
      tree.draw(p);
    }
  };
};

new p5(sketch);