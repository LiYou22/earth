import { VARYINGS } from './common.js';

// The disc itself. Its glare is a canvas-drawn sprite built in main.js, since
// that is a texture rather than a shader.
export const sunFrag = /* glsl */`
      ${VARYINGS}
      void main() {
        float mu = max(dot(normalize(vNW), normalize(cameraPosition - vWorld)), 0.0);
        float limbDark = 0.35 + 0.65 * pow(mu, 0.55);   // classic solar profile
        vec3 color = mix(vec3(1.0, 0.72, 0.36), vec3(1.0, 0.99, 0.96), limbDark) * 4.0;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
