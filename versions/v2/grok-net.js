/* grok-net.js - tiny online multiplayer layer for Grok games (v1)
 *
 * WebRTC peer-to-peer through PeerJS (vendored peerjs.min.js), signalling via the free
 * public PeerJS cloud broker (0.peerjs.com). Star topology: the HOST owns the room and
 * relays; up to 2 clients connect to it. The host's peer id is derived from the join code
 * ("grokarcade-<CODE>") so joiners only need the code.
 *
 *   var room = GrokNet.createRoom({ role: 'host'|'join', code, name, color, rejoin: true });
 *   room.on('open', fn) .on('players', fn(list)) .on('join', fn(p)) .on('leave', fn(p))
 *       .on('message', fn(data, fromPid)) .on('meta', fn(meta)) .on('ping', fn(ms))
 *       .on('status', fn(text)) .on('reconnecting', fn) .on('error', fn(err{code,title,message}))
 *   room.start();
 *   room.send(data)        client -> host (host: delivered to itself)
 *   room.broadcast(data)   host -> every client; client -> host, which relays to the others
 *   room.sendTo(pid, data) host -> one client
 *   room.setState({ready:true})  my public per-player state (synced to everyone)
 *   room.setMeta({game:'brawl'}) host-only shared room state
 *   room.players(), room.me(), room.isHost, room.code, room.leave(), room.markNavigating()
 *
 * Games get their room from the URL: ?mp=host|join&code=XXXXX&name=..&color=..&pid=..&slot=..&n=..
 * (GrokNet.params()). Test/dev only: &peer=localhost:9000 switches to a local PeerJS server.
 */
