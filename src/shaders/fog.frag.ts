export const FOG_FRAGMENT_SHADER = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

const int MAX_LAYERS = 6;
const float STAR_PERIOD = 128.0;
const float ZERO_ENC = 128.0 / 255.0;
const float ENC_SCALE = 0.495;
const mat2 DETAIL_ROT = mat2(0.80, 0.60, -0.60, 0.80);
// Precomputed rotation matrix for -0.14 rad layer tilt: [cos(-0.14), sin(-0.14), -sin(-0.14), cos(-0.14)]
const mat2 LAYER_TILT = mat2(0.990216, -0.139543, 0.139543, 0.990216);

uniform sampler2D u_wakeTex;
uniform sampler2D u_noiseTex;
uniform vec2 u_resolution;
uniform vec2 u_nebulaOffset;

uniform float u_opacity;
uniform int u_detail;
uniform float u_detailWeight;
uniform vec3 u_bgColor;
uniform float u_transparentBg;

uniform float u_turbulence;

uniform float u_wakeActive;
uniform float u_interactionStrength;
uniform float u_clearAmount;

uniform float u_backlightEnabled;
uniform vec3 u_backlightPrimary;
uniform vec3 u_backlightSecondary;
uniform float u_backlightIntensity;
uniform vec2 u_backlightPos;
uniform float u_backlightRadius;

uniform float u_starsEnabled;
uniform vec3 u_starPrimary;
uniform vec3 u_starSecondary;
uniform float u_starSize;
uniform vec2 u_starTwinklePhase;
uniform vec2 u_starDrift[3];
// x: sqrt(densityScale), y: starRadius, z: radiusChance, w: fogOcclusion
uniform vec4 u_starParams;

uniform int u_layerCount;
uniform vec3 u_layerColor[MAX_LAYERS];
uniform vec3 u_layerHighlight[MAX_LAYERS];
// x: effectiveOpacity, y: effectiveScale, z: effectiveThickness
uniform vec3 u_layerParamsA[MAX_LAYERS];
// x: interactionSensitivity, y: threshold, z: edgeWidth, w: stepUnit
uniform vec4 u_layerParamsB[MAX_LAYERS];
// x: yMin, y: yMax, z: yFeather
uniform vec3 u_layerYBand[MAX_LAYERS];
// Dynamic per-frame CPU-precomputed motion: xy = seedOffset - drift, z = localBillow
uniform vec3 u_layerMotion[MAX_LAYERS];

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Texture-backed Perlin-Worley cumulus sculpting (2 lookups at low detail, 3 at medium/high)
float sampleCloudDensity(
  vec2 p,
  float billowT,
  float turb,
  float detailWeight,
  bool useWarp
) {
  vec2 uv = p * 0.25;
  float clampedTurb = clamp(turb, 0.0, 2.0);
  vec2 warp = vec2(0.0);

  if (useWarp) {
    vec4 warpTex = texture2D(u_noiseTex, uv * 0.65 + vec2(billowT * 0.022, -billowT * 0.014));
    warp = (warpTex.rb - 0.5) * (clampedTurb * 0.075);
  }

  // Primary macro mist (R), Worley cauliflower puffs (G), fine wisps (B)
  vec4 nMain = texture2D(u_noiseTex, uv + warp + vec2(0.0, -billowT * 0.012));

  // Rotated counter-drifting octave eliminates visible tiling & animates billows
  vec2 detailUv = DETAIL_ROT * (uv * 1.68) - warp * 0.65 + vec2(-billowT * 0.024, billowT * 0.016);
  vec4 nDet = texture2D(u_noiseTex, detailUv);

  float macroMist = mix(nMain.r, nDet.r, 0.34 * detailWeight);
  float puffs = mix(nMain.g, nDet.a, 0.38 * detailWeight);

  float density = mix(macroMist, puffs, 0.56);
  density = smoothstep(0.16, 0.88, density * 0.62 + macroMist * 0.46);

  // High-frequency powdery edge erosion
  float wisp = mix(nMain.b, nDet.b, 0.50);
  float edgeMask = 1.0 - smoothstep(0.35, 0.85, density);
  density -= (1.0 - wisp) * (0.24 + clampedTurb * 0.08) * edgeMask;
  density += (nDet.b - 0.5) * 0.055 * detailWeight;

  return clamp(density, 0.0, 1.0);
}

