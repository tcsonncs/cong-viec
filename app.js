import { firebaseConfig } from './firebase-config.js';

/* ---------- Hằng số ---------- */
const GROUPS = {
  giangday: 'Giảng dạy',
  nckh: 'Nghiên cứu khoa học',
  quanly: 'Quản lý – hành chính',
  giaotiep: 'Giao tiếp (gọi, nhắn)',
  thoiquen: 'Thói quen',
  canhan: 'Cá nhân – gia đình'
};
const STATUS = { todo: 'Chưa làm', doing: 'Đang làm', waiting: 'Chờ người khác', done: 'Xong' };
const PRIO = { 1: 'Gấp', 2: 'Quan trọng', 3: 'Bình thường' };
const REPEAT = { none: 'Không lặp', weekly: 'Hằng tuần', monthly: 'Hằng tháng' };
const ROLES = ['Sinh viên', 'Học viên', 'Đồng nghiệp', 'Cấp trên', 'Phụ huynh', 'Khác'];

/* ---------- Tiện ích ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => toStr(new Date());
const fmt = s => (s ? s.split('-').reverse().join('/') : '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${String(k) === String(sel) ? ' selected' : ''}>${esc(v)}</option>`).join('');

/* ---------- Kho dữ liệu: chế độ máy (localStorage) ---------- */
function makeLocalStore() {
  let data = { tasks: [], contacts: [] };
  let onChange = () => {};
  const persist = () => localStorage.setItem('appcv', JSON.stringify(data));
  return {
    mode: 'local',
    async init(cb, onAuth) {
      onChange = cb;
      try { data = { tasks: [], contacts: [], ...JSON.parse(localStorage.getItem('appcv') || '{}') }; } catch { /* dữ liệu hỏng thì bắt đầu mới */ }
      onAuth(true, null);
      onChange(data);
    },
    async save(col, item) {
      if (!item.id) item.id = uid();
      const i = data[col].findIndex(x => x.id === item.id);
      if (i >= 0) data[col][i] = item; else data[col].push(item);
      persist(); onChange(data);
    },
    async remove(col, id) {
      data[col] = data[col].filter(x => x.id !== id);
      persist(); onChange(data);
    },
    exportAll: () => data
  };
}

/* ---------- Kho dữ liệu: Firebase (đăng nhập Google, đồng bộ) ---------- */
async function makeFirebaseStore(cfg) {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [appM, authM, fsM] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')
  ]);
  const app = appM.initializeApp(cfg);
  const auth = authM.getAuth(app);
  const db = fsM.getFirestore(app);
  const data = { tasks: [], contacts: [] };
  let unsubs = [];
  let user = null;
  return {
    mode: 'firebase',
    async init(cb, onAuth) {
      authM.onAuthStateChanged(auth, u => {
        unsubs.forEach(f => f()); unsubs = [];
        user = u;
        data.tasks = []; data.contacts = [];
        if (u) {
          for (const col of ['tasks', 'contacts']) {
            unsubs.push(fsM.onSnapshot(fsM.collection(db, 'users', u.uid, col), snap => {
              data[col] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
              cb(data);
            }));
          }
        }
        onAuth(!!u, u);
        cb(data);
      });
    },
    async login() {
      const p = new authM.GoogleAuthProvider();
      try { await authM.signInWithPopup(auth, p); } catch { await authM.signInWithRedirect(auth, p); }
    },
    logout: () => authM.signOut(auth),
    async save(col, item) {
      if (!item.id) item.id = uid();
      await fsM.setDoc(fsM.doc(db, 'users', user.uid, col, item.id), item);
    },
    async remove(col, id) { await fsM.deleteDoc(fsM.doc(db, 'users', user.uid, col, id)); },
    exportAll: () => data
  };
}

/* ---------- Trạng thái ---------- */
let store;
let data = { tasks: [], contacts: [] };
let view = 'today';
let filter = { group: '', status: 'open' };
let signedIn = false;
let userInfo = null;

