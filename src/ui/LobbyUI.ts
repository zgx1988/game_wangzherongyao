import { soundEngine } from '../audio/SoundEngine';
import { HeroPreview3D } from '../render/HeroPreview3D';
import { HEROES, HERO_LIST, SUMMONER_SKILLS } from '../sim/heroes';
import { ITEMS } from '../sim/items';
import {
  AiDifficulty,
  HeroId,
  RoomInfo,
  ServerInfo,
  SummonerSkillId,
  Team,
  WorldSnapshot,
} from '../sim/types';

export interface LobbyActions {
  onStartSolo: (cfg: {
    playerName: string;
    heroId: HeroId;
    summonerSkill: SummonerSkillId;
    difficulty: AiDifficulty;
    team: Team;
  }) => void;
  onLanConnect: (serverAddr: string) => void;
  onLanRefresh: () => void;
  onLanCreateRoom: (
    roomName: string,
    playerName: string,
    heroId: HeroId,
    summonerSkill: SummonerSkillId,
    difficulty: AiDifficulty
  ) => void;
  onLanJoinRoom: (roomId: string, playerName: string) => void;
  onLanLeaveRoom: () => void;
  onLanSwitchSlot: (team: Team, slotIndex: number) => void;
  onLanSelectHero: (heroId: HeroId, summonerSkill: SummonerSkillId) => void;
  onLanSetDifficulty: (diff: AiDifficulty) => void;
  onLanStartMatch: () => void;
  onReplaySolo: () => void;
  onBackHome: () => void;
}

export class LobbyUI {
  private container: HTMLElement;
  private actions: LobbyActions;
  private preview3D: HeroPreview3D | null = null;

  public playerName: string = localStorage.getItem('hog_player_name') || '荣耀召唤师';
  public selectedHero: HeroId = 'arthur';
  public selectedSummoner: SummonerSkillId = 'flash';
  public selectedDifficulty: AiDifficulty = 'normal';
  public selectedTeam: Team = 'blue';

  private view: 'home' | 'solo_pick' | 'lan_browser' | 'lan_room' | 'post_match' = 'home';
  private serverInfo: ServerInfo | null = null;
  private lanConnected = false;
  private lanError = '';
  private lanServerAddr = '';
  private myPlayerId: string | null = null;
  private currentRoom: RoomInfo | null = null;
  private postSnap: WorldSnapshot | null = null;
  private postLocalHeroId = 'blue_0';

  constructor(container: HTMLElement, defaultLanAddr: string, actions: LobbyActions) {
    this.container = container;
    this.lanServerAddr = defaultLanAddr;
    this.actions = actions;
  }

  public showHome(): void {
    this.view = 'home';
    this.render();
  }

  public showSoloPick(): void {
    this.view = 'solo_pick';
    this.render();
  }

  public showLanBrowser(): void {
    this.view = 'lan_browser';
    this.render();
  }

  public updateLanState(opts: {
    connected?: boolean;
    playerId?: string | null;
    serverInfo?: ServerInfo | null;
    room?: RoomInfo | null;
    error?: string;
  }): void {
    if (opts.connected !== undefined) this.lanConnected = opts.connected;
    if (opts.playerId !== undefined) this.myPlayerId = opts.playerId;
    if (opts.serverInfo !== undefined) this.serverInfo = opts.serverInfo;
    if (opts.error !== undefined) this.lanError = opts.error;
    if (opts.room !== undefined) {
      this.currentRoom = opts.room;
      if (opts.room) this.view = 'lan_room';
      else if (this.view === 'lan_room') this.view = 'lan_browser';
    }
    if (this.view === 'lan_browser' || this.view === 'lan_room') {
      this.render();
    }
  }

  public showPostMatch(snap: WorldSnapshot, localHeroId: string): void {
    this.postSnap = snap;
    this.postLocalHeroId = localHeroId;
    this.view = 'post_match';
    this.render();
  }

