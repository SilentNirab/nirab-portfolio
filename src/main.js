import { Renderer, Camera, Post, Vec2 } from 'ogl';
import Lenis from 'lenis';
import SplitType from 'split-type';
import gsap from 'gsap';
import imagesLoaded from 'imagesloaded';
import { FluidSimulation } from './fluid.js';
import { SceneManager } from './scene.js';

function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

const isMobileOrTablet = () => {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const isTouch = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i.test(ua);
  const isSmallScreen = window.innerWidth < 1024;
  return isTouch || isSmallScreen;
};

const konamiMap = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  65: 'a',
  66: 'b',
};
const konamiSequence = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'];

class PortfolioApp {
  constructor() {
    this.mouse = new Vec2();
    this.mouseInit = false;
    this.isKonami = false;
    this.konamiIndex = 0;

    this.createScroll();
    this.createRenderer();
    this.createCamera();
    this.createPost();
    this.createFluid();
    this.createScene();

    this.onResize({ height: window.innerHeight, width: window.innerWidth });
    this.onResize = debounce(this.onResize.bind(this), 400);
    window.addEventListener('resize', this.onResize);

    this.updateMouse = this.updateMouse.bind(this);
    window.addEventListener('touchstart', this.updateMouse, false);
    window.addEventListener('touchmove', this.updateMouse, false);
    window.addEventListener('mousemove', this.updateMouse, false);
    document.addEventListener('keydown', this.onKeydown.bind(this));

    Promise.all([new Promise((t) => setTimeout(t, 100))]).then(() => {
      this.gl.canvas.style.opacity = '1';
      this.onLoop = this.onLoop.bind(this);
      this.onLoop();
    });
  }

  createScroll() {
    this.lenis = new Lenis({
      infinite: true,
    });
  }

  createRenderer() {
    this.renderer = new Renderer({
      alpha: true,
      antialias: true,
      dpr: window.devicePixelRatio,
    });
    this.gl = this.renderer.gl;
    this.gl.canvas.classList.add('canvas');
    this.gl.canvas.style.opacity = '0';
    this.gl.canvas.style.transition = 'opacity 0.5s ease-in-out';
    this.gl.clearColor(0, 0, 0, 0);
    document.body.appendChild(this.gl.canvas);
  }

  createCamera() {
    this.camera = new Camera(this.gl);
    this.camera.fov = 45;
    this.camera.position.z = 1;
  }

  createPost() {
    this.post = new Post(this.gl);
    this.pass = this.post.addPass({
      fragment: `
        precision highp float;
        uniform sampler2D tMap;
        uniform sampler2D tFluid;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
          vec3 fluid = texture2D(tFluid, vUv).rgb;
          vec2 uv = vUv;
          vec2 uv2 = vUv - fluid.rg * 0.001;

          vec4 color = texture2D(tMap, uv2);

          vec3 rgb = fluid * 0.003;

          color.g = texture2D(tMap, vec2(uv.x - rgb.x, uv.y + rgb.y)).g;
          color.b = texture2D(tMap, vec2(uv.x - rgb.x, uv.y + rgb.y)).b;

          gl_FragColor = color;
        }
      `,
      uniforms: {
        tFluid: { value: null },
        uTime: { value: 0 },
      },
    });
  }

  createFluid() {
    this.fluid = new FluidSimulation(this.gl);
  }

  createScene() {
    this.scene = new SceneManager({ canvas: this });
  }

  updateMouse(e) {
    let x = e.clientX;
    let y = e.clientY;
    if (e.changedTouches && e.changedTouches.length) {
      x = e.changedTouches[0].clientX;
      y = e.changedTouches[0].clientY;
    }
    if (x === undefined) {
      x = e.x;
      y = e.y;
    }

    if (!this.mouseInit) {
      this.mouseInit = true;
      this.mouse.set(x, y);
    }

    const dx = x - this.mouse.x;
    const dy = y - this.mouse.y;
    this.mouse.set(x, y);

    const width = this.renderer?.width || window.innerWidth;
    const height = this.renderer?.height || window.innerHeight;

    if (Math.abs(dx) || Math.abs(dy)) {
      this.fluid.splats.push({
        x: x / width,
        y: 1 - y / height,
        dx: dx * 5,
        dy: dy * -5,
      });
    }
  }

  onKeydown({ keyCode }) {
    const key = konamiMap[keyCode];
    const expected = konamiSequence[this.konamiIndex];
    if (key === expected) {
      this.konamiIndex++;
      if (this.konamiIndex === konamiSequence.length) {
        this.isKonami = !this.isKonami;
        this.konamiIndex = 0;
      }
    } else {
      this.konamiIndex = 0;
    }
  }

  onResize() {
    const { innerHeight: height, innerWidth: width } = window;
    this.renderer.setSize(width, height);
    this.camera.perspective({ aspect: width / height });

    const fovRad = this.camera.fov * (Math.PI / 180);
    const visibleHeight = 2 * Math.tan(fovRad / 2) * this.camera.position.z;
    const visibleWidth = visibleHeight * this.camera.aspect;

    this.sizes = new Vec2(visibleWidth, visibleHeight);
    this.viewport = new Vec2(width, height);

    this.post.resize();
    this.scene?.onResize();
  }

  onLoop(time) {
    this.lenis?.raf(time);

    if (window.innerWidth <= 768) {
      return requestAnimationFrame(this.onLoop);
    }

    this.renderer.autoClear = false;
    this.fluid.step();

    this.renderer.autoClear = true;
    this.pass.uniforms.tFluid.value = this.fluid.density.read.texture;

    this.post.render({ camera: this.camera, scene: this.scene });
    this.scene.onLoop(this.lenis.scroll);

    requestAnimationFrame(this.onLoop);
  }
}

// Preloader animation exactly matching reference
function aT() {
  const preloader = document.querySelector('.preloader');
  const h1 = document.querySelector('.preloader h1');
  if (!preloader || !h1) return;

  const split = new SplitType(h1, {
    types: 'chars,words',
    charsClass: 'char',
    wordsClass: 'word',
  });

  const tl = gsap.timeline();
  tl.to(split.chars, {
    color: 'red',
    textShadow: '0 0 10px rgba(255, 0, 0, 0.7), 0 0 20px rgba(255, 0, 0, 0.5)',
    filter: 'blur(5px)',
    stagger: { each: 0.1, from: 'left' },
    ease: 'power2.inOut',
  });
  tl.to(preloader, { duration: 1, filter: 'blur(500px)' }, 'a');
  tl.to(preloader, { opacity: 0, duration: 1, delay: 0.1, onComplete: () => {
    preloader.style.display = 'none';
  }}, 'a');
}

function sT() {
  if (isMobileOrTablet()) {
    console.log('Canvas disabled on mobile/tablet devices');
  } else {
    new PortfolioApp();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  sT();

  const loadFont = (name, url) => {
    const f = new FontFace(name, `url(${url})`);
    return f.load().then((loaded) => {
      document.fonts.add(loaded);
    }).catch((err) => {
      console.warn('Font load error:', err);
    });
  };

  const fontSatoshi = loadFont('Satoshi', '/Satoshi-Regular.ttf');
  const fontMono = loadFont('Mono', '/IBMPlexMono-Regular.ttf');
  const imgLoaded = new Promise((resolve) => {
    imagesLoaded(document.querySelectorAll('img'), { background: true }, resolve);
  });

  Promise.all([fontSatoshi, fontMono, imgLoaded]).then(() => {
    aT();
  });
});
