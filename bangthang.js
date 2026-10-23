/* Bảng tháng theo mẫu Excel của Thầy: nạp một trang tháng làm mẫu, rồi điền số thu chi của app vào đúng ô.
   File Excel của Thầy chỉ được đọc trên máy Thầy; mẫu (bố cục và số cố định) lưu trong dữ liệu riêng của Thầy, không đưa lên GitHub. */

const TPL_ID = 'bangthang';
// Ô nhận số (đơn vị nghìn đồng) theo tên danh mục trong app.
const THU = { 'phiếu lương': 'C26', 'dạy thêm': 'C27', 'khác': 'C28', 'quà tặng': 'C29' };
const THU_RIENG = ['siberi', 'kem', 'tiền mua xe']; // mỗi loại một dòng riêng: C30, C31, C32
const CHI = {
  'ăn uống': 'I26', 'di chuyển': 'I27', 'học tập': 'I28', 'đăng báo': 'I28', 'bản thân': 'I29', 'internet': 'I30', 'tivi': 'I30',
  'diện thoại': 'I31', 'điện thoại': 'I31', 'giải trí': 'I32', 'gia đình': 'I38', 'bống bảo': 'I39', 'cho đi': 'I58',
  'khác': 'I59', 'kinh doanh': 'I59', 'đi dạy': 'I59', 'quà tặng': 'I60', 'chênh lệch': 'I66'
};
const RUT_ROWS = [37, 38, 39, 40], NOP_BIDV_ROWS = [44, 45, 46, 47], NOP_KHAC_ROWS = [48, 49, 50, 51];
// Dòng "Quỹ đầu tư" (C56…C62) và tên ví trong app tương ứng.
const FUNDS = { 56: /ocb/i, 57: /^tk bidv/i, 58: /chứng khoán|^ck\b/i, 59: /phường l[ýy]/i, 60: /topi/i, 61: /phường (vv|tcct)/i, 62: /binance/i };
const ANCHORS = [['B26', /lương/i], ['H26', /ăn uống/i], ['A36', /rút/i], ['A41', /số dư/i], ['A43', /nộp/i], ['G58', /cho đi/i], ['H59', /đảng phí/i], ['B56', /ocb/i], ['A54', /còn lại/i]];

