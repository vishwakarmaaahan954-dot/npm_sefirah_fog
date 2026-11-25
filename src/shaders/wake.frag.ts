export const WAKE_FRAGMENT_SHADER = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform sampler2D u_prevWake;
uniform vec2 u_texel;
uniform float u_aspect;
uniform float u_dt;

uniform vec2 u_mouse;
uniform vec2 u_prevMouse;
uniform float u_mouseActive;

// 0 = part, 1 = swirl, 2 = repel, 3 = attract
uniform int u_mode;
uniform float u_radius;
uniform float u_spread;
uniform float u_decayBase;

uniform vec2 u_windVel;
uniform vec2 u_moveDir;
uniform float u_moveSpeed;
uniform float u_wakePower;

// Exact 8-bit midpoint (128/255) prevents quantization drift during decay
const float ZERO_ENC = 128.0 / 255.0;
const float ENC_SCALE = 0.495;

vec2 decodeVel(vec2 rg) {
  return (rg - ZERO_ENC) / ENC_SCALE;
}

vec2 encodeVel(vec2 vel) {
  return clamp(vec2(ZERO_ENC) + vel * ENC_SCALE, 0.0, 1.0);
}

// Returns shortest vector from line segment [a, b] to point p (in aspect-corrected space)
vec2 closestVecFromSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float lenSq = dot(ab, ab);
  if (lenSq < 1e-7) {
    return p - b;
  }
  float segT = clamp(dot(p - a, ab) / lenSq, 0.0, 1.0);
  return p - (a + ab * segT);
}