  public destroy(): void {
    if (this.preview3D) {
      this.preview3D.dispose();
      this.preview3D = null;
    }
    this.container.innerHTML = '';
  }

  private mountPreview(selector: string): void {
    if (this.preview3D) {
      this.preview3D.dispose();
      this.preview3D = null;
    }
    const el = this.container.querySelector(selector) as HTMLElement | null;
    if (el) {
      this.preview3D = new HeroPreview3D(el);
      this.preview3D.setHero(this.selectedHero);
    }
  }

  private saveName(name: string): void {
    this.playerName = name.trim().slice(0, 14) || '荣耀召唤师';
    localStorage.setItem('hog_player_name', this.playerName);
  }

  private render(): void {
    if (this.preview3D) {
      this.preview3D.dispose();
      this.preview3D = null;
    }

    if (this.view === 'home') this.renderHome();
    else if (this.view === 'solo_pick') this.renderSoloPick();
    else if (this.view === 'lan_browser') this.renderLanBrowser();
    else if (this.view === 'lan_room') this.renderLanRoom();
    else if (this.view === 'post_match') this.renderPostMatch();
  }

  private renderHome(): void {
    const hero = HEROES[this.selectedHero];
    this.container.innerHTML = `
      <div class="lobby-screen home-screen">
        <div class="lobby-bg-glow"></div>
        <header class="lobby-header">
          <div class="brand-block">
            <div class="brand-emblem">⚔️</div>
            <div>
              <h1 class="brand-title">荣耀峡谷 <span>5v5</span></h1>
              <div class="brand-sub">HONOR OF GLORY · 东方幻想公平竞技 MOBA</div>
            </div>
          </div>
          <div class="header-right">
            <div class="name-input-box">
              <span>召唤师</span>
              <input id="homeNameInput" type="text" maxlength="14" value="${this.playerName}" placeholder="输入昵称" />
            </div>
            <button id="homeMuteBtn" class="btn-glass">${soundEngine.muted ? '🔇 静音' : '🔊 音效开'}</button>
          </div>
        </header>

        <main class="home-main">
          <section class="home-stage">
            <div class="stage-hero-badge">
              <span class="role-chip">${hero.role}</span>
              <h2>${hero.title} · ${hero.name}</h2>
              <p>拖动可 360° 旋转赏析 3D 英雄建模</p>
            </div>
            <div id="homePreview3D" class="preview-3d-box"></div>
            <div class="stage-hero-dots">
              ${HERO_LIST.map(
                (h) => `
                <button class="hero-mini-chip ${h.id === this.selectedHero ? 'active' : ''}" data-hid="${h.id}">
                  <span class="dot" style="background:${h.primaryColor}"></span>${h.name}
                </button>`
              ).join('')}
            </div>
          </section>

          <section class="home-modes">
            <div class="mode-card primary" id="btnSoloMode">
              <div class="mode-badge">离线可玩 · 推荐测试</div>
              <div class="mode-icon">🛡️</div>
              <h3>5v5 人机对战</h3>
              <p>经典三路推塔、河道暴君主宰、红蓝Buff打野、草丛隐身、九座防御塔与全智能 5v5 AI 激战！</p>
              <div class="mode-cta">选择英雄出战 →</div>
            </div>

            <div class="mode-card lan" id="btnLanMode">
              <div class="mode-badge">Wi-Fi 同屏开黑 · 电脑/手机互通</div>
              <div class="mode-icon">🌐</div>
              <h3>5v5 局域网联机</h3>
              <p>创建或加入局域网房间，支持 2~10 名真人同场 5v5 对决，空位由 AI 自动补齐！</p>
              <div class="mode-cta">进入局域网大厅 →</div>
            </div>

            <div class="home-tips-card">
              <h4>🎮 全平台双操控支持</h4>
              <ul>
                <li><strong>电脑端：</strong><code>WASD</code> 或 <code>右键</code> 移动 · <code>Space/J</code> 普攻 · <code>Q/E/R</code>(或<code>1/2/3</code>) 技能 · <code>F</code> 闪现/惩击 · <code>B</code> 回城 · <code>P</code> 商店</li>
                <li><strong>手机端：</strong>左手虚拟摇杆 + 右手王者轮盘技能（长按拖动瞄准）+ 一键侧边快捷出装！</li>
              </ul>
            </div>
          </section>
        </main>
      </div>
    `;

    this.mountPreview('#homePreview3D');

    const nameInput = this.container.querySelector('#homeNameInput') as HTMLInputElement;
    nameInput.addEventListener('change', () => this.saveName(nameInput.value));

    this.container.querySelector('#homeMuteBtn')!.addEventListener('click', (e) => {
      soundEngine.unlock();
      const muted = soundEngine.toggleMute();
      (e.currentTarget as HTMLElement).textContent = muted ? '🔇 静音' : '🔊 音效开';
    });

    this.container.querySelectorAll('.hero-mini-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        soundEngine.unlock();
        soundEngine.playSfx('ui_click');
        soundEngine.startBgm('lobby');
        this.selectedHero = (btn as HTMLElement).dataset.hid as HeroId;
        this.renderHome();
      });
    });

    this.container.querySelector('#btnSoloMode')!.addEventListener('click', () => {
      soundEngine.unlock();
      soundEngine.playSfx('ui_click');
      soundEngine.startBgm('lobby');
      this.saveName(nameInput.value);
      this.showSoloPick();
    });

    this.container.querySelector('#btnLanMode')!.addEventListener('click', () => {
      soundEngine.unlock();
      soundEngine.playSfx('ui_click');
      soundEngine.startBgm('lobby');
      this.saveName(nameInput.value);
      this.showLanBrowser();
      this.actions.onLanConnect(this.lanServerAddr);
    });
  }

  private renderSoloPick(): void {
    const hero = HEROES[this.selectedHero];
    this.container.innerHTML = `
      <div class="lobby-screen pick-screen">
        <header class="lobby-header compact">
          <button id="pickBackBtn" class="btn-glass">← 返回大厅</button>
          <h2>5v5 人机对战 · 英雄选择</h2>
          <div class="pick-opts">
            <select id="pickTeamSel" class="styled-select">
              <option value="blue" ${this.selectedTeam === 'blue' ? 'selected' : ''}>蓝方阵营</option>
              <option value="red" ${this.selectedTeam === 'red' ? 'selected' : ''}>红方阵营 (镜像视角)</option>
            </select>
            <select id="pickDiffSel" class="styled-select">
              <option value="easy" ${this.selectedDifficulty === 'easy' ? 'selected' : ''}>AI 难度：入门</option>
              <option value="normal" ${this.selectedDifficulty === 'normal' ? 'selected' : ''}>AI 难度：标准</option>
              <option value="hard" ${this.selectedDifficulty === 'hard' ? 'selected' : ''}>AI 难度：王者</option>
            </select>
          </div>
        </header>

        <main class="pick-layout">
          <aside class="hero-roster">
            ${HERO_LIST.map(
              (h) => `
              <button class="roster-card ${h.id === this.selectedHero ? 'selected' : ''}" data-hid="${h.id}">
                <div class="roster-swatch" style="background:linear-gradient(135deg, ${h.primaryColor}, ${h.secondaryColor})">${h.skills[0].icon}</div>
                <div class="roster-meta">
                  <div class="roster-name">${h.name} <span>${h.role}</span></div>
                  <div class="roster-title">${h.title}</div>
                </div>
              </button>`
            ).join('')}
          </aside>

          <section class="pick-center">
            <div id="pickPreview3D" class="preview-3d-box large"></div>
            <div class="pick-summoner-bar">
              <span>召唤师技能：</span>
              ${Object.values(SUMMONER_SKILLS)
                .map(
                  (s) => `
                <button class="sum-chip ${this.selectedSummoner === s.id ? 'active' : ''}" data-sum="${s.id}" title="${s.desc}">
                  ${s.icon} ${s.name}
                </button>`
                )
                .join('')}
            </div>
          </section>

          <aside class="hero-detail-panel">
            <div class="detail-head">
              <span class="role-chip">${hero.role}</span>
              <h3>${hero.title} · ${hero.name}</h3>
            </div>
            <div class="detail-stats">
              <div><span>生命</span><strong>${hero.baseHp}</strong></div>
              <div><span>攻击</span><strong>${hero.baseAd}</strong></div>
              <div><span>物防</span><strong>${hero.baseArmor}</strong></div>
              <div><span>射程</span><strong>${hero.isRanged ? '远程' : '近战'}</strong></div>
            </div>
            <div class="skill-detail-list">
              <div class="sk-item passive">
                <span class="sk-badge">被动</span>
                <div>
                  <strong>${hero.passiveName}</strong>
                  <p>${hero.passiveDesc}</p>
                </div>
              </div>
              ${hero.skills
                .map(
                  (sk, i) => `
                <div class="sk-item">
                  <span class="sk-badge" style="border-color:${sk.color}">${sk.icon}</span>
                  <div>
                    <strong>${i === 2 ? '终极技 · ' : `${i + 1}技能 · `}${sk.name}</strong>
                    <p>${sk.desc}</p>
                  </div>
                </div>`
                )
                .join('')}
            </div>
            <button id="startSoloBtn" class="btn-gold-lg">⚔️ 进入荣耀峡谷 · 开始 5v5</button>
          </aside>
        </main>
      </div>
    `;

    this.mountPreview('#pickPreview3D');

    this.container.querySelector('#pickBackBtn')!.addEventListener('click', () => {
      soundEngine.playSfx('ui_click');
      this.showHome();
    });
    (this.container.querySelector('#pickTeamSel') as HTMLSelectElement).addEventListener('change', (e) => {
      this.selectedTeam = (e.target as HTMLSelectElement).value as Team;
    });
    (this.container.querySelector('#pickDiffSel') as HTMLSelectElement).addEventListener('change', (e) => {
      this.selectedDifficulty = (e.target as HTMLSelectElement).value as AiDifficulty;
    });

    this.container.querySelectorAll('.roster-card').forEach((card) => {
      card.addEventListener('click', () => {
        soundEngine.playSfx('ui_click');
        this.selectedHero = (card as HTMLElement).dataset.hid as HeroId;
        this.renderSoloPick();
      });
    });

    this.container.querySelectorAll('.sum-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        soundEngine.playSfx('ui_click');
        this.selectedSummoner = (chip as HTMLElement).dataset.sum as SummonerSkillId;
        this.renderSoloPick();
      });
    });

    this.container.querySelector('#startSoloBtn')!.addEventListener('click', () => {
      soundEngine.unlock();
      soundEngine.playSfx('skill_holy');
      this.actions.onStartSolo({
        playerName: this.playerName,
        heroId: this.selectedHero,
        summonerSkill: this.selectedSummoner,
        difficulty: this.selectedDifficulty,
        team: this.selectedTeam,
      });
    });
  }

  private renderLanBrowser(): void {
    const rooms = this.serverInfo?.rooms || [];
    const lanUrls = this.serverInfo?.lanUrls || [];

    this.container.innerHTML = `
      <div class="lobby-screen lan-screen">
        <header class="lobby-header compact">
          <button id="lanBackBtn" class="btn-glass">← 返回大厅</button>
          <h2>🌐 5v5 局域网联机大厅</h2>
          <div class="lan-status-pill ${this.lanConnected ? 'ok' : 'off'}">
            ${this.lanConnected ? '● 已连接联机主机' : '○ 未连接主机'}
          </div>
        </header>

        <main class="lan-body">
          <div class="lan-connect-bar">
            <label>联机主机地址 (IP:端口)</label>
            <input id="lanAddrInput" type="text" value="${this.lanServerAddr}" placeholder="例如 192.168.1.100:3000" />
            <button id="lanConnectBtn" class="btn-gold">连接主机</button>
            <button id="lanRefreshBtn" class="btn-glass">刷新房间</button>
          </div>

          ${
            this.lanError
              ? `<div class="lan-alert error">⚠️ ${this.lanError}<br/><small>提示：请在电脑终端运行 <code>npm start</code> 启动局域网服务器，同一 Wi-Fi 下电脑和手机均可直连。</small></div>`
              : ''
          }

          ${
            lanUrls.length > 0
              ? `<div class="lan-alert info">
                  📡 <strong>局域网共享地址：</strong>
                  ${lanUrls.map((u) => `<code>${u}</code>`).join(' &nbsp; ')}
                  <br/><small>同一 Wi-Fi 下的好友用电脑浏览器、手机浏览器或手机 APK 输入以上地址即可一起 5v5 开黑！</small>
                </div>`
              : ''
          }

          <div class="lan-panel-row">
            <div class="lan-card create-card">
              <h3>创建 5v5 局域网房间</h3>
              <label>房间名称</label>
              <input id="lanRoomName" type="text" maxlength="20" value="${this.playerName}的荣耀房间" />
              <label>补位 AI 难度</label>
              <select id="lanDiffSel" class="styled-select">
                <option value="easy" ${this.selectedDifficulty === 'easy' ? 'selected' : ''}>入门 AI</option>
                <option value="normal" ${this.selectedDifficulty === 'normal' ? 'selected' : ''}>标准 AI</option>
                <option value="hard" ${this.selectedDifficulty === 'hard' ? 'selected' : ''}>王者 AI</option>
              </select>
              <button id="lanCreateBtn" class="btn-gold-lg" ${!this.lanConnected ? 'disabled' : ''}>＋ 创建房间</button>
            </div>

            <div class="lan-card rooms-card">
              <h3>局域网活跃房间 (${rooms.length})</h3>
              <div class="room-list">
                ${
                  rooms.length === 0
                    ? `<div class="empty-rooms">${
                        this.lanConnected
                          ? '当前暂无房间，点击左侧创建一个新房间吧！'
                          : '请先连接到局域网联机主机。'
                      }</div>`
                    : rooms
                        .map(
                          (r) => `
                      <div class="room-row">
                        <div>
                          <strong>${r.name}</strong>
                          <small>真人 ${r.humanCount}/10 · ${r.status === 'playing' ? '对战中' : '等待开战'}</small>
                        </div>
                        <button class="btn-gold join-room-btn" data-rid="${r.id}" ${
                          r.status === 'playing' ? 'disabled' : ''
                        }>${r.status === 'playing' ? '进行中' : '加入房间'}</button>
                      </div>`
                        )
                        .join('')
                }
              </div>
            </div>
          </div>
        </main>
      </div>
    `;

    this.container.querySelector('#lanBackBtn')!.addEventListener('click', () => {
      soundEngine.playSfx('ui_click');
      this.showHome();
    });
    const addrInput = this.container.querySelector('#lanAddrInput') as HTMLInputElement;
    this.container.querySelector('#lanConnectBtn')!.addEventListener('click', () => {
      soundEngine.playSfx('ui_click');
      this.lanServerAddr = addrInput.value.trim();
      this.lanError = '';
      this.actions.onLanConnect(this.lanServerAddr);
    });
    this.container.querySelector('#lanRefreshBtn')!.addEventListener('click', () => {
      soundEngine.playSfx('ui_click');
      this.actions.onLanRefresh();
    });

    this.container.querySelector('#lanCreateBtn')?.addEventListener('click', () => {
      soundEngine.playSfx('ui_click');
      const rName = (this.container.querySelector('#lanRoomName') as HTMLInputElement).value;
      const diff = (this.container.querySelector('#lanDiffSel') as HTMLSelectElement).value as AiDifficulty;
      this.selectedDifficulty = diff;
      this.actions.onLanCreateRoom(rName, this.playerName, this.selectedHero, this.selectedSummoner, diff);
    });

    this.container.querySelectorAll('.join-room-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        soundEngine.playSfx('ui_click');
        this.actions.onLanJoinRoom((btn as HTMLElement).dataset.rid!, this.playerName);
      });
    });
  }

  private renderLanRoom(): void {
    const room = this.currentRoom;
    if (!room) {
      this.showLanBrowser();
      return;
    }
    const isHost = room.hostId === this.myPlayerId;
    const mySlot = room.slots.find((s) => s.playerId === this.myPlayerId);
    if (mySlot) {
      this.selectedHero = mySlot.heroId;
      this.selectedSummoner = mySlot.summonerSkill;
    }

    const renderTeamCol = (team: Team, title: string) => {
      const list = room.slots.filter((s) => s.team === team);
      return `
        <div class="room-team-col ${team}">
          <h3>${title}</h3>
          ${list
            .map((s) => {
              const def = HEROES[s.heroId];
              const isMe = s.playerId === this.myPlayerId;
              return `
                <div class="slot-row ${isMe ? 'me' : ''} ${s.isBot ? 'bot-slot' : 'human-slot'}"
                     data-team="${s.team}" data-slot="${s.slotIndex}"
                     title="${s.isBot ? '点击切换到此位置' : ''}">
                  <div class="slot-avatar" style="background:${def.primaryColor}">${def.skills[0].icon}</div>
                  <div class="slot-info">
                    <strong>${s.playerName} ${s.playerId === room.hostId ? '👑' : ''}</strong>
                    <small>${def.name} (${def.role}) · ${SUMMONER_SKILLS[s.summonerSkill].name}</small>
                  </div>
                  <span class="slot-tag">${isMe ? '我' : s.isBot ? 'AI补位(点我换位)' : '真人'}</span>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    };

    const lanUrls = this.serverInfo?.lanUrls || [];
    this.container.innerHTML = `
      <div class="lobby-screen lan-room-screen">
        <header class="lobby-header compact">
          <button id="roomLeaveBtn" class="btn-glass">← 离开房间</button>
          <h2>⚔️ ${room.name} (${room.humanCount} 真人 + ${10 - room.humanCount} AI)</h2>
          <div class="lan-share-mini">${lanUrls[0] ? `同Wi-Fi加入: <code>${lanUrls[0]}</code>` : ''}</div>
        </header>

        <main class="room-grid">
          ${renderTeamCol('blue', '🔵 蓝方阵营 (5)')}
          ${renderTeamCol('red', '🔴 红方阵营 (5)')}
        </main>

        <footer class="room-pick-footer">
          <div class="room-hero-strip">
            ${HERO_LIST.map(
              (h) => `
              <button class="hero-mini-chip ${h.id === this.selectedHero ? 'active' : ''}" data-rhid="${h.id}">
                <span class="dot" style="background:${h.primaryColor}"></span>${h.name} (${h.role})
              </button>`
            ).join('')}
          </div>
          <div class="room-action-strip">
            <div class="sum-inline">
              ${Object.values(SUMMONER_SKILLS)
                .map(
                  (s) => `
                <button class="sum-chip ${this.selectedSummoner === s.id ? 'active' : ''}" data-rsum="${s.id}">
                  ${s.icon} ${s.name}
                </button>`
                )
                .join('')}
            </div>
            ${
              isHost
                ? `<button id="roomStartBtn" class="btn-gold-lg">⚔️ 开启 5v5 局域网对决</button>`
                : `<div class="waiting-host">等待房主开启战斗...</div>`
            }
          </div>
        </footer>
      </div>
    `;

    this.container.querySelector('#roomLeaveBtn')!.addEventListener('click', () => {
      soundEngine.playSfx('ui_click');
      this.actions.onLanLeaveRoom();
    });

    this.container.querySelectorAll('.slot-row.bot-slot').forEach((el) => {
      el.addEventListener('click', () => {
        soundEngine.playSfx('ui_click');
        const team = (el as HTMLElement).dataset.team as Team;
        const idx = Number((el as HTMLElement).dataset.slot);
        this.actions.onLanSwitchSlot(team, idx);
      });
    });

    this.container.querySelectorAll('[data-rhid]').forEach((el) => {
      el.addEventListener('click', () => {
        soundEngine.playSfx('ui_click');
        this.selectedHero = (el as HTMLElement).dataset.rhid as HeroId;
        this.actions.onLanSelectHero(this.selectedHero, this.selectedSummoner);
      });
    });

    this.container.querySelectorAll('[data-rsum]').forEach((el) => {
      el.addEventListener('click', () => {
        soundEngine.playSfx('ui_click');
        this.selectedSummoner = (el as HTMLElement).dataset.rsum as SummonerSkillId;
        this.actions.onLanSelectHero(this.selectedHero, this.selectedSummoner);
      });
    });

    this.container.querySelector('#roomStartBtn')?.addEventListener('click', () => {
      soundEngine.playSfx('skill_holy');
      this.actions.onLanStartMatch();
    });
  }

  private renderPostMatch(): void {
    const snap = this.postSnap;
    if (!snap) {
      this.showHome();
      return;
    }
    const me = snap.heroes.find((h) => h.id === this.postLocalHeroId);
    const won = me ? snap.winner === me.team : snap.winner === 'blue';

    // Compute MVP score per team
    const mvpScore = (h: (typeof snap.heroes)[number]) =>
      h.kills * 3 + h.assists * 1.5 - h.deaths * 1.2 + h.damageDealt / 5000;
    const findMvpId = (team: Team) => {
      const list = snap.heroes.filter((h) => h.team === team);
      return list.sort((a, b) => mvpScore(b) - mvpScore(a))[0]?.id;
    };
    const blueMvp = findMvpId('blue');
    const redMvp = findMvpId('red');

    const renderTable = (team: Team, label: string, mvpId?: string) => `
      <div class="post-team ${team}">
        <h3>${label}</h3>
        ${snap.heroes
          .filter((h) => h.team === team)
          .map((h) => {
            const def = HEROES[h.heroId];
            const itemsHtml = h.items.map((id) => ITEMS[id]?.icon || '').join(' ');
            return `
              <div class="post-row ${h.id === this.postLocalHeroId ? 'me' : ''}">
                <span class="p-hero">${def.name} ${h.id === mvpId ? '<em class="mvp-tag">MVP</em>' : ''}</span>
                <span class="p-name">${h.playerName}</span>
                <span class="p-kda">${h.kills} / ${h.deaths} / ${h.assists}</span>
                <span class="p-dmg">输出 ${Math.round(h.damageDealt)}</span>
                <span class="p-gold">🪙 ${Math.floor(h.gold)}</span>
                <span class="p-items">${itemsHtml || '-'}</span>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    this.container.innerHTML = `
      <div class="lobby-screen post-screen">
        <div class="post-hero-banner ${won ? 'win' : 'lose'}">
          <h1>${won ? '🏆 VICTORY · 荣耀胜利' : '💀 DEFEAT · 虽败犹荣'}</h1>
          <p>蓝方 ${snap.blueKills} : ${snap.redKills} 红方 · 用时 ${Math.floor(snap.time / 60)}分${Math.floor(snap.time % 60)}秒</p>
        </div>

        <div class="post-tables">
          ${renderTable('blue', '🔵 蓝方战绩', blueMvp)}
          ${renderTable('red', '🔴 红方战绩', redMvp)}
        </div>

        <div class="post-actions">
          <button id="postReplayBtn" class="btn-gold-lg">⚔️ 再来一局</button>
          <button id="postHomeBtn" class="btn-glass">返回主大厅</button>
        </div>
      </div>
    `;

    this.container.querySelector('#postReplayBtn')!.addEventListener('click', () => {
      soundEngine.playSfx('ui_click');
      this.actions.onReplaySolo();
    });
    this.container.querySelector('#postHomeBtn')!.addEventListener('click', () => {
      soundEngine.playSfx('ui_click');
      this.actions.onBackHome();
    });
  }
}
