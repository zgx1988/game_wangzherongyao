import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { GameSimulation } from '../src/sim/GameSimulation';
import {
  AiDifficulty,
  HeroId,
  PlayerInput,
  RoomInfo,
  RoomSlot,
  SummonerSkillId,
  Team,
} from '../src/sim/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 3000);

const BOT_NAMES = [
  '剑意凌霜', '寒江孤影', '长安月色', '赤壁烽火', '破晓星辰',
  '云梦泽客', '青龙偃月', '玄武镇岳', '朱雀焚天', '白虎啸风',
];
const DEFAULT_BLUE_HEROES: HeroId[] = ['arthur', 'libai', 'daji', 'houyi', 'caiwenji'];
const DEFAULT_RED_HEROES: HeroId[] = ['lubu', 'libai', 'daji', 'houyi', 'caiwenji'];

interface ClientConn {
  id: string;
  name: string;
  ws: WebSocket;
  roomId: string | null;
}

interface ActiveRoom {
  id: string;
  name: string;
  hostId: string;
  status: 'lobby' | 'playing';
  difficulty: AiDifficulty;
  slots: RoomSlot[];
  clients: Map<string, ClientConn>;
  sim: GameSimulation | null;
  loopTimer: NodeJS.Timeout | null;
}

const rooms = new Map<string, ActiveRoom>();
const clients = new Map<string, ClientConn>();
let nextClientSeq = 1;
let nextRoomSeq = 1;

function getLanUrls(): string[] {
  const ifaces = os.networkInterfaces();
  const preferred: string[] = [];
  const other: string[] = [];
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal) {
        const url = `http://${info.address}:${PORT}`;
        if (info.address.startsWith('192.168.') || info.address.startsWith('10.')) {
          preferred.push(url);
        } else if (!info.address.startsWith('198.18.') && !info.address.startsWith('169.254.')) {
          other.push(url);
        }
      }
    }
  }
  const urls = [...preferred, ...other];
  if (urls.length === 0) urls.push(`http://127.0.0.1:${PORT}`);
  return urls;
}

function toRoomInfo(r: ActiveRoom): RoomInfo {
  return {
    id: r.id,
    name: r.name,
    hostId: r.hostId,
    status: r.status,
    difficulty: r.difficulty,
    slots: r.slots.map((s) => ({ ...s })),
    humanCount: r.slots.filter((s) => !s.isBot).length,
  };
}

