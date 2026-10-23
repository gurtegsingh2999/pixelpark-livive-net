export class FetchMiniGame {
  constructor({ game, onToast } = {}) {
    this.game = game;
    this.onToast = onToast || (() => {});
    this.activeBall = null; // { startX, startY, currentX, currentY, targetX, targetY, height, progress, state: 'flying'|'landed'|'fetching'|'returning', companionId, color }
  }

  canThrow() {
    return !this.activeBall && Boolean(this.game?.player);
  }

  throwBall({ targetTile, color = '#ff4757' } = {}) {
    if (!this.game?.player) return false;
    const player = this.game.player;
    const companion = this.game.getCompanionFor(player.id);

    if (!companion) {
      this.onToast('Your companion is not nearby to play fetch.');
      return false;
    }

    // Determine target tile if not specified
    let dest = targetTile;
    if (!dest) {
      // 3 tiles in the direction the player is facing
      const DIRS = [
        { dx: 0, dy: 3 },  // DOWN
        { dx: 3, dy: 0 },  // RIGHT
        { dx: 0, dy: -3 }, // UP
        { dx: -3, dy: 0 }  // LEFT
      ];
      const delta = DIRS[player.direction] || DIRS[0];
      dest = {
        x: Math.max(0, Math.min(63, player.x + delta.dx)),
        y: Math.max(0, Math.min(63, player.y + delta.dy))
      };
    }

    this.activeBall = {
      startX: player.x,
      startY: player.y,
      currentX: player.x,
      currentY: player.y,
      targetX: dest.x,
      targetY: dest.y,
      height: 0,
      progress: 0,
      color,
      state: 'flying',
      companionId: companion.id
    };

    this.onToast(`You threw the ball!`);
    return true;
  }

  update(dt) {
    if (!this.activeBall) return;
    const ball = this.activeBall;
    const companion = this.game.companions.find(c => c.id === ball.companionId);

    if (ball.state === 'flying') {
      ball.progress += dt * 2.2;
      const t = Math.min(1, ball.progress);
      ball.currentX = ball.startX + (ball.targetX - ball.startX) * t;
      ball.currentY = ball.startY + (ball.targetY - ball.startY) * t;
      // Parabolic arc for height (up to 40px)
      ball.height = Math.sin(t * Math.PI) * 45;

      if (ball.progress >= 1) {
        ball.state = 'landed';
        ball.currentX = ball.targetX;
        ball.currentY = ball.targetY;
        ball.height = 0;
        if (companion) {
          companion.fetchTarget = { x: ball.targetX, y: ball.targetY };
        }
      }
    } else if (ball.state === 'landed') {
      if (companion) {
        // Check if companion reached the ball
        const dist = Math.hypot(companion.x - ball.targetX, companion.y - ball.targetY);
        if (dist < 0.5) {
          ball.state = 'returning';
          companion.fetchTarget = null;
          companion.carryingBall = true;
          this.onToast(`${companion.name} fetched the ball!`);
        }
      }
    } else if (ball.state === 'returning') {
      if (companion && this.game.player) {
        // Companion carries ball back to player
        const player = this.game.player;
        const dist = Math.hypot(companion.x - player.x, companion.y - player.y);
        ball.currentX = companion.x;
        ball.currentY = companion.y;
        ball.height = 10; // held in mouth/paws

        if (dist <= 1.5) {
          companion.carryingBall = false;
          this.activeBall = null;
          this.onToast(`${companion.name} brought the ball back to you! Good buddy!`);
        }
      } else {
        this.activeBall = null;
      }
    }
  }

  render(ctx, camera) {
    if (!this.activeBall) return;
    const ball = this.activeBall;
    const TILE = 48;
    const screenX = (ball.currentX + 0.5) * TILE - camera.x;
    const screenY = (ball.currentY + 0.5) * TILE - camera.y;

    // Shadow on ground
    ctx.save();
    ctx.beginPath();
    const shadowScale = Math.max(0.3, 1 - ball.height / 60);
    ctx.ellipse(screenX, screenY + 4, 8 * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();

    // Ball
    ctx.beginPath();
    ctx.arc(screenX, screenY - ball.height, 7, 0, Math.PI * 2);
    ctx.fillStyle = ball.color || '#ff4757';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Shine highlight
    ctx.beginPath();
    ctx.arc(screenX - 2, screenY - ball.height - 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fill();
    ctx.restore();
  }
}