/* ---------- Tách câu gõ nhanh: hạn, người giao, người liên hệ ---------- */
const WEEKDAYS = { 'hai': 1, 'ba': 2, 'tư': 3, 'tu': 3, 'năm': 4, 'nam': 4, 'sáu': 5, 'sau': 5, 'bảy': 6, 'bay': 6 };

function parseQuick(text) {
  let t = ' ' + text.trim() + ' ';
  const now = new Date();
  const add = n => { const d = new Date(now); d.setDate(d.getDate() + n); return toStr(d); };
  let due = '';
  const lead = '(?:(?:trước|vào|hạn|đến|hết)\\s+)?(?:ngày\\s+)?';
  let m;
  if ((m = t.match(new RegExp(lead + '(\\d{1,2})\\s*(?:\\/|-|tháng)\\s*(\\d{1,2})(?:\\s*(?:\\/|-|năm)\\s*(\\d{2,4}))?(?=\\s|$)', 'i')))) {
    let y = m[3] ? +m[3] : now.getFullYear();
    if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    // Không ghi năm: ngày đã qua quá 6 tháng thì hiểu là năm sau, còn lại giữ nguyên (quá hạn).
    if (!m[3] && now - d > 182 * 864e5) d.setFullYear(y + 1);
    if (!isNaN(d)) { due = toStr(d); t = t.replace(m[0], ' '); }
  } else if ((m = t.match(/\s(?:(?:trước|vào|hạn|đến|hết)\s+)?(hôm nay|ngày mai|ngày kia|mai|chủ nhật|thứ\s+(?:hai|ba|tư|tu|năm|nam|sáu|sau|bảy|bay))(?=\s|$)/i))) {
    const w = m[1].toLowerCase();
    if (w === 'hôm nay') due = add(0);
    else if (w === 'ngày mai' || w === 'mai') due = add(1);
    else if (w === 'ngày kia') due = add(2);
    else {
      const target = w === 'chủ nhật' ? 0 : WEEKDAYS[w.replace(/^thứ\s+/, '')];
      let diff = (target - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      due = add(diff);
    }
    t = t.replace(m[0], ' ');
  }
  let assignee = '', contact = '';
  const tail = '(?=\\s+(?:liên hệ|giao cho|giao|hạn)(?=\\s|$)|\\s*$)';
  if ((m = t.match(new RegExp('\\s(?:giao cho|giao)\\s+(.+?)' + tail, 'i')))) { assignee = m[1].trim(); t = t.replace(m[0], ' '); }
  if ((m = t.match(new RegExp('\\s(?:liên hệ với|liên hệ)\\s+(.+?)' + tail, 'i')))) { contact = m[1].trim(); t = t.replace(m[0], ' '); }
  const title = t.replace(/\s+/g, ' ').trim().replace(/^[,;.\-–\s]+|[,;.\-–\s]+$/g, '');
  const known = name => {
    const n = name.toLowerCase();
    const c = data.contacts.find(c => c.name.toLowerCase() === n) || data.contacts.find(c => c.name.toLowerCase().includes(n));
    return c ? c.name : name;
  };
  return { title: title || text.trim(), due, assignee: assignee && known(assignee), contact: contact && known(contact) };
}

/* ---------- Vẽ giao diện ---------- */
function dueInfo(t) {
  if (!t.due || t.status === 'done') return { cls: '', label: t.due ? fmt(t.due) : '' };
  const td = today();
  if (t.due < td) return { cls: 'red', label: 'Quá hạn ' + fmt(t.due) };
  if (t.due === td) return { cls: 'amber', label: 'Hôm nay' };
  return { cls: '', label: 'Hạn ' + fmt(t.due) };
}

function taskCard(t) {
  const d = dueInfo(t);
  const over = t.status !== 'done' && t.due && t.due < today();
  const chips = [
    d.label && `<span class="chip ${d.cls}">${esc(d.label)}</span>`,
    t.prio && t.prio < 3 && `<span class="chip ${t.prio === 1 ? 'red' : 'amber'}">${PRIO[t.prio]}</span>`,
    t.status === 'waiting' && `<span class="chip amber">Chờ người khác</span>`,
    t.status === 'doing' && `<span class="chip green">Đang làm</span>`,
    t.group && `<span class="chip">${esc(GROUPS[t.group])}</span>`,
    t.assignee && `<span class="chip">Giao: ${esc(t.assignee)}</span>`,
    t.contact && `<span class="chip">Liên hệ: ${esc(t.contact)}</span>`,
    t.repeat && t.repeat !== 'none' && `<span class="chip">${REPEAT[t.repeat]}</span>`
  ].filter(Boolean).join('');
  return `<div class="card${over ? ' over' : ''}${t.status === 'done' ? ' done' : ''}" data-id="${t.id}">
    <input type="checkbox" class="chk" data-done="${t.id}"${t.status === 'done' ? ' checked' : ''} aria-label="Đánh dấu xong">
    <div class="body" data-open="${t.id}"><div class="t">${esc(t.title)}</div><div class="chips">${chips}</div></div>
  </div>`;
}

const sortTasks = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.prio || 3) - (b.prio || 3);

