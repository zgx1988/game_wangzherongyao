import { soundEngine } from '../audio/SoundEngine';
import { GameRenderer } from '../render/GameRenderer';
import { LANE_WAYPOINTS_BLUE, MAP_SIZE, QUICK_CHAT_MESSAGES } from '../sim/constants';
import { HEROES, SUMMONER_SKILLS } from '../sim/heroes';
import { ITEMS, ITEM_LIST, getNetItemCost, getQuickBuySuggestions } from '../sim/items';
import {
  GameEvent,
  HeroState,
  PlayerInput,
  TargetPriority,
  Team,
  WorldSnapshot,
} from '../sim/types';

export interface HudCallbacks {
  onExitMatch: () => void;
}

export class HudController {
  private root: HTMLElement;
  private renderer: GameRenderer;
  private callbacks: HudCallbacks;

  // Input state
  private keys = new Set<string>();
  private joyX = 0;
  private joyZ = 0;
  private joyActive = false;
  private joyPointerId: number | null = null;
  private joyCenter = { x: 0, y: 0 };
  private rightClickTarget: { x: number; z: number } | null = null;
  private attackHeld = false;
  private targetPriority: TargetPriority = 'auto';
  private mouseWorld: { x: number; z: number } = { x: 80, z: 80 };

  // Queued one-shot actions
  private pendingSkill: PlayerInput['castSkill'] = null;
  private pendingSummoner: PlayerInput['castSummoner'] = null;
  private pendingHeal = false;
  private pendingRecall = false;
  private pendingUpgrade: 0 | 1 | 2 | null = null;
  private pendingBuyItem: string | null = null;
  private pendingSellSlot: number | null = null;
  private pendingChat: string | null = null;

  // Skill drag-to-aim state
  private aimingSlot: 0 | 1 | 2 | null = null;
  private aimPointerId: number | null = null;
  private aimOrigin = { x: 0, y: 0 };
  private aimVec = { x: 0, z: 0 };

  // UI elements
  private minimapCanvas!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private minimapDragging = false;
  private scoreBlueEl!: HTMLElement;
  private scoreRedEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private kdaEl!: HTMLElement;
  private goldEl!: HTMLElement;
  private pingEl!: HTMLElement;
  private quickBuyContainer!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bannerTimer = 0;
  private chatFeedEl!: HTMLElement;
  private buffBarEl!: HTMLElement;
  private hpFillEl!: HTMLElement;
  private mpFillEl!: HTMLElement;
  private hpTextEl!: HTMLElement;
  private levelTextEl!: HTMLElement;
  private deathBannerEl!: HTMLElement;
  private joyThumbEl!: HTMLElement;
  private joyBaseEl!: HTMLElement;
  private skillBtns: HTMLElement[] = [];
  private skillCdEls: HTMLElement[] = [];
  private skillUpBtns: HTMLElement[] = [];
  private skillDotsEls: HTMLElement[] = [];
  private summonerBtn!: HTMLElement;
  private summonerCdEl!: HTMLElement;
  private healBtn!: HTMLElement;
  private healCdEl!: HTMLElement;
  private recallBtn!: HTMLElement;

  // Modals
  private shopModal!: HTMLElement;
  private shopGridEl!: HTMLElement;
  private shopOwnedEl!: HTMLElement;
  private shopGoldEl!: HTMLElement;
  private shopCategory: 'rec' | 'attack' | 'magic' | 'defense' | 'boots' | 'jungle' = 'rec';
  private shopOpen = false;

  private scoreboardModal!: HTMLElement;
  private scoreboardBody!: HTMLElement;
  private scoreboardOpen = false;

  private settingsModal!: HTMLElement;
  private chatMenuEl!: HTMLElement;

  private latestSnap: WorldSnapshot | null = null;
  private localHeroId = 'blue_0';
  private lastQuickBuySig = '';
  private lastShopSig = '';
  private fpsFrames = 0;
  private fpsTime = performance.now();
  private fpsValue = 60;

  constructor(container: HTMLElement, renderer: GameRenderer, callbacks: HudCallbacks) {
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'hud-root';
    container.appendChild(this.root);

    this.buildDom();
    this.bindEvents();
  }

