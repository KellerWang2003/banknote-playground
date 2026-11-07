import {
  AWAY_LIGHT, FILM_FULL, FILM_N2, GLINT_LOBE, GLINT_POWER, GLINT_TILT, GLINT_WHITE, GRAIN_LIGHT, GRAIN_TILT, LAMP_GLOW, LAMP_POWER,
  ROOM_LIGHT, SHIFT_DIP, type InkLight,
} from './realisticInk'

/**
 * Realistic magnetic ink's renderer: one WebGL context for every banknote's ink, on the canvas and in exports, as browsers
 * allow only a few. It lights an ink at a tilt (realisticInk.ts) in its own canvas and copies the result where it goes: a
 * canvas in the ink's box on a banknote (`paintLitInk`), redrawn only when the tilt, the turn or the zoom changes, or the
 * export's banknote face (`drawLitInk`). Without WebGL there is nothing to light it with, and the ink keeps its flat look.
 */

const glsl = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

const VERTEX = `attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

// Every pixel of the ink's box: its flake's facing on the magnet's curve, turned with the banknote, mirroring the lamp
// and the room to the eye in the colour its film shows at that angle, through the ink's mask
const FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uMask;
uniform vec2 uRes;
uniform float uCell;
uniform mat3 uRot;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform float uEye;
uniform vec2 uAxis;
uniform float uEdge;
uniform float uLobe;
uniform vec3 uLamp;
uniform vec3 uDown;
uniform vec3 uFlat;
uniform vec2 uTilted;
uniform float uHue;

// A random number from 0 to 1 for each grain cell
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
             -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
             -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
float film(float th) { float s = sin(th); return 1.0 - sqrt(1.0 - s * s / ${glsl(FILM_N2)}); }
// Bright light rolls off softly instead of clipping, its highlights going towards white
vec3 tone(vec3 x) {
  vec3 over = max(x - 0.8, 0.0);
  vec3 y = min(x, 0.8) + 0.2 * (1.0 - exp(-over / 0.2));
  float peak = max(max(x.r, x.g), x.b);
  return mix(y, vec3(max(max(y.r, y.g), y.b)), smoothstep(1.0, 3.4, peak) * 0.6);
}
vec3 encode(vec3 c) { return mix(12.92 * c, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float lobe(vec3 r, vec3 l, float width) { float a = acos(clamp(dot(r, l), -1.0, 1.0)); return exp(-(a * a) / (width * width)); }

void main() {
  float m = texture2D(uMask, vUv).a;
  if (m < 0.002) { gl_FragColor = vec4(0.0); return; }
  vec3 p = uRot * vec3(uOrigin + vUv * uSize, 0.0);
  vec3 v = normalize(vec3(0.0, 0.0, uEye) - p);
  vec3 l = normalize(uLamp - p);
  // The magnet's curve across the shape, each flake a little off it
  float phi = (dot(vUv, uAxis) - 0.5) * 2.0 * uEdge;
  vec2 cell = floor(vUv * uRes / uCell);
  vec3 flake = vec3(uAxis * sin(phi), cos(phi));
  vec3 n = normalize(uRot * normalize(flake + vec3(hash(cell) - 0.5, hash(cell + 17.0) - 0.5, 0.0) * ${glsl(2 * GRAIN_TILT)}));
  float facing = dot(n, v);
  vec3 r = 2.0 * facing * n - v;
  float key = ${glsl(LAMP_POWER)} * (lobe(r, l, uLobe) + ${glsl(LAMP_GLOW)} * lobe(r, l, 3.0 * uLobe));
  float room = mix(${glsl(ROOM_LIGHT.below)}, ${glsl(ROOM_LIGHT.above)}, clamp(0.5 - 0.5 * dot(r, uDown), 0.0, 1.0));
  // A stray flake, tilted any which way
  vec3 stray = normalize(uRot * normalize(flake + vec3(hash(cell + 41.0) - 0.5, hash(cell + 73.0) - 0.5, 0.0) * ${glsl(2 * GLINT_TILT)}));
  vec3 rs = 2.0 * dot(stray, v) * stray - v;
  float glint = ${glsl(GLINT_POWER)} * (0.35 + 0.65 * hash(cell + 101.0)) * lobe(rs, l, ${glsl(GLINT_LOBE)});
  // Its film's colour at the angle it is seen at, from Flat to Tilted, a little less vivid between
  float u = clamp(film(acos(clamp(facing, 0.0, 1.0))) / ${glsl(FILM_FULL)}, 0.0, 1.0);
  float chroma = mix(uFlat.y, uTilted.y, u) * (1.0 - ${glsl(SHIFT_DIP)} * sin(3.14159265 * u));
  float hue = uFlat.z + uHue * u;
  vec3 colour = max(oklabToLinear(vec3(mix(uFlat.x, uTilted.x, u), chroma * cos(hue), chroma * sin(hue))), 0.0);
  float grain = 1.0 + ${glsl(2 * GRAIN_LIGHT)} * (hash(cell + 59.0) - 0.5);
  vec3 light = colour * ((key + room) * grain + 0.04) + mix(colour, vec3(1.0), ${glsl(GLINT_WHITE)}) * glint;
  if (facing <= 0.0) light *= ${glsl(AWAY_LIGHT)};
  gl_FragColor = vec4(encode(tone(light)) * m, m);
}`

