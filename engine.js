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

// ---------- Game settings (change these to tweak the rules) ----------
export const GRID = 16;
export const START_HP = 3;
export const START_RANGE = 2;     // diagonals count: range 2 = 5x5 square
export const DAILY_AP = 1;
export const RANGE_COST = 2;
export const DAY = 24 * 60 * 60 * 1000;
// ----------------------------------------------------------------------

export const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

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
    const cells = GRID * GRID;
    let i = hash(a.uid) % cells, tries = 0;
    while (tries < cells && occupied(players, i % GRID, Math.floor(i / GRID))) { i = (i + 1) % cells; tries++; }
    if (tries >= cells) return "The board is full.";
    players.set(a.uid, {
      name, x: i % GRID, y: Math.floor(i / GRID),
      hp: START_HP, range: START_RANGE, alive: true, spent: 0, received: 0,
    });
    log.push(`${name} joined the battlefield.`);
    return null;
  }

  const me = players.get(a.uid);
  if (!me || !me.alive) return "You're not in the game.";
  if (startAt == null || t < startAt) return "The game hasn't started yet.";
  const ap = apOf(me, t, startAt);

  switch (a.type) {
    case "range": {
      if (ap < RANGE_COST) return `You need ${RANGE_COST} action points.`;
      me.spent += RANGE_COST; me.range += 1;
      log.push(`${me.name} extended their range to ${me.range}.`);
      return null;
    }
    case "move": {
      if (ap < 1) return "You need 1 action point.";
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
      if (dist(me, tgt) > me.range) return "They're out of range.";
      if (a.type === "attack") {
        if (ap < 1) return "You need 1 action point.";
        me.spent += 1; tgt.hp -= 1;
        if (tgt.hp <= 0) {
          tgt.hp = 0; tgt.alive = false; tgt.x = -1; tgt.y = -1;
          log.push(`${me.name} eliminated ${tgt.name}!`);
        } else {
          log.push(`${me.name} shot ${tgt.name} (${tgt.hp} HP left).`);
        }
        return null;
      }
      if (!Number.isInteger(a.amount) || a.amount < 1) return "Enter a whole number of points.";
      if (ap < a.amount) return `You only have ${ap} action point(s).`;
      me.spent += a.amount; tgt.received += a.amount;
      log.push(`${me.name} gave ${a.amount} action point${a.amount > 1 ? "s" : ""} to ${tgt.name}.`);
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