  private buildDom(): void {
    this.root.innerHTML = `
      <!-- TOP LEFT: Interactive Minimap -->
      <div class="hud-minimap-wrap">
        <canvas class="hud-minimap" width="168" height="168"></canvas>
        <div class="hud-minimap-label">王者峡谷</div>
      </div>

      <!-- TOP CENTER: Scoreboard & Match Timer -->
      <div class="hud-topbar" id="hudTopBar" title="点击或按 Tab 查看对局战绩">
        <div class="hud-score-team blue"><span id="hudBlueKills">0</span></div>
        <div class="hud-timer-box">
          <div id="hudTimer" class="hud-timer">00:00</div>
          <div id="hudKda" class="hud-kda">0 / 0 / 0 · 补刀 0</div>
        </div>
        <div class="hud-score-team red"><span id="hudRedKills">0</span></div>
      </div>

      <!-- TOP RIGHT: Ping, Quick Chat, Settings -->
      <div class="hud-topright">
        <div id="hudPing" class="hud-pill">60 FPS · 本地</div>
        <button id="hudScoreBtn" class="hud-icon-btn" title="战绩面板 (Tab)">📊</button>
        <button id="hudChatBtn" class="hud-icon-btn" title="快捷语音消息">💬</button>
        <button id="hudSettingsBtn" class="hud-icon-btn" title="设置与音频">⚙️</button>
      </div>

      <!-- QUICK CHAT POPOVER -->
      <div id="hudChatMenu" class="hud-chat-menu hidden">
        ${QUICK_CHAT_MESSAGES.map((m) => `<button class="hud-chat-opt" data-msg="${m}">${m}</button>`).join('')}
      </div>

      <!-- CENTER ANNOUNCEMENT BANNER -->
      <div id="hudBanner" class="hud-banner hidden"></div>

      <!-- CHAT / KILL FEED -->
      <div id="hudChatFeed" class="hud-chat-feed"></div>

      <!-- LEFT EDGE: Gold + Shop + HoK Quick Buy -->
      <div class="hud-left-shop">
        <button id="hudShopOpenBtn" class="hud-gold-btn" title="打开装备商店 (P)">
          <span class="gold-coin">🪙</span>
          <span id="hudGold">360</span>
          <span class="shop-tag">商店</span>
        </button>
        <div id="hudQuickBuy" class="hud-quick-buy"></div>
      </div>

      <!-- DEATH RESPAWN OVERLAY -->
      <div id="hudDeathBanner" class="hud-death-banner hidden"></div>

      <!-- BOTTOM LEFT: Virtual Joystick -->
      <div class="hud-joystick-zone" id="hudJoyZone">
        <div class="hud-joystick-base" id="hudJoyBase">
          <div class="hud-joystick-thumb" id="hudJoyThumb"></div>
        </div>
      </div>

      <!-- BOTTOM CENTER: Buffs, Hero Vitals, Utility Spells (Recall / Restore / Summoner) -->
      <div class="hud-bottom-center">
        <div id="hudBuffBar" class="hud-buff-bar"></div>
        <div class="hud-util-row">
          <button id="hudRecallBtn" class="hud-util-btn" title="回城 (B)">
            <span class="u-icon">🌀</span>
            <span class="u-label">回城</span>
            <span class="u-key">B</span>
          </button>
          <button id="hudHealBtn" class="hud-util-btn" title="恢复生命与法力 (H)">
            <span class="u-icon">💖</span>
            <span class="u-label">恢复</span>
            <span class="u-key">H</span>
            <div id="hudHealCd" class="cd-overlay hidden"></div>
          </button>
          <button id="hudSummonerBtn" class="hud-util-btn summoner" title="召唤师技能 (F)">
            <span class="u-icon" id="hudSummonerIcon">⚡</span>
            <span class="u-label" id="hudSummonerLabel">闪现</span>
            <span class="u-key">F</span>
            <div id="hudSummonerCd" class="cd-overlay hidden"></div>
          </button>
        </div>
        <div class="hud-vitals-bar">
          <span id="hudLevelText" class="hud-lv-pill">Lv.1</span>
          <div class="hud-bars-stack">
            <div class="hud-hp-track">
              <div id="hudHpFill" class="hud-hp-fill" style="width:100%"></div>
              <span id="hudHpText" class="hud-hp-text">3500 / 3500</span>
            </div>
            <div class="hud-mp-track">
              <div id="hudMpFill" class="hud-mp-fill" style="width:100%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- BOTTOM RIGHT: Authentic HoK Radial Skill Wheel & Attack Cluster -->
      <div class="hud-combat-cluster">
        <!-- Skill 1 (Bottom-Left of arc) -->
        <div class="skill-slot slot-0">
          <button class="skill-up-btn hidden" data-up="0">+</button>
          <button class="skill-btn" data-slot="0" title="一技能 (Q / 1 / U)">
            <span class="sk-icon">⚔️</span>
            <span class="sk-name">技能1</span>
            <span class="sk-key">Q/1</span>
            <div class="cd-overlay hidden"></div>
          </button>
          <div class="skill-dots" data-dots="0"></div>
        </div>

        <!-- Skill 2 (Middle-Top-Left of arc) -->
        <div class="skill-slot slot-1">
          <button class="skill-up-btn hidden" data-up="1">+</button>
          <button class="skill-btn" data-slot="1" title="二技能 (E / 2 / I)">
            <span class="sk-icon">🛡️</span>
            <span class="sk-name">技能2</span>
            <span class="sk-key">E/2</span>
            <div class="cd-overlay hidden"></div>
          </button>
          <div class="skill-dots" data-dots="1"></div>
        </div>

        <!-- Skill 3 Ultimate (Top of arc) -->
        <div class="skill-slot slot-2">
          <button class="skill-up-btn hidden" data-up="2">+</button>
          <button class="skill-btn ult" data-slot="2" title="终极技能 (R / 3 / O)">
            <span class="sk-icon">👑</span>
            <span class="sk-name">大招</span>
            <span class="sk-key">R/3</span>
            <div class="cd-overlay hidden"></div>
          </button>
          <div class="skill-dots" data-dots="2"></div>
        </div>

        <!-- Target Lock buttons: Minion & Tower -->
        <button id="hudMinionAtk" class="sub-atk-btn minion-atk" title="补刀优先攻击小兵">补刀</button>
        <button id="hudTowerAtk" class="sub-atk-btn tower-atk" title="推塔优先攻击防御塔">推塔</button>

        <!-- Primary Attack Button -->
        <button id="hudBasicAtk" class="basic-atk-btn" title="普通攻击 (Space / J)">
          <span>普攻</span>
          <small>SPACE</small>
        </button>
      </div>

      <!-- PC Controls Hint -->
      <div class="hud-pc-hint">WASD/右键移动 · Space/J普攻 · Q/E/R(或1/2/3)技能 · F召唤师 · B回城 · P商店 · Tab战绩</div>

      <!-- EQUIPMENT SHOP MODAL -->
      <div id="hudShopModal" class="modal-backdrop hidden">
        <div class="modal-panel shop-panel">
          <div class="modal-header">
            <h3>⚔️ 峡谷装备商店</h3>
            <div class="shop-gold-pill">🪙 <span id="shopGoldVal">0</span></div>
            <button id="shopCloseBtn" class="modal-close">✕</button>
          </div>
          <div class="shop-tabs">
            <button class="shop-tab active" data-cat="rec">推荐</button>
            <button class="shop-tab" data-cat="attack">攻击</button>
            <button class="shop-tab" data-cat="magic">法术</button>
            <button class="shop-tab" data-cat="defense">防御</button>
            <button class="shop-tab" data-cat="boots">移动</button>
            <button class="shop-tab" data-cat="jungle">打野</button>
          </div>
          <div id="shopGrid" class="shop-grid"></div>
          <div class="shop-owned-bar">
            <span class="owned-title">已购装备（点击可65%折价出售）:</span>
            <div id="shopOwnedSlots" class="shop-owned-slots"></div>
          </div>
        </div>
      </div>

      <!-- SCOREBOARD MODAL -->
      <div id="hudScoreboardModal" class="modal-backdrop hidden">
        <div class="modal-panel scoreboard-panel">
          <div class="modal-header">
            <h3>🏆 5v5 对局实时战绩</h3>
            <button id="scoreCloseBtn" class="modal-close">✕</button>
          </div>
          <div id="scoreboardBody" class="scoreboard-body"></div>
        </div>
      </div>

      <!-- SETTINGS MODAL -->
      <div id="hudSettingsModal" class="modal-backdrop hidden">
        <div class="modal-panel settings-panel">
          <div class="modal-header">
            <h3>⚙️ 战场设置</h3>
            <button id="settingsCloseBtn" class="modal-close">✕</button>
          </div>
          <div class="settings-list">
            <label class="setting-row">
              <span>背景音乐音量 (BGM)</span>
              <input id="setBgmVol" type="range" min="0" max="1" step="0.05" value="${soundEngine.bgmVolume}" />
            </label>
            <label class="setting-row">
              <span>战斗音效音量 (SFX)</span>
              <input id="setSfxVol" type="range" min="0" max="1" step="0.05" value="${soundEngine.sfxVolume}" />
            </label>
            <label class="setting-row">
              <span>中文战场语音播报</span>
              <input id="setVoice" type="checkbox" ${soundEngine.voiceEnabled ? 'checked' : ''} />
            </label>
            <label class="setting-row">
              <span>高画质动态阴影 (3D抗锯齿)</span>
              <input id="setQuality" type="checkbox" checked />
            </label>
            <label class="setting-row">
              <span>红方镜像翻转视角</span>
              <input id="setFlipCam" type="checkbox" ${this.renderer.flipForRed ? 'checked' : ''} />
            </label>
          </div>
          <div class="settings-actions">
            <button id="exitMatchBtn" class="btn-danger">退出本局并返回大厅</button>
          </div>
        </div>
      </div>
    `;

    this.minimapCanvas = this.root.querySelector('.hud-minimap') as HTMLCanvasElement;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.scoreBlueEl = this.root.querySelector('#hudBlueKills')!;
    this.scoreRedEl = this.root.querySelector('#hudRedKills')!;
    this.timerEl = this.root.querySelector('#hudTimer')!;
    this.kdaEl = this.root.querySelector('#hudKda')!;
    this.goldEl = this.root.querySelector('#hudGold')!;
    this.pingEl = this.root.querySelector('#hudPing')!;
    this.quickBuyContainer = this.root.querySelector('#hudQuickBuy')!;
    this.bannerEl = this.root.querySelector('#hudBanner')!;
    this.chatFeedEl = this.root.querySelector('#hudChatFeed')!;
    this.buffBarEl = this.root.querySelector('#hudBuffBar')!;
    this.hpFillEl = this.root.querySelector('#hudHpFill')!;
    this.mpFillEl = this.root.querySelector('#hudMpFill')!;
    this.hpTextEl = this.root.querySelector('#hudHpText')!;
    this.levelTextEl = this.root.querySelector('#hudLevelText')!;
    this.deathBannerEl = this.root.querySelector('#hudDeathBanner')!;
    this.joyThumbEl = this.root.querySelector('#hudJoyThumb')!;
    this.joyBaseEl = this.root.querySelector('#hudJoyBase')!;
    this.summonerBtn = this.root.querySelector('#hudSummonerBtn')!;
    this.summonerCdEl = this.root.querySelector('#hudSummonerCd')!;
    this.healBtn = this.root.querySelector('#hudHealBtn')!;
    this.healCdEl = this.root.querySelector('#hudHealCd')!;
    this.recallBtn = this.root.querySelector('#hudRecallBtn')!;

    this.shopModal = this.root.querySelector('#hudShopModal')!;
    this.shopGridEl = this.root.querySelector('#shopGrid')!;
    this.shopOwnedEl = this.root.querySelector('#shopOwnedSlots')!;
    this.shopGoldEl = this.root.querySelector('#shopGoldVal')!;
    this.scoreboardModal = this.root.querySelector('#hudScoreboardModal')!;
    this.scoreboardBody = this.root.querySelector('#scoreboardBody')!;
    this.settingsModal = this.root.querySelector('#hudSettingsModal')!;
    this.chatMenuEl = this.root.querySelector('#hudChatMenu')!;

    for (let i = 0; i < 3; i++) {
      const btn = this.root.querySelector(`.skill-btn[data-slot="${i}"]`) as HTMLElement;
      this.skillBtns.push(btn);
      this.skillCdEls.push(btn.querySelector('.cd-overlay') as HTMLElement);
      this.skillUpBtns.push(this.root.querySelector(`.skill-up-btn[data-up="${i}"]`) as HTMLElement);
      this.skillDotsEls.push(this.root.querySelector(`.skill-dots[data-dots="${i}"]`) as HTMLElement);
    }
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointermove', this.onGlobalPointerMove);
    window.addEventListener('pointerup', this.onGlobalPointerUp);
    window.addEventListener('pointercancel', this.onGlobalPointerUp);

    // Canvas Right-Click move & mouse tracking on PC
    const canvas = this.renderer.renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      soundEngine.unlock();
      if (e.button === 2) {
        const w = this.renderer.screenToWorld(e.clientX, e.clientY);
        if (w) {
          this.rightClickTarget = w;
          this.renderer.showMoveMarker(w.x, w.z);
        }
      }
    });

    // Virtual Joystick touch/mouse
    const joyZone = this.root.querySelector('#hudJoyZone') as HTMLElement;
    joyZone.addEventListener('pointerdown', (e) => {
      soundEngine.unlock();
      e.stopPropagation();
      const rect = this.joyBaseEl.getBoundingClientRect();
      this.joyActive = true;
      this.joyPointerId = e.pointerId;
      this.joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.updateJoystick(e.clientX, e.clientY);
    });

    // Basic Attack, Minion Lock, Tower Lock buttons
    const bindHoldBtn = (sel: string, priority: TargetPriority) => {
      const btn = this.root.querySelector(sel) as HTMLElement;
      btn.addEventListener('pointerdown', (e) => {
        soundEngine.unlock();
        e.stopPropagation();
        this.attackHeld = true;
        this.targetPriority = priority;
        btn.classList.add('pressed');
      });
      const release = () => {
        this.attackHeld = false;
        this.targetPriority = 'auto';
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
    };
    bindHoldBtn('#hudBasicAtk', 'auto');
    bindHoldBtn('#hudMinionAtk', 'minion');
    bindHoldBtn('#hudTowerAtk', 'tower');

    // Skill buttons (supports tap to smart-cast AND drag-to-aim!)
    this.skillBtns.forEach((btn, idx) => {
      const slot = idx as 0 | 1 | 2;
      btn.addEventListener('pointerdown', (e) => {
        soundEngine.unlock();
        e.stopPropagation();
        this.aimingSlot = slot;
        this.aimPointerId = e.pointerId;
        const rect = btn.getBoundingClientRect();
        this.aimOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        this.aimVec = { x: 0, z: 0 };
        btn.classList.add('aiming');
      });
    });

    // Skill upgrade buttons (+)
    this.skillUpBtns.forEach((btn, idx) => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        soundEngine.unlock();
        this.pendingUpgrade = idx as 0 | 1 | 2;
      });
    });

    // Utility spells (Recall, Heal, Summoner)
    this.recallBtn.addEventListener('click', () => {
      soundEngine.unlock();
      this.pendingRecall = true;
    });
    this.healBtn.addEventListener('click', () => {
      soundEngine.unlock();
      this.pendingHeal = true;
    });
    this.summonerBtn.addEventListener('click', () => {
      soundEngine.unlock();
      this.fireSummoner();
    });

    // Minimap camera pan
    this.minimapCanvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.minimapDragging = true;
      this.panFromMinimap(e.clientX, e.clientY);
    });

    // Topbar & Modals
    this.root.querySelector('#hudTopBar')!.addEventListener('click', () => this.toggleScoreboard());
    this.root.querySelector('#hudScoreBtn')!.addEventListener('click', () => this.toggleScoreboard());
    this.root.querySelector('#scoreCloseBtn')!.addEventListener('click', () => this.toggleScoreboard(false));
    this.root.querySelector('#hudShopOpenBtn')!.addEventListener('click', () => this.toggleShop());
    this.root.querySelector('#shopCloseBtn')!.addEventListener('click', () => this.toggleShop(false));
    this.root.querySelector('#hudSettingsBtn')!.addEventListener('click', () => {
      this.settingsModal.classList.toggle('hidden');
    });
    this.root.querySelector('#settingsCloseBtn')!.addEventListener('click', () => {
      this.settingsModal.classList.add('hidden');
    });
    this.root.querySelector('#hudChatBtn')!.addEventListener('click', () => {
      this.chatMenuEl.classList.toggle('hidden');
    });
    this.chatMenuEl.querySelectorAll('.hud-chat-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.pendingChat = (btn as HTMLElement).dataset.msg || null;
        this.chatMenuEl.classList.add('hidden');
      });
    });

    // Shop category tabs
    this.root.querySelectorAll('.shop-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.root.querySelectorAll('.shop-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.shopCategory = ((tab as HTMLElement).dataset.cat as typeof this.shopCategory) || 'rec';
        this.lastShopSig = '';
        this.renderShopIfOpen();
      });
    });

    // Settings inputs
    const bgmSlider = this.root.querySelector('#setBgmVol') as HTMLInputElement;
    const sfxSlider = this.root.querySelector('#setSfxVol') as HTMLInputElement;
    const voiceCheck = this.root.querySelector('#setVoice') as HTMLInputElement;
    const qualCheck = this.root.querySelector('#setQuality') as HTMLInputElement;
    const flipCheck = this.root.querySelector('#setFlipCam') as HTMLInputElement;
    const applyAudio = () => soundEngine.setVolumes(Number(bgmSlider.value), Number(sfxSlider.value), voiceCheck.checked);
    bgmSlider.addEventListener('input', applyAudio);
    sfxSlider.addEventListener('input', applyAudio);
    voiceCheck.addEventListener('change', applyAudio);
    qualCheck.addEventListener('change', () => this.renderer.setQuality(qualCheck.checked));
    flipCheck.addEventListener('change', () => {
      this.renderer.flipForRed = flipCheck.checked;
    });
    this.root.querySelector('#exitMatchBtn')!.addEventListener('click', () => {
      this.callbacks.onExitMatch();
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    soundEngine.unlock();
    const k = e.key.toLowerCase();
    this.keys.add(k);

    if (k === 'p') {
      this.toggleShop();
      return;
    }
    if (k === 'tab') {
      e.preventDefault();
      this.toggleScoreboard(true);
      return;
    }
    if (k === 'escape') {
      this.toggleShop(false);
      this.toggleScoreboard(false);
      this.settingsModal.classList.add('hidden');
      return;
    }

    // Skill shortcuts: Q/1/U (Skill 1), E/2/I (Skill 2), R/3/O (Ult) — ZERO conflict with WASD!
    if (k === 'q' || k === '1' || k === 'u') {
      if (e.ctrlKey) this.pendingUpgrade = 0;
      else this.fireSkillFromCursor(0);
    } else if (k === 'e' || k === '2' || k === 'i') {
      if (e.ctrlKey) this.pendingUpgrade = 1;
      else this.fireSkillFromCursor(1);
    } else if (k === 'r' || k === '3' || k === 'o') {
      if (e.ctrlKey) this.pendingUpgrade = 2;
      else this.fireSkillFromCursor(2);
    } else if (k === 'f') {
      this.fireSummoner();
    } else if (k === 'h') {
      this.pendingHeal = true;
    } else if (k === 'b') {
      this.pendingRecall = true;
    } else if (k === ' ' || k === 'j') {
      e.preventDefault();
      this.attackHeld = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (k === ' ' || k === 'j') this.attackHeld = false;
    if (k === 'tab') this.toggleScoreboard(false);
  };

  private onGlobalPointerMove = (e: PointerEvent) => {
    // Track world cursor for PC aiming
    const w = this.renderer.screenToWorld(e.clientX, e.clientY);
    if (w) this.mouseWorld = w;

    if (this.joyActive && e.pointerId === this.joyPointerId) {
      this.updateJoystick(e.clientX, e.clientY);
    }
    if (this.aimingSlot !== null && e.pointerId === this.aimPointerId) {
      const dx = e.clientX - this.aimOrigin.x;
      const dy = e.clientY - this.aimOrigin.y;
      const distPx = Math.hypot(dx, dy);
      const flip = this.renderer.flipForRed ? -1 : 1;
      if (distPx > 14) {
        this.aimVec = {
          x: (dx / distPx) * flip,
          z: (dy / distPx) * flip,
        };
      }
      this.updateSkillAimVisual();
    }
    if (this.minimapDragging) {
      this.panFromMinimap(e.clientX, e.clientY);
    }
  };

  private onGlobalPointerUp = (e: PointerEvent) => {
    if (this.joyActive && e.pointerId === this.joyPointerId) {
      this.joyActive = false;
      this.joyPointerId = null;
      this.joyX = 0;
      this.joyZ = 0;
      this.joyThumbEl.style.transform = 'translate(-50%, -50%)';
    }

    if (this.aimingSlot !== null && e.pointerId === this.aimPointerId) {
      const slot = this.aimingSlot;
      this.skillBtns[slot]?.classList.remove('aiming');
      this.renderer.vfx.setAimPreview(false);

      const hero = this.getLocalHero();
      const range = hero ? HEROES[hero.heroId].skills[slot].range : 12;
      const hasDrag = Math.hypot(this.aimVec.x, this.aimVec.z) > 0.1;
      this.pendingSkill = {
        slot,
        dirX: hasDrag ? this.aimVec.x : 0,
        dirZ: hasDrag ? this.aimVec.z : 0,
        targetX: hero ? hero.x + (hasDrag ? this.aimVec.x * Math.min(range, 11) : 0) : 80,
        targetZ: hero ? hero.z + (hasDrag ? this.aimVec.z * Math.min(range, 11) : 0) : 80,
      };
      this.aimingSlot = null;
      this.aimPointerId = null;
    }

    if (this.minimapDragging) {
      this.minimapDragging = false;
      this.renderer.clearManualCameraPan();
    }
  };

  private updateJoystick(clientX: number, clientY: number): void {
    const maxR = 46;
    const dx = clientX - this.joyCenter.x;
    const dy = clientY - this.joyCenter.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(maxR, dist);
    const nx = dist > 4 ? dx / dist : 0;
    const ny = dist > 4 ? dy / dist : 0;
    this.joyThumbEl.style.transform = `translate(calc(-50% + ${nx * clamped}px), calc(-50% + ${ny * clamped}px))`;

    const flip = this.renderer.flipForRed ? -1 : 1;
    const mag = clamped / maxR;
    this.joyX = nx * mag * flip;
    this.joyZ = ny * mag * flip;
    if (mag > 0.1) this.rightClickTarget = null;
  }

  private updateSkillAimVisual(): void {
    if (this.aimingSlot === null) return;
    const hero = this.getLocalHero();
    if (!hero) return;
    const sk = HEROES[hero.heroId].skills[this.aimingSlot];
    const dirX = Math.hypot(this.aimVec.x, this.aimVec.z) > 0.1 ? this.aimVec.x : Math.sin(hero.facing);
    const dirZ = Math.hypot(this.aimVec.x, this.aimVec.z) > 0.1 ? this.aimVec.z : Math.cos(hero.facing);
    this.renderer.vfx.setAimPreview(true, {
      x: hero.x,
      z: hero.z,
      type: sk.targetType,
      range: sk.range,
      radius: sk.radius,
      dirX,
      dirZ,
      targetX: hero.x + dirX * Math.min(sk.range * 0.72, 12),
      targetZ: hero.z + dirZ * Math.min(sk.range * 0.72, 12),
    });
  }

  private fireSkillFromCursor(slot: 0 | 1 | 2): void {
    const hero = this.getLocalHero();
    if (!hero) return;
    const dx = this.mouseWorld.x - hero.x;
    const dz = this.mouseWorld.z - hero.z;
    const d = Math.hypot(dx, dz);
    this.pendingSkill = {
      slot,
      dirX: d > 0.5 ? dx / d : 0,
      dirZ: d > 0.5 ? dz / d : 0,
      targetX: this.mouseWorld.x,
      targetZ: this.mouseWorld.z,
    };
  }

  private fireSummoner(): void {
    const hero = this.getLocalHero();
    let dirX = this.joyX;
    let dirZ = this.joyZ;
    if (Math.hypot(dirX, dirZ) < 0.1 && hero) {
      const dx = this.mouseWorld.x - hero.x;
      const dz = this.mouseWorld.z - hero.z;
      const d = Math.hypot(dx, dz) || 1;
      dirX = dx / d;
      dirZ = dz / d;
    }
    this.pendingSummoner = { dirX, dirZ };
  }

  private panFromMinimap(clientX: number, clientY: number): void {
    const rect = this.minimapCanvas.getBoundingClientRect();
    let u = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let v = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    if (this.renderer.flipForRed) {
      u = 1 - u;
      v = 1 - v;
    }
    this.renderer.setManualCameraPan(u * MAP_SIZE, v * MAP_SIZE);
  }

  private getLocalHero(): HeroState | undefined {
    return this.latestSnap?.heroes.find((h) => h.id === this.localHeroId);
  }

  public sampleInput(): PlayerInput {
    // Combine WASD + Arrow keys + Virtual Joystick
    let kx = 0;
    let kz = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) kz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) kz += 1;
    if (this.renderer.flipForRed) {
      kx = -kx;
      kz = -kz;
    }

    let moveX = this.joyActive ? this.joyX : kx;
    let moveZ = this.joyActive ? this.joyZ : kz;
    if (Math.hypot(moveX, moveZ) > 0.1) {
      this.rightClickTarget = null;
    }

    // Clear right-click target when reached
    const hero = this.getLocalHero();
    if (this.rightClickTarget && hero) {
      if (Math.hypot(this.rightClickTarget.x - hero.x, this.rightClickTarget.z - hero.z) < 1.1) {
        this.rightClickTarget = null;
      }
    }

    const input: PlayerInput = {
      moveX,
      moveZ,
      moveTarget: this.rightClickTarget,
      basicAttack: this.attackHeld,
      targetPriority: this.targetPriority,
      castSkill: this.pendingSkill,
      castSummoner: this.pendingSummoner,
      castHeal: this.pendingHeal,
      recall: this.pendingRecall,
      upgradeSkill: this.pendingUpgrade,
      buyItemId: this.pendingBuyItem,
      sellSlot: this.pendingSellSlot,
      quickChat: this.pendingChat,
    };

    // Consume one-shot inputs
    this.pendingSkill = null;
    this.pendingSummoner = null;
    this.pendingHeal = false;
    this.pendingRecall = false;
    this.pendingUpgrade = null;
    this.pendingBuyItem = null;
    this.pendingSellSlot = null;
    this.pendingChat = null;

    return input;
  }

  public handleEvents(events: GameEvent[], localHeroId: string): void {
    for (const ev of events) {
      if (ev.sfxKind) {
        // Only play loud local feedback for nearby or global events
        const isGlobal =
          ev.type === 'announce' ||
          ev.type === 'kill' ||
          ev.type === 'turret_destroy' ||
          ev.type === 'boss_kill' ||
          ev.type === 'chat' ||
          ev.unitId === localHeroId;
        const hero = this.getLocalHero();
        const isNear = !ev.x || !hero || Math.hypot(ev.x - hero.x, (ev.z ?? 0) - hero.z) < 28;
        if (isGlobal || isNear) {
          soundEngine.playSfx(ev.sfxKind);
        }
      }

      if (ev.type === 'announce' || ev.type === 'kill' || ev.type === 'turret_destroy' || ev.type === 'boss_kill') {
        this.showBanner(ev.text || '', ev.subText || '', ev.color || '#fbbf24');
        if (ev.text) {
          const cleanSpeech = ev.text.replace(/[A-Za-z·]+/g, '').trim() || ev.text;
          soundEngine.announceVoice(cleanSpeech);
        }
      }

      if (ev.type === 'chat' && ev.text) {
        this.pushChatFeed(ev.text, ev.color || '#e2e8f0');
      } else if (ev.type === 'kill' && ev.subText) {
        this.pushChatFeed(`⚔️ ${ev.subText}`, ev.color || '#fbbf24');
      }
    }
  }

  private showBanner(title: string, sub: string, color: string): void {
    this.bannerEl.innerHTML = `
      <div class="banner-title" style="color:${color}">${title}</div>
      ${sub ? `<div class="banner-sub">${sub}</div>` : ''}
    `;
    this.bannerEl.classList.remove('hidden');
    this.bannerTimer = 3.2;
  }

  private pushChatFeed(text: string, color: string): void {
    const line = document.createElement('div');
    line.className = 'chat-feed-line';
    line.style.borderLeftColor = color;
    line.textContent = text;
    this.chatFeedEl.appendChild(line);
    while (this.chatFeedEl.children.length > 5) {
      this.chatFeedEl.removeChild(this.chatFeedEl.firstChild!);
    }
    setTimeout(() => line.remove(), 8000);
  }

  private toggleShop(force?: boolean): void {
    this.shopOpen = force !== undefined ? force : !this.shopOpen;
    this.shopModal.classList.toggle('hidden', !this.shopOpen);
    if (this.shopOpen) {
      soundEngine.playSfx('ui_click');
      this.lastShopSig = '';
      this.renderShopIfOpen();
    }
  }

  private toggleScoreboard(force?: boolean): void {
    this.scoreboardOpen = force !== undefined ? force : !this.scoreboardOpen;
    this.scoreboardModal.classList.toggle('hidden', !this.scoreboardOpen);
    if (this.scoreboardOpen) this.renderScoreboard();
  }

  public update(snap: WorldSnapshot, localHeroId: string, dt: number, pingLabel: string): void {
    this.latestSnap = snap;
    this.localHeroId = localHeroId;
    const hero = snap.heroes.find((h) => h.id === localHeroId) || snap.heroes[0];
    if (!hero) return;

    // FPS counter
    this.fpsFrames++;
    const now = performance.now();
    if (now - this.fpsTime >= 600) {
      this.fpsValue = Math.round((this.fpsFrames * 1000) / (now - this.fpsTime));
      this.fpsFrames = 0;
      this.fpsTime = now;
      this.pingEl.textContent = `${this.fpsValue} FPS · ${pingLabel}`;
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.add('hidden');
    }

    // Scoreboard & timer
    this.scoreBlueEl.textContent = String(snap.blueKills);
    this.scoreRedEl.textContent = String(snap.redKills);
    const mins = Math.floor(snap.time / 60);
    const secs = Math.floor(snap.time % 60);
    this.timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    this.kdaEl.textContent = `${hero.kills} / ${hero.deaths} / ${hero.assists} · 补刀 ${hero.cs}`;
    this.goldEl.textContent = String(Math.floor(hero.gold));

    // Vitals bar
    this.levelTextEl.textContent = `Lv.${hero.level}`;
    const hpPct = (hero.hp / Math.max(1, hero.maxHp)) * 100;
    this.hpFillEl.style.width = `${Math.max(0, Math.min(100, hpPct))}%`;
    this.hpTextEl.textContent = `${Math.ceil(hero.hp)} / ${hero.maxHp}`;
    const mpPct = hero.maxMp > 0 ? (hero.mp / hero.maxMp) * 100 : 100;
    this.mpFillEl.style.width = `${Math.max(0, Math.min(100, mpPct))}%`;

    // Death respawn banner
    if (!hero.alive) {
      this.deathBannerEl.classList.remove('hidden');
      this.deathBannerEl.innerHTML = `阵亡复活倒计时 <strong>${Math.ceil(hero.respawnTimer)}s</strong>`;
    } else {
      this.deathBannerEl.classList.add('hidden');
    }

    // Buff pills
    this.buffBarEl.innerHTML = hero.buffs
      .map(
        (b) =>
          `<span class="hud-buff-pill" style="border-color:${b.color};color:${b.color}">${b.name}${
            b.stacks ? ` ×${b.stacks}` : ` ${Math.ceil(b.remaining)}s`
          }</span>`
      )
      .join('');

    // Skill buttons, cooldowns & upgrade (+) indicators
    const def = HEROES[hero.heroId];
    for (let i = 0; i < 3; i++) {
      const sk = def.skills[i];
      const lv = hero.skillLevels[i];
      const cd = hero.skillCooldowns[i];
      const btn = this.skillBtns[i];
      btn.querySelector('.sk-icon')!.textContent = sk.icon;
      btn.querySelector('.sk-name')!.textContent =
        hero.heroId === 'libai' && i === 0 && hero.libaiS1Stage > 0
          ? hero.libaiS1Stage === 1
            ? '二段突进'
            : '归影'
          : sk.name.slice(0, 4);

      const cdEl = this.skillCdEls[i];
      const isLibaiActive = hero.heroId === 'libai' && i === 0 && hero.libaiS1Stage > 0;
      if (lv === 0) {
        cdEl.classList.remove('hidden');
        cdEl.textContent = '未学习';
      } else if (cd > 0.05 && !isLibaiActive) {
        cdEl.classList.remove('hidden');
        cdEl.textContent = cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1);
      } else {
        cdEl.classList.add('hidden');
      }

      const canUpgrade =
        hero.skillPoints > 0 &&
        lv < sk.maxLevel &&
        (i === 2
          ? hero.level >= (lv === 0 ? 4 : lv === 1 ? 8 : 12)
          : lv < Math.ceil(hero.level / 2) || hero.level >= 12);
      this.skillUpBtns[i].classList.toggle('hidden', !canUpgrade);

      // Skill rank pips
      let pips = '';
      for (let p = 0; p < sk.maxLevel; p++) {
        pips += `<span class="pip ${p < lv ? 'on' : ''}"></span>`;
      }
      this.skillDotsEls[i].innerHTML = pips;
    }

    // Summoner & Heal CDs
    const sumDef = SUMMONER_SKILLS[hero.summonerSkill];
    this.root.querySelector('#hudSummonerIcon')!.textContent = sumDef.icon;
    this.root.querySelector('#hudSummonerLabel')!.textContent = sumDef.name;
    if (hero.summonerCooldown > 0.1) {
      this.summonerCdEl.classList.remove('hidden');
      this.summonerCdEl.textContent = String(Math.ceil(hero.summonerCooldown));
    } else {
      this.summonerCdEl.classList.add('hidden');
    }
    if (hero.healSpellCooldown > 0.1) {
      this.healCdEl.classList.remove('hidden');
      this.healCdEl.textContent = String(Math.ceil(hero.healSpellCooldown));
    } else {
      this.healCdEl.classList.add('hidden');
    }

    // HoK Quick-Buy buttons on left edge
    const quickBuys = getQuickBuySuggestions(def.recommendedItems, hero.items, hero.gold);
    const qbSig = quickBuys.map((q) => `${q.item.id}:${q.cost}`).join('|');
    if (qbSig !== this.lastQuickBuySig) {
      this.lastQuickBuySig = qbSig;
      this.quickBuyContainer.innerHTML = quickBuys
        .map(
          (q) => `
          <button class="quick-buy-btn" data-buy="${q.item.id}">
            <span class="qb-icon">${q.item.icon}</span>
            <span class="qb-info">
              <strong>${q.item.name}</strong>
              <small>🪙 ${q.cost}</small>
            </span>
          </button>
        `
        )
        .join('');
      this.quickBuyContainer.querySelectorAll('.quick-buy-btn').forEach((b) => {
        b.addEventListener('click', () => {
          this.pendingBuyItem = (b as HTMLElement).dataset.buy || null;
        });
      });
    }

    this.renderShopIfOpen();
    if (this.scoreboardOpen) this.renderScoreboard();
    this.renderMinimap(snap, hero.team, localHeroId);
  }

  private renderShopIfOpen(): void {
    if (!this.shopOpen) return;
    const hero = this.getLocalHero();
    if (!hero) return;
    this.shopGoldEl.textContent = String(Math.floor(hero.gold));

    const sig = `${this.shopCategory}:${Math.floor(hero.gold / 10)}:${hero.items.join(',')}`;
    if (sig === this.lastShopSig) return;
    this.lastShopSig = sig;

    const def = HEROES[hero.heroId];
    const itemsToShow =
      this.shopCategory === 'rec'
        ? def.recommendedItems.map((id) => ITEMS[id]).filter(Boolean)
        : ITEM_LIST.filter((it) => it.category === this.shopCategory);

    this.shopGridEl.innerHTML = itemsToShow
      .map((it) => {
        const { cost, consumedIndices } = getNetItemCost(it.id, hero.items);
        const canAfford = hero.gold >= cost && hero.items.length - consumedIndices.length < 6;
        const statLine = Object.entries(it.stats)
          .slice(0, 3)
          .map(([k, v]) => {
            const labels: Record<string, string> = {
              ad: '攻击', ap: '法强', hp: '生命', mp: '法力', armor: '物防', mr: '法防',
              attackSpeed: '攻速', critChance: '暴击', critDamage: '暴伤', lifesteal: '吸血',
              spellVamp: '法吸', cdr: '冷却', moveSpeed: '移速', armorPen: '物穿', magicPen: '法穿',
            };
            const valStr = v < 1 && k !== 'moveSpeed' ? `+${Math.round(v * 100)}%` : `+${v}`;
            return `${labels[k] || k}${valStr}`;
          })
          .join(' · ');
        return `
          <div class="shop-card ${canAfford ? 'affordable' : ''}" data-item="${it.id}">
            <div class="shop-card-top">
              <span class="shop-item-icon" style="border-color:${it.color}">${it.icon}</span>
              <div>
                <div class="shop-item-name">${it.name}</div>
                <div class="shop-item-cost">🪙 ${cost}${cost < it.price ? ` <del>${it.price}</del>` : ''}</div>
              </div>
            </div>
            <div class="shop-item-stats">${statLine}</div>
            ${it.passiveDesc ? `<div class="shop-item-passive">${it.passiveDesc}</div>` : ''}
          </div>
        `;
      })
      .join('');

    this.shopGridEl.querySelectorAll('.shop-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.pendingBuyItem = (card as HTMLElement).dataset.item || null;
      });
    });

    // Owned 6 slots
    let ownedHtml = '';
    for (let i = 0; i < 6; i++) {
      const id = hero.items[i];
      const it = id ? ITEMS[id] : null;
      ownedHtml += it
        ? `<button class="owned-slot filled" data-sell="${i}" title="点击出售 ${it.name}">${it.icon}<span>${it.name.slice(0, 3)}</span></button>`
        : `<div class="owned-slot empty">空槽</div>`;
    }
    this.shopOwnedEl.innerHTML = ownedHtml;
    this.shopOwnedEl.querySelectorAll('.owned-slot.filled').forEach((b) => {
      b.addEventListener('click', () => {
        this.pendingSellSlot = Number((b as HTMLElement).dataset.sell);
      });
    });
  }

  private renderScoreboard(): void {
    if (!this.latestSnap) return;
    const renderTeam = (team: Team, title: string) => {
      const list = this.latestSnap!.heroes.filter((h) => h.team === team);
      return `
        <div class="sb-team ${team}">
          <div class="sb-team-hdr">${title}</div>
          ${list
            .map((h) => {
              const def = HEROES[h.heroId];
              const icons = h.items.map((id) => ITEMS[id]?.icon || '').join(' ');
              return `
                <div class="sb-row ${h.id === this.localHeroId ? 'me' : ''}">
                  <span class="sb-hero"><strong>${def.name}</strong> <small>Lv.${h.level}</small></span>
                  <span class="sb-player">${h.playerName}</span>
                  <span class="sb-kda">${h.kills}/${h.deaths}/${h.assists}</span>
                  <span class="sb-gold">🪙 ${Math.floor(h.gold)}</span>
                  <span class="sb-items">${icons || '-'}</span>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    };
    this.scoreboardBody.innerHTML =
      renderTeam('blue', `蓝方阵营 (${this.latestSnap.blueKills})`) +
      renderTeam('red', `红方阵营 (${this.latestSnap.redKills})`);
  }

  private renderMinimap(snap: WorldSnapshot, localTeam: Team, localHeroId: string): void {
    const ctx = this.minimapCtx;
    const S = this.minimapCanvas.width;
    const flip = this.renderer.flipForRed;
    const mx = (wx: number) => ((flip ? MAP_SIZE - wx : wx) / MAP_SIZE) * S;
    const mz = (wz: number) => ((flip ? MAP_SIZE - wz : wz) / MAP_SIZE) * S;

    ctx.fillStyle = '#0e2420';
    ctx.fillRect(0, 0, S, S);

    // River diagonal
    ctx.strokeStyle = '#1b556b';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(mx(14), mz(14));
    ctx.lineTo(mx(146), mz(146));
    ctx.stroke();

    // 3 Lanes
    ctx.strokeStyle = '#6c6352';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const lane of ['top', 'mid', 'bot'] as const) {
      ctx.beginPath();
      LANE_WAYPOINTS_BLUE[lane].forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(mx(p.x), mz(p.z));
        else ctx.lineTo(mx(p.x), mz(p.z));
      });
      ctx.stroke();
    }

    // Jungle camps & Bosses
    for (const mon of snap.monsters) {
      if (!mon.alive) continue;
      ctx.fillStyle =
        mon.type === 'tyrant'
          ? '#c084fc'
          : mon.type === 'overlord'
          ? '#fbbf24'
          : mon.type === 'red_buff'
          ? '#ef4444'
          : mon.type === 'blue_buff'
          ? '#38bdf8'
          : '#a3e635';
      const r = mon.type === 'tyrant' || mon.type === 'overlord' ? 4.5 : 2.6;
      ctx.beginPath();
      ctx.arc(mx(mon.x), mz(mon.z), r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Turrets & Crystals
    for (const t of snap.turrets) {
      if (!t.alive) continue;
      ctx.fillStyle = t.team === localTeam ? '#38bdf8' : '#ef4444';
      const sz = t.tier === 'crystal' ? 7 : 4.5;
      ctx.fillRect(mx(t.x) - sz / 2, mz(t.z) - sz / 2, sz, sz);
    }

    // Minions
    for (const m of snap.minions) {
      if (!this.renderer.isEnemyVisible(m, snap, localTeam)) continue;
      ctx.fillStyle = m.team === localTeam ? '#93c5fd' : '#fca5a5';
      ctx.fillRect(mx(m.x) - 1.5, mz(m.z) - 1.5, 3, 3);
    }

    // Heroes
    for (const h of snap.heroes) {
      if (!h.alive) continue;
      if (!this.renderer.isEnemyVisible(h, snap, localTeam)) continue;
      const x = mx(h.x);
      const y = mz(h.z);
      ctx.beginPath();
      ctx.arc(x, y, h.id === localHeroId ? 5.2 : 4.2, 0, Math.PI * 2);
      ctx.fillStyle = h.id === localHeroId ? '#fde047' : h.team === localTeam ? '#22c55e' : '#f43f5e';
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointermove', this.onGlobalPointerMove);
    window.removeEventListener('pointerup', this.onGlobalPointerUp);
    window.removeEventListener('pointercancel', this.onGlobalPointerUp);
    this.root.remove();
  }
}
