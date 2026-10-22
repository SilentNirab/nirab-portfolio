import { Transform, Mesh, Program, Texture, Plane, Vec2 } from 'ogl';

export const getElementBounds = (n) => {
  const t = n.getBoundingClientRect();
  const e = window.scrollY ?? window.pageYOffset ?? 0;
  return {
    bottom: t.bottom + e,
    height: t.height,
    left: t.left,
    right: t.right,
    top: t.top + e,
    width: t.width,
  };
};

function drawRoundedRect(n, t, e, r, a, o = 5) {
  o = { tl: o, tr: o, br: o, bl: o };
  n.beginPath();
  n.moveTo(t + o.tl, e);
  n.lineTo(t + r - o.tr, e);
  n.quadraticCurveTo(t + r, e, t + r, e + o.tr);
  n.lineTo(t + r, e + a - o.br);
  n.quadraticCurveTo(t + r, e + a, t + r - o.br, e + a);
  n.lineTo(t + o.bl, e + a);
  n.quadraticCurveTo(t, e + a, t, e + a - o.bl);
  n.lineTo(t, e + o.tl);
  n.quadraticCurveTo(t, e, t + o.tl, e);
  n.closePath();
  n.stroke();
}

export class GLBackground {
  constructor({ canvas, element, geometry, scene }) {
    this.canvas = canvas;
    this.element = element;
    this.geometry = geometry;
    this.scene = scene;
    this.element.setAttribute('data-gl-text-active', '');
    this.bounds = getElementBounds(this.element);

    const cvs = document.createElement('canvas');
    const ctx = cvs.getContext('2d');
    const lineEl = this.element.querySelector('[data-gl-background-line]');
    const u = lineEl?.offsetLeft || 0;
    const f = 4;
    const d = Math.max(Math.round(this.bounds.height * 2), 4);
    const p = Math.max(Math.round(this.bounds.width * 2), 4);

    cvs.height = d;
    cvs.width = p;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = f;
    ctx.beginPath();
    ctx.moveTo(u * 2, 0);
    ctx.lineTo(u * 2, d - f / 2);
    ctx.stroke();
    ctx.closePath();
    drawRoundedRect(ctx, 1, 1, p - f / 2, d - f / 2, 15);

    this.createImage(cvs);
  }

  createImage(cvs) {
    const img = new Image();
    img.onload = () => this.createMesh(img);
    img.src = cvs.toDataURL('image/webp', 1);
  }