const UNIFORMS = ['uMask', 'uRes', 'uCell', 'uRot', 'uOrigin', 'uSize', 'uEye', 'uAxis', 'uEdge', 'uLobe', 'uLamp', 'uDown', 'uFlat', 'uTilted', 'uHue'] as const

type GL = WebGLRenderingContext | WebGL2RenderingContext
/** A mask the ink is drawn through: its alpha is how much ink each pixel takes */
export type MaskSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

interface Renderer {
  canvas: HTMLCanvasElement
  gl: GL
  /** WebGL 2 makes mipmaps of masks of any size, so a big mask drawn small keeps a smooth edge */
  anySizeMipmaps: boolean
  /** The largest texture, and the largest drawing */
  maxTexture: number
  maxDraw: number
  program?: WebGLProgram
  uniforms: Partial<Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>>
  /** Masks on the GPU, the latest used last */
  textures: Map<MaskSource, WebGLTexture>
  lost: boolean
}

/** Masks kept on the GPU: every banknote's on the canvas and an export's */
const TEXTURES_KEPT = 4

let renderer: Renderer | null | undefined

function compile(gl: GL, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : undefined
}

/** The program and the square it is drawn on: again after the context is lost and restored, when the GPU has forgotten them */
function prepare(r: Renderer) {
  const { gl } = r
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) return false
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  r.program = program
  r.uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]))
  r.textures.clear()
  return true
}

function create(): Renderer | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const options: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }
  let gl: GL | null = null
  try {
    gl = canvas.getContext('webgl2', options) ?? canvas.getContext('webgl', options)
  } catch {
    gl = null
  }
  if (!gl) return null
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
  const r: Renderer = {
    canvas,
    gl,
    anySizeMipmaps: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxDraw: Math.min(viewport[0], viewport[1]),
    uniforms: {},
    textures: new Map(),
    lost: false,
  }
  if (!prepare(r)) return null
  // A lost context comes back if asked to; until then nothing draws, and each ink keeps what it last showed
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    r.lost = true
  })
  canvas.addEventListener('webglcontextrestored', () => {
    r.lost = !prepare(r)
  })
  return r
}

/** The renderer, set up the first time it is asked for; null where the browser has no WebGL */
function inkRenderer() {
  if (renderer === undefined) renderer = create()
  return renderer
}

/** Whether realistic magnetic ink can be drawn here: the browser has WebGL */
export const litInkAvailable = () => inkRenderer() !== null

const isPowerOfTwo = (n: number) => (n & (n - 1)) === 0

