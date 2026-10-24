// Chạy trên GitHub Actions: lấy lịch công tác tuần của trường (https://naue.edu.vn/LichTuan.aspx),
// lọc theo vai trò của Thầy, ghi vào Firestore (users/{uid}/lich/{YYYY-Www}) và báo khi mục của Thầy mới hoặc đổi.
// DRY=1 FILES=a.html,b.html: chạy thử với trang đã lưu, không cần mạng và Firebase.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// lichloc.js là mã dùng chung với app (ở thư mục gốc). Nạp qua địa chỉ data: để không cần package.json "type": "module".
const locSrc = readFileSync(fileURLToPath(new URL('../lichloc.js', import.meta.url)), 'utf8');
export const loc = await import('data:text/javascript;base64,' + Buffer.from(locSrc).toString('base64'));

const URL_LICH = 'https://naue.edu.vn/LichTuan.aspx';
const SEL = 'ctl00$MainContent$ddlTuanSo';
const DAY = 864e5;

export const vnDate = (offset = 0, base = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(base.getTime() + offset * DAY));
const vnHourMin = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return +p.find(x => x.type === 'hour').value * 60 + +p.find(x => x.type === 'minute').value;
};

/* ---------- Tách trang ---------- */
const COMBINING = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧', ring: '̊' };
const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•' };

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, n) => {
    if (n[0] === '#') return String.fromCodePoint(n[1].toLowerCase() === 'x' ? parseInt(n.slice(2), 16) : +n.slice(1));
    if (NAMED[n]) return NAMED[n];
    const m = /^([a-z])(acute|grave|circ|tilde|uml|cedil|ring)$/i.exec(n);
    return m ? (m[1] + COMBINING[m[2].toLowerCase()]).normalize('NFC') : all;
  });
}

// HTML → chữ: mỗi đoạn <p> một dòng, bỏ thẻ, giải mã ký tự đặc biệt, gộp khoảng trắng.
export function text(html) {
  const t = decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ''));
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const cell = (block, cls) => {
  const m = new RegExp(`<div class="${cls}">([\\s\\S]*?)</div>`).exec(block);
  return m ? text(m[1]) : '';
};

export function parsePage(html) {
  const items = [];
  const rows = html.split(/<li class="hang">/).slice(1);
  for (const row of rows) {
    const d = /(\d{2})\/(\d{2})\/(\d{4})/.exec((/<div class="col-1">([\s\S]*?)<\/div>/.exec(row) || [])[1] || '');
    if (!d) continue;
    const date = `${d[3]}-${d[2]}-${d[1]}`;
    for (const ev of row.split(/<div class="su-kien/).slice(1)) {
      const it = { date, time: cell(ev, 'time'), content: cell(ev, 'content'), chutri: cell(ev, 'chutri'), thanhphan: cell(ev, 'thanhphan'), diadiem: cell(ev, 'diadiem') };
      if (it.content) items.push(it);
    }
  }
  // Mã mục: băm (ngày + nội dung); trùng nội dung trong cùng ngày thì thêm số thứ tự.
  const seen = {};
  for (const it of items) {
    const base = createHash('sha1').update(it.date + '|' + loc.norm(it.content).toLowerCase()).digest('hex').slice(0, 10);
    seen[base] = (seen[base] || 0) + 1;
    it.id = seen[base] > 1 ? `${base}-${seen[base]}` : base;
  }
  return items;
}

export function parseOptions(html) {
  const sel = /<select[^>]*ddlTuanSo[\s\S]*?<\/select>/.exec(html);
  if (!sel) return [];
  return [...sel[0].matchAll(/<option([^>]*)value="(\d+)"[^>]*>([^<]*)<\/option>/g)]
    .map(m => ({ value: m[2], label: decode(m[3]), selected: /selected/.test(m[1]) }));
}

/* ---------- Tải trang (GET, rồi POST để chọn tuần) ---------- */
const hidden = (html, name) => { const m = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html); return m ? decode(m[1]) : ''; };

async function fetchWeeks(count = 2) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; AppCongViec/1.0)' };
  const r = await fetch(URL_LICH, { headers });
  if (!r.ok) throw new Error('Trang lịch trả về mã ' + r.status);
  const html = await r.text();
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const opts = parseOptions(html).slice(0, count);
  const pages = [];
  for (const o of opts) {
    if (o.selected) { pages.push({ label: o.label, html }); continue; }
    const body = new URLSearchParams({
      __EVENTTARGET: SEL, __EVENTARGUMENT: '', __VIEWSTATE: hidden(html, '__VIEWSTATE'),
      __VIEWSTATEGENERATOR: hidden(html, '__VIEWSTATEGENERATOR'), __EVENTVALIDATION: hidden(html, '__EVENTVALIDATION'), [SEL]: o.value
    });
    const p = await fetch(URL_LICH, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body });
    if (!p.ok) throw new Error('Không chọn được tuần ' + o.label + ' (mã ' + p.status + ')');
    pages.push({ label: o.label, html: await p.text() });
  }
  return pages;
}

