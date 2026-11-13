// Deterministic game engine.
//
// Every browser downloads the same ordered list of actions and replays it with
// this code, so everyone computes exactly the same board. Illegal actions
// (not enough points, out of range, ...) are ignored by everyone, so nobody
// can cheat by writing fake actions to the database.
//
// Action points: each alive player earns DAILY_AP at `startAt` and again every
// 24 hours after that. Nothing needs to run on a server; points are computed
// from the action's server timestamp.
//
// Privacy: the page only ever shows other players' NAME, POSITION and whether
// they are still in play (see publicView). HP, range and points stay in the
// engine state and are shown to their owner only. Events are described per
// viewer (see describe), so a hit is only visible to the two players involved.

// ---------- Game settings (change these to tweak the rules) ----------
export const GRID = 15;
export const START_HP = 3;
export const START_RANGE = 2;     // diagonals count: range 2 = 5x5 square
export const DAILY_AP = 1;
export const RANGE_COST = 2;
export const DAY = 24 * 60 * 60 * 1000;

// Countries a player can pick (ISO 3166 codes). The flag emoji is built from the code.
// Each country can be picked by one player only.
export const COUNTRIES = (
  "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ " +
  "CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET " +
  "FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT " +
  "JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY " +
  "MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM " +
  "PA PE PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ " +
  "TD TG TH TJ TL TM TN TO TR TT TV TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW PS TW"
).split(" ");
const COUNTRY_SET = new Set(COUNTRIES);
// ----------------------------------------------------------------------

export const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Can a player at `a` with range `range` reach a square at `b`?
// Everything within `range` squares (diagonals count) is reachable, plus the four squares
// exactly range+1 away in a straight line up, down, left or right. At range 2 that is the
// 5x5 square around you plus the 4 squares 3 away in a straight line.
export function reach(a, b, range) {
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  const d = Math.max(dx, dy);
  return d <= range || (d === range + 1 && (dx === 0 || dy === 0));
}

// Points earned in total by time `ts` (ms). Before startAt: none.
export function earned(ts, startAt) {
  if (startAt == null || ts < startAt) return 0;
  return (Math.floor((ts - startAt) / DAY) + 1) * DAILY_AP;
}

// Points a player can spend right now.
export const apOf = (p, ts, startAt) => earned(ts, startAt) + p.received - p.spent;

