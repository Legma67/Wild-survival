/*
 * WILD SURVIVAL – Spielserver
 * ------------------------------------------------------------
 * - liefert das Spiel aus (public/index.html + Three.js aus node_modules)
 * - WebSocket-Multiplayer unter /ws
 * - dedizierte Welten: Der Server ist der „Host“ jeder Welt. Er verwaltet
 *   Welt-Seed, Uhrzeit, Wetter, Gebäude, geöffnete Truhen und die Geheimtür
 *   und speichert sie dauerhaft in data/worlds.json.
 * - Spieler teilen ihre Position/Animation/Ereignisse als „presence“;
 *   der Server verteilt sie an alle in derselben Welt.
 *
 * Start:  npm install  &&  npm start      (Port: Umgebungsvariable PORT, Standard 3000)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_WORLDS = Number(process.env.MAX_WORLDS) || 300;
const MAX_PLAYERS_PER_WORLD = Number(process.env.MAX_PLAYERS) || 16;
const MAX_BUILDINGS = 4000;
const DAY_SECONDS = 480;              // muss zum Spiel passen (G.time += dt/480)
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const WEATHER = ['sunny', 'sunny', 'sunny', 'cloudy', 'cloudy', 'lightrain', 'heavyrain', 'fog', 'storm'];

/* ---------- Welten laden/speichern ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const WFILE = path.join(DATA_DIR, 'worlds.json');
let worlds = {};
try { worlds = JSON.parse(fs.readFileSync(WFILE, 'utf8')); } catch (e) { worlds = {}; }
let dirty = false;
function saveNow() {
  try { fs.writeFileSync(WFILE + '.tmp', JSON.stringify(worlds)); fs.renameSync(WFILE + '.tmp', WFILE); dirty = false; }
  catch (e) { console.error('Speichern fehlgeschlagen:', e.message); }
}
setInterval(() => { if (dirty) saveNow(); }, 5000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveNow(); process.exit(0); });

function newWorld(code, name) {
  const codes = Object.keys(worlds);
  if (codes.length >= MAX_WORLDS) {               // älteste leere Welt entfernen
    const empty = codes.filter(c => !(rooms.get(c) && rooms.get(c).members.size)).sort((a, b) => worlds[a].last - worlds[b].last);
    if (!empty.length) return null;
    delete worlds[empty[0]];
  }
  worlds[code] = { seed: crypto.randomInt(1, 2 ** 30), n: clean(name, 20) || code, created: Date.now(), last: Date.now(),
    tm: 0.3, dy: 1, w: 'sunny', wt: 150, b: [], c: [], sd: 0 };
  dirty = true;
  return worlds[code];
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const num = v => typeof v === 'number' && Number.isFinite(v);

/* ---------- HTTP: Spiel ausliefern ---------- */
const PUBLIC = path.join(__dirname, 'public');
const THREE_DIR = path.dirname(require.resolve('three/package.json'));
const EX_DIR = path.join(THREE_DIR, 'examples', 'js');
function loadHtml() {
  return fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', '/lib/three.min.js')
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/examples\/js\//g, '/lib/ex/')
    .replace('<script src="/lib/three.min.js"></script>', '<script>window.WS_SERVER=1</script><script src="/lib/three.min.js"></script>');
}
let HTML = loadHtml();
function sendFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' }); res.end(buf);
  });
}
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/' || url === '/index.html') {
    if (process.env.NODE_ENV !== 'production') HTML = loadHtml();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(HTML);
  }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/api/status') {
    const list = Object.entries(worlds).map(([c, w]) => ({ code: c, name: w.n, day: w.dy, players: rooms.get(c) ? rooms.get(c).members.size : 0, buildings: w.b.length }));
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ worlds: list.length, online: conns.size, list: list.sort((a, b) => b.players - a.players).slice(0, 50) }));
  }
  if (url === '/lib/three.min.js') return sendFile(res, path.join(THREE_DIR, 'build', 'three.min.js'), 'text/javascript');
  if (url.startsWith('/lib/ex/')) {
    const f = path.normalize(path.join(EX_DIR, url.slice(8)));
    if (!f.startsWith(EX_DIR + path.sep) || !f.endsWith('.js')) { res.writeHead(403); return res.end(); }
    return sendFile(res, f, 'text/javascript');
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
});