function sendJson(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastServerInfo(): void {
  const payload = {
    type: 'server_info',
    info: {
      lanUrls: getLanUrls(),
      port: PORT,
      rooms: Array.from(rooms.values()).map(toRoomInfo),
    },
  };
  for (const c of clients.values()) {
    if (!c.roomId) sendJson(c.ws, payload);
  }
}

function broadcastRoom(room: ActiveRoom): void {
  const msg = { type: 'room_update', room: toRoomInfo(room) };
  for (const c of room.clients.values()) {
    sendJson(c.ws, msg);
  }
  broadcastServerInfo();
}

function createInitialSlots(): RoomSlot[] {
  const slots: RoomSlot[] = [];
  for (let i = 0; i < 5; i++) {
    slots.push({
      team: 'blue',
      slotIndex: i,
      playerId: null,
      playerName: BOT_NAMES[i],
      isBot: true,
      heroId: DEFAULT_BLUE_HEROES[i],
      summonerSkill: i === 1 ? 'smite' : i === 4 ? 'heal' : 'flash',
      ready: true,
    });
  }
  for (let i = 0; i < 5; i++) {
    slots.push({
      team: 'red',
      slotIndex: i,
      playerId: null,
      playerName: BOT_NAMES[5 + i],
      isBot: true,
      heroId: DEFAULT_RED_HEROES[i],
      summonerSkill: i === 1 ? 'smite' : i === 4 ? 'heal' : 'flash',
      ready: true,
    });
  }
  return slots;
}

function leaveRoom(client: ClientConn): void {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  client.roomId = null;
  if (!room) return;

  room.clients.delete(client.id);
  const slot = room.slots.find((s) => s.playerId === client.id);
  if (slot) {
    const idx = slot.team === 'blue' ? slot.slotIndex : 5 + slot.slotIndex;
    slot.playerId = null;
    slot.playerName = BOT_NAMES[idx];
    slot.isBot = true;
    slot.ready = true;
  }

  // If playing, hand hero over to Bot AI seamlessly!
  if (room.sim) {
    const hero = room.sim.getHeroByPlayerId(client.id);
    if (hero) {
      hero.isBot = true;
      hero.playerId = null;
    }
  }

  if (room.clients.size === 0) {
    if (room.loopTimer) clearInterval(room.loopTimer);
    rooms.delete(room.id);
    broadcastServerInfo();
    return;
  }

  if (room.hostId === client.id) {
    const nextHost = room.clients.values().next().value;
    if (nextHost) room.hostId = nextHost.id;
  }
  broadcastRoom(room);
}

function startRoomMatch(room: ActiveRoom): void {
  if (room.status === 'playing') return;
  room.status = 'playing';
  room.sim = new GameSimulation({
    difficulty: room.difficulty,
    slots: room.slots.map((s) => ({ ...s })),
  });

  // Notify each client of their assigned heroId and team
  for (const c of room.clients.values()) {
    const slot = room.slots.find((s) => s.playerId === c.id);
    const localHeroId = slot ? `${slot.team}_${slot.slotIndex}` : 'blue_0';
    const localTeam: Team = slot ? slot.team : 'blue';
    sendJson(c.ws, {
      type: 'match_start',
      localHeroId,
      localTeam,
      room: toRoomInfo(room),
    });
  }

  broadcastServerInfo();

  let lastTime = Date.now();
  room.loopTimer = setInterval(() => {
    if (!room.sim) return;
    const now = Date.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    const snap = room.sim.step(dt);
    const payload = JSON.stringify({ type: 'snapshot', snapshot: snap });
    for (const c of room.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    }

    if (snap.phase === 'ended') {
      if (room.loopTimer) clearInterval(room.loopTimer);
      room.loopTimer = null;
      setTimeout(() => {
        room.status = 'lobby';
        room.sim = null;
        broadcastRoom(room);
      }, 3500);
    }
  }, 50); // 20 Hz Authoritative Simulation Tick
}

// === HTTP Static File & API Server ===
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        lanUrls: getLanUrls(),
        port: PORT,
        rooms: Array.from(rooms.values()).map(toRoomInfo),
      })
    );
    return;
  }

  let filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend not built yet. Run "npm run build" first.');
  }
});

