/**
 * Avatar Animation Profiles
 * Isolates the exact CSS animations, keyframe timings, transforms, and blink mechanics
 * for each DiceBear style family so they can be driven accurately on HTML5 Canvas.
 */

export const ANIMATION_PROFILES = {
  // --- Voxel Art (Player & NPCs) ---
  // @keyframes va-blink: 4.5s loop (blink at 92%-98%)
  // @keyframes va-stretch: 7s loop (stretch at 86%-96%, translateY -2.5px on 128px canvas = -1.95%)
  'voxel-art': {
    family: 'voxel-art',
    supportsBlinkFrame: true,
    blinkPeriod: 4.5,
    blinkWindow: [0.92, 0.98],
    getTransform(t, characterHeight) {
      const stretchPhase = (t % 7.0) / 7.0;
      let translateY = 0;
      let scaleY = 1;
      let scaleX = 1;

      if (stretchPhase >= 0.86 && stretchPhase <= 0.96) {
        // -2.5px on 128px viewBox ~= 1.95% of height
        const p = Math.sin(((stretchPhase - 0.86) / 0.10) * Math.PI);
        translateY = -0.025 * characterHeight * p;
        scaleY = 1 + 0.03 * p;
        scaleX = 1 - 0.015 * p;
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY };
    },
    isBlinking(t) {
      const p = (t % 4.5) / 4.5;
      return p >= 0.92 && p <= 0.98;
    },
    makeBlinkSvg(svg) {
      return svg.replace(/class="va-blink-medium" opacity="0"/g, 'class="va-blink-medium" opacity="1"');
    }
  },

  // --- Voxel Bot (Companion) ---
  // @keyframes vb-blink: 4.5s loop (blink at 92%-98%)
  // @keyframes vb-stretch: 7s loop (stretch at 86%-96%, translateY -2.5px)
  // @keyframes vb-lift: 7s loop (lift at 87%-95%)
  'voxel-bot': {
    family: 'voxel-bot',
    supportsBlinkFrame: true,
    blinkPeriod: 4.5,
    blinkWindow: [0.92, 0.98],
    getTransform(t, characterHeight) {
      const stretchPhase = (t % 7.0) / 7.0;
      let translateY = 0;
      let scaleY = 1;
      let scaleX = 1;

      if (stretchPhase >= 0.86 && stretchPhase <= 0.96) {
        const p = Math.sin(((stretchPhase - 0.86) / 0.10) * Math.PI);
        translateY = -0.03 * characterHeight * p;
        scaleY = 1 + 0.035 * p;
        scaleX = 1 - 0.02 * p;
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY };
    },
    isBlinking(t) {
      const p = (t % 4.5) / 4.5;
      return p >= 0.92 && p <= 0.98;
    },
    makeBlinkSvg(svg) {
      return svg.replace(/class="vb-blink-medium" opacity="0"/g, 'class="vb-blink-medium" opacity="1"');
    }
  },

  // --- Clay (Companion) ---
  // @keyframes dbclSquash: 3.8s ease-in-out (scale 1.015, 0.955 at 50%)
  // @keyframes dbclPeek: 4.6s ease-in-out (peek offset)
  // @keyframes dbclJiggle: 5.2s (rotate 3.5deg at 50%)
  'clay': {
    family: 'clay',
    supportsBlinkFrame: true,
    blinkPeriod: 4.6,
    blinkWindow: [0.92, 0.98],
    getTransform(t, characterHeight) {
      // Squash & stretch on 3.8s loop
      const squashPhase = (t % 3.8) / 3.8;
      const squashSin = Math.sin(squashPhase * Math.PI * 2);
      const scaleX = 1 + 0.02 * squashSin;
      const scaleY = 1 - 0.03 * squashSin;

      // Jiggle / tilt on 5.2s loop
      const jigglePhase = (t % 5.2) / 5.2;
      const rotate = Math.sin(jigglePhase * Math.PI * 2) * (3.5 * Math.PI / 180);

      return { translateY: 0, translateX: 0, rotate, scaleX, scaleY };
    },
    isBlinking(t) {
      const p = (t % 4.6) / 4.6;
      return p >= 0.92 && p <= 0.98;
    },
    makeBlinkSvg(svg) {
      // Scale eyes down to thin slit during blink
      return svg.replace(/class="dbcl-ep"/g, 'class="dbcl-ep" transform="scale(1, 0.1)"');
    }
  },

  // --- Critters (Companion) ---
  // @keyframes dbcrBob: 3.4s ease-in-out (translateY -2px on 128px ~= -1.6%)
  // @keyframes dbcrBlink: 4.6s linear (scaleY 0.15 at 92%-98%)
  // @keyframes dbcrSway: 5.2s (rotate 3deg at 50%)
  'critters': {
    family: 'critters',
    supportsBlinkFrame: true,
    blinkPeriod: 4.6,
    blinkWindow: [0.92, 0.98],
    getTransform(t, characterHeight) {
      // Bob on 3.4s loop
      const bobPhase = (t % 3.4) / 3.4;
      const bobSin = Math.sin(bobPhase * Math.PI * 2);
      const translateY = -0.025 * characterHeight * Math.max(0, bobSin);

      // Sway on 5.2s loop
      const swayPhase = (t % 5.2) / 5.2;
      const rotate = Math.sin(swayPhase * Math.PI * 2) * (3.0 * Math.PI / 180);

      return { translateY, translateX: 0, rotate, scaleX: 1, scaleY: 1 };
    },
    isBlinking(t) {
      const p = (t % 4.6) / 4.6;
      return p >= 0.92 && p <= 0.98;
    },
    makeBlinkSvg(svg) {
      return svg.replace(/class="dbcr-eb"/g, 'class="dbcr-eb" transform="scale(1, 0.15)"');
    }
  },

  // --- Gaze (Companion) ---
  // @keyframes dbgaHop: 5.2s ease-out (hop translateY -4px & squash)
  // @keyframes dbgaBlink: 4.4s linear (scaleY 0.06 at 94%-97%)
  // @keyframes dbgaLook: 6.4s ease-in-out
  'gaze': {
    family: 'gaze',
    supportsBlinkFrame: true,
    blinkPeriod: 4.4,
    blinkWindow: [0.93, 0.97],
    getTransform(t, characterHeight) {
      const hopPhase = (t % 5.2) / 5.2;
      let translateY = 0;
      let scaleX = 1;
      let scaleY = 1;

      // Hop timing from DiceBear CSS: 64% prep, 73% peak (-4px), 82% land
      if (hopPhase >= 0.60 && hopPhase <= 0.88) {
        if (hopPhase < 0.68) {
          // prep squash
          const p = (hopPhase - 0.60) / 0.08;
          scaleX = 1 + 0.06 * p;
          scaleY = 1 - 0.06 * p;
        } else if (hopPhase < 0.78) {
          // rise to peak
          const p = Math.sin(((hopPhase - 0.68) / 0.10) * Math.PI);
          translateY = -0.05 * characterHeight * p;
          scaleX = 0.95;
          scaleY = 1.05;
        } else {
          // landing squash
          const p = (0.88 - hopPhase) / 0.10;
          scaleX = 1 + 0.05 * p;
          scaleY = 1 - 0.05 * p;
        }
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY };
    },
    isBlinking(t) {
      const p = (t % 4.4) / 4.4;
      return p >= 0.93 && p <= 0.97;
    },
    makeBlinkSvg(svg) {
      return svg.replace(/class="dbga-eye"/g, 'class="dbga-eye" transform="scale(1, 0.1)"');
    }
  },

  // --- Sprouts (Companion) ---
  // @keyframes dbspSway: 4.4s ease-in-out (rotate -2.5deg to 2.5deg)
  // @keyframes dbspBlink: 4.6s linear (scaleY 0.15 at 92%-98%)
  'sprouts': {
    family: 'sprouts',
    supportsBlinkFrame: true,
    blinkPeriod: 4.6,
    blinkWindow: [0.92, 0.98],
    getTransform(t, characterHeight) {
      const swayPhase = (t % 4.4) / 4.4;
      const rotate = Math.sin(swayPhase * Math.PI * 2) * (2.5 * Math.PI / 180);
      return { translateY: 0, translateX: 0, rotate, scaleX: 1, scaleY: 1 };
    },
    isBlinking(t) {
      const p = (t % 4.6) / 4.6;
      return p >= 0.92 && p <= 0.98;
    },
    makeBlinkSvg(svg) {
      return svg.replace(/class="dbsp-e"/g, 'class="dbsp-e" transform="scale(1, 0.15)"');
    }
  }
};

/**
 * Returns the animation profile for a given recipe.
 */
export function getAnimationProfile(recipe) {
  if (!recipe) return ANIMATION_PROFILES['voxel-art'];
  if (recipe.isCompanion) {
    return ANIMATION_PROFILES[recipe.style] || ANIMATION_PROFILES['voxel-bot'];
  }
  return ANIMATION_PROFILES['voxel-art'];
}
