import './style.css';
import { soundEngine } from './audio/SoundEngine';
import { LanClient } from './net/LanClient';
import { GameRenderer } from './render/GameRenderer';
import { GameSimulation, createSoloMatchSlots } from './sim/GameSimulation';
import { AiDifficulty, HeroId, SummonerSkillId, Team, WorldSnapshot } from './sim/types';
import { HudController } from './ui/HudController';
import { LobbyUI } from './ui/LobbyUI';

const appEl = document.getElementById('app')!;

const lanClient = new LanClient();
let lobbyUI: LobbyUI | null = null;
let activeMatch: {
  mode: 'solo' | 'lan';
  sim: GameSimulation | null;
  renderer: GameRenderer;
  hud: HudController;
  localHeroId: string;
  latestSnapshot: WorldSnapshot | null;
  rafId: number;
  lastFrameTime: number;
  elapsed: number;
  simAccum: number;
  netSendAccum: number;
  endedHandled: boolean;
} | null = null;

let lastSoloCfg: {
  playerName: string;
  heroId: HeroId;
  summonerSkill: SummonerSkillId;
  difficulty: AiDifficulty;
  team: Team;
} | null = null;

function stopActiveMatch(): void {
  if (!activeMatch) return;
  cancelAnimationFrame(activeMatch.rafId);
  activeMatch.hud.dispose();
  activeMatch.renderer.dispose();
  activeMatch = null;
  appEl.innerHTML = '';
}

function showLobby(screen: 'home' | 'lan_browser' = 'home'): void {
  stopActiveMatch();
  soundEngine.startBgm('lobby');
  if (!lobbyUI) {
    lobbyUI = new LobbyUI(appEl, lanClient.getDefaultAddress(), {
      onStartSolo: (cfg) => {
        lastSoloCfg = cfg;
        startSoloMatch(cfg);
      },
      onLanConnect: (addr) => lanClient.connect(addr),
      onLanRefresh: () => lanClient.listRooms(),
      onLanCreateRoom: (roomName, playerName, heroId, summonerSkill, diff) =>
        lanClient.createRoom(roomName, playerName, heroId, summonerSkill, diff),
      onLanJoinRoom: (roomId, playerName) => lanClient.joinRoom(roomId, playerName),
      onLanLeaveRoom: () => {
        lanClient.leaveRoom();
        lobbyUI?.updateLanState({ room: null });
        lanClient.listRooms();
      },
      onLanSwitchSlot: (team, slotIndex) => lanClient.switchSlot(team, slotIndex),
      onLanSelectHero: (heroId, summonerSkill) => lanClient.selectHero(heroId, summonerSkill),
      onLanSetDifficulty: (diff) => lanClient.setDifficulty(diff),
      onLanStartMatch: () => lanClient.startMatch(),
      onReplaySolo: () => {
        if (lastSoloCfg) startSoloMatch(lastSoloCfg);
        else lobbyUI?.showSoloPick();
      },
      onBackHome: () => {
        lobbyUI?.showHome();
      },
    });
  }
  if (screen === 'lan_browser') lobbyUI.showLanBrowser();
  else lobbyUI.showHome();
}

