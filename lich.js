// Lịch công tác tuần của trường: khung "Lịch hôm nay", thẻ Lịch (tuần này, tuần sau) và quản lý vai trò lọc.
// Dữ liệu do nhac/lich.mjs ghi vào users/{uid}/lich; vai trò lưu ở users/{uid}/cfg/lich.
import { DEFAULT_CFG, matchItem, addDays, mondayOf, shortTime } from './lichloc.js?v=11';

export function initLich(ctx) {
  const { $, esc, today, fmt, data, store, render, openTask } = ctx;
  const dlg = () => $('#dlg');
  const st = { week: 0, scope: 'mine' };
  const WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const dow = s => WD[new Date(s + 'T00:00:00').getDay()];
  const dm = s => `${+s.slice(8)}/${+s.slice(5, 7)}`;

  const getCfg = () => { const c = data().cfg.find(x => x.id === 'lich'); return c && c.roles ? c : DEFAULT_CFG; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const items = () => data().lich.flatMap(w => w.items || []);
  const matched = () => { const cfg = getCfg(); return items().map(i => ({ ...i, m: matchItem(i, cfg) })); };
  const byTime = (a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '');
  const updated = () => {
    const u = data().lich.map(w => w.updated).filter(Boolean).sort().pop();
    return u ? new Date(u).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
  };

  function card(i) {
    const ov = (getCfg().over || {})[i.id];
    const why = i.m.mine
      ? (i.m.roles.length ? 'Khớp: ' + i.m.roles.map(r => `${r.name} (“${r.kw}”)`).join('; ') : i.m.reason)
      : (ov ? i.m.reason : '');
    const btn = ov ? ['clear', 'Bỏ ngoại lệ'] : i.m.mine ? ['no', 'Không phải của tôi'] : ['yes', 'Đây là của tôi'];
    const more = [i.chutri && `Chủ trì: ${i.chutri}`, i.thanhphan && `Thành phần:\n${i.thanhphan}`].filter(Boolean).join('\n');
    return `<div class="card lc" style="--gc:${i.m.mine ? 'var(--accent)' : 'var(--line)'}"><div class="body">
      <div class="t"><b>${esc(shortTime(i.time))}</b> ${esc(i.content)}</div>
      ${i.diadiem ? `<div class="chips"><span class="chip">📍 ${esc(i.diadiem)}</span></div>` : ''}
      ${why ? `<div class="lm">${esc(why)}</div>` : ''}
      ${more ? `<details class="lmore"><summary>Chủ trì, thành phần</summary><div>${esc(more).replace(/\n/g, '<br>')}</div></details>` : ''}
      <div class="lbtns"><button class="btn ghost sm" data-l="task" data-id="${esc(i.id)}">Tạo việc</button>
      <button class="btn ghost sm" data-l="over" data-id="${esc(i.id)}" data-v="${btn[0]}">${btn[1]}</button></div>
    </div></div>`;
  }

  // Khung trên màn Hôm nay.
  function todayBlock() {
    if (!data().lich.length) return '<div class="note soon">Lịch công tác của trường sẽ hiện ở đây sau khi máy chủ lấy lịch lần đầu.</div>';
    const td = today();
    const list = matched().filter(i => i.date === td && i.m.mine).sort(byTime);
    return `<h2>Lịch hôm nay <span class="count">${list.length}</span></h2>` +
      (list.map(card).join('') || '<div class="note soon">Hôm nay lịch trường không có mục nào của Thầy.</div>') +
      `<p class="hint">Cập nhật lúc ${esc(updated())}.</p>`;
  }

  // Thẻ Lịch.
  function view() {
    const mon = addDays(mondayOf(today()), 7 * st.week);
    const days = [...Array(7)].map((_, k) => addDays(mon, k));
    const all = matched().filter(i => days.includes(i.date) && (st.scope === 'all' || i.m.mine)).sort(byTime);
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, t]) => `<button data-l="${key}" data-v="${v}" class="${String(st[key]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const td = today();
    const body = days.map(d => {
      const list = all.filter(i => i.date === d);
      if (!list.length) return '';
      return `<h2${d === td ? ' class="red"' : ''}>${dow(d)}, ${dm(d)}${d === td ? ' · hôm nay' : ''} <span class="count">${list.length}</span></h2>${list.map(card).join('')}`;
    }).join('');
    const empty = data().lich.length
      ? `<div class="empty"><span class="ico">🗓️</span>${st.scope === 'mine' ? 'Tuần này lịch trường chưa có mục nào của Thầy.<br>Bấm “Toàn trường” để xem hết.' : 'Chưa có lịch cho tuần này.'}</div>`
      : '<div class="empty"><span class="ico">🗓️</span>Chưa có lịch. Máy chủ sẽ lấy lịch trường vài giờ một lần.</div>';
    return seg('week', [[0, `Tuần này (${dm(mon)}–${dm(addDays(mon, 6))})`], [1, 'Tuần sau']]) +
      seg('scope', [['mine', 'Của tôi'], ['all', 'Toàn trường']]) +
      `<div class="quick"><button class="btn ghost sm" data-l="roles">Vai trò của tôi</button></div>` +
      (body || empty) +
      `<p class="hint">Nguồn: naue.edu.vn/LichTuan.aspx${updated() ? ', cập nhật lúc ' + esc(updated()) : ''}.</p>`;
  }

  /* ---------- Vai trò ---------- */
  let draft = null;

  function readForm() {
    const f = $('#lrf');
    if (!f) return;
    const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);
    draft.roles.forEach((r, i) => {
      r.on = f.elements['on' + i].checked;
      r.name = f.elements['name' + i].value.trim() || 'Vai trò mới';
      r.kw = lines(f.elements['kw' + i].value);
    });
    draft.exclude = lines(f.elements.ex.value);
  }

  function paintRoles() {
    dlg().innerHTML = `<form method="dialog" id="lrf"><h3 style="margin:.2rem 0 .4rem">Vai trò của tôi</h3>
      <p class="hint">Một mục trong lịch trường được xếp vào “Của tôi” khi nội dung, chủ trì hoặc thành phần có <b>từ khoá</b> của một vai trò đang bật. Khớp nguyên chữ, không phân biệt hoa thường (chữ “TH” không khớp “THPT”).</p>
      ${draft.roles.map((r, i) => `<div class="lrole">
        <div class="lrow"><label class="lchk"><input type="checkbox" name="on${i}" ${r.on === false ? '' : 'checked'}> Bật</label><input name="name${i}" value="${esc(r.name)}"></div>
        <textarea name="kw${i}" rows="3" placeholder="${r.id === 'canhan' ? 'Gõ tên Thầy đúng như lịch trường ghi, mỗi cách ghi một dòng' : 'Mỗi dòng một từ khoá'}">${esc((r.kw || []).join('\n'))}</textarea>
        <button type="button" class="btn danger sm" data-l="rdel" data-i="${i}">Xoá vai trò này</button></div>`).join('')}
      <button type="button" class="btn ghost sm" data-l="radd">+ Thêm vai trò</button>
      <label>Từ khoá loại trừ (mỗi dòng một) — mục có chữ này trong nội dung hoặc chủ trì sẽ bị bỏ</label>
      <textarea name="ex" rows="3">${esc((draft.exclude || []).join('\n'))}</textarea>
      <div class="actions"><button type="button" class="btn ghost" data-l="rreset">Khôi phục mẫu</button><button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="save">Lưu</button></div></form>`;
    $('#cancel').onclick = () => dlg().close();
    $('#lrf').onsubmit = async () => {
      readForm();
      const cfg = { id: 'lich', roles: draft.roles, exclude: draft.exclude, over: draft.over || {} };
      await store().save('cfg', cfg);
    };
  }

  function openRoles() {
    draft = clone(getCfg());
    paintRoles();
    dlg().showModal();
  }

  async function saveOver(id, v) {
    const cfg = clone(getCfg());
    cfg.id = 'lich';
    cfg.over = cfg.over || {};
    if (v === 'clear') delete cfg.over[id]; else cfg.over[id] = v;
    await store().save('cfg', cfg);
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-l]');
    if (!el) return;
    const k = el.dataset.l;
    if (k === 'week') { st.week = +el.dataset.v; render(); }
    else if (k === 'scope') { st.scope = el.dataset.v; render(); }
    else if (k === 'roles') openRoles();
    else if (k === 'radd') { readForm(); draft.roles.push({ id: 'r' + Date.now().toString(36), name: 'Vai trò mới', on: true, kw: [] }); paintRoles(); }
    else if (k === 'rdel') {
      readForm();
      if (confirm(`Xoá vai trò “${draft.roles[+el.dataset.i].name}”?`)) { draft.roles.splice(+el.dataset.i, 1); paintRoles(); }
    }
    else if (k === 'rreset') {
      if (confirm('Đặt lại các vai trò và từ khoá loại trừ về mẫu ban đầu? Các ngoại lệ từng mục vẫn giữ.')) {
        const over = draft.over; draft = clone(DEFAULT_CFG); draft.over = over || {}; paintRoles();
      }
    }
    else if (k === 'over') await saveOver(el.dataset.id, el.dataset.v);
    else if (k === 'task') {
      const i = items().find(x => x.id === el.dataset.id);
      if (!i) return;
      openTask({ title: i.content, due: i.date, group: 'quanly', prio: 3, status: 'todo',
        notes: [`Lịch trường ${fmt(i.date)} lúc ${shortTime(i.time)}`, i.diadiem && `Địa điểm: ${i.diadiem}`, i.chutri && `Chủ trì: ${i.chutri}`].filter(Boolean).join('\n') });
    }
  });

  return { view, todayBlock };
}
