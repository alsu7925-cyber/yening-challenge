/* 예브 챌린지 — 앱 (PIN 잠금 · 챌린지 현황 · 오늘의 소재 · 이미지 합성 · 실시간 동기화) */
'use strict';

/* ───────────────────────── 기본 유틸 ───────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nfmt = (n) => (Number(n) || 0).toLocaleString('ko-KR');
const won = (n) => '₩' + (Number(n) || 0).toLocaleString('ko-KR');
const KST_OFF = 9 * 3600 * 1000;
const kstDate = (d = new Date()) => new Date(d.getTime() + KST_OFF).toISOString().slice(0, 10);
const kstClock = (d = new Date()) => new Date(d.getTime() + KST_OFF).toISOString().slice(11, 16);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function dowOf(ds) { return new Date(ds + 'T00:00:00+09:00').getDay(); }
function addDays(ds, n) { const d = new Date(ds + 'T00:00:00+09:00'); d.setDate(d.getDate() + n); return kstDate(d); }
function daysBetween(a, b) {
  const out = []; let d = a;
  let guard = 0;
  while (d <= b && guard++ < 400) { out.push(d); d = addDays(d, 1); }
  return out;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2200);
}

/* ───────────────────────── 암호 (PIN) ───────────────────────── */
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));

async function deriveKey(pin, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter || 150000, hash: 'SHA-256' }, base, 256);
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function decryptEnvelope(env, pin) {
  const salt = b64d(env.kdf.salt);
  const key = await deriveKey(pin, salt, env.kdf.iter);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(dec.decode(plain));
}
async function encryptJSON(obj, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, 150000);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({
    v: 1,
    kdf: { algo: 'PBKDF2-SHA256', iter: 150000, salt: b64e(salt) },
    iv: b64e(iv),
    ct: b64e(ct),
  });
}

/* ───────────────────────── 앱 상태 ───────────────────────── */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};

const APP = {
  pin: '',
  state: null,
  public: null,
  built: null,
  ui: { tab: 'home', round: null, blog: 'all', matTab: 'main_inflow', matDate: kstDate(), topic: 'all' },
  sync: { url: '', anon: '', key: '', rev: 0, last: '', status: 'idle', busy: false },
  bootAt: kstDate(),
};

/* ───────────────────────── 동기화 (Supabase RPC) ───────────────────────── */
const DEVICE = LS.get('yc.device', '') || (LS.set('yc.device', 'device-' + Math.random().toString(16).slice(2, 6)), LS.get('yc.device'));

function setSync(status, text) {
  APP.sync.status = status;
  const chip = $('#syncChip'); const lbl = $('#syncText');
  chip.className = 'sync-chip' + (status === 'ok' ? ' ok' : status === 'err' ? ' err' : '');
  lbl.textContent = text || (status === 'ok' ? '실시간 연결' : status === 'err' ? '동기화 오류' : '연결 확인 중');
  if (status === 'ok' && APP.sync.last) lbl.textContent = '동기화 ' + APP.sync.last.slice(11, 16);
}