function mountMatchScene(
  mode: 'solo' | 'lan',
  sim: GameSimulation | null,
  localHeroId: string,
  localTeam: Team
): void {
  lobbyUI?.destroy();
  appEl.innerHTML = '';

  const stage = document.createElement('div');
  stage.className = 'match-stage';
  appEl.appendChild(stage);

  const renderer = new GameRenderer(stage, localTeam);
  const hud = new HudController(stage, renderer, {
    onExitMatch: () => {
      if (mode === 'lan') lanClient.leaveRoom();
      showLobby(mode === 'lan' ? 'lan_browser' : 'home');
    },
  });

  soundEngine.startBgm('battle');

  const initialSnap = sim ? sim.buildSnapshot() : null;
  if (initialSnap) {
    renderer.ingestEvents(initialSnap.events, localHeroId);
    hud.handleEvents(initialSnap.events, localHeroId);
  }

  activeMatch = {
    mode,
    sim,
    renderer,
    hud,
    localHeroId,
    latestSnapshot: initialSnap,
    rafId: 0,
    lastFrameTime: performance.now(),
    elapsed: 0,
    simAccum: 0,
    netSendAccum: 0,
    endedHandled: false,
  };

  const loop = (now: number) => {
    if (!activeMatch) return;
    activeMatch.rafId = requestAnimationFrame(loop);

    const dt = Math.min(0.08, (now - activeMatch.lastFrameTime) / 1000);
    activeMatch.lastFrameTime = now;
    activeMatch.elapsed += dt;

    if (activeMatch.mode === 'solo' && activeMatch.sim) {
      // Fixed 20 Hz simulation ticks (50ms) + smooth 60+ Hz interpolated rendering
      activeMatch.simAccum += dt;
      const fixedDt = 0.05;
      while (activeMatch.simAccum >= fixedDt) {
        activeMatch.simAccum -= fixedDt;
        const input = activeMatch.hud.sampleInput();
        activeMatch.sim.setPlayerInput(activeMatch.localHeroId, input);
        const snap = activeMatch.sim.step(fixedDt);
        activeMatch.latestSnapshot = snap;
        if (snap.events.length > 0) {
          activeMatch.renderer.ingestEvents(snap.events, activeMatch.localHeroId);
          activeMatch.hud.handleEvents(snap.events, activeMatch.localHeroId);
        }
      }
    } else if (activeMatch.mode === 'lan') {
      // Send player inputs to LAN server at 20 Hz (or immediately on skill cast)
      activeMatch.netSendAccum += dt;
      if (activeMatch.netSendAccum >= 0.05) {
        activeMatch.netSendAccum = 0;
        const input = activeMatch.hud.sampleInput();
        lanClient.sendInput(input);
      }
    }

    if (activeMatch.latestSnapshot) {
      const snap = activeMatch.latestSnapshot;
      activeMatch.renderer.render(snap, activeMatch.localHeroId, dt, activeMatch.elapsed);
      const pingStr = activeMatch.mode === 'lan' ? `${lanClient.pingMs}ms 局域网` : '本地人机';
      activeMatch.hud.update(snap, activeMatch.localHeroId, dt, pingStr);

      if (snap.phase === 'ended' && !activeMatch.endedHandled) {
        activeMatch.endedHandled = true;
        const finalSnap = snap;
        const heroId = activeMatch.localHeroId;
        setTimeout(() => {
          stopActiveMatch();
          soundEngine.startBgm('lobby');
          lobbyUI?.showPostMatch(finalSnap, heroId);
        }, 2800);
      }
    }
  };

  activeMatch.rafId = requestAnimationFrame(loop);
}

function startSoloMatch(cfg: {
  playerName: string;
  heroId: HeroId;
  summonerSkill: SummonerSkillId;
  difficulty: AiDifficulty;
  team: Team;
}): void {
  const slots = createSoloMatchSlots(cfg.playerName, cfg.heroId, cfg.summonerSkill, cfg.team);
  const sim = new GameSimulation({ difficulty: cfg.difficulty, slots });
  const playerSlot = slots.find((s) => s.playerId === 'local_player')!;
  const localHeroId = `${playerSlot.team}_${playerSlot.slotIndex}`;
  mountMatchScene('solo', sim, localHeroId, cfg.team);
}

// Wire LAN Client Events
lanClient.setCallbacks({
  onConnected: (playerId, info) => {
    lobbyUI?.updateLanState({ connected: true, playerId, serverInfo: info, error: '' });
  },
  onServerInfo: (info) => {
    lobbyUI?.updateLanState({ serverInfo: info });
  },
  onRoomUpdate: (room) => {
    if (!activeMatch) {
      lobbyUI?.updateLanState({ room, error: '' });
    }
  },
  onMatchStart: (localHeroId, localTeam) => {
    mountMatchScene('lan', null, localHeroId, localTeam);
  },
  onSnapshot: (snap) => {
    if (!activeMatch || activeMatch.mode !== 'lan') return;
    activeMatch.latestSnapshot = snap;
    if (snap.events.length > 0) {
      activeMatch.renderer.ingestEvents(snap.events, activeMatch.localHeroId);
      activeMatch.hud.handleEvents(snap.events, activeMatch.localHeroId);
    }
  },
  onError: (msg) => {
    lobbyUI?.updateLanState({ error: msg });
  },
  onDisconnected: () => {
    lobbyUI?.updateLanState({ connected: false, room: null });
  },
});

// Boot the Game!
showLobby('home');
