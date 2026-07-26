import { COMMON, VARYINGS } from './common.js';

// The cloud shell samples the same cloudCover() the surface uses for its shadow
// lookup, so a system and the shadow it casts never drift apart.
export const cloudsFrag = COMMON + /* glsl */`
      uniform sampler2D cloudMap;
      uniform vec3 sunDir, sunPos, moonPos;
      uniform float sunTrueR, moonR, cloudT;
      ${VARYINGS}
      void main() {
        float a = cloudCover(cloudMap, vUv, cloudT);
        if (a < 0.004) discard;
        vec3 L = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
        vec3 N = normalize(vN), V = normalize(vView);
        float geo = dot(N, L);
        float sunlight = 1.0 - 0.985 * occult(vWorld, sunPos, sunTrueR, moonPos, moonR);
        float lit = smoothstep(-0.12, 0.30, geo) * sunlight;
        // Forward scattering gives thin cloud a silver edge near the limb.
        float silver = pow(max(dot(V, -L), 0.0), 6.0) * lit;
        vec3 color = mix(vec3(0.012, 0.020, 0.035), vec3(0.97, 0.98, 1.0), lit);
        color += vec3(1.0, 0.55, 0.25) * exp(-geo * geo / 0.014) * 0.45 * sunlight;
        color += vec3(0.9, 0.95, 1.0) * silver * 0.35;
        gl_FragColor = vec4(color, a * 0.95);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
