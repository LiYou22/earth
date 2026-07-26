// GLSL shared by more than one material. Kept out of the individual shader
// files so the noise, the eclipse test and the tangent frame have exactly one
// definition — cloudCover() in particular is called by both the cloud mesh and
// the surface's shadow lookup, which is what keeps shadows pinned under their
// clouds.

export const COMMON = /* glsl */`
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Value noise that tiles on BOTH axes; each component of 'period' must be
  // integral. Wrapping y matters as much as x: callers scroll time into both
  // axes, and on an unwrapped axis the coordinate grows without bound until
  // hash()'s sin() runs out of mantissa and the field degenerates into bands.
  // Folding p first is exact here precisely because the noise is periodic.
  float pnoise(vec2 p, vec2 period) {
    p = mod(p, period);
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec2 lo = mod(i, period), hi = mod(i + 1.0, period);
    return mix(mix(hash(vec2(lo.x, lo.y)), hash(vec2(hi.x, lo.y)), f.x),
               mix(hash(vec2(lo.x, hi.y)), hash(vec2(hi.x, hi.y)), f.x), f.y);
  }
  float ggx(float NoH, float rough) {
    float a = rough * rough, a2 = a * a;
    float d = NoH * NoH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * d * d);
  }

  // Fraction of the sun's disc hidden behind a sphere, seen from point p.
  // Angular radii are compared directly, so this covers partial, total and
  // annular alike — which is the whole of eclipse geometry. Mirrored by
  // occultation() in ephemeris.js so the HUD agrees with the pixels.
  float occult(vec3 p, vec3 sunP, float sunR, vec3 occP, float occR) {
    vec3 ts = sunP - p, to = occP - p;
    float sep = acos(clamp(dot(normalize(ts), normalize(to)), -1.0, 1.0));
    float rs = asin(clamp(sunR / length(ts), 0.0, 1.0));
    float ro = asin(clamp(occR / length(to), 0.0, 1.0));
    float cov = 1.0 - smoothstep(abs(ro - rs), ro + rs, sep);
    return cov * min(1.0, (ro * ro) / (rs * rs + 1e-9));
  }

  // ── animated cloud field ────────────────────────────────────────────────
  // Bands slide east or west by latitude (trades, westerlies, polar easterlies)
  // and a drifting domain warp deforms systems as they go, so the layer evolves
  // instead of spinning rigidly.
  vec2 cloudWarp(vec2 uv, float t) {
    float lat = (uv.y - 0.5) * 3.14159265;
    float zonal = -0.15 - 0.60 * cos(lat * 5.5);
    uv.x += zonal * t * 0.055 / max(cos(lat), 0.25);   // uniform angular speed

    vec2 p = vec2(uv.x * 6.0, uv.y * 3.0);
    vec2 w = vec2(pnoise(p + vec2(t * 0.30, 0.0), vec2(6.0, 3.0)),
                  pnoise(p + vec2(3.7, t * 0.24), vec2(6.0, 3.0))) - 0.5;
    vec2 q = vec2(uv.x * 20.0, uv.y * 10.0);
    vec2 w2 = vec2(pnoise(q - vec2(t * 0.85, 0.0), vec2(20.0, 10.0)),
                   pnoise(q + vec2(9.1, t * 0.70), vec2(20.0, 10.0))) - 0.5;
    return uv + w * 0.018 + w2 * 0.004;
  }

  // Cross-fade of two offset copies so cover grows and clears over time.
  float cloudCover(sampler2D tex, vec2 uv, float t) {
    vec2 p = cloudWarp(uv, t);
    float a = texture2D(tex, p).a;
    float b = texture2D(tex, p + vec2(0.023, 0.011)).a;
    float m = pnoise(vec2(uv.x * 4.0 + t * 0.11, uv.y * 2.0 + t * 0.06), vec2(4.0, 2.0));
    return mix(a, max(a * 0.55, b), smoothstep(0.35, 0.8, m) * 0.6);
  }
`;

// Shared vertex stage for every sphere: earth, clouds, moon and sun.
export const VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vN, vT, vB, vView, vWorld, vNW;
  void main() {
    vUv = uv;
    // Equirect UVs run around +Y, so d(pos)/du is analytic — no tangent attribute.
    vec3 t = vec3(position.z, 0.0, -position.x);
    t = length(t) > 1e-4 ? normalize(t) : vec3(1.0, 0.0, 0.0);
    vN = normalize(normalMatrix * normal);
    vT = normalize(normalMatrix * t);
    vB = cross(vN, vT);                 // points north
    vNW = normalize(mat3(modelMatrix) * normal);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

// Every fragment stage that writes a lit colour ends with these two chunks.
export const VARYINGS = /* glsl */`
  varying vec2 vUv;
  varying vec3 vN, vT, vB, vView, vWorld, vNW;`;