function hash(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const occupied = (players, x, y) => {
  for (const p of players.values()) if (p.alive && p.x === x && p.y === y) return true;
  return false;
};

// Apply one action to `state`. Returns null if it worked, or a reason string.
export function step(state, a, startAt) {
  const { players, log } = state;
  const t = a.ts;

  if (a.type === "join") {
    if (startAt != null && t >= startAt) return "The game has already started.";
    if (players.has(a.uid)) return "You already joined.";
    const name = typeof a.name === "string" ? a.name.trim().slice(0, 20) : "";
    if (!name) return "Pick a name.";
    for (const p of players.values())
      if (p.name.toLowerCase() === name.toLowerCase()) return "That name is taken.";
    const country = typeof a.country === "string" ? a.country.toUpperCase() : "";
    if (!COUNTRY_SET.has(country)) return "Choose a country.";
    for (const p of players.values())
      if (p.country === country) return "That country is already taken.";
    const cells = GRID * GRID;
    let i = hash(a.uid) % cells, tries = 0;
    while (tries < cells && occupied(players, i % GRID, Math.floor(i / GRID))) { i = (i + 1) % cells; tries++; }
    if (tries >= cells) return "The board is full.";
    players.set(a.uid, {
      name, country, x: i % GRID, y: Math.floor(i / GRID),
      hp: START_HP, range: START_RANGE, alive: true, spent: 0, received: 0,
    });
    log.push({ k: "join", t, name });
    return null;
  }

  const me = players.get(a.uid);
  if (!me || !me.alive) return "You're not in the game.";
  if (startAt == null || t < startAt) return "The game hasn't started yet.";
  const ap = apOf(me, t, startAt);

  switch (a.type) {
    case "range": {
      if (ap < RANGE_COST) return `You need ${RANGE_COST} points.`;
      me.spent += RANGE_COST; me.range += 1;
      log.push({ k: "range", t, uid: a.uid, range: me.range });
      return null;
    }
    case "move": {
      if (ap < 1) return "You need 1 point.";
      if (!Number.isInteger(a.dx) || !Number.isInteger(a.dy) || Math.abs(a.dx) + Math.abs(a.dy) !== 1)
        return "Move one square up, down, left or right.";
      const nx = me.x + a.dx, ny = me.y + a.dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) return "That's off the board.";
      if (occupied(players, nx, ny)) return "That square is occupied.";
      me.x = nx; me.y = ny; me.spent += 1;
      return null;
    }
    case "attack":
    case "give": {
      const tgt = typeof a.target === "string" ? players.get(a.target) : null;
      if (!tgt || a.target === a.uid || !tgt.alive) return "Pick another player who's still in the game.";
      if (!reach(me, tgt, me.range)) return "They're out of range.";
      if (a.type === "attack") {
        if (ap < 1) return "You need 1 point.";
        me.spent += 1; tgt.hp -= 1;
        const ev = { t, by: a.uid, byName: me.name, to: a.target, toName: tgt.name };
        if (tgt.hp <= 0) {
          tgt.hp = 0; tgt.alive = false; tgt.x = -1; tgt.y = -1;
          log.push({ k: "out", ...ev });
        } else {
          log.push({ k: "hit", ...ev, hp: tgt.hp });
        }
        return null;
      }
      if (!Number.isInteger(a.amount) || a.amount < 1) return "Enter a whole number of points.";
      if (ap < a.amount) return `You only have ${ap} point${ap === 1 ? "" : "s"}.`;
      me.spent += a.amount; tgt.received += a.amount;
      log.push({ k: "give", t, from: a.uid, fromName: me.name, to: a.target, toName: tgt.name, amount: a.amount });
      return null;
    }
    default:
      return "Unknown action.";
  }
}

// Replay the full, ordered action list into a board state.
export function replay(actions, startAt) {
  const state = { players: new Map(), log: [] };
  for (const a of actions) step(state, a, startAt);
  return state;
}

// Would this new action be accepted right now? Returns null or a reason.
export function check(actions, startAt, action) {
  return step(replay(actions, startAt), action, startAt);
}

// What everyone may know about every player: who, their country, where, and whether still in play.
// Deliberately omits hp, range and points.
export function publicView(state) {
  return [...state.players].map(([id, p]) => ({ id, name: p.name, country: p.country, x: p.x, y: p.y, alive: p.alive }));
}

// Describe an event for one viewer, or return null if they shouldn't see it.
// Hits, gifts and range upgrades are only visible to the players involved.
export function describe(e, viewer) {
  switch (e.k) {
    case "join":
      return `${e.name} joined the battlefield.`;
    case "out":
      if (e.by === viewer) return `You eliminated ${e.toName}.`;
      if (e.to === viewer) return `${e.byName} eliminated you.`;
      return `${e.toName} was eliminated.`;
    case "hit":
      if (e.by === viewer) return `You hit ${e.toName}.`;
      // The victim is told they were hit, but not by whom. Only the killing blow names the attacker.
      if (e.to === viewer) return `You were hit. You have ${e.hp} HP left.`;
      return null;
    case "give":
      if (e.from === viewer) return `You gave ${e.amount} point${e.amount === 1 ? "" : "s"} to ${e.toName}.`;
      if (e.to === viewer) return `${e.fromName} gave you ${e.amount} point${e.amount === 1 ? "" : "s"}.`;
      return null;
    case "range":
      return e.uid === viewer ? `You extended your range to ${e.range}.` : null;
    default:
      return null;
  }
}
