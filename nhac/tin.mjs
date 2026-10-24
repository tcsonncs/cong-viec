// Chạy trên GitHub Actions lúc 6h30: gom tin 24 giờ qua theo chủ đề của Thầy, nhờ Gemini chọn 5–7 tin và tóm tắt,
// ghi vào Firestore (users/{uid}/tin/{YYYY-MM-DD}) rồi gửi một thông báo "Điểm tin sáng".
// Nguồn chỉ gồm những nguồn Thầy đã duyệt (xem tinloc.js). Tin đầu tư chỉ để tham khảo, không khuyên mua bán.
// DRY=1: chạy thử với RSS mẫu ở _mau_tin (không cần mạng, Firebase; có khoá GEMINI_API_KEY thì vẫn gọi Gemini).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decode, text, vnDate } from './lich.mjs';

const locSrc = readFileSync(fileURLToPath(new URL('../tinloc.js', import.meta.url)), 'utf8');
export const tl = await import('data:text/javascript;base64,' + Buffer.from(locSrc).toString('base64'));

const DRY = process.env.DRY === '1';
const PER_TOPIC = 8, MAX_ALL = 40, PICK_MAX = 7, PICK_MIN = 5;
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest'];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; AppCongViec/1.0)' };
// Chạy thử: tính "24 giờ qua" tính từ lúc lưu RSS mẫu (24/10/2026 ~13h giờ Việt Nam).
const NOW = process.env.NOW ? Date.parse(process.env.NOW) : DRY ? Date.parse('2026-10-24T13:00:00+07:00') : Date.now();

/* ---------- Tách RSS ---------- */
const cdata = s => { const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s); return m ? { v: m[1], raw: true } : { v: s.trim(), raw: false }; };

