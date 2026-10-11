const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

let Canvas;
try { Canvas = require("@napi-rs/canvas"); } catch (e) { Canvas = require("canvas"); }
const { createCanvas, loadImage } = Canvas;

const W = 780;
const THUMB_H = 430;
const CARD_H = 570;
const START_Y = 295;
const PER_PAGE = 4;
const FONT = 'YTSans, "DejaVu Sans", Arial, sans-serif';

/* ---------------- shared UI assets (template + font) ----------------
   Same YouTube UI as ytb.js. Assets ytb.js theke pori, tai ytb.js
   (canvas version) same folder e thakte hobe.                          */
let shared = null;
let imgs = null;
let fontReady = false;

function loadShared() {
	if (shared) return shared;
	const file = path.join(__dirname, "ytb.js");
	if (!fs.existsSync(file)) throw new Error("ytb.js (canvas version) ei folder e nai. UI assets oikhan theke ashe.");
	const src = fs.readFileSync(file, "utf8");
	const grab = (name) => {
		const m = src.match(new RegExp("const " + name + " = `([^`]+)`"));
		if (!m) throw new Error(name + " ytb.js e paoa jayni. ytb.js ta canvas version kina check koro.");
		return Buffer.from(m[1].replace(/\s+/g, ""), "base64");
	};
	shared = { top: grab("TPL_TOP_B64"), bottom: grab("TPL_BOTTOM_B64"), font: grab("FONT_BOLD_B64") };
	return shared;
}

async function prepare() {
	const s = loadShared();
	if (!fontReady) {
		try {
			const dir = path.join(__dirname, "cache", "ytb_fonts");
			fs.ensureDirSync(dir);
			const p = path.join(dir, "YTSans-bold.ttf");
			if (!fs.existsSync(p) || fs.statSync(p).size !== s.font.length) fs.writeFileSync(p, s.font);
			if (Canvas.GlobalFonts) Canvas.GlobalFonts.registerFromPath(p, "YTSans");
			else Canvas.registerFont(p, { family: "YTSans", weight: "bold" });
		} catch (e) { console.log("[grouplist] font setup failed:", e.message); }
		fontReady = true;
	}
	if (!imgs) imgs = { top: await loadImage(s.top), bottom: await loadImage(s.bottom) };
	return imgs;
}

/* ---------------- helpers ---------------- */
function rr(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

function fitText(ctx, text, maxW) {
	if (ctx.measureText(text).width <= maxW) return text;
	let t = text;
	while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
	return t + "…";
}

function wrapTitle(ctx, text, maxW, maxLines) {
	const words = String(text).split(/\s+/);
	const lines = [];
	let cur = "";
	for (const w of words) {
		const test = cur ? cur + " " + w : w;
		if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
		if (cur) { lines.push(cur); cur = ""; }
		if (ctx.measureText(w).width > maxW) {
			let chunk = "";
			for (const ch of w) {
				if (ctx.measureText(chunk + ch).width > maxW) { lines.push(chunk); chunk = ch; }
				else chunk += ch;
			}
			cur = chunk;
		} else cur = w;
	}
	if (cur) lines.push(cur);
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		let last = kept[maxLines - 1];
		while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
		kept[maxLines - 1] = last + "…";
		return kept;
	}
	return lines;
}

async function getImg(url) {
	try {
		const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
		return await loadImage(Buffer.from(res.data));
	} catch (e) {
		return null;
	}
}

function drawCover(ctx, img, x, y, w, h) {
	const r = Math.max(w / img.width, h / img.height);
	const sw = w / r, sh = h / r;
	ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function dhakaTime() {
	try {
		return new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false });
	} catch (e) {
		const d = new Date();
		return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
	}
}

// emoji ba symbol bad (font e na thakle box dekhay)
const clean = (s) => String(s)
	.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
	.replace(/\s+/g, " ")
	.trim();

function drawPlaceholder(ctx, cx, cy, r) {
	ctx.save();
	ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
	ctx.fillStyle = "#3b4066"; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
	ctx.fillStyle = "#7d84ad";
	ctx.beginPath(); ctx.arc(cx, cy - r * 0.22, r * 0.28, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.arc(cx, cy + r * 0.78, r * 0.52, 0, Math.PI * 2); ctx.fill();
	ctx.restore();
}

/* ---------------- fetch group info (null if not fetchable) ---------------- */
function getThreadInfoSafe(api, tid) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timeout")), 10000);
		const done = (err, info) => { clearTimeout(timer); err ? reject(err) : resolve(info); };
		try {
			const r = api.getThreadInfo(tid, done);
			if (r && typeof r.then === "function") r.then((i) => done(null, i)).catch((e) => done(e));
		} catch (e) { done(e); }
	});
}

