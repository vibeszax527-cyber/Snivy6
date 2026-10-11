const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let createCanvas = null;
let loadImage = null;
try {
  ({ createCanvas, loadImage } = require("canvas"));
} catch (e) {
  createCanvas = null;
  loadImage = null;
}

let axios = null;
try {
  axios = require("axios");
} catch (e) {
  axios = null;
}

/* ───────────── settings ───────────── */

const BOT_NAME = "Snivy Bot";
const AUTHOR = "Rafi_9x";
const AVATAR_URL = ""; // empty = auto fetch bot's own profile picture
const FB_TOKEN = "6628568379%7Cc1e620fa708a1d5696fb991c1bde5662";
const USAGE_FILE = path.join(process.cwd(), "database", "data", "snivyCmdUsage.json");

const W = 1000;
const H = 600;
const SANS = '"Poppins", "Segoe UI", "DejaVu Sans", "Liberation Sans", Arial, sans-serif';

/* ───────────── command usage tracker ───────────── */

let usage = {};
try {
  usage = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
} catch (e) {
  usage = {};
}
if (!usage || typeof usage !== "object" || Array.isArray(usage)) usage = {};

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
      const tmp = USAGE_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(usage));
      fs.renameSync(tmp, USAGE_FILE);
    } catch (e) {
      console.error(e);
    }
  }, 3000);
}

