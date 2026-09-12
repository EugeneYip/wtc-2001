/**
 * The sky after the sun has gone.
 *
 * The Preetham model the daytime sky uses is only defined for a sun above the
 * horizon; push it below and it turns a muddy brown. The first version of this
 * viewer dealt with that by switching the sky mesh off at a fixed elevation and
 * painting a flat navy behind the city, which meant dusk ended in a hard cut —
 * a full sunset one frame, a dead black field the next.
 *
 * So this is a second dome that fades in over the first. It carries the things
 * that actually make a night sky over a city: a gradient that is darkest
 * overhead, the sodium dome of the city's own light hugging the horizon all the
 * way round, the warm twilight arch left in the sun's quarter of the sky, and
 * a handful of stars faint enough to be washed out near the ground the way they
 * really are here.
 *
 * It draws before everything else with no depth test, so it simply covers the
 * daytime dome once it is opaque.
 */

import * as THREE from 'three';

const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  varying vec3 vDir;

  uniform vec3  uSunDir;      // may be below the horizon
  uniform float uOpacity;     // 0 in daylight, 1 in full night
  uniform vec3  uZenith;
  uniform vec3  uHorizon;
  uniform vec3  uGlow;        // the city's own light, all around the horizon
  uniform float uGlowAmt;
  uniform vec3  uTwilight;
  uniform float uTwilightAmt;
  uniform float uStars;

  float hash( vec3 p ) {
    p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
    p *= 17.0;
    return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
  }

  // Sparse points on a cell grid, each with its own offset and magnitude.
  float stars( vec3 d ) {
    vec3 p = d * 190.0;
    vec3 i = floor( p );
    vec3 f = fract( p ) - 0.5;
    float h = hash( i );
    float here = step( 0.9928, h );
    vec3 off = vec3( hash( i + 1.7 ), hash( i + 4.3 ), hash( i + 8.9 ) ) - 0.5;
    float r = length( f - off * 0.7 );
    float mag = 0.30 + 0.70 * fract( h * 311.0 );
    return here * mag * exp( - r * r * 120.0 );
  }

  void main() {
    vec3 d = normalize( vDir );
    float up = d.y;

    // Darkest overhead, lightest at the horizon, and falling away again below
    // it — the dome shows under the horizon only past the far shore.
    float t = pow( clamp( 1.0 - max( up, 0.0 ), 0.0, 1.0 ), 4.0 );
    vec3 col = mix( uZenith, uHorizon, t );
    col *= 1.0 - 0.55 * smoothstep( 0.0, -0.08, up );

    // Stars, thinned out into the skyglow near the horizon.
    col += vec3( 0.72, 0.78, 1.0 ) * stars( d ) * uStars *
           smoothstep( 0.02, 0.38, up );

    // The city's light dome. Tight to the horizon, and everywhere along it.
    col += uGlow * uGlowAmt * exp( - max( up, 0.0 ) * 11.0 ) *
           smoothstep( -0.12, 0.02, up );

    // What is left of the sunset, in the sun's quarter of the sky.
    vec3 sunAz = normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) );
    float az = max( dot( normalize( vec3( d.x, 0.0, d.z ) ), sunAz ), 0.0 );
    float arch = pow( az, 3.5 ) * exp( - max( up, 0.0 ) * 7.0 ) *
                 smoothstep( -0.10, 0.03, up );
    col += uTwilight * uTwilightAmt * arch;

    gl_FragColor = vec4( col, uOpacity );
  }
`;

export function makeNightSky(radius = 16000) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, -1, 0) },
      uOpacity: { value: 0 },
      uZenith: { value: new THREE.Color(0x05070f) },
      uHorizon: { value: new THREE.Color(0x14203a) },
      uGlow: { value: new THREE.Color(0xff9b4a) },
      uGlowAmt: { value: 0 },
      uTwilight: { value: new THREE.Color(0xff7a33) },
      uTwilightAmt: { value: 0 },
      uStars: { value: 0 },
    },
    side: THREE.BackSide,
    // Blended, but deliberately not `transparent`. A transparent material goes
    // into the render list that is drawn after all the opaque geometry, so with
    // the depth test off this dome painted straight over the city — which at
    // full opacity meant an empty black frame. Custom blending keeps it in the
    // opaque list, where renderOrder puts it between the daytime dome and
    // everything else.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), mat);
  mesh.name = 'nightSky';
  // After the daytime dome (which main.js puts at -2), before the city.
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