const colIdx = s => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const split = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); return [m[1], +m[2]]; };
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/* Tính công thức đơn giản của trang tháng (SUM, + − × ÷, tham chiếu ô) để file có sẵn số cho mọi trình xem. */
function evalCells(cells) {
  const memo = {}, busy = new Set();
  const val = a => {
    const c = cells[a];
    if (!c) return 0;
    if (!c.f) return typeof c.v === 'number' ? c.v : 0;
    if (a in memo) return memo[a];
    if (busy.has(a)) return 0;
    busy.add(a);
    let r;
    try {
      const js = c.f.replace(/\$/g, '')
        .replace(/([A-Z]+\d+):([A-Z]+\d+)/g, (_, x, y) => `R("${x}","${y}")`)
        .replace(/\bSUM\(/g, 'S(')
        .replace(/(?<![A-Za-z"])([A-Z]{1,2}\d+)(?![\d"(])/g, 'V("$1")');
      r = Function('V', 'R', 'S', `"use strict";return (${js});`)(val,
        (x, y) => { const [c1, r1] = split(x), [c2, r2] = split(y), out = [];
          for (let i = colIdx(c1); i <= colIdx(c2); i++) for (let j = r1; j <= r2; j++) out.push(val(colName(i) + j));
          return out; },
        (...xs) => xs.flat().reduce((s, n) => s + (+n || 0), 0));
      if (!isFinite(r)) r = 0;
    } catch { r = typeof c.v === 'number' ? c.v : 0; }
    busy.delete(a);
    return (memo[a] = r);
  };
  Object.keys(cells).forEach(a => { if (cells[a].f) { cells[a].v = val(a); cells[a].t = 'n'; } });
}
function colName(i) { let s = ''; while (i > 0) { s = String.fromCharCode(65 + (i - 1) % 26) + s; i = Math.floor((i - 1) / 26); } return s; }

export function initSheet(api) {
  const { $, esc, dlg, data, store, walletOf, catOf, kindOf, moveKind, counted, loadXlsx, rangeOfMonth } = api;
  const K = n => Math.round(n / 1000);
  const getTpl = () => data().tpl.find(t => t.id === TPL_ID);

  /* ----- Nạp mẫu từ file Excel ----- */
  async function loadTemplate(file) {
    let X, wb;
    try { X = await loadXlsx(); wb = X.read(await file.arrayBuffer(), { type: 'array', cellNF: true }); }
    catch { alert('Chưa đọc được file này. Thầy kiểm tra mạng (app cần tải công cụ đọc Excel) và chọn đúng file .xlsx.'); return; }
    const names = wb.SheetNames.filter(n => /^\s*\d{1,2}\.\d{4}/.test(n));
    if (!names.length) { alert('Không thấy trang tháng nào (tên dạng 9.2026) trong file này.'); return; }
    dlg().innerHTML = `<form method="dialog"><label>Chọn trang tháng làm mẫu (nên chọn tháng mới nhất đã hoàn thành)</label>
      <select id="tpl-sheet">${names.map(n => `<option value="${esc(n)}">${esc(n.trim())}</option>`).join('')}</select>
      <p class="hint">App chỉ đọc file, không sửa file gốc. Các số tài sản, vốn, nợ trên trang này sẽ được giữ nguyên trong bảng mới.</p>
      <div class="actions"><button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="ok" id="tpl-ok">Dùng trang này</button></div></form>`;
    $('#cancel').onclick = () => dlg().close();
    dlg().showModal();
    $('#tpl-ok').onclick = async e => {
      e.preventDefault();
      const name = $('#tpl-sheet').value, ws = wb.Sheets[name];
      const bad = ANCHORS.filter(([a, re]) => !ws[a] || !re.test(String(ws[a].v || '')));
      if (bad.length) { alert(`Trang "${name.trim()}" khác bố cục mẫu ở ô ${bad.map(b => b[0]).join(', ')}. Thầy chọn trang tháng gần đây (từ 1.2026 trở đi).`); return; }
      const cells = [];
      Object.keys(ws).filter(k => /^[A-Z]+\d+$/.test(k)).forEach(a => {
        const [c, r] = split(a), cell = ws[a];
        if (colIdx(c) > 11 || r > 69 || cell.t === 'e') return;
        let f = cell.f || '';
        if (/!|#REF/.test(f)) f = ''; // công thức trỏ sang trang khác: giữ số đã tính
        if (f === '' && cell.v === undefined) return;
        cells.push([a, cell.t === 's' ? 's' : cell.t === 'b' ? 'b' : 'n', cell.v, f, cell.z && cell.z !== 'General' ? cell.z : '']);
      });
      const [mm, yy] = name.trim().split('.').map(Number);
      const extra = { cols: (ws['!cols'] || []).slice(0, 11).map(c => (c && c.wch) || (c && c.wpx ? c.wpx / 7 : 10)), merges: (ws['!merges'] || []).map(m => X.utils.encode_range(m)).filter(m => { const [a, b] = m.split(':'); return colIdx(split(a)[0]) <= 11 && split(b)[1] <= 69; }) };
      await store().save('tpl', { id: TPL_ID, name: name.trim(), month: `${yy}-${String(mm).padStart(2, '0')}`, cells: JSON.stringify(cells), extra: JSON.stringify(extra), saved: new Date().toISOString() });
      dlg().innerHTML = `<p><b>Đã nạp mẫu "${esc(name.trim())}".</b> Thầy vào mục "Bảng tháng" để tạo bảng cho tháng đang xem.</p><div class="actions"><button type="button" class="btn" id="cancel">Đóng</button></div>`;
      $('#cancel').onclick = () => dlg().close();
    };
  }

  /* ----- Điền số vào mẫu ----- */
  function build(tpl, y, m) {
    const cells = {};
    JSON.parse(tpl.cells).forEach(([a, t, v, f, z]) => { cells[a] = { t, v, f, z }; });
    const set = (a, v) => { cells[a] = { t: typeof v === 'number' ? 'n' : 's', v, f: '', z: (cells[a] || {}).z || '' }; };
    const clear = a => { delete cells[a]; };
    const unplaced = [], notes = [];
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const [s, e] = rangeOfMonth(y, m);
    const list = data().txs.filter(t => t.date >= s && t.date <= e);
    const cl = list.filter(counted);

    // Tiêu đề và tháng trước
    Object.keys(cells).forEach(a => {
      const c = cells[a];
      if (c.t === 's' && /BẢNG CÂN ĐỐI|KẾT QUẢ KINH DOANH/.test(c.v)) c.v = c.v.replace(/\d{1,2}\/\d{4}/, `${m}/${y}`);
    });
    const pm = m === 1 ? 12 : m - 1;
    if (cells.B35) cells.B35.v = `LN THÁNG ${pm}`;
    // Lợi nhuận còn lại của tháng mẫu chuyển sang làm "LN tháng trước" (đúng khi mẫu là tháng liền trước).
    if (tpl.month < ym && cells.C54) cells.C35 = { t: 'n', v: +cells.C54.v || 0, f: '', z: (cells.C35 || {}).z || '' };
    set('C53', 0); // chênh lệch so với số dư thực tế: Thầy tự điền sau khi đối chiếu ngân hàng

    // Thu
    for (const a of ['C26', 'C27', 'C28', 'C29', 'C30', 'C31', 'C32', 'C33']) clear(a);
    for (const a of ['B30', 'B31', 'B32']) clear(a);
    const thu = {}, rieng = {};
    cl.filter(t => t.type === 'thu').forEach(t => {
      const c = catOf(t.cat), n = c ? c.name.trim().toLowerCase() : '';
      if (THU[n]) thu[THU[n]] = (thu[THU[n]] || 0) + t.amount;
      else if (THU_RIENG.includes(n)) rieng[n] = (rieng[n] || 0) + t.amount;
      else unplaced.push({ label: `Thu: ${c ? c.name : 'chưa phân loại'}${t.note ? ' (' + t.note + ')' : ''}`, amount: t.amount });
    });
    Object.entries(thu).forEach(([a, v]) => set(a, K(v)));
    THU_RIENG.forEach((n, i) => { if (rieng[n]) { set('B' + (30 + i), n[0].toUpperCase() + n.slice(1)); set('C' + (30 + i), K(rieng[n])); } });

    // Chi
    [26, 27, 28, 29, 30, 31, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 43, 58, 59, 60, 61, 62, 63, 64, 66, 67].forEach(r => { if (cells['I' + r] && (!cells['I' + r].f || /^[\d+\-*/.() ]+$/.test(cells['I' + r].f))) clear('I' + r); });
    const chi = {};
    cl.filter(t => t.type === 'chi').forEach(t => {
      const c = catOf(t.cat), n = c ? c.name.trim().toLowerCase() : '';
      if (n === 'điện nước') {
        const f = fold(t.note), dien = /\bdien\b/.test(f), nuoc = /\bnuoc\b/.test(f);
        if (dien !== nuoc) { const a = dien ? 'I36' : 'I37'; chi[a] = (chi[a] || 0) + t.amount; }
        else unplaced.push({ label: `Điện nước chưa rõ điện hay nước${t.note ? ' (' + t.note + ')' : ' (không có ghi chú)'} ${t.date}`, amount: t.amount });
      } else if (CHI[n]) chi[CHI[n]] = (chi[CHI[n]] || 0) + t.amount;
      else unplaced.push({ label: `Chi: ${c ? c.name : 'chưa phân loại'}${t.note ? ' (' + t.note + ')' : ''}`, amount: t.amount });
    });
    Object.entries(chi).forEach(([a, v]) => set(a, K(v)));

    // Nộp, rút quỹ đầu tư từ các lần chuyển ví
    [...RUT_ROWS, ...NOP_BIDV_ROWS, ...NOP_KHAC_ROWS].forEach(r => { clear('A' + r); clear('B' + r); clear('C' + r); });
    const lines = { rut: {}, nopB: {}, nopK: {} };
    let khac = 0, khacN = 0;
    const khacL = [];
    list.filter(t => t.type === 'chuyen').forEach(t => {
      const k = moveKind(t), a = walletOf(t.wallet), b = walletOf(t.to);
      const label = `${a ? a.name : '?'} → ${b ? b.name : '?'}`;
      if (k === 'khac') { khac += t.amount; khacN++; khacL.push(`${label} ${Math.round(t.amount).toLocaleString('vi-VN')} ₫`); return; }
      const bucket = k === 'rut' ? lines.rut : kindOf(a || {}) === 'tieudung' ? lines.nopB : lines.nopK;
      bucket[label] = (bucket[label] || 0) + t.amount;
    });
    const place = (bucket, rows, what) => Object.entries(bucket).forEach(([label, v], i) => {
      if (i < rows.length) { set('B' + rows[i], label); set('C' + rows[i], K(v)); }
      else unplaced.push({ label: `${what}: ${label} (hết dòng trong bảng)`, amount: v });
    });
    place(lines.rut, RUT_ROWS, 'Rút quỹ'); place(lines.nopB, NOP_BIDV_ROWS, 'Nộp quỹ'); place(lines.nopK, NOP_KHAC_ROWS, 'Nộp quỹ');
    // "LN chưa phân phối" = số dư trừ chi trừ các khoản nộp từ ví tiêu dùng (mỗi tháng mẫu trừ một số dòng khác nhau nên viết lại công thức).
    cells.C52 = { t: 'n', v: 0, f: 'C41-C42' + Object.keys(lines.nopB).slice(0, NOP_BIDV_ROWS.length).map((_, i) => `-C${NOP_BIDV_ROWS[i]}`).join(''), z: (cells.C52 || {}).z || '' };
    if (khacN) notes.push(`${khacN} lần chuyển ví loại "khác" (tổng ${Math.round(khac).toLocaleString('vi-VN')} ₫) không đưa vào bảng: ${khacL.slice(0, 6).join('; ')}. Nếu muốn tính là nộp hoặc rút quỹ, Thầy đổi "Loại ví" ở thẻ Ví.`);

    // Quỹ đầu tư: số mẫu + tiền vào − tiền ra qua các lần chuyển ví từ sau tháng mẫu đến tháng này
    const from = tpl.month < ym ? tpl.month : null;
    const flow = data().txs.filter(t => t.type === 'chuyen' && (from ? t.date.slice(0, 7) > from && t.date.slice(0, 7) <= ym : t.date.slice(0, 7) === ym));
    Object.entries(FUNDS).forEach(([r, re]) => {
      const base = cells['C' + r] ? +cells['C' + r].v || 0 : 0;
      let d = 0;
      flow.forEach(t => { const a = walletOf(t.wallet), b = walletOf(t.to); if (b && re.test(b.name)) d += t.amount; if (a && re.test(a.name)) d -= t.amount; });
      cells['C' + r] = { t: 'n', v: base + K(d), f: '', z: (cells['C' + r] || {}).z || '' };
    });
    if (tpl.month >= ym) notes.push(`Mẫu đang là tháng ${tpl.name}, không trước tháng ${m}/${y}, nên số "LN tháng trước" và các quỹ lấy theo mẫu và có thể chưa đúng. Thầy nạp lại mẫu bằng tháng liền trước.`);
    else if (flow.some(t => t.date.slice(0, 7) < ym)) notes.push('Mẫu cách tháng này hơn một tháng: số "LN tháng trước" lấy theo mẫu nên có thể lệch.');

    evalCells(cells);
    return { cells, unplaced, notes };
  }

  async function makeSheet(y, m) {
    const tpl = getTpl();
    if (!tpl) { alert('Thầy bấm "Nạp mẫu từ file Excel" trước.'); return; }
    let X;
    try { X = await loadXlsx(); } catch { alert('Cần có mạng để tải công cụ tạo Excel. Thầy thử lại khi có mạng.'); return; }
    const { cells, unplaced, notes } = build(tpl, y, m);
    const extra = JSON.parse(tpl.extra || '{}');
    const ws = {};
    let maxC = 1, maxR = 1;
    Object.entries(cells).forEach(([a, c]) => {
      const o = { t: c.t, v: c.v };
      if (c.f) o.f = c.f;
      if (c.z) o.z = c.z;
      ws[a] = o;
      const [col, r] = split(a); maxC = Math.max(maxC, colIdx(col)); maxR = Math.max(maxR, r);
    });
    ws['!ref'] = `A1:${colName(maxC)}${maxR}`;
    if (extra.cols) ws['!cols'] = extra.cols.map(w => ({ wch: w }));
    if (extra.merges) ws['!merges'] = extra.merges.map(r => X.utils.decode_range(r));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, `${m}.${y}`);
    const sum = unplaced.reduce((a, u) => a + u.amount, 0);
    const v = a => (cells[a] ? cells[a].v : 0);
    dlg().innerHTML = `<p><b>Bảng tháng ${m}/${y} đã sẵn sàng.</b> (nghìn đồng)</p>
      <div class="note box">Tổng thu: <b>${(+v('C34')).toLocaleString('vi-VN')}</b> · Tổng chi: <b>${(+v('C42')).toLocaleString('vi-VN')}</b><br>Nộp quỹ: <b>${(+v('C43')).toLocaleString('vi-VN')}</b> · Rút quỹ: <b>${(+v('C36')).toLocaleString('vi-VN')}</b></div>
      ${unplaced.length ? `<h2>Chưa xếp (${unplaced.length} khoản, ${Math.round(sum).toLocaleString('vi-VN')} ₫)</h2><div class="note box">${unplaced.map(u => `<div>${esc(u.label)}: <b>${Math.round(u.amount).toLocaleString('vi-VN')} ₫</b></div>`).join('')}</div><p class="hint">Các khoản này chưa có trong bảng. Thầy ghi thêm vào đúng dòng khi mở file, hoặc sửa ghi chú trong app rồi tạo lại.</p>` : '<p class="hint">Mọi khoản thu chi đều đã xếp vào bảng.</p>'}
      ${notes.map(n => `<p class="hint">${esc(n)}</p>`).join('')}
      <p class="hint">Ô "Chênh lệch" để 0, Thầy tự điền sau khi đối chiếu với số dư ngân hàng. Các số tài sản, vốn, nợ giữ như mẫu.</p>
      <div class="actions"><button type="button" class="btn ghost" id="cancel">Đóng</button><button type="button" class="btn" id="tpl-dl">Tải file Excel</button></div>`;
    $('#cancel').onclick = () => dlg().close();
    $('#tpl-dl').onclick = () => X.writeFile(wb, `BangThang_${y}-${String(m).padStart(2, '0')}.xlsx`);
    if (!dlg().open) dlg().showModal();
    return { cells, unplaced, notes };
  }

  return { getTpl, loadTemplate, makeSheet, build };
}