  createMesh(img) {
    const texture = new Texture(this.canvas.gl, {
      image: img,
      premultiplyAlpha: true,
    });
    const program = new Program(this.canvas.gl, {
      fragment: `
        precision highp float;
        uniform sampler2D tMap;
        uniform vec4 uResolution;
        varying vec2 vUv;
        void main() {
          vec2 uv = (vUv - vec2(0.5)) * uResolution.zw + vec2(0.5);
          vec4 color = texture2D(tMap, uv);
          gl_FragColor = color;
        }
      `,
      vertex: `
        precision highp float;
        attribute vec2 uv;
        attribute vec3 position;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      uniforms: {
        tMap: { value: texture },
        tCover: { value: null },
        uAlpha: { value: 1.0 },
        uNoise: { value: 0.0 },
        uOpacity: { value: 1.0 },
        uResolution: { value: [0, 0, 0, 0] },
        uTime: { value: 0.0 },
        uTransition: { value: 0.0 },
      },
      transparent: true,
    });

    this.mesh = new Mesh(this.canvas.gl, {
      geometry: this.geometry,
      program,
    });
    this.mesh.setParent(this.scene);
  }

  onResize() {
    this.bounds = getElementBounds(this.element);
  }

  onLoop(scrollY = 0) {
    if (!this.bounds || !this.mesh) return;
    const aspect = this.bounds.height / this.bounds.width;
    let r, a;
    if (this.mesh.scale.y / this.mesh.scale.x > aspect) {
      r = (this.mesh.scale.x / this.mesh.scale.y) * aspect;
      a = 1;
    } else {
      r = 1;
      a = (this.mesh.scale.y / this.mesh.scale.x) / aspect;
    }
    this.mesh.program.uniforms.uResolution.value = [this.mesh.scale.x, this.mesh.scale.y, r, a];
    this.mesh.scale.x = (this.canvas.sizes.x * this.bounds.width) / this.canvas.viewport.x;
    this.mesh.scale.y = (this.canvas.sizes.y * this.bounds.height) / this.canvas.viewport.y;

    const left = this.bounds.left;
    const top = this.bounds.top - scrollY;
    const x = -(this.canvas.sizes.x / 2) + this.mesh.scale.x / 2;
    const y = this.canvas.sizes.y / 2 - this.mesh.scale.y / 2;
    this.mesh.position.x = x + (left / this.canvas.viewport.x) * this.canvas.sizes.x;
    this.mesh.position.y = y - (top / this.canvas.viewport.y) * this.canvas.sizes.y;
  }
}

export class GLMedia {
  constructor({ canvas, element, geometry, scene }) {
    this.canvas = canvas;
    this.element = element;
    this.geometry = geometry;
    this.scene = scene;
    this.imgElement = this.element.querySelector('img');

    if (this.imgElement) {
      this.imgElement.setAttribute('crossorigin', 'anonymous');
      this.imgElement.setAttribute('data-gl-media-active', '');
      this.bounds = getElementBounds(this.element);
      this.containerSize = [this.bounds.width || 1, this.bounds.height || 1];
      this.imageSize = [
        this.imgElement.naturalWidth || 1,
        this.imgElement.naturalHeight || 1,
      ];
      this.createTexture();
      this.createMesh();
      this.updateSizes();
    }
  }

  createTexture() {
    this.texture = new Texture(this.canvas.gl, {
      image: this.imgElement,
      premultiplyAlpha: true,
    });

    const handleImgReady = () => {
      this.texture.image = this.imgElement;
      this.texture.needsUpdate = true;
      this.imageSize = [this.imgElement.naturalWidth, this.imgElement.naturalHeight];
      this.updateSizes();
    };

    if (this.imgElement.complete && this.imgElement.naturalWidth > 0) {
      handleImgReady();
    } else {
      this.imgElement.onload = handleImgReady;
    }
  }

  createMesh() {
    this.program = new Program(this.canvas.gl, {
      fragment: `
        precision highp float;
        uniform sampler2D tMap;
        uniform vec4 uResolution;
        uniform vec2 containerSize;
        uniform vec2 imageSize;
        uniform float uBorderRadius;
        varying vec2 vUv;

        vec2 cover(vec2 uv, vec2 containerSize, vec2 imageSize) {
            float containerRatio = containerSize.x / containerSize.y;
            float imageRatio = imageSize.x / imageSize.y;
            vec2 scale;
            vec2 offset;
            
            if(imageRatio > containerRatio) {
                scale = vec2(containerSize.y / imageSize.y);
                offset = vec2((containerSize.x - imageSize.x * scale.x) * 0.5, 0.0);
            } else {
                scale = vec2(containerSize.x / imageSize.x);
                offset = vec2(0.0, (containerSize.y - imageSize.y * scale.y) * 0.5);
            }
            
            vec2 adjustedUV = (uv * containerSize - offset) / (imageSize * scale);
            return adjustedUV;
        }

        float calcDistance(vec2 uv) {
            vec2 position = uv * 2.0 - 1.0;
            vec2 halfSize = vec2(1.0) - uBorderRadius;
            vec2 delta = abs(position) - halfSize;
            float dist = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0);
            return smoothstep(uBorderRadius - 0.005, uBorderRadius + 0.005, dist);
        }

        void main() {
            vec2 adjustedUV = cover(vUv, containerSize, imageSize);
            
            if(adjustedUV.x < 0.0 || adjustedUV.x > 1.0 || adjustedUV.y < 0.0 || adjustedUV.y > 1.0) {
                discard;
            }
            
            vec4 color = texture2D(tMap, adjustedUV);
            float borderAlpha = 1.0 - calcDistance(vUv);
            
            gl_FragColor = vec4(color.rgb, color.a * borderAlpha);
        }
      `,
      vertex: `
        precision highp float;
        attribute vec2 uv;
        attribute vec3 position;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      uniforms: {
        tMap: { value: this.texture },
        uResolution: { value: [0, 0, 0, 0] },
        containerSize: { value: this.containerSize },
        imageSize: { value: this.imageSize },
        uBorderRadius: { value: 0.015 },
      },
      transparent: true,
    });