(function (root) {
  'use strict';
  var GN = root.GrokNet = root.GrokNet || {};
  GN.VERSION = 1;
  GN.ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
  GN.CODE_LEN = 5;
  GN.MAX_PLAYERS = 3;
  GN.PREFIX = 'grokarcade-';
  GN.HUB_URL = 'https://lizethbran13-cmyk.github.io/grok-arcade/';
  GN.COLORS = ['#ff4fd8', '#3ff0ff', '#ffe14d', '#4ade80', '#ff7a3d', '#a78bfa'];
  GN.DEFAULT_SERVER = { host: '0.peerjs.com', port: 443, secure: true, path: '/' };
  // Google's public STUN servers. Some strict networks (symmetric NAT, corporate firewalls)
  // would also need a TURN relay, which is not included (no server of our own).
  GN.ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }];

  var ERRORS = {
    notfound: ['Code not found', 'No room uses that code. Check the code with the host and try again.'],
    full: ['Room full (3/3)', 'That room already has 3 players.'],
    hostleft: ['Host left', 'The host closed the game, so the room ended.'],
    network: ['Can\u2019t reach the game server', 'Check your internet connection and try again.'],
    p2p: ['Couldn\u2019t connect', 'Your network blocked the direct connection between phones. Try switching Wi-Fi / mobile data.'],
    taken: ['Room code busy', 'That room is still open somewhere. Try again in a moment.'],
    nopeer: ['Online play unavailable', 'The multiplayer library did not load.']
  };
  GN.ERRORS = ERRORS;
  function mkErr(code) { var e = ERRORS[code] || [code, '']; return { code: code, title: e[0], message: e[1] }; }

  /* ---------- helpers ---------- */
  GN.makeCode = function () { var s = ''; for (var i = 0; i < GN.CODE_LEN; i++) s += GN.ALPHABET.charAt((Math.random() * GN.ALPHABET.length) | 0); return s; };
  GN.normalizeCode = function (s) {
    s = String(s || '').toUpperCase(); var out = '';
    for (var i = 0; i < s.length && out.length < GN.CODE_LEN; i++) if (GN.ALPHABET.indexOf(s.charAt(i)) >= 0) out += s.charAt(i);
    return out;
  };
  GN.validCode = function (s) { return typeof s === 'string' && s.length === GN.CODE_LEN && GN.normalizeCode(s) === s; };
  function rid(n) { var s = ''; for (var i = 0; i < (n || 8); i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'.charAt((Math.random() * 32) | 0); return s; }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  GN.cleanName = function (s) { s = String(s || '').replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12); return s || 'Player'; };
  GN.cleanColor = function (c) { return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c.toLowerCase() : GN.COLORS[0]; };
  GN.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  GN.pid = function () { var p = ss('grokNet.pid'); if (!p) { p = rid(10); ss('grokNet.pid', p); } return p; };
  GN.savedProfile = function () { return { name: GN.cleanName(ls('grokNet.name') || ''), color: GN.cleanColor(ls('grokNet.color')), hasName: !!ls('grokNet.name') }; };
  GN.saveProfile = function (name, color) { ls('grokNet.name', GN.cleanName(name)); ls('grokNet.color', GN.cleanColor(color)); };

  /* ---------- URL params ---------- */
  function search() { try { return new URLSearchParams(location.search); } catch (e) { return { get: function () { return null; } }; } }
  GN.params = function () {
    var q = search(), mode = q.get('mp'), code = GN.normalizeCode(q.get('code'));
    if ((mode !== 'host' && mode !== 'join') || !GN.validCode(code)) return null;
    var pid = q.get('pid') || GN.pid(); ss('grokNet.pid', pid);
    return { mode: mode, code: code, name: GN.cleanName(q.get('name')), color: GN.cleanColor(q.get('color')), pid: pid,
      slot: q.get('slot') != null ? +q.get('slot') : null, n: Math.max(1, Math.min(GN.MAX_PLAYERS, +q.get('n') || 2)), q: q };
  };
  GN.peerParam = function () { var q = search(); return q.get('peer') || ls('grokNet.peer') || ''; };
  // optional TURN relay "user:pass@host:port" (off by default; strict networks / test rigs)
  GN.turnParam = function () { var q = search(); return q.get('turn') || ls('grokNet.turn') || ''; };
  GN.hubUrl = function () { var q = search(); return q.get('hub') || GN.HUB_URL; };
  // build a URL into another game, passing room + dev switches along
  GN.buildUrl = function (base, o, extra) {
    var q = search(), u = base + (base.indexOf('?') >= 0 ? '&' : '?');
    var p = ['mp=' + o.mode, 'code=' + o.code, 'name=' + encodeURIComponent(GN.cleanName(o.name)), 'color=' + encodeURIComponent(GN.cleanColor(o.color)), 'pid=' + encodeURIComponent(o.pid || GN.pid())];
    if (o.slot != null) p.push('slot=' + o.slot);
    if (o.n != null) p.push('n=' + o.n);
    var peer = GN.peerParam(); if (peer) p.push('peer=' + encodeURIComponent(peer));
    var turn = GN.turnParam(); if (turn) p.push('turn=' + encodeURIComponent(turn));
    var hub = o.hub || q.get('hub'); if (hub) p.push('hub=' + encodeURIComponent(hub));
    if (extra) for (var k in extra) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]));
    return u + p.join('&');
  };
  // URL of this page without any multiplayer params (for "play solo")
  GN.soloUrl = function () { return location.origin + location.pathname; };

  function serverOpts() {
    var o = { host: GN.DEFAULT_SERVER.host, port: GN.DEFAULT_SERVER.port, secure: GN.DEFAULT_SERVER.secure, path: GN.DEFAULT_SERVER.path };
    var pp = GN.peerParam();
    if (pp) { // dev/test switch only, e.g. "localhost:9000"
      var m = /^(?:(https?):\/\/)?([^:/]+)(?::(\d+))?(\/.*)?$/.exec(pp);
      if (m) { o.host = m[2]; o.port = +(m[3] || (m[1] === 'https' ? 443 : 80)); o.secure = m[1] === 'https'; o.path = m[4] || '/'; }
    }
    var ice = GN.ICE.slice(), tp = GN.turnParam(), tm = /^([^:@]+):([^@]+)@([^:]+):(\d+)$/.exec(tp);
    if (tm) ice.unshift({ urls: 'turn:' + tm[3] + ':' + tm[4] + '?transport=udp', username: tm[1], credential: tm[2] });
    o.config = { iceServers: ice }; o.debug = 0;
    return o;
  }
  GN.serverOpts = serverOpts;

  /* ---------- Room ---------- */
  function Room(opts) {
    this.opts = opts || {};
    this.isHost = opts.role === 'host';
    this.code = GN.normalizeCode(opts.code) || GN.makeCode();
    this.pid = opts.pid || GN.pid();
    this.name = GN.cleanName(opts.name); this.color = GN.cleanColor(opts.color);
    this.max = opts.max || GN.MAX_PLAYERS;
    this._h = {}; this._players = {}; this._conns = {}; this._slotMem = {}; this._meta = {};
    this._state = opts.state || {}; this.ping = 0; this.opened = false; this.destroyed = false; this.navigating = false; this.failed = null;
    var self = this;
    this._onHide = function () { if (!self.navigating && !self.destroyed) self._bye(); };
    window.addEventListener('pagehide', this._onHide);
  }
  var R = Room.prototype;
  R.on = function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; };
  R.off = function (ev, fn) { var a = this._h[ev]; if (a) this._h[ev] = a.filter(function (f) { return f !== fn; }); return this; };
  R._emit = function (ev) { var a = this._h[ev], args = Array.prototype.slice.call(arguments, 1); if (a) a.slice().forEach(function (f) { try { f.apply(null, args); } catch (e) { setTimeout(function () { throw e; }); } }); };
  R._status = function (t) { this.statusText = t; this._emit('status', t); };
  R._fail = function (code) {
    if (this.destroyed || this.failed) return; this.failed = code;
    this._emit('error', mkErr(code)); this._teardown();
  };
  R.players = function () { var a = []; for (var k in this._players) a.push(this._players[k]); return a.sort(function (x, y) { return x.slot - y.slot; }); };
  R.count = function () { return Object.keys(this._players).length; };
  R.me = function () { return this._players[this.pid] || null; };
  R.player = function (pid) { return this._players[pid] || null; };
  R.meta = function () { return this._meta; };
  R.markNavigating = function () { this.navigating = true; };
  R.start = function () {
    if (typeof root.Peer !== 'function') { var s = this; setTimeout(function () { s._fail('nopeer'); }); return this; }
    if (this.isHost) this._startHost(); else this._startJoin();
    return this;
  };
  R._pub = function (p) { return { pid: p.pid, name: p.name, color: p.color, slot: p.slot, host: !!p.host, ready: !!p.ready, ping: p.ping | 0, state: p.state || {} }; };
  R._list = function () { var s = this; return this.players().map(function (p) { return s._pub(p); }); };

  /* ----- host ----- */
  R._startHost = function () {
    var self = this, tries = 0, deadline = Date.now() + (this.opts.rejoin ? 22000 : 9000);
    this._players[this.pid] = { pid: this.pid, name: this.name, color: this.color, slot: 0, host: true, ready: true, ping: 0, state: this._state };
    this._slotMem[this.pid] = 0;
    function attempt() {
      if (self.destroyed) return;
      tries++;
      self._status(tries > 1 ? 'Opening room ' + self.code + '\u2026 (retry ' + (tries - 1) + ')' : 'Opening room ' + self.code + '\u2026');
      var peer = self.peer = new root.Peer(GN.PREFIX + self.code, serverOpts());
      peer.on('open', function () {
        if (self.peer !== peer) return;
        var first = !self.opened; self.opened = true; self._status('Room open');
        if (first) { self._emit('open', self.me()); self._emit('players', self._list()); self._startTimers(); }
      });
      peer.on('connection', function (conn) { self._hostConn(conn); });
      peer.on('disconnected', function () { if (self.peer === peer && !self.destroyed && !peer.destroyed) setTimeout(function () { try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch (e) {} }, 1000); });
      peer.on('error', function (e) {
        if (self.peer !== peer || self.destroyed) return;
        var t = e && e.type;
        if (t === 'peer-unavailable') return; // not relevant for the host
        if (self.opened && t !== 'unavailable-id') return; // signalling hiccup; P2P links keep running
        try { peer.destroy(); } catch (er) {}
        if (t === 'unavailable-id' && self.opts.autoCode && tries < 6) { self.code = GN.makeCode(); setTimeout(attempt, 50); return; }
        if (Date.now() < deadline) { setTimeout(attempt, Math.min(3000, 400 * tries)); return; }
        self._fail(t === 'unavailable-id' ? 'taken' : 'network');
      });
    }
    attempt();
  };
  R._freeSlot = function (pref) {
    var used = {}; for (var k in this._players) used[this._players[k].slot] = 1;
    if (pref != null && pref > 0 && pref < this.max && !used[pref]) return pref;
    for (var i = 1; i < this.max; i++) if (!used[i]) return i;
    return -1;
  };
  R._hostConn = function (conn) {
    var self = this;
    conn._last = Date.now();
    conn.on('data', function (d) { conn._last = Date.now(); self._hostData(conn, d); });
    var drop = function () { self._drop(conn); };
    conn.on('close', drop); conn.on('error', drop);
  };
  R._hostData = function (conn, d) {
    if (!d || typeof d !== 'object') return;
    var pid = conn._pid, p = pid && this._players[pid];
    switch (d._n) {
      case 'hello': {
        pid = String(d.pid || '').slice(0, 24) || rid(8);
        var ex = this._players[pid];
        if (!ex && this.count() >= this.max) { try { conn.send({ _n: 'reject', reason: 'full', max: this.max }); } catch (e) {} setTimeout(function () { try { conn.close(); } catch (e) {} }, 600); return; }
        if (ex && this._conns[pid] && this._conns[pid] !== conn) { var old = this._conns[pid]; old._replaced = true; try { old.close(); } catch (e) {} }
        var slot = ex ? ex.slot : this._freeSlot(this._slotMem[pid] != null ? this._slotMem[pid] : d.slot);
        if (slot < 0) { try { conn.send({ _n: 'reject', reason: 'full', max: this.max }); } catch (e) {} return; }
        conn._pid = pid; this._conns[pid] = conn; this._slotMem[pid] = slot;
        p = this._players[pid] = { pid: pid, name: GN.cleanName(d.name), color: GN.cleanColor(d.color), slot: slot, host: false, ready: !!(d.state && d.state.ready), ping: ex ? ex.ping : 0, state: d.state || {} };
        p.ready = !!p.state.ready;
        try { conn.send({ _n: 'welcome', pid: pid, slot: slot, code: this.code, players: this._list(), meta: this._meta }); } catch (e) {}
        if (!ex) this._emit('join', this._pub(p));
        this._syncPlayers();
        break;
      }
      case 'ping': try { conn.send({ _n: 'pong', t: d.t }); } catch (e) {} break;
      case 'pong': if (p) { p.ping = Math.round(performance.now() - d.t); } break;
      case 'state': if (p) { for (var k in d.s) p.state[k] = d.s[k]; p.ready = !!p.state.ready; this._syncPlayers(); } break;
      case 'app':
        if (!p) return;
        if (d.r) this._fanout({ _n: 'app', d: d.d, f: pid }, pid);
        this._emit('message', d.d, pid);
        break;
      case 'bye': this._drop(conn); break;
    }
  };
  R._drop = function (conn) {
    var pid = conn._pid; if (!pid || conn._dropped) return; conn._dropped = true;
    if (conn._replaced || this._conns[pid] !== conn) return;
    delete this._conns[pid];
    var p = this._players[pid]; if (!p) return;
    delete this._players[pid];
    try { conn.close(); } catch (e) {}
    if (!this.destroyed) { this._emit('leave', this._pub(p)); this._syncPlayers(); }
  };
  R._fanout = function (msg, except) { for (var k in this._conns) if (k !== except) { try { this._conns[k].send(msg); } catch (e) {} } };
  R._syncPlayers = function () { var l = this._list(); this._fanout({ _n: 'players', players: l }); this._emit('players', l); };

  /* ----- client ----- */
  R._startJoin = function () {
    var self = this, k = 0;
    this._failCode = this.opts.rejoin ? 'hostleft' : 'notfound';
    this._deadline = Date.now() + (this.opts.rejoin ? 20000 : 5000);
    this._status('Connecting to room ' + this.code + '\u2026');
    var peer = this.peer = new root.Peer(serverOpts());
    peer.on('open', function () { self._connect(); });
    peer.on('disconnected', function () { if (!self.destroyed && !peer.destroyed) setTimeout(function () { try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch (e) {} }, 800); });
    peer.on('error', function (e) {
      if (self.destroyed) return;
      var t = e && e.type;
      if (t === 'peer-unavailable') { self._retry(self._failCode); return; }
      if (!peer.open && !self.opened) { if (Date.now() < self._deadline) return; self._fail('network'); }
    });
  };
  R._retry = function (code) {
    var self = this; clearTimeout(this._openT);
    if (this.destroyed || this.failed) return;
    if (this._conn) { var c = this._conn; this._conn = null; c._dead = true; try { c.close(); } catch (e) {} }
    if (Date.now() >= this._deadline) { this._fail(code); return; }
    this._tries = (this._tries || 0) + 1;
    var wait = Math.min(3000, 350 * Math.pow(1.6, this._tries));
    this._status((this.opts.rejoin || this.opened ? 'Waiting for host' : 'Looking for room ' + this.code) + '\u2026');
    clearTimeout(this._retryT); this._retryT = setTimeout(function () { self._connect(); }, wait);
  };
  R._connect = function () {
    var self = this; if (this.destroyed || this.failed) return;
    if (!this.peer || this.peer.destroyed) return;
    if (this.peer.disconnected) { try { this.peer.reconnect(); } catch (e) {} this._retry(this._failCode); return; }
    var conn = this._conn = this.peer.connect(GN.PREFIX + this.code, { reliable: true, serialization: 'json' });
    if (!conn) { this._retry(this._failCode); return; }
    conn.on('open', function () { if (conn._dead) return; conn.send({ _n: 'hello', pid: self.pid, name: self.name, color: self.color, slot: self.opts.slot, state: self._state, v: GN.VERSION }); });
    conn.on('data', function (d) { if (conn._dead) return; self._last = Date.now(); self._clientData(d); });
    conn.on('close', function () { if (!conn._dead) self._hostGone(conn); });
    conn.on('error', function () { if (!conn._dead) self._hostGone(conn); });
    clearTimeout(this._openT);
    this._openT = setTimeout(function () {
      if (self._conn !== conn || self._welcomed) return;
      // no answer from the host at all -> the code doesn't exist (or the host is gone); an answer but no link -> network blocked P2P
      var pc = conn.peerConnection, answered = !!(pc && pc.remoteDescription);
      self._retry(self.opened ? 'hostleft' : answered ? 'p2p' : self._failCode);
    }, 7000);
  };
  R._clientData = function (d) {
    if (!d || typeof d !== 'object') return;
    switch (d._n) {
      case 'welcome':
        clearTimeout(this._openT); this._welcomed = true; this._tries = 0; this.slot = d.slot;
        this._setPlayers(d.players); this._meta = d.meta || {};
        if (!this.opened) { this.opened = true; this._status('Connected'); this._emit('open', this.me()); this._startTimers(); }
        else { this._status('Reconnected'); this._emit('reconnected'); }
        this._emit('meta', this._meta); this._emit('players', this._list());
        break;
      case 'reject': this._fail(d.reason === 'full' ? 'full' : 'notfound'); break;
      case 'players': this._setPlayers(d.players); this._emit('players', this._list()); break;
      case 'meta': this._meta = d.meta || {}; this._emit('meta', this._meta); break;
      case 'app': this._emit('message', d.d, d.f || this._hostPid()); break;
      case 'ping': try { this._conn.send({ _n: 'pong', t: d.t }); } catch (e) {} break;
      case 'pong': this.ping = Math.round(performance.now() - d.t); var me = this.me(); if (me) me.ping = this.ping; this._emit('ping', this.ping); break;
      case 'bye': this._welcomed = false; var c = this._conn; this._conn = null; if (c) { c._dead = true; try { c.close(); } catch (e) {} } if (!this.navigating) this._fail('hostleft'); break;
    }
  };
  R._hostPid = function () { var l = this.players(); for (var i = 0; i < l.length; i++) if (l[i].host) return l[i].pid; return null; };
  R._setPlayers = function (list) {
    var old = this._players, np = {}, self = this;
    (list || []).forEach(function (p) { np[p.pid] = p; if (!old[p.pid] && self.opened && p.pid !== self.pid) self._emit('join', p); });
    for (var k in old) if (!np[k] && k !== this.pid && this.opened) this._emit('leave', old[k]);
    this._players = np;
  };
  R._hostGone = function (conn) {
    if (this._conn !== conn) return;
    this._conn = null; conn._dead = true; this._welcomed = false;
    if (this.destroyed || this.navigating || this.failed) return;
    if (!this.opened) { this._retry(this._failCode); return; }
    // the host may just be reloading / navigating: retry for a while before giving up
    this._failCode = 'hostleft'; this._deadline = Date.now() + 12000; this._tries = 0;
    this._status('Host disconnected - reconnecting\u2026'); this._emit('reconnecting');
    this._retry('hostleft');
  };

  /* ----- shared ----- */
  R._startTimers = function () {
    var self = this;
    clearInterval(this._pingI);
    this._last = Date.now();
    this._pingI = setInterval(function () {
      if (self.destroyed) return;
      var now = Date.now(), t = performance.now();
      if (self.isHost) {
        for (var k in self._conns) {
          var c = self._conns[k];
          if (now - c._last > 9000) { self._drop(c); continue; }
          try { c.send({ _n: 'ping', t: t }); } catch (e) {}
        }
        if ((self._pc = (self._pc || 0) + 1) % 2 === 0 && Object.keys(self._conns).length) self._syncPlayers();
        var mx = 0; self.players().forEach(function (p) { if (!p.host) mx = Math.max(mx, p.ping | 0); }); self.ping = mx; self._emit('ping', mx);
      } else if (self._conn && self._welcomed) {
        if (now - self._last > 9000) { self._hostGone(self._conn); return; }
        try { self._conn.send({ _n: 'ping', t: t }); } catch (e) {}
      }
    }, 1000);
  };
  R.send = function (data) {
    if (this.isHost) { this._emit('message', data, this.pid); return true; }
    if (!this._conn || !this._welcomed) return false;
    try { this._conn.send({ _n: 'app', d: data }); return true; } catch (e) { return false; }
  };
  R.broadcast = function (data, opts) {
    if (this.isHost) { this._fanout({ _n: 'app', d: data, f: this.pid }); if (opts && opts.self) this._emit('message', data, this.pid); return true; }
    if (!this._conn || !this._welcomed) return false;
    try { this._conn.send({ _n: 'app', d: data, r: 1 }); return true; } catch (e) { return false; }
  };
  R.sendTo = function (pid, data) {
    if (!this.isHost) return pid === this._hostPid() ? this.send(data) : false;
    if (pid === this.pid) { this._emit('message', data, this.pid); return true; }
    var c = this._conns[pid]; if (!c) return false;
    try { c.send({ _n: 'app', d: data, f: this.pid }); return true; } catch (e) { return false; }
  };
  R.setState = function (s) {
    for (var k in s) this._state[k] = s[k];
    var me = this.me(); if (me) { me.state = this._state; me.ready = !!this._state.ready; }
    if (this.isHost) this._syncPlayers();
    else if (this._conn && this._welcomed) { try { this._conn.send({ _n: 'state', s: s }); } catch (e) {} this._emit('players', this._list()); }
  };
  R.setMeta = function (m) {
    if (!this.isHost) return;
    for (var k in m) this._meta[k] = m[k];
    this._fanout({ _n: 'meta', meta: this._meta }); this._emit('meta', this._meta);
  };
  R._bye = function () {
    if (this.isHost) this._fanout({ _n: 'bye' });
    else if (this._conn) { try { this._conn.send({ _n: 'bye' }); } catch (e) {} }
  };
  R._teardown = function () {
    this.destroyed = true;
    clearInterval(this._pingI); clearTimeout(this._openT); clearTimeout(this._retryT);
    window.removeEventListener('pagehide', this._onHide);
    var p = this.peer; this.peer = null;
    setTimeout(function () { try { if (p) p.destroy(); } catch (e) {} }, 150);
  };
  R.leave = function () { if (this.destroyed) return; this._bye(); this._teardown(); };

  GN.createRoom = function (opts) { return new Room(opts); };
  // convenience for games: reconnect into the room described by the URL
  GN.joinFromParams = function (prm, extra) {
    prm = prm || GN.params(); if (!prm) return null;
    var o = { role: prm.mode, code: prm.code, name: prm.name, color: prm.color, pid: prm.pid, slot: prm.slot, rejoin: true };
    if (extra) for (var k in extra) o[k] = extra[k];
    return new Room(o);
  };

  /* ---------- UI: ping badge, status + error dialogs ---------- */
  var css = '' +
    '.gn-badge{position:fixed;z-index:9000;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:14px;background:rgba(8,4,24,.78);border:2px solid rgba(255,255,255,.35);color:#fff;font:bold 13px/1.2 "Trebuchet MS",system-ui,sans-serif;letter-spacing:.5px;pointer-events:none;white-space:nowrap}' +
    '.gn-badge i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px currentColor}' +
    '.gn-badge.mid i{background:#ffe14d}.gn-badge.bad i{background:#ff4d6d}.gn-badge.off i{background:#888}' +
    '.gn-badge.tl{left:max(8px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top))}.gn-badge.tr{right:max(8px,env(safe-area-inset-right));top:max(8px,env(safe-area-inset-top))}' +
    '.gn-badge.bl{left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom))}.gn-badge.br{right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom))}' +
    '.gn-badge.tc{left:50%;transform:translateX(-50%);top:max(6px,env(safe-area-inset-top))}.gn-badge.bc{left:50%;transform:translateX(-50%);bottom:max(6px,env(safe-area-inset-bottom))}' +
    '.gn-modal{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;background:rgba(6,2,20,.82);padding:16px;font-family:"Trebuchet MS",system-ui,sans-serif}' +
    '.gn-box{width:min(440px,100%);background:#1a0d3a;border:3px solid #3ff0ff;border-radius:22px;padding:22px 20px;text-align:center;color:#fff;box-shadow:0 0 34px rgba(63,240,255,.45)}' +
    '.gn-box.err{border-color:#ff4d6d;box-shadow:0 0 34px rgba(255,77,109,.5)}' +
    '.gn-t{font-size:28px;font-weight:bold;margin-bottom:8px;color:#3ff0ff;text-shadow:0 0 10px rgba(63,240,255,.6)}.gn-box.err .gn-t{color:#ff6b86;text-shadow:0 0 10px rgba(255,77,109,.6)}' +
    '.gn-m{font-size:18px;line-height:1.35;color:#ece6ff;margin-bottom:16px}' +
    '.gn-spin{width:44px;height:44px;margin:4px auto 14px;border-radius:50%;border:5px solid rgba(255,255,255,.18);border-top-color:#3ff0ff;animation:gnspin .8s linear infinite}@keyframes gnspin{to{transform:rotate(360deg)}}' +
    '.gn-btns{display:flex;flex-direction:column;gap:10px}' +
    '.gn-btn{min-height:56px;border-radius:28px;border:3px solid #fff;background:linear-gradient(180deg,#ff6ae0,#c81fa8);color:#fff;font:bold 20px "Trebuchet MS",system-ui,sans-serif;letter-spacing:1px;cursor:pointer;touch-action:manipulation}' +
    '.gn-btn.alt{background:linear-gradient(180deg,#3b2b7a,#241650)}.gn-btn:active{transform:scale(.96)}';
  function injectCss() { if (document.getElementById('gn-css')) return; var s = document.createElement('style'); s.id = 'gn-css'; s.textContent = css; (document.head || document.documentElement).appendChild(s); }
  var UI = GN.ui = {};
  var modal = null;
  UI.hide = function () { if (modal) { modal.remove(); modal = null; } };
  UI.dialog = function (o) {
    injectCss(); UI.hide();
    modal = document.createElement('div'); modal.className = 'gn-modal'; modal.setAttribute('role', 'dialog');
    var box = document.createElement('div'); box.className = 'gn-box' + (o.error ? ' err' : ''); modal.appendChild(box);
    box.innerHTML = (o.spinner ? '<div class="gn-spin"></div>' : '') + '<div class="gn-t"></div><div class="gn-m"></div><div class="gn-btns"></div>';
    box.querySelector('.gn-t').textContent = o.title || ''; box.querySelector('.gn-m').textContent = o.message || '';
    var bw = box.querySelector('.gn-btns');
    (o.buttons || []).forEach(function (b, i) {
      var e = document.createElement('button'); e.className = 'gn-btn' + (i ? ' alt' : ''); e.textContent = b.label;
      if (b.id) e.id = b.id;
      e.addEventListener('click', function (ev) { ev.stopPropagation(); if (b.href) location.href = b.href; else if (b.action) b.action(); });
      bw.appendChild(e);
    });
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) { modal.addEventListener(t, function (e) { e.stopPropagation(); }); });
    document.body.appendChild(modal);
    return modal;
  };
  UI.status = function (title, message, buttons) { return UI.dialog({ title: title, message: message, spinner: true, buttons: buttons }); };
  UI.error = function (err, buttons) {
    if (typeof err === 'string') err = mkErr(err);
    buttons = buttons || [{ label: 'BACK TO ARCADE', href: GN.hubUrl() }, { label: 'PLAY SOLO', href: GN.soloUrl() }];
    var m = UI.dialog({ title: err.title, message: err.message, error: true, buttons: buttons });
    m.setAttribute('data-error', err.code || '');
    return m;
  };
  UI.isOpen = function () { return !!modal; };
  // small always-on badge: dot + ping + optional label (code / player count)
  UI.badge = function (room, opts) {
    injectCss(); opts = opts || {};
    var b = document.createElement('div'); b.className = 'gn-badge ' + (opts.pos || 'tc'); b.id = 'gnBadge';
    b.innerHTML = '<i></i><span></span>'; document.body.appendChild(b);
    var sp = b.querySelector('span');
    function upd() {
      var ms = room.ping | 0, n = room.count ? room.count() : 1, lost = !room.opened || room.destroyed || (!room.isHost && !room._welcomed);
      b.className = 'gn-badge ' + (opts.pos || 'tc') + (lost ? ' off' : ms > 180 ? ' bad' : ms > 90 ? ' mid' : '');
      var lbl = (opts.label ? opts.label + ' \u00b7 ' : '') + (room.isHost ? 'HOST' : 'ONLINE') + ' ' + n + '/' + room.max;
      sp.textContent = lbl + ' \u00b7 ' + (lost ? '...' : (room.isHost && n < 2 ? '-' : ms + ' ms'));
    }
    room.on('ping', upd); room.on('players', upd); room.on('open', upd); room.on('reconnecting', upd); room.on('reconnected', upd);
    upd(); var iv = setInterval(upd, 1000);
    return { el: b, update: upd, remove: function () { clearInterval(iv); b.remove(); }, show: function (on) { b.style.display = on ? '' : 'none'; } };
  };
})(window);
