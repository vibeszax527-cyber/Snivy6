const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

let Canvas;
try { Canvas = require("@napi-rs/canvas"); } catch (e) { Canvas = require("canvas"); }
const { createCanvas, loadImage } = Canvas;

const W = 900;
const THUMB_H = 220;
const CARD_H = 300;
const START_Y = 235;
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
	if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) return null;
	try {
		const res = await axios.get(url.trim(), {
			responseType: "arraybuffer",
			timeout: 20000,
			maxRedirects: 5,
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
				"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
				"Referer": "https://www.facebook.com/"
			},
			validateStatus: (status) => status >= 200 && status < 400
		});
		const buffer = Buffer.from(res.data);
		if (!buffer.length) throw new Error("empty image response");
		return await loadImage(buffer);
	} catch (e) {
		let host = "unknown-host";
		try { host = new URL(url).host; } catch (_) {}
		console.warn("[grouplist] image fetch failed:", host, e.response ? "HTTP " + e.response.status : e.message);
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

/* ---------------- friendly renderer ---------------- */
async function renderCanvas(items, startIndex, userAvatarImg, page = 1, pages = 1, total = items.length) {
	const cols = 2;
	const cardW = 410, cardH = 224, gapX = 18, gapY = 16;
	const left = 27, top = 218, W = 900;
	const rows = Math.ceil(items.length / cols);
	const H = Math.max(650, top + rows * cardH + Math.max(0, rows - 1) * gapY + 92);
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext("2d");

	// Warm, friendly light background
	const bg = ctx.createLinearGradient(0, 0, W, H);
	bg.addColorStop(0, "#f5f8ff"); bg.addColorStop(0.52, "#eef5ff"); bg.addColorStop(1, "#f8f4ff");
	ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
	const glow1 = ctx.createRadialGradient(80, 20, 5, 80, 20, 350);
	glow1.addColorStop(0, "rgba(101,167,255,0.20)"); glow1.addColorStop(1, "rgba(101,167,255,0)");
	ctx.fillStyle = glow1; ctx.fillRect(0, 0, W, H);
	const glow2 = ctx.createRadialGradient(850, 250, 5, 850, 250, 320);
	glow2.addColorStop(0, "rgba(184,153,255,0.16)"); glow2.addColorStop(1, "rgba(184,153,255,0)");
	ctx.fillStyle = glow2; ctx.fillRect(0, 0, W, H);

	// Header
	ctx.fillStyle = "#4968a8"; ctx.font = `bold 16px ${FONT}`;
	ctx.fillText("SNIVY BOT  ·  YOUR COMMUNITIES", 36, 43);
	ctx.fillStyle = "#172847"; ctx.font = `bold 38px ${FONT}`;
	ctx.fillText("Your Group List", 34, 88);
	ctx.fillStyle = "#687b9d"; ctx.font = `19px ${FONT}`;
	ctx.fillText("All your group chats, neatly organised.", 36, 119);

	// Friendly summary chips
	rr(ctx, 34, 139, 180, 43, 14);
	ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#dce7fa"; ctx.lineWidth = 1; ctx.stroke();
	ctx.fillStyle = "#34598e"; ctx.font = `bold 16px ${FONT}`;
	ctx.fillText(`GROUPS  ${total}`, 49, 166);
	rr(ctx, 224, 139, 132, 43, 14);
	ctx.fillStyle = "#e8eaff"; ctx.fill(); ctx.strokeStyle = "#d9ddff"; ctx.stroke();
	ctx.fillStyle = "#6658ad"; ctx.fillText(`PAGE  ${page}/${pages}`, 240, 166);
	ctx.fillStyle = "#7b8ba8"; ctx.font = `15px ${FONT}`; ctx.textAlign = "right";
	ctx.fillText(dhakaTime() + "  ·  BD TIME", W - 36, 166); ctx.textAlign = "left";

	const logos = await Promise.all(items.map((it) => (it.image ? getImg(it.image) : null)));
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		const col = i % cols, row = Math.floor(i / cols);
		const x = left + col * (cardW + gapX), y = top + row * (cardH + gapY);
		rr(ctx, x, y, cardW, cardH, 18);
		ctx.fillStyle = "#ffffff"; ctx.fill();
		ctx.strokeStyle = "#dce6f5"; ctx.lineWidth = 1.2; ctx.stroke();

		// Group avatar
		const ax = x + 18, ay = y + 19, ar = 42;
		ctx.save(); ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2); ctx.clip();
		if (logos[i]) drawCover(ctx, logos[i], ax, ay, ar * 2, ar * 2);
		else {
			const pg = ctx.createLinearGradient(ax, ay, ax + ar * 2, ay + ar * 2);
			pg.addColorStop(0, "#8cbcff"); pg.addColorStop(1, "#b5a4ff");
			ctx.fillStyle = pg; ctx.fillRect(ax, ay, ar * 2, ar * 2);
			const initial = (clean(it.name || "G").charAt(0) || "G").toUpperCase();
			ctx.fillStyle = "#ffffff"; ctx.font = `bold 30px ${FONT}`; ctx.textAlign = "center";
			ctx.fillText(initial, ax + ar, ay + ar + 10); ctx.textAlign = "left";
		}
		ctx.restore();
		ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar + 2, 0, Math.PI * 2);
		ctx.strokeStyle = "#e0e9fb"; ctx.lineWidth = 3; ctx.stroke();

		// Group name and small index
		ctx.fillStyle = "#1d2d4b"; ctx.font = `bold 18px ${FONT}`;
		ctx.fillText(fitText(ctx, clean(it.name || "Unnamed Group"), 275), x + 118, y + 37);
		ctx.fillStyle = "#8190aa"; ctx.font = `13px ${FONT}`;
		ctx.fillText(`GROUP ${String(startIndex + i + 1).padStart(2, "0")}`, x + 118, y + 59);

		// Soft approval status badge
		const status = it.approval === null ? "Status unknown" : it.approval ? "Approval on" : "Approval off";
		ctx.font = `bold 12px ${FONT}`;
		const sw = ctx.measureText(status).width + 18;
		rr(ctx, x + 118, y + 70, sw, 23, 10);
		ctx.fillStyle = it.approval === null ? "#f0f2f7" : it.approval ? "#e5f8ee" : "#fff0f1"; ctx.fill();
		ctx.fillStyle = it.approval === null ? "#69758a" : it.approval ? "#23845b" : "#b24b58";
		ctx.fillText(status, x + 127, y + 85);

		// Soft metric area
		rr(ctx, x + 16, y + 108, cardW - 32, 59, 13);
		ctx.fillStyle = "#f6f8fc"; ctx.fill(); ctx.strokeStyle = "#edf1f8"; ctx.lineWidth = 1; ctx.stroke();
		const members = it.members === null ? "—" : String(it.members);
		const admins = it.admins === null ? "—" : String(it.admins);
		ctx.fillStyle = "#8492aa"; ctx.font = `12px ${FONT}`;
		ctx.fillText("MEMBERS", x + 29, y + 130);
		ctx.fillText("ADMINS", x + 153, y + 130);
		ctx.fillText("THREAD ID", x + 247, y + 130);
		ctx.fillStyle = "#253958"; ctx.font = `bold 17px ${FONT}`;
		ctx.fillText(fitText(ctx, members, 95), x + 29, y + 153);
		ctx.fillText(fitText(ctx, admins, 60), x + 153, y + 153);
		ctx.font = `bold 12px ${FONT}`;
		ctx.fillText(fitText(ctx, String(it.tid || "—"), 124), x + 247, y + 152);

		// Friendly bottom label
		ctx.fillStyle = "#9aa7bb"; ctx.font = `13px ${FONT}`;
		ctx.fillText("Group details", x + 19, y + 196);
		ctx.fillStyle = "#6384bd"; ctx.textAlign = "right";
		ctx.fillText("SNIVY BOT", x + cardW - 19, y + 196); ctx.textAlign = "left";
	}

	const fy = H - 28;
	ctx.strokeStyle = "#e0e8f5"; ctx.beginPath(); ctx.moveTo(30, H - 53); ctx.lineTo(W - 30, H - 53); ctx.stroke();
	ctx.fillStyle = "#7889a5"; ctx.font = `14px ${FONT}`;
	ctx.fillText("Made for your community.", 34, fy);
	ctx.textAlign = "right"; ctx.fillText(`SNIVY BOT  ·  PAGE ${page} OF ${pages}`, W - 34, fy); ctx.textAlign = "left";
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
				if (!avUrl) avUrl = `https://graph.facebook.com/${senderID}/picture?width=512&height=512`;
				avatarImg = await getImg(avUrl);
			} catch (e) { avatarImg = null; }

			const buffer = await renderCanvas(items, startIndex, avatarImg, page, pages, groups.length);

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