function getTopCommands(limit = 10) {
  return Object.entries(usage)
    .filter(([, n]) => typeof n === "number" && n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/* ───────────── helpers ───────────── */

function fmt(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function num(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function getDisk() {
  try {
    const root = path.parse(process.cwd()).root || "/";

    if (typeof fs.statfsSync === "function") {
      const s = fs.statfsSync(root);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      const used = (s.blocks - s.bfree) * s.bsize;
      return { total, used, free };
    }

    const line = execSync(`df -k "${root}"`).toString().trim().split("\n").pop().trim().split(/\s+/);
    return {
      total: parseInt(line[1]) * 1024,
      used: parseInt(line[2]) * 1024,
      free: parseInt(line[3]) * 1024
    };
  } catch (e) {
    return null;
  }
}

let cpuCache = null;

function run(cmd) {
  try {
    return execSync(cmd, { timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch (e) {
    return "";
  }
}

function getCPU() {
  if (cpuCache) return cpuCache;

  const bad = (m) => !m || /^(unknown|n\/a|none)$/i.test(String(m).trim());
  let model = "";
  let cores = 0;

  // 1) Node's own detection
  try {
    const c = os.cpus() || [];
    cores = c.length;
    if (c.length && c[0] && c[0].model) model = String(c[0].model);
  } catch (e) {}

  try {
    if (typeof os.availableParallelism === "function") {
      cores = Math.max(cores, os.availableParallelism());
    }
  } catch (e) {}

  // 2) Linux: /proc/cpuinfo (x86 + ARM boards/VPS)
  if (bad(model) && process.platform === "linux") {
    try {
      const txt = fs.readFileSync("/proc/cpuinfo", "utf8");
      for (const key of ["model name", "Hardware", "Model", "cpu model", "Processor"]) {
        const m = txt.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "im"));
        if (m && !bad(m[1])) {
          model = m[1];
          break;
        }
      }
      if (!cores) cores = (txt.match(/^processor\s*:/gim) || []).length;
    } catch (e) {}
  }

  // 3) Linux: lscpu
  if (bad(model) && process.platform === "linux") {
    const out = run("lscpu");
    const m = out.match(/^Model name:\s*(.+)$/im);
    if (m && !bad(m[1])) model = m[1];
    if (!cores) {
      const c = out.match(/^CPU\(s\):\s*(\d+)/im);
      if (c) cores = parseInt(c[1]);
    }
  }

  // 4) Windows
  if (bad(model) && process.platform === "win32") {
    let out = run('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Select-Object -First 1).Name"');
    if (!out) out = (run("wmic cpu get name").split("\n")[1] || "").trim();
    if (out) model = out;
  }

  // 5) macOS
  if (bad(model) && process.platform === "darwin") {
    const out = run("sysctl -n machdep.cpu.brand_string");
    if (out) model = out;
  }

  model = String(model || "").replace(/\(R\)|\(TM\)|\(tm\)|\(r\)/g, "").replace(/\s+/g, " ").trim();
  if (bad(model)) model = `${process.arch} Processor`;

  cpuCache = cores > 0 ? `${model} (${cores})` : model;
  return cpuCache;
}

function getVersion() {
  try {
    return require(path.join(process.cwd(), "package.json")).version || "N/A";
  } catch (e) {
    return "N/A";
  }
}

function genderOf(u) {
  const g = String(u && u.gender !== undefined && u.gender !== null ? u.gender : "").toLowerCase();
  if (g === "1" || g === "female") return "female";
  if (g === "2" || g === "male") return "male";
  return null;
}

async function collect(usersData, threadsData) {
  const allUsers = (await usersData.getAll()) || [];
  const allThreads = (await threadsData.getAll()) || [];

  let male = 0;
  let female = 0;
  for (const u of allUsers) {
    const g = genderOf(u);
    if (g === "male") male++;
    else if (g === "female") female++;
  }

  const groups = allThreads.filter((t) => !t || t.isGroup !== false).length;

  const totalRam = os.totalmem();
  const usedRam = totalRam - os.freemem();
  const disk = getDisk();

  return {
    version: getVersion(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: fmtUptime(process.uptime()),
    users: allUsers.length,
    groups,
    male,
    female,
    cpu: getCPU(),
    ram: { used: usedRam, total: totalRam, pct: totalRam ? (usedRam / totalRam) * 100 : 0 },
    disk: disk && disk.total > 0
      ? { used: disk.used, total: disk.total, pct: (disk.used / disk.total) * 100 }
      : null,
    top: getTopCommands(10)
  };
}

async function getAvatar(api, usersData) {
  if (!loadImage) return null;

  const urls = [];
  if (AVATAR_URL) urls.push(AVATAR_URL);

  try {
    const botID = api.getCurrentUserID();
    if (usersData && typeof usersData.getAvatarUrl === "function") {
      const u = await usersData.getAvatarUrl(botID);
      if (u) urls.push(u);
    }
    urls.push(`https://graph.facebook.com/${botID}/picture?width=512&height=512&access_token=${FB_TOKEN}`);
  } catch (e) {}

  for (const url of urls) {
    try {
      if (axios) {
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
        return await loadImage(Buffer.from(res.data));
      }
      return await loadImage(url);
    } catch (e) {}
  }
  return null;
}

/* ───────────── text fallback ───────────── */

function buildText(d) {
  const top = d.top.length
    ? d.top.map((c, i) => `${i + 1}. ${c.name.toUpperCase()} - ${num(c.count)} Times`).join("\n")
    : "No command usage recorded yet.";

  return `${BOT_NAME} Global Dashboard

SYSTEM INFO
Version: ${d.version}
Node: ${d.node}
Platform: ${d.platform}
Arch: ${d.arch}
Uptime: ${d.uptime}

USER & GROUP INFO
Users: ${num(d.users)} | Groups: ${num(d.groups)}
Male: ${num(d.male)} | Female: ${num(d.female)}

PERFORMANCE
CPU: ${d.cpu}
RAM: ${fmt(d.ram.used)} / ${fmt(d.ram.total)}
Storage: ${d.disk ? `${fmt(d.disk.used)} / ${fmt(d.disk.total)}` : "N/A"}

TOP COMMANDS
${top}`;
}

/* ───────────── canvas drawing ───────────── */

function font(size, weight) {
  return `${weight ? weight + " " : ""}${size}px ${SANS}`;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function card(ctx, x, y, w, h, r, alpha) {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, r);
  ctx.stroke();
}

function txt(ctx, str, x, y, f, color, align) {
  ctx.font = f;
  ctx.fillStyle = color;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "middle";
  ctx.fillText(str, x, y);
}

function fit(ctx, str, maxW) {
  str = String(str);
  if (ctx.measureText(str).width <= maxW) return str;
  while (str.length > 1 && ctx.measureText(str + "...").width > maxW) str = str.slice(0, -1);
  return str + "...";
}

function icon(ctx, cx, cy, color, letter) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 17, 0, Math.PI * 2);
  ctx.fill();
  txt(ctx, letter, cx, cy + 1, font(17, "bold"), "#ffffff", "center");
}

function stat(ctx, cx, cy, color, letter, label, value, maxW) {
  icon(ctx, cx, cy, color, letter);
  txt(ctx, label, cx + 30, cy - 9, font(11), "#9ca3b4", "left");
  ctx.font = font(16, "bold");
  txt(ctx, fit(ctx, value, maxW), cx + 30, cy + 10, font(16, "bold"), "#ffffff", "left");
}

function barColor(pct) {
  if (pct < 75) return "#12e0c0";
  if (pct < 90) return "#f5b82e";
  return "#ff4d4d";
}

function drawBar(ctx, x, y, w, h, pct) {
  const p = Math.max(0, Math.min(100, pct || 0));
  ctx.fillStyle = "rgba(255,255,255,0.13)";
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (p > 0) {
    ctx.fillStyle = barColor(p);
    rr(ctx, x, y, Math.max(h, (w * p) / 100), h, h / 2);
    ctx.fill();
  }
}

function meter(ctx, y, label, value, pct) {
  txt(ctx, label, 340, y, font(11), "#9ca3b4", "left");
  txt(ctx, value, 620, y, font(13, "bold"), "#ffffff", "right");
  drawBar(ctx, 340, y + 10, 280, 10, pct);
}

function drawAvatar(ctx, avatar) {
  const cx = 66;
  const cy = 58;

  if (avatar) {
    const side = Math.min(avatar.width, avatar.height);
    const sx = (avatar.width - side) / 2;
    const sy = (avatar.height - side) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, sx, sy, side, side, cx - 30, cy - 30, 60, 60);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(cx - 30, cy - 30, cx + 30, cy + 30);
    g.addColorStop(0, "#4ade80");
    g.addColorStop(1, "#15803d");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    txt(ctx, BOT_NAME.charAt(0).toUpperCase(), cx, cy + 1, font(30, "bold"), "#ffffff", "center");
  }

  ctx.strokeStyle = "#19f5d0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 32, 0, Math.PI * 2);
  ctx.stroke();
}

function drawDashboard(ctx, d, avatar) {
  // background
  const bg = ctx.createLinearGradient(0, 0, W * 0.35, H);
  bg.addColorStop(0, "#121829");
  bg.addColorStop(1, "#2b1d5c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255,255,255,0.025)";
  ctx.beginPath();
  ctx.arc(120, 520, 260, 0, Math.PI * 2);
  ctx.fill();

  const TITLE = "#b39bff";

  // header
  card(ctx, 20, 20, 960, 75, 24, 0.08);
  drawAvatar(ctx, avatar);
  ctx.font = font(30, "bold");
  txt(ctx, fit(ctx, `${BOT_NAME} Global Dashboard`, 800), 135, 58, font(30, "bold"), "#ffffff", "left");

  // system info
  card(ctx, 20, 115, 280, 440, 28, 0.06);
  txt(ctx, "SYSTEM INFO", 45, 148, font(19, "bold"), TITLE, "left");
  stat(ctx, 62, 195, "#22863a", "V", "VERSION", d.version, 190);
  stat(ctx, 62, 273, "#2563eb", "N", "NODE", d.node, 190);
  stat(ctx, 62, 338, "#8b5cf6", "P", "PLATFORM", d.platform, 190);
  stat(ctx, 62, 403, "#dc3545", "A", "ARCH", d.arch, 190);
  stat(ctx, 62, 468, "#d4a017", "T", "UPTIME", d.uptime, 190);

  // user & group info
  card(ctx, 320, 115, 320, 210, 28, 0.06);
  txt(ctx, "USER & GROUP INFO", 345, 148, font(19, "bold"), TITLE, "left");
  stat(ctx, 360, 195, "#2563eb", "U", "USERS", num(d.users), 95);
  stat(ctx, 505, 195, "#06b6d4", "M", "MALE", num(d.male), 95);
  stat(ctx, 360, 262, "#22863a", "G", "GROUPS", num(d.groups), 95);
  stat(ctx, 505, 262, "#ff5533", "F", "FEMALE", num(d.female), 95);

  // performance
  card(ctx, 320, 345, 320, 210, 28, 0.06);
  txt(ctx, "PERFORMANCE", 345, 378, font(19, "bold"), TITLE, "left");
  stat(ctx, 360, 422, "#2563eb", "C", "CPU MODEL", d.cpu, 225);
  meter(ctx, 464, "RAM USAGE", `${fmt(d.ram.used)} / ${fmt(d.ram.total)}`, d.ram.pct);
  if (d.disk) {
    meter(ctx, 506, "STORAGE", `${fmt(d.disk.used)} / ${fmt(d.disk.total)}`, d.disk.pct);
  } else {
    meter(ctx, 506, "STORAGE", "N/A", 0);
  }

  // top commands
  card(ctx, 660, 115, 320, 440, 28, 0.06);
  txt(ctx, "TOP 10 COMMANDS USE", 685, 148, font(19, "bold"), TITLE, "left");

  if (!d.top.length) {
    txt(ctx, "No command usage recorded yet", 820, 320, font(14), "#9ca3b4", "center");
    txt(ctx, "Use some commands first", 820, 346, font(12), "#6b7280", "center");
  }

  d.top.slice(0, 10).forEach((c, i) => {
    const y = 180 + i * 38;
    const hot = i < 3;
    const countStr = `${num(c.count)} Times`;

    txt(ctx, `${i + 1}.`, 685, y, font(15, "bold"), hot ? "#f5c518" : "#8b93a7", "left");

    ctx.font = font(15, "bold");
    const cw = ctx.measureText(countStr).width;
    txt(ctx, countStr, 955, y, font(15, "bold"), "#1de9b6", "right");

    ctx.font = font(15);
    const nameStr = fit(ctx, c.name.toUpperCase(), Math.max(60, 955 - cw - 15 - 715));
    txt(ctx, nameStr, 715, y, font(15), "#e6e9f2", "left");

    ctx.fillStyle = hot ? "rgba(212,175,55,0.18)" : "rgba(20,210,190,0.16)";
    ctx.fillRect(685, y + 18, 270, 4);
    ctx.fillStyle = hot ? "rgba(212,175,55,0.85)" : "rgba(20,210,190,0.75)";
    ctx.fillRect(685, y + 19, 270, 2);
  });

  // footer
  txt(ctx, `© ${new Date().getFullYear()} ${BOT_NAME} - by ${AUTHOR}`, W / 2, 579, font(12), "#6b7280", "center");
}

/* ───────────── command ───────────── */

module.exports = {
  config: {
    name: "uptime",
    aliases: ["upt", "ram", "storage", "dashboard"],
    version: "3.0",
    author: "Rafi_9x",
    role: 0,
    category: "general",
    guide: {
      en: "Use {p}uptime to display the global dashboard (system, users, RAM, storage, top commands) as an image."
    }
  },

  // counts every command usage automatically
  onChat: async function ({ event }) {
    try {
      const body = event && event.body;
      if (!body || typeof body !== "string") return;

      const gb = global.GoatBot;
      if (!gb || !gb.commands) return;

      let prefix = (gb.config && gb.config.prefix) || "";
      try {
        if (global.utils && typeof global.utils.getPrefix === "function") {
          prefix = global.utils.getPrefix(event.threadID) || prefix;
        }
      } catch (e) {}

      if (!prefix || !body.startsWith(prefix)) return;

      const first = body.slice(prefix.length).trim().split(/\s+/)[0];
      if (!first) return;

      const name = first.toLowerCase();
      let cmd = gb.commands.get(name);
      if (!cmd && gb.aliases) cmd = gb.commands.get(gb.aliases.get(name));
      if (!cmd || !cmd.config || !cmd.config.name) return;

      const key = cmd.config.name;
      usage[key] = (usage[key] || 0) + 1;
      scheduleSave();
    } catch (e) {}
  },

  onStart: async function ({ api, event, usersData, threadsData }) {
    let data;

    try {
      data = await collect(usersData, threadsData);
    } catch (error) {
      console.error(error);
      return api.sendMessage("An error occurred while retrieving dashboard data.", event.threadID, event.messageID);
    }

    if (!createCanvas) {
      return api.sendMessage(buildText(data), event.threadID, event.messageID);
    }

    let file = null;

    try {
      const avatar = await getAvatar(api, usersData);
      const canvas = createCanvas(W, H);
      drawDashboard(canvas.getContext("2d"), data, avatar);
      const buffer = canvas.toBuffer("image/png");

      const dir = path.join(__dirname, "tmp");
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, `uptime_${event.threadID}_${Date.now()}.png`);
      fs.writeFileSync(file, buffer);

      api.sendMessage(
        { body: "", attachment: fs.createReadStream(file) },
        event.threadID,
        () => {
          try { fs.unlinkSync(file); } catch (e) {}
        },
        event.messageID
      );
    } catch (error) {
      console.error(error);
      if (file) {
        try { fs.unlinkSync(file); } catch (e) {}
      }
      api.sendMessage(buildText(data), event.threadID, event.messageID);
    }
  },

  _drawDashboard: drawDashboard
};