/** A mask on the GPU, put there once; one bigger than the GPU takes is scaled down to fit first */
function textureFor(r: Renderer, mask: MaskSource) {
  const kept = r.textures.get(mask)
  if (kept) {
    r.textures.delete(mask)
    r.textures.set(mask, kept)
    return kept
  }
  if (mask.width < 1 || mask.height < 1) return undefined
  const { gl } = r
  let source: TexImageSource = mask
  let { width, height } = mask
  if (width > r.maxTexture || height > r.maxTexture) {
    const k = r.maxTexture / Math.max(width, height)
    width = Math.max(1, Math.floor(width * k))
    height = Math.max(1, Math.floor(height * k))
    const smaller = new OffscreenCanvas(width, height)
    const ctx = smaller.getContext('2d')
    if (!ctx) return undefined
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(mask, 0, 0, width, height)
    source = smaller
  }
  const texture = gl.createTexture()
  if (!texture) return undefined
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  // Only its alpha: a quarter of the memory
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, gl.ALPHA, gl.UNSIGNED_BYTE, source)
  const mipmaps = r.anySizeMipmaps || (isPowerOfTwo(width) && isPowerOfTwo(height))
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  r.textures.set(mask, texture)
  for (const [old, oldTexture] of r.textures) {
    if (r.textures.size <= TEXTURES_KEPT) break
    gl.deleteTexture(oldTexture)
    r.textures.delete(old)
  }
  return texture
}

/**
 * Lights `ink` through `mask` at `width` × `height` pixels, with grain cells `cell` pixels across, and draws it onto
 * `target` at `dest`. False when it can't (no WebGL, or the context is lost), having drawn nothing.
 */
export function drawLitInk(
  target: Ctx,
  dest: { x: number; y: number; width: number; height: number },
  mask: MaskSource,
  light: InkLight,
  size: { width: number; height: number },
  cell: number,
) {
  const r = inkRenderer()
  if (!r || r.lost || !r.program) return false
  const { gl, canvas } = r
  const u = (name: (typeof UNIFORMS)[number]) => r.uniforms[name] ?? null
  const width = Math.max(1, Math.min(Math.round(size.width), r.maxDraw))
  const height = Math.max(1, Math.min(Math.round(size.height), r.maxDraw))
  // The canvas only grows, in steps, so inks of different sizes don't keep resizing it; each draws in its bottom-left corner
  if (canvas.width < width || canvas.height < height) {
    const step = (n: number) => Math.min(r.maxDraw, Math.ceil(n / 256) * 256)
    canvas.width = Math.max(canvas.width, step(width))
    canvas.height = Math.max(canvas.height, step(height))
  }
  const texture = textureFor(r, mask)
  if (!texture) return false
  gl.useProgram(r.program)
  gl.viewport(0, 0, width, height)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.uniform1i(u('uMask'), 0)
  gl.uniform2f(u('uRes'), width, height)
  gl.uniform1f(u('uCell'), cell * (width / Math.max(1, size.width)))
  gl.uniformMatrix3fv(u('uRot'), false, light.rot)
  gl.uniform2f(u('uOrigin'), ...light.origin)
  gl.uniform2f(u('uSize'), ...light.size)
  gl.uniform1f(u('uEye'), light.eye)
  gl.uniform2f(u('uAxis'), ...light.axis)
  gl.uniform1f(u('uEdge'), light.edge)
  gl.uniform1f(u('uLobe'), light.lobe)
  gl.uniform3f(u('uLamp'), ...light.lamp)
  gl.uniform3f(u('uDown'), ...light.down)
  gl.uniform3f(u('uFlat'), ...light.flat)
  gl.uniform2f(u('uTilted'), ...light.tilted)
  gl.uniform1f(u('uHue'), light.hue)
  // Every pixel of it is drawn, clear ones too, so there is nothing to clear first
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  target.drawImage(canvas, 0, canvas.height - height, width, height, dest.x, dest.y, dest.width, dest.height)
  return true
}

/** What each canvas on the canvas last showed, so a tilt that doesn't change it (the light, the timeline) doesn't draw it again */
const painted = new WeakMap<HTMLCanvasElement, { mask: MaskSource; key: string }>()

/**
 * Lights `ink` into a canvas of its own, in place of what it showed, at the canvas's own size, with grain cells `cell` of
 * its pixels across. Nothing is drawn when it would show the same again. False when it can't be lit (no WebGL).
 */
export function paintLitInk(canvas: HTMLCanvasElement, mask: MaskSource, light: InkLight, cell: number) {
  const key = `${canvas.width}×${canvas.height}|${cell}|${JSON.stringify(light)}`
  const last = painted.get(canvas)
  if (last?.mask === mask && last.key === key) return true
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.globalCompositeOperation = 'copy'
  const drawn = drawLitInk(ctx, { x: 0, y: 0, width: canvas.width, height: canvas.height }, mask, light, canvas, cell)
  if (drawn) painted.set(canvas, { mask, key })
  return drawn
}