/* ---------- Räume & Verbindungen ---------- */
const rooms = new Map();   // name -> { members: Map(peer -> conn), seen: Map(peer -> seq), snapI }
const conns = new Map();   // peer -> conn
function room(name) { let r = rooms.get(name); if (!r) { r = { members: new Map(), seen: new Map(), snapI: 0 }; rooms.set(name, r); } return r; }
function send(c, o) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); }
function broadcast(name, o, exceptPeer) { const r = rooms.get(name); if (!r) return; const s = JSON.stringify(o); for (const [p, c] of r.members) if (p !== exceptPeer && c.ws.readyState === 1) c.ws.send(s); }

/* Der Server erscheint in jeder Welt als Host-Teilnehmer „server“ */
function hostPresence(code) {
  const w = worlds[code], r = room(code);
  const per = 22, pages = Math.max(1, Math.ceil(w.b.length / per));
  r.snapI = (r.snapI + 1) % pages;
  return { host: 1, n: 'Server', seed: w.seed, tm: +w.tm.toFixed(4), dy: w.dy, w: w.w,
    sb: { i: r.snapI, n: pages, b: w.b.slice(r.snapI * per, r.snapI * per + per) }, sc: w.c.slice(0, 200), sd: w.sd ? 1 : 0 };
}
/* In der Lobby erscheinen Welten als virtuelle Teilnehmer mit presence.srv */
function lobbyEntries() {
  const out = {};
  const list = Object.entries(worlds).map(([c, w]) => ({ c, w, p: rooms.get(c) ? rooms.get(c).members.size : 0 }))
    .filter(e => e.p > 0 || Date.now() - e.w.last < 14 * 864e5)
    .sort((a, b) => b.p - a.p || b.w.last - a.w.last).slice(0, 30);
  for (const e of list) out['srv:' + e.c] = { srv: { c: e.c, n: e.w.n, s: e.w.seed, p: Math.max(e.p, 0), d: e.w.dy } };
  return out;
}

