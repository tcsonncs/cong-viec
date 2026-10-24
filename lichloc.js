// Lọc lịch tuần của trường theo vai trò của Thầy. Dùng chung cho app (trình duyệt) và máy chủ nhắc việc (nhac/lich.mjs, nhac/nhac.mjs).
// Không dùng DOM hay thư viện ngoài. Ngày luôn dạng YYYY-MM-DD.

export const DEFAULT_CFG = {
  roles: [
    { id: 'canhan', name: 'Cá nhân (tên Thầy)', on: true, kw: ['Trịnh Công Sơn'] },
    { id: 'khoa', name: 'Khoa Tiểu học và lãnh đạo khoa', on: true, kw: ['Tiểu học', 'TH', 'Trưởng, phó các đơn vị', 'Trưởng phó các đơn vị', 'Lãnh đạo các đơn vị', 'BCN các khoa', 'BCN khoa', 'Ban chủ nhiệm các khoa', 'Trưởng các khoa', 'Lãnh đạo khoa'] },
    { id: 'bomon', name: 'Trưởng bộ môn', on: true, kw: ['Trưởng bộ môn', 'Trưởng các bộ môn', 'Trưởng, phó bộ môn', 'Tổ trưởng bộ môn'] },
    { id: 'chibo', name: 'Chi bộ – Đảng', on: true, kw: ['đảng viên', 'chi bộ', 'Bí thư chi bộ'] },
    { id: 'truong', name: 'Viên chức toàn trường', on: true, kw: ['Toàn thể giảng viên', 'Toàn thể viên chức', 'Toàn thể cán bộ', 'Cán bộ, giảng viên', 'Giảng viên toàn trường', 'Viên chức toàn trường'] }
  ],
  // Từ khoá loại trừ: chỉ xét trong tiêu đề và chủ trì (không xét thành phần).
  exclude: ['đơn vị hành chính', 'Sinh viên toàn'],
  // Ngoại lệ từng mục: { mãMục: 'yes' | 'no' }
  over: {}
};

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();

// Khớp nguyên chữ, không phân biệt hoa thường: "TH" khớp "các khoa GD, TH, KHCB" nhưng không khớp "THPT".
function has(text, kw) {
  const k = norm(kw);
  if (!k) return false;
  return new RegExp('(?<![\\p{L}\\p{N}])' + esc(k) + '(?![\\p{L}\\p{N}])', 'iu').test(text);
}

// Trả về { mine, roles: [{ name, kw }], reason }.
export function matchItem(item, cfg) {
  const c = cfg && cfg.roles ? cfg : DEFAULT_CFG;
  const ov = (c.over || {})[item.id];
  if (ov === 'no') return { mine: false, roles: [], reason: 'Thầy đã đánh dấu không phải của tôi' };
  if (ov === 'yes') return { mine: true, roles: [], reason: 'Thầy đã đánh dấu là của tôi' };
  const head = norm([item.content, item.chutri].join(' \n '));
  const all = norm([item.content, item.chutri, item.thanhphan].join(' \n '));
  const bad = (c.exclude || []).find(k => has(head, k));
  if (bad) return { mine: false, roles: [], reason: 'Bị loại bởi từ khoá "' + bad + '"' };
  const roles = [];
  for (const r of c.roles || []) {
    if (r.on === false) continue;
    const kw = (r.kw || []).find(k => has(all, k));
    if (kw) roles.push({ name: r.name, kw });
  }
  return { mine: roles.length > 0, roles, reason: roles.map(r => r.name).join('; ') };
}

/* ---------- Ngày tuần ---------- */
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
export const mondayOf = s => { const d = parse(s); return addDays(s, -((d.getUTCDay() + 6) % 7)); };

// Khoá tuần ISO dạng YYYY-Www, tính từ ngày thứ Hai.
export function weekKey(s) {
  const mon = parse(mondayOf(s));
  const th = new Date(mon); th.setUTCDate(th.getUTCDate() + 3);
  const y = th.getUTCFullYear();
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const w = Math.floor((th - jan1) / 864e5 / 7) + 1;
  return `${y}-W${pad(w)}`;
}

// Giờ "08:00" → "8h00"; "14:30" → "14h30".
export const shortTime = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? `${+m[1]}h${m[2]}` : (t || ''); };

/* ---------- Lịch riêng và trùng giờ ---------- */
// Lịch riêng (users/{uid}/events): một lần { date, start, end } hoặc lặp hằng tuần { rep: true, weekday 0–6 (0 = Chủ nhật), from, to, start, end, skip: [ngày nghỉ], moved: { ngàyCũ: { date, start, end } } }.
export const KINDS = { daihoc: 'Đại học', pt: 'Toán 9', them: 'Dạy thêm', rieng: 'Riêng' };
export const SCHOOL_MIN = 120; // mục của trường chỉ có giờ bắt đầu: tạm coi dài 2 tiếng [CẦN XÁC NHẬN]
export const OWN_MIN = 60; // lịch riêng chưa ghi giờ kết thúc: tạm coi dài 1 tiếng

export const toMin = t => { const m = /^(\d{1,2})[:h](\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
export const hhmm = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

// Các lần diễn ra của lịch riêng trong khoảng [from, to] (ngày YYYY-MM-DD), đã trừ buổi nghỉ và tính buổi đổi.
export function expandEvents(events, from, to) {
  const out = [];
  const push = (e, orig, date, start, end, moved) => {
    if (date < from || date > to) return;
    out.push({ key: `${e.id}@${orig}`, evId: e.id, orig, date, start, end, moved, rep: !!e.rep, title: e.title, kind: e.kind || 'rieng', place: e.place || '', note: e.note || '' });
  };
  for (const e of events || []) {
    if (!e.rep) { if (e.date) push(e, e.date, e.date, e.start || '', e.end || '', null); continue; }
    // Duyệt rộng thêm 7 ngày hai đầu để bắt buổi đổi sang ngày trong khoảng.
    for (let d = addDays(from, -7); d <= addDays(to, 7); d = addDays(d, 1)) {
      if (parse(d).getUTCDay() !== +e.weekday) continue;
      if ((e.from && d < e.from) || (e.to && d > e.to) || (e.skip || []).includes(d)) continue;
      const mv = (e.moved || {})[d];
      if (mv) push(e, d, mv.date, mv.start || e.start || '', mv.end || e.end || '', d);
      else push(e, d, d, e.start || '', e.end || '', null);
    }
  }
  return out;
}

// Chuyển mục thành khoảng phút để so trùng; null nếu không có giờ (hoặc "Cả ngày").
export function schoolSpan(i) {
  const s = toMin(i.time);
  if (s == null || /cả ngày/i.test(i.content || '')) return null;
  return { key: 't:' + i.id, date: i.date, s, e: s + SCHOOL_MIN, title: i.content };
}
export function ownSpan(o) {
  const s = toMin(o.start);
  if (s == null) return null;
  let e = toMin(o.end);
  if (e == null || e <= s) e = s + OWN_MIN;
  return { key: 'e:' + o.key, date: o.date, s, e, title: o.title };
}

// Trả về Map khoá → danh sách tên các mục trùng giờ với nó (cùng ngày, hai khoảng giờ chồng nhau).
export function findClashes(spans) {
  const by = {};
  for (const s of spans.filter(Boolean)) (by[s.date] = by[s.date] || []).push(s);
  const out = new Map();
  for (const list of Object.values(by)) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.s < b.e && b.s < a.e) {
        out.set(a.key, [...(out.get(a.key) || []), b.title]);
        out.set(b.key, [...(out.get(b.key) || []), a.title]);
      }
    }
  }
  return out;
}
