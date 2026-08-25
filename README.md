# ✦ Air Draw — Gesture-Based Doodler

Draw in mid-air using just your hand and webcam. Powered by **MediaPipe Hand Landmarker**.

## ✋ Gestures

| Gesture | Action |
|---|---|
| ☝️ Index finger up | **Draw** neon strokes |
| ✋ Open palm | **Erase** with sweeping motion |
| 🤏 Pinch | **Move** the artwork |
| ✊ Closed fist | **Idle** / rest |

## 🚀 Run It (Zero Setup!)

This is a **single HTML file** — no npm, no build step needed.

### Option A — Easiest (VS Code + Live Server)
1. Open the `air-draw/` folder in VS Code
2. Install the **Live Server** extension
3. Right-click `index.html` → **Open with Live Server**
4. Allow camera access → draw!

### Option B — Python local server
```bash
cd air-draw
python -m http.server 8080
# Open http://localhost:8080
```

### Option C — Node.js local server
```bash
cd air-draw
npx serve .
# Open the URL shown
```

> ⚠️ **Must run on localhost or HTTPS** — camera access requires a secure context.  
> Opening `index.html` directly from the file system will NOT work.

## 🛠 Tech Stack

| Tech | Role |
|---|---|
| MediaPipe Tasks Vision | Hand landmark detection (21 points per hand) |
| HTML5 Canvas (×3 layers) | Camera feed + drawing + UI cursor |
| CSS neon effects | `shadowBlur` + `shadowColor` for glow |
| Vanilla JS (ES modules) | No framework, no bundle step |

## 🎨 Features

- **Neon glow** drawing with adjustable thickness and glow intensity
- **8 colors** — cyan, magenta, green, blue, red, yellow, purple, white
- **Undo** (up to 30 strokes)
- **Clear canvas**
- **Download** composite image (camera + drawing)
- **Toggle camera** visibility for dark-background mode
- Loading screen + onboarding modal

## 🔧 Want to Convert to React + Vite?

```bash
npm create vite@latest air-draw-react -- --template react
cd air-draw-react
npm install @mediapipe/tasks-vision
npm run dev
```

Then split the code into:
- `src/hooks/useHandTracking.js` — MediaPipe init + detection loop
- `src/hooks/useDrawing.js` — canvas drawing logic
- `src/components/Toolbar.jsx` — color/thickness/glow controls
- `src/components/GestureHUD.jsx` — bottom gesture indicator
- `src/App.jsx` — canvas stack + orchestration

## 📦 How MediaPipe Works

```
Webcam video frame
       ↓
HandLandmarker.detectForVideo()
       ↓
21 hand landmarks (x, y, z per point)
       ↓
Gesture logic (index up? palm open? pinch?)
       ↓
Draw / erase / idle on canvas
```

Key landmarks used:
- `[4]` Thumb tip
- `[8]` Index finger tip  ← main drawing cursor
- `[6]` Index finger DIP
- `[9]` Middle MCP
- `[12]` Middle finger tip
- `[16]` Ring finger tip
- `[20]` Pinky tip

---

## 👨‍💻 Author & Credits

**Design by ❤️ Arpit Singh Yadav**

- **Instagram**: [@arpit__.029](https://www.instagram.com/arpit__.029/)
- **GitHub**: [@arpit6307](https://github.com/arpit6307)

