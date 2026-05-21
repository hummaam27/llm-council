import Phaser from 'phaser';

// --- Dimensions -----------------------------------------------------------
const GRID = 25;                   // matches backend GRID_SIZE & town.json
const SRC_TILE = 16;
const SCALE = 3;
const TILE = SRC_TILE * SCALE;     // 48px
const MAP_PX = GRID * TILE;        // 1200px world
export const VIEW = 820;           // on-screen canvas size
export const MAP_PX_EXPORT = MAP_PX;

const CHAR_SCALE = 1.5;
const FOLK_COLS = 12;
const CHAR_PICK = [0, 3, 5, 2, 6, 1, 4, 7];
const DIR = { down: 0, left: 1, right: 2, up: 3 };

// Places that have a building PNG (composited from the tileset by
// scripts/build_town.py). 'commons' has no building — it gets the fountain.
const BUILDING_KEYS = ['market', 'town_hall', 'temple', 'archive', 'tavern', 'backstreet'];

export class SandboxScene extends Phaser.Scene {
  constructor() {
    super('sandbox');
  }

  init(data) {
    this.channel = data.channel;
    this.agents = {};
    this.bubbles = {};
    this.lastDialogueTick = {};
    this.built = false;
  }

  preload() {
    this.load.spritesheet('tiles', '/ai-town/rpg-tileset.png', {
      frameWidth: SRC_TILE, frameHeight: SRC_TILE,
    });
    this.load.spritesheet('folk', '/ai-town/32x32folk.png', {
      frameWidth: 32, frameHeight: 32,
    });
    this.load.json('town', '/ai-town/town.json');
    // Real building art, composited from the tileset by build_town.py.
    BUILDING_KEYS.forEach((k) => {
      this.load.image(`bld_${k}`, `/ai-town/buildings/${k}.png`);
    });
  }

  create() {
    this.cameras.main.setBackgroundColor('#5a7d4f');
    this.cameras.main.setBounds(0, 0, MAP_PX, MAP_PX);
    this.minZoom = VIEW / MAP_PX;            // fits the whole town
    this.cameras.main.setZoom(this.minZoom);
    this.cameras.main.centerOn(MAP_PX / 2, MAP_PX / 2);

    this.makeShadowTexture();
    this.makeFountainTexture();
    this.makeCharacterAnims();
    this.setupCameraControls();

    this.channel.scene = this;
    if (this.channel.state) this.syncState(this.channel.state);
  }

  // ------------------------------------------------------------ camera zoom/pan
  setupCameraControls() {
    const cam = this.cameras.main;
    this.input.on('wheel', (pointer, objs, dx, dy) => {
      const factor = dy > 0 ? 0.85 : 1.18;
      const z = Phaser.Math.Clamp(cam.zoom * factor, this.minZoom, 2.2);
      cam.setZoom(z);
    });
    this.input.on('pointermove', (pointer) => {
      if (!pointer.isDown) return;
      cam.scrollX -= (pointer.position.x - pointer.prevPosition.x) / cam.zoom;
      cam.scrollY -= (pointer.position.y - pointer.prevPosition.y) / cam.zoom;
    });
  }