const quickBar = `<div class="quick"><input id="quick" placeholder="Gõ nhanh: Nộp báo cáo khoa giao cho cô Lan thứ sáu" enterkeyhint="done" autocomplete="off"><button class="btn" id="quick-go">Thêm</button></div>
<div class="quick"><label class="btn ghost">Ảnh → việc (giấy viết tay, Zalo)<input type="file" id="img-file" accept="image/*" multiple hidden></label><button class="btn ghost" id="paste-img">Dán ảnh</button><button class="btn ghost" id="gem-key">Khoá Gemini</button></div>
<div class="quick"><label class="btn ghost">Nhập việc từ file (do trợ lý soạn)<input type="file" id="json-file" accept=".json,application/json" hidden></label></div>
<p class="hint">App tự tách hạn, người được giao, người liên hệ; Thầy xem lại rồi mới lưu. Có thể bấm micro trên bàn phím điện thoại để nói.</p>`;

function renderToday() {
  const td = today();
  const open = data.tasks.filter(t => t.status !== 'done');
  const over = open.filter(t => t.due && t.due < td).sort(sortTasks);
  const now = open.filter(t => t.due === td).sort(sortTasks);
  const waiting = open.filter(t => t.status === 'waiting' && t.due !== td && !(t.due && t.due < td));
  const sec = (title, list, cls = '') => list.length ? `<h2 class="${cls}">${title} (${list.length})</h2>${list.map(taskCard).join('')}` : '';
  const html = sec('Quá hạn', over, 'red') + sec('Hôm nay', now) + sec('Đang chờ người khác', waiting);
  return quickBar +
    `<div class="note">Lịch hôm nay từ Google Calendar và điểm tin sáng sẽ có ở các giai đoạn sau.</div>` +
    (html || '<p class="empty">Hôm nay chưa có việc đến hạn. Gõ việc mới ở ô trên.</p>');
}

function renderTasks() {
  let list = data.tasks.filter(t => (filter.status === 'done' ? t.status === 'done' : t.status !== 'done'));
  if (filter.group) list = list.filter(t => t.group === filter.group);
  list.sort(sortTasks);
  return quickBar + `<div class="filters">
    <select id="f-group"><option value="">Mọi nhóm</option>${opts(GROUPS, filter.group)}</select>
    <select id="f-status"><option value="open"${filter.status === 'open' ? ' selected' : ''}>Chưa xong</option><option value="done"${filter.status === 'done' ? ' selected' : ''}>Đã xong (lưu trữ)</option></select>
  </div>` + (list.map(taskCard).join('') || '<p class="empty">Không có việc nào.</p>');
}