export function parseFeed(xml) {
  const out = [];
  for (const b of xml.split(/<item[\s>]/).slice(1)) {
    const g = tag => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(b); return m ? m[1] : ''; };
    const t = cdata(g('title'));
    let title = text((t.raw ? t.v : decode(t.v)).replace(/</g, '&lt;')).replace(/\s+/g, ' ');
    const d = cdata(g('description'));
    const html = d.raw ? d.v : decode(d.v);
    let link = cdata(g('link')).v;
    if (!/^https?:\/\//.test(link)) { const h = /href=["'](https?:\/\/[^"']+)["']/.exec(html); link = h ? decode(h[1]) : ''; }
    const src = text(cdata(g('source')).v);
    let snippet = src ? '' : text(html).replace(/\s+/g, ' ').slice(0, 320);
    if (src) title = title.replace(new RegExp(`\\s+-\\s+${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
    title = title.replace(/^\[SHORT\]\s*/i, '');
    if (tl.titleKey(snippet) === tl.titleKey(title)) snippet = '';
    if (title && link) out.push({ title, link, snippet, source: src, time: tl.pubTime(g('pubDate')) });
  }
  return out;
}

/* ---------- Tải nguồn (hoặc đọc mẫu khi DRY) ---------- */
const SAMPLE = { vne_gd: 'vne_giaoduc.xml', gdtd: 'gdtd.xml', cafef: 'cafef.xml', vne_kd: null };
const SAMPLE_GN = { giaoduc: ['gn_giaoduc.xml'], toan: ['gn_giaoduc.xml'], congbo: ['gn_giaoduc.xml'], ai: ['gn_en.xml'], dautu: ['gn_dautu.xml'] };
const cache = new Map();
async function load(key, url, sample) {
  if (cache.has(key)) return cache.get(key);
  let xml = '';
  try {
    if (DRY) xml = sample ? readFileSync(fileURLToPath(new URL('../_mau_tin/' + sample, import.meta.url)), 'utf8') : '';
    else {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error('mã ' + r.status);
      xml = await r.text();
    }
  } catch (e) { console.log('Không tải được', url, '–', e.message); }
  const items = xml ? parseFeed(xml) : [];
  cache.set(key, items);
  return items;
}

// Tin của một chủ đề trong 24 giờ qua, mới nhất trước.
async function collect(topic) {
  const found = [];
  const add = (list, source) => list.forEach(i => found.push({ ...i, source: i.source || source }));
  if (topic.kw?.length) {
    const url = tl.gnUrl(topic.kw, 'vi');
    let list = await load(url, url, (SAMPLE_GN[topic.id] || [])[0]);
    if (DRY && topic.id !== 'giaoduc' && topic.id !== 'dautu') list = list.filter(i => tl.hasKw(i.title, topic.kw)); // mẫu dùng chung nhiều chủ đề
    add(list, 'Google News');
  }
  if (topic.en?.length) {
    const url = tl.gnUrl(topic.en, 'en');
    add(await load(url, url, DRY ? 'gn_en.xml' : ''), 'Google News');
  }
  for (const f of topic.feeds || []) {
    const feed = tl.FEEDS[f];
    if (!feed) continue;
    let list = await load(f, feed.url, SAMPLE[f]);
    if (feed.filter) list = list.filter(i => tl.hasKw(i.title + ' ' + i.snippet, topic.kw));
    add(list, feed.name);
  }
  const lang = topic.en?.length && !topic.kw?.length ? 'en' : 'vi';
  return found.filter(i => i.time && NOW - i.time <= 864e5 && i.time - NOW < 36e5)
    .sort((a, b) => b.time - a.time).map(i => ({ ...i, topic: topic.id, topicName: topic.name, lang: /^[\x00-\x7F]*$/.test(i.title) ? 'en' : lang }));
}

export async function gather(topics) {
  const seen = new Set(), all = [];
  for (const t of topics.filter(x => x.on !== false)) {
    const list = [];
    for (const i of await collect(t)) {
      const k = tl.titleKey(i.title);
      if (seen.has(k)) continue;
      seen.add(k); list.push(i);
      if (list.length >= PER_TOPIC) break;
    }
    all.push(...list);
  }
  return all.slice(0, MAX_ALL);
}

/* ---------- Chọn và tóm tắt ---------- */
// Dự phòng khi Gemini lỗi: mỗi chủ đề lấy 1 tin mới nhất, rồi bổ sung vòng hai, tối đa 7 tin; tóm tắt = câu đầu của mô tả.
export function fallback(cands) {
  const by = new Map();
  cands.forEach((c, i) => { if (!by.has(c.topic)) by.set(c.topic, []); by.get(c.topic).push(i); });
  const pick = [];
  for (let round = 0; round < 2; round++) for (const idx of by.values()) if (idx[round] != null && pick.length < PICK_MAX) pick.push(idx[round]);
  return pick.map(i => {
    const c = cands[i];
    const first = (c.snippet.match(/^.+?[.!?](?=\s|$)/) || [c.snippet])[0];
    return { i, sum: first.length > 220 ? first.slice(0, 217) + '…' : first };
  });
}

async function askGemini(cands) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Chưa có GEMINI_API_KEY');
  const list = cands.map((c, i) => `${i} | ${c.topicName} | ${c.lang === 'en' ? '(tiếng Anh) ' : ''}${c.title} | ${c.snippet || '(không có mô tả)'}`).join('\n');
  const prompt = `Bạn là biên tập viên "Điểm tin sáng" cho một giảng viên đại học (Toán, giáo dục tiểu học). Dưới đây là các tin ứng viên trong 24 giờ qua, mỗi dòng: số | chủ đề | tiêu đề | mô tả.
Hãy chọn ${PICK_MIN}–${PICK_MAX} tin đáng đọc nhất, chia đều giữa các chủ đề (chủ đề nào có tin đáng đọc thì lấy ít nhất 1), không chọn hai tin cùng một sự kiện.
Với mỗi tin trả về: "i" là số của tin; "title" chỉ điền khi tin tiếng Anh (dịch tiêu đề sang tiếng Việt), còn lại để trống; "sum" là tóm tắt tiếng Việt 1–2 câu ngắn, CHỈ dựa vào tiêu đề và mô tả đã cho, không thêm chi tiết, số liệu hay nhận định nào không có trong đó. Nếu mô tả trống thì diễn đạt lại tiêu đề trong một câu.
Chủ đề "Đầu tư": chỉ thuật lại sự việc, tuyệt đối không khuyên mua, bán, không dự đoán giá.

${list}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: {
    type: 'ARRAY', items: { type: 'OBJECT', required: ['i', 'sum'], properties: { i: { type: 'INTEGER' }, title: { type: 'STRING' }, sum: { type: 'STRING' } } } } } };
  let last = '', busy = false;
  for (const model of [...GEMINI_MODELS, ...GEMINI_MODELS, ...GEMINI_MODELS]) {
    if (busy && model === GEMINI_MODELS[0]) await new Promise(r => setTimeout(r, 8000));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    if (res.status === 404) { last = 'không thấy mô hình ' + model; continue; }
    if (res.status === 429 || res.status === 503 || res.status === 500) { busy = true; last = 'mã ' + res.status; continue; }
    if (!res.ok) throw new Error('Gemini báo lỗi mã ' + res.status);
    const j = await res.json();
    return JSON.parse(j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '[]');
  }
  throw new Error('Gemini quá tải hoặc hết lượt (' + last + ')');
}

// Trả về [{topic, title, sum, source, link}] đã chọn.
export async function digest(cands) {
  if (!cands.length) return [];
  let picks, how = 'Gemini';
  try {
    const raw = await askGemini(cands);
    const seen = new Set();
    picks = raw.filter(p => Number.isInteger(p.i) && cands[p.i] && !seen.has(p.i) && seen.add(p.i) && String(p.sum || '').trim()).slice(0, PICK_MAX);
    if (picks.length < 3) throw new Error('Gemini trả quá ít tin');
  } catch (e) {
    console.log('Dùng cách dự phòng:', e.message);
    picks = fallback(cands); how = 'dự phòng';
  }
  console.log(`Chọn ${picks.length} tin bằng ${how}.`);
  // Đường dẫn và nguồn luôn lấy từ dữ liệu gốc, không lấy từ Gemini.
  return picks.map(p => {
    const c = cands[p.i];
    return { topic: c.topicName, title: (c.lang === 'en' && String(p.title || '').trim()) || c.title, sum: String(p.sum).trim(), source: c.source, link: c.link };
  });
}

export const buildMessage = items => ({ title: 'Điểm tin sáng', body: items.slice(0, 3).map(i => i.title).join('; '), url: '#tin' });

/* ---------- Chạy ---------- */
async function main() {
  if (DRY) {
    const items = await digest(await gather(tl.DEFAULT_TOPICS));
    console.log(`\n${items.length} tin:`);
    items.forEach((i, n) => console.log(`${n + 1}. [${i.topic}] ${i.title}\n   ${i.sum}\n   ${i.source} – ${i.link.slice(0, 90)}`));
    console.log('\nThông báo:', JSON.stringify(buildMessage(items)));
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

  for (const [uid, docs] of byUser) {
    const snap = await db.doc(`users/${uid}/cfg/tin`).get();
    const topics = tl.topicsOf(snap.exists ? snap.data() : null);
    const items = await digest(await gather(topics));
    if (!items.length) { console.log('Không có tin nào trong 24 giờ qua.'); continue; }
    await db.doc(`users/${uid}/tin/${vnDate(0)}`).set({ at: new Date().toISOString(), items });
    // Xoá bản cũ hơn 14 ngày.
    const oldKey = vnDate(-14);
    for (const d of (await db.collection(`users/${uid}/tin`).get()).docs) if (d.id < oldKey) await d.ref.delete();

    const msg = buildMessage(items);
    const res = await messaging.sendEach(docs.map(d => ({ token: d.data().token, data: msg, webpush: { headers: { Urgency: 'high', TTL: '7200' } } })));
    for (let i = 0; i < res.responses.length; i++) {
      const r = res.responses[i];
      if (r.success) continue;
      console.log('Gửi lỗi:', r.error?.code);
      if (r.error?.code === 'messaging/registration-token-not-registered') await docs[i].ref.delete();
    }
    console.log(`Đã lưu ${items.length} tin; gửi ${res.successCount}/${docs.length} thiết bị: ${msg.body}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