  // ------------------------------------------------------------------ textures
  makeShadowTexture() {
    if (this.textures.exists('shadow')) return;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28);
    g.fillEllipse(13, 6, 26, 12);
    g.generateTexture('shadow', 26, 12);
    g.destroy();
  }

  makeFountainTexture() {
    // The Commons centrepiece — a small fountain.
    if (this.textures.exists('fountain')) return;
    const g = this.add.graphics();
    g.fillStyle(0x8a8694, 1); g.fillEllipse(34, 40, 64, 30);
    g.fillStyle(0xa6a2b0, 1); g.fillEllipse(34, 37, 56, 24);
    g.fillStyle(0x57b0d8, 1); g.fillEllipse(34, 35, 42, 16);
    g.fillStyle(0x82c8e6, 1); g.fillEllipse(34, 33, 24, 8);
    g.fillStyle(0xa6a2b0, 1); g.fillRect(30, 14, 8, 20);
    g.fillStyle(0x82c8e6, 1); g.fillEllipse(34, 13, 14, 8);
    g.generateTexture('fountain', 68, 56);
    g.destroy();
  }

  charFrames(k, d) {
    const blockCol = k % 4, blockRow = Math.floor(k / 4);
    const baseRow = blockRow * 4 + d, baseCol = blockCol * 3;
    const row = baseRow * FOLK_COLS;
    return [row + baseCol, row + baseCol + 1, row + baseCol + 2];
  }

  makeCharacterAnims() {
    for (let k = 0; k < 8; k++) {
      ['down', 'left', 'right', 'up'].forEach((dir) => {
        const key = `c${k}_${dir}`;
        if (this.anims.exists(key)) return;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers('folk', {
            frames: this.charFrames(k, DIR[dir]),
          }),
          frameRate: 8, repeat: -1,
        });
      });
    }
  }

  tileCenter(tx, ty) {
    return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }

  // ------------------------------------------------------------------- world
  buildWorld(state) {
    const town = this.cache.json.get('town');
    if (town) {
      const FLIP_H = 0x80000000, FLIP_V = 0x40000000, MASK = 0x1fffffff;
      const depth = { terrain: 0, bridge: 1, deco: 2 };
      ['terrain', 'bridge', 'deco'].forEach((name) => {
        const data = town.layers[name] || [];
        for (let i = 0; i < data.length; i++) {
          const raw = data[i];
          if (!raw) continue;
          const gid = raw & MASK;
          const lx = i % GRID, ly = Math.floor(i / GRID);
          const img = this.add.image(lx * TILE, ly * TILE, 'tiles', gid - 1)
            .setOrigin(0, 0).setScale(SCALE).setDepth(depth[name]);
          if (raw & FLIP_H) img.setFlipX(true);
          if (raw & FLIP_V) img.setFlipY(true);
        }
      });
    }

    // Place buildings + labels.
    (state.places || []).forEach((pl) => {
      const cx = (pl.x + pl.w / 2) * TILE;
      const cy = (pl.y + pl.h / 2) * TILE;
      let labelY = cy - 80;
      if (BUILDING_KEYS.includes(pl.key)) {
        const b = this.add.image(cx, cy + 14, `bld_${pl.key}`).setOrigin(0.5, 0.9);
        b.setScale((TILE * 4.6) / b.width);   // ~4.6 tiles wide
        b.setDepth(b.y);
        labelY = b.y - b.displayHeight * 0.92;
      } else if (pl.key === 'commons') {
        const f = this.add.image(cx, cy + 8, 'fountain').setOrigin(0.5, 0.8).setScale(2);
        f.setDepth(f.y);
        labelY = cy - 14;
      }
      // place label / sign
      const label = this.add.text(cx, labelY, pl.label, {
        fontFamily: 'monospace', fontSize: '15px', color: '#3a2e22',
        fontStyle: 'bold', backgroundColor: '#f5e9c8', padding: { x: 6, y: 3 },
      }).setOrigin(0.5, 0.5).setDepth(15000);
      label.setAlpha(0.92);
    });

    this.built = true;
  }

  // ------------------------------------------------------------------ agents
  createAgents(agents) {
    agents.forEach((a, idx) => {
      const k = CHAR_PICK[idx % CHAR_PICK.length];
      const { x, y } = this.tileCenter(a.x, a.y);
      const shadow = this.add.image(0, 16, 'shadow').setOrigin(0.5, 0.5);
      const sprite = this.add.sprite(0, 0, 'folk', this.charFrames(k, DIR.down)[1])
        .setOrigin(0.5, 0.82).setScale(CHAR_SCALE);
      const label = this.add.text(0, -38, a.name, {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5, 1);
      label.setStroke('#000000', 4);
      const coins = this.add.text(0, -25, `${a.coins ?? 0} coins`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffd9a0',
        fontStyle: 'bold',
      }).setOrigin(0.5, 1);
      coins.setStroke('#000000', 4);
      const activity = this.add.text(0, -11, '', {
        fontFamily: 'sans-serif', fontSize: '10px', color: '#ffe9a8',
        fontStyle: 'italic',
      }).setOrigin(0.5, 1);
      activity.setStroke('#000000', 3);

      const container = this.add.container(x, y, [shadow, sprite, label, coins, activity]);
      container.setDepth(y);
      this.agents[a.id] = {
        container, sprite, shadow, label, coins, activity,
        tx: a.x, ty: a.y, k, facing: 'down', curActivity: null, curCoins: a.coins ?? 0,
      };
    });
  }

  updateAgents(agents) {
    agents.forEach((a) => {
      const ent = this.agents[a.id];
      if (!ent) return;

      // activity caption
      if ((a.activity || null) !== ent.curActivity) {
        ent.curActivity = a.activity || null;
        ent.activity.setText(ent.curActivity ? `· ${ent.curActivity} ·` : '');
      }

      // coin count
      if (typeof a.coins === 'number' && a.coins !== ent.curCoins) {
        ent.curCoins = a.coins;
        ent.coins.setText(`${a.coins} coins`);
      }

      if (ent.tx === a.x && ent.ty === a.y) return;
      const dx = a.x - ent.tx, dy = a.y - ent.ty;
      let facing = ent.facing;
      if (dx < 0) facing = 'left';
      else if (dx > 0) facing = 'right';
      else if (dy < 0) facing = 'up';
      else if (dy > 0) facing = 'down';
      ent.facing = facing;
      ent.tx = a.x;
      ent.ty = a.y;

      const { x, y } = this.tileCenter(a.x, a.y);
      // Travel is place-to-place: scale the glide by distance so a long hop
      // reads as fast walking rather than a teleport.
      const dist = Math.hypot(dx, dy);
      const duration = Phaser.Math.Clamp(dist * 70, 320, 1300);
      ent.sprite.play(`c${ent.k}_${facing}`, true);
      this.tweens.add({
        targets: ent.container, x, y, duration, ease: 'Sine.inOut',
        onComplete: () => {
          ent.sprite.stop();
          ent.sprite.setFrame(this.charFrames(ent.k, DIR[ent.facing])[1]);
        },
      });
      this.tweens.add({
        targets: ent.sprite, y: { from: 0, to: -5 },
        duration: 170, yoyo: true,
        repeat: Math.max(1, Math.round(duration / 340)),
        ease: 'Quad.out',
      });
    });
  }

  updateDialogues(dialogues) {
    (dialogues || []).forEach((d) => {
      const prev = this.lastDialogueTick[d.agent_id];
      if (prev !== undefined && prev >= d.tick) return;
      this.lastDialogueTick[d.agent_id] = d.tick;
      this.showBubble(d.agent_id, d.text);
    });
  }

  showBubble(agentId, text) {
    const ent = this.agents[agentId];
    if (!ent) return;
    if (this.bubbles[agentId]) {
      this.bubbles[agentId].destroy();
      delete this.bubbles[agentId];
    }
    const msg = text.length > 70 ? text.slice(0, 69) + '…' : text;
    const txt = this.add.text(0, 0, msg, {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#1e293b',
      wordWrap: { width: 180 }, align: 'center',
    }).setOrigin(0.5, 0.5);
    const pad = 8, w = txt.width + pad * 2, h = txt.height + pad * 2;
    const bg = this.add.graphics();
    bg.fillStyle(0xffffff, 1);
    bg.lineStyle(2, 0xcbd5e1, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 7);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 7);
    bg.fillTriangle(-5, h / 2 - 1, 5, h / 2 - 1, 0, h / 2 + 7);
    const bubble = this.add.container(ent.container.x, 0, [bg, txt]);
    bubble.setDepth(20000);
    bubble.bubbleHeight = h;
    this.bubbles[agentId] = bubble;
    this.time.delayedCall(5200, () => {
      if (this.bubbles[agentId] === bubble) {
        this.tweens.add({
          targets: bubble, alpha: 0, duration: 400,
          onComplete: () => bubble.destroy(),
        });
        delete this.bubbles[agentId];
      }
    });
  }

  teardown() {
    this.tweens.killAll();
    this.children.removeAll(true);
    this.agents = {};
    this.bubbles = {};
    this.lastDialogueTick = {};
    this.built = false;
  }

  // ----------------------------------------------------------- React channel
  syncState(state) {
    if (!state) return;
    const agents = state.agents || [];
    if (agents.length === 0) {
      if (this.built) this.teardown();
      return;
    }
    if (!this.built) {
      this.buildWorld(state);
      this.createAgents(agents);
    } else if (Object.keys(this.agents).length === 0) {
      this.createAgents(agents);
    } else {
      this.updateAgents(agents);
    }
    this.updateDialogues(state.dialogues);
  }

  update() {
    Object.values(this.agents).forEach((e) => {
      e.container.setDepth(e.container.y);
    });
    Object.entries(this.bubbles).forEach(([id, bubble]) => {
      const ent = this.agents[id];
      if (!ent) return;
      bubble.x = ent.container.x;
      bubble.y = ent.container.y - TILE * 0.9 - (bubble.bubbleHeight || 0) / 2;
    });
  }
}

export function createSandboxGame(parent, channel) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW,
    height: VIEW,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#5a7d4f',
  });
  game.scene.add('sandbox', SandboxScene, true, { channel });
  return game;
}