async function buildInfo(api, t) {
	let name = t.threadName || null;
	let image = t.imageSrc || null;
	let members = Array.isArray(t.members) ? t.members.filter((m) => m.inGroup !== false).length : null;
	let admins = Array.isArray(t.adminIDs) ? t.adminIDs.length : null;
	let approval = typeof t.approvalMode === "boolean" ? t.approvalMode : null;

	try {
		const info = await getThreadInfoSafe(api, t.threadID);
		if (info) {
			if (info.threadName) name = info.threadName;
			if (info.imageSrc) image = info.imageSrc;
			if (Array.isArray(info.participantIDs)) members = info.participantIDs.length;
			if (Array.isArray(info.adminIDs)) admins = info.adminIDs.length;
			if (typeof info.approvalMode === "boolean") approval = info.approvalMode;
		}
	} catch (e) { /* live fetch fail -> stored data / null */ }

	let shown = "null";
	if (name && String(name).trim()) shown = clean(name) || "Unnamed Group";
	return { tid: t.threadID, name: shown, image, members, admins, approval };
}

/* ---------------- renderer ---------------- */
async function renderCanvas(items, startIndex, userAvatarImg) {
	const tpl = await prepare();
	const n = items.length;
	const H = Math.max(1620, START_Y + n * CARD_H + 185);

	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, W, H);
	ctx.drawImage(tpl.top, 0, 0);
	ctx.drawImage(tpl.bottom, 0, H - 168);
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";

	// clock + header text
	ctx.fillStyle = "#000";
	ctx.font = `bold 38px ${FONT}`;
	ctx.fillText(dhakaTime(), 70, 58);
	ctx.fillStyle = "#0f0f0f";
	ctx.font = `bold 29px ${FONT}`;
	ctx.fillText("Group List", 119, 144);

	const logos = await Promise.all(items.map((it) => (it.image ? getImg(it.image) : null)));
	ctx.font = `bold 30px ${FONT}`;
	const titleLines = items.map((it, i) => wrapTitle(ctx, `${startIndex + i + 1}. ${it.name}`, W - 95 - 25, 2));

	for (let i = 0; i < n; i++) {
		const it = items[i];
		const y = START_Y + i * CARD_H;
		const ty = y + THUMB_H;

		// "thumbnail" = dark panel + group logo
		const g = ctx.createLinearGradient(0, y, 0, y + THUMB_H);
		g.addColorStop(0, "#1d2145"); g.addColorStop(1, "#0b0d20");
		ctx.fillStyle = g; ctx.fillRect(0, y, W, THUMB_H);

		const cx = W / 2, cy = y + THUMB_H / 2, r = 150;
		ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fill();
		if (logos[i]) {
			ctx.save();
			ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
			drawCover(ctx, logos[i], cx - r, cy - r, r * 2, r * 2);
			ctx.restore();
		} else drawPlaceholder(ctx, cx, cy, r);

		// approval badge (duration badge er jayga)
		const ap = it.approval === null ? "null" : it.approval ? "ON" : "OFF";
		const badgeColor = it.approval === null ? "rgba(0,0,0,0.82)" : it.approval ? "rgba(30,142,62,0.95)" : "rgba(198,40,40,0.95)";
		const label = `Approval ${ap}`;
		ctx.font = `bold 24px ${FONT}`;
		const bw = ctx.measureText(label).width + 44, bh = 36;
		const bx = W - 15 - bw, by = y + THUMB_H - 15 - bh;
		rr(ctx, bx, by, bw, bh, 4); ctx.fillStyle = badgeColor; ctx.fill();
		ctx.fillStyle = "#fff"; ctx.textAlign = "center";
		ctx.fillText(label, bx + bw / 2, by + 26); ctx.textAlign = "left";

		// letter circle
		const first = (it.name || "").charAt(0);
		const letter = it.name === "null" ? "?" : /[A-Za-z0-9]/.test(first) ? first.toUpperCase() : "G";
		ctx.beginPath(); ctx.arc(45, ty + 65, 30, 0, Math.PI * 2); ctx.fillStyle = "#e5e5e5"; ctx.fill();
		ctx.fillStyle = "#606060"; ctx.font = `bold 28px ${FONT}`; ctx.textAlign = "center";
		ctx.fillText(letter, 45, ty + 75); ctx.textAlign = "left";

		// title
		const lines = titleLines[i];
		ctx.fillStyle = "#0f0f0f"; ctx.font = `bold 30px ${FONT}`;
		const tY = lines.length === 1 ? ty + 56 : ty + 46;
		lines.forEach((ln, li) => ctx.fillText(ln, 95, tY + li * 36));

		// details line
		const m = it.members === null ? "null" : it.members;
		const a = it.admins === null ? "null" : it.admins;
		ctx.fillStyle = "#606060"; ctx.font = `bold 24px ${FONT}`;
		ctx.fillText(fitText(ctx, `Members: ${m} | Admins: ${a} | Approval: ${ap}`, W - 125), 95, lines.length === 1 ? ty + 101 : ty + 123);
	}

	// "You" tab = user DP
	ctx.save();
	ctx.beginPath(); ctx.arc(702, H - 90, 26, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
	if (userAvatarImg) drawCover(ctx, userAvatarImg, 676, H - 116, 52, 52);
	else { ctx.fillStyle = "#cfcfcf"; ctx.fillRect(676, H - 116, 52, 52); }
	ctx.restore();

	return canvas.toBuffer("image/png");
}

