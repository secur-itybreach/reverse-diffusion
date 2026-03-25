# Fractal Detector

Object detection with animated fractal tree growth, using **p5.js** (npm) + **ml5.js v0.5** (CDN).

## Structure

```
fractal-detector/
├── index.html          # Entry point — loads ml5 via CDN, then the module
├── vite.config.js
├── package.json
└── src/
    ├── main.js         # p5 instance-mode sketch + video/detection setup
    ├── Tracker.js      # Track matching, smoothing, fractal trigger logic
    └── Branch.js       # Animated fractal branch class
```

## Why ml5 stays on the CDN

ml5 v0.5.0 was built before ES-module bundlers were common. It relies on
TensorFlow.js globals and self-registers on `window.ml5`. Bundling it with
Vite causes subtle initialisation errors. Loading it as a plain `<script>`
before the module code runs is the safest and most reliable approach.

## Getting started

```bash
npm install
npm run dev       # → http://localhost:5173
```

Allow camera access when prompted. Point objects at the camera — when a
tracked object changes height by more than `heightThreshold` (default 25 px),
a fractal tree grows from its centre.

## Build for production

```bash
npm run build     # output in /dist
npm run preview   # serve the built output locally
```
