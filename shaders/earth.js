import { COMMON, VARYINGS } from './common.js';

// Land and ocean are shaded as different materials, split by the water mask:
// land is rough Lambert lit through a relief normal derived from the elevation
// map; ocean is a low-albedo dielectric with animated swell, Fresnel sky
// reflection and a GGX sun glint. Cloud shadow, the moon's shadow and limb
// haze go on top.
export const earthFrag = COMMON + /* glsl */`
    uniform sampler2D dayMap, nightMap, waterMap, elevMap, cloudMap;
    uniform vec3 sunDir, sunPos, moonPos;
    uniform float sunTrueR, moonR, cloudT, waveT, waveFade, cloudOn;
    ${VARYINGS}

    const vec3 SUN  = vec3(1.0, 0.97, 0.92);
    const vec3 SKY  = vec3(0.20, 0.40, 0.85);
    const vec3 DUSK = vec3(1.0, 0.40, 0.13);

    // Slope of one scrolling swell octave, in (east, north) tangent units.
    vec2 swell(vec2 uv, float freq, float t, vec2 dir) {
      vec2 per = vec2(freq, freq * 0.5);
      vec2 p = vec2(uv.x * freq, uv.y * freq * 0.5) + dir * t;
      const float e = 0.09;
      float n = pnoise(p, per);
      return vec2(pnoise(p + vec2(e, 0.0), per) - n,
                  pnoise(p + vec2(0.0, e), per) - n) / e;
    }

    void main() {
      vec3 L = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
      vec3 V = normalize(vView);
      vec3 N = normalize(vN), T = normalize(vT), B = normalize(vB);

      float water = texture2D(waterMap, vUv).r;
      float land  = 1.0 - water;

      // Relief normal: central differences on the elevation map, land only —
      // the ocean floor must not bumpify the sea surface.
      vec2 px = vec2(1.0 / 4096.0, 1.0 / 2048.0);
      float dU = texture2D(elevMap, vUv + vec2(px.x, 0.0)).r - texture2D(elevMap, vUv - vec2(px.x, 0.0)).r;
      float dV = texture2D(elevMap, vUv + vec2(0.0, px.y)).r - texture2D(elevMap, vUv - vec2(0.0, px.y)).r;
      vec3 Nb = normalize(N - (dU * T + dV * B) * 9.0 * land);

      // Two crossing swell trains, faded out at distance so they cannot alias.
      vec2 g = swell(vUv, 320.0, waveT, vec2(1.0, 0.35)) * 0.8
             + swell(vUv,  96.0, waveT * 0.45, vec2(-0.7, 0.5)) * 1.5;
      Nb = normalize(Nb - (g.x * T + g.y * B) * 0.011 * water * waveFade);

      float geo  = dot(N, L);                          // sphere-level sun angle
      float limb = smoothstep(-0.05, 0.09, geo);       // soft terminator
      float NoL  = max(dot(Nb, L), 0.0);
      float NoV  = max(dot(N, V), 0.0);

      // Solar eclipse: the moon's shadow, umbra and penumbra alike.
      float sunlight = 1.0 - 0.985 * occult(vWorld, sunPos, sunTrueR, moonPos, moonR);
      float lit = NoL * limb * sunlight;

      float cover = cloudCover(cloudMap, vUv, cloudT) * cloudOn;
      float cshadow = 1.0 - cloudOn * 0.5 *
        cloudCover(cloudMap, vUv + vec2(dot(L, T), dot(L, B)) * 0.010, cloudT);

      vec3 albedo = texture2D(dayMap, vUv).rgb;
      float elev  = texture2D(elevMap, vUv).r;

      // ── land ──
      vec3 landCol = albedo * lit * cshadow * 1.15;

      // ── ocean ──
      // Blue Marble's ocean is near-black albedo, so open water gets its colour
      // from depth-tinted scattering rather than from the texture.
      vec3 deep    = vec3(0.0045, 0.0180, 0.0520);
      vec3 shallow = vec3(0.0300, 0.1150, 0.1600);
      vec3 wAlb = mix(deep, shallow, smoothstep(0.10, 0.36, elev)) + albedo * 0.45;

      // Roughness drifts with the wind field, which makes the glint sparkle.
      float chop = mix(0.075, 0.155,
        pnoise(vec2(vUv.x * 256.0 + waveT * 0.6, vUv.y * 128.0), vec2(256.0, 128.0)) * 0.6 +
        pnoise(vec2(vUv.x * 64.0 - waveT * 0.2, vUv.y * 32.0), vec2(64.0, 32.0)) * 0.4);

      vec3  H     = normalize(L + V);
      float NoH   = max(dot(Nb, H), 0.0);
      float fres  = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
      float glint = ggx(NoH, chop) * fres / (4.0 * NoV + 0.05);

      vec3 oceanCol = wAlb * lit * cshadow
                    + SUN * min(glint * NoL * limb * sunlight, 6.0) * 0.9
                    + SKY * fres * (0.05 + 0.55 * limb * sunlight);

      vec3 color = mix(landCol, oceanCol, water);

      // Rayleigh haze in the column of air we are looking through: strongest at
      // the limb, and reddened where that column is grazing the terminator.
      float haze = pow(1.0 - NoV, 3.0);
      float dusk = exp(-geo * geo / 0.010);
      color += mix(SKY, DUSK, dusk * 0.85) * haze * limb * sunlight * 0.55;
      color += DUSK * dusk * limb * 0.05 * (0.3 + 0.7 * water);

      // ── night side ──
      float night = smoothstep(0.10, -0.14, geo);
      vec3 lights = max(texture2D(nightMap, vUv).rgb - 0.045, 0.0) * 1.6;
      color += lights * night * (1.0 - cover * 0.65);
      color += albedo * 0.012 * night;                   // earthshine

      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