    this.mesh = new Mesh(this.canvas.gl, {
      geometry: this.geometry,
      program: this.program,
    });
    this.mesh.setParent(this.scene);
    this.updateSizes();
  }

  updateSizes() {
    this.containerSize = [this.bounds.width || 1, this.bounds.height || 1];
    if (this.imgElement && this.imgElement.naturalWidth) {
      this.imageSize = [this.imgElement.naturalWidth, this.imgElement.naturalHeight];
    }
    if (this.mesh) {
      this.mesh.program.uniforms.containerSize.value = this.containerSize;
      this.mesh.program.uniforms.imageSize.value = this.imageSize;
    }
  }

  onResize() {
    this.bounds = getElementBounds(this.element);
    this.updateSizes();
  }

  onLoop(scrollY = 0) {
    if (!this.bounds || !this.mesh) return;
    if (this.imgElement && this.imgElement.naturalWidth && (!this.imageSize[0] || !this.imageSize[1])) {
      this.imageSize = [this.imgElement.naturalWidth, this.imgElement.naturalHeight];
      this.mesh.program.uniforms.imageSize.value = this.imageSize;
    }
    this.mesh.scale.x = (this.canvas.sizes.x * this.bounds.width) / this.canvas.viewport.x;
    this.mesh.scale.y = (this.canvas.sizes.y * this.bounds.height) / this.canvas.viewport.y;
    const left = this.bounds.left;
    const top = this.bounds.top - scrollY;
    const x = -(this.canvas.sizes.x / 2) + this.mesh.scale.x / 2;
    const y = this.canvas.sizes.y / 2 - this.mesh.scale.y / 2;
    this.mesh.position.x = x + (left / this.canvas.viewport.x) * this.canvas.sizes.x;
    this.mesh.position.y = y - (top / this.canvas.viewport.y) * this.canvas.sizes.y;
    this.mesh.program.uniforms.uResolution.value = [
      this.containerSize[0],
      this.containerSize[1],
      1 / Math.max(this.containerSize[0], 1),
      1 / Math.max(this.containerSize[1], 1),
    ];
  }
}

export class GLText {
  constructor({ canvas, element, geometry, scene }) {
    this.canvas = canvas;
    this.element = element;
    this.geometry = geometry;
    this.scene = scene;
    this.color = this.element.dataset.color || 'white';

    const fontFaces = [
      new FontFace('Satoshi', 'url(/Satoshi-Regular.ttf)'),
      new FontFace('Mono', 'url(/IBMPlexMono-Regular.ttf)'),
    ];

    Promise.all(fontFaces.map((f) => f.load()))
      .then((loaded) => {
        loaded.forEach((f) => document.fonts.add(f));
        this.initText();
      })
      .catch((err) => {
        console.error('Failed to load fonts:', err);
        this.initText();
      });
  }

