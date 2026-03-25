/**
 * LSystem — probabilistic, lerp-animated L-System plant.
 *
 * Usage:
 *   const tree = new LSystem(p, x, y, r, g, b);
 *   // in draw():
 *   tree.update();
 *   tree.draw(p);
 */
export class LSystem {
  // ── Configuration ──────────────────────────────────────────────────────────

  static RULES = {
    X: [
      { rule: "(F[+X][-X]FX)",   prob: 0.50 },
      { rule: "(F[-X]FX)",        prob: 0.05 },
      { rule: "(F[+X]FX)",        prob: 0.05 },
      { rule: "(F[++X][-X]FX)",   prob: 0.10 },
      { rule: "(F[+X][--X]FX)",   prob: 0.10 },
      { rule: "(F[+X][-X]FXA)",   prob: 0.10 },
      { rule: "(F[+X][-X]FXB)",   prob: 0.10 },
    ],
    F: [
      { rule: "F(F)",  prob: 0.85 },
      { rule: "F(FF)", prob: 0.05 },
      { rule: "F",     prob: 0.10 },
    ],
    // lerp markers are consumed during generation, not passed to drawRules
    "(": [{ rule: "", prob: 1 }],
    ")": [{ rule: "", prob: 1 }],
  };

  static LEN           = 5;    // px per segment
  static ANG           = 35;   // branch angle in degrees
  static MAX_GEN       = 5;
  static GROWTH_RATE   = 0.07;
  static AXIOM         = "X";

  // ── Constructor ────────────────────────────────────────────────────────────

  /**
   * @param {object} p  - p5 instance (used only inside draw())
   * @param {number} x  - root x position
   * @param {number} y  - root y position
   * @param {{ r, g, b }} [avgColor={ r:255, g:255, b:255 }] - branch color
   */
  constructor(p, x, y, avgColor = { r: 255, g: 255, b: 255 }) {
    this._p    = p;
    this._x    = x;
    this._y    = y;
    const { r = 255, g = 255, b = 255 } = avgColor;
    this._r    = r;
    this._g    = g;
    this._b    = b;

    this._word          = LSystem.AXIOM;
    this._generation    = 0;
    this._growthPercent = 0;

    // Internal push/pop depth guard — reset automatically each draw pass
    this._pushDepth = 0;

    this._buildDrawRules();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _buildDrawRules() {
    const p   = this._p;
    const len = LSystem.LEN;
    const ang = LSystem.ANG;
    const r   = this._r;
    const g   = this._g;
    const b   = this._b;

    this._drawRules = {
      F: (t) => {
        p.stroke(r, g, b);
        p.strokeWeight(10);
        p.line(0, 0, 0, -len * t);
        p.translate(0, -len * t);
      },
      "+": (t) => p.rotate(p.radians(-ang * t)),
      "-": (t) => p.rotate(p.radians( ang * t)),
      "[": ()  => { this._pushDepth++; p.push(); },
      "]": ()  => { if (this._pushDepth > 0) { this._pushDepth--; p.pop(); } },
      A: (t) => {
        p.noStroke();
        p.fill(r, g, b);
        p.circle(0, 0, len * 5 * t);
      },
      B: (t) => {
        p.noStroke();
        p.fill(r, g, b);
        p.circle(0, 0, len * 5 * t);
      },
      X: () => { /* terminal — no drawing */ },
    };
  }

  /** Expand the current word by one generation. */
  _nextGeneration() {
    if (this._growthPercent < 1) return;
    if (this._generation >= LSystem.MAX_GEN) return;

    this._word = this._generate(this._word);
    this._generation++;
    this._growthPercent = 0;
  }

  /** Apply rules to every character, returning the next word. */
  _generate(word) {
    let next = "";
    for (const c of word) {
      const rule = LSystem.RULES[c];
      if (rule === undefined) { next += c; continue; }
      next += this._chooseOne(rule);
    }
    return next;
  }

  /** Pick a rule from a weighted array. */
  _chooseOne(ruleSet) {
    let n = this._p.random();
    let t = 0;
    for (const { rule, prob } of ruleSet) {
      t += prob;
      if (t > n) return rule;
    }
    return "";
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Advance growth animation; call once per p5 draw() frame.
   */
  update() {
    if (this._growthPercent < 1) {
      const mod = this._generation + this._growthPercent;
      this._growthPercent += LSystem.GROWTH_RATE / Math.max(mod, 0.1);
      this._growthPercent  = Math.min(this._growthPercent, 1);
    } else {
      this._nextGeneration();
    }
  }

  /**
   * Render the current generation with lerp interpolation.
   * @param {object} p - p5 instance
   */
  draw(p) {
    const t = Math.min(Math.max(this._growthPercent, 0), 1);

    this._pushDepth = 0;   // guard reset before every render pass

    let lerpOn = false;

    p.push();
    p.translate(this._x, this._y);
    p.noFill();

    for (const c of this._word) {
      if (c === "(") { lerpOn = true;  continue; }
      if (c === ")") { lerpOn = false; continue; }

      const lerpT = lerpOn ? t : 1;

      if (c in this._drawRules) {
        this._drawRules[c](lerpT);
      }
    }

    // Safety: pop any unmatched pushes left over from a malformed word
    while (this._pushDepth > 0) { this._pushDepth--; p.pop(); }

    p.pop();
  }
}