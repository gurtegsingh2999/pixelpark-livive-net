/**
 * Avatar Animation Profiles
 * Isolates the exact animation timelines, multi-frame SVG generation, and procedural
 * transforms (both idle and movement locomotion) for each DiceBear style family.
 *
 * Each family defines:
 * - `getFrame(t)`: returns the active SVG frame ('default', 'blink', 'stretch', 'look-left', 'look-right', 'talk')
 * - `getTransform(t, characterHeight, { moving, movingT, direction })`: returns procedural
 *   { translateY, translateX, rotate, scaleX, scaleY, alpha, shadowScale, hologramGlow }
 *   tailored to how that specific creature/character moves and idles!
 */

export const ANIMATION_PROFILES = {
  // --- Voxel Art (Player & NPCs) ---
  // Bipedal humanoid:
  // - Idle: periodic upper-body stretch (.va-upper), eye glances left/right, blinking, talking
  // - Walking: crisp step hop arc
  'voxel-art': {
    family: 'voxel-art',
    frames: ['default', 'blink', 'stretch', 'look-left', 'look-right', 'talk'],

    getFrame(t) {
      const blinkCycle = (t % 3.2) / 3.2;
      if (blinkCycle >= 0.88 && blinkCycle <= 0.96) return 'blink';

      const stretchCycle = (t % 4.5) / 4.5;
      if (stretchCycle >= 0.72 && stretchCycle <= 0.86) return 'stretch';

      const actionCycle = (t % 6.0) / 6.0;
      if (actionCycle >= 0.15 && actionCycle < 0.30) return 'look-right';
      if (actionCycle >= 0.45 && actionCycle < 0.58) return 'talk';
      if (actionCycle >= 0.70 && actionCycle < 0.85) return 'look-left';

      return 'default';
    },

    getTransform(t, characterHeight, { moving = false, movingT = 0 } = {}) {
      if (moving) {
        // Bipedal step hop
        const hop = Math.sin(movingT * Math.PI);
        return {
          translateY: -characterHeight * 0.06 * hop,
          translateX: 0,
          rotate: 0,
          scaleX: 1,
          scaleY: 1,
          alpha: 1,
          shadowScale: 1 - 0.1 * hop
        };
      }

      const stretchCycle = (t % 4.5) / 4.5;
      let translateY = -Math.sin(t * 2.2) * 0.4;
      let scaleY = 1;
      let scaleX = 1;

      if (stretchCycle >= 0.70 && stretchCycle <= 0.88) {
        const p = Math.sin(((stretchCycle - 0.70) / 0.18) * Math.PI);
        translateY -= 0.02 * characterHeight * p;
        scaleY = 1 + 0.03 * p;
        scaleX = 1 - 0.015 * p;
      }
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY, alpha: 1, shadowScale: 1 };
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
        return svg.replace(/class="va-blink-[^"]+"\s+opacity="0"/g, match =>
          match.replace('opacity="0"', 'opacity="1"')
        );
      }
      if (frame === 'stretch') {
        return svg.replace(
          /<g class="va-upper">/g,
          '<g class="va-upper" transform="translate(0 -3.5)">'
        );
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

  // --- Voxel Bot (Companion) ---
  // Wheeled / Roller Robot:
  // - Has wheels/rollers for feet: NEVER hops when moving!
  // - Fluid rolling locomotion: stays planted at ground level (translateY: 0), tilts smoothly
  //   forward into its roll with a slight motor hum vibration.
  // - Idle: `.vb-upper` torso stretch + `.vb-head` lift, visor blink, screen expressions.
  'voxel-bot': {
    family: 'voxel-bot',
    frames: ['default', 'blink', 'stretch', 'look-left', 'look-right', 'talk'],

    getFrame(t) {
      const blinkCycle = (t % 3.4) / 3.4;
      if (blinkCycle >= 0.88 && blinkCycle <= 0.96) return 'blink';

      const stretchCycle = (t % 4.5) / 4.5;
      if (stretchCycle >= 0.70 && stretchCycle <= 0.86) return 'stretch';

      const actionCycle = (t % 5.8) / 5.8;
      if (actionCycle >= 0.18 && actionCycle < 0.34) return 'look-right';
      if (actionCycle >= 0.48 && actionCycle < 0.62) return 'talk';
      if (actionCycle >= 0.72 && actionCycle < 0.86) return 'look-left';

      return 'default';
    },

    getTransform(t, characterHeight, { moving = false, movingT = 0 } = {}) {
      if (moving) {
        // Fluid wheeled rolling effect:
        // Zero vertical hop (wheels stay firmly on the ground), smooth forward pitch tilt
        // as it accelerates and decelerates across the tile, plus subtle high-frequency roller hum.
        const rollCurve = Math.sin(movingT * Math.PI);
        const motorHum = Math.sin(t * 45) * 0.008;
        // Negative angle leans left (the sprite's forward direction; drawAvatar mirrors when facing right)
        const forwardLean = -(4.8 * Math.PI / 180) * rollCurve;

        return {
          translateY: 0,
          translateX: 0,
          rotate: forwardLean,
          scaleX: 1 + 0.025 * rollCurve,
          scaleY: 1 - 0.02 * rollCurve + motorHum,
          alpha: 1,
          shadowScale: 1.05
        };
      }

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
      return { translateY, translateX: 0, rotate: 0, scaleX, scaleY, alpha: 1, shadowScale: 1 };
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

  // --- Gaze (Companion) ---
  // Floating Hologram / "Digi-Buddy":
  // - Never touches the ground or hops: levitates continuously in mid-air!
  // - Smooth sinusoidal vertical hover + gentle figure-8 lateral drift + holographic shimmer/glow.
  // - When moving across tiles, glides weightlessly through the air without footsteps.
  'gaze': {
    family: 'gaze',
    frames: ['default', 'blink', 'look-left', 'look-right'],

    getFrame(t) {
      const blinkCycle = (t % 4.0) / 4.0;
      if (blinkCycle >= 0.91 && blinkCycle <= 0.97) return 'blink';

      const lookCycle = (t % 6.4) / 6.4;
      if (lookCycle >= 0.22 && lookCycle < 0.42) return 'look-left';
      if (lookCycle >= 0.46 && lookCycle < 0.66) return 'look-right';
      return 'default';
    },

    getTransform(t, characterHeight, { moving = false, movingT = 0 } = {}) {
      // Continuous mid-air levitation: always hovers ~18% of height above the ground
      // with a smooth, weightless sine-wave float and gentle figure-8 drift.
      const hoverWave = Math.sin(t * 2.6);
      const secondaryWave = Math.cos(t * 1.3);
      const baseHover = -0.18 * characterHeight;
      const floatOffset = -0.055 * characterHeight * hoverWave;
      const translateY = baseHover + floatOffset;
      const translateX = characterHeight * 0.03 * secondaryWave;

      // Subtle holographic tilt & breathing pulse; banks smoothly while gliding
      const glideBank = moving ? -(5.0 * Math.PI / 180) * Math.sin(movingT * Math.PI) : 0;
      const idleTilt = (2.2 * Math.PI / 180) * secondaryWave;
      const rotate = glideBank + idleTilt;

      const scaleX = 1 + 0.025 * hoverWave;
      const scaleY = 1 - 0.025 * hoverWave;

      // Digi-buddy holographic opacity shimmer (0.84 - 0.96)
      const alpha = 0.90 + 0.06 * Math.sin(t * 6.5);
      // Ground projection ring shrinks as the hologram floats higher
      const shadowScale = 0.68 - 0.14 * hoverWave;

      return {
        translateY,
        translateX,
        rotate,
        scaleX,
        scaleY,
        alpha,
        shadowScale,
        hologramGlow: true
      };
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

  // --- Critters (Companion) ---
  // Blob-ish Creature:
  // - Instead of hopping into the air, compresses down toward the ground (squishing vertically
  //   and spreading horizontally at the base) like slinking/scooting.
  // - Wobbles side-to-side as it walks, as if pushing one blob-foot in front of the other.
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

    getTransform(t, characterHeight, { moving = false, movingT = 0 } = {}) {
      if (moving) {
        // Slinking / blob-waddle locomotion:
        // 1. Compresses down toward the ground twice per tile step (two "foot" pushes per step)
        const slinkPush = Math.sin(movingT * Math.PI * 2);
        const compression = Math.abs(slinkPush); // 0 -> 1 -> 0 -> 1 -> 0
        // Squash down (scaleY < 1) and spread out wide (scaleX > 1) anchored at footY
        const scaleY = 1 - 0.18 * compression;
        const scaleX = 1 + 0.16 * compression;

        // 2. Side-to-side waddle wobble as it alternates pushing left/right "blob feet" forward
        const wobbleAngle = (7.5 * Math.PI / 180) * slinkPush;
        const translateX = characterHeight * 0.04 * slinkPush;

        return {
          translateY: 0, // Never leaves the ground! Compresses downward via scaleY around footY
          translateX,
          rotate: wobbleAngle,
          scaleX,
          scaleY,
          alpha: 1,
          shadowScale: 1 + 0.15 * compression
        };
      }

      // Idle: soft slinking compression towards the ground + gentle side-to-side blob wobble
      const slinkPhase = (t % 3.2) / 3.2;
      // Smooth compression pulse toward the ground (never lifts above 0)
      const compressPulse = Math.max(0, Math.sin(slinkPhase * Math.PI * 2));
      const scaleY = 1 - 0.08 * compressPulse;
      const scaleX = 1 + 0.07 * compressPulse;

      const swayPhase = (t % 4.4) / 4.4;
      const rotate = Math.sin(swayPhase * Math.PI * 2) * (3.5 * Math.PI / 180);

      return {
        translateY: 0,
        translateX: 0,
        rotate,
        scaleX,
        scaleY,
        alpha: 1,
        shadowScale: 1 + 0.07 * compressPulse
      };
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

    getTransform(t, characterHeight, { moving = false, movingT = 0 } = {}) {
      if (moving) {
        const hop = Math.sin(movingT * Math.PI);
        return {
          translateY: -characterHeight * 0.07 * hop,
          translateX: 0,
          rotate: Math.sin(movingT * Math.PI * 2) * (4 * Math.PI / 180),
          scaleX: 1 - 0.05 * hop,
          scaleY: 1 + 0.06 * hop,
          alpha: 1,
          shadowScale: 1 - 0.1 * hop
        };
      }

      const squashPhase = (t % 3.8) / 3.8;
      const squashSin = Math.sin(squashPhase * Math.PI * 2);
      const scaleX = 1 + 0.035 * squashSin;
      const scaleY = 1 - 0.045 * squashSin;

      const jigglePhase = (t % 5.2) / 5.2;
      const rotate = Math.sin(jigglePhase * Math.PI * 2) * (3.5 * Math.PI / 180);

      return { translateY: 0, translateX: 0, rotate, scaleX, scaleY, alpha: 1, shadowScale: 1 };
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

    getTransform(t, characterHeight, { moving = false, movingT = 0 } = {}) {
      if (moving) {
        const hop = Math.sin(movingT * Math.PI);
        return {
          translateY: -characterHeight * 0.08 * hop,
          translateX: 0,
          rotate: Math.sin(movingT * Math.PI * 2) * (5 * Math.PI / 180),
          scaleX: 1,
          scaleY: 1,
          alpha: 1,
          shadowScale: 1 - 0.1 * hop
        };
      }

      const swayPhase = (t % 4.4) / 4.4;
      const rotate = Math.sin(swayPhase * Math.PI * 2) * (2.8 * Math.PI / 180);
      return { translateY: 0, translateX: 0, rotate, scaleX: 1, scaleY: 1, alpha: 1, shadowScale: 1 };
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
  },

  // --- Cube World Animal Pets ---
  // Dog, Cat, Chicken, Chick, Horse, Pig, Sheep, Wolf, Raccoon
  'pet-dog': makePetProfile('dog', { trotHop: 0.05, wagTail: true, idleSniff: true }),
  'pet-cat': makePetProfile('cat', { trotHop: 0.03, sleek: true, idleSniff: false }),
  'pet-chicken': makePetProfile('chicken', { trotHop: 0.08, peck: true, idleSniff: false }),
  'pet-chick': makePetProfile('chick', { trotHop: 0.10, peck: true, idleSniff: false }),
  'pet-horse': makePetProfile('horse', { trotHop: 0.06, wagTail: false, idleSniff: true }),
  'pet-pig': makePetProfile('pig', { trotHop: 0.04, waddle: true, idleSniff: true }),
  'pet-sheep': makePetProfile('sheep', { trotHop: 0.04, waddle: true, idleSniff: true }),
  'pet-wolf': makePetProfile('wolf', { trotHop: 0.06, wagTail: true, idleSniff: true }),
  'pet-raccoon': makePetProfile('raccoon', { trotHop: 0.04, sleek: true, idleSniff: true })
};

function makePetProfile(species, { trotHop = 0.05, wagTail = false, peck = false, waddle = false, idleSniff = false } = {}) {
  return {
    family: `pet-${species}`,
    frames: ['default', 'idle2', 'walk1', 'walk2', 'cheer'],

    getFrame(t) {
      // 1. Idle head tilt / sniff / peck (every 4.0s for 0.8s)
      const idleCycle = (t % 4.0) / 4.0;
      if (idleCycle >= 0.70 && idleCycle <= 0.90) {
        return 'idle2';
      }
      return 'default';
    },

    getTransform(t, characterHeight, { moving = false, movingT = 0 } = {}) {
      if (moving) {
        // Quadruped trot / gallop:
        // Alternate walk frames (walk1 and walk2) based on movingT
        const hop = Math.sin(movingT * Math.PI);
        const waddleRotate = waddle ? Math.sin(movingT * Math.PI * 2) * (5.5 * Math.PI / 180) : 0;
        const trotPitch = peck ? Math.sin(movingT * Math.PI * 2) * (7.0 * Math.PI / 180) : 0;

        return {
          translateY: -characterHeight * trotHop * hop,
          translateX: 0,
          rotate: waddleRotate + trotPitch,
          scaleX: 1 + 0.03 * hop,
          scaleY: 1 - 0.02 * hop,
          alpha: 1,
          shadowScale: 1 - 0.12 * hop
        };
      }

      // Idle breathing and tail wag / sniff sway
      const breathe = Math.sin(t * 2.8) * 0.02;
      const tailSway = wagTail ? Math.sin(t * 7.5) * (3.0 * Math.PI / 180) : 0;
      const peckTilt = (peck && (t % 3.0) < 0.6) ? Math.sin(((t % 3.0) / 0.6) * Math.PI) * (8.0 * Math.PI / 180) : 0;

      return {
        translateY: -Math.abs(Math.sin(t * 1.8)) * 0.4,
        translateX: 0,
        rotate: tailSway + peckTilt,
        scaleX: 1 - breathe * 0.5,
        scaleY: 1 + breathe,
        alpha: 1,
        shadowScale: 1
      };
    },

    isBlinking() {
      return false;
    },

    getLookDirection() {
      return 'default';
    }
  };
}

/**
 * Returns the animation profile for a given recipe.
 */
export function getAnimationProfile(recipe) {
  if (!recipe) return ANIMATION_PROFILES['voxel-art'];
  if (recipe.isCompanion) {
    if (ANIMATION_PROFILES[`pet-${recipe.style}`]) {
      return ANIMATION_PROFILES[`pet-${recipe.style}`];
    }
    return ANIMATION_PROFILES[recipe.style] || ANIMATION_PROFILES['voxel-bot'];
  }
  return ANIMATION_PROFILES['voxel-art'];
}