function renderContacts() {
  const list = [...data.contacts].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const cards = list.map(c => {
    const links = [
      c.phone && `<a href="tel:${esc(c.phone)}">Gọi</a>`,
      c.zalo && `<a href="https://zalo.me/${esc(String(c.zalo).replace(/\D/g, ''))}" target="_blank" rel="noopener">Zalo</a>`,
      c.email && `<a href="mailto:${esc(c.email)}">Email</a>`
    ].filter(Boolean).join('');
    return `<div class="card contact"><div class="body" data-contact="${c.id}"><div class="t">${esc(c.name)}</div>
      <div class="chips">${c.role ? `<span class="chip">${esc(c.role)}</span>` : ''}${c.unit ? `<span class="chip">${esc(c.unit)}</span>` : ''}</div>
      ${c.note ? `<div class="log">${esc(c.note)}</div>` : ''}</div><div>${links}</div></div>`;
  }).join('');
  return `<div class="quick"><button class="btn" id="add-contact">+ Thêm người</button>
    <label class="btn ghost">Nhập từ file .vcf<input type="file" id="vcf-file" accept=".vcf,text/vcard,text/x-vcard" hidden></label></div>` + (cards || '<p class="empty">Chưa có ai trong danh bạ.</p>');
}

function render() {
  const titles = { today: 'Hôm nay', tasks: 'Tất cả việc', contacts: 'Danh bạ' };
  $('#title').textContent = titles[view];
  document.querySelectorAll('.bottom button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  const bu = $('#btn-user');
  bu.hidden = store.mode !== 'firebase' || !signedIn;
  bu.textContent = 'Đăng xuất';
  const main = $('#main');
  if (!signedIn) {
    main.innerHTML = `<div class="login"><p>Đăng nhập bằng tài khoản Google để xem công việc.</p><button class="btn" id="login">Đăng nhập Google</button></div>`;
    return;
  }
  const keep = document.activeElement && document.activeElement.id === 'quick' ? $('#quick').value : null;
  main.innerHTML = { today: renderToday, tasks: renderTasks, contacts: renderContacts }[view]() +
    (store.mode === 'local' ? `<div class="note">Đang ở <b>chế độ máy</b>: dữ liệu chỉ lưu trong trình duyệt này, chưa đồng bộ điện thoại và máy tính.</div>` : '');
  if (keep !== null) { const q = $('#quick'); q.value = keep; q.focus(); }
}

/* ---------- Hộp sửa việc / người ---------- */
const dlg = () => $('#dlg');

function names(listName) {
  return `<datalist id="${listName}">${data.contacts.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>`;
}

function openTask(t) {
  const isNew = !t.id;
  const log = (t.log || []).slice().reverse().map(l => `<div class="log">${esc(l.at)} — ${esc(l.text)}</div>`).join('');
  dlg().innerHTML = `<form method="dialog" id="tf">
    <label>Nội dung công việc</label><input name="title" required value="${esc(t.title)}">
    <div class="row"><div><label>Hạn</label><input type="date" name="due" value="${esc(t.due || '')}"></div>
    <div><label>Nhóm việc</label><select name="group">${opts(GROUPS, t.group || 'quanly')}</select></div></div>
    <div class="row"><div><label>Mức ưu tiên</label><select name="prio">${opts(PRIO, t.prio || 3)}</select></div>
    <div><label>Trạng thái</label><select name="status">${opts(STATUS, t.status || 'todo')}</select></div></div>
    <div class="row"><div><label>Giao cho ai</label><input name="assignee" list="dl-a" value="${esc(t.assignee || '')}"></div>
    <div><label>Cần liên hệ với ai</label><input name="contact" list="dl-a" value="${esc(t.contact || '')}"></div></div>
    ${names('dl-a')}
    <label>Lặp lại</label><select name="repeat">${opts(REPEAT, t.repeat || 'none')}</select>
    <label>Link hoặc file đính kèm (mỗi dòng một đường dẫn)</label><textarea name="links">${esc(t.links || '')}</textarea>
    <label>Ghi chú</label><textarea name="notes">${esc(t.notes || '')}</textarea>
    <label>Ghi chú tiến độ mới (tự gắn ngày giờ)</label><input name="progress" placeholder="Đã làm gì, còn gì">
    ${log}
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn danger" id="del">Xoá</button>'}
      <button type="button" class="btn ghost" id="cancel">Đóng</button>
      <button class="btn" value="save">Lưu</button>
    </div></form>`;
  dlg().showModal();
  $('#cancel').onclick = () => dlg().close();
  if (!isNew) $('#del').onclick = async () => {
    if (confirm('Xoá công việc này? Không khôi phục được.')) { await store.remove('tasks', t.id); dlg().close(); }
  };
  $('#tf').onsubmit = async e => {
    const f = new FormData(e.target);
    const item = { ...t,
      title: f.get('title').trim(), due: f.get('due'), group: f.get('group'), prio: +f.get('prio'),
      status: f.get('status'), assignee: f.get('assignee').trim(), contact: f.get('contact').trim(),
      repeat: f.get('repeat'), links: f.get('links'), notes: f.get('notes'), log: t.log || [] };
    const p = f.get('progress').trim();
    if (p) item.log = [...item.log, { at: new Date().toLocaleString('vi-VN'), text: p }];
    if (item.status === 'done' && !item.doneAt) item.doneAt = new Date().toISOString();
    if (item.status !== 'done') item.doneAt = null;
    if (!item.created) item.created = new Date().toISOString();
    await store.save('tasks', item);
  };
}

function openContact(c) {
  const isNew = !c.id;
  dlg().innerHTML = `<form method="dialog" id="cf">
    <label>Họ tên</label><input name="name" required value="${esc(c.name || '')}">
    <div class="row"><div><label>Chức vụ / đơn vị</label><input name="unit" value="${esc(c.unit || '')}"></div>
    <div><label>Vai trò</label><select name="role">${ROLES.map(r => `<option${r === c.role ? ' selected' : ''}>${r}</option>`).join('')}</select></div></div>
    <div class="row"><div><label>Số điện thoại</label><input name="phone" type="tel" value="${esc(c.phone || '')}"></div>
    <div><label>Zalo (số)</label><input name="zalo" type="tel" value="${esc(c.zalo || '')}"></div></div>
    <label>Email</label><input name="email" type="email" value="${esc(c.email || '')}">
    <label>Ghi chú riêng</label><textarea name="note">${esc(c.note || '')}</textarea>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn danger" id="del">Xoá</button>'}
      <button type="button" class="btn ghost" id="cancel">Đóng</button>
      <button class="btn" value="save">Lưu</button>
    </div></form>`;
  dlg().showModal();
  $('#cancel').onclick = () => dlg().close();
  if (!isNew) $('#del').onclick = async () => {
    if (confirm('Xoá người này khỏi danh bạ?')) { await store.remove('contacts', c.id); dlg().close(); }
  };
  $('#cf').onsubmit = async e => {
    const f = new FormData(e.target);
    await store.save('contacts', { ...c, name: f.get('name').trim(), unit: f.get('unit').trim(), role: f.get('role'),
      phone: f.get('phone').trim(), zalo: f.get('zalo').trim(), email: f.get('email').trim(), note: f.get('note') });
  };
}

/* ---------- Nhập danh bạ từ file .vcf (xuất từ iPhone, iCloud hoặc Google Danh bạ) ---------- */
function parseVcf(text) {
  const lines = text.replace(/\r/g, '').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (/^BEGIN:VCARD/i.test(line)) cur = {};
    else if (/^END:VCARD/i.test(line)) { if (cur && cur.name) out.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
      const val = line.slice(i + 1).replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim();
      if (!val) continue;
      if (key === 'FN') cur.name = val;
      else if (key === 'N' && !cur.name) cur.name = val.split(';').reverse().join(' ').trim();
      else if (key === 'TEL' && !cur.phone) cur.phone = val.replace(/[^\d+]/g, '');
      else if (key === 'EMAIL' && !cur.email) cur.email = val;
      else if (key === 'ORG') cur.unit = [val.replace(/;/g, ' ').trim(), cur.unit].filter(Boolean).join(' – ');
      else if (key === 'TITLE') cur.unit = [cur.unit, val].filter(Boolean).join(' – ');
    }
  }
  return out;
}

