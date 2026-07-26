# Earth

A real-time Earth–Moon–Sun simulation in three.js, rendered with custom GLSL and
driven by a hand-rolled Keplerian ephemeris. The clock starts at the wall clock,
so the phase, season and terminator on screen are the ones outside the window.

## Running

ES modules cannot be imported over `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

Textures (~9 MB) are pulled from CDNs on first load; the clock is held until
they arrive so a requested timestamp is the one you actually see.

## Controls

| key | |
|---|---|
| drag / scroll | orbit, zoom |
| `space` | pause |
| `[` `]` | time scale, 1× to 32 d/s |
| `c` | clouds |
| `1` `2` `3` | earth · earth–moon · follow moon |
| `t` | jump to now |

Append a timestamp to the URL to jump there and hold: `#2027-08-02T10:07`
(total solar eclipse over Egypt).

## Layout

```
index.html          shell, HUD, styles
main.js             scene assembly, render loop, interaction
ephemeris.js        orbital mechanics — pure, imports nothing
shaders/common.js   periodic noise, eclipse test, cloud field, vertex stage
shaders/            earth.js · clouds.js · atmosphere.js · moon.js · sun.js
```

`ephemeris.js` exchanges plain `[x,y,z]` arrays rather than `Vector3`, so it runs
under Node and can be tested without a WebGL context.

## What it models

Earth is the anchor at the origin; the sun and moon move around it on J2000
Keplerian elements. The moon carries the truncated Schlyter perturbation series
(evection, variation, the yearly equation) and its node regresses on the
18.6-year cycle, which is what spaces the eclipse seasons. Earth spins on
Greenwich mean sidereal time, so the 24-hour solar day falls out on its own, and
the 23.44° obliquity is fixed in the ecliptic frame.

The sun is drawn at 1/8 its true distance with its radius cut by the same factor.
That keeps depth precision usable next to a unit-radius planet while preserving
its angular size — and therefore every shadow cone in the system. Solar and lunar
eclipses both render, the latter in refracted copper.

Surface shading splits land from ocean on a water mask: land is Lambert through a
relief normal off the elevation map, ocean is a low-albedo dielectric with
animated swell, Fresnel sky reflection and a GGX sun glint. Clouds drift along
latitude wind bands and cast shadows that stay pinned beneath them. The
atmosphere measures each ray's closest approach to the planet rather than using a
fresnel term, so the glow hugs the limb instead of floating off it.

### Accuracy

Checked against published eclipse geometry — mean shadow-axis γ error **0.0142**
earth radii over eleven eclipses from 2021 to 2028 (2028-01-26: 0.3911 vs 0.3901;
2024-10-02: 0.3541 vs 0.3509). Good to a fraction of a degree: enough that
phases, seasons and eclipse seasons land on the right day, not an almanac.

## Credits

Imagery from NASA Blue Marble via [three-globe][tg], elevation, ocean mask and
clouds from [turban/webgl-earth][tb], lunar maps from
[jeromeetienne/threex.planets][tx], and city lights from the
[three.js examples][tj].

[tg]: https://github.com/vasturiano/three-globe
[tb]: https://github.com/turban/webgl-earth
[tx]: https://github.com/jeromeetienne/threex.planets
[tj]: https://github.com/mrdoob/three.js
