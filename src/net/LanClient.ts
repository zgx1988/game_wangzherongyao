import {
  AiDifficulty,
  HeroId,
  PlayerInput,
  RoomInfo,
  ServerInfo,
  SummonerSkillId,
  Team,
  WorldSnapshot,
} from '../sim/types';

export interface LanClientCallbacks {
  onConnected?: (playerId: string, info: ServerInfo) => void;
  onServerInfo?: (info: ServerInfo) => void;
  onRoomUpdate?: (room: RoomInfo) => void;
  onMatchStart?: (localHeroId: string, localTeam: Team, room: RoomInfo) => void;
  onSnapshot?: (snap: WorldSnapshot) => void;
  onError?: (message: string) => void;
  onDisconnected?: () => void;
}

export class LanClient {
  private ws: WebSocket | null = null;
  public playerId: string | null = null;
  public connected = false;
  public pingMs = 0;
  private pingTimer: number | null = null;
  private callbacks: LanClientCallbacks = {};
  public serverAddress = '';

  public setCallbacks(cb: LanClientCallbacks): void {
    this.callbacks = cb;
  }

  public getDefaultAddress(): string {
    const saved = localStorage.getItem('hog_lan_server');
    if (saved) return saved;
    if (typeof location !== 'undefined' && location.protocol.startsWith('http') && location.host) {
      return location.host;
    }
    return '192.168.1.100:3000';
  }

  public connect(address?: string): void {
    this.disconnect();
    const raw = (address || this.getDefaultAddress()).trim();
    this.serverAddress = raw;
    localStorage.setItem('hog_lan_server', raw);

    let wsUrl = raw;
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      const cleaned = wsUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
      wsUrl = `${proto}://${cleaned}/ws`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.pingTimer = window.setInterval(() => {
          this.send({ type: 'ping', ts: performance.now() });
        }, 2500);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === 'pong') {
            this.pingMs = Math.round(performance.now() - msg.ts);
          } else if (msg.type === 'welcome') {
            this.playerId = msg.playerId;
            this.callbacks.onConnected?.(msg.playerId, msg.info as ServerInfo);
          } else if (msg.type === 'server_info') {
            this.callbacks.onServerInfo?.(msg.info as ServerInfo);
          } else if (msg.type === 'room_update') {
            this.callbacks.onRoomUpdate?.(msg.room as RoomInfo);
          } else if (msg.type === 'match_start') {
            this.callbacks.onMatchStart?.(msg.localHeroId, msg.localTeam, msg.room as RoomInfo);
          } else if (msg.type === 'snapshot') {
            this.callbacks.onSnapshot?.(msg.snapshot as WorldSnapshot);
          } else if (msg.type === 'error') {
            this.callbacks.onError?.(msg.message);
          }
        } catch {
          // Ignore malformed packet
        }
      };

      ws.onerror = () => {
        this.callbacks.onError?.(`无法连接局域网服务器 (${raw})，请确认主机已运行服务器且在同一 Wi-Fi 下。`);
      };

      ws.onclose = () => {
        this.connected = false;
        if (this.pingTimer !== null) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        this.callbacks.onDisconnected?.();
      };
    } catch {
      this.callbacks.onError?.('无效的服务器地址格式');
    }
  }

  public disconnect(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  public listRooms(): void {
    this.send({ type: 'list_rooms' });
  }

  public createRoom(
    roomName: string,
    playerName: string,
    heroId: HeroId,
    summonerSkill: SummonerSkillId,
    difficulty: AiDifficulty
  ): void {
    this.send({ type: 'create_room', roomName, playerName, heroId, summonerSkill, difficulty });
  }

  public joinRoom(roomId: string, playerName: string): void {
    this.send({ type: 'join_room', roomId, playerName });
  }

  public leaveRoom(): void {
    this.send({ type: 'leave_room' });
  }

  public switchSlot(team: Team, slotIndex: number): void {
    this.send({ type: 'switch_slot', team, slotIndex });
  }

  public selectHero(heroId: HeroId, summonerSkill: SummonerSkillId): void {
    this.send({ type: 'select_hero', heroId, summonerSkill });
  }

  public setDifficulty(difficulty: AiDifficulty): void {
    this.send({ type: 'set_difficulty', difficulty });
  }

  public startMatch(): void {
    this.send({ type: 'start_match' });
  }

  public sendInput(input: PlayerInput): void {
    this.send({ type: 'player_input', input });
  }
}
