/* Chi tiêu: ví, danh mục, thu chi, biểu đồ, ngân sách, khoản lặp lại, xuất Excel.
   Dùng chung kho dữ liệu của app.js (ctx) nên đồng bộ điện thoại và máy tính như các phần khác. */

const WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const PERIODS = { day: 'Ngày', week: 'Tuần', month: 'Tháng', year: 'Năm' };
const TYPES = { chi: 'Chi phí', thu: 'Thu nhập', chuyen: 'Chuyển ví' };
const DEFAULT_WALLETS = ['Tiền mặt', 'Ngân hàng'];
const DEFAULT_CATS = [
  ['Ăn uống', '🍜', 'chi', '#e07a3f'], ['Đi lại', '🚗', 'chi', '#4f8fc0'], ['Nhà cửa, điện nước', '🏠', 'chi', '#8c6aa8'],
  ['Con cái, học hành', '📚', 'chi', '#c98a2e'], ['Sức khoẻ', '💊', 'chi', '#d0505a'], ['Mua sắm', '🛍️', 'chi', '#b86a7e'],
  ['Biếu tặng, hiếu hỉ', '🎁', 'chi', '#4f8f8a'], ['Cà phê, giải trí', '☕', 'chi', '#7a8c4f'], ['Khác', '📦', 'chi', '#8a8178'],
  ['Lương', '💰', 'thu', '#4f7a55'], ['Thù lao, giờ giảng', '🧾', 'thu', '#3f8f6f'], ['Dạy thêm', '✏️', 'thu', '#6a9a3f'], ['Thu khác', '➕', 'thu', '#8a8178']
];

import { initSheet } from './bangthang.js?v=10';