// Single-lookup shadow density for volumetric light marching
float sampleCloudShadow(vec2 p, float billowT) {
  vec2 uv = p * 0.25 + vec2(0.0, -billowT * 0.012);
  vec4 n = texture2D(u_noiseTex, uv);
  return smoothstep(0.16, 0.88, mix(n.r, n.g, 0.56) * 0.62 + n.r * 0.46);
}

// Three-tier cosmic stars, crimson prayer stars & foreground crimson bokeh
vec3 renderStars(vec2 uv, float aspect, float totalFogDensity, float fgDensity) {
  if (u_starsEnabled < 0.5) {
    return vec3(0.0);
  }

  vec2 p = vec2(uv.x * aspect, uv.y);
  vec3 accum = vec3(0.0);
  float densityScaleSqrt = u_starParams.x;
  float starRad = u_starParams.y;
  float radChance = u_starParams.z;
  float fogOcc = u_starParams.w;

  // Tier 1: Cosmic stars in upper sky openings (only a subset get expanded radius)
  if (uv.y > 0.24) {
    float scale = 22.0 * densityScaleSqrt;
    vec2 sp = p * scale + u_starDrift[0];
    vec2 cell = mod(floor(sp), STAR_PERIOD);
    vec2 f = fract(sp);
    vec2 rnd = hash22(cell + 11.7);

    if (rnd.x < 0.34) {
      float bigRoll = hash21(cell + 193.7);
      float isBig = (radChance > 0.001 && bigRoll < radChance) ? 1.0 : 0.0;
      float bigVar = 0.72 + 0.56 * hash21(cell + 211.3);
      float radiusMult = mix(1.0, starRad * bigVar, isBig);

      vec2 starPos = vec2(0.15) + hash22(cell + 29.3) * 0.70;
      starPos = mix(starPos, vec2(0.5), isBig * 0.58);

      float d = length(f - starPos);
      float r = (0.014 + rnd.y * 0.012) * u_starSize * radiusMult;
      float cutoff = isBig > 0.5 ? r * 11.0 : r * 2.2;

      if (d < cutoff) {
        float twinkle = 0.65 + 0.35 * sin(rnd.y * 6.28318 + u_starTwinklePhase.x);
        float core = exp(-(d * d) / max(r * r * 0.18, 1e-6));
        float bigHalo = isBig * exp(-d / max(r * 2.1, 1e-4)) * 0.42;
        float cellFade = mix(1.0, 1.0 - smoothstep(0.35, 0.5, max(abs(f.x - 0.5), abs(f.y - 0.5))), isBig);

        float cPick = hash21(cell + 71.9);
        vec3 col = vec3(0.85, 0.96, 1.0);
        if (cPick > 0.78) col = u_starSecondary;
        else if (cPick > 0.64) col = u_starPrimary;

        float occFactor = 1.0;
        if (fogOcc > 0.001) {
          float gap = clamp(1.0 - totalFogDensity * 1.15, 0.0, 1.0);
          float gapVis = gap * sqrt(gap);
          float skyBias = smoothstep(0.28, 0.75, uv.y);
          occFactor = mix(1.0, gapVis * skyBias, fogOcc);
        }
        accum += col * (core * 1.85 + bigHalo) * twinkle * cellFade * occFactor;
      }
    }
  }

  // Tier 2: Iconic glowing crimson prayer stars suspended in the fog
  {
    float scale = 7.5 * densityScaleSqrt;
    vec2 sp = p * scale + u_starDrift[1];
    vec2 cell = mod(floor(sp), STAR_PERIOD);
    vec2 f = fract(sp);
    vec2 rnd = hash22(cell + 93.1);

    if (rnd.x < 0.24) {
      float bigRoll = hash21(cell + 157.3);
      float isBig = (radChance > 0.001 && bigRoll < radChance) ? 1.0 : 0.0;
      float bigVar = 0.78 + 0.48 * hash21(cell + 241.9);
      float radiusMult = mix(1.0, starRad * bigVar, isBig);

      vec2 starPos = vec2(0.20) + hash22(cell + 53.7) * 0.60;
      starPos = mix(starPos, vec2(0.5), isBig * 0.65);

      float d = length(f - starPos);
      float r = (0.015 + rnd.y * 0.014) * u_starSize * radiusMult;

      if (d < r * 14.0) {
        float twinkle = 0.72 + 0.28 * sin(rnd.y * 6.28318 + u_starTwinklePhase.y);
        float hotCore = exp(-(d * d) / max(r * r * 0.20, 1e-6));
        float redHalo = exp(-d / max(r * 2.55, 1e-4)) * (0.62 + isBig * 0.28);
        float cellFade = mix(1.0, 1.0 - smoothstep(0.34, 0.5, max(abs(f.x - 0.5), abs(f.y - 0.5))), isBig);

        float cPick = hash21(cell + 13.4);
        vec3 starCol = mix(u_starPrimary, u_starSecondary, step(0.82, cPick));
        vec3 coreCol = mix(starCol, vec3(1.0, 0.85, 0.82), 0.45);

        float occ = fogOcc > 0.001
          ? mix(1.0, clamp(1.0 - fgDensity * 0.55 * fogOcc, 0.22, 1.0), fogOcc)
          : 1.0;
        accum += (coreCol * hotCore * 2.1 + starCol * redHalo * (1.0 + fgDensity * 0.6)) * twinkle * cellFade * occ;
      }
    }
  }

  // Tier 3: Large out-of-focus foreground crimson bokeh orbs along the bottom
  if (uv.y < 0.36) {
    float scale = 2.6;
    vec2 sp = p * scale + u_starDrift[2];
    vec2 cell = mod(floor(sp), STAR_PERIOD);
    vec2 f = fract(sp);
    vec2 rnd = hash22(cell + 127.5);

    if (rnd.x < 0.22) {
      vec2 orbPos = vec2(0.30) + hash22(cell + 61.2) * 0.40;
      float d = length(f - orbPos);
      float bokehScale = mix(0.75, 1.35, clamp((starRad - 0.5) / 3.5, 0.0, 1.0));
      float radius = (0.12 + rnd.y * 0.10) * u_starSize * bokehScale;

      if (d < radius) {
        float bokeh = 1.0 - smoothstep(radius * 0.15, radius, d);
        float bottomMask = 1.0 - smoothstep(0.05, 0.34, uv.y);
        accum += u_starPrimary * (bokeh * bokeh * 0.52 * bottomMask);
      }
    }
  }

  return accum;
}

