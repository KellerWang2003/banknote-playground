import {
  ARC_FLAT_LIGHT, ARC_GROOVE, ARC_LIGHT, ARC_LINE_POINTS, ARC_POINTS, ARC_RIDGE_FADE, ARC_RIDGE_MM, ARC_RIDGE_SAMPLES, ARC_RIDGE_SLOPE_DEG,
  ARC_SHEEN, BAND_BLEND, BAND_BLUR, CURVE_STEPS, averageRgb,
} from './arcEnCiel'
import type { BandField, BandLook } from './bandMap'
import {
  AWAY_LIGHT, FILM_FULL, FILM_N2, GLINT_LOBE, GLINT_POWER, GLINT_TILT, GLINT_WHITE, GRAIN_LIGHT, GRAIN_TILT, LAMP_GLOW, LAMP_POWER,
  ROOM_LIGHT, SHIFT_DIP, type InkLight,
} from './realisticInk'

/**
 * The GPU renderer for realistic magnetic ink and Arc-en-Ciel: one WebGL context for every banknote's, on the canvas and
 * in exports, as browsers allow only a few, with a program for each. It draws a layer at a tilt in its own canvas and
 * copies the result where it goes: a canvas in the layer's box on a banknote (`paintLitInk`, `paintBands`), redrawn only
 * when what it shows changes, or the export's banknote face (`drawLitInk`, `drawBands`). Without WebGL there is nothing to
 * draw them with: the ink keeps its flat look, and Arc-en-Ciel shows its bands at rest, plain with Realistic on too
 * (bandMap.ts).
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
uniform vec2 uRest;
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
  // The magnet's curve across the shape, its middle facing the eye, each flake a little off it
  float phi = (dot(vUv, uAxis) - 0.5) * 2.0 * uEdge + uRest.x;
  vec2 cell = floor(vUv * uRes / uCell);
  vec3 flake = normalize(vec3(uAxis * sin(phi) + uAxis.yx * (tan(uRest.y) * cos(phi)), cos(phi)));
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

const UNIFORMS = ['uMask', 'uRes', 'uCell', 'uRot', 'uOrigin', 'uSize', 'uEye', 'uAxis', 'uEdge', 'uRest', 'uLobe', 'uLamp', 'uDown', 'uFlat', 'uTilted', 'uHue'] as const

/** Spots the bands program takes: Point's starts, or Line's points with a control past each end */
const MAX_SPOTS = Math.max(ARC_POINTS, ARC_LINE_POINTS + 2)

// Every pixel of Arc-en-Ciel's box: how far it is from where the bands start (from the map, the nearest point, or Line),
// slid along by the tilt, gives its place among the bands and so its colour, through the shape's mask. The same sums as
// bandMap.ts's, which draws it without the GPU. With Realistic on (uLit), the ridges instead: each spot across a ridge on
// the slope the eye sees there, in the colour that slope carries, lit by the lamp, and the paper embossed round the shape
// lit the same way over whatever is printed beneath (arcEnCiel.ts's `arcLight`)
const BANDS_FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uMask;
uniform sampler2D uMap;
uniform vec2 uMapSize;
uniform float uMapMax;
uniform int uFrom;
uniform vec2 uBox;
uniform vec2 uSpots[${MAX_SPOTS}];
uniform int uSpotCount;
uniform float uBand;
uniform float uSlide;
uniform vec3 uColours[4];
uniform int uColourCount;
uniform vec3 uAverage;
uniform float uPixel;
uniform int uLit;
uniform sampler2D uEmboss;
uniform vec2 uEmbossSize;
uniform float uEmbossMax;
uniform float uRidge;
uniform vec2 uAcross;
uniform float uShare;
uniform vec3 uLamp;
uniform vec3 uHalf;
uniform vec4 uMeans;

