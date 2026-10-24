// Lịch công tác tuần của trường: khung "Lịch hôm nay", thẻ Lịch (tuần này, tuần sau) và quản lý vai trò lọc.
// Dữ liệu do nhac/lich.mjs ghi vào users/{uid}/lich; vai trò lưu ở users/{uid}/cfg/lich.
import { DEFAULT_CFG, KINDS, matchItem, addDays, mondayOf, shortTime, expandEvents, schoolSpan, ownSpan, findClashes } from './lichloc.js?v=12';

export function initLich(ctx) {
  const { $, esc, today, fmt, data, store, render, openTask } = ctx;
  const dlg = () => $('#dlg');
  const st = { week: 0, scope: 'mine' };
  const KC = { daihoc: '#3b82c4', pt: '#2f9e6a', them: '#d08a1f', rieng: '#9b6bc4' };
  const events = () => data().events || [];
  const optList = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${String(k) === String(sel) ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const dow = s => WD[new Date(s + 'T00:00:00').getDay()];
  const dm = s => `${+s.slice(8)}/${+s.slice(5, 7)}`;

  const getCfg = () => { const c = data().cfg.find(x => x.id === 'lich'); return c && c.roles ? c : DEFAULT_CFG; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const items = () => data().lich.flatMap(w => w.items || []);
  const matched = () => { const cfg = getCfg(); return items().map(i => ({ ...i, m: matchItem(i, cfg) })); };
  const updated = () => {
    const u = data().lich.map(w => w.updated).filter(Boolean).sort().pop();
    return u ? new Date(u).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
  };

  // Trùng giờ trong khoảng [from, to]: lịch trường của Thầy cộng lịch riêng.
  function clashes(from, to) {
    const own = expandEvents(events(), from, to);
    const school = matched().filter(i => i.m.mine && i.date >= from && i.date <= to);
    return { own, map: findClashes([...school.map(schoolSpan), ...own.map(ownSpan)]) };
  }
  const clashChip = names => names && names.length ? `<div class="chips"><span class="chip red">⚠ Trùng giờ với ${esc(names.slice(0, 2).join('; '))}</span></div>` : '';

  function ownCard(o, cl) {
    const hrs = o.start ? shortTime(o.start) + (o.end ? '–' + shortTime(o.end) : '') : 'Cả ngày';
    const dmo = o.moved ? `${+o.moved.slice(8)}/${+o.moved.slice(5, 7)}` : '';
    const btns = [
      `<button class="btn ghost sm" data-l="eedit" data-id="${esc(o.evId)}">${o.rep ? 'Sửa cả lịch lặp' : 'Sửa'}</button>`,
      o.rep && `<button class="btn ghost sm" data-l="emove" data-id="${esc(o.evId)}" data-d="${o.orig}">Đổi buổi này</button>`,
      o.rep && `<button class="btn ghost sm" data-l="eskip" data-id="${esc(o.evId)}" data-d="${o.orig}">Nghỉ buổi này</button>`,
      o.moved && `<button class="btn ghost sm" data-l="eunmove" data-id="${esc(o.evId)}" data-d="${o.orig}">Trả về ngày cũ</button>`,
      !o.rep && `<button class="btn ghost sm" data-l="edel" data-id="${esc(o.evId)}">Xoá</button>`
    ].filter(Boolean).join('');
    return `<div class="card lc own${cl ? ' clash' : ''}" style="--gc:${KC[o.kind] || KC.rieng}"><div class="body">
      <div class="t"><b>${esc(hrs)}</b> ${esc(o.title)}</div>
      <div class="chips"><span class="chip grp">${esc(KINDS[o.kind] || 'Riêng')}</span>${o.rep ? '<span class="chip">Hằng tuần</span>' : ''}${dmo ? `<span class="chip amber">Đã đổi từ ${dmo}</span>` : ''}${o.place ? `<span class="chip">📍 ${esc(o.place)}</span>` : ''}</div>
      ${clashChip(cl)}${o.note ? `<div class="lm" style="color:var(--mute)">${esc(o.note)}</div>` : ''}
      <div class="lbtns">${btns}</div></div></div>`;
  }

  // Các thẻ của một ngày (trường + riêng) xếp theo giờ.
  function dayCards(d, scope, own, map) {
    const rows = [
      ...matched().filter(i => i.date === d && (scope === 'all' || i.m.mine)).map(i => ({ t: i.time || '', h: card(i, map.get('t:' + i.id)) })),
      ...own.filter(o => o.date === d).map(o => ({ t: o.start || '00:00', h: ownCard(o, map.get('e:' + o.key)) }))
    ];
    return rows.sort((a, b) => a.t.localeCompare(b.t));
  }

  function card(i, cl) {
    const ov = (getCfg().over || {})[i.id];
    const why = i.m.mine
      ? (i.m.roles.length ? 'Khớp: ' + i.m.roles.map(r => `${r.name} (“${r.kw}”)`).join('; ') : i.m.reason)
      : (ov ? i.m.reason : '');
    const btn = ov ? ['clear', 'Bỏ ngoại lệ'] : i.m.mine ? ['no', 'Không phải của tôi'] : ['yes', 'Đây là của tôi'];
    const more = [i.chutri && `Chủ trì: ${i.chutri}`, i.thanhphan && `Thành phần:\n${i.thanhphan}`].filter(Boolean).join('\n');
    return `<div class="card lc${cl ? ' clash' : ''}" style="--gc:${i.m.mine ? 'var(--accent)' : 'var(--line)'}"><div class="body">
      <div class="t"><b>${esc(shortTime(i.time))}</b> ${esc(i.content)}</div>
      ${i.diadiem ? `<div class="chips"><span class="chip">📍 ${esc(i.diadiem)}</span></div>` : ''}${clashChip(cl)}
      ${why ? `<div class="lm">${esc(why)}</div>` : ''}
      ${more ? `<details class="lmore"><summary>Chủ trì, thành phần</summary><div>${esc(more).replace(/\n/g, '<br>')}</div></details>` : ''}
      <div class="lbtns"><button class="btn ghost sm" data-l="task" data-id="${esc(i.id)}">Tạo việc</button>
      <button class="btn ghost sm" data-l="over" data-id="${esc(i.id)}" data-v="${btn[0]}">${btn[1]}</button></div>
    </div></div>`;
  }

  // Khung trên màn Hôm nay.
  function todayBlock() {
    if (!data().lich.length && !events().length) return '<div class="note soon">Lịch công tác của trường sẽ hiện ở đây sau khi máy chủ lấy lịch lần đầu. Lịch dạy riêng thêm ở thẻ Lịch.</div>';
    const td = today();
    const { own, map } = clashes(td, td);
    const rows = dayCards(td, 'mine', own, map);
    return `<h2>Lịch hôm nay <span class="count">${rows.length}</span></h2>` +
      (rows.map(r => r.h).join('') || '<div class="note soon">Hôm nay chưa có lịch nào của Thầy.</div>') +
      (updated() ? `<p class="hint">Lịch trường cập nhật lúc ${esc(updated())}.</p>` : '');
  }

  // Thẻ Lịch.
  function view() {
    const mon = addDays(mondayOf(today()), 7 * st.week);
    const days = [...Array(7)].map((_, k) => addDays(mon, k));
    const { own, map } = clashes(days[0], days[6]);
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, t]) => `<button data-l="${key}" data-v="${v}" class="${String(st[key]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const td = today();
    const body = days.map(d => {
      const rows = dayCards(d, st.scope, own, map);
      if (!rows.length) return '';
      return `<h2${d === td ? ' class="red"' : ''}>${dow(d)}, ${dm(d)}${d === td ? ' · hôm nay' : ''} <span class="count">${rows.length}</span></h2>${rows.map(r => r.h).join('')}`;
    }).join('');
    const empty = data().lich.length || events().length
      ? `<div class="empty"><span class="ico">🗓️</span>${st.scope === 'mine' ? 'Tuần này chưa có lịch nào của Thầy.<br>Bấm “Toàn trường” để xem hết lịch trường.' : 'Chưa có lịch cho tuần này.'}</div>`
      : '<div class="empty"><span class="ico">🗓️</span>Chưa có lịch. Máy chủ sẽ lấy lịch trường vài giờ một lần; lịch dạy riêng thêm bằng nút “Thêm lịch”.</div>';
    return seg('week', [[0, `Tuần này (${dm(mon)}–${dm(addDays(mon, 6))})`], [1, 'Tuần sau']]) +
      seg('scope', [['mine', 'Của tôi'], ['all', 'Toàn trường']]) +
      `<div class="quick"><button class="btn sm" data-l="eadd">+ Thêm lịch</button> <button class="btn ghost sm" data-l="roles">Vai trò của tôi</button></div>` +
      (map.size ? `<div class="note clashn">⚠ Tuần này có lịch trùng giờ (viền đỏ). Mục của trường chỉ có giờ bắt đầu được tạm tính dài 2 tiếng.</div>` : '') +
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

  /* ---------- Lịch riêng ---------- */
  const WDN = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const findEv = id => events().find(x => x.id === id);

  // e: sự kiện cần sửa, hoặc gợi ý cho sự kiện mới { title, date, start, quick }.
  function openEvent(e) {
    const isNew = !e.id;
    const rep = !!e.rep;
    const wd = e.weekday != null ? e.weekday : new Date((e.date || today()) + 'T00:00:00').getDay();
    const skips = (e.skip || []).slice().sort();
    dlg().innerHTML = `<form method="dialog" id="evf"><h3 style="margin:.2rem 0 .4rem">${isNew ? 'Thêm lịch' : 'Sửa lịch'}</h3>
      <label>Tên buổi</label><input name="title" required value="${esc(e.title || '')}" placeholder="Ví dụ: Toán học 1 – lớp K36A">
      <div class="row"><div><label>Loại</label><select name="kind">${optList(KINDS, e.kind || 'rieng')}</select></div>
      <div><label>Lặp lại</label><select name="rep"><option value="0">Một lần</option><option value="1"${rep ? ' selected' : ''}>Hằng tuần</option></select></div></div>
      <div class="row" data-ev="once"><div><label>Ngày</label><input type="date" name="date" value="${esc(e.date || '')}"></div></div>
      <div class="row" data-ev="rep"><div><label>Thứ</label><select name="weekday">${optList(WDN, wd)}</select></div></div>
      <div class="row" data-ev="rep"><div><label>Từ ngày (bỏ trống = không giới hạn)</label><input type="date" name="from" value="${esc(e.from || '')}"></div>
      <div><label>Đến ngày</label><input type="date" name="to" value="${esc(e.to || '')}"></div></div>
      <div class="row"><div><label>Giờ bắt đầu</label><input type="time" name="start" value="${esc(e.start || '')}"></div>
      <div><label>Giờ kết thúc</label><input type="time" name="end" value="${esc(e.end || '')}"></div></div>
      <label>Lớp, phòng, địa điểm</label><input name="place" value="${esc(e.place || '')}">
      <label>Ghi chú</label><textarea name="note">${esc(e.note || '')}</textarea>
      ${skips.length ? `<label>Buổi đã nghỉ</label><div class="lbtns">${skips.map(d => `<button type="button" class="btn ghost sm" data-l="eunskip" data-id="${esc(e.id)}" data-d="${d}">${fmt(d)} · khôi phục</button>`).join('')}</div>` : ''}
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" data-l="edelall" data-id="' + esc(e.id) + '">Xoá</button>'}
      ${e.quick ? '<button type="button" class="btn ghost" id="evtask">Lưu thành việc</button>' : ''}
      <button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="save">Lưu</button></div></form>`;
    const f = $('#evf');
    const sync = () => f.querySelectorAll('[data-ev]').forEach(r => { r.style.display = (r.dataset.ev === 'rep') === (f.elements.rep.value === '1') ? '' : 'none'; });
    f.elements.rep.onchange = sync;
    sync();
    dlg().showModal();
    $('#cancel').onclick = () => dlg().close();
    if (e.quick) $('#evtask').onclick = () => {
      const title = f.elements.title.value.trim() || e.title;
      dlg().close();
      openTask({ title, due: f.elements.date.value || e.date || '', group: 'quanly', prio: 3, status: 'todo' });
    };
    f.onsubmit = async ev => {
      const g = n => f.elements[n].value;
      const isRep = g('rep') === '1';
      if (isRep ? false : !g('date')) { ev.preventDefault(); alert('Thầy chọn ngày của buổi này.'); return; }
      if (g('start') && g('end') && g('end') <= g('start')) { ev.preventDefault(); alert('Giờ kết thúc phải sau giờ bắt đầu.'); return; }
      const item = { id: e.id, title: g('title').trim(), kind: g('kind'), rep: isRep, start: g('start'), end: g('end'), place: g('place').trim(), note: g('note').trim() };
      if (!item.id) delete item.id;
      if (isRep) Object.assign(item, { weekday: +g('weekday'), from: g('from'), to: g('to'), skip: e.skip || [], moved: e.moved || {} });
      else item.date = g('date');
      await store().save('events', item);
    };
  }

  function openMove(ev, orig) {
    const cur = (ev.moved || {})[orig] || { date: orig, start: ev.start, end: ev.end };
    dlg().innerHTML = `<form method="dialog" id="emf"><h3 style="margin:.2rem 0 .4rem">Đổi buổi ${fmt(orig)}</h3>
      <p class="hint">${esc(ev.title)}. Chỉ đổi riêng buổi này, các buổi khác giữ nguyên.</p>
      <div class="row"><div><label>Chuyển sang ngày</label><input type="date" name="date" required value="${esc(cur.date)}"></div></div>
      <div class="row"><div><label>Giờ bắt đầu</label><input type="time" name="start" value="${esc(cur.start || '')}"></div>
      <div><label>Giờ kết thúc</label><input type="time" name="end" value="${esc(cur.end || '')}"></div></div>
      <div class="actions"><button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="save">Lưu</button></div></form>`;
    dlg().showModal();
    $('#cancel').onclick = () => dlg().close();
    $('#emf').onsubmit = async e => {
      const f = e.target.elements;
      if (f.start.value && f.end.value && f.end.value <= f.start.value) { e.preventDefault(); alert('Giờ kết thúc phải sau giờ bắt đầu.'); return; }
      await store().save('events', { ...ev, moved: { ...(ev.moved || {}), [orig]: { date: f.date.value, start: f.start.value, end: f.end.value } } });
    };
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-l]');
    if (!el) return;
    const k = el.dataset.l;
    const ev = el.dataset.id && findEv(el.dataset.id);
    if (k === 'eadd') openEvent({ date: st.week === 0 ? today() : addDays(mondayOf(today()), 7 * st.week) });
    else if (k === 'eedit') { if (ev) openEvent(ev); }
    else if (k === 'emove') { if (ev) openMove(ev, el.dataset.d); }
    else if (k === 'eskip') {
      if (ev && confirm(`Nghỉ buổi ${fmt(el.dataset.d)} của “${ev.title}”?`)) await store().save('events', { ...ev, skip: [...new Set([...(ev.skip || []), el.dataset.d])] });
    }
    else if (k === 'eunmove') {
      if (!ev) return;
      const moved = { ...(ev.moved || {}) }; delete moved[el.dataset.d];
      await store().save('events', { ...ev, moved });
    }
    else if (k === 'eunskip') {
      if (!ev) return;
      const upd = { ...ev, skip: (ev.skip || []).filter(d => d !== el.dataset.d) };
      await store().save('events', upd);
      openEvent(upd);
    }
    else if (k === 'edel') { if (ev && confirm(`Xoá “${ev.title}”?`)) await store().remove('events', ev.id); }
    else if (k === 'edelall') {
      if (ev && confirm(ev.rep ? `Xoá cả lịch lặp “${ev.title}” (mọi buổi)?` : `Xoá “${ev.title}”?`)) { await store().remove('events', ev.id); dlg().close(); }
    }
    else if (k === 'week') { st.week = +el.dataset.v; render(); }
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

  return { view, todayBlock, openEvent };
}