// === WebSocket LAN Game Server ===
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const id = `p_${nextClientSeq++}`;
  const client: ClientConn = {
    id,
    name: `召唤师${nextClientSeq - 1}`,
    ws,
    roomId: null,
  };
  clients.set(id, client);

  sendJson(ws, {
    type: 'welcome',
    playerId: id,
    info: {
      lanUrls: getLanUrls(),
      port: PORT,
      rooms: Array.from(rooms.values()).map(toRoomInfo),
    },
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      switch (msg.type) {
        case 'ping':
          sendJson(ws, { type: 'pong', ts: msg.ts });
          break;

        case 'set_name':
          if (typeof msg.name === 'string' && msg.name.trim()) {
            client.name = msg.name.trim().slice(0, 14);
          }
          break;

        case 'list_rooms':
          sendJson(ws, {
            type: 'server_info',
            info: {
              lanUrls: getLanUrls(),
              port: PORT,
              rooms: Array.from(rooms.values()).map(toRoomInfo),
            },
          });
          break;

        case 'create_room': {
          leaveRoom(client);
          if (msg.playerName) client.name = String(msg.playerName).trim().slice(0, 14) || client.name;
          const roomId = `room_${nextRoomSeq++}`;
          const slots = createInitialSlots();
          slots[0].playerId = client.id;
          slots[0].playerName = client.name;
          slots[0].isBot = false;
          slots[0].heroId = (msg.heroId as HeroId) || 'arthur';
          slots[0].summonerSkill = (msg.summonerSkill as SummonerSkillId) || 'flash';

          const room: ActiveRoom = {
            id: roomId,
            name: String(msg.roomName || `${client.name}的荣耀房间`).slice(0, 20),
            hostId: client.id,
            status: 'lobby',
            difficulty: (msg.difficulty as AiDifficulty) || 'normal',
            slots,
            clients: new Map([[client.id, client]]),
            sim: null,
            loopTimer: null,
          };
          rooms.set(roomId, room);
          client.roomId = roomId;
          broadcastRoom(room);
          break;
        }

        case 'join_room': {
          const room = rooms.get(msg.roomId);
          if (!room) {
            sendJson(ws, { type: 'error', message: '房间不存在或已解散' });
            break;
          }
          if (room.status !== 'lobby') {
            sendJson(ws, { type: 'error', message: '该房间对局已经开始' });
            break;
          }
          leaveRoom(client);
          if (msg.playerName) client.name = String(msg.playerName).trim().slice(0, 14) || client.name;

          // Balance teams automatically when joining
          const blueHumans = room.slots.filter((s) => s.team === 'blue' && !s.isBot).length;
          const redHumans = room.slots.filter((s) => s.team === 'red' && !s.isBot).length;
          const preferredTeam: Team = blueHumans <= redHumans ? 'blue' : 'red';
          const openSlot =
            room.slots.find((s) => s.team === preferredTeam && s.isBot) ||
            room.slots.find((s) => s.isBot);
          if (!openSlot) {
            sendJson(ws, { type: 'error', message: '房间已满 (10/10)' });
            break;
          }
          openSlot.playerId = client.id;
          openSlot.playerName = client.name;
          openSlot.isBot = false;
          openSlot.ready = true;

          room.clients.set(client.id, client);
          client.roomId = room.id;
          broadcastRoom(room);
          break;
        }

        case 'leave_room':
          leaveRoom(client);
          break;

        case 'switch_slot': {
          const room = client.roomId ? rooms.get(client.roomId) : null;
          if (!room || room.status !== 'lobby') break;
          const curSlot = room.slots.find((s) => s.playerId === client.id);
          const targetSlot = room.slots.find(
            (s) => s.team === msg.team && s.slotIndex === msg.slotIndex && s.isBot
          );
          if (!curSlot || !targetSlot) break;

          const curIdx = curSlot.team === 'blue' ? curSlot.slotIndex : 5 + curSlot.slotIndex;
          targetSlot.playerId = curSlot.playerId;
          targetSlot.playerName = curSlot.playerName;
          targetSlot.heroId = curSlot.heroId;
          targetSlot.summonerSkill = curSlot.summonerSkill;
          targetSlot.isBot = false;

          curSlot.playerId = null;
          curSlot.playerName = BOT_NAMES[curIdx];
          curSlot.isBot = true;
          broadcastRoom(room);
          break;
        }

        case 'select_hero': {
          const room = client.roomId ? rooms.get(client.roomId) : null;
          if (!room || room.status !== 'lobby') break;
          const slot = room.slots.find((s) => s.playerId === client.id);
          if (!slot) break;
          if (msg.heroId) slot.heroId = msg.heroId;
          if (msg.summonerSkill) slot.summonerSkill = msg.summonerSkill;
          broadcastRoom(room);
          break;
        }

        case 'set_difficulty': {
          const room = client.roomId ? rooms.get(client.roomId) : null;
          if (!room || room.hostId !== client.id || room.status !== 'lobby') break;
          room.difficulty = msg.difficulty;
          broadcastRoom(room);
          break;
        }

        case 'start_match': {
          const room = client.roomId ? rooms.get(client.roomId) : null;
          if (!room || room.hostId !== client.id) break;
          startRoomMatch(room);
          break;
        }

        case 'player_input': {
          const room = client.roomId ? rooms.get(client.roomId) : null;
          if (!room || !room.sim) break;
          room.sim.setPlayerInput(client.id, msg.input as PlayerInput);
          break;
        }
      }
    } catch {
      // Ignore malformed message
    }
  });

  ws.on('close', () => {
    leaveRoom(client);
    clients.delete(id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n=======================================================');
  console.log('   ⚔️  荣耀峡谷 5v5 · 局域网联机服务器已启动！');
  console.log('=======================================================');
  console.log(`   本机访问:   http://127.0.0.1:${PORT}`);
  for (const url of getLanUrls()) {
    console.log(`   局域网联机: ${url}  (手机/电脑同Wi-Fi直连!)`);
  }
  console.log('=======================================================\n');
});