/* ---------------- command ---------------- */
module.exports = {
	config: {
		name: "grouplist",
		aliases: ["gclist", "glist"],
		version: "1.0.0",
		author: "Rafi_9x",
		countDown: 10,
		role: 2,
		description: {
			en: "Show all groups the bot is in (name, logo, members, admins, approval) as a YouTube-style canvas"
		},
		category: "owner",
		guide: {
			en: "   {pn}: show page 1 of the group list"
				+ "\n   {pn} <page>: show a specific page"
				+ "\n   Example: {pn} 2"
		}
	},

	onStart: async function ({ api, args, event, message, threadsData, usersData }) {
		const { senderID } = event;
		let outPath;
		try {
			api.setMessageReaction("⌛", event.messageID, () => {}, true);

			const all = await threadsData.getAll();
			const groups = all
				.filter((t) => t && t.threadID && t.isGroup)
				.sort((a, b) => {
					const ma = Array.isArray(a.members) ? a.members.length : -1;
					const mb = Array.isArray(b.members) ? b.members.length : -1;
					return mb - ma;
				});

			if (!groups.length) return message.reply("⭕ Bot kono group e nai (database e kono group paoa jayni).");

			const pages = Math.ceil(groups.length / PER_PAGE);
			let page = parseInt(args[0]) || 1;
			if (page < 1) page = 1;
			if (page > pages) page = pages;

			const startIndex = (page - 1) * PER_PAGE;
			const slice = groups.slice(startIndex, startIndex + PER_PAGE);
			const items = await Promise.all(slice.map((t) => buildInfo(api, t)));

			let avatarImg = null;
			try {
				let avUrl = null;
				if (usersData && usersData.getAvatarUrl) avUrl = await usersData.getAvatarUrl(senderID);
				if (!avUrl) avUrl = `https://graph.facebook.com/${senderID}/picture?width=512&height=512&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662`;
				avatarImg = await getImg(avUrl);
			} catch (e) { avatarImg = null; }

			const buffer = await renderCanvas(items, startIndex, avatarImg);

			const cacheDir = path.join(__dirname, "cache");
			fs.ensureDirSync(cacheDir);
			outPath = path.join(cacheDir, `grouplist_${senderID}_${Date.now()}.png`);
			fs.writeFileSync(outPath, buffer);

			let body = `📋 Group list | page ${page}/${pages} | total ${groups.length}\n`;
			items.forEach((it, i) => { body += `\n${startIndex + i + 1}. ${it.name}\n   TID: ${it.tid}`; });
			if (page < pages) body += `\n\nNext page: grouplist ${page + 1}`;

			await message.reply({ body, attachment: fs.createReadStream(outPath) });
			api.setMessageReaction("✅", event.messageID, () => {}, true);
		} catch (e) {
			return message.reply("× Error: " + e.message);
		} finally {
			if (outPath && fs.existsSync(outPath)) setTimeout(() => { try { fs.unlinkSync(outPath); } catch (e) {} }, 15000);
		}
	}
};
