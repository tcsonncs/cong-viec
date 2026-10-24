// Điểm tin sáng: khung trên màn Hôm nay, hộp xem đủ tin (nhóm theo chủ đề, xem lại 7 ngày) và hộp "Chủ đề của tôi".
// Tin do nhac/tin.mjs ghi vào users/{uid}/tin/{YYYY-MM-DD}; chủ đề lưu ở users/{uid}/cfg/tin.
import { DEFAULT_TOPICS, topicsOf } from './tinloc.js?v=16';

export function initTin(ctx) {
  const { $, esc, today, fmt, data, store } = ctx;
  const dlg = () => $('#dlg');
  const clone = o => JSON.parse(JSON.stringify(o));
  const getCfg = () => data().cfg.find(x => x.id === 'tin');
  const days = () => (data().tin || []).filter(d => Array.isArray(d.items) && d.items.length).sort((a, b) => b.id.localeCompare(a.id));
  const safe = u => (/^https?:\/\//.test(u || '') ? u : '#');

  const item = i => `<article class="news"><a class="nt" href="${esc(safe(i.link))}" target="_blank" rel="noopener">${esc(i.title)}</a>
    ${i.sum ? `<p class="ns">${esc(i.sum)}</p>` : ''}<div class="chips"><span class="chip grp">${esc(i.topic)}</span><span class="chip">${esc(i.source || '')}</span></div></article>`;

  // Khung trên màn Hôm nay: 3 tin đầu của bản mới nhất.
  function todayBlock() {
    const d = days()[0];
    if (!d) return `<section class="lbox tin"><h2>📰 Điểm tin sáng</h2><div class="note soon">Tin sáng sẽ hiện ở đây sau 6h30 mỗi ngày.</div>
      <div class="lbtns"><button class="btn ghost sm" data-n="topics">Chủ đề của tôi</button></div></section>`;
    return `<section class="lbox tin"><h2>📰 Điểm tin sáng <span class="count">${d.items.length}</span></h2>
      ${d.id !== today() ? `<p class="hint">Bản ngày ${esc(fmt(d.id))}; tin hôm nay có lúc 6h30.</p>` : ''}
      ${d.items.slice(0, 3).map(item).join('')}
      <div class="lbtns"><button class="btn sm" data-n="all">Xem cả ${d.items.length} tin</button><button class="btn ghost sm" data-n="topics">Chủ đề của tôi</button></div></section>`;
  }

  /* ---------- Xem đủ tin ---------- */
  function openAll(id) {
    const list = days().slice(0, 8);
    const d = list.find(x => x.id === id) || list[0];
    if (!d) { openTopics(); return; }
    const groups = [...new Set(d.items.map(i => i.topic))];
    dlg().innerHTML = `<div id="tinv"><h3 style="margin:.2rem 0 .4rem">📰 Điểm tin sáng</h3>
      <label>Xem ngày</label><select id="tin-day">${list.map(x => `<option value="${esc(x.id)}"${x.id === d.id ? ' selected' : ''}>${esc(fmt(x.id))}${x.id === today() ? ' (hôm nay)' : ''}</option>`).join('')}</select>
      ${groups.map(g => `<h4 class="lday">${esc(g)}</h4>${d.items.filter(i => i.topic === g).map(item).join('')}`).join('')}
      <p class="hint">Tóm tắt do Gemini viết từ tiêu đề và mô tả của bài; bấm tiêu đề để đọc bài gốc. Tin đầu tư chỉ để tham khảo, không phải lời khuyên mua bán.</p>
      <div class="actions"><button type="button" class="btn ghost" data-n="topics">Chủ đề của tôi</button><button type="button" class="btn" id="cancel">Đóng</button></div></div>`;
    $('#cancel').onclick = () => dlg().close();
    $('#tin-day').onchange = e => openAll(e.target.value);
    if (!dlg().open) dlg().showModal();
  }

  /* ---------- Chủ đề của tôi ---------- */
  let draft = null;
  const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);

  function readForm() {
    const f = $('#tpf');
    if (!f) return;
    draft.forEach((t, i) => {
      t.on = f.elements['on' + i].checked;
      t.name = f.elements['name' + i].value.trim() || 'Chủ đề mới';
      t.kw = lines(f.elements['kw' + i].value);
      t.en = lines(f.elements['en' + i].value);
    });
  }

  function paintTopics() {
    dlg().innerHTML = `<form method="dialog" id="tpf"><h3 style="margin:.2rem 0 .4rem">Chủ đề của tôi</h3>
      <p class="hint">Mỗi sáng 6h30, máy chủ tìm tin 24 giờ qua theo <b>từ khoá</b> của các chủ đề đang bật, rồi chọn 5–7 tin. Cụm nhiều chữ được tìm nguyên cụm. Chủ đề mới hay từ khoá mới có tin từ sáng hôm sau (hoặc Thầy chạy tay workflow “Diem tin” trên GitHub).</p>
      ${draft.map((t, i) => `<div class="lrole">
        <div class="lrow"><label class="lchk"><input type="checkbox" name="on${i}" ${t.on === false ? '' : 'checked'}> Bật</label><input name="name${i}" value="${esc(t.name)}"></div>
        <textarea name="kw${i}" rows="3" placeholder="Mỗi dòng một từ khoá tiếng Việt">${esc((t.kw || []).join('\n'))}</textarea>
        <details${(t.en || []).length ? ' open' : ''}><summary>Từ khoá tiếng Anh (tuỳ chọn, tin sẽ được dịch)</summary><textarea name="en${i}" rows="2" placeholder="Mỗi dòng một từ khoá">${esc((t.en || []).join('\n'))}</textarea></details>
        <button type="button" class="btn danger sm" data-n="tdel" data-i="${i}">Xoá chủ đề này</button></div>`).join('')}
      <button type="button" class="btn ghost sm" data-n="tadd">+ Thêm chủ đề</button>
      <div class="actions"><button type="button" class="btn ghost" data-n="treset">Về mặc định</button><button type="button" class="btn ghost" id="cancel">Đóng</button><button class="btn" value="save">Lưu</button></div></form>`;
    $('#cancel').onclick = () => dlg().close();
    $('#tpf').onsubmit = async () => {
      readForm();
      await store().save('cfg', { id: 'tin', topics: draft });
    };
  }

  function openTopics() {
    draft = clone(topicsOf(getCfg()));
    paintTopics();
    if (!dlg().open) dlg().showModal();
  }

  /* ---------- Mở từ thông báo (#tin) ---------- */
  let hashDone = false;
  function checkHash() {
    if (hashDone || location.hash !== '#tin' || !days().length) return;
    hashDone = true;
    openAll();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.url === '#tin') openAll(); });

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-n]');
    if (!el) return;
    const k = el.dataset.n;
    if (k === 'all') openAll();
    else if (k === 'topics') openTopics();
    else if (k === 'tadd') { readForm(); draft.push({ id: 't' + Date.now().toString(36), name: 'Chủ đề mới', on: true, kw: [], en: [], feeds: [] }); paintTopics(); }
    else if (k === 'tdel') {
      readForm();
      if (confirm(`Xoá chủ đề “${draft[+el.dataset.i].name}”?`)) { draft.splice(+el.dataset.i, 1); paintTopics(); }
    }
    else if (k === 'treset') { if (confirm('Đặt lại các chủ đề về mẫu ban đầu?')) { draft = clone(DEFAULT_TOPICS); paintTopics(); } }
  });

  return { todayBlock, openAll, checkHash };
}
