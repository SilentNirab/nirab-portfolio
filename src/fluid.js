import { RenderTarget, Program, Mesh, Geometry, Vec2, Vec3 } from 'ogl';

function checkTextureSupport(gl, internalFormat, format, type) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return status === gl.FRAMEBUFFER_COMPLETE;
  } catch (e) {
    return false;
  }
}

function getSupportedFormat(gl, internalFormat, format, type) {
  if (!checkTextureSupport(gl, internalFormat, format, type)) {
    switch (internalFormat) {
      case gl.R16F:
        return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
      case gl.RG16F:
        return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
      default:
        return null;
    }
  }
  return { internalFormat, format };
}

function createDoubleFBO(gl, { width, height, wrapS, wrapT, minFilter = gl.LINEAR, magFilter = minFilter, type, format, internalFormat, depth = false }) {
  const options = { width, height, wrapS, wrapT, minFilter, magFilter, type, format, internalFormat, depth };
  const fbo = {
    read: new RenderTarget(gl, options),
    write: new RenderTarget(gl, options),
    swap: () => {
      const temp = fbo.read;
      fbo.read = fbo.write;
      fbo.write = temp;
    },
  };
  return fbo;
}

export class FluidSimulation {
  constructor(gl) {
    this.gl = gl;
    this.simRes = 128;
    this.dyeRes = 512;
    this.iterations = 3;
    this.densityDissipation = 0.93;
    this.velocityDissipation = 0.9;
    this.pressureDissipation = 0.8;
    this.curlStrength = 20;
    this.splatRadius = 0.3;

    this.texelSize = { value: new Vec2(1 / this.simRes) };

    const isWebgl2 = gl.renderer.isWebgl2;
    const hasLinear = gl.renderer.extensions[isWebgl2 ? 'OES_texture_float_linear' : 'OES_texture_half_float_linear'];
    const halfFloatType = isWebgl2 ? gl.HALF_FLOAT : (gl.renderer.extensions.OES_texture_half_float?.HALF_FLOAT_OES || gl.UNSIGNED_BYTE);
    const filter = hasLinear ? gl.LINEAR : gl.NEAREST;

    let rgbaFormat, rgFormat, rFormat;
    if (isWebgl2) {
      rgbaFormat = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatType);
      rgFormat = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatType);
      rFormat = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatType);
    } else {
      rgbaFormat = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatType);
      rgFormat = rgbaFormat;
      rFormat = rgbaFormat;
    }

    this.density = createDoubleFBO(gl, {
      width: this.dyeRes,
      height: this.dyeRes,
      type: halfFloatType,
      format: rgbaFormat?.format || gl.RGBA,
      internalFormat: rgbaFormat?.internalFormat || gl.RGBA,
      minFilter: filter,
      depth: false,
    });

    this.velocity = createDoubleFBO(gl, {
      width: this.simRes,
      height: this.simRes,
      type: halfFloatType,
      format: rgFormat?.format || gl.RGBA,
      internalFormat: rgFormat?.internalFormat || gl.RGBA,
      minFilter: filter,
      depth: false,
    });

    this.pressure = createDoubleFBO(gl, {
      width: this.simRes,
      height: this.simRes,
      type: halfFloatType,
      format: rFormat?.format || gl.RGBA,
      internalFormat: rFormat?.internalFormat || gl.RGBA,
      minFilter: gl.NEAREST,
      depth: false,
    });

    this.divergence = new RenderTarget(gl, {
      width: this.simRes,
      height: this.simRes,
      type: halfFloatType,
      format: rFormat?.format || gl.RGBA,
      internalFormat: rFormat?.internalFormat || gl.RGBA,
      minFilter: gl.NEAREST,
      depth: false,
    });

    this.curl = new RenderTarget(gl, {
      width: this.simRes,
      height: this.simRes,
      type: halfFloatType,
      format: rFormat?.format || gl.RGBA,
      internalFormat: rFormat?.internalFormat || gl.RGBA,
      minFilter: gl.NEAREST,
      depth: false,
    });

    this.triangle = new Geometry(gl, {
      position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) },
      uv: { size: 2, data: new Float32Array([0, 0, 2, 0, 0, 2]) },
    });

    const baseVertex = `
      precision highp float;
      attribute vec2 position;
      attribute vec2 uv;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;

      void main () {
        vUv = uv;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    this.clearProgram = new Mesh(gl, {
      geometry: this.triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: `
          precision mediump float;
          precision mediump sampler2D;
          varying highp vec2 vUv;
          uniform sampler2D uTexture;
          uniform float value;
          void main () {
            gl_FragColor = value * texture2D(uTexture, vUv);
          }
        `,
        uniforms: {
          texelSize: this.texelSize,
          uTexture: { value: null },
          value: { value: this.pressureDissipation },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.splatProgram = new Mesh(gl, {
      geometry: this.triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: `
          precision highp float;
          precision highp sampler2D;
          varying vec2 vUv;
          uniform sampler2D uTarget;
          uniform float aspectRatio;
          uniform vec3 color;
          uniform vec2 point;
          uniform float radius;

          void main () {
            vec2 p = vUv - point.xy;
            p.x *= aspectRatio;
            vec3 splat = exp(-dot(p, p) / radius) * color;
            vec3 base = texture2D(uTarget, vUv).xyz;
            gl_FragColor = vec4(base + splat, 1.0);
          }
        `,
        uniforms: {
          texelSize: this.texelSize,
          uTarget: { value: null },
          aspectRatio: { value: 1 },
          color: { value: new Vec3() },
          point: { value: new Vec2() },
          radius: { value: this.splatRadius / 100 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    const advectionFragment = hasLinear
      ? `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform vec2 texelSize;
        uniform float dt;
        uniform float dissipation;

        void main () {
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          gl_FragColor = dissipation * texture2D(uSource, coord);
          gl_FragColor.a = 1.0;
        }
      `
      : `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform vec2 texelSize;
        uniform vec2 dyeTexelSize;
        uniform float dt;
        uniform float dissipation;

        vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
          vec2 st = uv / tsize - 0.5;
          vec2 iuv = floor(st);
          vec2 fuv = fract(st);
          vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
          vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
          vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
          vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
          return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
        }

        void main () {
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          gl_FragColor = dissipation * bilerp(uSource, coord, dyeTexelSize);
          gl_FragColor.a = 1.0;
        }
      `;

    this.advectionProgram = new Mesh(gl, {
      geometry: this.triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: advectionFragment,
        uniforms: {
          texelSize: this.texelSize,
          dyeTexelSize: { value: new Vec2(1 / this.dyeRes) },
          uVelocity: { value: null },
          uSource: { value: null },
          dt: { value: 0.016 },
          dissipation: { value: 1.0 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.divergenceProgram = new Mesh(gl, {
      geometry: this.triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: `
          precision mediump float;
          precision mediump sampler2D;
          varying highp vec2 vUv;
          varying highp vec2 vL;
          varying highp vec2 vR;
          varying highp vec2 vT;
          varying highp vec2 vB;
          uniform sampler2D uVelocity;

          void main () {
            float L = texture2D(uVelocity, vL).x;
            float R = texture2D(uVelocity, vR).x;
            float T = texture2D(uVelocity, vT).y;
            float B = texture2D(uVelocity, vB).y;

            vec2 C = texture2D(uVelocity, vUv).xy;
            if (vL.x < 0.0) { L = -C.x; }
            if (vR.x > 1.0) { R = -C.x; }
            if (vT.y > 1.0) { T = -C.y; }
            if (vB.y < 0.0) { B = -C.y; }

            float div = 0.5 * (R - L + T - B);
            gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
          }
        `,
        uniforms: {
          texelSize: this.texelSize,
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.curlProgram = new Mesh(gl, {
      geometry: this.triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: `
          precision mediump float;
          precision mediump sampler2D;
          varying highp vec2 vUv;
          varying highp vec2 vL;
          varying highp vec2 vR;
          varying highp vec2 vT;
          varying highp vec2 vB;
          uniform sampler2D uVelocity;

          void main () {
            float L = texture2D(uVelocity, vL).y;
            float R = texture2D(uVelocity, vR).y;
            float T = texture2D(uVelocity, vT).x;
            float B = texture2D(uVelocity, vB).x;
            float vorticity = R - L - T + B;
            gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
          }
        `,
        uniforms: {
          texelSize: this.texelSize,
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.vorticityProgram = new Mesh(gl, {
      geometry: this.triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: `
          precision highp float;
          precision highp sampler2D;
          varying vec2 vUv;
          varying vec2 vL;
          varying vec2 vR;
          varying vec2 vT;
          varying vec2 vB;
          uniform sampler2D uVelocity;
          uniform sampler2D uCurl;
          uniform float curl;
          uniform float dt;

          void main () {
            float L = texture2D(uCurl, vL).x;
            float R = texture2D(uCurl, vR).x;
            float T = texture2D(uCurl, vT).x;
            float B = texture2D(uCurl, vB).x;
            float C = texture2D(uCurl, vUv).x;

            vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
            force /= length(force) + 0.0001;
            force *= curl * C;
            force.y *= -1.0;

            vec2 vel = texture2D(uVelocity, vUv).xy;
            gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
          }
        `,
        uniforms: {
          texelSize: this.texelSize,
          uVelocity: { value: null },
          uCurl: { value: null },
          curl: { value: this.curlStrength },
          dt: { value: 0.016 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.pressureProgram = new Mesh(gl, {
      geometry: this.triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: `
          precision mediump float;
          precision mediump sampler2D;
          varying highp vec2 vUv;
          varying highp vec2 vL;
          varying highp vec2 vR;
          varying highp vec2 vT;
          varying highp vec2 vB;
          uniform sampler2D uPressure;
          uniform sampler2D uDivergence;

          void main () {
            float L = texture2D(uPressure, vL).x;
            float R = texture2D(uPressure, vR).x;
            float T = texture2D(uPressure, vT).x;
            float B = texture2D(uPressure, vB).x;
            float C = texture2D(uPressure, vUv).x;
            float divergence = texture2D(uDivergence, vUv).x;
            float pressure = (L + R + B + T - divergence) * 0.25;
            gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
          }
        `,
        uniforms: {
          texelSize: this.texelSize,
          uPressure: { value: null },
          uDivergence: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.gradientSubtractProgram = new Mesh(gl, {
      geometry: this.triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: `
          precision mediump float;
          precision mediump sampler2D;
          varying highp vec2 vUv;
          varying highp vec2 vL;
          varying highp vec2 vR;
          varying highp vec2 vT;
          varying highp vec2 vB;
          uniform sampler2D uPressure;
          uniform sampler2D uVelocity;

          void main () {
            float L = texture2D(uPressure, vL).x;
            float R = texture2D(uPressure, vR).x;
            float T = texture2D(uPressure, vT).x;
            float B = texture2D(uPressure, vB).x;
            vec2 velocity = texture2D(uVelocity, vUv).xy;
            velocity.xy -= vec2(R - L, T - B);
            gl_FragColor = vec4(velocity, 0.0, 1.0);
          }
        `,
        uniforms: {
          texelSize: this.texelSize,
          uPressure: { value: null },
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.splats = [];
  }

  splat({ x, y, dx, dy }) {
    const gl = this.gl;
    const renderer = gl.renderer;

    this.splatProgram.program.uniforms.uTarget.value = this.velocity.read.texture;
    this.splatProgram.program.uniforms.aspectRatio.value = renderer.width / renderer.height;
    this.splatProgram.program.uniforms.point.value.set(x, y);
    this.splatProgram.program.uniforms.color.value.set(dx, dy, 1.0);
    renderer.render({ scene: this.splatProgram, target: this.velocity.write, sort: false, update: false });
    this.velocity.swap();

    this.splatProgram.program.uniforms.uTarget.value = this.density.read.texture;
    renderer.render({ scene: this.splatProgram, target: this.density.write, sort: false, update: false });
    this.density.swap();
  }

  step() {
    const gl = this.gl;
    const renderer = gl.renderer;

    // Process all pending splats
    for (let i = this.splats.length - 1; i >= 0; i--) {
      this.splat(this.splats.splice(i, 1)[0]);
    }

    // 1. Curl
    this.curlProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    renderer.render({ scene: this.curlProgram, target: this.curl, sort: false, update: false });

    // 2. Vorticity
    this.vorticityProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    this.vorticityProgram.program.uniforms.uCurl.value = this.curl.texture;
    renderer.render({ scene: this.vorticityProgram, target: this.velocity.write, sort: false, update: false });
    this.velocity.swap();

    // 3. Divergence
    this.divergenceProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    renderer.render({ scene: this.divergenceProgram, target: this.divergence, sort: false, update: false });

    // 4. Clear pressure
    this.clearProgram.program.uniforms.uTexture.value = this.pressure.read.texture;
    renderer.render({ scene: this.clearProgram, target: this.pressure.write, sort: false, update: false });
    this.pressure.swap();

    // 5. Pressure Poisson solve (Jacobi iterations)
    this.pressureProgram.program.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < this.iterations; i++) {
      this.pressureProgram.program.uniforms.uPressure.value = this.pressure.read.texture;
      renderer.render({ scene: this.pressureProgram, target: this.pressure.write, sort: false, update: false });
      this.pressure.swap();
    }

    // 6. Gradient subtract
    this.gradientSubtractProgram.program.uniforms.uPressure.value = this.pressure.read.texture;
    this.gradientSubtractProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    renderer.render({ scene: this.gradientSubtractProgram, target: this.velocity.write, sort: false, update: false });
    this.velocity.swap();

    // 7. Advect velocity
    this.advectionProgram.program.uniforms.dyeTexelSize.value.set(1 / this.simRes);
    this.advectionProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectionProgram.program.uniforms.uSource.value = this.velocity.read.texture;
    this.advectionProgram.program.uniforms.dissipation.value = this.velocityDissipation;
    renderer.render({ scene: this.advectionProgram, target: this.velocity.write, sort: false, update: false });
    this.velocity.swap();

    // 8. Advect density
    this.advectionProgram.program.uniforms.dyeTexelSize.value.set(1 / this.dyeRes);
    this.advectionProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectionProgram.program.uniforms.uSource.value = this.density.read.texture;
    this.advectionProgram.program.uniforms.dissipation.value = this.densityDissipation;
    renderer.render({ scene: this.advectionProgram, target: this.density.write, sort: false, update: false });
    this.density.swap();
  }
}