void main() {
  float dt = clamp(u_dt, 0.001, 0.05);

  // 1. Advect previous wake along global wind so trails drift naturally with the fog
  vec2 sampleUv = v_uv - u_windVel * dt;

  // Read center wake state and apply gentle self-advection only where velocity is non-zero
  vec4 centerRaw = texture2D(u_prevWake, clamp(sampleUv, 0.0, 1.0));
  vec2 centerVel = decodeVel(centerRaw.rg);
  vec2 advectedUv = sampleUv;
  vec4 c = centerRaw;

  if (dot(centerVel, centerVel) > 1e-6) {
    advectedUv = sampleUv - centerVel * (0.018 * (0.35 + u_spread) * dt);
    c = texture2D(u_prevWake, clamp(advectedUv, 0.0, 1.0));
  }

  // 2. Outward spread (4-tap bilinear Kawase/tent diffusion scaled by u_spread)
  vec2 vel = decodeVel(c.rg);
  float clearMask = c.b;
  float energy = c.a;

  if (u_spread > 0.005) {
    vec2 offset = u_texel * (0.5 + u_spread * 2.1);
    vec4 d1 = texture2D(u_prevWake, clamp(advectedUv + vec2( offset.x,  offset.y), 0.0, 1.0));
    vec4 d2 = texture2D(u_prevWake, clamp(advectedUv + vec2(-offset.x,  offset.y), 0.0, 1.0));
    vec4 d3 = texture2D(u_prevWake, clamp(advectedUv + vec2( offset.x, -offset.y), 0.0, 1.0));
    vec4 d4 = texture2D(u_prevWake, clamp(advectedUv + vec2(-offset.x, -offset.y), 0.0, 1.0));

    vec4 blurred = (c * 2.0 + d1 + d2 + d3 + d4) * (1.0 / 6.0);
    float spreadMix = clamp(u_spread * dt * 26.0, 0.0, 0.92);

    vel = mix(vel, decodeVel(blurred.rg), spreadMix);
    clearMask = mix(clearMask, blurred.b, min(spreadMix * 1.05, 1.0));
    energy = mix(energy, blurred.a, spreadMix * 0.9);

    // Slight outward dilation of clearing edges so parted holes bloom softly before healing
    float neighborClearMax = max(max(d1.b, d2.b), max(d3.b, d4.b));
    clearMask = mix(clearMask, max(clearMask, neighborClearMax * 0.94), clamp(u_spread * dt * 6.5, 0.0, 1.0));
  }

  // 3. Disappearance after motion (exponential healing back to calm state)
  float velDecay = exp(-u_decayBase * 1.15 * dt);
  float clearDecay = exp(-u_decayBase * 0.92 * dt);
  float energyDecay = exp(-u_decayBase * 1.35 * dt);

  vel *= velDecay;
  clearMask *= clearDecay;
  energy *= energyDecay;

  // Soft fade near viewport borders to prevent edge clamping artifacts
  float edgeMask =
    smoothstep(0.0, 0.025, v_uv.x) *
    smoothstep(0.0, 0.025, 1.0 - v_uv.x) *
    smoothstep(0.0, 0.025, v_uv.y) *
    smoothstep(0.0, 0.025, 1.0 - v_uv.y);

  float edgeAtten = mix(0.92, 1.0, edgeMask);
  vel *= edgeAtten;
  clearMask *= edgeAtten;

  // 4. Inject new pointer/touch disturbance along motion segment
  if (u_mouseActive > 0.5) {
    vec2 aspectScale = vec2(u_aspect, 1.0);
    vec2 p = v_uv * aspectScale;
    vec2 mCurr = u_mouse * aspectScale;
    vec2 mPrev = u_prevMouse * aspectScale;

    vec2 diff = closestVecFromSegment(p, mPrev, mCurr);
    float dist = length(diff);
    float radius = u_radius;

    if (dist < radius * 2.2) {
      float normDist = dist / radius;
      float normDistSq = normDist * normDist;
      float falloff = exp(-normDistSq * 2.35);
      float ringProfile = smoothstep(0.0, 0.45, normDist) * exp(-normDistSq * 1.45);
      vec2 radialDir = dist > 1e-5 ? (diff / dist) : vec2(0.0);

      vec2 impulse = vec2(0.0);
      float clearAdd = 0.0;
      float energyAdd = 0.0;

      if (u_mode == 0) {
        // PART: Push clouds outward perpendicular to swipe + carve clean trail
        vec2 perp = vec2(-u_moveDir.y, u_moveDir.x);
        float sideSign = dot(diff, perp) >= 0.0 ? 1.0 : -1.0;
        vec2 partPush = mix(radialDir, perp * sideSign, clamp(u_moveSpeed * 2.0, 0.0, 0.78));
        impulse = (partPush * 0.85 + u_moveDir * 0.32) * ringProfile * u_wakePower;
        clearAdd = falloff * u_wakePower * 0.95;
        energyAdd = falloff * u_wakePower * 0.55;
      } else if (u_mode == 1) {
        // SWIRL: Drag along cursor path + rolling vortex curl
        vec2 tangent = vec2(-radialDir.y, radialDir.x);
        float spinSign = (u_moveDir.x - u_moveDir.y) >= 0.0 ? 1.0 : -1.0;
        impulse = (
          u_moveDir * (0.75 * falloff) +
          tangent * (0.95 * spinSign * ringProfile) +
          radialDir * (0.28 * ringProfile)
        ) * u_wakePower;
        clearAdd = falloff * u_wakePower * 0.62;
        energyAdd = (falloff + ringProfile * 0.6) * u_wakePower * 0.95;
      } else if (u_mode == 2) {
        // REPEL: Radial shockwave pushing mist away from cursor
        impulse = radialDir * ringProfile * u_wakePower * 1.25;
        clearAdd = falloff * u_wakePower * 0.82;
        energyAdd = ringProfile * u_wakePower * 0.75;
      } else {
        // ATTRACT: Pulls mist inward toward cursor and compresses clouds
        impulse = -radialDir * ringProfile * u_wakePower * 1.15;
        clearAdd = -falloff * u_wakePower * 0.45;
        energyAdd = falloff * u_wakePower * 0.85;
      }

      float injectRate = clamp(dt * 18.0, 0.08, 0.75);
      vel = clamp(vel + impulse * injectRate, vec2(-1.0), vec2(1.0));
      clearMask = clamp(clearMask + clearAdd * injectRate, 0.0, 1.0);
      energy = clamp(energy + energyAdd * injectRate, 0.0, 1.0);
    }
  }

  // Deadzone snap so fully healed pixels lock cleanly onto neutral byte 128
  if (abs(vel.x) < 0.0045) vel.x = 0.0;
  if (abs(vel.y) < 0.0045) vel.y = 0.0;
  if (clearMask < 0.003) clearMask = 0.0;
  if (energy < 0.003) energy = 0.0;

  gl_FragColor = vec4(encodeVel(vel), clearMask, energy);
}
`;
