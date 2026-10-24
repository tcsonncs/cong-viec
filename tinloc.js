// Điểm tin sáng: chủ đề mặc định, nguồn RSS đã duyệt và các hàm lọc dùng chung cho app (tin.js) và máy chủ (nhac/tin.mjs).
// Chỉ dùng các nguồn Thầy đã duyệt 24/10/2026: Google News RSS theo từ khoá, VnExpress (giáo dục, kinh doanh), Giáo dục và Thời đại, CafeF.

export const FEEDS = {
  vne_gd: { name: 'VnExpress', url: 'https://vnexpress.net/rss/giao-duc.rss' },
  gdtd: { name: 'Giáo dục và Thời đại', url: 'https://giaoducthoidai.vn/rss/home.rss' },
  vne_kd: { name: 'VnExpress', url: 'https://vnexpress.net/rss/kinh-doanh.rss', filter: true }, // chỉ lấy tin có từ khoá của chủ đề
  cafef: { name: 'CafeF', url: 'https://cafef.vn/thi-truong-chung-khoan.rss' }
};

// kw: từ khoá tiếng Việt; en: từ khoá tiếng Anh (Google News bản Mỹ); feeds: RSS cố định gắn với chủ đề.
export const DEFAULT_TOPICS = [
  { id: 'giaoduc', name: 'Giáo dục Việt Nam', on: true, kw: ['Bộ Giáo dục', 'giáo dục phổ thông', 'tuyển sinh'], en: [], feeds: ['vne_gd', 'gdtd'] },
  { id: 'toan', name: 'Dạy học Toán, tiểu học', on: true, kw: ['dạy học Toán', 'giáo dục tiểu học', 'chương trình GDPT 2018'], en: [], feeds: [] },
  { id: 'congbo', name: 'Công bố khoa học', on: true, kw: ['công bố quốc tế', 'Scopus', 'phó giáo sư'], en: [], feeds: [] },
  { id: 'ai', name: 'AI trong giáo dục', on: true, kw: ['AI giáo dục', 'trí tuệ nhân tạo trường học'], en: ['AI in education'], feeds: [] },
  { id: 'dautu', name: 'Đầu tư (tin tham khảo)', on: true, kw: ['HPG', 'FPT', 'PNJ', 'BID', 'VND', 'VNM', 'MSN', 'MWG', 'VIC', 'VN-Index', 'Bitcoin'], en: [], feeds: ['cafef', 'vne_kd'] }
];

export const topicsOf = cfg => (cfg && Array.isArray(cfg.topics) ? cfg.topics : DEFAULT_TOPICS);

// Địa chỉ Google News RSS tìm theo từ khoá, tin 1 ngày. Cụm nhiều chữ đặt trong ngoặc kép.
export function gnUrl(list, lang = 'vi') {
  const q = list.map(k => (/[\s-]/.test(k) ? `"${k}"` : k)).join(' OR ') + ' when:1d';
  const loc = lang === 'en' ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=vi&gl=VN&ceid=VN:vi';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`;
}

// Khớp nguyên chữ, không phân biệt hoa thường ("BID" không khớp "bidding").
export function hasKw(text, kw) {
  const t = String(text || '');
  return kw.some(k => {
    const e = String(k).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return e && new RegExp(`(?<![\\p{L}\\p{N}])${e}(?![\\p{L}\\p{N}])`, 'iu').test(t);
  });
}

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Đọc pubDate của RSS (kể cả năm 2 chữ số như CafeF: "Sat, 24 Oct 26 11:43:00 +0700") ra mili giây; không đọc được thì null.
export function pubTime(s) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(GMT|UTC|Z|[+-]\d{2}:?\d{2})?/.exec(s || '');
  if (!m || !(m[2].toLowerCase() in MON)) return null;
  const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  let off = 0;
  const z = /^([+-])(\d{2}):?(\d{2})$/.exec(m[7] || '');
  if (z) off = (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]);
  return Date.UTC(y, MON[m[2].toLowerCase()], +m[1], +m[4], +m[5], +(m[6] || 0)) - off * 60000;
}

// Khoá so trùng tiêu đề.
export const titleKey = s => String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
