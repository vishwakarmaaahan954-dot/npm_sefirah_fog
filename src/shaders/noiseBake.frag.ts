export const NOISE_BAKE_FRAGMENT_SHADER = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

vec2 hash22Periodic(vec2 p, float period, float seed) {
  vec2 pm = mod(p, period);
  vec3 p3 = fract(vec3(pm.xyx + seed) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Seamlessly tileable 2D gradient noise
float tileableGnoise(vec2 uv, float period, float seed) {
  vec2 p = uv * period;
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  vec2 ga = normalize(hash22Periodic(i + vec2(0.0, 0.0), period, seed) * 2.0 - 1.0 + 1e-4);
  vec2 gb = normalize(hash22Periodic(i + vec2(1.0, 0.0), period, seed) * 2.0 - 1.0 + 1e-4);
  vec2 gc = normalize(hash22Periodic(i + vec2(0.0, 1.0), period, seed) * 2.0 - 1.0 + 1e-4);
  vec2 gd = normalize(hash22Periodic(i + vec2(1.0, 1.0), period, seed) * 2.0 - 1.0 + 1e-4);

  float va = dot(ga, f - vec2(0.0, 0.0));
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));

  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 0.5 + 0.5;
}

// Seamlessly tileable inverted Worley cellular puff
float tileableWorley(vec2 uv, float period, float seed) {
  vec2 p = uv * period;
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDistSq = 4.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22Periodic(n + g, period, seed);
      vec2 r = g + o - f;
      minDistSq = min(minDistSq, dot(r, r));
    }
  }
  return clamp(1.0 - sqrt(minDistSq) * 0.82, 0.0, 1.0);
}

void main() {
  // R: Macro billowing FBM
  float macroMist =
    tileableGnoise(v_uv, 4.0, 1.7) * 0.50 +
    tileableGnoise(v_uv, 8.0, 5.3) * 0.27 +
    tileableGnoise(v_uv, 16.0, 11.1) * 0.15 +
    tileableGnoise(v_uv, 32.0, 19.4) * 0.08;

  // G: 3-octave cauliflower Worley cloud puffs
  float puffs =
    tileableWorley(v_uv, 4.0, 3.1) * 0.58 +
    tileableWorley(v_uv, 8.0, 9.7) * 0.28 +
    tileableWorley(v_uv, 16.0, 17.3) * 0.14;

  // B: High-frequency wispy edge erosion + atmospheric dust
  float wisps =
    tileableGnoise(v_uv, 12.0, 23.9) * 0.50 +
    tileableGnoise(v_uv, 24.0, 31.7) * 0.30 +
    tileableGnoise(v_uv, 48.0, 41.3) * 0.20;

  // A: Secondary phase-shifted Worley puffs for live billowing morphing
  float morphPuffs =
    tileableWorley(v_uv, 5.0, 53.1) * 0.62 +
    tileableWorley(v_uv, 10.0, 67.4) * 0.38;

  gl_FragColor = vec4(
    clamp(macroMist, 0.0, 1.0),
    clamp(puffs, 0.0, 1.0),
    clamp(wisps, 0.0, 1.0),
    clamp(morphPuffs, 0.0, 1.0)
  );
}
`;