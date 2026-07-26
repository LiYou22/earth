// A fresnel term would peak at this shell's own silhouette, i.e. as a ring
// floating off the limb. Instead each fragment measures its ray's impact
// parameter against the planet and falls off exponentially from the surface,
// so the glow hugs the limb no matter how oversized the proxy sphere is.
//
// That needs neither uv nor a tangent frame, so this stage carries its own
// minimal vertex shader rather than the shared one.

export const atmosphereVert = /* glsl */`
      varying vec3 vP, vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        vC = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }`;

export const atmosphereFrag = /* glsl */`
      uniform vec3 sunDir;
      varying vec3 vP, vC;
      void main() {
        vec3 D = normalize(vP);                 // camera sits at the view origin
        vec3 P = dot(vC, D) * D;                // closest approach to the centre
        float h = max(length(P - vC) - 1.0, 0.0);
        float glow = exp(-h / 0.020) + 0.45 * exp(-h / 0.070);

        vec3 L = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
        float geo  = dot(normalize(P - vC), L);
        float sun  = smoothstep(-0.25, 0.35, geo);
        float dusk = exp(-geo * geo / 0.012);

        vec3 color = mix(vec3(0.05, 0.14, 0.45), vec3(0.38, 0.62, 1.0), sun);
        color = mix(color, vec3(1.0, 0.42, 0.12), dusk * 0.75);
        gl_FragColor = vec4(color * glow * (0.10 + sun * 1.25 + dusk * 0.8), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