void main() {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 centeredUv = (v_uv - 0.5) * vec2(aspect, 1.0);
  vec2 tiltedCenteredUv = (LAYER_TILT * centeredUv) * vec2(0.84, 1.12);

  // Sample wake only when interaction is enabled and wake has non-zero energy
  vec2 baseTiltedWake = vec2(0.0);
  float wakeClearBase = 0.0;
  float wakeEnergyBase = 0.0;
  if (u_wakeActive > 0.5) {
    vec4 wakeRaw = texture2D(u_wakeTex, v_uv);
    vec2 wakeVel = (wakeRaw.rg - ZERO_ENC) / ENC_SCALE;
    baseTiltedWake = (LAYER_TILT * wakeVel) * (0.32 * u_interactionStrength * vec2(0.84, 1.12));
    wakeClearBase = wakeRaw.b * u_clearAmount * 0.72;
    wakeEnergyBase = wakeRaw.a;
  }

  vec3 finalColor = mix(u_bgColor, vec3(0.0), u_transparentBg);
  float finalAlpha = mix(1.0, 0.0, u_transparentBg);

  // Celestial turquoise & emerald aurora rift (skipped completely when backlight is disabled)
  vec3 ambientGlow = vec3(0.0);
  if (u_backlightEnabled > 0.5) {
    vec2 lightDiff = (v_uv - u_backlightPos) * vec2(aspect, 1.0);
    float lightDist = length(lightDiff) / max(u_backlightRadius, 0.05);
    float primaryGlow = exp(-lightDist * lightDist * 1.65);

    vec2 emeraldPos = vec2(clamp(u_backlightPos.x + 0.22, 0.0, 1.0), clamp(u_backlightPos.y - 0.03, 0.0, 1.0));
    float emeraldDist = length((v_uv - emeraldPos) * vec2(aspect, 1.0)) / max(u_backlightRadius * 0.85, 0.05);
    float emeraldGlow = exp(-emeraldDist * emeraldDist * 1.85);

    float leftSkyDist = length((v_uv - vec2(0.14, 0.88)) * vec2(aspect, 1.0)) / max(u_backlightRadius * 0.9, 0.05);
    float leftSkyGlow = exp(-leftSkyDist * leftSkyDist * 2.1) * 0.45;

    vec3 backlightColor =
      u_backlightPrimary * primaryGlow +
      u_backlightSecondary * (emeraldGlow * 0.95) +
      mix(u_backlightPrimary, vec3(0.35, 0.62, 0.82), 0.5) * leftSkyGlow;

    ambientGlow = backlightColor * u_backlightIntensity;

    float nebulaWisp = texture2D(u_noiseTex, centeredUv * 0.55 + u_nebulaOffset).r;
    vec3 skyBackdrop = ambientGlow * (0.45 + 0.95 * nebulaWisp) * 0.95;
    if (u_transparentBg > 0.5) {
      float glowAlpha = clamp(length(skyBackdrop) * 0.42 * u_opacity, 0.0, 0.55);
      finalColor += skyBackdrop * u_opacity;
      finalAlpha = max(finalAlpha, glowAlpha);
    } else {
      finalColor += skyBackdrop;
    }
  }

  float totalFogDensity = 0.0;
  float foregroundDensity = 0.0;
  vec2 toLight = normalize(u_backlightPos - v_uv + vec2(1e-4));
  bool useWarp = u_detail >= 4;
  bool twoStepShadow = u_detail >= 5;

  for (int i = 0; i < MAX_LAYERS; i++) {
    if (i >= u_layerCount) break;

    vec3 paramsA = u_layerParamsA[i];
    vec4 paramsB = u_layerParamsB[i];
    vec3 yBand = u_layerYBand[i];

    float effectiveOpacity = paramsA.x;
    float effectiveScale = paramsA.y;
    float effectiveThickness = paramsA.z;

    float feather = max(yBand.z, 0.04);
    float yMaskBottom = smoothstep(yBand.x - feather, yBand.x + feather * 0.6, v_uv.y);
    float yMaskTop = 1.0 - smoothstep(yBand.y - feather * 0.6, yBand.y + feather, v_uv.y);
    float yMask = clamp(yMaskBottom * yMaskTop, 0.0, 1.0);
    if (yMask < 0.002 || effectiveOpacity < 0.002) continue;

    float sens = paramsB.x;
    float threshold = paramsB.y;
    float edgeWidth = paramsB.z;
    float stepUnit = paramsB.w;

    vec3 motion = u_layerMotion[i];
    float localTurb = u_turbulence + wakeEnergyBase * (0.65 * sens * u_interactionStrength);
    vec2 tiltedUv = tiltedCenteredUv - baseTiltedWake * sens;
    vec2 p = tiltedUv * effectiveScale + motion.xy;
    float localBillow = motion.z;

    float rawDensity = sampleCloudDensity(p, localBillow, localTurb, u_detailWeight, useWarp);
    float shapedDensity = rawDensity - wakeClearBase * sens;

    float cloud = smoothstep(threshold - edgeWidth, threshold + edgeWidth, shapedDensity) * yMask;
    if (cloud < 0.002) continue;

    // Directional light marching (1 lookup for detail <= 4, 2 lookups for detail >= 5)
    float dNear = sampleCloudShadow(p + toLight * stepUnit, localBillow);
    float dFar = twoStepShadow
      ? sampleCloudShadow(p + toLight * (stepUnit * 2.5), localBillow)
      : dNear;
    float opticalDepth = max(0.0, (dNear * 0.62 + dFar * 0.38) - 0.22) * effectiveThickness * 2.35;

    float transmittance = exp(-opticalDepth * 1.85);
    float edgeRim = (1.0 - smoothstep(0.12, 0.85, cloud)) * smoothstep(0.02, 0.42, cloud);
    float topRim = clamp((rawDensity - dNear) * 2.8 + 0.35, 0.0, 1.0);

    float crestLight = clamp(
      transmittance * 0.62 + topRim * 0.34 + edgeRim * 0.32 * transmittance,
      0.0,
      1.0
    );

    vec3 shadowCol = u_layerColor[i];
    vec3 crestCol = u_layerHighlight[i];
    vec3 layerCol = mix(shadowCol, crestCol, crestLight);

    if (u_backlightEnabled > 0.5) {
      float depthRatio = float(i) / max(float(u_layerCount - 1), 1.0);
      float depthWeight = mix(0.95, 0.22, depthRatio);
      float scatter = (transmittance * 0.35 + edgeRim * 0.85) * depthWeight;
      layerCol += ambientGlow * scatter * 0.62;
    }

    if (wakeEnergyBase > 0.0) {
      layerCol += crestCol * (wakeEnergyBase * sens * 0.12);
    }

    float layerAlpha = clamp(cloud * effectiveOpacity, 0.0, 1.0);

    if (u_transparentBg > 0.5) {
      vec3 premulDest = finalColor * finalAlpha;
      vec3 premulSrc = layerCol * layerAlpha;
      float outAlpha = layerAlpha + finalAlpha * (1.0 - layerAlpha);
      finalColor = outAlpha > 1e-4 ? (premulSrc + premulDest * (1.0 - layerAlpha)) / outAlpha : vec3(0.0);
      finalAlpha = outAlpha;
    } else {
      finalColor = mix(finalColor, layerCol, layerAlpha);
    }

    totalFogDensity = clamp(totalFogDensity + layerAlpha * 0.62, 0.0, 1.0);
    if (i >= u_layerCount - 1) {
      foregroundDensity = clamp(foregroundDensity + layerAlpha, 0.0, 1.0);
    }
  }

  vec3 stars = renderStars(v_uv, aspect, totalFogDensity, foregroundDensity);
  if (u_transparentBg > 0.5) {
    float starAlpha = clamp(max(stars.r, max(stars.g, stars.b)) * 0.85 * u_opacity, 0.0, 1.0);
    finalColor += stars * u_opacity;
    finalAlpha = clamp(max(finalAlpha, starAlpha), 0.0, 1.0);
  } else {
    finalColor += stars * u_opacity;
  }

  if (u_transparentBg < 0.5) {
    vec2 vigUv = (v_uv - 0.5) * vec2(1.02, 1.15);
    float vig = 1.0 - dot(vigUv, vigUv) * 0.38;
    finalColor *= clamp(vig, 0.65, 1.0);
  }

  finalColor = finalColor / (vec3(1.0) + finalColor * 0.16);

  gl_FragColor = vec4(finalColor, clamp(finalAlpha, 0.0, 1.0));
}
`;
