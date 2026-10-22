# Nirab — WebGL & Interactive Fluid Simulation Portfolio

A high-fidelity creative developer portfolio featuring GPU-accelerated interactive WebGL liquid physics, chromatic aberration, DOM-synced typography and media rasterization, smooth infinite scrolling, and an animated preloader. Inspired by and rebuilt from **[daspritam.in](https://www.daspritam.in/)**.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) or [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Build for Production
```bash
npm run build
```
Generates an optimized bundle in `dist/`.

### 4. Preview Production Build
```bash
npm run preview
```

---

## 🛠️ Architecture & Tech Stack

- **Vite 6**: Ultra-fast frontend bundler and development environment.
- **Tailwind CSS v4**: Utility-first CSS engine with custom `@font-face` configuration.
- **OGL (Open Graphics Library)**: Lightweight WebGL library used for GPU rendering, camera projections, and custom GLSL shader passes.
- **Navier-Stokes 2D Fluid Simulation (`src/fluid.js`)**:
  - Double-buffered floating-point framebuffers (`velocity`, `density`, `pressure`)
  - Mouse/touch velocity splatting
  - Vorticity confinement and curl calculations
  - Jacobi iterative Poisson pressure solver
  - Gradient subtraction for divergence-free incompressibility
  - Advection with configurable dissipation
- **DOM-to-WebGL Synchronization (`src/scene.js`)**:
  - `GLText`: High-resolution offscreen canvas rasterizer with dynamic DPI scaling, text wrapping, and letter spacing matching CSS typography (`Satoshi` and `IBM Plex Mono`).
  - `GLMedia`: Custom fragment shader with UV object-fit cover sizing and smooth corner radii.
  - `GLBackground`: Border dividers synced with page layout.
- **Post-Processing Pipeline**:
  - Chromatic aberration displacement pass distorting the entire rendered scene based on real-time fluid simulation density and velocity.
- **Lenis**: Smooth inertia and infinite scroll synchronization.
- **SplitType & GSAP**: Preloader text splitting, red glow text-shadow effects, and blur transitions.
- **Responsive Fallback**: Gracefully disables canvas on mobile/tablet devices (< 1024px or touch) while maintaining crisp native DOM typography and images.
- **Easter Egg**: Full Konami code support (`↑ ↑ ↓ ↓ ← → ← → B A`).