async function rpc(fn, body) {
  const url = APP.sync.url + '/rest/v1/rpc/' + fn;
  const r = await fetch(url, {
    method: 'POST',
    headers: { apikey: APP.sync.anon, Authorization: 'Bearer ' + APP.sync.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let data = null;
  try { data = JSON.parse(txt); } catch { }
  if (!r.ok) {
    const msg = (data && (data.message || data.hint)) || txt.slice(0, 120) || ('HTTP ' + r.status);
    throw new Error(msg);
  }
  return data;
}

async function syncPull(quiet) {
  if (!APP.sync.key) { setSync('off', '동기화 꺼짐'); return false; }
  try {
    const d = await rpc('challenge_load', { p_key: APP.sync.key, p_id: 'main' });
    if (d && !d.empty && d.payload) {
      const remote = await decryptEnvelope(JSON.parse(d.payload), APP.pin);
      APP.sync.rev = d.rev;
      APP.sync.last = d.updated_at || '';
      const before = JSON.stringify(APP.state);
      APP.state = mergeStates(APP.state, remote);
      saveLocal();
      const after = JSON.stringify(APP.state);
      setSync('ok');
      if (after !== before) { renderAll(); }
      return after !== JSON.stringify(remote);
    }
    setSync('ok');
    return true;   // 원격이 비어 있음 → 이 기기 기록을 올린다
  } catch (e) {
    console.warn('[sync pull]', e);
    setSync('err', '동기화 오류');
    APP.sync.err = e.message || '';
    if (!quiet) toast('동기화 실패 · ' + (e.message || '').slice(0, 40));
    return false;
  }
}

let pushTimer = null;
function queuePush() {
  if (!APP.sync.key) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncPush(), 600);
}

async function syncPush() {
  if (!APP.sync.key || APP.sync.busy) return;
  APP.sync.busy = true;
  try {
    const env = await encryptJSON(APP.state, APP.pin);
    const d = await rpc('challenge_save', { p_key: APP.sync.key, p_payload: env, p_id: 'main', p_client: DEVICE });
    APP.sync.rev = d.rev; APP.sync.last = d.updated_at || '';
    setSync('ok');
  } catch (e) {
    console.warn('[sync push]', e);
    setSync('err', '저장 실패 · 기기에 임시 보관');
  } finally {
    APP.sync.busy = false;
  }
}

/* 두 상태를 합친다 — 날짜·블로그 단위로 더 최근 것, 글 목록은 합집합 */
function mergeStates(local, incoming) {
  const out = JSON.parse(JSON.stringify(incoming || {}));
  out.entries = out.entries || {};
  out.picks = Object.assign({}, (incoming || {}).picks || {});
  const l = local || {};
  // 설정류는 config(빌드본)를 따른다
  out.rounds = (incoming && incoming.rounds) || l.rounds;
  out.blogs = (incoming && incoming.blogs) || l.blogs;
  out.active_round = (incoming && incoming.active_round) || l.active_round;

  for (const [date, day] of Object.entries(l.entries || {})) {
    out.entries[date] = out.entries[date] || {};
    for (const [bid, le] of Object.entries(day)) {
      const re = out.entries[date][bid];
      if (!re) { out.entries[date][bid] = le; continue; }
      const newer = (le.ts || 0) >= (re.ts || 0) ? le : re;
      const older = newer === le ? re : le;
      const posts = [];
      const seen = new Set();
      for (const p of [...(newer.posts || []), ...(older.posts || [])]) {
        if (!p || !p.url || seen.has(p.url)) continue;
        seen.add(p.url); posts.push(p);
      }
      posts.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      out.entries[date][bid] = {
        views: Number(newer.views || 0),
        revenue: Number(newer.revenue || 0),
        memo: newer.memo || older.memo || '',
        ts: Math.max(Number(le.ts || 0), Number(re.ts || 0)),
        posts,
      };
    }
  }
  for (const k of Object.keys(l.picks || {})) if (l.picks[k]) out.picks[k] = true;
  if (!out.materials) out.materials = l.materials || {};
  if (!out.materials_history) out.materials_history = l.materials_history || {};
  return out;
}

/* ───────────────────────── 계산 ───────────────────────── */
function activeRound() {
  const s = APP.state;
  if (!s) return null;
  return s.rounds.find((r) => r.id === s.active_round) || s.rounds[0];
}
function roundDays(round) { return daysBetween(round.start_date, round.end_date); }
function dayEntry(date, bid) {
  const e = APP.state && APP.state.entries ? APP.state.entries[date] : null;
  return (e && e[bid]) || null;
}
function postsOf(date, bid) { const e = dayEntry(date, bid); return (e && e.posts) || []; }

/** 블로그 한 곳의 기수 성적 — 점수는 '포스팅 점수 + 방문·수익 증가분'
 *  · 글 1편 = 1,000점 (하루 10편까지 인정 → 하루 최대 10,000점)
 *  · 방문자 증가분 1명 = 1점, 수익 증가분 1원 = 1점
 *  · 증가분은 첫날(기준일)을 baseline 으로 두고, 둘째 날부터 '전일 대비 증가분'만 더한다.
 *    감소한 날은 0점(페널티 없음).
 */
const POST_POINT = 1000;
const DAY_POST_CAP = 10;

function blogStats(blog, round) {
  const days = roundDays(round);
  const today = kstDate();
  let doneDays = 0, posts = 0, views = 0, revenue = 0, elapsed = 0, todayPosts = 0;
  let postScore = 0, growth = 0, postCapped = 0;
  let prev = null;                       // 전일(또는 기준일) 값
  const daily = [];

  days.forEach((d, i) => {
    const e = dayEntry(d, blog.id);
    const n = e ? (e.posts || []).length : 0;
    const v = e ? Number(e.views || 0) : null;
    const r = e ? Number(e.revenue || 0) : null;

    posts += n;
    if (n >= blog.goal && blog.goal > 0) doneDays++;
    if (e) { views += Number(e.views || 0); revenue += Number(e.revenue || 0); }
    if (d <= today) elapsed++;
    if (d === today) todayPosts = n;

    const counted = Math.min(n, DAY_POST_CAP);
    if (n > DAY_POST_CAP) postCapped++;
    const pScore = counted * POST_POINT;

    let grow = 0;
    if (i === 0) {
      prev = { v: v == null ? 0 : v, r: r == null ? 0 : r };   // 기준일
    } else if (v != null || r != null) {
      const base = prev || { v: 0, r: 0 };
      const dv = Math.max(0, (v || 0) - base.v);
      const dr = Math.max(0, (r || 0) - base.r);
      grow = dv + dr;
      prev = { v: v == null ? base.v : v, r: r == null ? base.r : r };
    }

    postScore += pScore;
    growth += grow;
    daily.push({ date: d, posts: n, pScore, grow, views: v, revenue: r });
  });

  const goalSum = blog.goal * Math.max(elapsed, 1);
  const attain = Math.min(999, Math.round((posts / goalSum) * 100));
  const score = postScore + growth;
  return { id: blog.id, days, doneDays, posts, views, revenue, todayPosts, attain, score,
           postScore, growth, postCapped, daily, elapsed };
}

/* ───────────────── 리그: 경험치 · 연속 달성 · 성장률 · 시상식 ───────────────── */
const XP_PER_LEVEL = 300;

function dayOf(round, i) { return roundDays(round)[i]; }

/** 전날(또는 직전 기록일) 방문자·수익 */
function prevVals(blogId, round, date) {
  const days = roundDays(round);
  const i = days.indexOf(date);
  for (let k = i - 1; k >= 0; k--) {
    const e = dayEntry(days[k], blogId);
    if (e) return { views: Number(e.views || 0), revenue: Number(e.revenue || 0), date: days[k] };
  }
  return { views: 0, revenue: 0, date: null };
}

/** 연속 달성(스트릭) — 오늘 달성 전이면 어제까지의 연속 일수 */
function streakOf(blog, round) {
  const days = roundDays(round);
  const today = kstDate();
  const done = (d) => {
    const e = dayEntry(d, blog.id);
    return !!e && (e.posts || []).length >= blog.goal && blog.goal > 0;
  };
  let cur = 0, idx = days.indexOf(today);
  if (idx < 0) idx = days.filter((d) => d <= today).length - 1;
  if (idx >= 0 && !done(days[idx])) idx -= 1;
  for (let k = idx; k >= 0; k--) {
    if (!done(days[k])) break;
    cur++;
  }
  // 최고 기록
  let best = 0, run = 0;
  for (const d of days) {
    if (d > today) break;
    if (done(d)) { run++; best = Math.max(best, run); } else run = 0;
  }
  return { cur, best };
}

/** 캐릭터 성장: XP = 달성일 100 + 글 1편당 10(하루 100까지) */
function growth(blog, round) {
  const days = roundDays(round);
  const today = kstDate();
  let xp = 0, doneDays = 0;
  for (const d of days) {
    if (d > today) break;
    const e = dayEntry(d, blog.id);
    if (!e) continue;
    const n = (e.posts || []).length;
    if (n >= blog.goal && blog.goal > 0) { xp += 100; doneDays++; }
    xp += Math.min(n * 10, 100);
  }
  const level = Math.min(20, 1 + Math.floor(xp / XP_PER_LEVEL));
  const inLevel = xp % XP_PER_LEVEL;
  const st = streakOf(blog, round);
  const badges = [];
  if (doneDays >= 1) badges.push({ i: '🌱', t: '첫 달성' });
  if (st.cur >= 3 || st.best >= 3) badges.push({ i: '🔥', t: '3일 연속' });
  if (st.best >= 7) badges.push({ i: '🏅', t: '7일 연속' });
  if (st.best >= 14) badges.push({ i: '👑', t: '14일 연속' });
  return { xp, level, inLevel, need: XP_PER_LEVEL, streak: st.cur, best: st.best, doneDays, badges };
}

/** 성장률 점수 — 신생 블로그도 공정하게 겨루는 지표 (0~300%) */
function growthScore(blog, round) {
  const days = roundDays(round);
  const today = kstDate();
  const elapsed = Math.max(1, days.filter((d) => d <= today).length);
  const e1 = dayEntry(days[0], blog.id);
  const base = { views: Number((e1 || {}).views || 0), revenue: Number((e1 || {}).revenue || 0) };
  let last = { views: base.views, revenue: base.revenue, date: days[0] };
  let posts = 0;
  for (const d of days) {
    if (d > today) break;
    const e = dayEntry(d, blog.id);
    if (!e) continue;
    posts += (e.posts || []).length;
    last = { views: Number(e.views || 0), revenue: Number(e.revenue || 0), date: d };
  }
  const attain = Math.round((posts / (blog.goal * elapsed)) * 100);
  const visG = base.views > 0 ? ((last.views - base.views) / base.views) * 100 : (last.views > 0 ? 100 : 0);
  const revG = base.revenue > 0 ? ((last.revenue - base.revenue) / base.revenue) * 100 : (last.revenue > 0 ? 100 : 0);
  const cap = (v) => Math.max(0, Math.min(300, v));
  const score = +(cap(attain) * 0.6 + cap(visG) * 0.3 + cap(revG) * 0.1).toFixed(1);
  return { score, attain, visG: +visG.toFixed(1), revG: +revG.toFixed(1), posts, base, last };
}

function rankByGrowth(round) {
  return APP.state.blogs
    .map((b) => ({ blog: b, g: growthScore(b, round), st: blogStats(b, round) }))
    .sort((a, b) => b.g.score - a.g.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** 오늘의 시상식 */
function todayAwards(round) {
  const today = kstDate();
  const rows = APP.state.blogs.map((b) => {
    const e = dayEntry(today, b.id) || { posts: [], views: 0, revenue: 0 };
    const n = (e.posts || []).length;
    const p = prevVals(b.id, round, today);
    const dViews = Math.max(0, Number(e.views || 0) - p.views);
    const dRev = Math.max(0, Number(e.revenue || 0) - p.revenue);
    return { blog: b, posts: n, dViews, dRev, score: Math.min(n, 10) * 1000 + dViews + dRev };
  });
  const pick = (fn) => rows.slice().sort((a, b) => fn(b) - fn(a))[0];
  const pub = pick((r) => r.posts);
  const vis = pick((r) => r.dViews);
  const rev = pick((r) => r.dRev);
  const mvp = pick((r) => r.score);
  const has = (r, k) => r && r[k] > 0;
  return {
    pub: has(pub, 'posts') ? pub : null,
    vis: has(vis, 'dViews') ? vis : null,
    rev: has(rev, 'dRev') ? rev : null,
    mvp: has(mvp, 'score') ? mvp : null,
  };
}

/** 인증 마감 카운트다운 — 발행일 다음 날 23:59 까지 */
function certDeadline(dateStr) {
  const d = new Date(dateStr + 'T23:59:59+09:00');
  d.setDate(d.getDate() + 1);
  return d.getTime();
}
function pendingCerts(round) {
  const days = roundDays(round);
  const today = kstDate();
  const now = Date.now();
  const out = [];
  for (const d of days) {
    if (d >= today) break;
    for (const b of APP.state.blogs) {
      const e = dayEntry(d, b.id);
      const n = e ? (e.posts || []).length : 0;
      if (n < b.goal) {
        const dl = certDeadline(d);
        if (dl > now) out.push({ date: d, blog: b, n, left: dl - now });
      }
    }
  }
  return out.sort((a, b) => a.left - b.left);
}
function fmtLeft(ms) {
  if (ms <= 0) return '마감';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${h}시간 ${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`;
}

function certBanner(round) {
  const pend = pendingCerts(round);
  if (!pend.length) return '';
  const p0 = pend[0];
  return `<div class="sec card card-pad banner-warn">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:20px">⏳</span>
      <div style="flex:1;min-width:180px">
        <div style="font-weight:800;font-size:13.5px">아직 인증 안 한 날이 있어요 · ${pend.length}칸</div>
        <div style="font-size:11.5px;color:var(--brown-2);margin-top:2px">${esc(p0.date.slice(5).replace('-', '.'))} ${esc(p0.blog.name)} 부터 · 마감까지 <b class="live-left" data-left="${p0.left}" data-ts="${Date.now()}">${fmtLeft(p0.left)}</b></div>
      </div>
      <button class="btn sm" data-day="${p0.date}">달력에서 등록</button>
    </div>
  </div>`;
}

/** 지난 기수 우승 기록 */
function seasonHistory() {
  const rounds = APP.state.rounds || [];
  return rounds.map((r) => {
    const active = r.id === (activeRound() || {}).id && kstDate() <= r.end_date;
    const ranked = APP.state.blogs.map((b) => ({ blog: b, st: blogStats(b, r) }))
      .sort((a, b) => b.st.score - a.st.score);
    const posts = ranked.reduce((a, x) => a + x.st.posts, 0);
    return { round: r, win: ranked[0], posts, ranked, active };
  });
}

function rankAll(round) {
  return APP.state.blogs
    .map((b) => ({ blog: b, ...blogStats(b, round) }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
function lastRoundDay(round) {
  const days = roundDays(round).filter((d) => d <= kstDate());
  return days.length ? days[days.length - 1] : round.start_date;
}

/* ───────────────────────── 렌더: 공통 조각 ───────────────────────── */
function dayState(date, bid, goal) {
  const e = dayEntry(date, bid);
  const n = e ? (e.posts || []).length : 0;
  const today = kstDate();
  if (date > today) return { cls: 'plan', label: '예정', n, goal };
  if (n >= goal && goal > 0) return { cls: 'done', label: '완료', n, goal };
  if (n > 0) return { cls: 'prog', label: '진행중', n, goal };
  return { cls: 'miss', label: '미제출', n, goal };
}

/* ───────────────────────── 홈 ───────────────────────── */
function renderHome() {
  const s = APP.state, round = activeRound();
  const today = kstDate();
  const ranks = rankAll(round);
  const top = ranks[0];
  const goalDay = s.blogs.reduce((a, b) => a + b.goal, 0);
  const todayPosts = s.blogs.reduce((a, b) => a + postsOf(today, b.id).length, 0);
  const elapsed = roundDays(round).filter((d) => d <= today).length;
  const pct = goalDay ? Math.round((todayPosts / goalDay) * 100) : 0;
  const cumPos = s.blogs.reduce((a, b) => a + blogStats(b, round).posts, 0);
  const cumPct = Math.round((cumPos / Math.max(1, goalDay * Math.max(elapsed, 1))) * 100);
  const left = roundDays(round).filter((d) => d >= today).length;
  const aw = todayAwards(round);
  const pend = pendingCerts(round);

  const banner = certBanner(round);

  const award = (icon, label, r, unit) => `
    <div class="award-cell">
      <div class="a-ic">${icon}</div>
      <div class="a-lb">${label}</div>
      ${r ? `<div class="a-who">${esc(r.blog.emoji)} ${esc(r.blog.name)}</div><div class="a-val">${unit(r)}</div>`
      : '<div class="a-who" style="color:var(--muted)">아직 없음</div><div class="a-val" style="color:var(--muted)">—</div>'}
    </div>`;

  const chars = s.blogs.map((b) => {
    const g = growth(b, round);
    const st = blogStats(b, round);
    const n = postsOf(today, b.id).length;
    const p = Math.min(100, Math.round((n / b.goal) * 100));
    return `<div class="chr" data-blog="${b.id}">
      <div class="chr-top">
        <img class="chr-av" src="${b.avatar}" alt="">
        <div style="min-width:0;flex:1">
          <div class="nm">${esc(b.name)}</div>
          <div class="lv">Lv.${g.level}${g.streak ? ` · 🔥${g.streak}일` : ''}</div>
        </div>
        <div class="chr-x">${g.xp}<span>XP</span></div>
      </div>
      <div class="xpbar"><i style="width:${Math.round((g.inLevel / g.need) * 100)}%"></i></div>
      <div class="chr-foot">
        <span>오늘 ${n}/${b.goal} · 누적 ${st.posts}편</span>
      </div>
      <div class="chr-badges">${g.badges.length ? g.badges.map((x) => `<span title="${esc(x.t)}">${x.i}${x.t}</span>`).join('') : '<span style="color:var(--muted)">첫 달성을 노려봐요</span>'}</div>
    </div>`;
  }).join('');

  $('#view-home').innerHTML = `
    ${banner}
    <div class="sec">
      <div class="hero">
        <div class="hero-top">
          <div class="avatar">예</div>
          <div>
            <h2>${esc(s.blogs.length)}개 블로그 · ${esc(round.label)}</h2>
            <div class="hero-sub">${round.start_date.replace(/-/g, '.')} ~ ${round.end_date.replace(/-/g, '.')} · ${roundDays(round).length}일 챌린지</div>
          </div>
          <span class="round-chip">${esc(round.status)} · 남은 ${left}일</span>
        </div>
        <div class="hero-grid">
          <div class="hero-cell"><div class="k">오늘 포스팅</div><div class="v">${todayPosts}/${goalDay}편</div></div>
          <div class="hero-cell"><div class="k">오늘 달성률</div><div class="v">${pct}%</div></div>
          <div class="hero-cell"><div class="k">🏆 현재 1위</div><div class="v" style="font-size:15px">${top ? esc(top.blog.emoji + ' ' + top.blog.name) : '-'}</div></div>
          <div class="hero-cell"><div class="k">기수 전체 진행률</div><div class="v">${cumPct}%</div></div>
        </div>
        <div class="hero-bar"><i style="width:${pct}%"></i></div>
        <div class="hero-foot"><span>${today.replace(/-/g, '.')} (${DOW[dowOf(today)]}) ${kstClock()} 기준</span><span>누적 ${cumPos}편</span></div>
      </div>
    </div>

    <div class="sec card card-pad">
      <div class="sec-head"><h2>빠른 바로가기</h2><span class="sub">한 손으로 바로</span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <button class="btn soft" data-go="challenge">🏆<br>챌린지 현황</button>
        <button class="btn soft" data-go="materials">📰<br>오늘의 소재</button>
        <button class="btn soft" data-go="merge">🖼️<br>이미지 합성</button>
      </div>
      <button class="btn block" style="margin-top:10px" data-act="addtoday">✏️ 오늘 글 URL 등록</button>
    </div>

    <div class="sec card card-pad">
      <div class="sec-head"><h2>🎉 오늘의 시상식</h2><span class="sub">${today.replace(/-/g, '.')} 기준</span></div>
      <div class="award-grid">
        ${award('📝', '발행왕', aw.pub, (r) => r.posts + '편')}
        ${award('👀', '방문자 성장왕', aw.vis, (r) => '+' + nfmt(r.dViews))}
        ${award('💰', '수익왕', aw.rev, (r) => '+' + won(r.dRev))}
        ${award('🏆', '오늘 MVP', aw.mvp, (r) => nfmt(r.score) + '점')}
      </div>
      ${!aw.mvp ? '<p style="font-size:11.5px;color:var(--muted);margin-top:8px">오늘 기록이 쌓이면 시상식이 채워집니다.</p>' : ''}
    </div>

    <div class="sec card card-pad">
      <div class="sec-head"><h2>🧸 캐릭터 성장</h2><span class="sub">목표 달성하면 XP · 3일/7일/14일 연속 뱃지</span></div>
      <div class="chr-grid">${chars}</div>
    </div>

    <div class="sec card card-pad">
      <div class="sec-head"><h2>오늘 블로그별 진행</h2><span class="sub">${today.replace(/-/g, '.')}</span></div>
      ${s.blogs.map((b) => {
    const st = blogStats(b, round);
    const n = postsOf(today, b.id).length;
    const p = Math.min(100, Math.round((n / b.goal) * 100));
    const g = growth(b, round);
    return `<div class="drow">
      <div class="who"><img class="av av-img" src="${b.avatar}" alt="">
        <div style="min-width:0"><div class="nm">${esc(b.name)}</div>
          <div class="mini">${esc(b.topic)} · 오늘 ${n}/${b.goal} · ${g.streak ? '🔥' + g.streak + '일 연속 · ' : ''}누적 ${st.posts}편</div></div>
      </div>
      <div style="width:86px"><div class="bar"><i style="width:${p}%"></i></div></div>
      <div class="tiny-btn" data-act="addtoday" data-blog="${b.id}">+ 글</div>
    </div>`;
  }).join('')}
    </div>

    <div class="sec card card-pad">
      <div class="sec-head"><h2>오늘의 소재 미리보기</h2><span class="sub">1~5위</span>
        <button class="btn ghost sm spacer" data-go="materials">전체 보기</button></div>
      ${(s.materials && (s.materials.keywords || s.materials.main_inflow))
      ? matPreview()
      : '<div class="empty-note">아직 소재 데이터가 없습니다. 동기화를 한 번 실행해 주세요.</div>'}
    </div>

    ${recentCard(round)}
  `;
}

/* 지난 기록(리포트가 있는 날) — 챌린지 시작 전부터 쌓인 실제 수치 */
function recentCard(round) {
  const s = APP.state;
  const days = Object.keys(s.entries || {}).filter((d) => d < round.start_date).sort().slice(-4);
  if (!days.length) return '';
  const rows = days.map((d) => {
    let v = 0, r = 0, n = 0;
    for (const b of s.blogs) {
      const e = dayEntry(d, b.id);
      if (!e) continue;
      v += Number(e.views || 0); r += Number(e.revenue || 0); n += (e.posts || []).length;
    }
    return `<div class="drow"><div class="who"><div class="nm">${d.slice(5).replace('-', '.')} (${DOW[dowOf(d)]})</div>
      <div class="mini">${n ? n + '편 · ' : ''}방문 ${nfmt(v)}</div></div>
      <div class="money">${won(r)}</div></div>`;
  }).join('');
  return `<div class="sec card card-pad">
    <div class="sec-head"><h2>최근 기록</h2><span class="sub">예닝 오피스 리포트 · 챌린지 시작 전</span></div>
    ${rows}
    <p style="font-size:11px;color:var(--muted);margin-top:8px">챌린지 1기 전에 쌓인 실제 방문자·수익입니다. 달력에는 기수 기간만 표시돼요.</p>
  </div>`;
}

function matPreview() {
  const m = APP.state.materials || {};
  const rows = (m.main_inflow && m.main_inflow.rows) || [];
  if (!rows.length) return '<div class="empty-note">메인 유입 데이터가 비어 있어요.</div>';
  return rows.slice(0, 5).map((r, i) => `
    <div class="mat-item ${i === 0 ? 'top' : ''}">
      <div class="n">${r.rank || i + 1}</div>
      <div class="body"><div class="t">${esc(r.title)}</div>
        <div class="m"><span>${esc(r.blog || '')}</span><span>조회 ${nfmt(r.views)}</span></div></div>
    </div>`).join('');
}

/* ───────────────────────── 챌린지 현황 ───────────────────────── */
function renderChallenge() {
  const s = APP.state, round = activeRound();
  const days = roundDays(round);
  const today = kstDate();
  const ranks = rankAll(round);
  const sel = APP.ui.blog;
  const selBlog = s.blogs.find((b) => b.id === sel);
  const mode = APP.ui.rankMode || 'score';
  const growthRanks = rankByGrowth(round);

  const goalDay = s.blogs.reduce((a, b) => a + b.goal, 0);
  const todayPosts = s.blogs.reduce((a, b) => a + postsOf(today, b.id).length, 0);
  const scopePosts = sel === 'all' ? todayPosts : postsOf(today, sel).length;
  const scopeGoal = sel === 'all' ? goalDay : (selBlog ? selBlog.goal : 0);
  const pct = scopeGoal ? Math.round((scopePosts / scopeGoal) * 100) : 0;

  let doneAll = 0;
  for (const d of days) {
    if (sel === 'all') {
      const total = s.blogs.reduce((a, b) => a + (d <= today ? postsOf(d, b.id).length : 0), 0);
      const g = s.blogs.reduce((a, b) => a + (d <= today ? b.goal : 0), 0);
      if (g && total >= g) doneAll++;
    } else if (selBlog) {
      if (postsOf(d, selBlog.id).length >= selBlog.goal) doneAll++;
    }
  }
  const rankPos = sel === 'all' ? '-' : (ranks.find((r) => r.blog.id === sel) || {}).rank;
  const cumViews = sel === 'all'
    ? ranks.reduce((a, r) => a + r.views, 0)
    : (blogStats(selBlog, round).views);
  const cumRev = sel === 'all' ? ranks.reduce((a, r) => a + r.revenue, 0) : blogStats(selBlog, round).revenue;

  const chips = [`<button class="chip ${sel === 'all' ? 'on' : ''}" data-blog="all">전체 ${s.blogs.length}곳 합산</button>`]
    .concat(s.blogs.map((b) => `<button class="chip ${sel === b.id ? 'on' : ''}" data-blog="${b.id}">${b.emoji} ${esc(b.name)}<span class="n">${b.goal}</span></button>`))
    .join('');

  $('#view-challenge').innerHTML = `
    <div class="sec card card-pad">
      <div class="round-bar">
        <div class="sec-head" style="margin:0;flex:1"><h2>기수 선택</h2><span class="sub">1주 단위</span></div>
        ${s.rounds.map((r) => `<button class="round-chip ${r.id === round.id ? 'on' : ''}" data-round="${r.id}">${esc(r.label)} <span class="st">${esc(r.status)}</span></button>`).join('')}
      </div>
      <div class="round-meta">
        <span>📅 ${round.start_date.replace(/-/g, '.')} ~ ${round.end_date.replace(/-/g, '.')}</span>
        <span>${roundDays(round).length}일</span>
        <span>하루 목표 ${goalDay}편</span>
      </div>
    </div>

    ${certBanner(round)}

    <div class="sec card card-pad">
      <div class="chip-row">${chips}</div>
    </div>

    <div class="sec">
      <div class="hero">
        <div class="hero-top">
          <div class="avatar">${sel === 'all' ? '🏆' : (selBlog ? selBlog.emoji : '🏆')}</div>
          <div><h2>${sel === 'all' ? '전체 ' + s.blogs.length + '곳 합산' : esc(selBlog ? selBlog.name : '')}</h2>
            <div class="hero-sub">${sel === 'all' ? esc(round.label) + ' · 하루 ' + goalDay + '편' : esc(selBlog ? selBlog.topic : '') + ' · 하루 ' + scopeGoal + '편'}</div></div>
          <span class="round-chip">${esc(round.status)}</span>
        </div>
        <div class="hero-grid">
          <div class="hero-cell"><div class="k">오늘 포스팅</div><div class="v">${scopePosts}/${scopeGoal}편</div></div>
          <div class="hero-cell"><div class="k">달성률</div><div class="v">${pct}%</div></div>
          <div class="hero-cell"><div class="k">현재 랭킹</div><div class="v">${rankPos === '-' ? '—' : rankPos + '위'}</div></div>
          <div class="hero-cell"><div class="k">완료일</div><div class="v">${doneAll}/${days.length}일</div></div>
        </div>
        <div class="hero-bar"><i style="width:${pct}%"></i></div>
        <div class="hero-foot"><span>누적 방문 ${nfmt(cumViews)}</span><span>누적 수익 ${won(cumRev)}</span></div>
      </div>
    </div>

    <div class="sec">
      <div class="sec-head"><h2>🥇 블로그 ${s.blogs.length}곳 순위</h2>
        <div class="mode-tabs">
          <button class="${mode === 'score' ? 'on' : ''}" data-rmode="score">원본 점수</button>
          <button class="${mode === 'growth' ? 'on' : ''}" data-rmode="growth">성장률</button>
        </div>
      </div>
      ${mode === 'score' ? `
      <div class="card rank-wrap">
        <div class="rank-head">
          <div>순위</div><div>블로그</div><div>점수</div><div>주제</div>
          <div style="text-align:right">방문자(누적)</div><div style="text-align:right">수익(당일·누적)</div>
          <div style="text-align:center">완료일</div><div>진행률</div>
        </div>
        ${ranks.map((r) => rankRow(r, sel, today, days)).join('')}
      </div>
      <div class="rank-cards">${ranks.map((r) => rankCard(r, sel, today, days)).join('')}</div>
      <div class="card card-pad note-box">
        <div class="nb-t">강사님 원본 점수 기준</div>
        <div class="nb-b">
          글 1편 = <b>1,000점</b> (하루 10편까지 인정 → 하루 최대 10,000점)<br>
          방문자 증가 1명 = <b>1점</b>, 수익 증가 1원 = <b>1점</b><br>
          기준일(${round.start_date.replace(/-/g, '.')})의 방문자·수익을 baseline 으로 두고, 둘째 날부터 <b>전일 대비 늘어난 만큼</b>만 더합니다. 줄어든 날은 0점(감점 없음).
        </div>
      </div>` : `
      <div class="card rank-wrap">
        <div class="rank-head g">
          <div>순위</div><div>블로그</div><div>성장률</div><div>발행 달성률</div>
          <div style="text-align:right">방문자 증가</div><div style="text-align:right">수익 증가</div>
          <div style="text-align:center">연속</div><div>진행률</div>
        </div>
        ${growthRanks.map((r) => rankRowGrowth(r, sel, days)).join('')}
      </div>
      <div class="rank-cards">${growthRanks.map((r) => rankCardGrowth(r, sel, days)).join('')}</div>
      <div class="card card-pad note-box">
        <div class="nb-t">성장률 순위 — 신생 블로그도 공정하게</div>
        <div class="nb-b">
          성장률 = <b>발행 달성률 × 0.6</b> + <b>방문자 증가율 × 0.3</b> + <b>수익 증가율 × 0.1</b><br>
          발행 달성률 = 발행 편수 ÷ (하루 목표 × 경과일) · 방문자·수익 증가율은 기준일(${round.start_date.replace(/-/g, '.')}) 대비입니다.<br>
          각 항목은 0~300% 로 자른 뒤 합산합니다. 규모가 작은 블로그도 성장만 크면 1위가 될 수 있어요.
        </div>
      </div>`}
    </div>

    <div class="sec card card-pad">
      <div class="sec-head"><h2>🏁 기수 결산</h2><span class="sub">1주 단위 · 연장 가능</span></div>
      ${seasonHtml()}
    </div>

    <div class="sec card cal-card">
      <div class="cal-head">
        <h3>📅 챌린지 인증 달력</h3>
        <span class="sub" style="font-size:12px;color:var(--brown-2)">${sel === 'all' ? '전체 합산' : esc(selBlog ? selBlog.name : '')} · 날짜를 누르면 URL을 등록합니다</span>
        <div class="legend">
          <span><i style="background:#EAF3E6"></i>완료</span>
          <span><i style="background:#FFF3C4"></i>진행중</span>
          <span><i style="background:#F7E1E1"></i>미제출</span>
          <span><i style="background:#F4EDE7"></i>예정</span>
        </div>
      </div>
      <div style="padding:10px 12px 0"><div class="chip-row">${
        [`<button class="chip ${sel === 'all' ? 'on' : ''}" data-blog="all">전체 합산</button>`]
          .concat(s.blogs.map((b) => `<button class="chip ${sel === b.id ? 'on' : ''}" data-blog="${b.id}">${b.emoji} ${esc(b.name)}<span class="n">${b.goal}</span></button>`))
          .join('')}</div></div>
      ${calendarHtml(round, sel, selBlog)}
    </div>
  `;
}

function rankRow(r, sel, today, days) {
  const top = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank;
  const dayRev = days.includes(today) ? Number((dayEntry(today, r.blog.id) || {}).revenue || 0) : 0;
  const pctDone = Math.round((r.doneDays / days.length) * 100);
  return `<div class="rank-row ${sel === r.blog.id ? 'sel' : ''} ${r.rank <= 3 ? 'top' + r.rank : ''}" data-blog="${r.blog.id}">
    <div class="rk">${top}</div>
    <div class="who"><img class="av av-img" src="${r.blog.avatar}" alt="">
      <div style="min-width:0"><div class="nm">${esc(r.blog.name)}</div><div class="tp">@${esc(r.blog.handle)}</div></div></div>
    <div class="score">${nfmt(r.score)}</div>
    <div class="tp" style="font-size:11.5px;color:var(--muted)">${esc(r.blog.topic)}</div>
    <div class="num">${nfmt(r.views)}</div>
    <div class="money">${won(dayRev)} · ${won(r.revenue)}</div>
    <div class="num" style="text-align:center">${r.doneDays}/${days.length}${growth(r.blog, r_roundSafe()).streak ? ` <span style="color:var(--rose-dark)">🔥${growth(r.blog, r_roundSafe()).streak}</span>` : ''}</div>
    <div><div class="bar"><i style="width:${pctDone}%"></i></div><div class="bar-cap">${r.attain}%</div></div>
  </div>`;
}

function rankCard(r, sel, today, days) {
  const dayRev = Number((dayEntry(today, r.blog.id) || {}).revenue || 0);
  const pctDone = Math.round((r.doneDays / days.length) * 100);
  return `<div class="card card-pad ${sel === r.blog.id ? 'sel' : ''}" data-blog="${r.blog.id}" style="padding:13px 14px;cursor:pointer">
    <div style="display:flex;align-items:center;gap:9px">
      <div style="font-weight:800;color:var(--rose-dark);width:22px;text-align:center">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</div>
      <div class="who" style="flex:1"><img class="av av-img" src="${r.blog.avatar}" alt="">
        <div style="min-width:0"><div class="nm">${esc(r.blog.name)}</div><div class="tp">${esc(r.blog.topic)}</div></div></div>
      <div class="score">${nfmt(r.score)}점</div>
    </div>
    <div style="display:flex;gap:10px;font-size:11.5px;color:var(--brown-2);margin:9px 0 7px;flex-wrap:wrap">
      <span>방문 ${nfmt(r.views)}</span><span>수익 ${won(dayRev)}·${won(r.revenue)}</span><span>완료 ${r.doneDays}/${days.length}</span>
    </div>
    <div class="bar"><i style="width:${pctDone}%"></i></div>
  </div>`;
}

function rankRowGrowth(r, sel, days) {
  const top = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank;
  const gr = growth(r.blog, r_roundSafe(r));
  return `<div class="rank-row g ${sel === r.blog.id ? 'sel' : ''} ${r.rank <= 3 ? 'top' + r.rank : ''}" data-blog="${r.blog.id}">
    <div class="rk">${top}</div>
    <div class="who"><img class="av av-img" src="${r.blog.avatar}" alt="">
      <div style="min-width:0"><div class="nm">${esc(r.blog.name)}</div><div class="tp">@${esc(r.blog.handle)}</div></div></div>
    <div class="score">${r.g.score}%</div>
    <div class="num" style="text-align:left">${r.g.attain}% <span style="color:var(--muted)">(${r.g.posts}편)</span></div>
    <div class="num">${r.g.visG >= 0 ? '+' : ''}${r.g.visG}%</div>
    <div class="num">${r.g.revG >= 0 ? '+' : ''}${r.g.revG}%</div>
    <div class="num" style="text-align:center">${gr.streak ? '🔥' + gr.streak : '—'}</div>
    <div><div class="bar"><i style="width:${Math.min(100, Math.round(r.g.score / 3))}%"></i></div><div class="bar-cap">Lv.${gr.level}</div></div>
  </div>`;
}
function rankCardGrowth(r, sel, days) {
  const gr = growth(r.blog, r_roundSafe(r));
  return `<div class="card card-pad ${sel === r.blog.id ? 'sel' : ''}" data-blog="${r.blog.id}" style="padding:13px 14px;cursor:pointer">
    <div style="display:flex;align-items:center;gap:9px">
      <div style="font-weight:800;color:var(--rose-dark);width:22px;text-align:center">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</div>
      <div class="who" style="flex:1"><img class="av av-img" src="${r.blog.avatar}" alt="">
        <div style="min-width:0"><div class="nm">${esc(r.blog.name)}</div><div class="tp">Lv.${gr.level} · ${gr.streak ? '🔥' + gr.streak + '일' : '연속 없음'}</div></div></div>
      <div class="score">${r.g.score}%</div>
    </div>
    <div style="display:flex;gap:10px;font-size:11.5px;color:var(--brown-2);margin:9px 0 7px;flex-wrap:wrap">
      <span>발행 ${r.g.attain}%</span><span>방문 ${r.g.visG >= 0 ? '+' : ''}${r.g.visG}%</span><span>수익 ${r.g.revG >= 0 ? '+' : ''}${r.g.revG}%</span>
    </div>
    <div class="bar"><i style="width:${Math.min(100, Math.round(r.g.score / 3))}%"></i></div>
  </div>`;
}
function r_roundSafe() { return activeRound(); }

function seasonHtml() {
  const list = seasonHistory();
  return list.map(({ round, win, posts, ranked, active }) => {
    const top3 = ranked.slice(0, 3).map((x, i) => `<span class="pill ${i === 0 ? 'yellow' : 'line'}">${['🥇', '🥈', '🥉'][i]} ${esc(x.blog.name)}</span>`).join(' ');
    return `<div class="season-row">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b style="font-size:14px">${esc(round.label)}</b>
        <span class="pill line">${round.start_date.slice(5).replace('-', '.')} ~ ${round.end_date.slice(5).replace('-', '.')}</span>
        <span class="pill ${active ? 'dust' : 'ok'}">${active ? '진행 중' : '우승 확정'}</span>
        <span style="margin-left:auto;font-size:11.5px;color:var(--muted)">기수 누적 ${posts}편</span>
      </div>
      <div style="margin:8px 0 6px;font-size:12.5px;color:var(--brown-2)">
        ${win && win.st.score > 0
        ? `${active ? '현재 1위' : '🏆 우승'} <b>${esc(win.blog.emoji + ' ' + win.blog.name)}</b> · ${nfmt(win.st.score)}점`
        : '아직 기록이 없습니다 — 첫 글을 등록하면 순위가 시작됩니다.'}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${top3}</div>
    </div>`;
  }).join('') + `<p style="font-size:11px;color:var(--muted);margin-top:8px">기수를 연장하거나 새 기수를 추가하면 여기에 우승 기록이 차곡차곡 쌓입니다.</p>`;
}

function calendarHtml(round, sel, selBlog) {
  const days = roundDays(round);
  const months = [];
  for (const d of days) {
    const m = d.slice(0, 7);
    if (!months.includes(m)) months.push(m);
  }
  return months.map((m) => {
    const [y, mm] = m.split('-').map(Number);
    const first = new Date(Date.UTC(y, mm - 1, 1));
    const startDow = first.getUTCDay();
    const lastDay = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="day empty"></div>';
    for (let d = 1; d <= lastDay; d++) {
      const ds = `${m}-${String(d).padStart(2, '0')}`;
      const inRound = days.includes(ds);
      const dow = dowOf(ds);
      if (!inRound) {
        cells += `<div class="day plan" style="opacity:.35"><div class="dnum">${d}</div></div>`;
        continue;
      }
      cells += dayCell(ds, sel, selBlog);
    }
    return `<div style="padding:0 0 6px">
      <div style="padding:12px 14px 2px;font-weight:800;font-size:14px">${y}년 ${mm}월</div>
      <div class="cal-grid">
        ${['일', '월', '화', '수', '목', '금', '토'].map((x, i) => `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${x}</div>`).join('')}
        ${cells}
      </div></div>`;
  }).join('');
}

function dayCell(ds, sel, selBlog) {
  const s = APP.state;
  const blogs = sel === 'all' ? s.blogs : [selBlog];
  let goal = 0, n = 0, views = 0, rev = 0;
  const posts = [];
  for (const b of blogs) {
    const e = dayEntry(ds, b.id);
    if (e) {
      views += Number(e.views || 0); rev += Number(e.revenue || 0);
      (e.posts || []).forEach((p) => posts.push({ ...p, blog: b }));
    }
    goal += b.goal;
    n += (e && e.posts ? e.posts.length : 0);
  }
  const today = kstDate();
  let cls = 'plan', label = '예정';
  if (ds <= today) {
    if (goal && n >= goal) { cls = 'done'; label = '완료'; }
    else if (n > 0 || ds === today) { cls = 'prog'; label = '진행중'; }
    else { cls = 'miss'; label = '미제출'; }
  }
  const isToday = ds === today;
  const links = posts.slice(0, 3).map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(p.title || '')}">${esc(brandOfUrl(p.url))}</a>`).join('');
  const more = posts.length > 3 ? `<span style="font-size:9.5px;color:var(--muted)">+${posts.length - 3}</span>` : '';
  return `<div class="day ${cls} ${isToday ? 'today' : ''}" data-day="${ds}" role="button" tabindex="0">
    <div class="dnum">${Number(ds.slice(8))}${n ? `<span style="font-size:10px;font-weight:700;color:var(--rose-dark);margin-left:auto">👥${nfmt(views)}</span>` : ''}</div>
    ${rev ? `<div class="stat"><span class="v">${won(rev)}</span></div>` : ''}
    <div class="lnks">${links}${more}</div>
    <div class="badge">${cls === 'done' ? '미션 완료!' : n + '/' + goal}</div>
  </div>`;
}

function brandOfUrl(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, '');
    if (h.includes('blog.naver.com')) return 'blog.naver.com';
    return h + new URL(u).pathname.slice(0, 12);
  } catch { return 'link'; }
}

/* ───────────────────────── 오늘의 소재 ───────────────────────── */
const MAT_TABS = [
  ['main_inflow', '메인 유입'],
  ['keywords', '키워드'],
  ['ent', '연예 실시간'],
  ['community', '커뮤 베스트'],
  ['broadcast', '방송·경기'],
];

function matData(tab) {
  const m = APP.state.materials || {};
  const hist = APP.state.materials_history || {};
  const date = APP.ui.matDate;
  const cur = m.date || '';
  if (date && cur && date !== cur && hist[date]) return hist[date][tab] || null;
  return m[tab] || (hist[cur] ? (hist[cur][tab] || null) : null);
}

function renderMaterials() {
  const tab = APP.ui.matTab;
  const m = APP.state.materials || {};
  const dates = [m.date].concat(Object.keys(APP.state.materials_history || {}).filter(Boolean))
    .filter(Boolean).filter((d, i, a) => a.indexOf(d) === i).sort().reverse();
  const date = APP.ui.matDate && (APP.ui.matDate === m.date || dates.includes(APP.ui.matDate)) ? APP.ui.matDate : (m.date || kstDate());

  $('#view-materials').innerHTML = `
    <div class="sec">
      <div class="hero" style="padding:18px 20px">
        <div class="hero-top">
          <div class="avatar">📰</div>
          <div><h2>오늘의 소재</h2>
            <div class="hero-sub">실시간 랭킹 · 커뮤니티 베스트 · 메인 유입 · 주제별 키워드를 한자리에</div></div>
        </div>
      </div>
    </div>

    <div class="sec"><div class="mat-tabs" id="matTabs">
      ${MAT_TABS.map(([k, v]) => `<button class="${tab === k ? 'on' : ''}" data-mtab="${k}">${v}</button>`).join('')}
    </div></div>

    <div class="sec card card-pad" style="padding:12px 14px">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="icon-btn" data-mdate="-1">‹</button>
        <div style="flex:1;text-align:center;font-weight:800">${date.replace(/-/g, '.')} (${DOW[dowOf(date)]}) 브리핑</div>
        <button class="icon-btn" data-mdate="1">›</button>
      </div>
    </div>

    ${matBody(tab, date)}
  `;
}

function matBody(tab, date) {
  const d = matData(tab);
  if (!d || !((d.rows || []).length || (d.topics || []).length)) {
    return `<div class="sec card"><div class="empty-note">이 날짜의 자료가 아직 없습니다.<br>동기화를 실행하면 채워집니다.</div></div>`;
  }
  const note = d.source ? `<div class="sec mat-note">${esc(d.source)}${d.collected_at ? ' · 수집 ' + esc(d.collected_at.replace('T', ' ').slice(5, 16)) : ''}</div>` : '';

  if (tab === 'keywords') {
    const topics = d.topics || [];
    const chips = [`<button class="chip ${APP.ui.topic === 'all' ? 'on' : ''}" data-topic="all">전체</button>`]
      .concat(topics.map((t) => `<button class="chip ${APP.ui.topic === t.id ? 'on' : ''}" data-topic="${t.id}">${esc(t.name)}</button>`)).join('');
    const shown = APP.ui.topic === 'all' ? topics : topics.filter((t) => t.id === APP.ui.topic);
    const boxes = shown.map((t) => `
      <div class="kw-box">
        <h4>${esc(t.name)} <span class="pill line" style="font-size:10px">검색량순 1~${t.rows.length}</span></h4>
        <ol>${t.rows.map((r) => {
      const dl = r.delta == null ? '' : (r.delta > 0 ? `<span class="dl up">▲${r.delta}</span>` : r.delta < 0 ? `<span class="dl down">▼${-r.delta}</span>` : '<span class="dl" style="color:#B9A79E">–</span>');
      const key = 'kw:' + date + ':' + r.kw;
      const on = !!APP.state.picks[key];
      return `<li><span class="r">${r.rank}</span>
            <a class="kw" href="https://search.naver.com/search.naver?query=${encodeURIComponent(r.kw)}" target="_blank" rel="noopener">${esc(r.kw)}</a>
            <span class="vol">${nfmt(r.vol)}</span>${dl}
            <button class="tiny-btn ${on ? '' : ''}" data-pick="${esc(key)}" style="${on ? 'background:var(--rose);color:#fff' : ''}">${on ? '쓸게요' : '+'}</button>
          </li>`;
    }).join('')}</ol>
      </div>`).join('');
    return `${note}<div class="sec"><div class="chip-row">${chips}</div></div>
      <div class="kw-grid">${boxes}</div>`;
  }

  const rows = d.rows || [];
  return `${note}
    <div class="sec mat-list">
      ${rows.map((r, i) => {
    const key = esc(tab + ':' + date + ':' + (r.url || r.title));
    const on = !!APP.state.picks[key];
    const q = r.url && /^https?:/.test(r.url) ? r.url : 'https://search.naver.com/search.naver?query=' + encodeURIComponent(r.title);
    const meta = [];
    if (r.blog) meta.push(r.blog);
    if (r.views != null && r.blog) meta.push('조회 ' + nfmt(r.views));
    if (r.src) meta.push(r.src);
    if (r.at) meta.push(String(r.at).slice(5, 16).replace('T', ' '));
    return `<div class="mat-item ${i < 3 ? 'top' : ''}">
        <div class="n">${r.rank || i + 1}</div>
        <div class="body">
          <a class="t" href="${esc(q)}" target="_blank" rel="noopener">${esc(r.title)}</a>
          <div class="m">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
        </div>
        <button class="go ${on ? 'on' : ''}" data-pick="${key}">${on ? '쓸게요 ✓' : '쓸게요'}</button>
      </div>`;
  }).join('')}
    </div>`;
}

/* ───────────────────────── 시트 ───────────────────────── */
function openSheet(title, bodyHtml, footHtml) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = bodyHtml;
  const foot = $('#sheetFoot');
  if (footHtml) { foot.innerHTML = footHtml; foot.classList.remove('hidden'); }
  else { foot.innerHTML = ''; foot.classList.add('hidden'); }
  $('#sheet').classList.add('on'); $('#sheetBack').classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').classList.remove('on'); $('#sheetBack').classList.remove('on');
  document.body.style.overflow = '';
}

/* 날짜 상세 → 블로그별 등록 상태 + 방문자·수익 바로 입력 */
function openDay(date) {
  const s = APP.state;
  const sel = APP.ui.blog;
  const blogs = sel === 'all' ? s.blogs : s.blogs.filter((b) => b.id === sel);
  const rows = blogs.map((b) => {
    const e = dayEntry(date, b.id) || { posts: [], views: 0, revenue: 0 };
    const posts = e.posts || [];
    return `<div class="drow" style="align-items:flex-start">
      <div class="who"><img class="av av-img" src="${b.avatar}" alt="">
        <div style="min-width:0;flex:1">
          <div class="nm">${esc(b.name)} <span class="pill ${posts.length >= b.goal ? 'ok' : 'line'}" style="font-size:10px">${posts.length}/${b.goal}</span></div>
          ${posts.map((p) => `<div class="mini" style="display:flex;gap:6px;align-items:center">
            <a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:#8A6A5D;text-decoration:underline;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${esc(p.title || p.url)}</a>
            <button class="tiny-btn danger" data-del="${b.id}|${date}|${esc(p.url)}">삭제</button></div>`).join('')}
          <div style="display:flex;gap:5px;margin-top:6px;align-items:center">
            <input class="mini-input" data-dv="${b.id}" type="number" inputmode="numeric" placeholder="방문자" value="${e.views || ''}">
            <input class="mini-input" data-dr="${b.id}" type="number" inputmode="numeric" placeholder="수익" value="${e.revenue || ''}">
            <button class="tiny-btn" data-adday="${b.id}|${date}">+ URL</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  openSheet(`${date.replace(/-/g, '.')} (${DOW[dowOf(date)]}) 인증`,
    `<div id="dayRows">${rows}</div>
     <p style="font-size:11px;color:var(--muted);margin-top:8px">방문자·수익을 고치고 아래 저장을 누르면 바로 반영됩니다.</p>`,
    `<button class="btn block" id="daySave">${sel === 'all' ? '방문자·수익 저장' : '저장'}</button>
     <button class="btn soft block" style="margin-top:6px" data-adday="${sel === 'all' ? (s.blogs[0] || {}).id : sel}|${date}">+ 글 URL 등록</button>`);

  $('#daySave').onclick = () => {
    $$('[data-dv]').forEach((inp) => {
      const bid = inp.dataset.dv;
      const rInp = $(`[data-dr="${bid}"]`);
      const e = ensureEntry(date, bid);
      e.views = Number(inp.value || 0);
      e.revenue = Number((rInp || {}).value || 0);
      e.ts = Date.now();
    });
    saveLocal(); queuePush(); closeSheet(); renderAll(); toast('저장했어요');
  };
}

/** 이미 등록된 URL 인지 (기수 전체 · 블로그 무관 중복 차단) */
function findUrl(url) {
  const norm = (u) => String(u || '').split('?')[0].replace(/\/$/, '');
  const target = norm(url);
  for (const [date, day] of Object.entries(APP.state.entries || {})) {
    for (const [bid, e] of Object.entries(day)) {
      for (const p of (e.posts || [])) {
        if (norm(p.url) === target) return { date, bid, post: p };
      }
    }
  }
  return null;
}

function ensureEntry(date, bid) {
  const s = APP.state;
  s.entries[date] = s.entries[date] || {};
  const e = s.entries[date][bid] || { views: 0, revenue: 0, memo: '', posts: [] };
  e.posts = e.posts || [];
  s.entries[date][bid] = e;
  return e;
}

/* URL 등록 시트 — 모바일 한 손 UX */
function openAdd(blogId, date) {
  const s = APP.state;
  const today = kstDate();
  const d = date || (APP.ui.day || today);
  const preselect = blogId || (APP.ui.blog !== 'all' ? APP.ui.blog : (s.blogs[0] && s.blogs[0].id));
  openSheet('글 URL 등록', `
    <div class="field">
      <label>블로그</label>
      <div class="blog-pick" id="pickBlogs">
        ${s.blogs.map((b) => `<button data-pb="${b.id}" class="${b.id === preselect ? 'on' : ''}"><b>${b.emoji}</b>${esc(b.name)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>발행일</label>
      <input id="addDate" type="date" value="${d}" max="${today}">
      <div class="hint">글을 <b>발행한 날</b>로 기록합니다 · 인증 기한은 <b>다음 날 23:59</b>까지</div>
    </div>
    <div class="field">
      <label>글 URL</label>
      <div style="display:flex;gap:6px">
        <input id="addUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://blog.naver.com/..." style="flex:1">
        <button class="btn soft sm" id="btnPaste" style="flex:0 0 auto">붙여넣기</button>
      </div>
      <div class="hint">주소만 넣어도 됩니다 · 제목은 비워두면 주소로 표시</div>
    </div>
    <div class="field">
      <label>제목 (선택)</label>
      <input id="addTitle" type="text" placeholder="글 제목">
    </div>
    <div class="field">
      <label>URL 여러 개 한꺼번에 (선택)</label>
      <textarea id="addBulk" rows="3" placeholder="주소를 한 줄에 하나씩 붙여넣기" style="resize:vertical"></textarea>
      <div class="hint">한 줄에 URL 하나 · 위 입력칸이 비어 있을 때 사용됩니다</div>
    </div>
    <div class="field-row">
      <div class="field"><label>방문자 (선택)</label><input id="addViews" type="number" inputmode="numeric" placeholder="0"></div>
      <div class="field"><label>수익 (선택)</label><input id="addRev" type="number" inputmode="numeric" placeholder="0"></div>
    </div>
  `, `<button class="btn block" id="btnAddSave">저장하기</button>`);

  $('#pickBlogs').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pb]'); if (!b) return;
    $$('#pickBlogs button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  });

  $('#btnPaste').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { $('#addUrl').value = t.trim(); toast('붙여넣었어요'); }
      else toast('클립보드가 비어 있어요');
    } catch { toast('붙여넣기가 막혀 있어요 · 직접 입력해 주세요'); }
  };

  $('#btnAddSave').onclick = () => {
    const bid = $('#pickBlogs .on') ? $('#pickBlogs .on').dataset.pb : preselect;
    const bulk = ($('#addBulk').value || '').split(/[\n\s]+/).map((s) => s.trim()).filter(Boolean);
    let url = ($('#addUrl').value || '').trim();
    const list = bulk.length && !url ? bulk : (url ? [url] : []);
    if (!list.length) { toast('글 URL을 넣어 주세요'); return; }
    const date2 = $('#addDate').value || d;
    const e = ensureEntry(date2, bid);
    let added = 0, dup = 0;
    for (let u of list) {
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      const found = findUrl(u);
      if (found) { dup++; continue; }
      e.posts.push({
        url: u,
        title: (list.length === 1 ? ($('#addTitle').value || '').trim() : '') || u.replace(/^https?:\/\//, ''),
        at: new Date().toISOString(),
        src: 'manual',
      });
      added++;
    }
    if (!added) { toast(dup ? '이미 등록된 URL이에요 (같은 기수·블로그 중복 불가)' : 'URL을 확인해 주세요'); return; }
    const v = Number($('#addViews').value || 0), r = Number($('#addRev').value || 0);
    if (v) e.views = v;
    if (r) e.revenue = r;
    e.ts = Date.now();
    saveLocal(); queuePush();
    closeSheet(); renderAll();
    const bname = (s.blogs.find((b) => b.id === bid) || {}).name || '';
    const left = fmtLeft(certDeadline(date2) - Date.now());
    toast(`${bname} · ${added}편 저장${dup ? ` (중복 ${dup}건 제외)` : ''} · 인증 마감 ${left}`);
  };
}

function openSettings() {
  const k = APP.sync.key || '';
  openSheet('동기화 설정', `
    <div class="field">
      <label>실시간 동기화</label>
      <div class="card card-pad" style="padding:12px;background:var(--cream)">
        <div style="font-size:12.5px;line-height:1.6">
          상태: <b id="stTxt">${APP.sync.status === 'ok' ? '연결됨' : APP.sync.key ? '확인 중' : '꺼짐'}</b><br>
          마지막 동기화: <b>${APP.sync.last ? APP.sync.last.replace('T', ' ').slice(0, 16) : '—'}</b><br>
          기기: <b>${esc(DEVICE)}</b>
        </div>
      </div>
    </div>
    <div class="field">
      <label>동기화 키</label>
      <input id="syncKeyInput" type="text" autocomplete="off" spellcheck="false" placeholder="32자리 키" value="${esc(k)}">
      <div class="hint">폰과 PC가 같은 키를 쓰면 서로 바로 반영됩니다. 링크에 <code>#k=</code>가 붙어 있으면 자동으로 들어옵니다.</div>
    </div>
    <div class="field">
      <label>기기 이름</label>
      <input id="devName" type="text" value="${esc(DEVICE)}">
    </div>
    <div class="field">
      <label>데이터</label>
      <button class="btn soft block" id="btnExport">내 기록 JSON 내려받기</button>
      <div class="hint" style="margin-top:6px">글·방문자·수익 기록이 이 기기에도 저장됩니다. 동기화가 끊겨도 남아요.</div>
    </div>
  `, `<button class="btn block" id="btnSyncSave">저장하고 지금 동기화</button>`);

  $('#btnSyncSave').onclick = async () => {
    const nk = ($('#syncKeyInput').value || '').trim();
    const dn = ($('#devName').value || '').trim();
    if (dn) LS.set('yc.device', dn);
    if (nk !== APP.sync.key) {
      APP.sync.key = nk; LS.set('yc.key', nk); APP.sync.rev = 0;
    }
    closeSheet();
    if (nk) { const merged = await syncPull(); if (merged) await syncPush(); else await syncPush(); toast('동기화했어요'); }
    else setSync('off', '동기화 꺼짐');
    renderAll();
  };
  $('#btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(APP.state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'yening-challenge-' + kstDate() + '.json';
    a.click();
    toast('내려받았어요');
  };
}

/* ───────────────────────── 저장 ───────────────────────── */
function saveLocal() { LS.set('yc.state', APP.state); }

function renderAll() {
  if (!APP.state) return;
  const tab = APP.ui.tab;
  if (tab === 'home') renderHome();
  if (tab === 'challenge') renderChallenge();
  if (tab === 'materials') renderMaterials();
  if (tab === 'merge') { /* 정적 */ }
  $('#nav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
}

/* ───────────────────────── 이벤트 ───────────────────────── */
function bindEvents() {
  document.addEventListener('click', (ev) => {
    const t = ev.target;

    if (t.closest('.day a')) return;      // 달력 안의 글 링크는 그대로 열기

    const goBtn = t.closest('[data-go]');
    if (goBtn) { switchTab(goBtn.dataset.go); return; }

    const navBtn = t.closest('#nav button');
    if (navBtn) { switchTab(navBtn.dataset.tab); return; }

    const chip = t.closest('[data-blog]');
    if (chip && !t.closest('[data-adday]')) {
      APP.ui.blog = chip.dataset.blog;
      if (APP.ui.tab !== 'challenge') switchTab('challenge');
      else renderChallenge();
      return;
    }

    const rbtn = t.closest('[data-round]');
    if (rbtn) { APP.state.active_round = rbtn.dataset.round; saveLocal(); queuePush(); renderAll(); return; }

    const dayBtn = t.closest('[data-day]');
    if (dayBtn) { APP.ui.day = dayBtn.dataset.day; openDay(dayBtn.dataset.day); return; }

    const addDay = t.closest('[data-adday]');
    if (addDay) {
      const [bid, date] = addDay.dataset.adday.split('|');
      closeSheet(); setTimeout(() => openAdd(bid, date), 120); return;
    }

    const addToday = t.closest('[data-act="addtoday"]');
    if (addToday) {
      const b = addToday.dataset.blog;
      openAdd(b || (APP.ui.blog !== 'all' ? APP.ui.blog : null), kstDate()); return;
    }

    const del = t.closest('[data-del]');
    if (del) {
      const [bid, date, url] = del.dataset.del.split('|');
      const enc = ensureEntry(date, bid);
      enc.posts = enc.posts.filter((p) => p.url !== url);
      enc.ts = Date.now();
      saveLocal(); queuePush(); openDay(date); renderAll(); toast('삭제했어요');
      return;
    }

    const mtab = t.closest('[data-mtab]');
    if (mtab) { APP.ui.matTab = mtab.dataset.mtab; renderMaterials(); return; }

    const md = t.closest('[data-mdate]');
    if (md) { /* 날짜 이동: 보관된 날짜로만 */ moveMatDate(Number(md.dataset.mdate)); return; }

    const rm = t.closest('[data-rmode]');
    if (rm) { APP.ui.rankMode = rm.dataset.rmode; renderChallenge(); return; }

    const tp = t.closest('[data-topic]');
    if (tp) { APP.ui.topic = tp.dataset.topic; renderMaterials(); return; }

    const pick = t.closest('[data-pick]');
    if (pick) {
      const k = pick.dataset.pick;
      APP.state.picks[k] = !APP.state.picks[k];
      if (!APP.state.picks[k]) delete APP.state.picks[k];
      saveLocal(); queuePush(); renderMaterials(); return;
    }
  });

  $('#sheetBack').onclick = closeSheet;
  $('#sheetClose').onclick = closeSheet;
  $('#btnSettings').onclick = openSettings;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
}

function moveMatDate(delta) {
  const m = APP.state.materials || {};
  const dates = [m.date].concat(Object.keys(APP.state.materials_history || {}))
    .filter(Boolean).filter((d, i, a) => a.indexOf(d) === i).sort();
  if (!dates.length) return;
  const cur = APP.ui.matDate && dates.includes(APP.ui.matDate) ? APP.ui.matDate : (m.date || dates[dates.length - 1]);
  const i = dates.indexOf(cur);
  const next = dates[Math.min(dates.length - 1, Math.max(0, i + delta))];
  APP.ui.matDate = next;
  renderMaterials();
}

function switchTab(tab) {
  APP.ui.tab = tab;
  $$('main .view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + tab));
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'merge') mgRedraw();
}

/* ───────────────────────── 이미지 합성 ───────────────────────── */
const MG = {
  L: { img: null, zoom: 1, x: 0, y: 0 },
  R: { img: null, zoom: 1, x: 0, y: 0 },
  side: 'L',
  size: [1200, 800],
  line: true,
};

function mgLoadFile(file, side) {
  if (!file || !/^image\//.test(file.type)) { toast('이미지 파일이 아닙니다'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    MG[side].img = img; MG[side].zoom = 1; MG[side].x = 0; MG[side].y = 0;
    const drop = $(side === 'L' ? '#dropL' : '#dropR');
    drop.innerHTML = `<img class="thumb" src="${url}" alt=""><div class="s">${file.name} · ${img.width}×${img.height}</div>`;
    mgRedraw();
  };
  img.src = url;
}

function mgDrawSide(ctx, side, dx, dy, dw, dh) {
  const st = MG[side];
  if (!st.img) {
    ctx.fillStyle = '#F4EDE7'; ctx.fillRect(dx, dy, dw, dh);
    ctx.fillStyle = '#C3AFA6';
    ctx.font = `700 ${Math.round(dw * 0.055)}px Pretendard, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(side === 'L' ? '왼쪽 사진' : '오른쪽 사진', dx + dw / 2, dy + dh / 2);
    return;
  }
  const img = st.img;
  const scale = Math.max(dw / img.width, dh / img.height) * st.zoom;
  const w = img.width * scale, h = img.height * scale;
  const cx = dx + dw / 2 + (st.x / 100) * dw;
  const cy = dy + dh / 2 + (st.y / 100) * dh;
  ctx.save();
  ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}

function mgRedraw() {
  const cvs = $('#mgCanvas'); if (!cvs) return;
  const [W, H] = MG.size;
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  const half = W / 2;
  mgDrawSide(ctx, 'L', 0, 0, half, H);
  mgDrawSide(ctx, 'R', half, 0, half, H);
  if (MG.line) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(half - Math.max(2, W * 0.004), 0, Math.max(4, W * 0.008), H);
  }
}

function mgBind() {
  ['L', 'R'].forEach((side) => {
    const drop = $(side === 'L' ? '#dropL' : '#dropR');
    drop.addEventListener('click', () => {
      MG.side = side;
      const picker = $('#filePicker');
      picker.value = '';
      picker.onchange = () => { if (picker.files[0]) mgLoadFile(picker.files[0], side); };
      picker.click();
    });
    drop.addEventListener('mouseenter', () => { MG.side = side; });
    ['dragover', 'dragenter'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const f = ev.dataTransfer.files[0];
      if (f) mgLoadFile(f, side);
    });
    const z = $(side === 'L' ? '#zoomL' : '#zoomR');
    const zl = $(side === 'L' ? '#zoomLv' : '#zoomRv');
    z.addEventListener('input', () => {
      MG[side].zoom = Number(z.value);
      zl.textContent = Math.round(MG[side].zoom * 100) + '%';
      mgRedraw();
    });
    const px = $(side === 'L' ? '#posXL' : '#posXR');
    const py = $(side === 'L' ? '#posYL' : '#posYR');
    px.addEventListener('input', () => { MG[side].x = Number(px.value); mgRedraw(); });
    py.addEventListener('input', () => { MG[side].y = Number(py.value); mgRedraw(); });
    $(side === 'L' ? '#resetL' : '#resetR').onclick = () => {
      MG[side].zoom = 1; MG[side].x = 0; MG[side].y = 0;
      z.value = 1; px.value = 0; py.value = 0; zl.textContent = '100%';
      mgRedraw();
    };
  });

  $('#mgSize').addEventListener('change', (e) => {
    MG.size = e.target.value.split('x').map(Number);
    mgRedraw();
  });
  $('#mgLine').addEventListener('change', (e) => { MG.line = e.target.checked; mgRedraw(); });
  $('#mgClear').onclick = () => {
    MG.L = { img: null, zoom: 1, x: 0, y: 0 }; MG.R = { img: null, zoom: 1, x: 0, y: 0 };
    $('#dropL').innerHTML = '<div class="ic">🖼️</div><div class="t">왼쪽 사진</div><div class="s">클릭 · 끌어다 놓기 · 붙여넣기(Ctrl+V)</div>';
    $('#dropR').innerHTML = '<div class="ic">🖼️</div><div class="t">오른쪽 사진</div><div class="s">클릭 · 끌어다 놓기 · 붙여넣기(Ctrl+V)</div>';
    mgRedraw();
  };
  $('#mgSavePng').onclick = () => mgSave('image/png', 'png');
  $('#mgSaveJpg').onclick = () => mgSave('image/jpeg', 'jpg');

  // 캔버스 드래그로 위치 미세조정
  const cvs = $('#mgCanvas');
  let drag = null;
  cvs.addEventListener('pointerdown', (e) => {
    const r = cvs.getBoundingClientRect();
    const relX = (e.clientX - r.left) / r.width;
    const side = relX < 0.5 ? 'L' : 'R';
    MG.side = side;
    drag = { side, x: e.clientX, y: e.clientY, ox: MG[side].x, oy: MG[side].y };
    cvs.setPointerCapture(e.pointerId);
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = cvs.getBoundingClientRect();
    const dx = ((e.clientX - drag.x) / r.width) * 100;
    const dy = ((e.clientY - drag.y) / r.height) * 100;
    MG[drag.side].x = Math.max(-50, Math.min(50, drag.ox + dx));
    MG[drag.side].y = Math.max(-50, Math.min(50, drag.oy + dy));
    const px = $(drag.side === 'L' ? '#posXL' : '#posXR');
    const py = $(drag.side === 'L' ? '#posYL' : '#posYR');
    px.value = MG[drag.side].x; py.value = MG[drag.side].y;
    mgRedraw();
  });
  cvs.addEventListener('pointerup', () => { drag = null; });
  cvs.addEventListener('pointercancel', () => { drag = null; });

  // Ctrl+V 붙여넣기 — 마지막으로 만진 쪽에 들어간다
  window.addEventListener('paste', (e) => {
    if (APP.ui.tab !== 'merge') return;
    const items = (e.clipboardData || {}).items || [];
    for (const it of items) {
      if (it.type.indexOf('image') === 0) {
        const f = it.getAsFile();
        if (f) { mgLoadFile(f, MG.side); e.preventDefault(); }
        return;
      }
    }
  });
}

function mgSave(type, ext) {
  const cvs = $('#mgCanvas');
  cvs.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yeb-merge-${kstDate()}-${Date.now().toString().slice(-4)}.${ext}`;
    a.click();
    toast(ext.toUpperCase() + ' 저장했어요');
  }, type, 0.92);
}

/* ───────────────────────── 잠금 / 부팅 ───────────────────────── */
let pinBuf = '';
function paintPin() {
  $$('#pinDots i').forEach((d, i) => d.classList.toggle('on', i < pinBuf.length));
}
async function tryUnlock(pin) {
  try {
    const st = await decryptEnvelope(APP.built, pin);
    return st;
  } catch { return null; }
}

function openApp(state) {
  APP.pin = pinBuf;
  APP.state = state;
  LS.set('yc.pin', pinBuf);
  saveLocal();
  $('#lock').classList.add('hidden');
  $('#app').classList.remove('hidden');
  APP.ui.round = (activeRound() || {}).id;
  bindEvents(); mgBind(); mgRedraw();
  switchTab('home');
  // 원격 동기화
  syncPull(true).then(async (needPush) => {
    if (needPush) await syncPush();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && APP.sync.key) syncPull(true);
  }, 12000);
  setInterval(() => {
    document.querySelectorAll('.live-left').forEach((el) => {
      const left = Number(el.dataset.left) - (Date.now() - Number(el.dataset.ts));
      el.textContent = fmtLeft(left);
      el.style.color = left < 3 * 3600e3 ? '#B05A5A' : 'var(--brown)';
    });
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && APP.sync.key) syncPull(true);
  });
}

async function boot() {
  try {
    const pub = await (await fetch('data/public.json', { cache: 'no-store' })).json();
    APP.public = pub;
    APP.sync.url = (pub.supabase_url || '').replace(/\/$/, '');
    APP.sync.anon = pub.supabase_anon || '';
  } catch (e) { console.warn('public.json', e); }

  APP.built = await (await fetch('data/challenge_data.json', { cache: 'no-store' })).json();

  // URL 해시의 동기화 키
  const hash = location.hash || '';
  const m = hash.match(/k=([0-9a-fA-F]{8,})/);
  if (m) {
    LS.set('yc.key', m[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
  APP.sync.key = LS.get('yc.key', '');

  const savedPin = LS.get('yc.pin', '');
  if (savedPin) {
    const st = await tryUnlock(savedPin);
    if (st) {
      pinBuf = savedPin;
      const cached = LS.get('yc.state', null);
      openApp(cached ? mergeStates(cached, st) : st);
      return;
    }
    LS.del('yc.pin');
  }
  $('#lock').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  $('#keypad').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'clear') { pinBuf = ''; paintPin(); return; }
    if (k === 'back') { pinBuf = pinBuf.slice(0, -1); paintPin(); return; }
    if (pinBuf.length >= 4) return;
    pinBuf += k; paintPin();
    if (pinBuf.length === 4) {
      const st = await tryUnlock(pinBuf);
      if (st) {
        $('#lockMsg').textContent = '';
        const cached = LS.get('yc.state', null);
        openApp(cached ? mergeStates(cached, st) : st);
      } else {
        $('#lockMsg').textContent = 'PIN이 맞지 않아요';
        pinBuf = ''; paintPin();
        setTimeout(() => { $('#lockMsg').textContent = ''; }, 1800);
      }
    }
  });
  boot();
});
