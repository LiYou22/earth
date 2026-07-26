// Low-precision Keplerian ephemeris for the earth-moon-sun system, referred to
// J2000 and good to a fraction of a degree — enough that phases, seasons and
// eclipse seasons all land on the right day.
//
// Deliberately free of three.js: everything here is plain numbers and [x,y,z]
// arrays, so it can be unit-tested in node without a WebGL context.
//
// Frame: the J2000 ecliptic. +Y is ecliptic north, +X points at the vernal
// equinox, and ecliptic longitude increases as a positive rotation about +Y,
// which maps longitude L to (cos L, 0, -sin L).

export const RE_KM      = 6371.0;
export const AXIAL_TILT = 23.4393 * Math.PI / 180;
export const DAY        = 86400;              // mean solar day
export const SIDEREAL   = 86164.0905;         // one rotation w.r.t. the stars
export const TAU        = Math.PI * 2;
export const DEG        = Math.PI / 180;

export const R_MOON = 0.27245;                // lunar radius, earth radii
export const A_MOON = 60.334;                 // semi-major axis, earth radii
export const E_MOON = 0.0549;
export const I_MOON = 5.145 * DEG;

// The real sun is 23,481 earth radii away, which no depth buffer will tolerate
// alongside a unit-radius planet. It is drawn much closer with its radius cut
// by the same factor, so its angular size — and therefore every shadow cone in
// the system — stays correct.
export const SUN_DIST  = 3000;
export const SUN_RATIO = 0.0046524;           // solar radius / 1 AU
export const SUN_R     = SUN_DIST * SUN_RATIO;

export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

// Terrestrial Time runs ahead of UT1; the ephemerides below want TT while
// earth's rotation wants UT1 ≈ UTC. Callers add this to their UTC day number.
export const TT_OFFSET_DAYS = 69.2 / 86400;

// ── small vector helpers ──────────────────────────────────────────────────
const sub   = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot   = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len   = (a)    => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm  = (a)    => { const l = len(a); return l ? scale(a, 1 / l) : [0, 0, 0]; };
const crossY = (a, b) => a[2] * b[0] - a[0] * b[2];   // only the Y component
const smoothstep = (x, e0, e1) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const kepler = (M, e) => {
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
};

export const trueAnomaly = (E, e) =>
  2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

// ── sun ───────────────────────────────────────────────────────────────────
// Geocentric sun: the reflection of earth's own orbit, so its eccentricity is
// what makes the seasons unequal in length. Returns the unit direction, the
// scene-space position, the true and mean longitudes and the mean anomaly —
// the last two feed the moon's perturbation series.
export function sunEphemeris(d) {
  const M = (357.5291 + 0.98560028 * d) * DEG;
  const w = (282.9404 + 4.70935e-5 * d) * DEG;      // longitude of perihelion
  const e = 0.016709;
  const E = kepler(M, e);
  const lon = trueAnomaly(E, e) + w;
  const rAU = 1 - e * Math.cos(E);
  const unit = [Math.cos(lon), 0, -Math.sin(lon)];
  return { unit, pos: scale(unit, SUN_DIST), rAU, lon, M, meanLon: M + w };
}