async function importVcf(file) {
  const found = parseVcf(await file.text());
  const have = new Set(data.contacts.map(c => c.name.toLowerCase() + '|' + (c.phone || '')));
  const fresh = found.filter(c => !have.has(c.name.toLowerCase() + '|' + (c.phone || '')));
  if (!fresh.length) { alert(found.length ? 'Tất cả người trong file đã có trong danh bạ.' : 'Không đọc được người nào trong file.'); return; }
  if (!confirm(`Thêm ${fresh.length} người vào danh bạ (bỏ qua ${found.length - fresh.length} người đã có)?`)) return;
  for (const c of fresh) await store.save('contacts', { role: 'Khác', zalo: c.phone || '', ...c });
  alert(`Đã thêm ${fresh.length} người. Vai trò đang là "Khác", Thầy sửa dần khi cần.`);
}

/* ---------- Đọc ảnh (giấy viết tay, tin nhắn Zalo) bằng Gemini, Thầy xem lại rồi mới lưu ---------- */
const KEY_NAME = 'appcv-gemini';
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest'];
const getKey = () => { try { return localStorage.getItem(KEY_NAME) || ''; } catch { return ''; } };

function askKey() {
  const k = prompt('Dán khoá Gemini (bắt đầu bằng AIza). Để trống rồi bấm OK để xoá khoá khỏi máy này.', getKey());
  if (k === null) return false;
  try { k.trim() ? localStorage.setItem(KEY_NAME, k.trim()) : localStorage.removeItem(KEY_NAME); } catch { /* bỏ qua */ }
  return !!k.trim();
}

