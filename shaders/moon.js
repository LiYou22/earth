import { COMMON, VARYINGS } from './common.js';

// Lommel-Seeliger rather than Lambert: the regolith backscatters, which is why
// a full moon reads as a flat disc instead of a shaded ball.
export const moonFrag = COMMON + /* glsl */`
      uniform sampler2D moonMap, moonBump;
      uniform vec3 sunPos;
      uniform float sunTrueR;
      ${VARYINGS}
      void main() {
        vec3 L = normalize(sunPos - vWorld);
        vec3 N = normalize(vNW);
        vec3 V = normalize(cameraPosition - vWorld);

        // Crater relief straight off the bump map.
        vec2 px = vec2(1.0 / 1024.0, 1.0 / 512.0);
        float dU = texture2D(moonBump, vUv + vec2(px.x, 0.0)).r - texture2D(moonBump, vUv - vec2(px.x, 0.0)).r;
        float dV = texture2D(moonBump, vUv + vec2(0.0, px.y)).r - texture2D(moonBump, vUv - vec2(0.0, px.y)).r;
        vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5, 0.0, 0.0));
        vec3 Bw = cross(N, Tw);
        vec3 Nb = normalize(N - (dU * Tw + dV * Bw) * 1.2);

        float NoL = max(dot(Nb, L), 0.0);
        float NoV = max(dot(Nb, V), 0.0);
        float shade = NoL / (NoL + NoV + 0.06);        // Lommel-Seeliger
        shade *= smoothstep(-0.03, 0.06, dot(N, L));   // clean terminator

        // Lunar eclipse: the earth crossing in front of the sun. What leaks
        // through is refracted by earth's atmosphere, hence the copper.
        float cov = occult(vWorld, sunPos, sunTrueR, vec3(0.0), 1.0);
        vec3 sunlight = mix(vec3(1.0), vec3(0.42, 0.10, 0.045), cov) * (1.0 - 0.93 * cov);

        vec3 albedo = texture2D(moonMap, vUv).rgb;
        vec3 color = albedo * shade * 2.1 * sunlight;

        // Earthshine on the night side, brightest when earth is near full as
        // seen from the moon — i.e. around new moon.
        vec3 toEarth = normalize(-vWorld);
        float earthPhase = 0.5 * (1.0 - dot(L, toEarth));
        color += albedo * vec3(0.32, 0.44, 0.75) * 0.05 * earthPhase *
                 max(dot(Nb, toEarth), 0.0) * (1.0 - shade);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
