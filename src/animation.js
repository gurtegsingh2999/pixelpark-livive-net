/**
 * Avatar Animation Profiles
 * Isolates the exact animation timelines, multi-frame SVG generation, and procedural
 * transforms for each DiceBear style family so they run accurately on HTML5 Canvas.
 *
 * Why multi-frame SVG generation is needed:
 * HTML5 Canvas `ctx.drawImage(img)` freezes embedded SVG `@keyframes` at t=0.
 * Furthermore, `<use href="#id" transform="...">` inside an `<img src="data:image/svg+xml">`
 * does not move internal `<g id="id">` coordinates reliably across browsers.
 * By generating distinct SVG frames using DiceBear's native component variants and
 * internal group transforms (e.g. `.va-upper`, `.vb-upper`, `.vb-head`, `eyesVariant`,
 * `mouthVariant`, and eyelid layers), every character visibly animates on Canvas and in UI previews.
 */

export const ANIMATION_PROFILES = {
  // --- Voxel Art (Player & NPCs) ---
  // Native DiceBear animations & expression shifts:
  // 1. Upper-body stretch (`va-upper` shifts up while feet/legs remain planted on the ground)
  // 2. Eyelid blink (`va-blink-*` opacity 1 + closed eyes)
  // 3. Eye gaze (`side` eyes looking left/right vs forward)
  // 4. Mouth expression shift (periodic talk / smile / ooh variation)
  'voxel-art': {
    family: 'voxel-art',
    frames: ['default', 'blink', 'stretch', 'look-left', 'look-right', 'talk'],

    getFrame(t) {
      // 1. Blink window (every 3.2s for 0.25s)
      const blinkCycle = (t % 3.2) / 3.2;
      if (blinkCycle >= 0.88 && blinkCycle <= 0.96) {
        return 'blink';
      }

      // 2. Upper-body stretch window (every 4.5s for 0.65s)
      const stretchCycle = (t % 4.5) / 4.5;
      if (stretchCycle >= 0.72 && stretchCycle <= 0.86) {
        return 'stretch';
      }

      // 3. Eye gaze & mouth cycle (6.0s loop)
      const actionCycle = (t % 6.0) / 6.0;
      if (actionCycle >= 0.15 && actionCycle < 0.30) {
        return 'look-right';
      }
      if (actionCycle >= 0.45 && actionCycle < 0.58) {
        return 'talk';
      }
      if (actionCycle >= 0.70 && actionCycle < 0.85) {
        return 'look-left';
      }

      return 'default';
    },

    getTransform(t, characterHeight) {
      // Subtle continuous breathing + upper stretch reinforcement
      const stretchCycle = (t % 4.5) / 4.5;
      let translateY = 0;
      let scaleY = 1;
      let scaleX = 1;

      if (stretchCycle >= 0.70 && stretchCycle <= 0.88) {
        const p = Math.sin(((stretchCycle - 0.70) / 0.18) * Math.PI);
        translateY = -0.02 * characterHeight * p;
        scaleY = 1 + 0.03 * p;
        scaleX = 1 - 0.015 * p;
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY };
    },

    isBlinking(t) {
      return this.getFrame(t) === 'blink';
    },

    getLookDirection(t) {
      const f = this.getFrame(t);
      return (f === 'look-left' || f === 'look-right') ? f : 'default';
    },

    getRecipeFrameOptions(baseOptions, frame) {
      const opts = { ...baseOptions };
      if (frame === 'blink') {
        opts.eyesVariant = ['closed'];
        opts.eyesProbability = 100;
      } else if (frame === 'look-right') {
        opts.eyesVariant = ['side'];
        opts.eyesProbability = 100;
      } else if (frame === 'talk') {
        opts.mouthVariant = ['bigSmile'];
        opts.mouthProbability = 100;
        opts.eyebrowsVariant = ['raised'];
        opts.eyebrowsProbability = 100;
      }
      return opts;
    },

    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        // Activate DiceBear's built-in eyelid overlay AND closed eyes
        return svg.replace(/class="va-blink-[^"]+"\s+opacity="0"/g, match =>
          match.replace('opacity="0"', 'opacity="1"')
        );
      }
      if (frame === 'stretch') {
        // Move `.va-upper` (torso, arms, head) up by -3.5 units while legs & shoes stay planted!
        return svg.replace(
          /<g class="va-upper">/g,
          '<g class="va-upper" transform="translate(0 -3.5)">'
        );
      }
      if (frame === 'look-left') {
        // Shift the internal eyes definition paths left by 2.5 units inside <g id="eyes-...">
        return svg.replace(
          /(<g id="eyes-[^"]+">)([\s\S]*?)(<\/g>)/,
          '$1<g transform="translate(-2.5 0)">$2</g>$3'
        );
      }
      if (frame === 'look-right') {
        // Ensure eyes shift right even if variant was already side
        return svg.replace(
          /(<g id="eyes-[^"]+">)([\s\S]*?)(<\/g>)/,
          '$1<g transform="translate(2.5 0)">$2</g>$3'
        );
      }
      return svg;
    }
  },

  // --- Voxel Bot (Companion) ---
  // Native DiceBear animations:
  // 1. `.vb-upper` torso stretch (-2.5px) + `.vb-head` head lift (-2.5px)
  // 2. `.vb-blink-*` visor/screen blink
  // 3. Eye & mouth screen state changes (`happy` / `speaker`)
  'voxel-bot': {
    family: 'voxel-bot',
    frames: ['default', 'blink', 'stretch', 'look-left', 'look-right', 'talk'],

    getFrame(t) {
      const blinkCycle = (t % 3.4) / 3.4;
      if (blinkCycle >= 0.88 && blinkCycle <= 0.96) {
        return 'blink';
      }

      const stretchCycle = (t % 4.5) / 4.5;
      if (stretchCycle >= 0.70 && stretchCycle <= 0.86) {
        return 'stretch';
      }

      const actionCycle = (t % 5.8) / 5.8;
      if (actionCycle >= 0.18 && actionCycle < 0.34) {
        return 'look-right';
      }
      if (actionCycle >= 0.48 && actionCycle < 0.62) {
        return 'talk';
      }
      if (actionCycle >= 0.72 && actionCycle < 0.86) {
        return 'look-left';
      }

      return 'default';
    },

    getTransform(t, characterHeight) {
      const stretchCycle = (t % 4.5) / 4.5;
      let translateY = 0;
      let scaleY = 1;
      let scaleX = 1;

      if (stretchCycle >= 0.68 && stretchCycle <= 0.88) {
        const p = Math.sin(((stretchCycle - 0.68) / 0.20) * Math.PI);
        translateY = -0.025 * characterHeight * p;
        scaleY = 1 + 0.03 * p;
        scaleX = 1 - 0.015 * p;
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY };
    },

    isBlinking(t) {
      return this.getFrame(t) === 'blink';
    },

    getLookDirection(t) {
      const f = this.getFrame(t);
      return (f === 'look-left' || f === 'look-right') ? f : 'default';
    },

    getRecipeFrameOptions(baseOptions, frame) {
      const opts = { ...baseOptions };
      if (frame === 'talk') {
        opts.eyesVariant = ['happy'];
        opts.eyesProbability = 100;
        opts.mouthVariant = ['speaker'];
        opts.mouthProbability = 100;
      }
      return opts;
    },

    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="vb-blink-[^"]+"\s+opacity="0"/g, match =>
          match.replace('opacity="0"', 'opacity="1"')
        );
      }
      if (frame === 'stretch') {
        // Exact DiceBear voxel-bot animation: vb-upper lifts -2.5 AND vb-head lifts another -2.5!
        return svg
          .replace(/<g class="vb-upper">/g, '<g class="vb-upper" transform="translate(0 -2.5)">')
          .replace(/<g class="vb-head">/g, '<g class="vb-head" transform="translate(0 -2.5)">');
      }
      if (frame === 'look-left') {
        return svg.replace(
          /(<g id="eyes-[^"]+">)([\s\S]*?)(<\/g>)/,
          '$1<g transform="translate(-2.5 0)">$2</g>$3'
        );
      }
      if (frame === 'look-right') {
        return svg.replace(
          /(<g id="eyes-[^"]+">)([\s\S]*?)(<\/g>)/,
          '$1<g transform="translate(2.5 0)">$2</g>$3'
        );
      }
      return svg;
    }
  },

  // --- Clay (Companion) ---
  // Native DiceBear animations: dbclSquash (3.8s), dbclPeek (4.6s), dbclJiggle (5.2s)
  'clay': {
    family: 'clay',
    frames: ['default', 'blink', 'look-left', 'look-right'],

    getFrame(t) {
      const blinkCycle = (t % 4.2) / 4.2;
      if (blinkCycle >= 0.90 && blinkCycle <= 0.97) return 'blink';

      const peekCycle = (t % 4.6) / 4.6;
      if (peekCycle >= 0.20 && peekCycle < 0.42) return 'look-right';
      if (peekCycle >= 0.55 && peekCycle < 0.78) return 'look-left';
      return 'default';
    },

    getTransform(t, characterHeight) {
      const squashPhase = (t % 3.8) / 3.8;
      const squashSin = Math.sin(squashPhase * Math.PI * 2);
      const scaleX = 1 + 0.035 * squashSin;
      const scaleY = 1 - 0.045 * squashSin;

      const jigglePhase = (t % 5.2) / 5.2;
      const rotate = Math.sin(jigglePhase * Math.PI * 2) * (3.5 * Math.PI / 180);

      return { translateY: 0, translateX: 0, rotate, scaleX, scaleY };
    },

    isBlinking(t) {
      return this.getFrame(t) === 'blink';
    },

    getLookDirection(t) {
      const f = this.getFrame(t);
      return (f === 'look-left' || f === 'look-right') ? f : 'default';
    },

    getRecipeFrameOptions(baseOptions, frame) {
      const opts = { ...baseOptions };
      if (frame === 'blink') {
        opts.eyesVariant = ['happy'];
        opts.eyesProbability = 100;
      }
      return opts;
    },

    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="dbcl-ep"/g, 'class="dbcl-ep" opacity="0.15"');
      }
      if (frame === 'look-left') {
        return svg.replace(/class="dbcl-ep"/g, 'class="dbcl-ep" transform="translate(-1.8, -0.8)"');
      }
      if (frame === 'look-right') {
        return svg.replace(/class="dbcl-ep"/g, 'class="dbcl-ep" transform="translate(1.8, -0.8)"');
      }
      return svg;
    }
  },

  // --- Critters (Companion) ---
  // Native DiceBear animations: dbcrBob (3.4s), dbcrBlink (4.6s), dbcrSway (5.2s)
  'critters': {
    family: 'critters',
    frames: ['default', 'blink', 'look-left', 'look-right'],

    getFrame(t) {
      const blinkCycle = (t % 4.2) / 4.2;
      if (blinkCycle >= 0.90 && blinkCycle <= 0.97) return 'blink';

      const lookCycle = (t % 5.5) / 5.5;
      if (lookCycle >= 0.20 && lookCycle < 0.40) return 'look-right';
      if (lookCycle >= 0.60 && lookCycle < 0.80) return 'look-left';
      return 'default';
    },

    getTransform(t, characterHeight) {
      const bobPhase = (t % 3.4) / 3.4;
      const bobSin = Math.sin(bobPhase * Math.PI * 2);
      const translateY = -0.045 * characterHeight * Math.max(0, bobSin);

      const swayPhase = (t % 5.2) / 5.2;
      const rotate = Math.sin(swayPhase * Math.PI * 2) * (3.2 * Math.PI / 180);

      return { translateY, translateX: 0, rotate, scaleX: 1, scaleY: 1 };
    },

    isBlinking(t) {
      return this.getFrame(t) === 'blink';
    },

    getLookDirection(t) {
      const f = this.getFrame(t);
      return (f === 'look-left' || f === 'look-right') ? f : 'default';
    },

    getRecipeFrameOptions(baseOptions, frame) {
      const opts = { ...baseOptions };
      if (frame === 'blink') {
        opts.eyesVariant = ['closedLine'];
        opts.eyesProbability = 100;
      } else if (frame === 'look-right') {
        opts.eyesVariant = ['sideeye'];
        opts.eyesProbability = 100;
      }
      return opts;
    },

    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="dbcr-eb"/g, 'class="dbcr-eb" opacity="0.15"');
      }
      if (frame === 'look-left') {
        return svg.replace(
          /(<g id="eyes-[^"]+">)([\s\S]*?)(<\/g>)/,
          '$1<g transform="translate(-2.2 0)">$2</g>$3'
        );
      }
      if (frame === 'look-right') {
        return svg.replace(
          /(<g id="eyes-[^"]+">)([\s\S]*?)(<\/g>)/,
          '$1<g transform="translate(2.2 0)">$2</g>$3'
        );
      }
      return svg;
    }
  },

  // --- Gaze (Companion) ---
  // Native DiceBear animations: dbgaLook (6.4s), dbgaBlink (4.4s), dbgaHop (5.2s)
  'gaze': {
    family: 'gaze',
    frames: ['default', 'blink', 'look-left', 'look-right'],

    getFrame(t) {
      const blinkCycle = (t % 4.0) / 4.0;
      if (blinkCycle >= 0.91 && blinkCycle <= 0.97) return 'blink';

      // Matches dbgaLook: 24-38% left, 46-60% right
      const lookCycle = (t % 6.4) / 6.4;
      if (lookCycle >= 0.22 && lookCycle < 0.42) return 'look-left';
      if (lookCycle >= 0.46 && lookCycle < 0.66) return 'look-right';
      return 'default';
    },

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
          translateY = -0.065 * characterHeight * p;
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
      return this.getFrame(t) === 'blink';
    },

    getLookDirection(t) {
      const f = this.getFrame(t);
      return (f === 'look-left' || f === 'look-right') ? f : 'default';
    },

    getRecipeFrameOptions(baseOptions, frame) {
      const opts = { ...baseOptions };
      if (frame === 'blink') {
        opts.eyesVariant = ['squint'];
        opts.eyesProbability = 100;
      }
      return opts;
    },

    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="dbga-eye"/g, 'class="dbga-eye" opacity="0.1"');
      }
      if (frame === 'look-left') {
        return svg.replace(/class="dbga-look"/g, 'class="dbga-look" transform="translate(-3.6, 0.9)"');
      }
      if (frame === 'look-right') {
        return svg.replace(/class="dbga-look"/g, 'class="dbga-look" transform="translate(3.4, -0.7)"');
      }
      return svg;
    }
  },

  // --- Sprouts (Companion) ---
  // Native DiceBear animations: dbspSway (4.4s), dbspBlink (4.6s)
  'sprouts': {
    family: 'sprouts',
    frames: ['default', 'blink', 'look-left', 'look-right'],

    getFrame(t) {
      const blinkCycle = (t % 4.2) / 4.2;
      if (blinkCycle >= 0.90 && blinkCycle <= 0.97) return 'blink';

      const lookCycle = (t % 5.5) / 5.5;
      if (lookCycle >= 0.22 && lookCycle < 0.42) return 'look-right';
      if (lookCycle >= 0.62 && lookCycle < 0.82) return 'look-left';
      return 'default';
    },

    getTransform(t, characterHeight) {
      const swayPhase = (t % 4.4) / 4.4;
      const rotate = Math.sin(swayPhase * Math.PI * 2) * (2.8 * Math.PI / 180);
      return { translateY: 0, translateX: 0, rotate, scaleX: 1, scaleY: 1 };
    },

    isBlinking(t) {
      return this.getFrame(t) === 'blink';
    },

    getLookDirection(t) {
      const f = this.getFrame(t);
      return (f === 'look-left' || f === 'look-right') ? f : 'default';
    },

    getRecipeFrameOptions(baseOptions, frame) {
      const opts = { ...baseOptions };
      if (frame === 'blink') {
        opts.eyesVariant = ['closedLine'];
        opts.eyesProbability = 100;
      } else if (frame === 'look-right') {
        opts.eyesVariant = ['sideeye'];
        opts.eyesProbability = 100;
      }
      return opts;
    },

    makeFrameSvg(svg, frame) {
      if (frame === 'blink') {
        return svg.replace(/class="dbsp-e"/g, 'class="dbsp-e" opacity="0.15"');
      }
      if (frame === 'look-left') {
        return svg.replace(/class="dbsp-e"/g, 'class="dbsp-e" transform="translate(-2.0, 0)"');
      }
      if (frame === 'look-right') {
        return svg.replace(/class="dbsp-e"/g, 'class="dbsp-e" transform="translate(2.0, 0)"');
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