export function initMoney(ctx) {
  const { $, esc, pad, toStr, today, fmt, uid } = ctx;
  const data = () => ctx.data();
  const store = () => ctx.store();
  const dlg = () => $('#dlg');
  const st = { period: 'month', ref: new Date(), tab: 'chi', sub: 'tx', limit: 60 };

  const vnd = n => Math.round(n || 0).toLocaleString('vi-VN') + ' ₫';
  // Ô tóm tắt hẹp: số lớn viết gọn (triệu, tỷ); danh sách và biểu đồ vẫn hiện đủ số.
  const vndShort = n => {
    const a = Math.abs(n);
    if (a >= 1e9) return (a / 1e9).toFixed(2).replace('.', ',') + ' tỷ';
    if (a >= 1e7) return (a / 1e6).toFixed(2).replace('.', ',') + ' tr';
    return vnd(a);
  };
  const KINDS = { tieudung: 'Ví tiêu dùng', dautu: 'Ví đầu tư tích lũy', khac: 'Ví khác' };
  // Ví cũ chưa chọn loại: tên giống quỹ, chứng khoán thì xếp vào đầu tư; ví đang hiện là tiêu dùng; còn lại là khác. Thầy sửa được trong hộp sửa ví.
  const kindOf = w => w.kind || (/chứng khoán|topi|binance|phường|quỹ|tk bidv|tk ocb/i.test(w.name) ? 'dautu' : (w.archived || w.ignore) ? 'khac' : 'tieudung');
  // Chuyển ví chia 3 nhóm: nộp vào quỹ đầu tư, rút từ quỹ đầu tư, khác.
  const MOVES = { rut: 'Rút tiền từ quỹ đầu tư', nop: 'Nộp tiền vào quỹ đầu tư', khac: 'Chuyển khác' };
  const moveKind = t => {
    const a = walletOf(t.wallet), b = walletOf(t.to);
    const ka = a ? kindOf(a) : 'khac', kb = b ? kindOf(b) : 'khac';
    return kb === 'dautu' && ka !== 'dautu' ? 'nop' : ka === 'dautu' && kb !== 'dautu' ? 'rut' : 'khac';
  };
  const num = v => +String(v || '').replace(/\D/g, '') || 0;
  const catOf = id => data().cats.find(c => c.id === id);
  const walletOf = id => data().wallets.find(w => w.id === id);
  const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  /* ----- Khoảng thời gian đang xem ----- */
  function rangeOf(period, ref) {
    const y = ref.getFullYear(), m = ref.getMonth();
    if (period === 'day') return [toStr(ref), toStr(ref)];
    if (period === 'week') {
      const a = new Date(ref); a.setDate(a.getDate() - ((a.getDay() + 6) % 7));
      const b = new Date(a); b.setDate(b.getDate() + 6);
      return [toStr(a), toStr(b)];
    }
    if (period === 'month') return [ymd(y, m, 1), ymd(y, m, new Date(y, m + 1, 0).getDate())];
    return [ymd(y, 0, 1), ymd(y, 11, 31)];
  }
  function rangeLabel(s, e) {
    if (st.period === 'day') return `${WD[st.ref.getDay()]}, ${fmt(s)}`;
    if (st.period === 'week') return `${fmt(s)} – ${fmt(e)}`;
    if (st.period === 'month') return `Tháng ${pad(st.ref.getMonth() + 1)}/${st.ref.getFullYear()}`;
    return `Năm ${st.ref.getFullYear()}`;
  }
  function shift(dir) {
    const r = st.ref;
    if (st.period === 'day') r.setDate(r.getDate() + dir);
    else if (st.period === 'week') r.setDate(r.getDate() + 7 * dir);
    else if (st.period === 'month') { r.setDate(1); r.setMonth(r.getMonth() + dir); }
    else { r.setDate(1); r.setFullYear(r.getFullYear() + dir); }
  }

  const inRange = (s, e) => data().txs.filter(t => t.date >= s && t.date <= e);
  // Khoản thuộc ví "Không tính vào tổng" (vay mượn, đầu tư…) vẫn hiện trong danh sách nhưng không cộng vào thu, chi, biểu đồ, ngân sách.
  const hiddenW = w => !!(w.archived || w.ignore);
  const visibleWallets = () => data().wallets.filter(w => !hiddenW(w));
  const firstW = () => visibleWallets()[0] || data().wallets[0];
  const counted = t => { const w = walletOf(t.wallet); return !(w && hiddenW(w)); };
  const sum = (list, type) => list.filter(t => t.type === type).reduce((a, t) => a + (+t.amount || 0), 0);

  function walletBalance(w) {
    return (+w.start || 0) + data().txs.reduce((a, t) => {
      if (t.wallet === w.id) return a + (t.type === 'thu' ? t.amount : -t.amount);
      if (t.type === 'chuyen' && t.to === w.id) return a + t.amount;
      return a;
    }, 0);
  }

  /* ----- Biểu đồ tròn theo danh mục ----- */
  function donut(list, type) {
    const by = {};
    list.filter(t => t.type === type).forEach(t => { by[t.cat || '?'] = (by[t.cat || '?'] || 0) + t.amount; });
    const rows = Object.entries(by).map(([id, v]) => ({ c: catOf(id), v })).sort((a, b) => b.v - a.v);
    const total = rows.reduce((a, r) => a + r.v, 0);
    if (!total) return '<div class="empty"><span class="ico">📊</span>Chưa có khoản nào trong giai đoạn này.</div>';
    let acc = 0;
    const arcs = rows.map(r => {
      const p = r.v / total * 100;
      const s = `<circle r="15.915" cx="21" cy="21" fill="none" stroke="${r.c ? r.c.color : '#8a8178'}" stroke-width="6" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${25 - acc}"/>`;
      acc += p;
      return s;
    }).join('');
    const legend = rows.map(r => `<div class="lg"><i style="background:${r.c ? esc(r.c.color) : '#8a8178'}"></i><span class="ln">${r.c ? esc(r.c.emoji + ' ' + r.c.name) : 'Chưa phân loại'}</span><b>${vnd(r.v)}</b><em>${Math.round(r.v / total * 100)}%</em></div>`).join('');
    return `<div class="donutwrap"><svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Biểu đồ theo danh mục">${arcs}<text x="21" y="22.2" text-anchor="middle" class="dt">${vnd(total)}</text></svg><div class="legend">${legend}</div></div>`;
  }

  /* ----- Ngân sách tháng (theo tháng đang chọn) ----- */
  function budgets() {
    const [s, e] = rangeOf('month', st.ref);
    const list = inRange(s, e).filter(counted);
    const rows = data().cats.filter(c => c.type === 'chi' && +c.budget > 0).map(c => {
      const spent = list.filter(t => t.type === 'chi' && t.cat === c.id).reduce((a, t) => a + t.amount, 0);
      const p = spent / c.budget * 100;
      const cls = p > 100 ? 'over' : p >= 80 ? 'warn' : '';
      return `<div class="bud"><div class="bl"><span>${esc(c.emoji)} ${esc(c.name)}</span><b class="${cls}">${vnd(spent)} / ${vnd(c.budget)}</b></div>
        <div class="bar"><i class="${cls}" style="width:${Math.min(100, p)}%"></i></div>
        ${p > 100 ? `<div class="bn over">Vượt ${vnd(spent - c.budget)}</div>` : p >= 80 ? '<div class="bn warn">Sắp hết ngân sách</div>' : ''}</div>`;
    }).join('');
    return rows ? `<h2>Ngân sách tháng ${pad(st.ref.getMonth() + 1)}/${st.ref.getFullYear()}</h2><div class="note box">${rows}</div>` : '';
  }

  /* ----- Danh sách giao dịch theo ngày ----- */
  function txRow(t) {
    const c = catOf(t.cat);
    const w = walletOf(t.wallet);
    let name, icon, color, amt, cls;
    if (t.type === 'chuyen') {
      name = `Chuyển ví`; icon = '🔁'; color = '#8a8178'; cls = 'mv';
      amt = vnd(t.amount);
    } else {
      name = c ? c.name : 'Chưa phân loại'; icon = c ? c.emoji : '❔'; color = c ? c.color : '#8a8178';
      cls = t.type; amt = (t.type === 'thu' ? '+' : '−') + vnd(t.amount);
    }
    const sub = t.type === 'chuyen' ? `${w ? w.name : '?'} → ${walletOf(t.to) ? walletOf(t.to).name : '?'}` : (w ? w.name : '');
    return `<div class="card tx" style="--gc:${esc(color)};--cc:${esc(color)}" data-m="tx" data-id="${t.id}">
      <div class="mi">${esc(icon)}</div>
      <div class="body"><div class="t">${esc(name)}</div><div class="chips"><span class="chip">${esc(sub)}</span>${t.note ? `<span class="tn">${esc(t.note)}</span>` : ''}</div></div>
      <div class="amt ${cls}">${amt}</div></div>`;
  }

  function txList(list) {
    if (!list.length) return '<div class="empty"><span class="ico">🧾</span>Chưa có giao dịch.<br>Bấm nút + để ghi khoản đầu tiên.</div>';
    const MAX = st.limit;
    const cut = list.length > MAX ? [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX) : list;
    const days = [...new Set(cut.map(t => t.date))].sort().reverse();
    const more = list.length > MAX ? `<div class="quick" style="justify-content:center"><button class="btn ghost" data-m="more-tx">Xem thêm (còn ${list.length - MAX} khoản)</button></div>` : '';
    return days.map(d => {
      const items = cut.filter(t => t.date === d).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
      const ci = items.filter(counted);
      const net = sum(ci, 'thu') - sum(ci, 'chi');
      const dt = new Date(d + 'T00:00:00');
      return `<div class="dayh"><span>${WD[dt.getDay()]}, ${fmt(d)}</span><b class="${net < 0 ? 'chi' : 'thu'}">${net < 0 ? '−' : '+'}${vnd(Math.abs(net))}</b></div>${items.map(txRow).join('')}`;
    }).join('') + more;
  }

  /* ----- Màn hình chính của Chi tiêu ----- */
  function render() {
    const d = data();
    if (!d.wallets.length && !d.cats.length) {
      return `<div class="hero"><h2 style="margin-top:0">Bắt đầu theo dõi chi tiêu</h2>
        <p class="hint">App sẽ tạo sẵn 2 ví (Tiền mặt, Ngân hàng) và các danh mục thường gặp. Thầy sửa tên, màu, biểu tượng hoặc thêm bớt bất cứ lúc nào.</p>
        <div class="quick"><button class="btn" data-m="setup">Tạo ví và danh mục mẫu</button>
        <label class="btn ghost">Nhập dữ liệu từ app cũ<input type="file" id="m-import" accept=".json,application/json" hidden></label></div>
        <p class="hint">Đã có file dữ liệu chuyển từ Money Manager thì bấm "Nhập dữ liệu từ app cũ" thay cho tạo mẫu.</p></div>`;
    }
    const [s, e] = rangeOf(st.period, st.ref);
    const list = inRange(s, e);
    const cl = list.filter(counted);
    const thu = sum(cl, 'thu'), chi = sum(cl, 'chi');
    const total = visibleWallets().reduce((a, w) => a + walletBalance(w), 0);
    const seg = Object.entries(PERIODS).map(([k, v]) => `<button data-m="period" data-p="${k}" class="${st.period === k ? 'on' : ''}">${v}</button>`).join('');
    const wcard = w => `<div class="card wal" data-m="wallet" data-id="${w.id}"><div class="mi">👛</div><div class="body"><div class="t">${esc(w.name)}</div></div><div class="amt ${walletBalance(w) < 0 ? 'chi' : ''}">${vnd(walletBalance(w))}</div></div>`;
    const hidden = d.wallets.filter(hiddenW);
    const walls = Object.entries(KINDS).map(([k, label]) => {
      const ws = visibleWallets().filter(w => kindOf(w) === k);
      if (!ws.length) return '';
      return `<div class="kindh"><span>${label}</span><span>${vnd(ws.reduce((a, w) => a + walletBalance(w), 0))}</span></div>${ws.map(wcard).join('')}`;
    }).join('')
      + (hidden.length ? `<details class="tools"><summary>Ví đã ẩn (${hidden.length}), không tính vào số dư</summary>${Object.entries(KINDS).map(([k, label]) => {
        const ws = hidden.filter(w => kindOf(w) === k);
        return ws.length ? `<div class="kindh"><span>${label}</span><span>${ws.length} ví</span></div>${ws.map(wcard).join('')}` : '';
      }).join('')}</details>` : '');
    const cats = ['chi', 'thu'].map(tp => `<div class="catrow"><b>${TYPES[tp]}</b>${d.cats.filter(c => c.type === tp).map(c => `<button class="chip catchip" style="--cc:${esc(c.color)}" data-m="cat" data-id="${c.id}">${esc(c.emoji)} ${esc(c.name)}${+c.budget > 0 ? ' · ' + vnd(c.budget) : ''}</button>`).join('')}<button class="chip catchip addchip" data-m="cat-add" data-t="${tp}">+ Thêm</button></div>`).join('');
    const rec = d.recur.map(r => {
      const c = catOf(r.cat);
      return `<div class="card tx" style="--gc:${esc(c ? c.color : '#8a8178')};--cc:${esc(c ? c.color : '#8a8178')}" data-m="recur" data-id="${r.id}"><div class="mi">${esc(c ? c.emoji : '🔁')}</div>
        <div class="body"><div class="t">${esc(r.note || (c ? c.name : 'Khoản lặp lại'))}</div><div class="chips"><span class="chip">Ngày ${r.day} hằng tháng</span>${r.active === false ? '<span class="chip amber">Đang tạm dừng</span>' : ''}</div></div>
        <div class="amt ${r.type}">${r.type === 'thu' ? '+' : '−'}${vnd(r.amount)}</div></div>`;
    }).join('');
    const subs = { tx: 'Giao dịch', stats: 'Thống kê', move: 'Chuyển ví', wallets: 'Ví', more: 'Thêm' };
    const subbar = `<div class="seg sub" role="tablist">${Object.entries(subs).map(([k, v]) => `<button data-m="sub" data-s="${k}" class="${st.sub === k ? 'on' : ''}">${v}</button>`).join('')}</div>`;
    const periodBar = `<div class="seg" role="tablist">${seg}</div>
      <div class="mnav"><button class="btn ghost sm" data-m="prev" aria-label="Kỳ trước">‹</button><b>${esc(rangeLabel(s, e))}</b><button class="btn ghost sm" data-m="next" aria-label="Kỳ sau">›</button></div>`;
    const tiles = `<div class="stats m">
        <div class="stat green"><b>${vndShort(thu)}</b><span>Thu nhập</span></div>
        <div class="stat red"><b>${vndShort(chi)}</b><span>Chi phí</span></div>
        <div class="stat ${thu - chi < 0 ? 'red' : 'amber'}"><b>${thu - chi < 0 ? '−' : ''}${vndShort(thu - chi)}</b><span>Chênh lệch</span></div></div>`;
    const acc = (title, count, inner) => `<details class="acc"><summary><span>${title}</span>${count == null ? '' : `<em>${count}</em>`}</summary><div class="accb">${inner}</div></details>`;
    let body;
    if (st.sub === 'stats') {
      body = periodBar + tiles
        + `<div class="seg tabs"><button data-m="tab" data-t="chi" class="${st.tab === 'chi' ? 'on' : ''}">Chi phí</button><button data-m="tab" data-t="thu" class="${st.tab === 'thu' ? 'on' : ''}">Thu nhập</button></div>`
        + donut(cl, st.tab) + budgets();
    } else if (st.sub === 'move') {
      const mv = list.filter(t => t.type === 'chuyen');
      const groups = Object.entries(MOVES).map(([k, label]) => {
        const g = mv.filter(t => moveKind(t) === k);
        const tot = g.reduce((a, t) => a + t.amount, 0);
        return `<div class="mvsum"><h2>${label} <span class="count">${g.length}</span></h2><b>${vnd(tot)}</b></div>`
          + (g.length ? g.sort((a, b) => b.date.localeCompare(a.date)).map(t => `<div class="dayh"><span>${fmt(t.date)}</span></div>${txRow(t)}`).join('') : '<div class="note soon">Không có khoản nào trong giai đoạn này.</div>');
      }).join('');
      const unset = d.wallets.some(w => !w.kind);
      body = periodBar + groups
        + (unset ? '<p class="hint">App tự đoán loại ví theo tên. Thầy vào thẻ Ví, bấm từng ví để chọn đúng loại: tiêu dùng, đầu tư tích lũy hoặc khác. Chuyển từ ví khác sang ví đầu tư tính là "Nộp", chiều ngược lại là "Rút".</p>' : '');
    } else if (st.sub === 'wallets') {
      body = `<div class="hero totalbox"><span>Số dư hiện tại</span><b>${vnd(total)}</b><em>Chỉ tính các ví đang hiện</em></div>`
        + walls + `<div class="quick"><button class="btn ghost sm" data-m="wallet-add">+ Thêm ví</button></div>`;
    } else if (st.sub === 'more') {
      body = acc('Danh mục', d.cats.length, `${cats}<p class="hint">Bấm vào danh mục để sửa hoặc xoá; bấm "+ Thêm" để thêm vào phần Chi phí hoặc Thu nhập.</p>`)
        + acc('Khoản lặp lại hằng tháng', d.recur.length, `${rec || '<div class="note soon">Ví dụ: tiền điện, internet, học phí, lương. App tự ghi vào đúng ngày mỗi tháng.</div>'}<div class="quick"><button class="btn ghost sm" data-m="recur-add">+ Thêm khoản lặp lại</button></div>`)
        + acc('Xuất Excel', null, `<p class="hint" style="margin-top:0">Tạo file Excel của tháng <b>${pad(st.ref.getMonth() + 1)}/${st.ref.getFullYear()}</b>: danh sách giao dịch, tổng hợp theo danh mục, số dư các ví. Đổi tháng ở thẻ Giao dịch hoặc Thống kê.</p><div class="quick"><button class="btn ghost" data-m="export">Tải file Excel tháng này</button></div>`)
        + acc('Bảng tháng theo mẫu Excel', null, `<p class="hint" style="margin-top:0">${(d.tpl || []).length ? `Mẫu đang dùng: trang <b>${esc(d.tpl[0].name)}</b>. ` : 'Chưa có mẫu: Thầy nạp mẫu trên máy tính (nơi có file Excel), mẫu sẽ tự sang iPhone và nút "Tạo bảng tháng này" sẽ hiện ra. '}Nạp một trang tháng từ file Excel của Thầy, app sẽ điền số thu, chi, nộp và rút quỹ của tháng đang xem (<b>${pad(st.ref.getMonth() + 1)}/${st.ref.getFullYear()}</b>) vào đúng ô, đơn vị nghìn đồng. Mỗi tháng Thầy nên nạp lại bằng trang tháng liền trước.</p><div class="quick"><label class="btn ghost">Nạp mẫu từ file Excel<input type="file" id="m-tpl" accept=".xlsx,.xlsm" hidden></label>${(d.tpl || []).length ? '<button class="btn ghost" data-m="sheet">Tạo bảng tháng này</button>' : ''}</div>`)
        + acc('Nhập dữ liệu từ app cũ', null, `<p class="hint" style="margin-top:0">Chọn file dữ liệu đã chuyển từ Money Manager. Khoản nào đã có thì bỏ qua, nên nhập lại không bị trùng.</p><div class="quick"><label class="btn ghost">Chọn file để nhập<input type="file" id="m-import" accept=".json,application/json" hidden></label></div>`);
    } else {
      const plain = list.filter(t => t.type !== 'chuyen');
      body = periodBar + tiles + `<div class="note box total">Số dư hiện tại: <b>${vnd(total)}</b></div>`
        + `<h2>Giao dịch <span class="count">${plain.length}</span></h2>${txList(plain)}`;
    }
    return subbar + body;
  }

  /* ----- Hộp thêm / sửa giao dịch ----- */
  const catOptions = (type, sel) => data().cats.filter(c => c.type === type).map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.emoji + ' ' + c.name)}</option>`).join('');
  const walletOptions = sel => data().wallets.filter(w => !hiddenW(w) || w.id === sel).map(w => `<option value="${w.id}"${w.id === sel ? ' selected' : ''}>${esc(w.name)}</option>`).join('');
  const bindMoneyInput = el => el.addEventListener('input', () => { const n = num(el.value); el.value = n ? n.toLocaleString('vi-VN') : ''; });

  function openTx(t = {}) {
    const d = data();
    if (!d.wallets.length || !d.cats.length) { alert('Thầy mở mục Chi tiêu và bấm "Tạo ví và danh mục mẫu" trước.'); return; }
    const isNew = !t.id;
    let type = t.type || (st.tab === 'thu' ? 'thu' : 'chi');
    dlg().innerHTML = `<form method="dialog" id="mtf">
      <div class="seg" id="m-type">${Object.entries(TYPES).map(([k, v]) => `<button type="button" data-t="${k}">${v}</button>`).join('')}</div>
      <label>Số tiền (₫)</label><input name="amount" inputmode="numeric" autocomplete="off" placeholder="0" class="big" value="${t.amount ? (+t.amount).toLocaleString('vi-VN') : ''}">
      <div class="row"><div><label>Ngày</label><input type="date" name="date" value="${esc(t.date || today())}" required></div>
      <div><label id="m-wl">Ví</label><select name="wallet">${walletOptions(t.wallet || firstW().id)}</select></div></div>
      <div id="m-catbox"><label>Danh mục</label><select name="cat"></select></div>
      <div id="m-tobox"><label>Chuyển đến ví</label><select name="to">${walletOptions(t.to || (visibleWallets()[1] || firstW()).id)}</select></div>
      <label>Ghi chú</label><input name="note" value="${esc(t.note || '')}" placeholder="Ví dụ: ăn trưa với đồng nghiệp">
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" id="del">Xoá</button>'}<button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="save">Lưu</button></div></form>`;
    const f = $('#mtf');
    bindMoneyInput(f.amount);
    const apply = () => {
      f.querySelectorAll('#m-type button').forEach(b => b.classList.toggle('on', b.dataset.t === type));
      $('#m-catbox').style.display = type === 'chuyen' ? 'none' : '';
      $('#m-tobox').style.display = type === 'chuyen' ? '' : 'none';
      $('#m-wl').textContent = type === 'chuyen' ? 'Từ ví' : 'Ví';
      if (type !== 'chuyen') f.cat.innerHTML = catOptions(type, t.type === type ? t.cat : '');
    };
    apply();
    f.querySelectorAll('#m-type button').forEach(b => { b.onclick = () => { type = b.dataset.t; apply(); }; });
    $('#cancel').onclick = () => dlg().close();
    if (!isNew) $('#del').onclick = async () => {
      if (confirm('Xoá giao dịch này?')) { await store().remove('txs', t.id); dlg().close(); }
    };
    dlg().showModal();
    if (isNew) f.amount.focus();
    f.onsubmit = async e => {
      const amount = num(f.amount.value);
      if (!amount) { e.preventDefault(); alert('Thầy nhập số tiền.'); return; }
      if (type === 'chuyen' && f.to.value === f.wallet.value) { e.preventDefault(); alert('Hai ví phải khác nhau.'); return; }
      const item = { ...t, type, amount, date: f.date.value, wallet: f.wallet.value, note: f.note.value.trim(),
        cat: type === 'chuyen' ? '' : f.cat.value, to: type === 'chuyen' ? f.to.value : '', created: t.created || new Date().toISOString() };
      if (type !== 'chuyen') st.tab = type;
      await store().save('txs', item);
    };
  }

  function openWallet(w = {}) {
    const isNew = !w.id;
    dlg().innerHTML = `<form method="dialog" id="mwf"><label>Tên ví</label><input name="name" required value="${esc(w.name || '')}" placeholder="Ví dụ: Tiền mặt, Vietcombank, Thẻ tín dụng">
      <label>Số dư ban đầu (₫)</label><input name="start" inputmode="numeric" autocomplete="off" value="${w.start ? (+w.start).toLocaleString('vi-VN') : ''}" placeholder="0">
      <p class="hint">Số dư lúc Thầy bắt đầu ghi sổ. Các khoản thu chi ghi sau sẽ cộng trừ vào đây.</p>
      <label>Loại ví</label><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${kindOf(w) === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <p class="hint">Chuyển tiền từ ví khác sang "ví đầu tư tích lũy" tính là nộp vào quỹ; chiều ngược lại là rút.</p>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="chk" name="hide"${hiddenW(w) ? ' checked' : ''}> Ẩn ví này</label>
      <p class="hint">Ví ẩn không hiện khi chọn ví và không tính vào số dư hiện tại. Hợp với ví vay mượn, đầu tư hoặc ví ít dùng. Bỏ tích để hiện lại.</p>
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" id="del">Xoá</button>'}<button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="save">Lưu</button></div></form>`;
    const f = $('#mwf');
    bindMoneyInput(f.start);
    $('#cancel').onclick = () => dlg().close();
    if (!isNew) $('#del').onclick = async () => {
      const mine = data().txs.filter(t => t.wallet === w.id || t.to === w.id);
      const msg = mine.length
        ? `Ví này có ${mine.length} giao dịch. Xoá ví sẽ xoá luôn các giao dịch đó và không khôi phục được.\n\nNếu chỉ muốn ví không hiện nữa, Thầy bấm Huỷ rồi chọn "Ẩn ví này".\n\nVẫn xoá ví và ${mine.length} giao dịch?`
        : 'Xoá ví này?';
      if (!confirm(msg)) return;
      if (mine.length) await store().removeMany('txs', mine.map(t => t.id));
      await store().remove('wallets', w.id);
      dlg().close();
    };
    dlg().showModal();
    f.onsubmit = async () => { await store().save('wallets', { ...w, name: f.name.value.trim(), start: num(f.start.value), kind: f.kind.value, archived: f.hide.checked, ignore: f.hide.checked }); };
  }

  function openCat(c = {}) {
    const isNew = !c.id;
    const type = c.type || (st.tab === 'thu' ? 'thu' : 'chi');
    dlg().innerHTML = `<form method="dialog" id="mcf"><label>Tên danh mục</label><input name="name" required value="${esc(c.name || '')}">
      <div class="row"><div><label>Biểu tượng (một emoji)</label><input name="emoji" maxlength="4" value="${esc(c.emoji || '📦')}"></div>
      <div><label>Màu</label><input type="color" name="color" value="${esc(c.color || '#a2472b')}"></div></div>
      <label>Loại</label><select name="type"${isNew ? '' : ' disabled'}><option value="chi"${type === 'chi' ? ' selected' : ''}>Chi phí</option><option value="thu"${type === 'thu' ? ' selected' : ''}>Thu nhập</option></select>
      <label>Ngân sách mỗi tháng (₫, chỉ cho khoản chi, để trống nếu không đặt)</label><input name="budget" inputmode="numeric" autocomplete="off" value="${c.budget ? (+c.budget).toLocaleString('vi-VN') : ''}" placeholder="0">
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" id="del">Xoá</button>'}<button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="save">Lưu</button></div></form>`;
    const f = $('#mcf');
    bindMoneyInput(f.budget);
    $('#cancel').onclick = () => dlg().close();
    if (!isNew) $('#del').onclick = async () => {
      const mine = data().txs.filter(t => t.cat === c.id);
      const msg = mine.length ? `Danh mục này có ${mine.length} giao dịch. Nếu xoá, các giao dịch đó vẫn còn nhưng chuyển thành "Chưa phân loại".\n\nVẫn xoá danh mục?` : 'Xoá danh mục này?';
      if (!confirm(msg)) return;
      if (mine.length) await store().saveMany('txs', mine.map(t => ({ ...t, cat: '' })));
      await store().remove('cats', c.id);
      dlg().close();
    };
    dlg().showModal();
    f.onsubmit = async () => {
      await store().save('cats', { ...c, name: f.name.value.trim(), emoji: f.emoji.value.trim() || '📦', color: f.color.value,
        type: isNew ? f.type.value : c.type, budget: (isNew ? f.type.value : c.type) === 'chi' ? num(f.budget.value) : 0 });
    };
  }

  function openRecur(r = {}) {
    const isNew = !r.id;
    let type = r.type || 'chi';
    dlg().innerHTML = `<form method="dialog" id="mrf"><div class="seg" id="m-type">${['chi', 'thu'].map(k => `<button type="button" data-t="${k}">${TYPES[k]}</button>`).join('')}</div>
      <label>Số tiền (₫)</label><input name="amount" inputmode="numeric" autocomplete="off" class="big" value="${r.amount ? (+r.amount).toLocaleString('vi-VN') : ''}">
      <div class="row"><div><label>Ngày trong tháng (1–31)</label><input name="day" type="number" min="1" max="31" required value="${r.day || new Date().getDate()}"></div>
      <div><label>Ví</label><select name="wallet">${walletOptions(r.wallet)}</select></div></div>
      <label>Danh mục</label><select name="cat"></select>
      <label>Ghi chú / tên khoản</label><input name="note" value="${esc(r.note || '')}" placeholder="Ví dụ: Tiền điện, Học phí, Lương">
      <label>Bắt đầu từ ngày</label><input type="date" name="start" value="${esc(r.start || today())}">
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="chk" name="active"${r.active === false ? '' : ' checked'}> Đang áp dụng</label>
      <p class="hint">Đến ngày, app tự ghi một giao dịch vào sổ (tháng ngắn hơn thì ghi vào ngày cuối tháng). Thầy mở app thì mới ghi, nên có thể thấy khoản ghi muộn vài ngày nếu Thầy chưa mở.</p>
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" id="del">Xoá</button>'}<button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="save">Lưu</button></div></form>`;
    const f = $('#mrf');
    bindMoneyInput(f.amount);
    const apply = () => {
      f.querySelectorAll('#m-type button').forEach(b => b.classList.toggle('on', b.dataset.t === type));
      f.cat.innerHTML = catOptions(type, r.type === type ? r.cat : '');
    };
    apply();
    f.querySelectorAll('#m-type button').forEach(b => { b.onclick = () => { type = b.dataset.t; apply(); }; });
    $('#cancel').onclick = () => dlg().close();
    if (!isNew) $('#del').onclick = async () => { if (confirm('Xoá khoản lặp lại này? Các giao dịch đã ghi vẫn giữ nguyên.')) { await store().remove('recur', r.id); dlg().close(); } };
    dlg().showModal();
    f.onsubmit = async e => {
      const amount = num(f.amount.value);
      if (!amount) { e.preventDefault(); alert('Thầy nhập số tiền.'); return; }
      await store().save('recur', { ...r, type, amount, day: Math.min(31, Math.max(1, +f.day.value || 1)), wallet: f.wallet.value, cat: f.cat.value,
        note: f.note.value.trim(), start: f.start.value || today(), active: f.active.checked, posted: r.posted || [] });
    };
  }

  /* ----- Tự ghi khoản lặp lại đến hạn (mỗi lần mở app) ----- */
  const inflight = new Set();
  async function tick() {
    const d = data();
    if (!d.recur.length || !d.wallets.length) return;
    const td = today();
    for (const r of d.recur) {
      if (r.active === false || !r.start) continue;
      const posted = new Set(r.posted || []);
      const fresh = [];
      let [y, m] = r.start.split('-').map(Number);
      m -= 1;
      for (let i = 0; i < 240; i++, m++) {
        if (m > 11) { m = 0; y++; }
        const last = new Date(y, m + 1, 0).getDate();
        const date = ymd(y, m, Math.min(r.day, last));
        if (date > td) break;
        const key = date.slice(0, 7);
        if (date < r.start || posted.has(key) || inflight.has(r.id + key)) continue;
        inflight.add(r.id + key);
        fresh.push({ key, date });
      }
      if (!fresh.length) continue;
      for (const f of fresh) {
        await store().save('txs', { id: `r_${r.id}_${f.key}`, type: r.type, amount: r.amount, date: f.date, wallet: r.wallet, cat: r.cat, to: '', note: r.note || '', created: new Date().toISOString() });
      }
      await store().save('recur', { ...r, posted: [...posted, ...fresh.map(f => f.key)] });
    }
  }

  /* ----- Xuất Excel ----- */
  function loadXlsx() {
    return new Promise((res, rej) => {
      if (window.XLSX) return res(window.XLSX);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => res(window.XLSX);
      s.onerror = () => rej(new Error('offline'));
      document.head.appendChild(s);
    });
  }

  async function exportMonth() {
    const d = data();
    const [s, e] = rangeOf('month', st.ref);
    const list = inRange(s, e).sort((a, b) => a.date.localeCompare(b.date));
    const name = id => (walletOf(id) || {}).name || '';
    const rows = list.map(t => ({
      'Ngày': fmt(t.date), 'Loại': TYPES[t.type], 'Danh mục': (catOf(t.cat) || {}).name || '',
      'Số tiền (₫)': t.amount, 'Ví': name(t.wallet), 'Chuyển đến': name(t.to), 'Ghi chú': t.note || ''
    }));
    const bycat = {};
    list.filter(t => t.type !== 'chuyen' && counted(t)).forEach(t => {
      const k = t.type + '|' + t.cat;
      bycat[k] = bycat[k] || { 'Loại': TYPES[t.type], 'Danh mục': (catOf(t.cat) || {}).name || 'Chưa phân loại', 'Số tiền (₫)': 0, 'Ngân sách (₫)': t.type === 'chi' ? (+(catOf(t.cat) || {}).budget || '') : '' };
      bycat[k]['Số tiền (₫)'] += t.amount;
    });
    const wallets = visibleWallets().map(w => ({ 'Ví': w.name, 'Số dư hiện tại (₫)': walletBalance(w) }));
    const tag = s.slice(0, 7);
    try {
      const X = await loadXlsx();
      const wb = X.utils.book_new();
      const add = (data, title, widths) => { const ws = X.utils.json_to_sheet(data.length ? data : [{ 'Thông báo': 'Không có dữ liệu' }]); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, title); };
      add(rows, 'Giao dịch', [12, 11, 22, 14, 16, 16, 36]);
      add(Object.values(bycat), 'Theo danh mục', [11, 24, 16, 16]);
      add(wallets, 'Số dư ví', [24, 20]);
      X.writeFile(wb, `ChiTieu_${tag}.xlsx`);
    } catch {
      // Không tải được thư viện Excel (mất mạng): xuất CSV, Excel vẫn mở được.
      const head = Object.keys(rows[0] || { 'Ngày': 0, 'Loại': 0, 'Danh mục': 0, 'Số tiền (₫)': 0, 'Ví': 0, 'Chuyển đến': 0, 'Ghi chú': 0 });
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = '﻿' + [head.map(q).join(','), ...rows.map(r => head.map(h => q(r[h])).join(','))].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `ChiTieu_${tag}.csv`;
      a.click();
      alert('Máy chưa tải được công cụ tạo Excel (có thể do mất mạng), nên app xuất file CSV. Excel mở file này bình thường.');
    }
  }

  const sheet = initSheet({ $, esc, dlg, data, store, walletOf, catOf, kindOf, moveKind, counted, loadXlsx,
    rangeOfMonth: (y, m) => [ymd(y, m - 1, 1), ymd(y, m - 1, new Date(y, m, 0).getDate())] });

  async function setup() {
    for (const n of DEFAULT_WALLETS) await store().save('wallets', { name: n, start: 0 });
    for (const [name, emoji, type, color] of DEFAULT_CATS) await store().save('cats', { name, emoji, type, color, budget: 0 });
  }

  /* ----- Nhập dữ liệu từ app cũ (file JSON do trợ lý chuyển từ Money Manager) ----- */
  async function importFile(file) {
    let j;
    try { j = JSON.parse(await file.text()); } catch { j = null; }
    if (!j || !Array.isArray(j.txs) || !Array.isArray(j.wallets) || !Array.isArray(j.cats)) { alert('File này không đúng dạng. Thầy nhờ trợ lý chuyển lại dữ liệu từ app cũ.'); return; }
    const d = data();
    const newer = (list, have) => { const ids = new Set(have.map(x => x.id)); return list.filter(x => !ids.has(x.id)); };
    const ws = newer(j.wallets, d.wallets), cs = newer(j.cats, d.cats), ts = newer(j.txs, d.txs);
    if (!ts.length && !ws.length && !cs.length) { alert('Tất cả dữ liệu trong file đã có trong app.'); return; }
    if (!confirm(`Nhập ${ws.length} ví, ${cs.length} danh mục và ${ts.length} giao dịch (bỏ qua ${j.txs.length - ts.length} giao dịch đã có)?`)) return;
    dlg().innerHTML = '<p>Đang nhập dữ liệu, Thầy chờ một lát và đừng đóng app...</p>';
    dlg().showModal();
    try {
      await store().saveMany('wallets', ws);
      await store().saveMany('cats', cs);
      await store().saveMany('txs', ts);
      dlg().innerHTML = `<p><b>Đã nhập xong:</b> ${ws.length} ví, ${cs.length} danh mục, ${ts.length} giao dịch.</p><p class="hint">Thầy xem lại số dư từng ví và so với app cũ. Ví nào là vay mượn hoặc đầu tư đã được đánh dấu "Không tính vào tổng".</p><div class="actions"><button type="button" class="btn" id="cancel">Đóng</button></div>`;
    } catch (err) {
      console.error(err);
      dlg().innerHTML = `<p>Nhập chưa xong: ${esc(err.message || 'lỗi không rõ')}. Thầy bấm nhập lại, các khoản đã nhập sẽ được bỏ qua.</p><div class="actions"><button type="button" class="btn" id="cancel">Đóng</button></div>`;
    }
    $('#cancel').onclick = () => dlg().close();
  }

  document.addEventListener('change', async e => {
    if (e.target.id !== 'm-import' && e.target.id !== 'm-tpl') return;
    const file = e.target.files[0], id = e.target.id;
    e.target.value = '';
    if (file) await (id === 'm-tpl' ? sheet.loadTemplate(file) : importFile(file));
  });

  /* ----- Sự kiện ----- */
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-m]');
    if (!el) return;
    const a = el.dataset.m, id = el.dataset.id, d = data();
    if (a === 'sub') { st.sub = el.dataset.s; st.limit = 60; ctx.render(); window.scrollTo(0, 0); }
    else if (a === 'more-tx') { st.limit += 100; ctx.render(); }
    else if (a === 'period') { st.period = el.dataset.p; st.limit = 60; ctx.render(); }
    else if (a === 'prev') { shift(-1); st.limit = 60; ctx.render(); }
    else if (a === 'next') { shift(1); st.limit = 60; ctx.render(); }
    else if (a === 'tab') { st.tab = el.dataset.t; ctx.render(); }
    else if (a === 'tx') openTx(d.txs.find(t => t.id === id));
    else if (a === 'wallet') openWallet(d.wallets.find(w => w.id === id));
    else if (a === 'wallet-add') openWallet({});
    else if (a === 'cat') openCat(d.cats.find(c => c.id === id));
    else if (a === 'cat-add') openCat({ type: el.dataset.t });
    else if (a === 'recur') openRecur(d.recur.find(r => r.id === id));
    else if (a === 'recur-add') { if (!d.wallets.length || !d.cats.length) alert('Thầy bấm "Tạo ví và danh mục mẫu" trước.'); else openRecur({}); }
    else if (a === 'export') exportMonth();
    else if (a === 'sheet') sheet.makeSheet(st.ref.getFullYear(), st.ref.getMonth() + 1);
    else if (a === 'setup') setup();
  });

  return { render, openTx, tick };
}
