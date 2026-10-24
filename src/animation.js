/**
 * Avatar Animation Profiles
 * Isolates the exact CSS animations, keyframe timings, transforms, blink mechanics,
 * and gaze/look direction shifts for each DiceBear style family so they run accurately on Canvas.
 */

export const ANIMATION_PROFILES = {
  // --- Voxel Art (Player & NPCs) ---
  // Keyframes:
  // - va-blink: periodic eyelid cover over eyes
  // - va-stretch: vertical stretch & height bob (translateY & scaleY)
  // - Eye look shifts: looking forward, left, right over a glance cycle
  'voxel-art': {
    family: 'voxel-art',
    supportsBlinkFrame: true,
    supportsLookFrames: true,
    blinkPeriod: 4.0,
    blinkWindow: [0.91, 0.98],
    getTransform(t, characterHeight) {
      // Periodic height change / stretch on 5.5s loop
      const stretchPhase = (t % 5.5) / 5.5;
      let translateY = 0;
      let scaleY = 1;
      let scaleX = 1;

      // Stretch & heighten phase
      if (stretchPhase >= 0.80 && stretchPhase <= 0.96) {
        const p = Math.sin(((stretchPhase - 0.80) / 0.16) * Math.PI);
        // Visible height shift and breathing stretch
        translateY = -0.06 * characterHeight * p;
        scaleY = 1 + 0.08 * p;
        scaleX = 1 - 0.03 * p;
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY };
    },
    isBlinking(t) {
      const p = (t % 4.0) / 4.0;
      return p >= 0.91 && p <= 0.98;
    },
    getLookDirection(t) {
      // 8-second glance cycle: look center -> look right -> look center -> look left
      const p = (t % 8.0) / 8.0;
      if (p >= 0.25 && p < 0.45) return 'look-right';
      if (p >= 0.65 && p < 0.85) return 'look-left';
      return 'default';
    },
    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        // Matches any blink variant (va-blink-fastest, va-blink-medium, va-blink-slow, etc.)
        return svg.replace(/class="va-blink-[^"]+"\s+opacity="0"/g, match => match.replace('opacity="0"', 'opacity="1"'));
      }
      if (frame === 'look-left') {
        return svg.replace(/<use transform="translate\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\)" href="#eyes-([^"]+)"\/>/, (match, x, y, id) => {
          return `<use transform="translate(${Number(x) - 2.5} ${y})" href="#eyes-${id}"/>`;
        });
      }
      if (frame === 'look-right') {
        return svg.replace(/<use transform="translate\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\)" href="#eyes-([^"]+)"\/>/, (match, x, y, id) => {
          return `<use transform="translate(${Number(x) + 2.5} ${y})" href="#eyes-${id}"/>`;
        });
      }
      return svg;
    }
  },

  // --- Voxel Bot (Companion) ---
  'voxel-bot': {
    family: 'voxel-bot',
    supportsBlinkFrame: true,
    supportsLookFrames: true,
    blinkPeriod: 4.0,
    blinkWindow: [0.91, 0.98],
    getTransform(t, characterHeight) {
      const stretchPhase = (t % 5.5) / 5.5;
      let translateY = 0;
      let scaleY = 1;
      let scaleX = 1;

      if (stretchPhase >= 0.80 && stretchPhase <= 0.96) {
        const p = Math.sin(((stretchPhase - 0.80) / 0.16) * Math.PI);
        translateY = -0.07 * characterHeight * p;
        scaleY = 1 + 0.08 * p;
        scaleX = 1 - 0.04 * p;
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY };
    },
    isBlinking(t) {
      const p = (t % 4.0) / 4.0;
      return p >= 0.91 && p <= 0.98;
    },
    getLookDirection(t) {
      const p = (t % 7.5) / 7.5;
      if (p >= 0.25 && p < 0.45) return 'look-right';
      if (p >= 0.65 && p < 0.85) return 'look-left';
      return 'default';
    },
    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="vb-blink-medium"\s+opacity="0"/g, 'class="vb-blink-medium" opacity="1"');
      }
      return svg;
    }
  },

  // --- Clay (Companion) ---
  'clay': {
    family: 'clay',
    supportsBlinkFrame: true,
    supportsLookFrames: false,
    blinkPeriod: 4.6,
    blinkWindow: [0.92, 0.98],
    getTransform(t, characterHeight) {
      const squashPhase = (t % 3.8) / 3.8;
      const squashSin = Math.sin(squashPhase * Math.PI * 2);
      const scaleX = 1 + 0.03 * squashSin;
      const scaleY = 1 - 0.04 * squashSin;

      const jigglePhase = (t % 5.2) / 5.2;
      const rotate = Math.sin(jigglePhase * Math.PI * 2) * (3.5 * Math.PI / 180);

      return { translateY: 0, translateX: 0, rotate, scaleX, scaleY };
    },
    isBlinking(t) {
      const p = (t % 4.6) / 4.6;
      return p >= 0.92 && p <= 0.98;
    },
    getLookDirection() {
      return 'default';
    },
    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="dbcl-ep"/g, 'class="dbcl-ep" transform="scale(1, 0.1)"');
      }
      return svg;
    }
  },

  // --- Critters (Companion) ---
  'critters': {
    family: 'critters',
    supportsBlinkFrame: true,
    supportsLookFrames: false,
    blinkPeriod: 4.6,
    blinkWindow: [0.92, 0.98],
    getTransform(t, characterHeight) {
      const bobPhase = (t % 3.4) / 3.4;
      const bobSin = Math.sin(bobPhase * Math.PI * 2);
      const translateY = -0.04 * characterHeight * Math.max(0, bobSin);

      const swayPhase = (t % 5.2) / 5.2;
      const rotate = Math.sin(swayPhase * Math.PI * 2) * (3.0 * Math.PI / 180);

      return { translateY, translateX: 0, rotate, scaleX: 1, scaleY: 1 };
    },
    isBlinking(t) {
      const p = (t % 4.6) / 4.6;
      return p >= 0.92 && p <= 0.98;
    },
    getLookDirection() {
      return 'default';
    },
    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="dbcr-eb"/g, 'class="dbcr-eb" transform="scale(1, 0.15)"');
      }
      return svg;
    }
  },

  // --- Gaze (Companion) ---
  'gaze': {
    family: 'gaze',
    supportsBlinkFrame: true,
    supportsLookFrames: false,
    blinkPeriod: 4.4,
    blinkWindow: [0.93, 0.97],
    getTransform(t, characterHeight) {
      const hopPhase = (t % 5.2) / 5.2;
      let translateY = 0;
      let scaleX = 1;
      let scaleY = 1;

      if (hopPhase >= 0.60 && hopPhase <= 0.88) {
        if (hopPhase < 0.68) {
          const p = (hopPhase - 0.60) / 0.08;
          scaleX = 1 + 0.06 * p;
          scaleY = 1 - 0.06 * p;
        } else if (hopPhase < 0.78) {
          const p = Math.sin(((hopPhase - 0.68) / 0.10) * Math.PI);
          translateY = -0.06 * characterHeight * p;
          scaleX = 0.94;
          scaleY = 1.06;
        } else {
          const p = (0.88 - hopPhase) / 0.10;
          scaleX = 1 + 0.06 * p;
          scaleY = 1 - 0.06 * p;
        }
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY };
    },
    isBlinking(t) {
      const p = (t % 4.4) / 4.4;
      return p >= 0.93 && p <= 0.97;
    },
    getLookDirection() {
      return 'default';
    },
    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="dbga-eye"/g, 'class="dbga-eye" transform="scale(1, 0.1)"');
      }
      return svg;
    }
  },

  // --- Sprouts (Companion) ---
  'sprouts': {
    family: 'sprouts',
    supportsBlinkFrame: true,
    supportsLookFrames: false,
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
    getLookDirection() {
      return 'default';
    },
    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="dbsp-e"/g, 'class="dbsp-e" transform="scale(1, 0.15)"');
      }
      return svg;
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