/* Ereignisse aus der presence eines Spielers in den Weltzustand übernehmen */
function applyEvents(code, peer, pr) {
  const w = worlds[code], r = room(code);
  const l = pr && pr.ev && Array.isArray(pr.ev.l) ? pr.ev.l : [];
  let last = r.seen.get(peer);
  if (last == null) { r.seen.set(peer, l.length ? l[l.length - 1][0] : 0); return; }
  for (const e of l) {
    if (!Array.isArray(e) || !(e[0] > last)) continue;
    last = e[0];
    const t = e[1];
    if (t === 'b') {
      const [, , uid, id, x, y, z, rot] = e;
      if (typeof uid !== 'string' || !/^[a-z0-9]{2,16}$/i.test(uid) || typeof id !== 'string' || !/^[a-z_]{2,16}$/.test(id)) continue;
      if (![x, y, z, rot].every(num) || Math.abs(x) > 400 || Math.abs(z) > 400 || Math.abs(y) > 120) continue;
      if (w.b.length >= MAX_BUILDINGS || w.b.some(b => b[0] === uid)) continue;
      w.b.push([uid, id, +x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +rot.toFixed(3), 0]); dirty = true;
    } else if (t === 'c') {
      const i = e[2]; if (Number.isInteger(i) && i >= 0 && i < 500 && !w.c.includes(i)) { w.c.push(i); dirty = true; }
    } else if (t === 'd') {
      const b = w.b.find(b => b[0] === e[2]); if (b) { b[6] = e[3] ? 1 : 0; dirty = true; }
    } else if (t === 'sd') { if (!w.sd) { w.sd = 1; dirty = true; } }
  }
  r.seen.set(peer, last);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  const peer = crypto.randomBytes(6).toString('hex');
  const c = { ws, peer, rooms: new Map(), msgs: 0, alive: true };
  conns.set(peer, c);
  send(c, { t: 'hello', peer });
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', data => {
    if (++c.msgs > 80) return;                       // Ratenbegrenzung (pro Sekunde zurückgesetzt)
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    const name = typeof m.room === 'string' ? m.room : '';
    if (!ROOM_RE.test(name)) return;
    if (m.t === 'join') {
      if (c.rooms.size >= 4 && !c.rooms.has(name)) return send(c, { t: 'err', room: name, msg: 'Zu viele Räume' });
      if (name !== 'lobby') {
        if (!worlds[name]) {
          if (!(m.opt && m.opt.create)) return send(c, { t: 'err', room: name, msg: 'Diese Welt gibt es nicht.' });
          if (!newWorld(name, m.opt.n ? m.opt.n + 's Insel' : name)) return send(c, { t: 'err', room: name, msg: 'Server ist voll.' });
        }
        if (room(name).members.size >= MAX_PLAYERS_PER_WORLD) return send(c, { t: 'err', room: name, msg: 'Welt ist voll.' });
        worlds[name].last = Date.now(); dirty = true;
      }
      const r = room(name);
      const peers = {};
      for (const [p, oc] of r.members) peers[p] = oc.rooms.get(name) || {};
      if (name === 'lobby') Object.assign(peers, lobbyEntries()); else peers.server = hostPresence(name);
      r.members.set(peer, c); c.rooms.set(name, {});
      send(c, { t: 'joined', room: name, peers });
    } else if (m.t === 'leave') {
      leave(c, name);
    } else if (m.t === 'pres') {
      if (!c.rooms.has(name) || !m.pr || typeof m.pr !== 'object') return;
      const js = JSON.stringify(m.pr); if (js.length > 8000) return;
      c.rooms.set(name, m.pr);
      if (name !== 'lobby' && worlds[name]) applyEvents(name, peer, m.pr);
      broadcast(name, { t: 'p', room: name, peer, pr: m.pr }, peer);
    }
  });
  ws.on('close', () => { for (const name of [...c.rooms.keys()]) leave(c, name); conns.delete(peer); });
  ws.on('error', () => {});
});
function leave(c, name) {
  const r = rooms.get(name); if (!r) return;
  r.members.delete(c.peer); r.seen.delete(c.peer); c.rooms.delete(name);
  broadcast(name, { t: 'left', room: name, peer: c.peer });
  if (!r.members.size && name !== 'lobby') rooms.delete(name);
}

/* ---------- Welt-Takt: Zeit, Wetter, Host-Status (5×/s) ---------- */
let tick = 0;
setInterval(() => {
  tick++;
  for (const [name, r] of rooms) {
    if (name === 'lobby' || !r.members.size || !worlds[name]) continue;
    const w = worlds[name];
    w.tm += 0.2 / DAY_SECONDS; if (w.tm >= 1) { w.tm -= 1; w.dy++; dirty = true; }
    w.wt -= 0.2; if (w.wt <= 0) { w.w = WEATHER[Math.floor(Math.random() * WEATHER.length)]; w.wt = 110 + Math.random() * 160; }
    broadcast(name, { t: 'p', room: name, peer: 'server', pr: hostPresence(name) });
  }
  if (tick % 5 === 0) for (const c of conns.values()) c.msgs = 0;
  if (tick % 25 === 0) {                                         // Lobby-Liste alle 5 s
    const entries = lobbyEntries();
    for (const [p, pr] of Object.entries(entries)) broadcast('lobby', { t: 'p', room: 'lobby', peer: p, pr });
  }
}, 200);
setInterval(() => {                                               // tote Verbindungen schließen
  for (const c of conns.values()) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch (e) {} }
}, 30000);

server.listen(PORT, () => console.log(`WILD SURVIVAL läuft auf http://localhost:${PORT}  (Welten: ${Object.keys(worlds).length})`));