// A map holds 16 bits a texel, its high byte in luminance and its low one in alpha, read whole and blended here, as the
// GPU's own blending would mix the bytes apart
float texelAt(sampler2D map, vec2 size, float top, vec2 at) {
  vec4 t = texture2D(map, (clamp(at, vec2(0.0), size - 1.0) + 0.5) / size);
  return (t.r * 65280.0 + t.a * 255.0) / 65535.0 * top;
}
float fieldAt(sampler2D map, vec2 size, float top, vec2 uv) {
  vec2 p = clamp(uv * size - 0.5, vec2(0.0), size - 1.0);
  vec2 i = floor(p);
  vec2 f = p - i;
  return mix(mix(texelAt(map, size, top, i), texelAt(map, size, top, i + vec2(1.0, 0.0)), f.x),
    mix(texelAt(map, size, top, i + vec2(0.0, 1.0)), texelAt(map, size, top, i + vec2(1.0, 1.0)), f.x), f.y);
}
// How far from the nearest point, and a unit step away from it
float pointsAt(vec2 p, out vec2 away) {
  float best = 1e9;
  away = vec2(0.0);
  for (int i = 0; i < ${ARC_POINTS}; i++) {
    if (i >= uSpotCount) break;
    vec2 v = p - uSpots[i];
    float d = length(v);
    if (d < best) {
      best = d;
      away = v;
    }
  }
  away = best > 1e-6 ? away / best : vec2(0.0);
  return best;
}
// How far from Line, + on one side and - on the other: the curve through its points in CURVE_STEPS straight steps a
// stretch, its first and last steps running on for ever. Also the unit step that adds to it
float lineAt(vec2 p, out vec2 away) {
  float best = 1e9;
  float side = 1.0;
  away = vec2(0.0);
  int last = (uSpotCount - 1) * ${CURVE_STEPS} - 1;
  vec2 a = uSpots[1];
  for (int s = 0; s < ${ARC_LINE_POINTS - 1}; s++) {
    if (s >= uSpotCount - 1) break;
    vec2 p0 = uSpots[s];
    vec2 p1 = uSpots[s + 1];
    vec2 p2 = uSpots[s + 2];
    vec2 p3 = uSpots[s + 3];
    vec2 c1 = 0.5 * (p2 - p0);
    vec2 c2 = 0.5 * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3);
    vec2 c3 = 0.5 * (3.0 * p1 - p0 - 3.0 * p2 + p3);
    for (int k = 1; k <= ${CURVE_STEPS}; k++) {
      float t = float(k) / ${glsl(CURVE_STEPS)};
      vec2 b = p1 + (c1 + (c2 + c3 * t) * t) * t;
      vec2 v = b - a;
      vec2 w = p - a;
      float h = dot(w, v) / max(dot(v, v), 1e-12);
      int at = s * ${CURVE_STEPS} + k - 1;
      if (at > 0) h = max(h, 0.0);
      if (at < last) h = min(h, 1.0);
      vec2 off = w - v * h;
      float d = length(off);
      if (d < best) {
        best = d;
        side = v.x * w.y - v.y * w.x < 0.0 ? -1.0 : 1.0;
        away = off;
      }
      a = b;
    }
  }
  away = best > 1e-6 ? away * side / best : vec2(0.0);
  return best * side;
}
vec3 colourAt(float i) {
  if (i < 0.5) return uColours[0];
  if (i < 1.5) return uColours[1];
  if (i < 2.5) return uColours[2];
  return uColours[3];
}
vec3 nextColour(float i) { return colourAt(i + 1.0 < float(uColourCount) ? i + 1.0 : 0.0); }
// Which band a spot that many bands from where they start falls in, and how far it has blended into the next
float bandAt(float phase, out float blend) {
  float n = float(uColourCount);
  float f = phase - n * floor(phase / n);
  float i = min(floor(f), n - 1.0);
  blend = smoothstep(${glsl(1 - BAND_BLEND)}, 1.0, f - i);
  return i;
}
vec3 encode(vec3 c) { return mix(12.92 * c, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float encode1(float c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
// Paper lit to a light with a sheen on it, drawn over whatever is printed beneath: grey light over a shade, exact over white
// paper and black, close between (premultiplied, as drawn)
vec2 paperAt(float light, float sheen) {
  float w = encode1(sheen);
  return vec2(w, 1.0 - encode1(light + sheen) + w);
}

void main() {
  float m = texture2D(uMask, vUv).a;
  // How far inside the embossed area, up to a pixel
  float e = uLit == 1 ? clamp(fieldAt(uEmboss, uEmbossSize, uEmbossMax, vUv) * uBox.x / uPixel, 0.0, 1.0) : 0.0;
  if (m < 0.002 && e < 0.002) { gl_FragColor = vec4(0.0); return; }
  vec2 p = vUv * uBox;
  float d = 0.0;
  // Point's and Line's unit step on through the bands
  vec2 away = vec2(0.0);
  if (m >= 0.002) {
    if (uFrom == 0) d = fieldAt(uMap, uMapSize, uMapMax, vUv) * uBox.x;
    else if (uFrom == 1) d = pointsAt(p, away);
    else d = lineAt(p, away);
  }
  float blur = smoothstep(${glsl(BAND_BLUR.from)}, ${glsl(BAND_BLUR.to)}, uPixel / uBand);
  if (uLit == 0) {
    float blend;
    float i = bandAt(d / uBand - uSlide, blend);
    vec3 colour = mix(mix(colourAt(i), nextColour(i), blend), uAverage, blur);
    gl_FragColor = vec4(encode(colour) * m, m);
    return;
  }
  // Each ridge: the slope facing away from uAcross carries the band half a band on, the other the band half a band back
  float phase = d / uBand;
  float riseBlend;
  float fallBlend;
  float rise = bandAt(phase + 0.5, riseBlend);
  float fall = bandAt(phase - 0.5, fallBlend);
  vec3 rise0 = mix(colourAt(rise), uAverage, blur);
  vec3 rise1 = mix(nextColour(rise), uAverage, blur);
  vec3 fall0 = mix(colourAt(fall), uAverage, blur);
  vec3 fall1 = mix(nextColour(fall), uAverage, blur);
  // How much of each ridge the first slope shows on screen, and how wide a pixel is, in ridges
  float c = 0.5 - 0.5 * uShare;
  float w = uPixel / uRidge;
  // How fast the bands move on across the ridges, a mm a mm, so each printed line takes its band and blend from its own
  // middle: taken spot by spot, a line that a blend runs along would be at the blend's edge right across, and smudge
  float rate = dot(away, uAcross);
  if (uFrom == 0) {
    vec2 h = 0.25 * uRidge * uAcross / uBox;
    rate = (fieldAt(uMap, uMapSize, uMapMax, vUv + h) - fieldAt(uMap, uMapSize, uMapMax, vUv - h)) * uBox.x / (0.5 * uRidge);
  }
  rate = clamp(rate, -1.0, 1.0);
  float fine = smoothstep(${glsl(ARC_RIDGE_FADE.from)}, ${glsl(ARC_RIDGE_FADE.to)}, w);
  vec3 ink = vec3(0.0);
  vec2 paper = vec2(0.0);
  if (fine < 1.0) {
    // Ridges wide enough to see: a few spots across the pixel, each on the slope the eye sees there
    float q0 = dot(p, uAcross) / uRidge;
    // Half as wide again as the pixel, so ridges a few pixels apart don't beat against them
    float span = min(1.5 * w, 1.0);
    for (int k = 0; k < ${ARC_RIDGE_SAMPLES}; k++) {
      float s = span * ((float(k) + 0.5) / ${glsl(ARC_RIDGE_SAMPLES)} - 0.5);
      float q = fract(q0 + s);
      bool first = q < c;
      // Where on the ridge: 0 and 1 the bottoms of its grooves, 0.5 its crest
      float at = first ? 0.5 * q / max(c, 1e-4) : 0.5 + 0.5 * (q - c) / max(1.0 - c, 1e-4);
      float beta = atan(${glsl(Math.tan((ARC_RIDGE_SLOPE_DEG * Math.PI) / 180))} * sin(6.28318531 * at));
      vec3 n = vec3(-uAcross * sin(beta), cos(beta));
      float groove = min(at, 1.0 - at) / ${glsl(ARC_GROOVE.width)};
      float lamp = max(0.0, (dot(n, uLamp) + ${glsl(ARC_LIGHT.wrap)}) / ${glsl(1 + ARC_LIGHT.wrap)});
      float shade = min((${glsl(ARC_LIGHT.room)} + ${glsl(ARC_LIGHT.lamp)} * lamp) / ${glsl(ARC_FLAT_LIGHT)}, 1.0)
        * (1.0 - ${glsl(ARC_GROOVE.dark)} * exp(-groove * groove));
      float sheen = ${glsl(ARC_SHEEN.strength)} * pow(max(dot(n, uHalf), 0.0), ${glsl(ARC_SHEEN.power)});
      // The slope's line, from the groove (0) to the crest (1), and its band at its middle, a ridge of s + mid - q from
      // the pixel's: a blend prints the next colour on the share nearest the crest
      float up = first ? 2.0 * at : 2.0 - 2.0 * at;
      float mid = first ? 0.5 * c : 0.5 + 0.5 * c;
      float blend;
      float band = bandAt((d + rate * (s + mid - q) * uRidge) / uBand + (first ? 0.5 : -0.5), blend);
      vec3 colour = mix(up >= 1.0 - blend ? nextColour(band) : colourAt(band), uAverage, blur);
      float light = shade * (1.0 - sheen);
      ink += colour * light + sheen;
      paper += paperAt(light, sheen);
    }
    ink /= ${glsl(ARC_RIDGE_SAMPLES)};
    paper /= ${glsl(ARC_RIDGE_SAMPLES)};
  }
  // Ridges too fine to tell apart: each slope's average light over as much of each ridge as it shows
  vec3 inkMean = c * (mix(rise0, rise1, riseBlend) * uMeans.x + uMeans.y) + (1.0 - c) * (mix(fall0, fall1, fallBlend) * uMeans.z + uMeans.w);
  vec2 paperMean = paperAt(c * uMeans.x + (1.0 - c) * uMeans.z, c * uMeans.y + (1.0 - c) * uMeans.w);
  ink = mix(ink, inkMean, fine);
  paper = mix(paper, paperMean, fine);
  // The ink where the shape takes it; the paper's light and shade round it, where the plate embosses
  float bare = (1.0 - m) * e;
  gl_FragColor = vec4(encode(ink) * m + vec3(paper.x * bare), m + paper.y * bare);
}`

const BAND_UNIFORMS = [
  'uMask', 'uMap', 'uMapSize', 'uMapMax', 'uFrom', 'uBox', 'uSpots', 'uSpotCount', 'uBand', 'uSlide', 'uColours', 'uColourCount', 'uAverage', 'uPixel',
  'uLit', 'uEmboss', 'uEmbossSize', 'uEmbossMax', 'uRidge', 'uAcross', 'uShare', 'uLamp', 'uHalf', 'uMeans',
] as const

type GL = WebGLRenderingContext | WebGL2RenderingContext
/** A mask the ink is drawn through: its alpha is how much ink each pixel takes */
export type MaskSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** A program and where its uniforms are */
interface Program<U extends string> {
  program: WebGLProgram
  uniforms: Record<U, WebGLUniformLocation | null>
}

interface Renderer {
  canvas: HTMLCanvasElement
  gl: GL
  /** WebGL 2 makes mipmaps of masks of any size, so a big mask drawn small keeps a smooth edge */
  anySizeMipmaps: boolean
  /** The largest texture, and the largest drawing */
  maxTexture: number
  maxDraw: number
  /** Realistic magnetic ink's program, and Arc-en-Ciel's: each missing if this GPU can't run it */
  ink?: Program<(typeof UNIFORMS)[number]>
  bands?: Program<(typeof BAND_UNIFORMS)[number]>
  /** Masks on the GPU, the latest used last */
  textures: Map<MaskSource, WebGLTexture>
  /** Arc-en-Ciel's maps on the GPU, the latest used last */
  maps: Map<BandField, WebGLTexture>
  /** An empty map, for bands that need none */
  noMap?: WebGLTexture
  lost: boolean
}

/** Masks kept on the GPU: every banknote's on the canvas and an export's */
const TEXTURES_KEPT = 4
/** Maps kept on the GPU: each Arc-en-Ciel's bands' and, with Realistic on, its embossed area's */
const MAPS_KEPT = 8

let renderer: Renderer | null | undefined

function compile(gl: GL, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : undefined
}

/** A program from the shared vertex shader and `fragment`, its square's corners always at attribute 0 */
function link<U extends string>(gl: GL, fragment: string, uniforms: readonly U[]): Program<U> | undefined {
  const vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragment)
  const program = gl.createProgram()
  if (!vertexShader || !fragmentShader || !program) return undefined
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.bindAttribLocation(program, 0, 'aPos')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined
  return { program, uniforms: Object.fromEntries(uniforms.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<U, WebGLUniformLocation | null> }
}

/**
 * The programs and the square they draw on: again after the context is lost and restored, when the GPU has forgotten
 * them. False when neither program runs here
 */
function prepare(r: Renderer) {
  const { gl } = r
  r.ink = link(gl, FRAGMENT, UNIFORMS)
  r.bands = link(gl, BANDS_FRAGMENT, BAND_UNIFORMS)
  if (!r.ink && !r.bands) return false
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  r.textures.clear()
  r.maps.clear()
  r.noMap = gl.createTexture() ?? undefined
  if (r.noMap) {
    gl.bindTexture(gl.TEXTURE_2D, r.noMap)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, 1, 1, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, new Uint8Array(2))
    nearest(gl)
  }
  return true
}

/** Read texel by texel, never blended, and never repeated past the edges */
function nearest(gl: GL) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
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
    textures: new Map(),
    maps: new Map(),
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
export const litInkAvailable = () => !!inkRenderer()?.ink

const isPowerOfTwo = (n: number) => (n & (n - 1)) === 0

/**
 * The pixels a layer is drawn with, `size` up to the largest drawing; the canvas only grows, in steps, so layers of
 * different sizes don't keep resizing it, and each draws in its bottom-left corner
 */
function drawingSize(r: Renderer, size: { width: number; height: number }) {
  const { canvas } = r
  const width = Math.max(1, Math.min(Math.round(size.width), r.maxDraw))
  const height = Math.max(1, Math.min(Math.round(size.height), r.maxDraw))
  if (canvas.width < width || canvas.height < height) {
    const step = (n: number) => Math.min(r.maxDraw, Math.ceil(n / 256) * 256)
    canvas.width = Math.max(canvas.width, step(width))
    canvas.height = Math.max(canvas.height, step(height))
  }
  return { width, height }
}

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
  const ink = r?.ink
  if (!r || r.lost || !ink) return false
  const { gl, canvas } = r
  const u = (name: (typeof UNIFORMS)[number]) => ink.uniforms[name]
  const { width, height } = drawingSize(r, size)
  const texture = textureFor(r, mask)
  if (!texture) return false
  gl.useProgram(ink.program)
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
  gl.uniform2f(u('uRest'), ...light.rest)
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

/** Whether Arc-en-Ciel's bands can be drawn here, sliding as the banknote tilts: the browser has WebGL */
export const bandsAvailable = () => !!inkRenderer()?.bands

/** An Arc-en-Ciel map on the GPU, put there once, its distances as 16 bits a texel (`texelAt` reads them back) */
function mapFor(r: Renderer, field: BandField) {
  const kept = r.maps.get(field)
  if (kept) {
    r.maps.delete(field)
    r.maps.set(field, kept)
    return kept
  }
  const { gl } = r
  const { width, height, data, max } = field
  if (width < 1 || height < 1 || width > r.maxTexture || height > r.maxTexture) return undefined
  const bytes = new Uint8Array(width * height * 2)
  const k = max > 0 ? 65535 / max : 0
  for (let i = 0; i < data.length; i++) {
    const v = Math.min(65535, Math.max(0, Math.round(data[i] * k)))
    bytes[i * 2] = v >> 8
    bytes[i * 2 + 1] = v & 255
  }
  const texture = gl.createTexture()
  if (!texture) return undefined
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, width, height, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, bytes)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  nearest(gl)
  r.maps.set(field, texture)
  for (const [old, oldTexture] of r.maps) {
    if (r.maps.size <= MAPS_KEPT) break
    gl.deleteTexture(oldTexture)
    r.maps.delete(old)
  }
  return texture
}

/**
 * Draws Arc-en-Ciel as `look` has it through `mask` at `size` pixels onto `target` at `dest`. False when it can't (no
 * WebGL, or the context is lost), having drawn nothing.
 */
export function drawBands(
  target: Ctx,
  dest: { x: number; y: number; width: number; height: number },
  mask: MaskSource,
  look: BandLook,
  size: { width: number; height: number },
) {
  const r = inkRenderer()
  const bands = r?.bands
  if (!r || r.lost || !bands) return false
  const { gl, canvas } = r
  const u = (name: (typeof BAND_UNIFORMS)[number]) => bands.uniforms[name]
  const { width, height } = drawingSize(r, size)
  const texture = textureFor(r, mask)
  const map = look.field ? mapFor(r, look.field) : r.noMap
  const { lit } = look
  const embossed = lit ? look.emboss : undefined
  const emboss = embossed ? mapFor(r, embossed) : r.noMap
  if (!texture || !map || !emboss) return false
  gl.useProgram(bands.program)
  gl.viewport(0, 0, width, height)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.uniform1i(u('uMask'), 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, map)
  gl.uniform1i(u('uMap'), 1)
  gl.activeTexture(gl.TEXTURE2)
  gl.bindTexture(gl.TEXTURE_2D, emboss)
  gl.uniform1i(u('uEmboss'), 2)
  gl.activeTexture(gl.TEXTURE0)
  gl.uniform2f(u('uMapSize'), look.field?.width ?? 1, look.field?.height ?? 1)
  gl.uniform1f(u('uMapMax'), look.field?.max ?? 0)
  gl.uniform1i(u('uFrom'), look.from === 'map' ? 0 : look.from === 'point' ? 1 : 2)
  gl.uniform2f(u('uBox'), ...look.box)
  const spots = new Float32Array(MAX_SPOTS * 2)
  look.spots.slice(0, MAX_SPOTS).forEach(([x, y], i) => spots.set([x, y], i * 2))
  gl.uniform2fv(u('uSpots'), spots)
  // Line's controls include one past each end
  gl.uniform1i(u('uSpotCount'), look.from === 'line' ? look.spots.length - 2 : look.spots.length)
  gl.uniform1f(u('uBand'), look.bandMm)
  gl.uniform1f(u('uSlide'), look.slide)
  const colours = new Float32Array(12)
  look.colours.slice(0, 4).forEach((c, i) => colours.set(c, i * 3))
  gl.uniform3fv(u('uColours'), colours)
  gl.uniform1i(u('uColourCount'), Math.min(4, look.colours.length))
  gl.uniform3f(u('uAverage'), ...averageRgb(look.colours))
  gl.uniform1f(u('uPixel'), look.box[0] / width)
  // Realistic: the ridges in the lamp's light, and the area embossed round the shape
  gl.uniform1i(u('uLit'), lit ? 1 : 0)
  gl.uniform2f(u('uEmbossSize'), embossed?.width ?? 1, embossed?.height ?? 1)
  gl.uniform1f(u('uEmbossMax'), embossed?.max ?? 0)
  gl.uniform1f(u('uRidge'), ARC_RIDGE_MM)
  gl.uniform2f(u('uAcross'), ...(lit?.across ?? [0, 1]))
  gl.uniform1f(u('uShare'), lit?.share ?? 0)
  gl.uniform3f(u('uLamp'), ...(lit?.lamp ?? [0, 0, 1]))
  gl.uniform3f(u('uHalf'), ...(lit?.half ?? [0, 0, 1]))
  gl.uniform4f(u('uMeans'), ...(lit?.means ?? [1, 0, 1, 0]))
  // Every pixel of it is drawn, clear ones too, so there is nothing to clear first
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  target.drawImage(canvas, 0, canvas.height - height, width, height, dest.x, dest.y, dest.width, dest.height)
  return true
}

/** What each Arc-en-Ciel canvas last showed, so a tilt that doesn't change it doesn't draw it again */
const bandsPainted = new WeakMap<HTMLCanvasElement, { mask: MaskSource; field?: BandField; emboss?: BandField; key: string }>()

/**
 * Draws Arc-en-Ciel into a canvas of its own, in place of what it showed, at the canvas's own size. Nothing is drawn when
 * it would show the same again. False when it can't be drawn on the GPU (no WebGL).
 */
export function paintBands(canvas: HTMLCanvasElement, mask: MaskSource, look: BandLook) {
  const { field, emboss, ...rest } = look
  const key = `${canvas.width}×${canvas.height}|${JSON.stringify(rest)}`
  const last = bandsPainted.get(canvas)
  if (last?.mask === mask && last.field === field && last.emboss === emboss && last.key === key) return true
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.globalCompositeOperation = 'copy'
  const drawn = drawBands(ctx, { x: 0, y: 0, width: canvas.width, height: canvas.height }, mask, look, canvas)
  if (drawn) bandsPainted.set(canvas, { mask, field, emboss, key })
  return drawn
}