// ── moon ──────────────────────────────────────────────────────────────────
// The node regresses on its 18.6-year cycle and perigee advances on its
// 8.85-year one, which is what spaces the eclipse seasons.
//
// A bare two-body solution is not good enough here: the sun's pull shows up as
// evection, variation and the yearly equation, worth up to ~1.3° of longitude
// and several thousand km of range — the difference between a correct eclipse
// magnitude and a wrong one. Truncated Schlyter series below.
export function moonEphemeris(d, sunM, sunMeanLon) {
  const L  = (218.3165 + 13.17639648 * d) * DEG;    // mean longitude
  const M  = (134.9634 + 13.06499295 * d) * DEG;    // mean anomaly
  const Om = (125.0445 -  0.05295377 * d) * DEG;    // ascending node
  const w  = L - M - Om;                            // argument of perigee
  const E  = kepler(M, E_MOON);
  let   r  = A_MOON * (1 - E_MOON * Math.cos(E));
  const u  = trueAnomaly(E, E_MOON) + w;            // argument of latitude

  const ci = Math.cos(I_MOON), si = Math.sin(I_MOON);
  const cu = Math.cos(u), su = Math.sin(u);
  const xe = r * (Math.cos(Om) * cu - Math.sin(Om) * su * ci);
  const ye = r * (Math.sin(Om) * cu + Math.cos(Om) * su * ci);
  const ze = r * su * si;

  let lon = Math.atan2(ye, xe);
  let lat = Math.atan2(ze, Math.hypot(xe, ye));

  const D = L - sunMeanLon;          // mean elongation
  const F = L - Om;                  // argument of latitude
  const S = Math.sin, C = Math.cos;

  lon += DEG * (
    -1.274 * S(M - 2*D)              // evection
    +0.658 * S(2*D)                  // variation
    -0.186 * S(sunM)                 // yearly equation
    -0.059 * S(2*M - 2*D)
    -0.057 * S(M - 2*D + sunM)
    +0.053 * S(M + 2*D)
    +0.046 * S(2*D - sunM)
    +0.041 * S(M - sunM)
    -0.035 * S(D)                    // parallactic equation
    -0.031 * S(M + sunM)
    -0.015 * S(2*F - 2*D)
    +0.011 * S(M - 4*D)
  );
  lat += DEG * (
    -0.173 * S(F - 2*D)
    -0.055 * S(M - F - 2*D)
    -0.046 * S(M + F - 2*D)
    +0.033 * S(F + 2*D)
    +0.017 * S(2*M + F)
  );
  r += -0.58 * C(M - 2*D) - 0.46 * C(2*D);   // earth radii

  const cl = Math.cos(lat);
  // meanLon stays the UNPERTURBED mean longitude: the moon's rotation locks to
  // it, and the gap between mean and true is exactly the optical libration.
  // lon is the perturbed true longitude, for readouts only.
  return {
    pos: [r * cl * Math.cos(lon), r * Math.sin(lat), -r * cl * Math.sin(lon)],
    r, meanLon: L, lon,
  };
}

// ── eclipse geometry ──────────────────────────────────────────────────────
// Fraction of the sun's disc hidden behind a sphere, seen from point p. Angular
// radii are compared directly, so this covers partial, total and annular alike.
// Mirrors occult() in shaders/common.js so the readout agrees with the pixels.
export function occultation(p, sunP, sunR, occP, occR) {
  const ts = sub(sunP, p), to = sub(occP, p);
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(norm(ts), norm(to)))));
  const rs = Math.asin(Math.min(1, sunR / len(ts)));
  const ro = Math.asin(Math.min(1, occR / len(to)));
  if (sep >= rs + ro) return 0;
  const cov = 1 - smoothstep(sep, Math.abs(ro - rs), ro + rs);
  return cov * Math.min(1, (ro * ro) / (rs * rs));
}

// Where the moon's shadow axis actually meets the globe, rather than the
// geocentre — a grazing polar eclipse is real even when the centre sees none.
// Falls back to the closest point on the surface when the axis misses entirely.
export function shadowProbe(moonP, sunP) {
  const shadow = norm(sub(moonP, sunP));
  const b = dot(moonP, shadow);
  const disc = b * b - (dot(moonP, moonP) - 1);
  const t = disc >= 0 ? -b - Math.sqrt(disc) : -b;
  const hit = [moonP[0] + shadow[0] * t, moonP[1] + shadow[1] * t, moonP[2] + shadow[2] * t];
  return disc >= 0 ? hit : norm(hit);
}

// ── phase ─────────────────────────────────────────────────────────────────
// Elongation from the actual position vectors, so the phase name cannot drift
// out of step with the illuminated fraction. The cross product's Y component
// recovers the waxing/waning sign.
export function elongation(sunUnit, moonP) {
  const m = norm(moonP);
  const e = Math.atan2(crossY(sunUnit, m), dot(sunUnit, m));
  return e < 0 ? e + TAU : e;
}

// Illuminated fraction, from the sun-moon-earth angle at the moon.
export function illuminatedFraction(sunP, moonP) {
  const toSun = norm(sub(sunP, moonP));
  const toEarth = norm(scale(moonP, -1));
  return 0.5 * (1 + dot(toSun, toEarth));
}

// Greenwich mean sidereal time as a rotation angle, from seconds past J2000.
// Driving the spin with this makes the 24h solar day fall out on its own.
export const gmst = (tSeconds) => (280.4606 * DEG) + (tSeconds / SIDEREAL) * TAU;