  initText() {
    this.element.setAttribute('data-gl-text-active', '');
    this.bounds = getElementBounds(this.element);
    if (!this.bounds.width || !this.bounds.height) return;

    const cvs = document.createElement('canvas');
    const ctx = cvs.getContext('2d');
    const r = Math.min(window.devicePixelRatio || 1, 2);
    const a = 2;

    cvs.width = Math.ceil(this.bounds.width * r * a);
    cvs.height = Math.ceil(this.bounds.height * r * a);

    const style = getComputedStyle(this.element);
    const fontSize = parseFloat(style.fontSize);
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;
    const letterSpacing = style.letterSpacing !== 'normal'
      ? parseFloat(style.letterSpacing) * r * a
      : 0;
    const fontName = style.fontFamily.includes('Mono') ? 'Mono' : 'Satoshi';

    ctx.font = `${style.fontWeight} ${fontSize * r * a}px ${fontName}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let text = this.element.textContent.trim();
    if (this.element.dataset.glText === 'uppercase') {
      text = text.toUpperCase();
    }

    const words = text.split(' ');
    const lines = [];
    let currentLine = [];
    let currentLineWidth = 0;
    const maxLineWidth = cvs.width;

    const measureWord = (word) => {
      let w = 0;
      for (let i = 0; i < word.length; i++) {
        w += ctx.measureText(word[i]).width;
        if (i < word.length - 1) w += letterSpacing;
      }
      return w;
    };

    const spaceWidth = ctx.measureText(' ').width;

    for (const word of words) {
      const wordWidth = measureWord(word);
      const testWidth = currentLineWidth + wordWidth + (currentLine.length ? spaceWidth : 0);
      if (testWidth > maxLineWidth) {
        if (currentLine.length) {
          lines.push(currentLine.join(' '));
          currentLine = [word];
          currentLineWidth = wordWidth;
        } else {
          lines.push(word);
          currentLine = [];
          currentLineWidth = 0;
        }
      } else {
        currentLine.push(word);
        currentLineWidth += wordWidth + (currentLine.length > 1 ? spaceWidth : 0);
      }
    }
    if (currentLine.length) {
      lines.push(currentLine.join(' '));
    }

    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = this.color;

    lines.forEach((line, lineIdx) => {
      const y = lineIdx * lineHeight * r * a + (lineHeight * r * a) / 2;
      let startX = 0;
      let justifyExtra = 0;
      const chars = line.split('');
      let totalLineWidth = 0;

      for (let i = 0; i < chars.length; i++) {
        totalLineWidth += ctx.measureText(chars[i]).width;
        if (i < chars.length - 1 && chars[i] !== ' ' && chars[i + 1] !== ' ') {
          totalLineWidth += letterSpacing;
        }
      }

      if (style.textAlign === 'center') {
        startX = (cvs.width - totalLineWidth) / 2;
      } else if (style.textAlign === 'right') {
        startX = cvs.width - totalLineWidth;
      } else if (style.textAlign === 'justify' && lineIdx < lines.length - 1) {
        const spaceCount = line.split(' ').length - 1;
        if (spaceCount > 0) {
          justifyExtra = (cvs.width - totalLineWidth) / spaceCount;
        }
      }

      let curX = startX;
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (char === ' ' && style.textAlign === 'justify' && lineIdx < lines.length - 1) {
          curX += spaceWidth + justifyExtra;
        } else {
          ctx.fillText(char, curX, y);
          curX += ctx.measureText(char).width;
          if (i < chars.length - 1 && chars[i] !== ' ' && chars[i + 1] !== ' ') {
            curX += letterSpacing;
          }
        }
      }
    });

    this.createImage(cvs);
  }

  createImage(cvs) {
    const img = new Image();
    img.onload = () => this.createMesh(img);
    img.onerror = (e) => console.error('Failed to load text image:', e);
    img.src = cvs.toDataURL('image/webp', 1);
  }

  createMesh(img) {
    const texture = new Texture(this.canvas.gl, {
      image: img,
      minFilter: this.canvas.gl.LINEAR_MIPMAP_LINEAR,
      magFilter: this.canvas.gl.LINEAR,
    });
    texture.needsUpdate = true;

    const program = new Program(this.canvas.gl, {
      fragment: `
        precision highp float;
        uniform sampler2D tMap;
        uniform vec4 uResolution;
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          vec2 uv = (vUv - vec2(0.5)) * uResolution.zw + vec2(0.5);
          vec4 color = texture2D(tMap, uv);
          gl_FragColor = vec4(color.rgb, color.a * uAlpha);
        }
      `,
      vertex: `
        precision highp float;
        attribute vec2 uv;
        attribute vec3 position;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      uniforms: {
        tMap: { value: texture },
        tCover: { value: null },
        uAlpha: { value: 1.0 },
        uNoise: { value: 0.0 },
        uOpacity: { value: 1.0 },
        uResolution: { value: [0, 0, 0, 0] },
        uTime: { value: 0.0 },
        uTransition: { value: 0.0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new Mesh(this.canvas.gl, {
      geometry: this.geometry,
      program,
    });
    this.mesh.setParent(this.scene);
    this.onResize();
  }

  onResize() {
    if (!this.mesh) return;
    this.bounds = getElementBounds(this.element);
    this.mesh.scale.x = (this.canvas.sizes.x * this.bounds.width) / this.canvas.viewport.x;
    this.mesh.scale.y = (this.canvas.sizes.y * this.bounds.height) / this.canvas.viewport.y;
    this.updatePosition(this.canvas.lenis?.scroll || 0);
  }

  updatePosition(scrollY = 0) {
    if (!this.bounds || !this.mesh) return;
    const left = this.bounds.left;
    const top = this.bounds.top - scrollY;
    const x = -(this.canvas.sizes.x / 2) + this.mesh.scale.x / 2;
    const y = this.canvas.sizes.y / 2 - this.mesh.scale.y / 2;
    this.mesh.position.x = x + (left / this.canvas.viewport.x) * this.canvas.sizes.x;
    this.mesh.position.y = y - (top / this.canvas.viewport.y) * this.canvas.sizes.y;
  }

  onLoop(scrollY = 0) {
    this.updatePosition(scrollY);
    if (!this.bounds || !this.mesh) return;
    const aspect = this.bounds.height / this.bounds.width;
    let r = 1,
      a = 1;
    if (this.mesh.scale.y / this.mesh.scale.x > aspect) {
      r = (this.mesh.scale.x / this.mesh.scale.y) * aspect;
    } else {
      a = (this.mesh.scale.y / this.mesh.scale.x) / aspect;
    }
    this.mesh.program.uniforms.uResolution.value = [this.mesh.scale.x, this.mesh.scale.y, r, a];
  }
}

export class SceneManager extends Transform {
  constructor({ canvas }) {
    super();
    this.canvas = canvas;
    const sharedPlane = new Plane(this.canvas.gl, {
      heightSegments: 1,
      widthSegments: 1,
    });

    this.backgrounds = Array.from(document.querySelectorAll('[data-gl-background]')).map(
      (el) => new GLBackground({ canvas: this.canvas, element: el, geometry: sharedPlane, scene: this })
    );

    this.medias = Array.from(document.querySelectorAll('[data-gl-media]')).map(
      (el) => new GLMedia({ canvas: this.canvas, element: el, geometry: sharedPlane, scene: this })
    );

    this.texts = Array.from(document.querySelectorAll('[data-gl-text]')).map(
      (el) => new GLText({ canvas: this.canvas, element: el, geometry: sharedPlane, scene: this })
    );
  }

  onResize() {
    this.backgrounds?.forEach((b) => b.onResize());
    this.medias?.forEach((m) => m.onResize());
    this.texts?.forEach((t) => t.onResize());
  }

  onLoop(scrollY = 0) {
    this.backgrounds?.forEach((b) => b.onLoop(scrollY));
    this.medias?.forEach((m) => m.onLoop(scrollY));
    this.texts?.forEach((t) => t.onLoop(scrollY));
  }
}