async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

async function extractTasks(files) {
  const now = new Date();
  const wd = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'][now.getDay()];
  const prompt = `Đây là ảnh chụp trang giấy viết tay hoặc ảnh chụp màn hình tin nhắn Zalo của một giảng viên đại học. Hãy lọc ra các CÔNG VIỆC mà giảng viên cần làm hoặc cần theo dõi.
Hôm nay là ${wd}, ${toStr(now)}. Đổi mọi hạn dạng tương đối (mai, thứ sáu, cuối tuần...) sang ngày YYYY-MM-DD; không có hạn thì để chuỗi rỗng.
Quy tắc: chỉ ghi việc có thật trong ảnh, không bịa; không tách một việc thành nhiều việc; giữ đúng tên người như trong ảnh.
Với tin nhắn Zalo: "contact" là người nhắn; "notes" tóm tắt ý chính của tin nhắn gốc (một hai câu).
"assignee" chỉ điền khi việc được giao cho người khác làm. "prio": 1 nếu gấp, 2 nếu quan trọng, 3 còn lại.
"group" chọn một trong: giangday (giảng dạy), nckh (nghiên cứu khoa học), quanly (quản lý, hành chính), giaotiep (gọi, nhắn), thoiquen, canhan.
Nếu không có việc nào, trả về mảng rỗng.`;
  const parts = [{ text: prompt }];
  for (const f of files) parts.push({ inlineData: { mimeType: 'image/jpeg', data: await shrink(f) } });
  const body = { contents: [{ parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: {
    type: 'ARRAY', items: { type: 'OBJECT', required: ['title'], properties: {
      title: { type: 'STRING' }, due: { type: 'STRING' }, assignee: { type: 'STRING' }, contact: { type: 'STRING' },
      group: { type: 'STRING', enum: Object.keys(GROUPS) }, prio: { type: 'INTEGER' }, notes: { type: 'STRING' } } } } } };
  let last = '', busy = false;
  // Mô hình đang quá tải (503) thì thử mô hình khác, hết một vòng thì chờ vài giây rồi thử lại (tối đa 3 vòng).
  for (const model of [...GEMINI_MODELS, ...GEMINI_MODELS, ...GEMINI_MODELS]) {
    if (busy && model === GEMINI_MODELS[0]) await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getKey() }, body: JSON.stringify(body) });
    if (res.status === 404) { last = 'Không tìm thấy mô hình ' + model; continue; }
    if (res.status === 400 || res.status === 403) throw new Error('Gemini từ chối khoá hoặc yêu cầu (mã ' + res.status + '). Thầy bấm "Khoá Gemini" để dán lại khoá.');
    if (res.status === 429) throw new Error('Đã dùng hết lượt miễn phí lúc này. Thầy chờ vài phút rồi thử lại.');
    if (res.status === 503 || res.status === 500) { busy = true; continue; }
    if (!res.ok) throw new Error('Gemini báo lỗi mã ' + res.status);
    const j = await res.json();
    const txt = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '[]';
    return JSON.parse(txt);
  }
  throw new Error(busy ? 'Gemini đang quá tải (đã thử nhiều lần). Thầy thử lại sau vài phút.' : (last || 'Không gọi được Gemini'));
}

