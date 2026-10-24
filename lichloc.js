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
