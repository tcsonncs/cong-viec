// Chạy trên GitHub Actions: đọc việc trong Firestore rồi gửi thông báo đẩy tới các thiết bị đã bật nhắc.
// MODE=morning: nhắc buổi sáng (quá hạn, hôm nay, ngày mai). MODE=week: tổng kết tuần tối Chủ nhật.
// DRY=1: chạy thử với dữ liệu mẫu, không cần Firebase.

const MODE = process.env.MODE === 'week' ? 'week' : 'morning';
const DRY = process.env.DRY === '1';
const DAY = 864e5;

// Ngày theo giờ Việt Nam, dạng YYYY-MM-DD (en-CA cho đúng dạng này).
const vnDate = (offset = 0, base = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(base.getTime() + offset * DAY));

const short = list => list.slice(0, 3).map(t => t.title).join('; ') + (list.length > 3 ? '…' : '');

export function buildMorning(tasks, today = vnDate(0), tomorrow = vnDate(1)) {
  const open = tasks.filter(t => t.status !== 'done' && t.due);
  const over = open.filter(t => t.due < today);
  const now = open.filter(t => t.due === today);
  const tom = open.filter(t => t.due === tomorrow);
  if (!over.length && !now.length && !tom.length) return null;
  const parts = [];
  if (over.length) parts.push(`Quá hạn (${over.length}): ${short(over)}`);
  if (now.length) parts.push(`Hôm nay (${now.length}): ${short(now)}`);
  if (tom.length) parts.push(`Ngày mai (${tom.length}): ${short(tom)}`);
  return { title: 'Công việc hôm nay', body: parts.join('. ') };
}

export function buildWeek(tasks, habits, today = vnDate(0)) {
  const from = vnDate(-6);
  const toVn = iso => vnDate(0, new Date(iso));
  const doneWeek = tasks.filter(t => t.doneAt && toVn(t.doneAt) >= from).length;
  const open = tasks.filter(t => t.status !== 'done' && t.due);
  const over = open.filter(t => t.due < today).length;
  const next7 = open.filter(t => t.due > today && t.due <= vnDate(7)).length;
  const days = [...Array(7)].map((_, i) => vnDate(-i));
  const hab = habits.map(h => `${h.name} ${days.filter(d => (h.days || []).includes(d)).length}/7`).join(', ');
  const body = `Xong ${doneWeek} việc, quá hạn ${over}, tuần tới có ${next7} việc đến hạn.` + (hab ? ` Thói quen: ${hab}.` : '');
  return { title: 'Tổng kết tuần', body };
}

const build = (tasks, habits) => (MODE === 'week' ? buildWeek(tasks, habits) : buildMorning(tasks));

async function main() {
  if (DRY) {
    const t = vnDate(0), y = vnDate(-1), m = vnDate(1);
    const tasks = [
      { title: 'Nộp báo cáo khoa', due: y, status: 'todo' },
      { title: 'Soạn đề cương Toán cơ sở', due: t, status: 'doing' },
      { title: 'Họp tổ bộ môn', due: m, status: 'todo' },
      { title: 'Việc đã xong', due: y, status: 'done', doneAt: new Date().toISOString() }
    ];
    const habits = [{ name: 'Đọc sách', days: [t, y] }, { name: 'Thể dục', days: [t] }];
    console.log(MODE, JSON.stringify(build(tasks, habits), null, 2));
    return;
  }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getMessaging } = await import('firebase-admin/messaging');
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = getFirestore();
  const messaging = getMessaging();

  // Mỗi thiết bị đã bật thông báo có một tài liệu trong users/{uid}/devices.
  const devices = await db.collectionGroup('devices').get();
  const byUser = new Map();
  for (const d of devices.docs) {
    const uid = d.ref.parent.parent.id;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(d);
  }

  for (const [uid, docs] of byUser) {
    const [tasks, habits] = await Promise.all(['tasks', 'habits'].map(async c =>
      (await db.collection(`users/${uid}/${c}`).get()).docs.map(x => x.data())));
    const msg = build(tasks, habits);
    if (!msg) { console.log(`Không có gì để nhắc (${MODE}).`); continue; }
    const res = await messaging.sendEach(docs.map(d => ({
      token: d.data().token,
      data: msg,
      webpush: { headers: { Urgency: 'high', TTL: '3600' } }
    })));
    for (let i = 0; i < res.responses.length; i++) {
      const r = res.responses[i];
      if (r.success) continue;
      console.log('Gửi lỗi:', r.error?.code);
      if (r.error?.code === 'messaging/registration-token-not-registered') await docs[i].ref.delete();
    }
    console.log(`Đã gửi ${res.successCount}/${docs.length} thiết bị: ${msg.title}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