function reviewExtracted(list) {
  if (!list.length) { dlg().innerHTML = `<p>Không tìm thấy công việc nào trong ảnh.</p><div class="actions"><button type="button" class="btn" id="cancel">Đóng</button></div>`; $('#cancel').onclick = () => dlg().close(); return; }
  const known = name => {
    const n = (name || '').toLowerCase();
    const c = n && (data.contacts.find(c => c.name.toLowerCase() === n) || data.contacts.find(c => c.name.toLowerCase().includes(n)));
    return c ? c.name : (name || '');
  };
  const rows = list.map((t, i) => `<div class="card" style="display:block">
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="chk" name="ok${i}" checked> Lưu việc này</label>
    <input name="title${i}" value="${esc(t.title)}">
    <div class="row"><div><label>Hạn</label><input type="date" name="due${i}" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '')}"></div>
    <div><label>Nhóm việc</label><select name="group${i}">${opts(GROUPS, GROUPS[t.group] ? t.group : 'quanly')}</select></div></div>
    <div class="row"><div><label>Giao cho ai</label><input name="assignee${i}" list="dl-a" value="${esc(known(t.assignee))}"></div>
    <div><label>Cần liên hệ với ai</label><input name="contact${i}" list="dl-a" value="${esc(known(t.contact))}"></div></div>
    <label>Ghi chú</label><input name="notes${i}" value="${esc(t.notes || '')}"></div>`).join('');
  dlg().innerHTML = `<form method="dialog" id="xf"><p><b>Tìm thấy ${list.length} việc.</b> Thầy sửa nếu cần, bỏ tích việc không muốn lưu.</p>${rows}${names('dl-a')}
    <div class="actions"><button type="button" class="btn ghost" id="cancel">Bỏ qua</button><button class="btn" value="save">Lưu các việc đã tích</button></div></form>`;
  $('#cancel').onclick = () => dlg().close();
  $('#xf').onsubmit = async e => {
    const f = new FormData(e.target);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (!f.get('ok' + i) || !f.get('title' + i).trim()) continue;
      await store.save('tasks', { title: f.get('title' + i).trim(), due: f.get('due' + i), group: f.get('group' + i), prio: list[i].prio >= 1 && list[i].prio <= 3 ? list[i].prio : 3,
        status: 'todo', assignee: f.get('assignee' + i).trim(), contact: f.get('contact' + i).trim(), notes: f.get('notes' + i), repeat: 'none', log: [], created: new Date().toISOString() });
      n++;
    }
    if (n) alert(`Đã thêm ${n} việc.`);
  };
}

async function importImages(files) {
  if (!getKey() && !askKey()) return;
  dlg().innerHTML = `<p>Đang đọc ảnh, chờ khoảng 10–20 giây...</p>`;
  dlg().showModal();
  try { reviewExtracted(await extractTasks(files)); }
  catch (err) {
    console.error(err);
    dlg().innerHTML = `<p>${esc(err.message || 'Không đọc được ảnh.')}</p><div class="actions"><button type="button" class="btn" id="cancel">Đóng</button></div>`;
    $('#cancel').onclick = () => dlg().close();
  }
}