// Ngày bắt đầu tuần từ chữ "Tuần 10(19/10/2026 - 25/10/2026)".
const weekStart = label => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(label || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/* ---------- So sánh với bản đã lưu ---------- */
export function diffMine(oldItems, newItems) {
  const old = new Map((oldItems || []).map(i => [i.id, i]));
  const out = [];
  for (const n of newItems.filter(i => i.mine)) {
    const o = old.get(n.id);
    if (!o) out.push({ kind: 'mới', item: n });
    else if (o.time !== n.time || o.diadiem !== n.diadiem) out.push({ kind: 'đổi', item: n });
  }
  return out;
}

const dm = date => `${+date.slice(8)}/${+date.slice(5, 7)}`;
export function describeChanges(ch) {
  const list = ch.slice(0, 3).map(c => `${c.kind === 'mới' ? 'Mới' : 'Đổi'} ${dm(c.item.date)} ${loc.shortTime(c.item.time)} ${c.item.content}`);
  return list.join('; ') + (ch.length > 3 ? ` (+${ch.length - 3})` : '');
}

// Tóm tắt mục trong ngày cho thông báo: "8h00 Họp…; 14h00 …".
// Mục có `clash` (danh sách tên mục trùng giờ) thì thêm cảnh báo cuối câu.
export function describeDay(items) {
  const s = items.slice().sort((a, b) => a.time.localeCompare(b.time));
  const bad = s.find(i => i.clash && i.clash.length);
  return s.slice(0, 3).map(i => `${loc.shortTime(i.time)} ${i.content}`).join('; ') + (s.length > 3 ? ` (+${s.length - 3})` : '') +
    (bad ? ` ⚠ Trùng giờ: ${bad.content} và ${bad.clash[0]}` : '');
}

// Mục của Thầy trong một ngày: lịch trường đã lọc theo vai trò, cộng lịch riêng (events), kèm `clash` nếu trùng giờ.
// Mỗi phần tử có dạng { time, content, clash? } để dùng với describeDay.
export function mineOnDate(weekDocs, cfg, date, events = []) {
  const school = weekDocs.flatMap(w => w.items || []).filter(i => i.date === date && loc.matchItem(i, cfg).mine);
  const own = loc.expandEvents(events, date, date);
  const clash = loc.findClashes([...school.map(loc.schoolSpan), ...own.map(loc.ownSpan)]);
  return [
    ...school.map(i => ({ time: i.time, content: i.content, clash: clash.get('t:' + i.id) })),
    ...own.map(o => ({ time: o.start || '00:00', content: o.title, clash: clash.get('e:' + o.key) }))
  ];
}

/* ---------- Chạy ---------- */
async function main() {
  const DRY = process.env.DRY === '1';
  let pages;
  if (DRY) {
    pages = (process.env.FILES || '').split(',').filter(Boolean).map(f => ({ label: '', html: readFileSync(f, 'utf8') }));
  } else {
    pages = await fetchWeeks(2);
  }
  const weeks = pages.map(p => {
    const items = parsePage(p.html);
    const start = weekStart(p.label) || (items.length ? loc.mondayOf(items[0].date) : null);
    return { key: start ? loc.weekKey(start) : null, start, items };
  }).filter(w => w.key);
  if (!weeks.length) throw new Error('Không tách được tuần nào – có thể trang trường đã đổi giao diện.');

  if (DRY) {
    for (const w of weeks) {
      console.log(`\n== ${w.key} (từ ${w.start}) – ${w.items.length} mục`);
      for (const it of w.items) {
        const m = loc.matchItem(it, loc.DEFAULT_CFG);
        console.log(`${m.mine ? '★' : ' '} ${it.date} ${it.time} ${it.content}  [${it.id}]${m.mine ? '  ← ' + m.roles.map(r => r.name + ': ' + r.kw).join(' | ') : ''}`);
      }
    }
    return;
  }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getMessaging } = await import('firebase-admin/messaging');
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = getFirestore();
  const messaging = getMessaging();

  const devices = await db.collectionGroup('devices').get();
  const byUser = new Map();
  for (const d of devices.docs) {
    const uid = d.ref.parent.parent.id;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(d);
  }

  const quiet = vnHourMin() >= 20 * 60 + 30; // sau 20h30 không gửi, dồn sang nhắc 6h sáng
  for (const [uid, docs] of byUser) {
    const cfgSnap = await db.doc(`users/${uid}/cfg/lich`).get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : loc.DEFAULT_CFG;
    const changes = [];
    for (const w of weeks) {
      const ref = db.doc(`users/${uid}/lich/${w.key}`);
      const prev = await ref.get();
      const items = w.items.map(i => ({ ...i, ...(m => ({ mine: m.mine, roles: m.roles.map(r => r.name) }))(loc.matchItem(i, cfg)) }));
      await ref.set({ items, updated: new Date().toISOString(), start: w.start });
      // Lần đầu có tuần này trong kho thì chỉ lưu, không báo (tránh báo cả tuần).
      if (prev.exists) changes.push(...diffMine(prev.data().items, items));
    }
    // Xoá tuần cũ hơn 4 tuần.
    const oldKey = loc.weekKey(vnDate(-28));
    const all = await db.collection(`users/${uid}/lich`).get();
    for (const d of all.docs) if (d.id < oldKey) await d.ref.delete();

    console.log(`Đã lưu ${weeks.map(w => `${w.key}: ${w.items.length} mục`).join(', ')}; thay đổi của Thầy: ${changes.length}`);
    if (!changes.length || quiet) continue;
    const msg = { title: 'Lịch trường thay đổi', body: describeChanges(changes) };
    const res = await messaging.sendEach(docs.map(d => ({ token: d.data().token, data: msg, webpush: { headers: { Urgency: 'high', TTL: '3600' } } })));
    for (let i = 0; i < res.responses.length; i++) {
      const r = res.responses[i];
      if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') await docs[i].ref.delete();
    }
    console.log(`Đã báo ${res.successCount}/${docs.length} thiết bị: ${msg.body}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