/* ---------- Nhập việc từ file JSON (trợ lý soạn sẵn); Thầy xem lại rồi mới lưu ---------- */
async function importJson(file) {
  try {
    const j = JSON.parse(await file.text());
    const list = (Array.isArray(j) ? j : j.tasks || []).filter(t => t && typeof t.title === 'string');
    dlg().innerHTML = '';
    dlg().showModal();
    reviewExtracted(list);
  } catch {
    alert('File này không đọc được. Thầy nhờ trợ lý soạn lại file nhập việc.');
  }
}

/* ---------- Sự kiện ---------- */
function quickAdd() {
  const q = $('#quick');
  if (!q || !q.value.trim()) return;
  const p = parseQuick(q.value);
  q.value = '';
  openTask({ title: p.title, due: p.due, assignee: p.assignee, contact: p.contact, group: view === 'tasks' && filter.group ? filter.group : 'quanly', prio: 3, status: 'todo' });
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-view],[data-open],[data-contact],#quick-go,#add-contact,#login,#btn-user,#gem-key,#paste-img');
  if (!el) return;
  if (el.dataset.view) { view = el.dataset.view; render(); }
  else if (el.dataset.open) openTask(data.tasks.find(t => t.id === el.dataset.open));
  else if (el.dataset.contact) openContact(data.contacts.find(c => c.id === el.dataset.contact));
  else if (el.id === 'quick-go') quickAdd();
  else if (el.id === 'add-contact') openContact({});
  else if (el.id === 'gem-key') askKey();
  else if (el.id === 'paste-img') {
    try {
      const files = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) files.push(new File([await item.getType(type)], 'dan.png', { type }));
      }
      if (files.length) await importImages(files); else alert('Chưa có ảnh nào được sao chép. Thầy chép ảnh trước (giữ ngón tay lên ảnh, chọn Sao chép; trên máy tính bấm chuột phải, chọn Copy image).');
    } catch { alert('Không dán được. Thầy chép ảnh trước, rồi bấm Dán ảnh và cho phép khi máy hỏi. Trên máy tính có thể bấm Ctrl+V.'); }
  }
  else if (el.id === 'login') store.login();
  else if (el.id === 'btn-user') store.logout();
});

document.addEventListener('change', async e => {
  if (e.target.id === 'json-file') {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importJson(file);
  } else if (e.target.id === 'vcf-file') {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importVcf(file);
  } else if (e.target.id === 'img-file') {
    const files = [...e.target.files].slice(0, 6);
    e.target.value = '';
    if (files.length) await importImages(files);
  } else if (e.target.dataset.done) {
    const t = data.tasks.find(x => x.id === e.target.dataset.done);
    const done = e.target.checked;
    await store.save('tasks', { ...t, status: done ? 'done' : 'todo', doneAt: done ? new Date().toISOString() : null });
  } else if (e.target.id === 'f-group') { filter.group = e.target.value; render(); }
  else if (e.target.id === 'f-status') { filter.status = e.target.value; render(); }
});

// Ctrl+V (hoặc Dán) khi đang có ảnh trong bộ nhớ tạm: đọc ảnh luôn, không cần bấm nút.
document.addEventListener('paste', e => {
  if (!signedIn || dlg().open) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  importImages(files.slice(0, 6));
});

document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'quick') { e.preventDefault(); quickAdd(); } });

/* ---------- Khởi động ---------- */
(async function start() {
  try {
    store = firebaseConfig ? await makeFirebaseStore(firebaseConfig) : makeLocalStore();
  } catch (err) {
    console.error(err);
    store = makeLocalStore();
  }
  await store.init(d => { data = d; render(); }, (ok, u) => { signedIn = ok; userInfo = u; render(); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
