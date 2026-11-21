/* 예브 챌린지 — 앱 (PIN 잠금 · 챌린지 현황 · 오늘의 소재 · 이미지 합성 · 실시간 동기화) */
'use strict';

/* ───────────────────────── 기본 유틸 ───────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* 🚨 고소·저작권 주의 대상(assets/blocklist.js) — 제목·원고·소재 어디든 같은 규칙으로 검사 */
const ycScan = (t) => (window.ycBlockScan ? window.ycBlockScan(t) : []);
const ycLabels = (h) => (window.ycBlockLabels ? window.ycBlockLabels(h) : '');
/* ⚠️ 소프트 주의(이정후) — 막지 않고 노란 배지만 */
const ycSoft = (t) => (window.ycSoftScan ? window.ycSoftScan(t) : []);
const ycSoftBox = (h, o) => (window.ycSoftBanner ? window.ycSoftBanner(h, o) : '');
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
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), ms || 2200);
}

/* ───────────────────────── 클립보드 (모바일·구형 브라우저 대응) ───────────────────────── */
function copyByTextarea(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
}

/* 클립보드에 넣기 — 성공 여부를 Promise<boolean>으로 돌려준다 */
function copyText(text) {
  const txt = String(text == null ? '' : text).trim();
  if (!txt) return Promise.resolve(false);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(() => true, () => copyByTextarea(txt));
    }
  } catch (e) { /* 아래 textarea 방식 */ }
  return Promise.resolve(copyByTextarea(txt));
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
  config: null,   // 빌드본(복호화) — 블로그 목록·목표는 항상 이쪽을 따른다
  ui: { tab: 'home', round: null, blog: 'all', matTab: 'main_inflow', matDate: kstDate(), topic: 'all', thTopic: 'all' },
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
      APP.state = mergeStates(APP.state, remote, APP.config);
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
function mergeStates(local, incoming, cfg) {
  const out = JSON.parse(JSON.stringify(incoming || {}));
  out.entries = out.entries || {};
  out.picks = Object.assign({}, (incoming || {}).picks || {});
  const l = local || {};
  // 설정류(블로그 목록·목표·기수)는 항상 config(빌드본)를 따른다
  const C = cfg || incoming || {};
  out.rounds = (C && C.rounds) || l.rounds;
  out.blogs = (C && C.blogs) || l.blogs;
  out.active_round = (C && C.active_round) || l.active_round;

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

  // 지운 글(tombstone) 합치기 — 최신 삭제 시각 유지
  const rm = Object.assign({}, (incoming || {}).removed || {});
  for (const [u, ts] of Object.entries(l.removed || {})) rm[u] = Math.max(Number(rm[u] || 0), Number(ts || 0));
  out.removed = rm;
  for (const day of Object.values(out.entries)) {
    for (const e of Object.values(day)) {
      if (e.posts) e.posts = e.posts.filter((p) => !rm[p.url]);
    }
  }
  // 브라우저에서 새로고침한 실시간 소재 — 탭별로 더 최근 것만 남긴다
  const lm = Object.assign({}, out.liveMaterials || {});
  for (const [k, v] of Object.entries(l.liveMaterials || {})) {
    const o = lm[k];
    if (!o || String((v && v.collected_at) || '') >= String((o && o.collected_at) || '')) lm[k] = v;
  }
  out.liveMaterials = lm;

  // 오늘의 소재·키워드 자료는 배포본(빌드)을 따른다 — 매일 sync_challenge 로 갱신되는 값이라
  // 원격 스냅샷에 남은 옛 소재가 새 배포를 가리지 않게 한다.
  const cm = (C && C.materials) || null;
  if (cm) {
    out.materials = cm;
    if (C.materials_history) out.materials_history = C.materials_history;
  } else {
    if (!out.materials) out.materials = l.materials || {};
    if (!out.materials_history) out.materials_history = l.materials_history || {};
  }
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

/** 기수 시작 전날의 확정 기록 — 1기 첫날 증가분의 baseline (없으면 null)
 *  기수 달력에는 안 보이는 날이라 앱에서 직접 넣을 수 없어서, 동기화기가 넣어 둔 값을 읽는다. */
function baseEntry(round, blogId) {
  if (!round || !blogId) return null;
  const pre = addDays(round.start_date, -1);
  const e = dayEntry(pre, blogId);
  if (!e) return null;
  return { date: pre, views: Number(e.views || 0), revenue: Number(e.revenue || 0) };
}

/** 점수 설명에 쓰는 기준일 문구 — 시작 전날 기록이 있으면 그 날 */
function baseLabel(round) {
  const b0 = baseEntry(round, (APP.state.blogs[0] || {}).id);
  return (b0 ? b0.date : round.start_date).replace(/-/g, '.');
}
function postsOf(date, bid) { return livePosts(dayEntry(date, bid)); }

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
  const b0 = baseEntry(round, blog.id);  // 기수 시작 전날(11/19) 확정 방문자 = 시작값
  if (b0) prev = { v: b0.views, r: b0.revenue };
  const daily = [];

  days.forEach((d, i) => {
    const e = dayEntry(d, blog.id);
    const n = livePosts(e).length;
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
      // 기준일(기수 첫날). 시작 전날 기록이 있으면 그 값을 baseline 으로 삼아 첫날부터
      // '전날 대비 증가분'을 센다(모바일에서 11/19 는 달력에 안 보여 손으로 못 넣기 때문).
      if (prev) {
        grow = Math.max(0, (v || 0) - prev.v) + Math.max(0, (r || 0) - prev.r);
        prev = { v: v == null ? prev.v : v, r: r == null ? prev.r : r };
      } else {
        prev = { v: v == null ? 0 : v, r: r == null ? 0 : r };
      }
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
  const b0 = baseEntry(round, blogId);        // 기수 전날(11/19) 기록 = 1기 시작값
  if (b0) return { views: b0.views, revenue: b0.revenue, date: b0.date };
  return { views: 0, revenue: 0, date: null };
}

/** 연속 달성(스트릭) — 오늘 달성 전이면 어제까지의 연속 일수 */
function streakOf(blog, round) {
  const days = roundDays(round);
  const today = kstDate();
  const done = (d) => {
    const e = dayEntry(d, blog.id);
    return (livePosts(e).length >= blog.goal) && blog.goal > 0;
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
    const n = livePosts(e).length;
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
  const b0 = baseEntry(round, blog.id);
  const e1 = dayEntry(days[0], blog.id);
  const base = b0
    ? { views: b0.views, revenue: b0.revenue }
    : { views: Number((e1 || {}).views || 0), revenue: Number((e1 || {}).revenue || 0) };
  let last = { views: base.views, revenue: base.revenue, date: b0 ? b0.date : days[0] };
  let posts = 0;
  for (const d of days) {
    if (d > today) break;
    const e = dayEntry(d, blog.id);
    if (!e) continue;
    posts += livePosts(e).length;
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
    const n = livePosts(e).length;
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
      const n = livePosts(e).length;
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
      <button class="btn soft block" style="margin-top:6px" data-act="importtoday">🔄 오늘 발행글 한 번에 불러오기</button>
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

/* 지난 기록(리포트가 있는 날) — 챌린지 시작 전 방문자 수만 보여 준다(수익 금액은 표시하지 않음) */
function recentCard(round) {
  const s = APP.state;
  const days = Object.keys(s.entries || {}).filter((d) => d < round.start_date).sort().slice(-4);
  if (!days.length) return '';
  const rows = days.map((d) => {
    let v = 0, n = 0;
    for (const b of s.blogs) {
      const e = dayEntry(d, b.id);
      if (!e) continue;
      v += Number(e.views || 0); n += (e.posts || []).length;
    }
    return `<div class="drow"><div class="who"><div class="nm">${d.slice(5).replace('-', '.')} (${DOW[dowOf(d)]})</div>
      ${n ? `<div class="mini">${n}편</div>` : ''}</div>
      <div class="money">👥 ${nfmt(v)}</div></div>`;
  }).join('');
  return `<div class="sec card card-pad">
    <div class="sec-head"><h2>최근 기록</h2><span class="sub">예닝 오피스 리포트 · 챌린지 시작 전</span></div>
    ${rows}
    <p style="font-size:11px;color:var(--muted);margin-top:8px">챌린지 1기 전에 쌓인 실제 방문자 기록입니다. 달력에는 기수 기간만 표시돼요.</p>
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
        <div class="m">${r.blog ? `<span>${esc(r.blog)}</span>` : ''}${r.views != null ? `<span>조회 ${nfmt(r.views)}</span>` : ''}</div></div>
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

    <div class="sec card card-pad">
      <div class="sec-head"><h2>📥 오늘 발행글</h2><span class="sub">네이버 RSS · 6곳</span></div>
      <button class="btn block" data-act="importtoday">🔄 오늘 발행글 한 번에 불러오기</button>
      <p style="font-size:11px;color:var(--muted);margin-top:8px;line-height:1.55">오늘 발행한 글을 6곳에서 한 번에 찾아 달력에 넣습니다. 이미 등록된 글·지운 글은 건너뛰고, 기수 중간에 누르면 어제 빈 칸도 같이 채웁니다.</p>
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
          기준일(${baseLabel(round)})의 방문자·수익을 baseline 으로 두고, <b>전일 대비 늘어난 만큼</b>만 더합니다. 줄어든 날은 0점(감점 없음).
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
          발행 달성률 = 발행 편수 ÷ (하루 목표 × 경과일) · 방문자·수익 증가율은 기준일(${baseLabel(round)}) 대비입니다.<br>
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
      livePosts(e).forEach((p) => posts.push({ ...p, blog: b }));
    }
    goal += b.goal;
    n += livePosts(e).length;
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
  ['topic_hompan', '주제 홈판'],
  ['keywords', '키워드'],
  ['ent', '연예 실시간'],
  ['community', '커뮤 베스트'],
  ['broadcast', '방송·경기'],
];

function matData(tab) {
  const m = APP.state.materials || {};
  const hist = APP.state.materials_history || {};
  const date = APP.ui.matDate;
  // 브라우저에서 직접 새로고침한 자료가 있으면 그쪽이 최신이다
  const live = (APP.state.liveMaterials || {})[tab];
  if (live && ((live.rows || []).length || (live.topics || []).length) && (!date || live.date === date)) return live;
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

    <div class="mat-split">
      <div class="mat-main">${matBody(tab, date)}</div>
      <aside class="mat-side" id="scorerSlot">
        <button class="mat-jump" data-go="scorer"><span>🎯 홈판 제목 점수기</span><span>내 제목 채점 →</span></button>
      </aside>
    </div>
  `;
  mountScorer('#scorerSlot');
}

function matBody(tab, date) {
  const d = matData(tab);
  if (!d || !((d.rows || []).length || (d.topics || []).length)) {
    return `<div class="sec card"><div class="empty-note">이 날짜의 자료가 아직 없습니다.<br>동기화를 실행하면 채워집니다.</div></div>`;
  }
  const canRefresh = !!LIVE_SOURCES[tab];
  const noteTxt = (d.source ? esc(d.source) : '') +
    (d.collected_at ? ' · 수집 ' + esc(d.collected_at.replace('T', ' ').slice(5, 16)) : '');
  const note = (noteTxt || canRefresh)
    ? `<div class="sec mat-note"><span class="mtxt">${noteTxt}</span>${canRefresh
      ? `<button class="refresh-btn" data-refresh="${tab}">🔄 새로고침</button>` : ''}</div>`
    : '';

  if (tab === 'topic_hompan') return thBody(d, date);

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
      const blk = ycScan(r.kw);
      const soft = ycSoft(r.kw);
      const kwTxt = blk.length
        ? `<span class="kw">${esc(r.kw)}</span>`
        : `<a class="kw" href="https://search.naver.com/search.naver?query=${encodeURIComponent(r.kw)}" target="_blank" rel="noopener">${esc(r.kw)}</a>`;
      const act = (blk.length && !on)
        ? `<span class="blk-tag" title="${esc('사용 금지 — ' + ycLabels(blk))}">🚨 금지</span>`
        : `<button class="tiny-btn" data-pick="${esc(key)}" data-copy="${esc(r.kw)}" style="${on ? 'background:var(--rose);color:#fff' : ''}">${on ? '해제' : '+'}</button>`;
      const softTag = soft.length
        ? `<span class="soft-tag" title="${esc(soft.map((x) => x.head || x.label).join(' / '))}">⚠️ 주의</span>`
        : '';
      return `<li class="${blk.length ? 'blocked' : ''}${soft.length ? ' soft' : ''}"><span class="r">${r.rank}</span>
            ${kwTxt}
            <span class="vol">${nfmt(r.vol)}</span>${dl}
            ${softTag}${act}
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
    const blk = ycScan(r.title);
    const soft = ycSoft(r.title);
    const q = r.url && /^https?:/.test(r.url) ? r.url : 'https://search.naver.com/search.naver?query=' + encodeURIComponent(r.title);
    const meta = [];
    if (r.blog) meta.push(r.blog);
    if (r.nickname) meta.push(r.nickname);
    if (r.views != null && r.blog) meta.push('조회 ' + nfmt(r.views));
    if (r.src) meta.push(r.src);
    if (r.at) meta.push('📅 ' + String(r.at).slice(0, 16).replace('T', ' '));
    if (r.photos != null) meta.push('📷 ' + r.photos + '장');
    if (r.likes != null) meta.push('❤️ ' + nfmt(r.likes));
    if (r.comments != null) meta.push('💬 ' + nfmt(r.comments));
    const blkTag = blk.length
      ? `<span class="blk-tag" title="${esc('사용 금지 — ' + ycLabels(blk))}">🚨 사용 금지</span>`
      : '';
    const softTag = soft.length
      ? `<span class="soft-tag" title="${esc(soft.map((x) => x.head || x.label).join(' / '))}">⚠️ 주의</span>`
      : '';
    const act = (blk.length && !on)
      ? `<button class="go blk-off" disabled title="${esc('🚨 고소·저작권 주의 대상 — ' + ycLabels(blk))}">🚨 금지</button>`
      : `<button class="go ${on ? 'on' : ''}" data-pick="${key}" data-copy="${esc(r.title)}">${blk.length ? '해제' : (on ? '쓸게요 ✓' : '쓸게요')}</button>`;
    return `<div class="mat-item ${i < 3 ? 'top' : ''}${blk.length ? ' blocked' : ''}${soft.length ? ' soft' : ''}">
        <div class="n">${r.rank || i + 1}</div>
        <div class="body">
          <a class="t" href="${esc(q)}" target="_blank" rel="noopener">${esc(r.title)}</a>
          <div class="m">${blkTag}${softTag}${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
        </div>
        ${act}
      </div>`;
    return `<div class="mat-item ${i < 3 ? 'top' : ''}${blk.length ? ' blocked' : ''}">
        <div class="n">${r.rank || i + 1}</div>
        <div class="body">
          <a class="t" href="${esc(q)}" target="_blank" rel="noopener">${esc(r.title)}</a>
          <div class="m">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
        </div>
        ${act}
      </div>`;
  }).join('')}
    </div>`;
}

/* ───────────────── 주제별 홈판 (2026-11-20 추가) ─────────────────
   work/collect_topic_hompan.py 가 채운 materials.topic_hompan 을 그린다.
   칩: 전체 메인유입 / 건강 / 경제 / 연예인다이어트 / 자동차 / 스포츠
   각 줄: 작성일 · 📷 사진 N장 · ❤️ 공감 · 💬 댓글 · 쓸게요(제목 복사) · 원문 링크
   상단 📥 엑셀(CSV) 저장: 고른 주제 또는 전체 수집 목록(UTF-8 BOM → 엑셀 한글 안 깨짐) */
function thData() {
  return (APP.state.materials || {}).topic_hompan || null;
}

function thTopicList() {
  const d = thData();
  return (d && d.topics) || [];
}

function thRow(r, i, scope) {
  const key = 'th:' + scope + ':' + (r.url || r.title);
  const on = !!APP.state.picks[key];
  const blk = ycScan(r.title);
  const soft = ycSoft(r.title);
  const q = r.url && /^https?:/.test(r.url) ? r.url : 'https://search.naver.com/search.naver?query=' + encodeURIComponent(r.title);
  const bits = [];
  if (r.nickname) bits.push(`<span class="who">${esc(r.nickname)}</span>`);
  if (r.date || r.at) bits.push(`<span>📅 ${esc(String(r.date || r.at).slice(0, 10).replace(/-/g, '.'))}</span>`);
  if (r.photos != null) bits.push(`<span>📷 ${r.photos}장</span>`);
  if (r.likes != null) bits.push(`<span>❤️ ${nfmt(r.likes)}</span>`);
  if (r.comments != null) bits.push(`<span>💬 ${nfmt(r.comments)}</span>`);
  if (r.top) bits.push('<span class="th-top">🏅 홈판 TOP</span>');
  const blkTag = blk.length
    ? `<span class="blk-tag" title="${esc('사용 금지 — ' + ycLabels(blk))}">🚨 사용 금지</span>`
    : '';
  const softTag = soft.length
    ? `<span class="soft-tag" title="${esc(soft.map((x) => x.head || x.label).join(' / '))}">⚠️ 주의</span>`
    : '';
  const act = (blk.length && !on)
    ? `<button class="go blk-off" disabled title="${esc('🚨 고소·저작권 주의 대상 — ' + ycLabels(blk))}">🚨 금지</button>`
    : `<button class="go ${on ? 'on' : ''}" data-pick="${esc(key)}" data-copy="${esc(r.title)}">${blk.length ? '해제' : (on ? '쓸게요 ✓' : '쓸게요')}</button>`;
  return `<div class="mat-item th-item ${i < 3 && !r.top ? 'top' : ''}${blk.length ? ' blocked' : ''}${soft.length ? ' soft' : ''}">
      <div class="n">${r.rank || i + 1}</div>
      <div class="body">
        <a class="t" href="${esc(q)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        <div class="m">${blkTag}${softTag}${bits.join('')}</div>
      </div>
      <div class="acts">${act}<a class="go open" href="${esc(q)}" target="_blank" rel="noopener">원문</a></div>
    </div>`;
}

function thBody(d, date) {
  const topics = thTopicList();
  const sel = APP.ui.thTopic || 'all';
  const chips = [`<button class="chip ${sel === 'all' ? 'on' : ''}" data-th="all">전체 메인유입</button>`]
    .concat(topics.map((t) => `<button class="chip ${sel === t.id ? 'on' : ''}" data-th="${esc(t.id)}">${esc(t.emoji || '')} ${esc(t.name)}<span class="n">${(t.rows || []).length}</span></button>`))
    .join('');
  const stamp = d && d.collected_at ? ' · 수집 ' + String(d.collected_at).replace('T', ' ').slice(5, 16) : '';
  const noteSrc = sel === 'all'
    ? '크리에이터 어드바이저 메인 유입 + 수집 시점 실측 지표'
    : ((d && d.source) || '네이버 블로그 주제별 홈판 실측');
  const note = `<div class="sec mat-note"><span class="mtxt">${esc(noteSrc)}${esc(stamp)}</span></div>`;
  const bar = `<div class="sec th-bar">
      <div class="chip-row">${chips}</div>
      <div class="th-csv">
        <button class="csv-btn" data-csv="${esc(sel === 'all' ? 'main' : sel)}">📥 엑셀(CSV) 저장</button>
        <button class="csv-btn ghost" data-csv="all" title="5개 주제 전부 저장">전체 수집</button>
      </div>
    </div>`;

  if (sel === 'all') {
    const mi = (APP.state.materials || {}).main_inflow || {};
    const rows = mi.rows || [];
    const head = `<div class="sec th-head"><b>네이버 메인(홈판)에서 많이 유입된 글 1~20</b>
      <span class="sub">${esc(mi.date ? mi.date.replace(/-/g, '.') + ' 기준' : '')} · 남의 글 제목·지표로 우리 제목을 벤치마킹</span></div>`;
    if (!rows.length) return note + bar + '<div class="sec card"><div class="empty-note">메인 유입 자료가 아직 없어요.</div></div>';
    return note + bar + head + `<div class="sec mat-list">${rows.map((r, i) => thRow(r, i, 'all')).join('')}</div>`;
  }

  const t = topics.find((x) => x.id === sel);
  if (!t) return note + bar + '<div class="sec card"><div class="empty-note">이 주제 자료가 아직 없어요.<br>수집기를 돌리면 채워집니다.</div></div>';
  const head = `<div class="sec th-head"><b>${esc(t.emoji || '')} ${esc(t.name)} 홈판 인기글 ${t.rows.length}건</b>
      <span class="sub">${esc(t.source || '')} · 공감 많은 순 (지표는 수집 시점 실측)</span></div>`;
  return note + bar + head + `<div class="sec mat-list">${(t.rows || []).map((r, i) => thRow(r, i, sel)).join('')}</div>`;
}

/* ── CSV (UTF-8 BOM · 엑셀에서 바로 열림) ─────────────────────── */
function thCsvRows(scope) {
  const head = ['주제', '순위', '제목', '블로그 닉네임', '작성일', '사진 수', '공감', '댓글', '링크'];
  const out = [head];
  const push = (topicName, r) => out.push([
    topicName, r.rank || '', r.title || '', r.nickname || '',
    (r.date || String(r.at || '').slice(0, 10)),
    r.photos == null ? '' : r.photos,
    r.likes == null ? '' : r.likes,
    r.comments == null ? '' : r.comments,
    r.url || '',
  ]);
  const topics = thTopicList();
  if (scope === 'all') {
    topics.forEach((t) => (t.rows || []).forEach((r) => push(t.name, r)));
  } else if (scope === 'main') {
    ((APP.state.materials || {}).main_inflow || { rows: [] }).rows.forEach((r) => push('메인유입', r));
  } else {
    const t = topics.find((x) => x.id === scope);
    if (t) (t.rows || []).forEach((r) => push(t.name, r));
  }
  return out;
}

function downloadCsv(scope) {
  const rows = thCsvRows(scope);
  if (rows.length < 2) { toast('내려받을 자료가 없어요'); return; }
  const name = scope === 'all' ? '전체수집' : (scope === 'main' ? '메인유입' : (thTopicList().find((t) => t.id === scope) || {}).name || scope);
  const csv = '\ufeff' + rows.map((r) => r.map((v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '예브홈판_' + name + '_' + kstDate().replace(/-/g, '') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('엑셀(CSV) ' + (rows.length - 1) + '건 내려받았어요');
  } catch (e) {
    toast('저장이 막혔어요 · ' + String((e && e.message) || e).slice(0, 30));
  }
}

/* ───────────────────────── 🎯 홈판 제목 점수기 ─────────────────────────
   6기 홈판 제목 원칙 + 7기 2회차(앞 열 글자 후킹 · 뒤 검색 키워드 · 결말 숨기기)를 점수화한다.
   API 호출 없음 · 브라우저 안에서만 계산.
   (1) 앞부분 후킹 40 · (2) 구체성 25 · (3) 검색형·구조 20 · (4) 길이 15 = 100 */
/* ==== SCORER-CORE BEGIN ==== */
const TS_DICT = {
  EMO: ['실화', '충격', '대박', '헐', '이걸', '아직도', '데려오세요', '모르고', '몰랐', '진짜', '솔직히', '결국', '레전드', '미쳤', '말아요', '했더니', '인 줄', '줄 알았', '어떻게', '하더라', '터졌', '난리', '폭로', '해명', '바꿨', '뜯었', '그만', '드러난', '고백', '경악', '소름', '눈물', '포기', '후회', '논란', '역대급', '사라진', '사라졌', '맛없', '말도 안', '이 가격', '드디어', '결말', '공개', '놓치', '날립', '손해', '비싼', '무료', '공짜', '반값', '걸렸'],
  CONTR: ['에서', '부터', '까지', '만에', '→', 'vs', 'VS', '대비', '반대로', '아니라', '전과 후', 'before', 'after'],
  SEARCH: ['맛집', '추천', '후기', '방법', '총정리', '순위', '베스트', '리스트', '정보', '정리', '코디', '사복', '내돈내산', '비교', '리뷰', '모음'],
  ABSTRACT: ['반전', '이유', '비밀', '꿀팁', '총정리', '솔직', '대박', '충격', '진실', '진짜', '핵심', '포인트', '노하우', '비법', '꿀조합', '꿀정보', '상황', '정석'],
  STOP: ['그리고', '하지만', '있는', '없는', '이런', '저런', '정도', '사람', '때문', '부분', '경우', '다른', '모든', '너무', '정말', '이제', '요즘', '그냥'],
  UNIT_RE: /\d+\s*(?:kg|킬로|g|만원|천원|원|개월|년|시간|분|초|위|명|살|개|번|회|일|주|%|배|편|kcal|칼로리)/i,
};
TS_DICT.ALL = [].concat(TS_DICT.EMO, TS_DICT.CONTR, TS_DICT.SEARCH, TS_DICT.ABSTRACT, TS_DICT.STOP);

const tsChars = (s) => Array.from(String(s));
const tsClamp = (n, a, b) => Math.max(a, Math.min(b, n));
function tsNorm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function tsHit(s, arr) { return arr.filter((w) => s.indexOf(w) >= 0); }
function tsTokens(s) {
  return tsNorm(s).replace(/["'“”‘’「」『』\[\]()<>·,~…!?.\-–—:;\/]/g, ' ').split(/\s+/).filter(Boolean);
}
/* "꾸민듯 안꾸민듯"처럼 두 글자가 다시 나오면 말장난(리듬)으로 본다 */
function tsRhyme(s) {
  const t = tsChars(s).filter((c) => /[가-힣a-zA-Z]/.test(c)).join('');
  for (let i = 0; i + 2 <= t.length - 2; i++) {
    const sub = t.substr(i, 2);
    if (t.indexOf(sub, i + 2) >= 0) return sub;
  }
  return '';
}
/* 주제 분류 — 입력 제목의 도메인을 보고 훅·코칭·추천을 고른다.
   스포츠 글에 "신청 안 하면 못 받아요" 같은 지원금 훅이 붙지 않게 하는 핵심 장치.
   ('박동원'의 '원'처럼 이름 속 글자에 낚이지 않도록 단어 목록을 세어 고른다) */
const TS_KIND_WORDS = {
  sports: ['야구', '축구', '농구', '배구', 'KBO', 'K리그', 'MLB', '프로야구', '자이언츠', '타이거즈', '트윈스',
    '베어스', '랜더스', '히어로즈', '이글스', '다이노스', '위즈', '감독', '선수', '타자', '투수', '타율', '홈런',
    '타점', '타수', '안타', '득점', '볼넷', '이적', 'FA', '트레이드', '구단', '리그', '시즌', '한국시리즈',
    '포스트시즌', '올림픽', '월드컵', '연봉', '경기장', '전반', '후반', '선발', '구원', '역전', '엔트리', '감독직'],
  tech: ['아이폰', '갤럭시', '노트북', '맥북', '태블릿', '스마트폰', '휴대폰', '이어폰', '헤드폰', '워치', '스피커',
    '가전', '냉장고', '세탁기', '에어컨', '청소기', '모니터', '키보드', '마우스', '챗GPT', 'AI', '앱', '프로그램',
    '유튜브', '자동차', '신차', '시승', '주행', '연비', '전기차', '하이브리드', '타이어', '세차', '정비', '블랙박스',
    '카시트', '내비', '충전기', '보조배터리', '렌탈', '배터리'],
  health: ['다이어트', '감량', '체중', '몸무게', 'kg', '칼로리', '혈당', '혈압', '콜레스테롤', '영양제', '유산균',
    '오메가', '비타민', '단백질', '근육', '운동', '헬스', '요가', '필라테스', '루틴', '수면', '탈모', '두피', '피부',
    '여드름', '아토피', '질환', '증상', '병원', '진료', '처방', '검진', '마운자로', '위고비', '갱년기', '임신', '출산',
    '관절', '허리', '어깨', '면역', '장건강', '열', '체온'],
  parenting: ['육아', '신생아', '아기', '아들', '딸', '초등', '중등', '고등', '학생', '학부모', '방학', '개학',
    '입학', '졸업', '학원', '숙제', '문제집', '수능', '내신', '책육아', '태교', '장난감', '놀이터', '어린이집',
    '유치원', '이유식', '기저귀', '등원', '하원', '교육', '키즈', '아동'],
  money: ['지원금', '보조금', '장려금', '신청', '마감', '세금', '연말정산', '종합소득세', '부가세', '적금', '예금',
    '주식', '배당', '청약', '환급', '절약', '금리', '대출', '보험료', '연금', '수당', '급여', '월급', '실수령',
    '캐시백', '만원', '천원', '가격', '할인', '무료', '공짜', '반값', '포인트'],
  food: ['맛집', '맛', '메뉴', '파스타', '국수', '고기', '디저트', '카페', '베이커리', '안주', '밥', '면', '빵',
    '술', '여행', '숙소', '호텔', '펜션', '캠핑', '체험단', '내돈내산', '리뷰', '제품', '화장품', '크림', '세럼',
    '앰플', '코디', '가방', '신발'],
  celeb: ['근황', '열애', '결혼', '이혼', '컴백', '화보', '인스타', '배우', '아이돌', '가수', '출연', '예능',
    '논란', '콘서트', '앨범', '드라마', '영화', '개봉', '시청률', '팬미팅'],
};
const TS_KIND_ORDER = ['sports', 'tech', 'health', 'parenting', 'money', 'food', 'celeb'];
function tsKind(title) {
  const t = String(title == null ? '' : title);
  let best = 'generic', bestN = 0;
  TS_KIND_ORDER.forEach((k) => {
    const words = TS_KIND_WORDS[k];
    let n = 0;
    for (let i = 0; i < words.length; i++) if (t.indexOf(words[i]) >= 0) n++;
    if (n > bestN) { bestN = n; best = k; }
  });
  return best;
}
/* 주제별 훅 — 그 분야에 자연스러운 말만 쓴다.
   2026-11-21 전면 교체: ① 주제당 8개 ② 입력 제목(tsSeed)으로 자리를 흩뿌려 같은 분야라도 늘 같은 훅이 붙지 않게
   ③ '기준' 같은 명사구만 덩그러니 붙지 않도록 말이 되는 구어체 한마디만 ④ ○ 플레이스홀더 없음 */
const TS_BANK = {
  sports: ['"이번엔 다르다는데"', '"결국 이렇게 됐다"', '"판돌이도 놀랐다"', '"벤치가 움직였다"',
    '"숫자가 말해 준다"', '"그 장면 다시 보니"', '"계약 규모부터"', '"누가 봐도"'],
  tech: ['"3개월 써보니"', '"사기 전에 확인할 것"', '"설정 하나 바꿨다니"', '"업데이트 후 달라졌다"',
    '"이게 진짜 불편했다"', '"개봉해 보니"', '"값 보면 바로 안다"', '"리뷰 다 지웠다"'],
  health: ['"병원에서 들은 애기"', '"이 수치부터 보세요"', '"한 달 해보니 달라졌다"', '"약 끊고 나서 생긴 일"',
    '"검진 결과지에 적힌"', '"몸이 먼저 알려줬다"', '"그냥 넘기면 안 되는"', '"실장님이 하라는 대로"'],
  parenting: ['"학부모들 다 이 말 해요"', '"초등 기준으로 보면"', '"아이 반응이 달랐다"', '"선생님이 하신 말씀"',
    '"한 학기 해보니"', '"이건 미리 알아두세요"', '"학원 안 보내도"', '"형제들도 달랐다"'],
  money: ['"신청 안 하면 못 받아요"', '"이거 모르면 손해"', '"내가 받은 금액은"', '"담당자한테 물어보니"',
    '"마감 전에 꼭 확인"', '"생각보다 많았다"', '"국세청 답변은"', '"이번엔 조건이 달라졌다"'],
  food: ['"여기 왜 줄 서는지 알겠다"', '"먹자마자 말 잃었다"', '"값이 아깝지 않았다"', '"재방문은 안 할 듯"',
    '"다른 지점과 비교하니"', '"메뉴판부터 봤다"', '"사장님이 알려준"', '"웨이팅 있어도 갈 만하다"'],
  celeb: ['"이걸 직접 공개한다고?"', '"그동안 숨긴 이유"', '"본인도 당황했다"', '"해명이 더 화제"',
    '"이 장면 하나로"', '"소속사 입장은"', '"결국 밝혀졌다"', '"팬들 반응이 갈렸다"'],
  generic: ['"이건 실화야?"', '"아직도 모르는"', '"해보니 달랐다"', '"그냥 넘기면 손해"',
    '"이게 진짜 이유였다"', '"알고 보니"', '"직접 확인했다"', '"결론부터 말하면"'],
};
/* 주제별 코칭 예시 — 스포츠 글에 "2,000원" 같은 엉뚱한 예를 들지 않게 */
const TS_COACH = {
  sports: { hook: '①따옴표("연봉·성적 다 따져보니") ②숫자("3년 계약") ③비교("vs 구도")', con: '타율·홈런·연봉·계약 기간', kw: '이적·연봉·전력' },
  tech: { hook: '①따옴표("3개월 써보니") ②숫자("12만 원대") ③비교("전 세대와")', con: '가격·배터리·무게', kw: '후기·가격·비교' },
  health: { hook: '①따옴표("병원에서 들은 기준") ②숫자("3개월") ③기준("정상 범위")', con: '수치·mg·도·주', kw: '증상·기준·병원' },
  parenting: { hook: '①따옴표("학부모들 다 이 말 해요") ②나이("7살") ③시기("방학")', con: '개월·살·학년', kw: '방학·학원·초등' },
  money: { hook: '①따옴표("신청 안 하면 못 받아요") ②숫자("10만 원") ③기한("마감 전")', con: '금액·기간·%', kw: '지원금·신청·마감' },
  food: { hook: '①따옴표("여기 왜 줄 서는지 알겠다") ②숫자("2,000원") ③비교("다른 지점과")', con: '곳·원·분', kw: '맛집·후기·가격' },
  celeb: { hook: '①따옴표("이걸 직접 공개한다고?") ②숫자("3년 만에") ③반전', con: '년·회·편', kw: '근황·논란·화보' },
  generic: { hook: '①따옴표 대화체 ②숫자 ③반전·손실 한마디', con: '숫자+단위', kw: '후기·방법·정리' },
};

/* ② 숫자·기준형에 쓸 '기준·비교 질문' — 제목에 숫자가 없을 때 쓴다(○ 없이 말이 되게) */
const TS_ASK = {
  sports: ['"누가 이길까?"', '"이게 최선이었나?"', '"어디까지 갈까?"'],
  tech: ['"값만 보면 되나?"', '"어느 쪽이 낫나?"', '"지금 사도 되나?"'],
  health: ['"어디까지가 정상?"', '"이 정도면 괜찮나?"', '"하루 얼마까지?"'],
  parenting: ['"몇 살부터 맞나?"', '"지금 시작해도 되나?"', '"다들 어디까지 하나?"'],
  money: ['"얼마까지 받나?"', '"내가 받을 수 있을까?"', '"조건 맞나?"'],
  food: ['"값만큼 하나?"', '"여기까지 먹어봤다"', '"또 갈 만한가?"'],
  celeb: ['"무슨 일이 있었나?"', '"왜 이제야 말하나?"', '"사실일까?"'],
  generic: ['"어디까지 맞나?"', '"지금이 맞나?"', '"그래서 결론은?"'],
};
/* 숫자 + 단위 → 앞 10글자 안에 바로 꿍기는 질문 (예: "2,000mg 넘기면" · "3일 지나면") */
function tsNumHook(n) {
  const s = String(n || '').replace(/\s+/g, '');
  const unit = (s.match(/(년|개월|주|일|시간|분|초|만원|천원|원|억|만|kg|킬로|mg|ml|도|회|번|%|개|곳|위|명|살|배|편|컵|잔)$/) || [''])[0];
  if (/^(년|개월|주|일|시간|분|초|회|번)$/.test(unit)) return '"' + s + ' 지나면"';
  if (/^(kg|킬로)$/.test(unit)) return '"' + s + ' 차이"';
  if (/^(만원|천원|원|억|만)$/.test(unit)) return '"' + s + '이면"';
  if (/^(mg|ml|도|개|잔|컵)$/.test(unit)) return '"' + s + ' 넘기면"';
  if (/^(%|배)$/.test(unit)) return '"' + s + ' 차이"';
  if (/^살$/.test(unit)) return '"' + s + '살인데"';
  if (/^(명|곳|위|편)$/.test(unit)) return '"' + s + ' 보니"';
  return '"' + s + ' 이게 맞나"';
}
/* 입력 제목으로 고르는 자리(seed) — 같은 분야라도 제목마다 다른 훅이 나오게 */
function tsSeed(s) {
  let h = 7;
  for (const c of tsChars(String(s || '')).slice(0, 48)) h = (h * 31 + c.charCodeAt(0)) % 1000003;
  return h;
}
/* 제목 마무리 다듬기 — 붙어 버린 쉼표·중복 단어·홀따옴표 정리 */
function tsTidy(s) {
  let t = tsNorm(s);
  t = t.replace(/\s*\|\s*/g, ' | ');
  const ws = t.split(' ');
  const out = [];
  for (const w of ws) { if (!w) continue; if (out.length && out[out.length - 1] === w) continue; out.push(w); }
  t = out.join(' ');
  t = t.replace(/^[,·\s|]+|[,·\s|]+$/g, '');
  t = t.replace(/([?!])\s*\1+/g, '$1');
  return t.trim();
}
function tsTrim(s, max) {
  const t = tsNorm(s);
  if (tsChars(t).length <= max) return t;
  const ws = t.split(' ');
  while (ws.length > 3 && tsChars(ws.join(' ')).length > max) ws.pop();
  return tsNorm(ws.join(' '));
}

/* ── 7기 2회차(2026-11-20 라이브) 기준 ──────────────────────────────
   · 홈판은 0.5초. 사진 한 장 + 제목 '앞 열 글자'로 클릭이 갈린다.
   · 7기 제목 공식 = 조합 제목 → 앞은 홈판형 후킹(멈추게) / 뒤는 검색형 키워드 원형 그대로(걸리게)
   · 주제마다 먹히는 후킹이 다르다 → 이슈형 · 정보형 · 상업형
   · 결말(정답)을 제목에서 말해 버리면 들어갈 이유가 사라진다
   강사님이 보여 준 '앞에 붙는 후킹 6종'
   ①유명인·대상 감추기 ②숫자·가격 반전 ③계급과 순위 ④1인칭 썰·고백 ⑤공분·황당 ⑥질문으로 끝내기 */
const TS_HOOK = {
  hide: ['정체', '이거', '이것', '그것', '그 여배우', '그 배우', '그 가수', '어떤', '무슨', '누구',
    '뜻밖의', '의외의', '얼마', '몇 가지', '가지', '모음', '리스트', '무엇', '어디'],
  rank: ['서열', '계급도', '계급', '순위', '등급', '레벨', '몇 위', '1위', '2위', '3위', '상위', '하위'],
  first: ['했더니', '갔더니', '봤더니', '샀더니', '맡겼', '써보니', '해보니', '당했', '날렸',
    '썼더니', '먹었더니', '신청했', '들어갔더니', '넣었는데', '바꿨더니', '해봤',
    '자마자', '더니', '말 잃', '말잃'],
  speed: ['오늘', '방금', '지금', '속보', '급', '결국', '3일', '이틀', '하루', '새벽', '당장', '이번 주', '이번주'],
  shock: ['충격', '경악', '논란', '후회', '손해', '조심', '위험', '아찔', '황당', '실화', '대박', '헐',
    '레전드', '터졌', '난리', '폭로', '해명', '눈물', '소름', '말도 안', 'ㄷㄷ', '빅엿',
    '놀라', '멈췄', '당황', '깜짝', '기가', '못 알아', '어이', '뜯었', '얼떨', '뻘쭘', '싶어'],
  turn: ['아니라', '반대로', '오히려', '그런데', '근데', '인 줄', '줄 알았', '근황', '바뀐', '달라진'],
  person: ['여배우', '배우', '가수', '아이돌', '모델', '감독', '선수', '코치', '대표', '사장',
    '유튜버', '인플루언서', '연예인', '셀럽', '전문의', '의사'],
  /* 내 몸 얘기 — "어? 나도 그런데?" 싶게 만드는 증상 인식형 후킹 */
  sym: ['아랫배', '윗배', '통증', '가스', '두통', '어지럼', '피로', '붓기', '기침', '숨이',
    '소화', '변비', '설사', '눈가', '주름', '탈모', '체중', '혈당', '혈압',
    '가슴', '허리', '무릎', '어깨', '손발', '얼굴'],
};
/* 검색 키워드 — 사람들이 실제로 검색창에 치는 말 (뒤에 '원형 그대로' 붙여야 한다) */
const TS_KW = TS_DICT.SEARCH.concat(['증상', '원인', '치료', '일정', '대진표', '가격', '보험료', '상한액',
  '기준', '계산', '신청', '마감', '지원금', '보조금', '세금', '연말정산', '환율', '주가', '전세', '대출',
  '금리', '효능', '부작용', '성분', '칼로리', '레시피', '코디', '사이즈', '비용', '수수료', '공제',
  '환급', '연금', '급여', '봉급표', '실수령', '학원', '유치원', '놀이터', '코스트코', '다이소', '이케아',
  '계약', '이적', '연봉', '근황', '발표', '경기', '중계', '라인업', '부상', '개막', '우승', '순위', '기록']);
/* 주제 → 3묶음 (이슈형 / 정보형 / 상업형) */
const TS_TYPE_OF = {
  sports: 'issue', celeb: 'issue',
  health: 'info', parenting: 'info', food: 'info', generic: 'info',
  money: 'money', tech: 'money',
};
const TS_TYPE_LABEL = { issue: '이슈형', info: '정보형', money: '상업형' };
const TS_TYPE_ICON = { issue: '⚡', info: '📚', money: '💰' };
const TS_TYPE_HOOK = {
  issue: '속도 · 숫자 반전 · 정체 숨기기로 0.5초에 멈추게',
  info: '뒤 검색 키워드가 바닥 — 앞은 이슈형처럼 숫자·연예인·숨기기',
  money: '숫자 · 가격 반전 + 제목 뒤에 돈 키워드(연금·세금·차값·보험료)',
};
const TS_TYPE_COACH = {
  issue: '이슈형은 속도전입니다. "방금·결국·3일 만에" 같은 속도 말이나 "그 여배우 정체"처럼 대상을 감춰서 0.5초에 멈추게 하세요.',
  info: '정보형은 뒤에 붙는 검색 키워드가 바닥입니다. 앞은 숫자·연예인·숨기기로 멈추게 하고, 뒤에는 사람들이 실제로 치는 말을 원형 그대로 붙이세요.',
  money: '상업형은 숫자가 곧 후킹입니다. "○만 원" 같은 금액 반전을 앞에 두고, 뒤에 연금·세금·차값처럼 돈이 걸린 키워드를 붙이면 같은 방문자라도 단가가 높아집니다.',
};
function tsType(kind) { return TS_TYPE_OF[kind] || 'info'; }

/* 결말(정답)을 말해 버린 제목 — 강의 예시
   ✗ 롱패딩 세탁기에 돌려도 됩니다, 롱패딩 셀프 세탁 방법
   ✓ 세탁기에 그냥 돌려도 될까? 롱패딩 셀프 세탁 방법 */
const TS_SPOIL_END = /(됩니다|합니다|입니다|습니다|된다|이다|했다|됐다|드립니다|하세요|하십시오|좋습니다|괜찮습니다|맞습니다|낫다|해야 한다|해야한다)[\s.…,]*$/;
const TS_SPOIL_WORD = ['정답은', '결론은', '결말은', '결과는', '답은', '괜찮습니다', '돌려도 됩니다',
  '해도 됩니다', '먹어도 됩니다', '마셔도 됩니다', '쓰면 됩니다', '하면 됩니다'];
const TS_CURIO = /(\?|까\s*$|나\s*$|나요|는데\s*$|다는데|을까|ㄹ까|였나|인가|지금\s)/;

function scoreHomeTitle(raw, forceKind) {
  const title = tsNorm(raw);
  const chars = tsChars(title);
  const len = chars.length;
  if (!title) return { ok: false };
  /* 주의 대상이 들어 있으면 채점 자체를 막는다 */
  const blocked = ycScan(title);
  if (blocked.length) return { ok: false, blocked, title };
  const soft = ycSoft(title);
  /* 주제(자동 판단 또는 칩에서 고른 것) — 훅·코칭·추천이 이걸 따른다 */
  const kind = (forceKind && forceKind !== 'auto') ? forceKind : tsKind(title);
  const type = tsType(kind);
  const head10 = chars.slice(0, 10).join('');
  const head18 = chars.slice(0, 18).join('');
  const good = [];
  const fix = [];
  const tips = [];
  const toks = tsTokens(title);
  const hasNum = /\d/.test(title);

  /* ── 제목 쪼개기: 앞(후킹) / 뒤(검색 키워드) ───────────────────
     세로줄(|)이 있으면 그 자리, 없으면 마지막 검색 키워드 자리에서 자른다 */
  const barAt = Math.max(title.indexOf('|'), title.indexOf('｜'));
  let frontSeg = title, tailSeg = '', hasBar = barAt > 0;
  if (hasBar) { frontSeg = title.slice(0, barAt).trim(); tailSeg = title.slice(barAt + 1).trim(); }
  else {
    let at = -1;
    TS_KW.forEach((w) => { const i = title.lastIndexOf(w); if (i > at && i >= 6) at = i; });
    if (at > 0) { frontSeg = title.slice(0, at).trim(); tailSeg = title.slice(at).trim(); }
  }

  /* ── (1) 앞 10글자 후킹 40 ────────────────────────────────────
     강의 기준은 '앞 열 글자'. 다만 실제 메인에 뜬 제목도 가장 센 말이
     12~20자에 걸리는 경우가 많아서, 열 글자 안쪽은 만점 가중, 20자 안쪽은 60% 가중으로 본다. */
  const headSeg = chars.slice(0, 20).join('');
  const hitAt = (arr) => {
    const a10 = tsHit(head10, arr), a20 = tsHit(headSeg, arr);
    if (a10.length) return { w: a10[0], full: true };
    if (a20.length) return { w: a20[0], full: false };
    return { w: '', full: false };
  };
  const w1 = (o) => (o.w ? (o.full ? 1 : 0.6) : 0);
  let hook = 10;
  const NUM_RE = /\d[\d,.]*\s*(?:년|개월|일|시간|분|초|만원|천원|원|억|만|kg|킬로|%|개|곳|위|명|살|배|편)?/;
  const numF = /\d/.test(head10) ? { w: (head10.match(NUM_RE) || [''])[0].trim(), full: true }
    : (/\d/.test(headSeg) ? { w: (headSeg.match(NUM_RE) || [''])[0].trim(), full: false } : { w: '', full: false });
  const hideF = hitAt(TS_HOOK.hide);
  const rankF = hitAt(TS_HOOK.rank);
  const firstF = hitAt(TS_HOOK.first);
  const speedF = hitAt(TS_HOOK.speed);
  const shockF = hitAt(TS_HOOK.shock);
  const turnF = hitAt(TS_HOOK.turn);
  const personF = hitAt(TS_HOOK.person);
  const symF = hitAt(TS_HOOK.sym);
  const qm = /[?!]|ㅋㅋ|ㅎㅎ|ㄷㄷ/.test(headSeg);
  const quoted = /["'“”‘’「『]/.test(headSeg);
  const dots = /(\.\.|…)/.test(headSeg);
  const comma = /[,·]/.test(headSeg);
  const frontSearch = tsHit(head10, TS_KW);
  hook += 10 * w1(numF);
  hook += 9 * w1(hideF.w ? hideF : personF);
  hook += 7 * w1(symF);
  hook += 7 * w1(firstF);
  hook += 6 * w1(rankF);
  hook += 6 * w1(shockF);
  hook += 5 * w1(speedF);
  hook += 5 * w1(turnF);
  if (qm) hook += 5;
  /* 말줄임·따옴표·쉼표 = '이야기'를 여는 신호 — 홈판 제목 절반이 이 모양이다 */
  const story = (quoted ? 1 : 0) + (dots ? 1 : 0);
  if (story) hook += 4 * story;
  if (comma) hook += 2;
  const hookParts = [numF, hideF, personF, symF, firstF, rankF, shockF, speedF, turnF]
    .filter((o) => o.w).length + (qm ? 1 : 0) + (story ? 1 : 0);
  const nearHook = numF.w || hideF.w || personF.w || symF.w || firstF.w || rankF.w || shockF.w || speedF.w || turnF.w;
  /* 실제 메인에 오른 제목들이 갖추는 최소선 — 재료가 둘 이상이면 바닥을 깔아 준다 */
  if (hookParts >= 2 || (hookParts >= 1 && (numF.w || symF.w || hideF.w || personF.w))) hook = Math.max(hook, 26);
  else if (hookParts >= 1) hook = Math.max(hook, 18);
  if (numF.w) good.push('앞부분 숫자(' + numF.w + ')가 "얼마·언제"라는 기대를 바로 만듭니다.');
  if (hideF.w) good.push('앞부분 "' + hideF.w + '"로 대상·정체를 감춰서 누르게 만듭니다.');
  else if (personF.w) good.push('앞부분 "' + personF.w + '"가 나와서 누구 얘기인지 궁금해집니다.');
  if (symF.w) good.push('"' + symF.w + '" — 어? 나도 그런데? 싶게 내 몸 얘기로 읽힙니다.');
  if (firstF.w) good.push('"' + firstF.w + '" — 1인칭 썰로 시작해 남 얘기가 내 얘기처럼 들립니다.');
  if (rankF.w) good.push('"' + rankF.w + '" — 계급·순위 구도가 비교 심리를 건드립니다.');
  if (shockF.w) good.push('"' + shockF.w + '" 한마디가 도발·공분을 만들어요.');
  if (speedF.w) good.push('"' + speedF.w + '" — 속도감 있는 말이 홈판 이슈형에 맞습니다.');
  if (turnF.w) good.push('"' + turnF.w + '" — 앞뒤를 뒤집는 반전 말이 들어 있어요.');
  if (qm) good.push('물음표·말투가 살아 있어 말하듯 읽혀요.');
  if (frontSearch.length && !hookParts) {
    hook -= 8;
    fix.push('앞 열 글자가 검색어("' + frontSearch[0] + '")로 시작합니다. 홈판은 앞 열 글자만 보고 0.5초에 결정하니, 그 자리에는 검색어 대신 후킹을 두고 검색어는 뒤로 보내세요.');
  } else if (!nearHook && !story) {
    hook -= 5;
    fix.push('앞 스무 글자 "' + headSeg.trim() + '"에 0.5초에 손을 멈추게 할 말(숫자·연예인·정체 숨기기·내 몸 얘기·질문·말줄임)이 없어요. 가장 센 말을 맨 앞으로 끌어오세요.');
  } else if (!numF.full && !hideF.full && !symF.full && !shockF.full && hook < 30) {
    fix.push('후킹 재료가 열 글자 살짝 뒤에 있습니다. 지금도 읽히지만, 그 말을 열 글자 안으로 당기면 0.5초 판정에서 훨씬 유리해요.');
  }
  hook = tsClamp(Math.round(hook), 0, 40);

  /* ── (2) 구체성 20 ─────────────────────────────────────────── */
  let con = 9;
  const unit = TS_DICT.UNIT_RE.test(title);
  const qContent = (title.match(/["“「『]([^"”」』]{4,})["”」』]/) || [])[1] || '';
  const names = toks.filter((t) => tsChars(t).length >= 2 && !/^\d+$/.test(t) && TS_DICT.ALL.indexOf(t) < 0);
  if (hasNum) con += 5;
  if (unit) con += 3;
  if (qContent) con += 2;
  con += Math.min(5, names.length * 2);
  const abs = tsHit(title, TS_DICT.ABSTRACT);
  if (abs.length && !hasNum && !unit && names.length < 2) {
    con -= 6;
    fix.push('"' + abs[0] + '" 같은 말만 있고 무엇이 그런지 알려 줄 구체 대상(가격·메뉴·수치·증상·기간)이 없어 모호해요.');
  }
  con = tsClamp(con, 0, 20);

  /* ── (3) 뒤 검색 키워드 원형 20 ────────────────────────────── */
  let st = 9;
  const allKw = tsHit(title, TS_KW);
  const kwCount = TS_KW.reduce((n, w) => n + (title.split(w).length - 1), 0);
  const tailKw = tsHit(tailSeg || '', TS_KW);
  const lastKwAt = allKw.length ? title.lastIndexOf(allKw[allKw.length - 1]) : -1;
  const kwAtEnd = tailKw.length > 0 || (allKw.length > 0 && lastKwAt >= Math.floor(len * 0.45));
  if (hasBar) { st += 4; good.push('세로줄(|)로 앞(후킹)과 뒤(검색 키워드)를 갈라 놨습니다 — 7기 공식을 가장 노골적으로 쓰는 방식이에요.'); }
  if (tailKw.length || kwAtEnd) {
    st += 8;
    good.push('뒤쪽에 검색 키워드("' + (tailKw[0] || allKw[0]) + '")가 원형 그대로 살아 있어서, 메인에서 내려간 뒤에도 검색으로 계속 들어옵니다.');
  } else if (allKw.length) {
    st += 3;
    fix.push('검색 키워드("' + allKw[0] + '")가 앞쪽에 있습니다. 앞은 후킹, 뒤는 키워드로 순서를 바꾸면 검색 유입까지 같이 잡혀요.');
  } else if (type === 'issue') {
    st = Math.max(st, 10);
    tips.push('이슈형은 속도전이라 검색 키워드 없이 가는 제목도 있습니다. 그래도 뒤에 그 이슈의 검색어를 하나 붙이면 하루 이틀 뒤 바닥이 생겨요.');
  } else {
    fix.push('뒤에 사람들이 실제로 검색하는 말(증상·일정·방법·가격·후기 등)이 없습니다. 검색으로 들어올 단어가 없으면 메인에서 내려오는 순간 끝나요.');
  }
  if (!hasBar && !frontSearch.length && kwCount >= 4) {
    st -= 3;
    fix.push('검색 키워드가 ' + kwCount + '개 붙어 나열처럼 보여요. 세로줄(|)로 앞뒤를 나누고 1~2개만 남기세요.');
  }
  st = tsClamp(st, 0, 20);

  /* ── (4) 결말 숨기기 10 ────────────────────────────────────── */
  const spoils = TS_SPOIL_WORD.filter((w) => frontSeg.indexOf(w) >= 0);
  const spoilEnd = TS_SPOIL_END.test(frontSeg);
  const spoiled = spoils.length > 0 || spoilEnd;
  const curio = TS_CURIO.test(frontSeg) || !!hideF.w || dots;
  let hide = 6;
  if (curio) hide += 3;
  if (hideF.w) hide += 2;
  if (spoiled) hide -= 7;
  hide = tsClamp(hide, 0, 10);
  if (spoiled) {
    fix.push('결말을 제목에서 말해 버렸어요("' + (spoils[0] || (frontSeg.match(TS_SPOIL_END) || [''])[0] || '서술형 마무리') + '"). 답을 알려 주면 들어갈 이유가 사라집니다. 제목은 궁금하게, 답은 본문에서 — 질문으로 바꿔 보세요.');
  } else if (curio) {
    good.push('앞부분이 질문·궁금증으로 끝나서 "답을 알아야겠다"는 마음이 남습니다.');
  }

  /* ── (5) 길이·가독성 10 (7기 조합 제목은 길어도 뜬다) ───────── */
  let ln;
  if (len < 16) { ln = 2; fix.push('제목이 ' + len + '자로 너무 짧아요. 뒤에 검색 키워드가 들어갈 자리가 없습니다(22~60자 권장).'); }
  else if (len < 22) { ln = 6; fix.push('조금 짧아요(' + len + '자). 뒤에 검색 키워드 하나만 더 붙이면 22~60자에 들어갑니다.'); }
  else if (len <= 48) ln = 10;
  else if (len <= 80) ln = 9;
  else if (len <= 100) { ln = 6; fix.push('꽤 길어요(' + len + '자). 조합 제목은 길어도 되지만 앞 열 글자 뒤 수식어부터 덜어 내세요.'); }
  else { ln = 3; fix.push('너무 길어요(' + len + '자). 모바일 홈판 카드에서 뒷부분이 잘려 보입니다.'); }

  const total = tsClamp(hook + con + st + hide + ln, 0, 100);
  const parts = [
    { key: 'hook', label: '앞 10글자 후킹', score: hook, max: 40 },
    { key: 'con', label: '구체성', score: con, max: 20 },
    { key: 'st', label: '뒤 검색 키워드', score: st, max: 20 },
    { key: 'hide', label: '결말 숨기기', score: hide, max: 10 },
    { key: 'ln', label: '길이·가독성', score: ln, max: 10 },
  ];
  const weakest = parts.slice().sort((a, b) => (a.score / a.max) - (b.score / b.max))[0];

  let grade, gradeMsg;
  if (total >= 85) { grade = 'S'; gradeMsg = '지금 그대로 홈판 카드로 써도 좋아요.'; }
  else if (total >= 76) { grade = 'A'; gradeMsg = '홈판 카드에서 충분히 힘이 있어요.'; }
  else if (total >= 66) { grade = 'B'; gradeMsg = '잘 읽히는데, 한 군데만 더 조이면 확 올라가요.'; }
  else if (total >= 50) { grade = 'C'; gradeMsg = '홈판용으론 아쉬워요. 앞부분부터 손보면 좋아요.'; }
  else if (frontSearch.length || kwCount >= 3) { grade = 'D'; gradeMsg = '홈판보다 검색용 제목에 가까워요. 앞부분을 후킹으로 바꾸면 점수가 크게 올라요.'; }
  else if (len < 22) { grade = 'D'; gradeMsg = '짧고 얌전해서 피드에서 잘 안 눈에 띄어요.'; }
  else { grade = 'D'; gradeMsg = '앞부분이 얌전해서 피드에서 묻히기 쉬워요.'; }

  const wr = weakest.score / weakest.max;
  const summary = gradeMsg + (wr >= 0.82 ? ''
    : (total >= 80 ? ' 굳이 더 얹자면 ' : ' 가장 아쉬운 곳은 ') + weakest.label + '(' + weakest.score + '/' + weakest.max + ')이에요.');

  /* ── ✅ 좋은 제목 체크 4가지 (강의 체크리스트) ──────────────── */
  const hasCelebFront = !!personF.w || !!hideF.w;
  const kwOk = (tailKw.length > 0 || kwAtEnd) && !frontSearch.length;
  const checks = [
    { ok: hookParts > 0 && hook >= 22, label: '① 앞 열 글자에서 멈추나',
      hint: (hookParts > 0 && hook >= 22) ? '멈추게 하는 재료가 앞에 있어요: ' + [numF.w, hideF.w, personF.w, symF.w, rankF.w, firstF.w, shockF.w, speedF.w].filter(Boolean).join(' · ')
        : (hookParts > 0 ? '재료는 있지만 열 글자 살짝 뒤에 있어요. 그 말을 앞으로 당기세요.' : '숫자 · 연예인 · 정체 숨기기 · 질문 중 하나를 맨 앞에 붙이세요.') },
    { ok: kwOk || (type === 'issue' && !allKw.length),
      label: '② 뒤에 검색 키워드가 원형 그대로 있나' + (type === 'issue' && !allKw.length ? ' (이슈형은 선택)' : ''),
      hint: kwOk ? '뒤에 검색 키워드("' + (tailKw[0] || allKw[0]) + '")가 살아 있어요. 마음대로 바꾸면 검색에 안 걸립니다.'
        : (type === 'issue' && !allKw.length ? '이슈형은 속도전이라 없어도 됩니다. 다만 검색어를 하나 붙이면 하루 이틀 뒤 바닥이 생겨요.'
          : '증상 · 일정 · 방법 · 가격처럼 실제 검색어를 뒤에 그대로 붙이세요.') },
    { ok: !spoiled, label: '③ 결말을 다 말해 버리지 않았나',
      hint: spoiled ? '답을 알려 주면 들어갈 이유가 없어요. "~됩니다" 대신 "~될까?"로 바꾸세요.' : '궁금증이 남아 있어요. 답은 본문에서.' },
    { ok: !!numF.w || hasCelebFront || !!rankF.w, label: '④ 앞에 숫자 · 연예인 · 숨기기가 있나',
      hint: (!!numF.w || hasCelebFront || !!rankF.w) ? '숫자 · 연예인 · 숨기기 중 최소 하나가 앞에 있어요.' : '하나도 없다면 제목을 한 번 더 고민해 보세요.' },
  ];

  /* ── 💡 아쉬운 점 · 이렇게 보완해 보세요 ───────────────────── */
  const coach = [];
  const pr = { hook: hook / 40, con: con / 20, st: st / 20, hide: hide / 10, ln: ln / 10 };
  if (pr.hook < 0.85) {
    coach.push({ key: 'hook', label: '앞 10글자 후킹 ' + hook + '/40',
      msg: '홈판 카드는 앞 열 글자만 크게 보입니다. 지금 시작 "' + head10.trim() + '"은(는) 얌전해요. ' + (TS_TYPE_HOOK[type]) + ' — ' + (TS_COACH[kind] || TS_COACH.generic).hook + ' 중 하나를 맨 앞에 붙이세요.' });
  } else if (pr.hook < 1) {
    coach.push({ key: 'hook', label: '앞 10글자 후킹 ' + hook + '/40',
      msg: '시작은 좋아요. 열 글자 뒤에 물음표나 "그런데" 같은 반전 말 한마디를 붙이면 40점이 됩니다.' });
  }
  if (pr.st < 0.8) {
    coach.push({ key: 'st', label: '뒤 검색 키워드 ' + st + '/20',
      msg: TS_TYPE_COACH[type] + ' 구조는 "앞=후킹 / 뒤=검색 키워드"이고, 가장 노골적인 방법은 세로줄(|) 하나입니다.' });
  } else if (pr.st < 1) {
    coach.push({ key: 'st', label: '뒤 검색 키워드 ' + st + '/20',
      msg: '구조는 좋아요. 뒤쪽 키워드를 1개만 남기고 원형 그대로 두면 더 또렷해집니다.' });
  }
  if (pr.hide < 0.8) {
    coach.push({ key: 'hide', label: '결말 숨기기 ' + hide + '/10',
      msg: spoiled
        ? '제목에서 답을 말해 버렸어요. "~됩니다 / ~입니다" 대신 "~될까?" "~는데?"처럼 물음으로 끝내고 답은 본문에서 주세요.'
        : '앞부분이 단정으로 끝나 궁금증이 남지 않아요. "~될까?" "~는데?" "~다는데"처럼 말끝을 열어 두면 답을 확인하려고 누릅니다.' });
  }
  if (pr.con < 0.75) {
    coach.push({ key: 'con', label: '구체성 ' + con + '/20',
      msg: '무엇이 그런지 보여 줄 숫자·대상이 부족해요. ' + (TS_COACH[kind] || TS_COACH.generic).con + ' 같은 숫자와 고유명사(지역·인물·제품·구단)를 하나씩 넣어 보세요.' });
  }
  if (len < 22) {
    coach.push({ key: 'ln', label: '길이·가독성 ' + ln + '/10',
      msg: '지금 ' + len + '자 — 뒤에 지역명이나 검색 키워드를 붙여 22~60자로 맞춰 보세요.' });
  } else if (len > 80) {
    coach.push({ key: 'ln', label: '길이·가독성 ' + ln + '/10',
      msg: '지금 ' + len + '자 — 조합 제목은 길어도 되지만 앞 열 글자 뒤 수식어부터 덜어 내세요.' });
  }
  if (!coach.length) {
    coach.push({ key: 'all', label: '지금은 크게 아쉬운 곳이 없어요',
      msg: '다섯 가지(앞 열 글자·구체성·뒤 키워드·결말 숨기기·길이) 모두 기준을 넘었어요. 사진 첫 장만 앞 열 글자와 맞추면 더 좋아요.' });
  }
  coach.sort((a, b) => (pr[a.key] == null ? 2 : pr[a.key]) - (pr[b.key] == null ? 2 : pr[b.key]));

  /* ── ✨ 보완한 추천 제목 3개 — 2026-11-21 전면 교체 ─────────────────
     · ① 후킹 강화형 ② 숫자·기준형 ③ 조합(|)형 — 세 개는 각도가 다르다.
     · 같은 분야에서 늘 같은 훅이 붙지 않게 입력 제목(tsSeed)으로 후보를 흩뿌린다.
     · ○ 플레이스홀더는 쓰지 않는다 — 제목에 숫자가 있으면 그 숫자를, 없으면 '기준·질문'을 앞에 놓는다.
     · 입력 제목에 이미 따옴표 훅이 있으면 그 훅을 살리고 순서·| 배치만 바꾼다. */
  /* 그 분야 말이 제목에 2개 이상 걸려야 '분야 훅'을 쓰고, 아니면 어느 글에나 붙는 중립 훅을 쓴다
     (세탁기 글에 '메뉴판부터 봤다'처럼 분야가 어긋난 훅이 붙지 않게) */
  const kindHits = (TS_KIND_WORDS[kind] || []).filter((w) => title.indexOf(w) >= 0).length;
  const bank = (kindHits >= 2 ? (TS_BANK[kind] || []) : []).concat(TS_BANK.generic);
  const askBank = kindHits >= 2 ? (TS_ASK[kind] || TS_ASK.generic) : TS_ASK.generic;
  const seed = tsSeed(title);
  const origHook = (title.match(/["“「『]([^"”」』]{2,26})["”」』]/) || [])[1] || '';
  const numTok = (title.match(/\d[\d,.]*\s*(?:년|개월|주|일|시간|분|초|만원|천원|원|억|만|kg|킬로|mg|ml|도|회|번|%|개|곳|위|명|살|배|편|컵|잔)/) || [''])[0].trim();

  /* 뒤(검색 키워드)는 원형 그대로 — 세로줄 뒤이거나 제목 끝의 키워드 자리 */
  const tailText = tsNorm(tailSeg || '').replace(/^\|\s*/, '');
  /* 앞(후킹 자리) — 세로줄 앞, 없으면 제목에서 뒤 키워드를 뺀 앞부분 */
  let frontText = hasBar ? frontSeg : title;
  if (!hasBar && tailText && frontText.length > tailText.length) {
    frontText = frontText.slice(0, frontText.length - tailText.length);
  }
  const noHook = (s) => {
    let t = String(s);
    if (origHook) t = t.split(origHook).join(' ');
    return tsNorm(t.replace(/["“”「」『』']/g, ' ')).replace(/\s+/g, ' ');
  };
  let core = noHook(frontText);
  if (!core) core = noHook(title);
  core = tsNorm(core).replace(/^[,·\s|]+|[,·\s|.…]+$/g, '');
  const kwTail = (tailKw[0] || allKw[0] || (names.length ? names[names.length - 1] : ''));

  const suggestions = [];
  const addSug = (type2, text) => {
    const t = tsTidy(tsTrim(text, 64));
    if (!t || t === title) return;
    if (suggestions.some((s) => s.text === t)) return;
    if (suggestions.length < 3) suggestions.push({ type: type2, text: t });
  };
  const usedHooks = [];
  const hookWords = (h) => String(h).replace(/["“”「」『』']/g, '').split(/[^0-9A-Za-z가-힣]+/).filter((w) => tsChars(w).length >= 2);
  /* 후보를 seed 자리부터 돌면서, 코어에 이미 있는 말과 겹치지 않는 훅을 고른다 */
  const pickHook = (offset, coreTxt) => {
    const flatCore = tsNorm(coreTxt).replace(/\s+/g, '');
    /* 분야 훅을 먼저 돌고, 다 걸리면 중립 훅으로 내려간다(seed 로 시작 자리를 흩뿌린다) */
    const kindPool = kindHits >= 2 ? (TS_BANK[kind] || []) : [];
    const order = [];
    for (let i = 0; i < kindPool.length; i++) order.push(kindPool[(seed + offset + i) % kindPool.length]);
    for (let i = 0; i < TS_BANK.generic.length; i++) order.push(TS_BANK.generic[(seed + offset + i) % TS_BANK.generic.length]);
    for (let i = 0; i < order.length; i++) {
      const h = order[i];
      if (usedHooks.indexOf(h) >= 0) continue;
      const ws = hookWords(h);
      if (ws.length && ws.every((w) => flatCore.indexOf(w) >= 0)) continue;   // 같은 말이 두 번 나오면 어색
      usedHooks.push(h);
      return h;
    }
    const fb = order[(seed + offset) % order.length];
    usedHooks.push(fb);
    return fb;
  };
  /* 훅 + 코어(길이 맞춰 자름) + 뒤 검색 키워드. bar 면 세로줄로 갈라 7기 공식 그대로 */
  const compose = (hook, coreTxt, tailTxt, bar) => {
    const hk = hook ? String(hook).trim() + ' ' : '';
    const tl = tailTxt ? (bar ? ' | ' + tailTxt : ' ' + tailTxt) : '';
    const room = Math.max(10, 64 - tsChars(hk).length - tsChars(tl).length);
    /* 뒤 키워드와 같은 말이 코어에 또 있으면 한 번만 남긴다('국민연금 … 국민연금' 방지) */
    const tw = tailTxt ? tailTxt.split(' ').filter((w) => tsChars(w) >= 2) : [];
    let src = tsNorm(coreTxt);
    for (const w of tw) {
      const re = new RegExp('(^|\\s)' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'g');
      const hits = (src.match(re) || []).length;
      if (hits > 1) src = src.replace(re, ' ');
    }
    let c = tsTrim(tsNorm(src), room);
    if (!c) c = tsTrim(noHook(title), room);
    return tsTidy(hk + c + tl);
  };
  /* ① 후킹 강화형 — 원래 따옴표 훅이 있으면 그 훅을 살리고(새 훅을 또 붙이지 않고) 뒤만 정리 */
  const n0 = suggestions.length;
  if (origHook) addSug('① 후킹 강화형', compose('"' + origHook + '"', core, tailText, false));
  if (suggestions.length === n0) addSug('① 후킹 강화형', compose(pickHook(0, core), core, tailText, false));
  /* ② 숫자·기준형 — 제목 속 실제 숫자를 앞 10글자로 끌어온다(숫자가 없으면 기준·비교 질문) */
  let core2 = core, hook2;
  if (numTok) {
    /* 제목 속 그 숫자를 앞 10글자로 끌어올린다 — 코어에서는 빼고, 바로 뒤 서술어가 붙어 있으면 같이 정리 */
    const flat = numTok.replace(/\s+/g, '');
    const wsC = tsNorm(core.split(numTok).join(' ').split(flat).join(' ')).split(' ');
    while (wsC.length > 3 && /(었|았|했|였)(는데|고|서|더니|지만|다면)?$/.test(wsC[0])) wsC.shift();
    core2 = wsC.join(' ');
    hook2 = tsNumHook(numTok);
  } else {
    /* 숫자가 없으면 기준·비교 질문으로 각도를 바꾼다 */
    hook2 = askBank[seed % askBank.length];
  }
  addSug('② 숫자·기준형', compose(hook2, core2 || core, tailText, false));
  /* ③ 조합(|)형 — 앞 후킹과 뒤 검색 키워드를 세로줄로 갈라 놓는다 */
  let barTail = tailText, core3 = core;
  const kwForBar = tailKw[0] || allKw[0] || '';        // 실제 검색 키워드일 때만 세로줄 자리로 쓴다
  if (!barTail && kwForBar) {
    const at = core.lastIndexOf(kwForBar);
    if (at > 6 && /\s/.test(core.charAt(at - 1))) {          // 코어 안의 검색 키워드 자리에서 가른다
      barTail = core.slice(at).trim(); core3 = core.slice(0, at).trim();
    }
  }
  if (!barTail) {                                            // 그래도 없으면 끝 세 마디를 뒤로
    const ws = core.split(' ');
    if (ws.length >= 4) {
      let k = Math.min(3, ws.length - 1);
      while (k > 1 && tsChars(ws[ws.length - k]).length < 2) k--;   // '그'·'속' 같은 한 글자로 시작하지 않게
      /* '바뀐 | 얼굴'처럼 관형어(받침 ㄴ·ㄹ, 던/한/될)가 세로줄 앞에서 끊기지 않게 뒤로 넘긴다 */
      const isMod = (w) => {
        if (/(던|한|된|할|될|든)$/.test(w)) return true;
        const c = w.charCodeAt(w.length - 1);
        if (c < 0xAC00 || c > 0xD7A3) return false;
        const jong = (c - 0xAC00) % 28;
        return jong === 4 || jong === 8;   // ㄴ, ㄹ 받침
      };
      while (k < ws.length - 1 && isMod(ws[ws.length - k - 1])) k++;
      barTail = ws.slice(ws.length - k).join(' '); core3 = ws.slice(0, ws.length - k).join(' ');
    }
  }
  /* 한 글자·짧은 꼬리('될까'·'후기')만 남으면 세로줄이 오히려 어색하다 — 그때는 그냥 붙여 쓴다 */
  if (barTail && tsChars(barTail) < 4 && barTail.split(' ').length < 2) barTail = '';
  if (barTail) addSug('③ 조합(앞 후킹 | 뒤 키워드)형', compose(pickHook(1, core3), core3, barTail, true));
  else addSug('③ 조합(앞 후킹 | 뒤 키워드)형', compose(pickHook(1, core), core, '', false));
  if (suggestions.length) {
    tips.push('추천 제목은 강의 공식대로 "앞은 후킹, 뒤는 검색 키워드 원형"으로 다시 짜 본 것입니다. 📋 복사로 바로 쓰거나 🎯 이 제목 채점으로 확인해 보세요.');
    if (numTok) tips.push('②번은 제목에 있던 숫자("' + numTok + '")를 앞으로 끌어온 것이라 새로 지어낸 수치는 없습니다.');
  }
  if (!suggestions.length && total >= 80) tips.push('지금 제목 그대로 발행해도 좋아요. 사진 첫 장만 앞 열 글자 후킹과 맞춰 두면 클릭률이 더 올라가요.');

  return {
    ok: true, title, len, front: head10, total, grade, gradeMsg, summary,
    parts, good: good.slice(0, 4), fix: fix.slice(0, 4), tips, suggestions, coach,
    weakest: weakest.key, soft, kind, type, typeName: TS_TYPE_LABEL[type],
    checks, spoiled, frontSeg, tailSeg,
  };
}
/* ==== SCORER-CORE END ==== */

/* ── 화면 ── */
const SC_EG = [
  '"96kg에서 9개월 만에 뼈말라 되기까지" 마운자로 맞았다던 카더가든 근황',
  '안양 범계 파스타 맛집 추천 후기',
];
/* 주제 칩 — 누르면 그 분야 기준으로 훅·코칭·추천을 다시 만든다 */
const SC_KINDS = [
  ['auto', '자동', '제목을 보고 알아서 판단'],
  ['money', '💰 경제·지원', '지원금·세금·주식·청약'],
  ['sports', '⚾ 스포츠', '야구·축구·경기·이적'],
  ['health', '💪 건강·다이어트', '증상·수치·병원'],
  ['parenting', '🧸 육아·교육', '초등·방학·학원'],
  ['tech', '💻 IT·자동차', '제품·신차·앱'],
  ['food', '🍽️ 맛집·후기', '맛집·여행·체험단'],
];
let SC_NODE = null;
let SC_KIND = LS.get('yc.sckind', 'auto') || 'auto';
if (!SC_KINDS.some((k) => k[0] === SC_KIND)) SC_KIND = 'auto';

function scKindPaint() {
  if (!SC_NODE) return;
  $$('#scKindChips [data-kind]', SC_NODE).forEach((b) => b.classList.toggle('on', b.dataset.kind === SC_KIND));
}

function setScorerKind(kind) {
  if (!SC_KINDS.some((k) => k[0] === kind)) return;
  SC_KIND = kind;
  LS.set('yc.sckind', kind);
  scKindPaint();
  if (SC_NODE && SC_NODE.querySelector('.sc-input').value.trim()) runScorer();
  else toast(kind === 'auto' ? '주제를 자동으로 판단할게요' : '주제를 ' + scKindName(kind) + '(으)로 바꿨어요');
}

const SC_KIND_LABEL = { auto: '자동', money: '💰 경제·지원', sports: '⚾ 스포츠', health: '💪 건강·다이어트',
  parenting: '🧸 육아·교육', tech: '💻 IT·자동차', food: '🍽️ 맛집·후기', celeb: '🎬 연예', generic: '✨ 일반' };

function scKindName(k) {
  const row = SC_KINDS.filter((x) => x[0] === k)[0];
  return row ? row[1].replace(/^[^\w가-힣]+\s*/, '') : k;
}

function scorerNode() {
  if (SC_NODE) return SC_NODE;
  const box = document.createElement('div');
  box.className = 'scorer card';
  box.innerHTML = `
    <div class="sc-head"><span>🎯 홈판 제목 점수기</span><span class="pill dust">7기 2회차 · 앞 10글자</span></div>
    <div class="sc-sub">제목을 넣으면 7기 공식(앞은 후킹 · 뒤는 검색 키워드 · 결말 숨기기)으로 몇 점인지, 어디가 약한지 바로 짚어 드려요. (100점 만점 · 바로 계산)</div>
    <div class="sc-kinds" id="scKindChips">${SC_KINDS.map(([k, label, hint]) =>
      `<button class="sc-kind${SC_KIND === k ? ' on' : ''}" data-sc="kind" data-kind="${k}" title="${esc(hint)}">${esc(label)}</button>`).join('')}</div>
    <div class="sc-row">
      <input class="sc-input" type="text" maxlength="120" placeholder="제목을 붙여넣거나 입력" autocomplete="off" enterkeyhint="go">
      <button class="btn sc-go" data-sc="go">채점</button>
      <button class="btn ghost sc-reset" data-sc="reset" title="입력·결과 지우고 새로 쓰기">리셋</button>
    </div>
    <div class="sc-egs"><span class="lbl">예시</span>
      ${SC_EG.map((t, i) => `<button class="sc-chip" data-sc="eg" data-i="${i}">${esc(t)}</button>`).join('')}
    </div>
    <div class="sc-res"><div class="sc-empty">아직 채점 전이에요. 제목을 넣고 <b>채점</b>을 누르면 점수·등급·보완 포인트가 여기 나와요.</div></div>
  `;
  const inp = box.querySelector('.sc-input');
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runScorer(); }
  });
  return (SC_NODE = box);
}

function mountScorer(slot) {
  const el = typeof slot === 'string' ? $(slot) : slot;
  if (!el) return;
  const node = scorerNode();
  if (node.parentNode !== el) el.insertBefore(node, el.firstChild);
}

function runScorer(rawTitle) {
  const node = scorerNode();
  const inp = node.querySelector('.sc-input');
  const box = node.querySelector('.sc-res');
  if (rawTitle != null) inp.value = rawTitle;
  const r = scoreHomeTitle(inp.value, SC_KIND);
  if (!r.ok && r.blocked && r.blocked.length) {
    box.innerHTML = window.ycBlockBanner(r.blocked, {
      note: '이 제목은 점수를 채점하지 않았어요. 대상 이름을 빼고 다시 써 주세요.',
    }) + '<button class="btn soft sm blk-alt" data-go="silhouette">🎨 사진 대신 안전한 실루엣 썸네일 만들기</button>';
    return;
  }
  if (!r.ok) {
    box.innerHTML = `<div class="sc-empty">제목을 먼저 넣어 주세요.</div>`;
    inp.focus();
    return;
  }
  const chars = tsChars(r.title);
  const barRows = r.parts.map((p) => `
    <div class="sc-bar${(p.score / p.max) < 0.5 ? ' low' : ''}">
      <div class="r"><span>${p.label}</span><span>${p.score}/${p.max}</span></div>
      <div class="t"><i style="width:${Math.max(3, Math.round((p.score / p.max) * 100))}%"></i></div>
    </div>`).join('');
  box.innerHTML = `
    ${r.soft && r.soft.length ? ycSoftBox(r.soft) : ''}
    <div class="sc-top">
      <div class="sc-num">${r.total}<small>점</small></div>
      <div class="sc-badge g${r.grade}">${r.grade} 등급</div>
      <div class="sc-lenv">${r.len}자</div>
    </div>
    <div class="sc-sum">${esc(r.summary)}</div>
    <div class="sc-prev">
      <div class="lb"><span>홈판 카드 미리보기</span><span>앞 10글자</span></div>
      <div class="tt"><span class="hl">${esc(chars.slice(0, 10).join(''))}</span><span class="dim">${esc(chars.slice(10).join(''))}</span></div>
    </div>
    <div class="sc-type">
      <span class="tp">${TS_TYPE_ICON[r.type] || '📚'} ${esc(r.typeName)}</span>
      <span class="tx">${esc(TS_TYPE_HOOK[r.type] || '')}</span>
    </div>
    <div class="sc-bars">${barRows}</div>
    ${(r.checks || []).length ? `<div class="sc-check"><h4>✅ 좋은 제목 체크 4가지</h4><ul>${r.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><b>${c.ok ? '✓' : '✗'} ${esc(c.label)}</b><span>${esc(c.hint)}</span></li>`).join('')}</ul></div>` : ''}
    ${r.good.length ? `<div class="sc-list good"><h4>👍 잘한 점</h4><ul>${r.good.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${(r.coach || []).length ? `<div class="sc-list fix sc-coach"><h4>💡 아쉬운 점 · 이렇게 보완해 보세요</h4><ul>${r.coach.map((c) => `<li><b>${esc(c.label)}</b> — ${esc(c.msg)}</li>`).join('')}</ul></div>` : ''}
    ${(r.suggestions || []).length ? `<div class="sc-sug">
      <div class="h">✨ 보완한 추천 제목 ${r.suggestions.length}개 <span class="kindlbl">${esc(SC_KIND_LABEL[r.kind] || r.kind)} 기준${SC_KIND === 'auto' ? ' · 자동' : ''}</span></div>
      ${r.suggestions.map((s) => `<div class="sug-item">
        <div class="sug-tp">${esc(s.type)}</div>
        <div class="sug-tt">${esc(s.text)}</div>
        <div class="sug-btns">
          <button data-sc="copy" data-copy="${esc(s.text)}">📋 복사</button>
          <button data-sc="try" data-title="${esc(s.text)}">🎯 이 제목 채점</button>
        </div>
      </div>`).join('')}
    </div>` : ''}
    ${r.tips.length ? `<div class="sc-tips">${r.tips.map((t) => '💡 ' + esc(t)).join('<br>')}</div>` : ''}
  `;
}

function resetScorer() {
  const node = scorerNode();
  const inp = node.querySelector('.sc-input');
  const box = node.querySelector('.sc-res');
  inp.value = '';
  box.innerHTML = `<div class="sc-empty">아직 채점 전이에요. 제목을 넣고 <b>채점</b>을 누르면 점수·등급·보완 포인트가 여기 나와요.</div>`;
  inp.focus();
  toast('지웠어요 · 새 제목을 넣어 주세요');
}

function renderScorer() {
  $('#view-scorer').innerHTML = `
    <div class="sec">
      <div class="hero" style="padding:18px 20px">
        <div class="hero-top">
          <div class="avatar">🎯</div>
          <div><h2>홈판 제목 점수기</h2>
            <div class="hero-sub">제목 붙여넣기 → 채점 → 약한 곳만 고치기 · 7기 2회차 공식(앞은 후킹 · 뒤는 키워드 · 결말 숨기기) 100점</div></div>
        </div>
      </div>
    </div>
    <div class="sec"><div id="scorerSlotFull"></div></div>
  `;
  mountScorer('#scorerSlotFull');
}

/* ───────────────────────── 오늘의 소재 · 실시간 새로고침 ─────────────────────────
   정적 페이지(GitHub Pages)라도, 버튼을 누르면 브라우저가 직접 최신 목록을 다시 받아온다.
   · 연예 실시간 : 네이버 엔터 실시간 랭킹  (r.jina.ai 경유 · CORS 허용)
   · 커뮤 베스트 : 네이트 실시간 관심 랭킹  (r.jina.ai 경유)
   · 방송·경기   : 네이버 스포츠 많이 본 뉴스(r.jina.ai 경유)
   위 경로가 막히면 구글뉴스 RSS(rss2json 경유)로 대체하고,
   어디서 받았는지 source 줄에 그대로 적는다. */
const GN_RSS = 'https://news.google.com/rss/headlines/section/topic/';
const JINA = 'https://r.jina.ai/';
const LIVE_SOURCES = {
  ent: { label: '연예 실시간', kind: '' },
  community: { label: '커뮤 베스트', kind: '' },
  broadcast: { label: '방송·경기', kind: '경기·스포츠' },
};
const kstStamp = () => new Date(Date.now() + KST_OFF).toISOString().slice(0, 16);

async function fetchText(url, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms || 15000);
  try {
    const r = await fetch(url, { signal: c.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

function jinaText(url) { return fetchText(JINA + url, 22000); }

function mdClean(s) {
  return String(s || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\\`*_#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 네이트 실시간 관심 랭킹 (마크다운 링크: [제목](https://news.nate.com/view/…)) */
function nateRows(md) {
  const re = /\[([^\[\]]{6,200})\]\((https:\/\/news\.nate\.com\/view\/[^)\s]+)\)/g;
  const rows = [], seen = new Set();
  let m;
  while ((m = re.exec(md)) && rows.length < 20) {
    const title = mdClean(m[1].replace(/\\/g, ''));
    if (title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    rows.push({ title, url: m[2], src: '네이트 랭킹', at: '' });
  }
  return rows;
}

/* 네이버 엔터 실시간 랭킹: 줄마다 [_N위_ ![img](…) _제목_ 요약] 형태 */
function naverEntRows(md) {
  const rows = [], seen = new Set();
  for (const line of md.split('\n')) {
    const m = line.match(/_(\d{1,2})위_\s*(?:!\[[^\]]*\]\([^)]*\))?\s*_([^_]{6,200})_/);
    if (!m) continue;
    const title = mdClean(m[2]);
    if (title.length < 6 || seen.has(title)) continue;
    seen.add(title);
    const u = line.match(/\]\((https:\/\/m?\.?entertain\.naver\.com\/[^)\s]+)\)/);
    rows.push({ title, url: u ? u[1] : '', src: '네이버 엔터 랭킹', at: '' });
    if (rows.length >= 20) break;
  }
  return rows;
}

/* 네이버 스포츠 '많이 본 뉴스': [![img](…) 제목](https://m.sports.naver.com/<종목>/article/…) */
function naverSportsRows(md) {
  const re = /\[((?:[^\[\]]|\[[^\]]*\]){4,400})\]\((https:\/\/m\.sports\.naver\.com\/[^)\s]+)\)/g;
  const rows = [], seen = new Set();
  let m;
  while ((m = re.exec(md)) && rows.length < 20) {
    const url = m[2];
    if (!/\/article\//.test(url)) continue;
    const title = mdClean(m[1])
      .replace(/^\d{1,2}위\s*/, '')
      .replace(/^\d{1,2}\s*/, '')
      .replace(/\s*조회수\s*[\d,]+\s*$/, '');
    if (title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    rows.push({ title, url, src: '네이버 스포츠 랭킹', at: '' });
  }
  return rows;
}

/* 대체 피드: 구글뉴스 RSS → rss2json (CORS 허용, 캐시될 수 있음) */
async function rssRows(feed) {
  const u = 'https://api.rss2json.com/v1/api.json?count=20&rss_url=' + encodeURIComponent(feed);
  const txt = await fetchText(u, 15000);
  let j = null;
  try { j = JSON.parse(txt); } catch { throw new Error('RSS 응답 아님'); }
  if (!j || j.status !== 'ok') throw new Error('RSS ' + ((j && j.status) || '실패'));
  const rows = [];
  for (const it of j.items || []) {
    let title = String(it.title || '').replace(/\s+/g, ' ').trim();
    let src = '';
    const m = title.match(/^(.*)\s+-\s+([^-]{2,20})$/);
    if (m) { title = m[1].trim(); src = m[2].trim(); }
    if (!title) continue;
    rows.push({ title, url: it.link || '', src, at: String(it.pubDate || '').replace(' ', 'T').slice(0, 16) });
    if (rows.length >= 20) break;
  }
  return rows;
}

/* 탭별 수집 순서 (앞에서 성공하면 그걸 쓴다) */
const LIVE_PLANS = {
  ent: [
    async () => ({ rows: naverEntRows(await jinaText('https://entertain.naver.com/ranking')),
      source: '네이버 엔터 실시간 랭킹 (브라우저 새로고침)' }),
    async () => ({ rows: await rssRows(GN_RSS + 'ENTERTAINMENT?hl=ko&gl=KR&ceid=KR:ko'),
      source: '대체 피드 · Google 뉴스 연예 (브라우저 새로고침)' }),
  ],
  community: [
    async () => ({ rows: nateRows(await jinaText('https://news.nate.com/rank/interest?sc=all')),
      source: '네이트 실시간 관심 랭킹 (브라우저 새로고침)' }),
    async () => ({ rows: await rssRows('https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'),
      source: '대체 피드 · Google 뉴스 인기 (브라우저 새로고침)' }),
  ],
  broadcast: [
    async () => ({ rows: naverSportsRows(await jinaText('https://m.sports.naver.com/ranking/index')),
      source: '네이버 스포츠 많이 본 뉴스 랭킹 (브라우저 새로고침)' }),
    async () => ({ rows: await rssRows(GN_RSS + 'SPORTS?hl=ko&gl=KR&ceid=KR:ko'),
      source: '대체 피드 · Google 뉴스 스포츠 (브라우저 새로고침)' }),
  ],
};

function finishLive(tab, rows, source) {
  const kind = LIVE_SOURCES[tab].kind;
  const out = rows.slice(0, 20).map((r, i) => {
    const o = Object.assign({ rank: i + 1 }, r);
    if (kind) o.kind = kind;
    return o;
  });
  return { date: kstDate(), collected_at: kstStamp(), source, rows: out };
}

async function buildLive(tab) {
  const errs = [];
  for (const step of LIVE_PLANS[tab] || []) {
    try {
      const got = await step();
      if (got && (got.rows || []).length) return finishLive(tab, got.rows, got.source);
      errs.push('빈 목록');
    } catch (e) { errs.push(String((e && e.message) || e).slice(0, 30)); }
  }
  throw new Error(errs.join(' / ') || '결과 없음');
}

async function refreshMat(tab, btn) {
  const cfg = LIVE_SOURCES[tab];
  if (!cfg) return;
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.textContent = '⏳ 불러오는 중…'; }
  try {
    const d = await buildLive(tab);
    APP.state.liveMaterials = APP.state.liveMaterials || {};
    APP.state.liveMaterials[tab] = d;
    saveLocal(); queuePush(); renderAll();
    toast(cfg.label + ' ' + d.rows.length + '건 새로 불러왔어요');
  } catch (e) {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = '🔄 새로고침'; }
    toast('새로고침 실패 · ' + String((e && e.message) || e).slice(0, 40));
  }
}

/* ───────────────── 🔄 오늘 발행글 한 번에 불러오기 (2026-11-20 추가 · 같은 날 프록시 재구성) ─────────────────
   네이버 블로그 6곳의 RSS(rss.blog.naver.com/{id}.xml)를 브라우저가 직접 읽어,
   '오늘'과 '기수 안의 어제' 발행 글을 인증 달력에 자동 등록한다.
   · 네이버 RSS 는 CORS 를 열지 않아서 브라우저가 직접 못 읽는다. 그래서 두 갈래로 받는다.
       A) 같은 출처의 RSS 스냅샷  docs/data/rss_latest.json
          — GitHub Actions(.github/workflows/rss-latest.yml)가 10분마다 6곳을 긁어 커밋한다.
            프록시·한도·CORS 가 없어서 0.05~0.2초에 6곳 전부 온다. 2026-11-21 추가.
       B) 실시간 프록시 — api.rss2json.com 만 지금도 살아 있다(2026-11-21 실측).
          단 무료 한도가 '짧은 시간에 새 피드 4곳' 이라 5·6번째부터 HTTP 429.
          allorigins(get·raw)·codetabs 는 요즘 10~15초 타임아웃이라 마지막 시도로만 남긴다.
     순서(블로그 한 곳마다): rss2json(실시간) → 스냅샷(즉시) → 예전 프록시 → 최근 저장본.
     · rss2json 이 429/타임아웃으로 두 번 실패하면 그 실행에서는 건너뛴다(쓸데없이 기다리지 않게).
       남은 블로그는 스냅샷으로 0.5초 안에 채워진다.
     · corsproxy.io 는 2026-11-20 부터 API 키를 요구(401), cors.lol·cors.eu.org·feed2json 은
       CORS 헤더가 없거나 429 라 2026-11-21 확인 후 뺐다.
   · 발행 시각은 KST 로 바꿔 날짜를 정하고, 이미 등록된 주소·지운 글(tombstone)은 건너뛴다.
   · 점수 규칙(하루 10편까지 인정)을 넘지 않게만 채운다. */
const RSS_SNAPSHOT_URL = 'data/rss_latest.json';      // Actions 가 10분마다 갱신(같은 출처 · CORS 없음)
const RSS_SNAPSHOT_FRESH_MS = 45 * 60 * 1000;         // 이보다 오래되면 '오래된 스냅샷'으로 표시
const RSS_ROUTES = [
  { id: 'rss2json', kind: 'json', ms: 7000, make: (u) => 'https://api.rss2json.com/v1/api.json?count=20&rss_url=' + encodeURIComponent(u) },
  { id: 'allorigins/get', kind: 'wrap', ms: 12000, make: (u) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u) },
  { id: 'codetabs', kind: 'xml', ms: 11000, make: (u) => 'https://api.codetabs.com/v1/proxy?quest=' + u },
  { id: 'allorigins/raw', kind: 'xml', ms: 11000, make: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
];
const RSS_CACHE_MS = 10 * 60 * 1000;         // 위가 전부 막히면 최근 10분 저장본을 쓴다(마지막 안전망)
const RSS_STAT = {};                          // 블로그별로 실제 성공한 경로 (진단용 · 화면엔 안 보임)
const RSS_SNAP = { p: null, blogs: null, age: null, at: '' };   // 스냅샷 1회 로드(모든 블로그가 같이 쓴다)
const RSS_RL = { fails: 0, tripped: false, at: 0 };             // rss2json 한도(429) 회로 차단기

/** 주소 정규화 — 같은 글을 다른 주소로 두 번 등록하지 않게 (쿼리·모바일 도메인 제거) */
function urlKey(u) {
  const s = String(u || '').trim().split('#')[0].split('?')[0].replace(/\/+$/, '');
  return s.replace(/^http:\/\//i, 'https://').replace(/^https:\/\/m\.blog\.naver\.com\//i, 'https://blog.naver.com/');
}

/** 두 목록을 주소 기준으로 합친다(실시간 + 스냅샷 → 빠진 글 없이) */
function rssMergeRows(a, b) {
  const out = [], seen = Object.create(null);
  for (const it of (a || []).concat(b || [])) {
    if (!it || !it.url || !it.at) continue;
    if (seen[it.url]) continue;
    seen[it.url] = 1; out.push(it);
  }
  return out.sort((x, y) => String(x.at).localeCompare(String(y.at)));
}

/** 배포된 RSS 스냅샷(data/rss_latest.json) — 페이지당 한 번만 받아 6곳이 같이 쓴다 */
function loadRssSnapshot() {
  if (RSS_SNAP.p) return RSS_SNAP.p;
  RSS_SNAP.p = (async () => {
    try {
      const txt = await fetchText(RSS_SNAPSHOT_URL + '?v=' + Date.now(), 6000);
      const j = JSON.parse(txt);
      const blogs = {};
      const src = (j && j.blogs) || {};
      for (const h of Object.keys(src)) {
        const rows = [];
        for (const it of ((src[h] && (src[h].items || src[h].rows)) || [])) {
          const t = Array.isArray(it) ? it[0] : (it && it.title);
          const u = Array.isArray(it) ? it[1] : (it && it.url);
          const a = Array.isArray(it) ? it[2] : (it && it.at);
          const title = String(t || '').replace(/\s+/g, ' ').trim();
          const url = urlKey(u);
          const at = String(a || '').slice(0, 16);
          if (title && url && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) rows.push({ title, url, at });
        }
        if (rows.length) blogs[h] = rssMergeRows(rows, []);
      }
      const ts = Number(j && j.generated_ts) || 0;
      RSS_SNAP.blogs = blogs;
      RSS_SNAP.age = ts ? Date.now() - ts : null;
      RSS_SNAP.at = (j && j.generated_at) || '';
      return blogs;
    } catch (e) {
      RSS_SNAP.blogs = RSS_SNAP.blogs || {};      // 받기 실패해도 이미 있는 건 쓴다
      RSS_SNAP.age = null;
      return RSS_SNAP.blogs;
    }
  })();
  return RSS_SNAP.p;
}

/** RSS pubDate('Fri, 20 Nov 2026 08:30:00 +0900') → KST 'YYYY-MM-DD HH:MM' */
function rssDateKst(txt) {
  if (!txt) return null;
  const t = Date.parse(String(txt).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (!isFinite(t)) return null;
  return new Date(t + KST_OFF).toISOString().slice(0, 16);
}

/** 네이버 블로그 RSS XML → [{title, url, at(KST)}] */
function parseRssXml(xml) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (!doc || doc.getElementsByTagName('parsererror').length) throw new Error('XML 형식 아님');
  const out = [];
  for (const it of Array.from(doc.getElementsByTagName('item'))) {
    const pick = (tag) => {
      try {
        const el = it.getElementsByTagName(tag)[0];
        return el ? String(el.textContent || '').trim() : '';
      } catch { return ''; }
    };
    const title = pick('title').replace(/\s+/g, ' ');
    const url = urlKey(pick('guid') || pick('link'));
    const at = rssDateKst(pick('pubDate') || pick('dc:date'));
    if (title && url && at) out.push({ title, url, at });
  }
  return out;
}

/** rss2json 응답 → [{title, url, at(KST)}] (pubDate 는 UTC 로 온다) */
function parseRssJson(j) {
  if (!j || j.status !== 'ok') throw new Error('RSS ' + ((j && j.status) || '실패'));
  const out = [];
  for (const it of j.items || []) {
    const title = String(it.title || '').replace(/\s+/g, ' ').trim();
    const url = urlKey(it.link);
    const t = Date.parse(String(it.pubDate || '').replace(' ', 'T') + 'Z');
    if (!title || !url || !isFinite(t)) continue;
    out.push({ title, url, at: new Date(t + KST_OFF).toISOString().slice(0, 16) });
  }
  return out;
}

/** 블로그 한 곳의 최신 글
 *  rss2json(실시간) → 배포 스냅샷(즉시 · 한도 없음) → 예전 프록시 → 최근 저장본(10분)
 *  · snapRows: importTodayPosts 가 미리 받아 둔 스냅샷 목록(이 블로그 몫) */
async function fetchBlogPosts(handle, snapRows) {
  const rss = 'https://rss.blog.naver.com/' + handle + '.xml';
  const errs = [];
  let live = null;

  // 1) 실시간 — rss2json 만 아직 살아 있다. 두 번 막히면 이번 실행에서는 건너뛴다.
  const r0 = RSS_ROUTES[0];
  if (!RSS_RL.tripped) {
    try {
      const rows = parseRssJson(JSON.parse(await fetchText(r0.make(rss), r0.ms)));
      if (rows.length) live = rows;
      else errs.push('rss2json 빈 응답');
    } catch (e) {
      const msg = String((e && e.message) || e);
      errs.push('rss2json ' + msg.slice(0, 18));
      if (/429|40[0-9]|Failed to fetch|abort|timeout/i.test(msg)) {
        RSS_RL.fails++;
        if (RSS_RL.fails >= 2) { RSS_RL.tripped = true; RSS_RL.at = Date.now(); }
      }
    }
  } else errs.push('rss2json 건너뜀');

  // 2) 배포 스냅샷 — 같은 출처라 CORS·한도가 없다(보람 0.05~0.2초)
  const snap = (snapRows && snapRows.length) ? snapRows : null;
  if (live) {
    const rows = snap ? rssMergeRows(live, snap) : live;
    RSS_STAT[handle] = snap ? 'rss2json+스냅샷' : 'rss2json';
    rssCacheSet(handle, rows);
    return rows;
  }
  if (snap) {
    const mins = RSS_SNAP.age == null ? null : Math.round(RSS_SNAP.age / 60000);
    RSS_STAT[handle] = '스냅샷' + (mins == null ? '' : '(' + mins + '분 전)')
      + (RSS_SNAP.age != null && RSS_SNAP.age > RSS_SNAPSHOT_FRESH_MS ? '·오래됨' : '');
    rssCacheSet(handle, snap);
    return snap;
  }

  // 3) 예전 프록시 — 요즘은 거의 타임아웃이지만 혹시 모를 길이라 남긴다
  for (const r of RSS_ROUTES.slice(1)) {
    try {
      const txt = await fetchText(r.make(rss), r.ms);
      let rows;
      if (r.kind === 'json') rows = parseRssJson(JSON.parse(txt));
      else if (r.kind === 'wrap') { const j = JSON.parse(txt); rows = parseRssXml((j && (j.contents || j.body)) || ''); }
      else rows = parseRssXml(txt);
      if (rows && rows.length) { rssCacheSet(handle, rows); RSS_STAT[handle] = r.id; return rows; }
      errs.push(r.id + ' 빈 응답');
    } catch (e) { errs.push(r.id + ' ' + String((e && e.message) || e).slice(0, 20)); }
  }
  // 4) 마지막 안전망 — 10분 안에 성공한 저장본
  const old = rssCacheGet(handle);
  if (old) { RSS_STAT[handle] = '저장본(10분 내)'; return old; }
  throw new Error(errs.join(' / ') || '결과 없음');
}
function rssCacheGet(h) {
  try {
    const j = JSON.parse(localStorage.getItem('yc.rss.' + h) || 'null');
    if (j && j.at && Date.now() - j.at < RSS_CACHE_MS && Array.isArray(j.rows) && j.rows.length) return j.rows;
  } catch { /* 저장본이 깨졌으면 그냥 새로 받는다 */ }
  return null;
}
function rssCacheSet(h, rows) {
  try { localStorage.setItem('yc.rss.' + h, JSON.stringify({ at: Date.now(), rows: rows.slice(-60) })); } catch { /* 용량 초과는 무시 */ }
}

/** 6곳을 한 번에 불러와 오늘(및 기수 안의 어제) 글을 자동 등록
 *  · 먼저 배포 스냅샷을 한 번 받아 둔다(모든 블로그 공통 · 실패해도 나머지는 그대로 진행)
 *  · 실시간 프록시 rate limit 을 피하려고 2곳씩 끊어 220ms 간격으로 부른다(6곳 동시 호출 금지)
 *  · rss2json 이 막힌 블로그는 스냅샷으로 바로(0.5초 안에) 채운다
 *  · 그래도 실패한 곳만 0.6초 뒤 1회 더 시도한다 */
async function importTodayPosts(btn) {
  const s = APP.state, round = activeRound();
  if (!s || !round) return;
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.textContent = '⏳ 6곳 불러오는 중…'; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setBusy = (txt) => { if (btn && btn.isConnected) btn.textContent = txt; };

  // 429 회로 차단기는 5분 지나면 한 번씩 다시 열어 본다
  if (RSS_RL.tripped && RSS_RL.at && Date.now() - RSS_RL.at > 5 * 60 * 1000) {
    RSS_RL.tripped = false; RSS_RL.fails = 0;
  }

  // 스냅샷은 백그라운드로 먼저 띄워 두고, 2.5초까지만 기다린다(그 뒤엔 이미 받은 만큼)
  const snapP = loadRssSnapshot();
  await Promise.race([snapP, sleep(2500)]);
  const snapMap = RSS_SNAP.blogs || {};

  const today = kstDate();
  const dates = [today];
  const yest = addDays(today, -1);
  if (roundDays(round).includes(yest)) dates.push(yest);   // 기수 안의 어제 글도 빈 칸이면 채운다

  /* 매번 다른 블로그부터 시작한다 — rss2json 은 '짧은 시간 새 피드 4곳'만 열어 줘서
     늘 같은 4곳만 실시간이 되기 때문. 누른 횟수만큼 순서를 돌려 6곳이 번갈아 실시간이 된다. */
  let rot = 0;
  try {
    rot = (parseInt(localStorage.getItem('yc.rssrot') || '0', 10) || 0) + 1;
    localStorage.setItem('yc.rssrot', String(rot));
  } catch { rot = Math.floor(Date.now() / 60000) % 6; }
  const nB = Math.max(1, s.blogs.length), r0 = rot % nB;
  const blogs = s.blogs.slice(r0).concat(s.blogs.slice(0, r0));
  const GAP_MS = 220, BATCH = 2;
  const got = new Array(blogs.length).fill(null);
  for (let i = 0; i < blogs.length; i += BATCH) {
    const grp = blogs.slice(i, i + BATCH);
    setBusy('⏳ ' + (i + 1) + '~' + (i + grp.length) + '/' + blogs.length + '곳 불러오는 중…');
    const res = await Promise.allSettled(grp.map((b) => fetchBlogPosts(b.handle || b.id, snapMap[b.handle || b.id])));
    res.forEach((r, k) => { got[i + k] = r; });
    if (i + BATCH < blogs.length) await sleep(GAP_MS);
  }
  // 한 번에 실패한 곳만 다시 (프록시가 잠깐 막힌 경우가 대부분)
  const miss = got.map((r, i) => ((!r || r.status !== 'fulfilled') ? i : -1)).filter((i) => i >= 0);
  if (miss.length) {
    setBusy('⏳ ' + miss.length + '곳 다시 시도 중…');
    await sleep(600);
    for (const i of miss) {                                  // 재시도도 한 곳씩(간격 200ms)
      try { got[i] = { status: 'fulfilled', value: await fetchBlogPosts(blogs[i].handle || blogs[i].id, snapMap[blogs[i].handle || blogs[i].id]) }; }
      catch { /* 실패로 남긴다 */ }
      await sleep(200);
    }
  }
  const parts = [], fails = [];
  let total = 0, skipped = 0, over = 0;

  got.forEach((r, i) => {
    const b = blogs[i];
    if (!r || r.status !== 'fulfilled') { fails.push(b.name); return; }
    let added = 0;
    const items = r.value.slice().sort((a, c) => String(a.at).localeCompare(String(c.at)));   // 발행 순서대로
    for (const it of items) {
      const d = it.at.slice(0, 10);
      if (!dates.includes(d)) continue;
      if (s.removed && s.removed[it.url]) { skipped++; continue; }        // 지운 글은 되살리지 않는다
      if (findUrl(it.url)) { skipped++; continue; }                       // 이미 등록된 글
      const e = ensureEntry(d, b.id);
      if (livePosts(e).length >= DAY_POST_CAP) { over++; continue; }      // 점수 인정 한도
      e.posts.push({ url: it.url, title: it.title, at: it.at + '+09:00', src: 'rss' });
      e.ts = Date.now();                                                 // 동기화에서 이 기록이 이기게
      added++; total++;
    }
    if (added) parts.push(b.name + ' ' + added + '편');
  });

  if (btn) { btn.disabled = false; delete btn.dataset.busy; btn.textContent = label || '🔄 오늘 발행글 한 번에 불러오기'; }

  const failTxt = fails.length ? ' · ' + fails.join('·') + ' ' + fails.length + '곳은 다시' : '';
  /* 실시간이 아닌 '배포 스냅샷'으로 채운 곳이 많고 그 스냅샷이 오래됐으면 한 번 더 누르라고 알려 준다 */
  const snapOnly = Object.keys(RSS_STAT).filter((h) => String(RSS_STAT[h]).indexOf('스냅샷') >= 0 && String(RSS_STAT[h]).indexOf('rss2json') < 0).length;
  const staleTxt = (snapOnly && RSS_SNAP.age != null && RSS_SNAP.age > 45 * 60 * 1000)
    ? ' · ' + snapOnly + '곳은 ' + Math.round(RSS_SNAP.age / 60000) + '분 전 목록이라 한 번 더 누르면 최신이에요' : '';
  if (total) {
    saveLocal(); queuePush(); renderAll();
    const head = parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ' 등' : '');
    toast(head + ' 총 ' + total + '편 불러왔어요' + failTxt + staleTxt, (fails.length || staleTxt) ? 4200 : 2600);
  } else if (fails.length) {
    toast(fails.length + '곳을 못 불러왔어요(' + fails.join('·') + ') · 잠시 뒤 다시 눌러 주세요', 4200);
  } else {
    toast((over ? '오늘 치는 다 찼어요' : '새로 등록할 글이 없어요 · 이미 다 등록됐어요') + ' (' + blogs.length + '곳 모두 확인)', 2600);
  }
  try { console.info('[RSS] 경로', JSON.stringify(RSS_STAT), '스냅샷', RSS_SNAP.at || '없음'); } catch { /* 무시 */ }
  return { total, parts, fails, skipped, over, routes: Object.assign({}, RSS_STAT),
           snapAt: RSS_SNAP.at || '', snapAge: RSS_SNAP.age };
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
    const posts = livePosts(e);
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
/** 지운 글은 tombstone 으로 걸러낸다 (다른 기기에서 되살아나지 않게) */
function livePosts(e) {
  if (!e) return [];
  const rm = APP.state.removed || {};
  return (e.posts || []).filter((p) => !rm[p.url]);
}

function findUrl(url) {
  const norm = (u) => String(u || '').split('?')[0].replace(/\/$/, '');
  const target = norm(url);
  for (const [date, day] of Object.entries(APP.state.entries || {})) {
    for (const [bid, e] of Object.entries(day)) {
      for (const p of livePosts(e)) {
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
      if (APP.state.removed && APP.state.removed[u]) delete APP.state.removed[u];
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
  if (tab === 'scorer') renderScorer();
  if (tab === 'formatter') ftRender();
  if (tab === 'merge') { /* 정적 */ }
  if (tab === 'silhouette') renderSilhouette();
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

    const impToday = t.closest('[data-act="importtoday"]');
    if (impToday) {
      if (impToday.dataset.busy) return;
      importTodayPosts(impToday); return;
    }

    const del = t.closest('[data-del]');
    if (del) {
      const [bid, date, url] = del.dataset.del.split('|');
      const enc = ensureEntry(date, bid);
      enc.posts = enc.posts.filter((p) => p.url !== url);
      APP.state.removed = APP.state.removed || {};
      APP.state.removed[url] = Date.now();
      enc.ts = Date.now();
      saveLocal(); queuePush(); openDay(date); renderAll(); toast('삭제했어요');
      return;
    }

    const scBtn = t.closest('[data-sc]');
    if (scBtn) {
      const act = scBtn.dataset.sc;
      if (act === 'go') { runScorer(); return; }
      if (act === 'reset') { resetScorer(); return; }
      if (act === 'kind') { setScorerKind(scBtn.dataset.kind); return; }
      if (act === 'try') { runScorer(scBtn.dataset.title || ''); return; }
      if (act === 'eg') { runScorer(SC_EG[Number(scBtn.dataset.i)] || ''); return; }
      if (act === 'copy') { copyText(scBtn.dataset.copy).then((ok) => toast(ok ? '제목을 복사했어요' : '복사가 막혀 있어요 · 길게 눌러 복사해 주세요')); return; }
      return;
    }

    const mtab = t.closest('[data-mtab]');
    if (mtab) { APP.ui.matTab = mtab.dataset.mtab; renderMaterials(); return; }

    const rf = t.closest('[data-refresh]');
    if (rf) {
      if (rf.dataset.busy) return;
      refreshMat(rf.dataset.refresh, rf);
      return;
    }

    const md = t.closest('[data-mdate]');
    if (md) { /* 날짜 이동: 보관된 날짜로만 */ moveMatDate(Number(md.dataset.mdate)); return; }

    const rm = t.closest('[data-rmode]');
    if (rm) { APP.ui.rankMode = rm.dataset.rmode; renderChallenge(); return; }

    const tp = t.closest('[data-topic]');
    if (tp) { APP.ui.topic = tp.dataset.topic; renderMaterials(); return; }

    const th = t.closest('[data-th]');
    if (th) { APP.ui.thTopic = th.dataset.th; renderMaterials(); return; }

    const csv = t.closest('[data-csv]');
    if (csv) { downloadCsv(csv.dataset.csv); return; }

    const pick = t.closest('[data-pick]');    if (pick) {
      const k = pick.dataset.pick;
      const txt = pick.dataset.copy || '';
      const what = k.indexOf('kw:') === 0 ? '키워드' : '제목';
      if (APP.state.picks[k]) {
        delete APP.state.picks[k];
        toast('쓸게요 해제됐어요');
      } else {
        APP.state.picks[k] = true;
        copyText(txt).then((ok) => {
          if (!ok) toast(what + ' 복사는 브라우저가 막고 있어요 · 쓸게요만 체크했어요');
        });
        const scIn = SC_NODE && SC_NODE.querySelector('.sc-input');
        if (scIn && !scIn.value.trim()) scIn.value = txt;
        toast(what + ' 복사 + 쓸게요 체크됐어요!');
      }
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
  if (tab === 'formatter') ftInit();
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

/* ───────────────────────── ✨ 서식 변환기 ───────────────────────── */
/* 블로그별 서식 프리셋 — 실제 발행 글 HTML 직접 확인값(2026-11-20)
   · 네이버 스마트에디터 ONE은 글자 크기를 `se-fs-fsNN`(= NN px) 클래스로 저장한다.
     실제 글 실측: 본문 se-fs-fs16(16px) · 소제목 se-fs-fs30(28~30px) · 형광펜·강조 se-fs-fs19(19px) · 인용구 se-fs-fs24(24px).
     → 그래서 프리셋 수치는 pt가 아니라 px로 쓴다(16px = 에디터 16, 30px = 에디터 30).
   · 확인한 글: blog.naver.com/ye_zib 224476288886·224482812032, /savedesk 224484151415,
     /pick_moa 224482804309, /worddesk 224482801772·224477433733, /mybodydesk 224482707737
   · 소제목 왼쪽 세로선은 실제 글에 없다(전 글 border-left 0건) → 넣지 않는다.
   · 첫인사는 예지브러리만(안녕하세요, 예브예요🤍). 나머지 블로그 글에는 없다 → 자동 삽입 안 함.
   · 마무리 끝인사(인용구 3줄)도 예지브러리만 자동 삽입. 나머지 6곳은 넣지 않는다(2026-11-20).
   · 내몸데스크는 문서 확정값(포인트 #1F7A5C · 형광펜 #c2f4db · 표 #e5fcf0) 유지. */
/* 블로그별 프리셋. 마무리 끝인사 자동 삽입은 예지브러리(closingQuote)만 쓴다 — 나머지 6곳은 넣지 않는다(2026-11-20 지시). */
const FT_BLOGS = [
  {
    id: 'ye_zib', name: '예지브러리', emoji: '📚', handle: 'ye_zib',
    badge: '#C88189', accent: '#B26F79',
    hl: '#FFD6E0', hlSize: 19, boldColor: '#000000', boldSize: 0,
    body: 16, sub: 30, subColor: '#000000', h1: 24, text: '#000000',
    quote: { bg: '#FFF8F6', bar: '#DFA2A5', color: '#000000', size: 24 },
    hr: '#EFE2DA', th: '#FBEAEC',
    greet: '안녕하세요, **예브**예요🤍',
    tone: '담백한 해요체 · 인용구 훅 2줄',
    rules: ['본문 16px · 연핑크 형광펜 #FFD6E0', '소제목 30px · 첫인사 자동', '인용구 훅 · 형광펜 문장 19px'],
    closing: ['💬 예브의 한마디', '오늘도 예지브러리에 이야기 하나를 꽂아둡니다. 📚', '먹고, 써보고, 놀고! 예지브러리였습니다 📚'],
    // 실제 발행 글(ye_zib 224482812032)의 마무리 인용구 3줄 — 예지브러리에만 자동 삽입
    closingStyle: 'quote',
    closingQuote: '먹고, 써보고, 놀고!\n직접 경험한 이야기부터 궁금해서 끝까지 파헤쳐 본 이야기까지.\n예브의 잡다한 취향을 담은 작은 도서관, **예지브러리**였습니다. 📚',
  },
  {
    id: 'pick_moa', name: '픽모아', emoji: '🛍️', handle: 'pick_moa',
    badge: '#3D6DB5', accent: '#2C5B9E',
    hl: '#FFF1C2', hlSize: 19, boldColor: '#000000', boldSize: 0,
    body: 16, sub: 30, subColor: '#000000', h1: 24, text: '#000000',
    quote: { bg: '#F5F9FE', bar: '#9DBBE6', color: '#000000', size: 24 },
    hr: '#DCE6F2', th: '#E8F0FB',
    tone: '담백한 해요체 · 스펙·요약 강조',
    rules: ['본문 16px · 연노랑 형광펜 #FFF1C2', '소제목 30px · 첫인사 없음', '핵심 스펙·한줄 요약 강조'],
    closing: ['📱 픽모아 한줄 정리', '고른 기준과 아쉬운 점까지 담았습니다. 픽모아였습니다 🛍️'],
  },
  {
    id: 'savedesk', name: '세이브데스크', emoji: '💰', handle: 'savedesk',
    badge: '#1E8E6B', accent: '#0F6B52',
    hl: '#FBE3D4', hlSize: 19, boldColor: '#2C3A46', boldSize: 19,
    body: 16, sub: 30, subColor: '#2C3A46', h1: 24, text: '#2C3A46',
    quote: { bg: '#F2FBF7', bar: '#A9E0C9', color: '#2C3A46', size: 24 },
    hr: '#D8EDE4', th: '#E3F7EE',
    tone: '합쇼체(~습니다) · 수치 강조',
    rules: ['본문 16px · 연살구 형광펜 #FBE3D4', '소제목 30px · 첫인사 없음', '금액·조건 기준일 문구 자동'],
    autoNote: true,
    closing: ['💰 세이브데스크 정리', '오늘 확인한 숫자만 챙겨 가시면 됩니다. 세이브데스크였습니다.'],
  },
  {
    id: 'worddesk', name: '워드데스크', emoji: '🌏', handle: 'worddesk',
    badge: '#3D6DB5', accent: '#0047FF',
    hl: '#EBF0FF', hlSize: 19, boldColor: '#0047FF', boldSize: 19, text: '#2C3A46',
    body: 16, sub: 30, subColor: '#2C3A46', h1: 24,
    quote: { bg: '#F8F5FD', bar: '#C9B8E8', color: '#000000', size: 24 },
    hr: '#E4DBF2', th: '#F1EAFB',
    tone: '영·중·일 비교 · 한글 독음 병기',
    rules: ['본문 16px · 연하늘 형광펜 #EBF0FF', '소제목 30px · 강조 #0047FF', '3개국어 비교 표 · 독음 병기'],
    closing: ['🌏 워드데스크 정리', '뜻은 같아도 쓰임은 다릅니다. 워드데스크였습니다 🌏'],
  },
  {
    id: 'mybodydesk', name: '내몸데스크', emoji: '🌿', handle: 'mybodydesk',
    badge: '#1F7A5C', accent: '#1F7A5C',
    hl: '#C2F4DB', hlSize: 19, boldColor: '#1F7A5C', boldSize: 19,
    body: 16, sub: 30, subColor: '#1F7A5C', h1: 24,
    quote: { bg: '#F4FBF7', bar: '#A8E2C6', color: '#1F5A45', size: 24 },
    hr: '#D9EDE3', th: '#e5fcf0',
    tone: '차분한 해요체 · 2,100~2,500자',
    rules: ['포인트 #1F7A5C · 형광펜 C2F4DB', '본문 16px · 소제목 30px · 강조 19px', '소제목당 형광펜 1개 · 강조와 동시 금지'],
    target: [2100, 2500],
    closing: ['🌿 내몸데스크 한 줄', '오늘 하루, 몸에 맞는 선택 하나면 충분합니다. 내몸데스크였습니다 🌿'],
  },
  {
    id: 'spobriefing', name: '스포브리핑', emoji: '⚾', handle: 'spobriefing',
    badge: '#1F3864', accent: '#C0392B',
    hl: '#FFE1E1', hlSize: 19, boldColor: '#1F3864', boldSize: 0,
    body: 16, sub: 30, subColor: '#1F3864', h1: 24,
    quote: { bg: '#F5F7FC', bar: '#B9C4DA', color: '#1F3864', size: 24 },
    hr: '#DDE2EE', th: '#FFE9E6',
    tone: '레드/네이비 · 3분 브리핑',
    rules: ['본문 16px · 형광펜 #FFE1E1', '소제목 30px · 첫인사 없음', '3분 브리핑 요약 박스'],
    closing: ['⚾ 3분 브리핑', '핵심만 빠르게 정리했습니다. 스포브리핑이었습니다 ⚾'],
  },
  {
    id: 'jjinjjin', name: '찐찡이네', emoji: '🍼', handle: 'jjinjjin',
    badge: '#E8A657', accent: '#C97E3C',
    hl: '#FFF3B0', hlSize: 19, boldColor: '#A9662F', boldSize: 0,
    body: 16, sub: 30, subColor: '#6B4A2F', h1: 24,
    quote: { bg: '#FFFBF2', bar: '#F0D399', color: '#6B4A2F', size: 24 },
    hr: '#e0e0e0', hrMargin: 24, th: '#FFF7DC',
    tone: '다정한 해요체 · 신생아 육아 기록',
    rules: ['본문 16px · 연노랑 형광펜 #FFF3B0', '소제목 30px · 첫인사 자동(찐찡맘만 굵게)', '회색 구분선 + 💛 찐찡맘 총평 마무리'],
    greet: '안녕하세요, **찐찡맘**이에요:)',
    closing: ['💛 찐찡맘 총평', '오늘도 쭈니네 기록 보러 와주셔서 감사해요💛', '도움이 되셨다면 공감과 댓글 부탁드려요:)'],
    closingStyle: 'section',
    closingQuote: '💛 찐찡맘 총평\n오늘도 쭈니네 기록 보러 와주셔서 감사해요💛\n도움이 되셨다면 공감과 댓글 부탁드려요:)',
  },
];

const FT = { blog: 'ye_zib', auto: true, bound: false, built: null, custom: {} };

/* ── 🖍️ 형광펜·글씨 색 ────────────────────────────────────────────
   블로그 기본색(프리셋 hl·boldColor·subColor·text)을 기본값으로 두고,
   사용자가 그 자리에서 고른 색만 FT.custom[블로그].colors 에 담아 블로그별로 기억한다.
   값이 없으면 곧 '블로그 기본색' → 되돌리기가 그 키를 지우는 방식.
   · 형광펜  : ==형광펜== 문장의 background-color
   · 글씨 강조: **굵게** 안쪽의 color
   · 글씨 소제목: 제목·소제목(＋표 머리글)의 color
   · 글씨 본문: 본문·목록·표 칸의 color */
const FT_HL_PALETTE = [
  { c: '#FFD6E0', n: '연핑크' }, { c: '#FFF1C2', n: '연노랑' }, { c: '#FBE3D4', n: '연살구' },
  { c: '#EBF0FF', n: '연하늘' }, { c: '#C2F4DB', n: '연민트' }, { c: '#FFE1E1', n: '연레드' },
  { c: '#EDE3FA', n: '연라벤더' },
];
const FT_TX_PALETTE = [
  { c: '#000000', n: '검정' }, { c: '#3B3330', n: '다크그레이' }, { c: '#2C3A46', n: '차콜' },
  { c: '#1F3864', n: '네이비' }, { c: '#C0392B', n: '레드' }, { c: '#1F7A5C', n: '그린' },
  { c: '#7A5F2A', n: '브라운' },
];
const FT_TX_TARGETS = [
  { k: 'bold', n: '강조', hint: '**굵게** 로 감싼 글씨' },
  { k: 'sub', n: '소제목', hint: '제목·소제목 글씨' },
  { k: 'text', n: '본문', hint: '본문·목록 글씨' },
];
const FTC = { target: 'bold' };

function ftColorDef(b, k) {
  if (k === 'hl') return b.hl;
  if (k === 'bold') return b.boldColor || '#000000';
  if (k === 'sub') return b.subColor || '#000000';
  return b.text || '#3B3330';
}
function ftColorSlot(b) {
  const e = ftEdit(b);
  if (!e.colors || typeof e.colors !== 'object') e.colors = {};
  return e.colors;
}
function ftColorVal(b, k) {
  const v = ftColorSlot(b)[k];
  return (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) ? v : ftColorDef(b, k);
}
function ftColorIsCustom(b, k) {
  const v = ftColorSlot(b)[k];
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}
function ftColorSet(b, k, v) {
  const s = String(v || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(s)) return;
  ftColorSlot(b)[k] = s.toLowerCase();
}
function ftColorReset(b, k) { delete ftColorSlot(b)[k]; }

/* 색만 갈아 끼운 블로그 사본 — px·줄바꿈·첫인사 같은 서식 수치는 프리셋 그대로 둔다 */
function ftBlogC() {
  const b = ftBlog();
  return Object.assign({}, b, {
    hl: ftColorVal(b, 'hl'), boldColor: ftColorVal(b, 'bold'),
    subColor: ftColorVal(b, 'sub'), text: ftColorVal(b, 'text'),
  });
}

function ftChipRow(list, cur, what) {
  const low = String(cur || '').toLowerCase();
  return list.map((p) =>
    '<button type="button" class="ft-chip' + (p.c.toLowerCase() === low ? ' on' : '') + '"' +
    ' data-c="' + p.c + '" title="' + p.n + ' ' + p.c + '"' +
    ' aria-label="' + p.n + ' ' + what + '" aria-pressed="' + (p.c.toLowerCase() === low) + '"' +
    ' style="background:' + p.c + '"></button>').join('');
}

/* 색 고르기 UI를 지금 블로그·지금 값으로 다시 칠한다(입력란 자체는 다시 만들지 않는다) */
function ftColorSync() {
  const box = $('#ftHlSw');
  if (!box) return;
  const b = ftBlog();
  const hl = ftColorVal(b, 'hl');
  box.innerHTML = ftChipRow(FT_HL_PALETTE, hl, '형광펜');
  const hp = $('#ftHlPick'); if (hp) hp.value = hl.toLowerCase();
  const hv = $('#ftHlVal'); if (hv) hv.textContent = hl.toUpperCase();
  const hr = $('#ftHlReset');
  if (hr) { const on = ftColorIsCustom(b, 'hl'); hr.disabled = !on; hr.classList.toggle('off', !on); }

  const k = FTC.target;
  const tv = ftColorVal(b, k);
  $$('#ftTxTgt [data-tt]').forEach((x) => {
    const on = x.dataset.tt === k;
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', on);
  });
  const ts = $('#ftTxSw');
  if (ts) ts.innerHTML = ftChipRow(FT_TX_PALETTE, tv, '글씨');
  const tp = $('#ftTxPick'); if (tp) tp.value = tv.toLowerCase();
  const tvl = $('#ftTxVal'); if (tvl) tvl.textContent = tv.toUpperCase();
  const tr = $('#ftTxReset');
  if (tr) { const on = ftColorIsCustom(b, k); tr.disabled = !on; tr.classList.toggle('off', !on); }
  const hint = $('#ftTxHint');
  if (hint) { const t = FT_TX_TARGETS.find((x) => x.k === k); hint.textContent = t ? t.hint : ''; }
}

/* 규칙 칩 — 형광펜 색을 바꿨으면 칩에 적힌 색도 같이 바뀐다(색 이름은 '형광펜'으로) */
function ftRuleChips(preset, eff) {
  const hlL = String(preset.hl || '').toLowerCase();
  const nowL = String(eff.hl || '').toLowerCase();
  const changed = hlL !== nowL;
  return (preset.rules || []).map((r) => {
    let t = String(r);
    if (changed) {
      t = t.split(preset.hl).join(eff.hl.toUpperCase());
      const a = preset.hl.replace('#', ''), bb = eff.hl.replace('#', '').toUpperCase();
      if (a) t = t.split(a).join(bb);
      t = t.replace(/연(?:핑크|노랑|살구|하늘|민트|레드|라벤더)\s*형광펜/, '형광펜');
    }
    return '<span>' + esc(t) + '</span>';
  });
}

/* 블로그 칩의 형광펜 띠도 고른 색으로 */
function ftPaintPicks() {
  $$('#ftPicks [data-ftblog]').forEach((el) => {
    const b = FT_BLOGS.find((x) => x.id === el.dataset.ftblog);
    const sk = el.querySelector('.sk');
    if (b && sk) sk.style.background = ftColorVal(b, 'hl');
  });
}

function ftApplyColor(k, v) {
  const b = ftBlog();
  if (v) ftColorSet(b, k, v); else ftColorReset(b, k);
  ftColorSync(); ftPaintPicks(); ftRender(); ftSave();
}

/* 블로그별 첫인사·마무리 문구는 화면 입력란에서 고친다(블로그별로 기억).
   값이 없으면 프리셋 기본값으로 채운다. */
function ftEdit(b) {
  if (!FT.custom) FT.custom = {};
  let e = FT.custom[b.id];
  if (!e) {
    e = { greet: b.greet || '', greetOn: !!b.greet, close: b.closingQuote || '', closeOn: !!b.closingQuote };
    FT.custom[b.id] = e;
  }
  return e;
}

/* 첫인사·마무리 입력란을 지금 블로그 값으로 채운다. 프리셋에 없는 블로그는 잠근다. */
function ftEndSync() {
  const b = ftBlog();
  const e = ftEdit(b);
  const go = $('#ftGreetOn'), gi = $('#ftGreet'), co = $('#ftCloseOn'), ci = $('#ftClose');
  if (!go || !co) return;
  const gok = !!b.greet, cok = !!b.closingQuote;
  go.disabled = !gok; gi.disabled = !gok; co.disabled = !cok; ci.disabled = !cok;
  go.checked = gok && !!e.greetOn;
  co.checked = cok && !!e.closeOn;
  gi.value = gok ? (e.greet || '') : '';
  ci.value = cok ? (e.close || '') : '';
  gi.placeholder = gok ? '첫인사 문구' : '이 블로그는 첫인사를 넣지 않아요';
  ci.placeholder = cok ? '마무리 문구 (줄바꿈으로 나눔)' : '이 블로그는 마무리 끝인사를 넣지 않아요';
  const note = $('#ftEndNote');
  if (note) {
    note.textContent = (gok || cok)
      ? b.name + ' — 첫인사·' + (b.closingStyle === 'section' ? '구분선·마무리 총평' : '마무리 인용구') + '를 자동으로 넣어요. 문구는 여기서 고치면 블로그별로 기억합니다.'
      : b.name + ' — 첫인사·마무리 끝인사 자동 삽입 없음(직접 써 주세요).';
  }
}

function ftBlog() { return FT_BLOGS.find((b) => b.id === FT.blog) || FT_BLOGS[0]; }

function ftSample() {
  const b = ftBlog();
  const head = [
    '# ' + b.name + ' 샘플 제목입니다',
    '',
    '> 여기는 인용구 훅 자리예요. 두 줄 안으로 짧게 씁니다.',
    '',
  ];
  // 첫인사는 예지브러리에만 있다 — 실제 글처럼 인용구 바로 다음에 넣는다.
  if (b.greet) head.push(b.greet, '');
  return head.concat([
    '## 소제목 하나',
    '',
    '본문 문장입니다. **중요한 단어**는 굵게, ==핵심 문장==은 형광펜으로 칠해집니다.',
    '',
    '- 첫 번째 항목',
    '- 두 번째 항목',
    '- 세 번째 항목',
    '',
    '## 소제목 둘',
    '',
    '숫자가 들어간 문장은 자동 서식에서 형광펜이 붙습니다. 하루 2,100자 분량을 권장합니다.',
    '',
    '| 구분 | 표기 | 뜻 |',
    '| --- | --- | --- |',
    '| 예시 | example | 보기 |',
    '| 비교 | compare | 견주기 |',
    '',
    '---',
    '',
    '마지막 문단입니다. [참고 링크](https://blog.naver.com/)도 이렇게 넣을 수 있어요.',
  ]).join('\n');
}

/* 빈 줄·문단 간격 정리 */
function ftClean(txt) {
  return String(txt || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── 입력창 도구 두 가지 (2026-11-20 요청) ────────────────────────
   실제 발행 글(ye_zib 224482812032 · jjinjjingne 224481366475) 빈 줄 규칙:
   · 문단 사이 빈 줄 1개(2줄 이상 연속 금지) · 첫인사 뒤 빈 줄 1개
   · 목록(✓ · - · • · 1.)은 앞 문장(출처 문장)·앞 항목에 붙이고, 목록이 끝나면 빈 줄 1개
   · 형광펜 문장 뒤 빈 줄 1개 · 구분선 앞뒤 빈 줄 1개
   빈줄정리: 위 규칙대로 빈 줄을 정리(2줄 이상 → 1줄)
   빈줄넣기: 빈줄정리 + 소제목(#·##·### 및 쌩텍스트 소제목) 앞뒤 빈 줄 1줄 */
const FT_LI = /^(?:✓|✔|☐|·|•|[-*+]\s|\d+[.)]\s)/;
function ftIsListLine(t) { return FT_LI.test(String(t || '').trim()); }
const FT_GREET_LINE = /^(안녕하|반갑|어서\s*오세요|다들\s*안녕)/;
/* 핵심정리·Q&A 소제목 다음은 빈 줄 없이 바로 본문을 붙이는 블로그(2026-11-20 지시) */
const FT_TIGHT_BLOGS = ['pick_moa', 'savedesk', 'mybodydesk'];
const FT_TIGHT_HEAD = /(핵심\s*정리|한눈에\s*보는|Q\s*[&＆]\s*A|QnA|Q\.|자주\s*묻는)/i;
function ftTightHead(line, blogId) {
  if (FT_TIGHT_BLOGS.indexOf(blogId) < 0) return false;
  return FT_TIGHT_HEAD.test(String(line || '').replace(/^#{1,3}\s*/, '').replace(/[*_=\[\]()]/g, ' ').replace(/\s+/g, ' ').trim());
}

function ftSquashBlank(txt, blogId) {
  const lines = String(txt || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').split('\n');
  const isBlank = (l) => !String(l).trim();
  // 1) 연속 빈 줄은 1줄로
  const a = [];
  for (const ln of lines) {
    if (isBlank(ln)) { if (!a.length || isBlank(a[a.length - 1])) continue; a.push(''); }
    else a.push(ln);
  }
  // 2) 목록은 앞 문장·앞 항목에 붙인다(출처 문장 + ✓ 체크리스트)
  const b = [];
  for (let i = 0; i < a.length; i++) {
    const ln = a[i];
    if (isBlank(ln)) {
      const nx = a.slice(i + 1).find((x) => !isBlank(x));
      const pv = b.slice().reverse().find((x) => !isBlank(x));
      if (nx && ftIsListLine(nx) && pv && !/^#{1,3}\s/.test(pv.trim()) && !FT_HR.test(pv.trim())) continue;
      b.push(''); continue;
    }
    b.push(ln.trim());
  }
  // 3) 구분선 앞뒤 · 목록 끝 · 형광펜 문장 뒤 · 첫인사 뒤 빈 줄 1개
  const out = [];
  for (let i = 0; i < b.length; i++) {
    const ln = b[i];
    if (!ln) {
      const pv = out.length ? out[out.length - 1] : '';
      if (pv && ftTightHead(pv, blogId)) continue;          // 핵심정리·Q&A 소제목 뒤 빈 줄은 뺀다
      if (out.length && pv !== '') out.push('');
      continue;
    }
    const isHr = FT_HR.test(ln);
    if (isHr && out.length && out[out.length - 1] !== '') out.push('');
    out.push(ln);
    const next = b[i + 1];
    const nextLi = next !== undefined && ftIsListLine(next);
    const blankAfter = next !== undefined && next === '';
    const needAfter = (isHr && next !== undefined)
      || (ftIsListLine(ln) && !nextLi && next !== undefined)
      || (!ftIsListLine(ln) && ln.indexOf('==') >= 0 && next !== undefined && !nextLi && !FT_HR.test(next))
      || (FT_GREET_LINE.test(ln) && next !== undefined);
    if (needAfter && next !== '' && !blankAfter) out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/* 소제목으로 볼 행 번호 — 마크다운 #·##·### + ftHeadText가 감지하는 쌩텍스트 소제목 줄 */
const FT_HEAD_CONT = /(는데|지만|면서|니까|으면|하고|해서|이며|거나|든지|라고|다고|라서|어서|아서|었고|였고)$/;
function ftHeadLines(lines) {
  const set = new Set();
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (!t) return;
    if (/^#{1,3}\s+\S/.test(t)) { set.add(i); return; }               // 마크다운 소제목
    if (FT_HEAD_CONT.test(t.replace(/[?!~.]+$/, ''))) return;          // 문장이 이어지는 줄
    if (ftHeadText({ s: t })) set.add(i);                              // 쌩텍스트 소제목
  });
  return set;
}

function ftAddBlank(txt, blogId) {
  const lines = ftSquashBlank(txt, blogId).split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  const heads = ftHeadLines(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (heads.has(i)) {
      while (out.length && out[out.length - 1].trim() === '') out.pop();   // 앞 빈 줄 정리
      if (out.length) out.push('');
      out.push(ln.trim());
      // 핵심정리·Q&A 소제목은 빈 줄 없이 바로 본문(픽모아·세이브데스크·내몸데스크)
      if (!ftTightHead(ln, blogId)) out.push('');
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;              // 뒤 빈 줄은 하나만
      i = j - 1;
      continue;
    }
    if (ln.trim() === '' && (!out.length || out[out.length - 1].trim() === '')) continue;
    out.push(ln);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

const FT_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FT_SEP = /^\|?[\s:|-]+\|?[\s:|-]*$/;

/* 원고 → 블록 (빈 줄 위치까지 기억 — 마크다운 없는 쌩 텍스트의 소제목 감지에 사용) */
function ftParse(src) {
  const lines = ftClean(src).split('\n');
  const out = [];
  let i = 0;
  let gap = true;                                  // 직전 블록 뒤에 빈 줄(문서 시작 포함)이 있었는지
  const add = (bk) => {
    if (out.length) out[out.length - 1].gapAfter = gap;
    bk.gapBefore = gap;
    out.push(bk);
    gap = false;
  };
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { gap = true; i++; continue; }

    if (FT_HR.test(line)) { add({ t: 'hr' }); i++; continue; }

    if (line.charAt(0) === '|' && lines[i + 1] && FT_SEP.test(lines[i + 1].trim()) && lines[i + 1].indexOf('-') >= 0) {
      const rows = [];
      let j = i;
      while (j < lines.length && lines[j].trim().charAt(0) === '|') { rows.push(lines[j].trim()); j++; }
      const cells = rows.filter((r, idx) => !(idx === 1 && FT_SEP.test(r) && r.indexOf('-') >= 0))
        .map((r) => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
      add({ t: 'table', rows: cells });
      i = j; continue;
    }

    if (line.indexOf('> ') === 0 || line === '>') {
      const parts = [];
      while (i < lines.length && lines[i].trim().indexOf('>') === 0) {
        parts.push(lines[i].trim().replace(/^>\s?/, '').trim());
        i++;
      }
      add({ t: 'q', s: parts.filter(Boolean).join('\n') });
      continue;
    }

    let m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) { add({ t: 'h' + m[1].length, s: m[2].trim() }); i++; continue; }

    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, '')); i++;
      }
      add({ t: 'ul', items }); continue;
    }

    if (/^[✓✔☐•]\s*/.test(line)) {
      const items = [];
      while (i < lines.length && /^[✓✔☐•]\s*/.test(lines[i].trim())) {
        items.push(lines[i].trim()); i++;
      }
      add({ t: 'check', items }); continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++;
      }
      add({ t: 'ol', items }); continue;
    }

    add({ t: 'p', s: line }); i++;
  }
  if (out.length) out[out.length - 1].gapAfter = true;
  return out;
}

/* ── 쌩 텍스트 자동 소제목 ─────────────────────────────────────────
   마크다운 # 없이 붙여넣은 원고에서도 짧은 단독 줄은 소제목으로 승격한다. */
const FT_HEAD_SKIP = [
  /^(※|\*\s*※|\[?\s*(출처|참고|사진|이미지|광고|협찬)\s*[:：])/,           // 주석·출처·협찬 줄
  /^(안녕하|안녕!|안녕,|안녕하세|반갑|반가|예브예요|예브입니다|예브였습니다|어서\s*오세요|다들\s*안녕)/, // 인사말
  /(감사합니다|고맙습니다|이상입니다|여기까지입니다|마치겠습니다)\s*[.!]?$/,   // 맺음말
  /^#\S/,                                                                    // 해시태그 덩어리
  /^(문의|제휴|광고\s*문의)/,                                                // 문의 줄
];

/* 완전한 대화체·서술체 어미 — 이런 줄만 '일반 본문 문장'으로 확정한다.
   2026-11-20 지시: '~다·~까·~요·~죠·~네·~데·~지'로 끝나는 짧은 단독 줄은 소제목일 수 있으므로
   여기서 일괄 탈락시키지 않는다(“명단부터 묵직하다”, “수비부터 볼까”, “첫 소식은 누구일까”). */
const FT_FULL_SENT = /(습니다|ㅂ니다|입니다|였습니다|합니다|해요|에요|예요|세요|어요|아요)$/;

/* 한 줄이 소제목 후보인지 — 후보면 표시용 평문을, 아니면 ''을 돌려준다 */
function ftHeadText(bk) {
  const raw = String(bk.s || '').trim();
  let plain = raw.replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)\s]+\)/g, '$1').replace(/\*\*|==/g, '').trim();
  const len = plain.length;
  if (len < 2 || len > 28) return '';                       // 2~28자
  if (/https?:\/\/|www\./i.test(raw)) return '';            // URL 줄
  if (/^[-*+>|]|^\d+[.)]\s/.test(plain)) return '';          // 목록·표·인용 표시
  if (/[.,;:·…]$/.test(plain)) return '';                    // 마침표 등으로 끝나면 본문
  if (/\.\s/.test(plain)) return '';                         // 문장이 이어지는 줄은 본문
  // '~습니다·~해요·~입니다' 같은 완전한 어미만 본문 문장으로 본다.
  // 단 '?로 끝나는 짧은 의문문 소제목'(“바로 기회 줘야 할까?”, “이래도 될까요?”)은 소제목으로 허용.
  if (!/\?\s*$/.test(plain) && FT_FULL_SENT.test(plain.replace(/[!~]+$/, ''))) return '';
  if (!/[가-힣]/.test(plain) && !/[A-Za-z]{2,}/.test(plain)) return '';
  if ((plain.match(/[가-힣A-Za-z]/g) || []).length < 2) return '';
  const chk = plain.replace(/^[\[("'“”‘’]+/, '');
  for (let i = 0; i < FT_HEAD_SKIP.length; i++) if (FT_HEAD_SKIP[i].test(chk)) return '';
  return plain;
}

/* 자동 서식 다듬기가 켜져 있을 때: 단독 짧은 줄 → h2 */
function ftAutoHeads(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const bk = blocks[i];
    const next = blocks[i + 1];
    const prev = blocks[i - 1];
    if (bk.t !== 'p' || !next) { out.push(bk); continue; }
    const head = ftHeadText(bk);
    if (!head) { out.push(bk); continue; }
    const strip = (s) => String(s || '').replace(/\*\*|==/g, '').replace(/\s+/g, ' ').trim();
    const nextLen = next.t === 'p' ? strip(next.s).length : 0;
    const prevLen = prev && prev.t === 'p' ? strip(prev.s).length : 0;
    const before = bk.gapBefore !== false;                    // 앞이 빈 줄(또는 문서 시작)
    const after = bk.gapAfter !== false;                      // 뒤가 빈 줄
    const alone = before && after;                            // 앞뒤가 빈 줄인 단독 줄
    const nextBody = next.t === 'p' && nextLen >= 20;         // 다음이 일반 본문 단락
    const nextLong = next.t === 'p' && nextLen >= 30;         // 다음이 긴 본문(30자+)
    const contish = FT_HEAD_CONT.test(head.replace(/[?!~.]+$/, ''));   // ~는데·~지만 으로 이어지는 줄
    let ok = false;
    if (/[?!]$/.test(head)) ok = alone || nextBody || nextLong;          // 짧은 의문·감탄 소제목("바로 기회 줘야 할까?")
    else if (alone) ok = true;                                          // 앞뒤가 빈 줄인 단독 줄 → 소제목
    else if (nextBody && (before || after)) ok = true;                   // 한쪽만 빈 줄 + 뒤에 본문 20자↑
    else if (nextBody && !contish) ok = true;                            // 줄바꿈만 있는 쌩 텍스트에서도 소제목
    else if (nextLong && (prevLen >= 30 || i === 0)) ok = true;
    out.push(ok ? Object.assign({}, bk, { t: 'h2', s: head, autoHead: true }) : bk);
  }
  return out;
}

const FT_KEYS = /(핵심|중요|주의|포인트|결론|요약|추천|무료|할인|최대|최소|기준|원|%|개월|시간|칼로리|mg|ml|g\b)/;

/* 문장 후보로 쪼개기 */
function ftSentences(plain) {
  return String(plain).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 8);
}

/* 형광펜 칠할 문장 고르기 — ① 숫자 문장 ② 핵심어 문장 ③ 그래도 없으면 폴백(가장 자연스러운 문장).
   2026-11-20 지시: 숫자·핵심어가 없는 스포츠·일반 원고에서 형광펜이 아예 안 들어가던 문제 → 폴백에서 무조건 한 문장 고른다. */
function ftPickSentence(txt) {
  const plain = String(txt).replace(/\*\*|==/g, '');
  const sents = ftSentences(plain);
  let pick = sents.find((s) => /\d/.test(s));
  if (!pick) pick = sents.find((s) => FT_KEYS.test(s));
  if (!pick) pick = ftFallbackSentence(sents, plain);
  return pick || null;
}

/* 폴백 — 10~55자 문장 중 판단·감정이 가장 잘 드러나는 한 문장(점수 같으면 뒤쪽 결론 문장) */
function ftFallbackSentence(sents, plain) {
  const scored = sents.filter((s) => s.length >= 10 && s.length <= 55).map((s, i) => {
    let n = 0;
    if (/(다|요|죠|까|네)$/.test(s.replace(/[.!?~]+$/, ''))) n += 1;      // 서술·감정으로 끝나는 문장
    if (s.length >= 15 && s.length <= 45) n += 1;                        // 너무 짧지도 길지도 않게
    if (/(지만|는데|반면|다만|그리는|그런데)/.test(s)) n += 1;            // 판단·대비가 담긴 문장
    return { s, n, i };
  });
  if (scored.length) {
    scored.sort((a, b) => (b.n - a.n) || (b.i - a.i));
    return scored[0].s;
  }
  const any = sents.filter((s) => s.length >= 6);
  if (any.length) return any[any.length - 1];
  const whole = String(plain).trim();
  if (whole.length >= 6 && whole.length <= 55) return whole;
  return null;
}

/* '**'·'==' 표시를 뺀 평문과 '평문 위치 → 원문 위치' 지도 */
function ftPlainMap(raw) {
  const map = [];
  let plain = '';
  for (let i = 0; i < raw.length; i++) {
    if ((raw[i] === '*' && raw[i + 1] === '*') || (raw[i] === '=' && raw[i + 1] === '=')) { i++; continue; }
    plain += raw[i];
    map.push(i);
  }
  return { plain: plain, map: map };
}

/* 문단 하나에 문장 하나를 ==…== 로 감싼다 */
function ftMarkSentence(raw, pick) {
  if (!pick) return raw;
  const m = ftPlainMap(raw);
  const at = m.plain.indexOf(pick);
  if (at < 0) return raw;
  const s = m.map[at];
  const e = m.map[at + pick.length - 1] + 1;
  return raw.slice(0, s) + '==' + raw.slice(s, e) + '==' + raw.slice(e);
}

/* ── 소제목 섹션당 형광펜 1~2개 무조건 (2026-11-20 지시) ────────────────
   섹션 = 소제목(h1~h3)부터 다음 소제목 전까지(첫 소제목 전 도입부도 한 섹션).
   본문 문단이 1개면 1개, 2개 이상이면 2개를 넣는다. 이미 ==…== 가 있으면 채운 것으로 센다.
   첫인사·끝인사·해시태그·출처·주석·목록은 대상에서 뺀다. */
const FT_HL_SKIP = [
  /^#\S/,                                                              // 해시태그 덩어리
  /^(※|\*\s*※|\[?\s*(출처|참고|사진|이미지|광고|협찬)\s*[:：])/,          // 주석·출처
  /(감사합니다|고맙습니다|이상입니다|여기까지입니다|마치겠습니다)/,        // 맺음말
  /(공감과\s*댓글|구독과\s*좋아요|이웃\s*추가)/,                           // 마무리 요청
  /^(안녕하|안녕!|안녕,|반갑|예브\s*예요|예브입니다|예브였습니다|찐찡맘이에요)/, // 첫인사
];

function ftHlCount(s) { return (String(s || '').match(/==/g) || []).length / 2; }

function ftHlable(bk, i, intro) {
  if (!bk || bk.t !== 'p') return false;
  const s = String(bk.s || '').trim();
  if (s.length < 12) return false;                                   // 사진 설명·짧은 한 줄
  if (!/[가-힣]/.test(s)) return false;
  const chk = s.replace(/^[\[("'“”‘’]+/, '');
  for (let k = 0; k < FT_HL_SKIP.length; k++) if (FT_HL_SKIP[k].test(chk)) return false;
  if ((i === 0 || intro) && !/\.$/.test(s)) return false;   // 도입부의 제목 줄(마침표 없음)은 건드리지 않는다
  return true;
}

function ftAutoHl(blocks) {
  const out = blocks.slice();
  const sections = [];
  let cur = [];
  let headSeen = false;
  for (let i = 0; i < out.length; i++) {
    const bk = out[i];
    if (bk.t === 'h1' || bk.t === 'h2' || bk.t === 'h3') {
      if (cur.length) sections.push({ idxs: cur, intro: !headSeen });
      cur = [];
      headSeen = true;
      continue;
    }
    cur.push(i);
  }
  if (cur.length) sections.push({ idxs: cur, intro: !headSeen });

  sections.forEach((sec) => {
    const idxs = sec.idxs.filter((i) => ftHlable(out[i], i, sec.intro));
    if (!idxs.length) return;
    const want = idxs.length >= 2 ? 2 : 1;
    let have = 0;
    idxs.forEach((i) => { have += ftHlCount(out[i].s); });
    let guard = 0;
    while (have < want && guard < 4) {                                // 한 문단에 최대 2개까지, 더 필요하면 다시
      let moved = false;
      const order = idxs.slice().sort((a, b) => (ftHlCount(out[a].s) - ftHlCount(out[b].s)) || (a - b));
      for (let k = 0; k < order.length && have < want; k++) {
        const i = order[k];
        const raw = String(out[i].s);
        if (ftHlCount(raw) >= 2) continue;                            // 한 문단에 2개를 넘기지 않는다
        const src = raw.indexOf('==') >= 0 ? raw.replace(/==[^=]*==/g, ' ') : raw;   // 이미 칠한 문장은 다시 고르지 않게
        const pick = ftPickSentence(src);
        if (!pick) continue;
        const marked = ftMarkSentence(raw, pick);
        if (marked === raw) continue;
        out[i] = Object.assign({}, out[i], { s: marked });
        have += 1;
        moved = true;
      }
      if (!moved) break;
      guard += 1;
    }
  });
  return out;
}

/* 첫인사 자동 문단 — 예지브러리·찐찡이네만 있다(실제 발행 글 확인: 나머지 블로그는 첫인사 없음) */
const FT_GREET_RE = /(안녕하세요|예브\s*예요|예브입니다|찐찡맘)/;
function ftBlockText(bk) {
  if (!bk) return '';
  if (bk.items) return bk.items.join(' ');
  if (bk.rows) return bk.rows.map((r) => r.join(' ')).join(' ');
  return bk.s || '';
}
function ftAutoGreet(blocks, b) {
  const e = ftEdit(b);
  if (!e.greetOn || !String(e.greet || '').trim()) return blocks;   // 끄겠거나 첫인사가 없는 블로그는 넣지 않는다
  // 원고 앞부분(제목·인용구를 지나 첫 문단까지)에 이미 인사말이 있으면 또 넣지 않는다.
  // 예전엔 앞 3블록만 봐서, 제목·인용구·사진 설명 뒤에 온 인사말을 놓쳐 두 번 찍혔다(2026-11-20 지시).
  if (FT_GREET_RE.test(blocks.slice(0, 12).map(ftBlockText).join(' '))) return blocks;
  let at = 0;
  while (at < blocks.length && (blocks[at].t === 'h1' || blocks[at].t === 'q')) at++;  // 제목·인용구 훅 다음
  const out = blocks.slice();
  out.splice(at, 0, { t: 'greet', s: String(e.greet).trim() });
  return out;
}

/* 마무리 끝인사 자동 삽입 — 예지브러리·찐찡이네만(closingQuote 있는 블로그만).
   · 예지브러리(quote): 실제 발행 글처럼 인용구 3줄 한 덩어리
   · 찐찡이네(section): 회색 구분선 → 💛 찐찡맘 총평(소제목) → 본문 줄들
   이미 마무리가 있으면 넣지 않고, 맨 끝이 해시태그 줄이면 해시태그 바로 앞에 넣는다. */
const FT_CLOSING_RE = /(예지브러리였습니다|꽂아둡니다|써보고,?\s*놀고|찐찡맘 총평|공감과 댓글)/;
function ftClosingBlocks(b, text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (b.closingStyle === 'section') {
    const out = [{ t: 'hr' }];
    out.push({ t: 'h2', s: lines[0] });                        // 첫 줄은 소제목(💛 찐찡맘 총평)
    // 총평 본문 줄들은 붙여 쓴다(줄마다 빈 줄이 생기지 않게)
    for (let i = 1; i < lines.length; i++) out.push({ t: 'p', s: lines[i], gapBefore: i === 1 });
    return out;
  }
  return [{ t: 'q', s: lines.join('\n') }];
}
function ftAutoClosing(blocks, b) {
  const e = ftEdit(b);
  if (!b.closingQuote || !e.closeOn || !blocks.length) return blocks;   // 나머지 블로그는 절대 넣지 않는다
  const cb = ftClosingBlocks(b, e.close);
  if (!cb.length) return blocks;
  const tail = blocks.slice(-10).map(ftBlockText).join(' ');          // 해시태그·사진 설명이 끼어도 놓치지 않게
  if (FT_CLOSING_RE.test(tail)) return blocks;                        // 이미 마무리가 있으면 그대로
  const out = blocks.slice();
  let at = out.length;
  // 맨 끝 해시태그 줄(#태그 #태그)은 끝인사 뒤에 남긴다
  while (at > 0 && out[at - 1].t === 'p' && /^\s*(#[^\s#]+\s*)+$/.test(String(out[at - 1].s || ''))) at--;
  out.splice(at, 0, ...cb);
  // 끌인사 뒤에 따라오는 줄(해시태그 등)은 새 문단에서 시작한다
  if (out[at + cb.length]) out[at + cb.length].gapBefore = true;
  return out;
}

/* 자동 서식: 쌩 텍스트 소제목 승격 + 핵심 문장 형광펜 + 기준일 문구 + 예지브러리 첫인사·마무리 */
function ftAuto(blocks, b) {
  const out = ftAutoHl(ftAutoHeads(blocks));

  if (b.autoNote) {
    let at = -1;
    for (let i = 0; i < out.length; i++) { if (out[i].t === 'p') { at = i; break; } }
    if (at >= 0) {
      const d = new Date(Date.now() + KST_OFF);
      out.splice(at + 1, 0, { t: 'note', s: '※ 이 글의 금액·조건은 ' + d.getUTCFullYear() + '년 ' + (d.getUTCMonth() + 1) + '월 기준입니다.' });
    }
  }
  return ftAutoClosing(ftAutoGreet(out, b), b);      // 첫인사 다음, 문서 맨 끝에 예지브러리만 마무리
}

/* 인라인 표시 → HTML (이스케이프 후) — 실제 글처럼 형광펜 문장은 19px·굵게 */
function ftInline(s, b) {
  let t = esc(s);
  t = t.replace(/\[([^<>\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, x, u) => '<a href="' + u + '" style="color:' + b.accent + ';text-decoration:underline;">' + x + '</a>');
  t = t.replace(/\*\*([^<>]+?)\*\*/g, (_, x) => '<b style="' + (b.boldSize ? 'font-size:' + b.boldSize + 'px;' : '') + 'font-weight:700;color:' + b.boldColor + ';">' + x + '</b>');
  t = t.replace(/==([^<>]+?)==/g, (_, x) => '<span style="background-color:' + b.hl + ';' + (b.hlSize ? 'font-size:' + b.hlSize + 'px;' : '') + 'font-weight:700;">' + x + '</span>');
  return t.replace(/\n/g, '<br>');
}

/* ── 네이버 붙여넣기 빈 줄 (2026-11-20) ─────────────────────────
   네이버 블로그 스마트에디터 ONE은 외부 HTML 을 붙여넣을 때 블록의 CSS `margin` 을 지운다.
   그래서 `margin:0 0 16px` 으로만 주던 문단 간격이 서식째 붙여넣기에서 통째로 사라져
   문단·소제목이 다닥다닥 붙었다(예닝 님 지시: "서식째 붙여넣기하니까 빈줄이 다 사라져서 붙네").
   → 빈 줄이 들어갈 자리마다 실제 빈 문단(<p …>&nbsp;</p>)을 넣고, 블록 margin 은 0 으로 둔다.
     (완전히 빈 <p></p> 는 에디터가 무시할 수 있으므로 &nbsp; 를 꼭 넣는다.)
   → 빈 줄 규칙은 ftPlain(평문 복사본)과 같은 함수(ftTightAfter)를 쓰므로
     미리보기 · 복사한 HTML · 네이버 붙여넣기 결과가 모두 같은 자리에 빈 줄 1개가 된다. */
function ftBlankHTML(b) {
  return '<p style="font-size:' + b.body + 'px;line-height:1.9;margin:0;padding:0;">&nbsp;</p>';
}

/* 소제목·구분선·첫인사·안내문 — 앞뒤에 빈 줄 1줄을 두는 블록 */
function ftBlocky(x) {
  return !!x && (x.t === 'h1' || x.t === 'h2' || x.t === 'h3' || x.t === 'sub'
    || x.t === 'hr' || x.t === 'greet' || x.t === 'note');
}

/* 앞 블록과 빈 줄 없이 잇는 자리인가(tight) — 평문·HTML 이 함께 쓰는 빈 줄 규칙 */
function ftTightAfter(prev, bk, b) {
  if (!prev) return true;                                                  // 문서 첫 블록
  return (bk.gapBefore === false && !ftBlocky(prev) && !ftBlocky(bk))       // 원래 빈 줄이 없던 곳
    // 출처 문장(~기준이에요.) 바로 밑에 붙은 목록은 빈 줄 없이 잇는다
    || ((bk.t === 'ul' || bk.t === 'ol' || bk.t === 'check') && prev.t === 'p'
      && /(기준이에요|기준입니다|기준)\s*\.?\s*$/.test(String(prev.s || '')))
    // 핵심정리·Q&A 소제목 다음은 빈 줄 없이(픽모아·세이브데스크·내몸데스크)
    || ((prev.t === 'h1' || prev.t === 'h2' || prev.t === 'h3') && !!b && ftTightHead(prev.s, b.id));
}

/* 블록 하나의 평문 — 복사용 text/plain·글자 수·빈 블록 판정에 같이 쓴다 */
function ftBlockPlain(bk) {
  const strip = (s) => String(s || '').replace(/==|\*\*/g, '').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
  if (bk.t === 'hr') return '──────────';
  if (bk.t === 'check') return (bk.items || []).map(strip).join('\n');
  if (bk.t === 'ul') return (bk.items || []).map((i) => '• ' + strip(i)).join('\n');
  if (bk.t === 'ol') return (bk.items || []).map((i, n) => (n + 1) + '. ' + strip(i)).join('\n');
  if (bk.t === 'table') return (bk.rows || []).map((r) => r.map(strip).join(' | ')).join('\n');
  return strip(bk.s);
}

function ftBlockHTML(bk, b) {
  const tcol = b.text || '#3B3330';                                  // 블로그별 본문 글자색(기본 #3B3330)
  const bodyP = 'font-size:' + b.body + 'px;line-height:1.9;margin:0;color:' + tcol + ';word-break:keep-all;';
  if (bk.t === 'h1') return '<p style="font-size:' + b.h1 + 'px;font-weight:800;line-height:1.45;margin:0;color:' + b.subColor + ';word-break:keep-all;">' + ftInline(bk.s, b) + '</p>';
  if (bk.t === 'h2' || bk.t === 'sub') return '<p style="font-size:' + b.sub + 'px;font-weight:700;line-height:1.5;margin:0;color:' + b.subColor + ';word-break:keep-all;">' + ftInline(bk.s, b) + '</p>';
  if (bk.t === 'h3') return '<p style="font-size:' + Math.max(18, b.sub - 10) + 'px;font-weight:700;line-height:1.55;margin:0;color:' + b.subColor + ';">' + ftInline(bk.s, b) + '</p>';
  if (bk.t === 'p') return '<p style="' + bodyP + '">' + ftInline(bk.s, b) + '</p>';
  if (bk.t === 'greet') return '<p style="' + bodyP + '">' + ftInline(bk.s, b) + '</p>';
  if (bk.t === 'note') return '<p style="font-size:' + Math.max(12, b.body - 3) + 'px;line-height:1.7;margin:0;color:#8A7A72;">' + ftInline(bk.s, b) + '</p>';
  if (bk.t === 'q') return '<div style="background-color:' + b.quote.bg + ';border-left:4px solid ' + b.quote.bar + ';border-radius:8px;padding:16px 18px;margin:0;"><p style="font-size:' + (b.quote.size || 24) + 'px;font-weight:700;line-height:1.85;margin:0;color:' + b.quote.color + ';word-break:keep-all;">' + ftInline(bk.s, b) + '</p></div>';
  if (bk.t === 'hr') return '<p style="border:none;border-top:1px solid ' + b.hr + ';margin:0;font-size:1px;line-height:1;">&nbsp;</p>';
  if (bk.t === 'check') {
    // 실제 발행 글의 ✓ 체크리스트는 항목마다 본문 문단(✓ 기호를 그대로 둔다) — 항목끼리 붙여 쓴다
    return bk.items.map((it) => '<p style="font-size:' + b.body + 'px;line-height:1.8;margin:0;color:' + tcol + ';">' + ftInline(it, b) + '</p>').join('');
  }
  if (bk.t === 'ul' || bk.t === 'ol') {
    return bk.items.map((it, i) => '<p style="font-size:' + b.body + 'px;line-height:1.8;margin:0;padding-left:4px;color:' + tcol + ';">' + (bk.t === 'ul' ? '• ' : (i + 1) + '. ') + ftInline(it, b) + '</p>').join('');
  }
  if (bk.t === 'table') {
    const rows = bk.rows.map((cells, ri) => {
      const tag = ri === 0 ? 'th' : 'td';
      const st = 'border:1px solid ' + b.hr + ';padding:8px 10px;' + (ri === 0 ? 'background-color:' + b.th + ';font-weight:700;color:' + b.subColor + ';' : 'color:' + tcol + ';');
      return '<tr>' + cells.map((c) => '<' + tag + ' style="' + st + '">' + ftInline(c, b) + '</' + tag + '>').join('') + '</tr>';
    }).join('');
    return '<table style="border-collapse:collapse;width:100%;margin:0;font-size:' + Math.max(13, b.body - 1) + 'px;">' + rows + '</table>';
  }
  return '';
}

/* 블록들을 이어 붙인 HTML — 빈 줄 자리마다 실제 빈 문단을 끼운다(클립보드 text/html 과 미리보기가 같은 문자열) */
function ftHTML(blocks, b) {
  let html = '';
  let prev = null;
  blocks.forEach((bk) => {
    if (!ftBlockPlain(bk)) return;                    // 평문이 빈 블록은 넣지 않는다(ftPlain 과 같은 기준)
    const one = ftBlockHTML(bk, b);
    if (!one) return;
    if (html && !ftTightAfter(prev, bk, b)) html += ftBlankHTML(b);
    html += one;
    prev = bk;
  });
  return html ? '<div style="color:' + (b.text || '#3B3330') + ';word-break:keep-all;">' + html + '</div>' : '';
}

function ftPlain(blocks, b) {
  let out = '';
  let prev = null;
  blocks.forEach((bk) => {
    const txt = ftBlockPlain(bk);
    if (!txt) return;
    // 원래 빈 줄이 없던 곳(gapBefore=false)은 빈 줄 없이 잇는다 — 복사본도 화면과 같이 나오게.
    // 단, 소제목·구분선·첫인사·안내문은 앞뒤에 빈 줄 1줄을 둔다. (HTML 빈 문단과 같은 규칙 = ftTightAfter)
    const tight = out ? ftTightAfter(prev, bk, b) : false;
    out += (out ? (tight ? '\n' : '\n\n') : '') + txt;
    prev = bk;
  });
  return out;
}

/* 빈 줄 없이 이어진 본문 줄(\n 한 번)은 한 문단으로 묶는다.
   줄마다 따로 문단으로 만들면 미리보기·복사본에 줄마다 빈 줄이 생긴다(2026-11-20 지시: 원래 줄바꿈은 붙여서). */
function ftJoinLines(blocks) {
  const out = [];
  for (const bk of blocks) {
    const pv = out[out.length - 1];
    if (pv && pv.t === 'p' && bk.t === 'p' && bk.gapBefore === false) {
      pv.s = String(pv.s || '') + '\n' + String(bk.s || '');
      pv.gapAfter = bk.gapAfter;
      continue;
    }
    out.push(Object.assign({}, bk));
  }
  return out;
}

/* 미리보기 = 복사본과 같은 HTML */
function ftBuild() {
  const b = ftBlogC();                       // 고른 형광펜·글씨 색을 입힌 사본
  let blocks = ftParse($('#ftInput') ? $('#ftInput').value : '');
  if (FT.auto) blocks = ftAuto(blocks, b);                     // 자동 정리 + 예지브러리 첫인사·마무리 끝인사
  blocks = ftJoinLines(blocks);                                // 원래 붙여 쓴 줄은 한 문단(줄바꿈만)으로
  const html = blocks.length ? ftHTML(blocks, b) : '';         // 빈 줄 자리에 실제 빈 문단까지 넣은 HTML
  return { html, text: ftPlain(blocks, b), blocks, blog: b };
}

/* 🚨 고소·저작권 주의 대상 검사 — 원고 본문 + 첫인사 + 마무리 끝인사 전부 */
function ftBlockScan() {
  const parts = [];
  ['#ftInput', '#ftGreet', '#ftClose'].forEach((sel) => {
    const el = $(sel);
    if (el && el.value) parts.push(el.value);
  });
  const all = parts.join('\n');
  return { hits: ycScan(all), soft: ycSoft(all) };
}

function ftBlockHits() { return ftBlockScan().hits; }

function ftBlockPaint(sc) {
  const box = $('#ftBlockWarn');
  if (!box) return;
  sc = sc || ftBlockScan();
  const html = (sc.hits.length ? window.ycBlockBanner(sc.hits, {
    note: '이대로 복사하면 원고에 그대로 들어갑니다. 대상 이름·문장을 빼고 다시 써 주세요. (복사 버튼을 누르면 한 번 더 확인합니다)',
  }) : '') + (sc.soft.length ? ycSoftBox(sc.soft) : '') +
    (sc.hits.length ? '<button class="btn soft sm blk-alt" data-go="silhouette">🎨 사진 대신 안전한 실루엣 썸네일 만들기</button>' : '');
  box.innerHTML = html;
  box.classList.toggle('hidden', !html);
  const cp = $('#ftCopy');
  if (cp) cp.classList.toggle('warn', sc.hits.length > 0);
}

function ftRender() {
  if (!FT.bound) return;
  const preset = ftBlog();
  const b = ftBlogC();
  const src = $('#ftInput').value;
  const out = ftBuild();
  ftBlockPaint(ftBlockScan());
  const prev = $('#ftPreview');
  if (!src.trim()) {
    prev.innerHTML = '<div class="ft-empty">원고를 붙여넣으면 여기에 <b>' + esc(b.name) + '</b> 서식으로 바로 보여요.<br>샘플 버튼으로 한 번 확인해 보세요.</div>';
    $('#ftCount').textContent = '0자';
  } else {
    prev.innerHTML = out.html;
    const nsp = out.text.replace(/\s/g, '').length;
    let cnt = nsp.toLocaleString('ko-KR') + '자 (공백 제외)';
    if (b.target) {
      const ok = nsp >= b.target[0] && nsp <= b.target[1] * 1.08;
      cnt += ' · 목표 ' + b.target[0].toLocaleString('ko-KR') + '~' + b.target[1].toLocaleString('ko-KR') + '자' + (ok ? ' ✓' : '');
    }
    $('#ftCount').textContent = cnt;
  }
  $('#ftPrevMeta').textContent = b.name + ' 서식 · ' + b.tone;
  $('#ftRules').innerHTML = ftRuleChips(preset, b).join('');
  $('#ftClear').classList.toggle('hidden', !src.trim());
}

/* 구형·모바일 폴백: contenteditable + execCommand('copy') */
function ftCopyLegacy(html, text) {
  try {
    const host = document.createElement('div');
    host.contentEditable = 'true';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;overflow:hidden;opacity:0;z-index:-1;user-select:text;-webkit-user-select:text;';
    host.innerHTML = html;
    document.body.appendChild(host);
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(host);
    sel.removeAllRanges(); sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    document.body.removeChild(host);
    if (ok) return Promise.resolve(true);
  } catch (e) { /* 아래 평문 */ }
  return copyText(text);
}

function ftCopy() {
  const out = ftBuild();
  if (!out.html) { toast('원고를 먼저 붙여넣어 주세요'); return; }
  const hits = ftBlockHits();
  if (hits.length) {
    const go = window.confirm('🚨 고소·저작권 주의 대상이 원고에 있어요.\n· ' + ycLabels(hits) +
      '\n\n이대로 복사할까요? (대상 이름·문장을 먼저 빼 주세요)');
    if (!go) { toast('복사를 멈추었어요 · 주의 대상 문장을 빼 주세요'); return; }
  }
  let p = null;
  // 1) 표준 Clipboard API — ClipboardItem 은 제스처 안에서 바로 만든다(iOS 사파리)
  if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([out.html], { type: 'text/html' }),
        'text/plain': new Blob([out.text], { type: 'text/plain' }),
      });
      p = navigator.clipboard.write([item]).then(() => true, () => false);
    } catch (e) { p = null; }
  }
  Promise.resolve(p).then((ok) => (ok ? true : ftCopyLegacy(out.html, out.text))).then((ok) => {
    if (ok) toast('서식째 복사했어요 · 네이버 에디터에 붙여넣기 ✨');
    else toast('복사가 막혔어요 · 미리보기를 길게 눌러 전체 복사해 주세요');
  });
}

function ftInit() {
  if (FT.bound) { ftRender(); return; }
  FT.bound = true;

  $('#ftPicks').innerHTML = FT_BLOGS.map((b) =>
    '<button class="ft-pick" data-ftblog="' + b.id + '">' +
    '<span class="bd" style="background:' + b.badge + '">' + b.emoji + '</span>' +
    '<span class="tx"><span class="nm">' + esc(b.name) + '</span><span class="sk" style="background:' + b.hl + '"></span></span>' +
    '</button>').join('');

  const saved = LS.get('yc.ft', null);
  if (saved) {
    if (saved.blog && FT_BLOGS.some((b) => b.id === saved.blog)) FT.blog = saved.blog;
    FT.auto = saved.auto !== false;
    if (saved.custom && typeof saved.custom === 'object') FT.custom = saved.custom;
  }
  const ta = $('#ftInput');
  if (saved && typeof saved.text === 'string') ta.value = saved.text;
  $('#ftAuto').checked = FT.auto;
  $$('#ftPicks [data-ftblog]').forEach((x) => x.classList.toggle('on', x.dataset.ftblog === FT.blog));
  ftEndSync();
  ftColorSync(); ftPaintPicks();

  let timer = 0;
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { ftRender(); ftSave(); }, 200); });
  $('#ftPicks').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-ftblog]');
    if (!c) return;
    FT.blog = c.dataset.ftblog;
    $$('#ftPicks [data-ftblog]').forEach((x) => x.classList.toggle('on', x.dataset.ftblog === FT.blog));
    ftEndSync(); ftColorSync(); ftRender(); ftSave();
  });
  // 🖍️ 형광펜 색 · 글씨 색
  $('#ftHlSw').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-c]');
    if (c) ftApplyColor('hl', c.dataset.c);
  });
  $('#ftHlPick').addEventListener('input', (e) => ftApplyColor('hl', e.target.value));
  $('#ftHlReset').onclick = () => ftApplyColor('hl', '');
  $('#ftTxTgt').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-tt]');
    if (!c) return;
    FTC.target = c.dataset.tt;
    ftColorSync();
  });
  $('#ftTxSw').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-c]');
    if (c) ftApplyColor(FTC.target, c.dataset.c);
  });
  $('#ftTxPick').addEventListener('input', (e) => ftApplyColor(FTC.target, e.target.value));
  $('#ftTxReset').onclick = () => ftApplyColor(FTC.target, '');
  // 첫인사·마무리 끝인사 입력란(블로그별로 기억)
  $('#ftGreetOn').addEventListener('change', (e) => { ftEdit(ftBlog()).greetOn = e.target.checked; ftRender(); ftSave(); });
  $('#ftCloseOn').addEventListener('change', (e) => { ftEdit(ftBlog()).closeOn = e.target.checked; ftRender(); ftSave(); });
  let etimer = 0;
  $('#ftGreet').addEventListener('input', (e) => {
    ftEdit(ftBlog()).greet = e.target.value;
    clearTimeout(etimer); etimer = setTimeout(() => { ftRender(); ftSave(); }, 200);
  });
  $('#ftClose').addEventListener('input', (e) => {
    ftEdit(ftBlog()).close = e.target.value;
    clearTimeout(etimer); etimer = setTimeout(() => { ftRender(); ftSave(); }, 200);
  });
  $('#ftAuto').addEventListener('change', (e) => { FT.auto = e.target.checked; ftRender(); ftSave(); });
  $('#ftSample').onclick = () => { ta.value = ftSample(); ftRender(); ftSave(); };
  $('#ftTidy').onclick = () => {
    if (!ta.value.trim()) { toast('원고를 먼저 붙여넣어 주세요'); return; }
    const v = ftSquashBlank(ta.value, FT.blog);
    if (v === ta.value) { toast('빈 줄이 이미 깔끔해요'); return; }
    ta.value = v; ftRender(); ftSave(); toast('연속 빈 줄을 한 줄로 정리했어요');
  };
  $('#ftHeads').onclick = () => {
    if (!ta.value.trim()) { toast('원고를 먼저 붙여넣어 주세요'); return; }
    const v = ftAddBlank(ta.value, FT.blog);
    if (v === ta.value) { toast('소제목 앞뒤 빈 줄이 이미 맞아요'); return; }
    ta.value = v; ftRender(); ftSave(); toast('소제목 앞뒤에 빈 줄을 넣었어요');
  };
  $('#ftClear').onclick = () => { ta.value = ''; ftRender(); ftSave(); };
  $('#ftCopy').onclick = ftCopy;
  $('#ftSelect').onclick = () => {
    try {
      const r = document.createRange();
      r.selectNodeContents($('#ftPreview'));
      const s = window.getSelection();
      s.removeAllRanges(); if (r.toString().trim()) s.addRange(r);
      toast('전체 선택했어요 · 꾹 눌러 복사해 주세요');
    } catch (e) { toast('선택이 막혀 있어요'); }
  };
  ftRender();
}

function ftSave() {
  if (!FT.bound) return;
  LS.set('yc.ft', {
    blog: FT.blog, auto: FT.auto, custom: FT.custom,
    text: $('#ftInput').value,
  });
}

/* 테스트용 */
window.__yc = {
  scan: ycScan,
  labels: ycLabels,
  score: scoreHomeTitle,
  runScorer: runScorer,
  renderMaterials: renderMaterials,
  state: () => APP.state,
  ui: () => APP.ui,
  ftBlockScan: ftBlockScan,
  ftBlockHits: ftBlockHits,
};
window.__ft = {
  presets: FT_BLOGS,
  build: ftBuild,
  parse: ftParse,
  sample: ftSample,
  tidy: ftSquashBlank,
  blankHeads: ftAddBlank,
  plain: ftPlain,
  blog: (id) => { FT.blog = id; $$('#ftPicks [data-ftblog]').forEach((x) => x.classList.toggle('on', x.dataset.ftblog === id)); ftEndSync(); ftRender(); },
  auto: (v) => { FT.auto = !!v; $('#ftAuto').checked = !!v; ftRender(); },
  edit: () => ftEdit(ftBlog()),
  setEnd: (patch) => { const e = ftEdit(ftBlog()); Object.assign(e, patch || {}); ftEndSync(); ftRender(); },
  colors: () => {
    const b = ftBlog();
    return { blog: b.id, hl: ftColorVal(b, 'hl'), bold: ftColorVal(b, 'bold'),
             sub: ftColorVal(b, 'sub'), text: ftColorVal(b, 'text'), target: FTC.target };
  },
  setColor: (k, v) => ftApplyColor(k, v),
  colorTarget: (k) => { FTC.target = k; ftColorSync(); },
};

/* ───────────────────────── 잠금 / 부팅 ───────────────────────── */
let pinBuf = '';
function paintPin() {
  $$('#pinDots i').forEach((d, i) => d.classList.toggle('on', i < pinBuf.length));
}
async function tryUnlock(pin) {
  try {
    const st = await decryptEnvelope(APP.built, pin);
    APP.config = st;
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

/* ═════════════ 🎨 실루엣 썸네일 (2026-11-20 추가 · 같은 날 보강) ═════════════
   외부 API·사진 없이 브라우저 Canvas로만 그린다.
   붉으스름한 배경 + 큼직한 인물 실루엣(머리가 화면 절반 이상) + 얼굴을 채우는 큰 기호
   → 사진을 못 쓰는 글(고소·저작권 주의)의 대표 썸네일용.
   보강: 기호 크기·위치 슬라이더 + 미리보기 드래그 · 기호 색(화이트/블랙) ·
         사진 블러 강도 · ⚔️ VS 2장 콜라주(사진 2장 / 실루엣 2명) */
const SL = {
  kind: LS.get('yc.sl.kind', 'male'),
  bg: LS.get('yc.sl.bg', 'red'),
  glyph: LS.get('yc.sl.glyph', '?'),
  ink: LS.get('yc.sl.ink', 'white'),
  ratio: LS.get('yc.sl.ratio', '1:1'),
  caption: LS.get('yc.sl.caption', ''),
  size: Number(LS.get('yc.sl.size', 100)) || 100,     // 기호 크기 %
  ox: Number(LS.get('yc.sl.ox', 0)) || 0,             // 가로 위치 % (캔버스 폭 기준)
  oy: Number(LS.get('yc.sl.oy', 0)) || 0,             // 세로 위치 %
  blur: Number(LS.get('yc.sl.blur', 35)) || 0,        // 사진 블러 강도 %
  split: LS.get('yc.sl.split', 'straight'),           // 'straight' | 'diagonal'
  vsLeftKind: LS.get('yc.sl.vsLeftKind', 'male'),
  vsRightKind: LS.get('yc.sl.vsRightKind', 'female'),
  mode: 'silhouette',      // 'silhouette' | 'photo'(내 사진 블러) | 'vs'(⚔️ 2장 콜라주)
  seed: 0,                 // 생성할 때마다 새로 뽑는다(유사 이미지 방지)
  img: null,
  imgName: '',
  vsL: null, vsLName: '',
  vsR: null, vsRName: '',
  bound: false,
};

/* 배경 프리셋 — 가운데는 뜨겁게, 바깥은 어둡게 (레퍼런스: 딥레드 연기 질감 + 비네트) */
const SL_BG = {
  red: { name: '붉은빛', hot: '#D41C1C', from: '#8B0000', to: '#120306', neon: '#FF2A2A', tint: 'rgba(122,18,28,.62)',
    hots: ['#D41C1C', '#B31217', '#E02020', '#9B0D12', '#C41818'],
    froms: ['#8B0000', '#7A0B14', '#6E0A0F', '#5C0710', '#83060C'] },
  navy: { name: '네이비', hot: '#2A5BB8', from: '#10224A', to: '#04070E', neon: '#3B7BFF', tint: 'rgba(16,40,86,.62)',
    hots: ['#2A5BB8', '#1E4C9E', '#3568CE', '#21458F'],
    froms: ['#10224A', '#0C1B3C', '#152C55', '#0A1730'] },
  brown: { name: '다크브라운', hot: '#A85A2C', from: '#4A2317', to: '#0F0603', neon: '#FF8A3D', tint: 'rgba(74,32,18,.62)',
    hots: ['#A85A2C', '#8E4A22', '#B8682F', '#7A3C1B'],
    froms: ['#4A2317', '#3E1C12', '#54291A', '#33140D'] },
  purple: { name: '딥퍼플', hot: '#8B4BE0', from: '#3B2068', to: '#0B0514', neon: '#B266FF', tint: 'rgba(58,28,96,.62)',
    hots: ['#8B4BE0', '#7640C4', '#9D5CF0', '#6733B0'],
    froms: ['#3B2068', '#301A55', '#452A78', '#291647'] },
};

const SL_KIND = { male: '남자', female: '여자', player: '선수', random: '🎲 랜덤' };
const SL_GLYPH = { '?': '?', '!': '!', 'VS': 'VS', none: '없음' };
const SL_INK = { white: '화이트', black: '블랙' };
const SL_SPLIT = { straight: '직선 분할', diagonal: '사선 분할' };
const SL_FONT = '800 %s "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif';

/* 생성 버튼을 누를 때마다 새 시드 — 픽셀·구성이 매번 조금씩 달라진다(네이버 유사 이미지 방지) */
function slNewSeed() { SL.seed = Math.floor(Math.random() * 1e9) + 1; }

/* 시드로 그 회차의 변주를 뽑는다 (같은 시드면 같은 그림) */
function slVariant(seed) {
  const R = slRnd((seed != null ? seed : (SL.seed || 1)) || 1);
  const fonts = [
    SL_FONT,
    '800 %s Georgia,"Times New Roman",serif',
    '900 %s "Arial Black",Impact,"Malgun Gothic",sans-serif',
    '800 %s "Courier New",monospace',
  ];
  return {
    hotIdx: Math.floor(R() * 5),
    fromIdx: Math.floor(R() * 5),
    smokeSeed: Math.floor(R() * 1e9) + 7,
    smokeN: 44 + Math.floor(R() * 22),
    glowX: 0.5 + (R() - 0.5) * 0.14,
    glowY: 0.36 + (R() - 0.5) * 0.12,
    scale: 0.975 + R() * 0.05,
    offX: (R() - 0.5) * 0.03,
    offY: (R() - 0.5) * 0.016,
    glyphRot: (R() - 0.5) * 5,          // ±2.5도
    glyphSizeK: 0.97 + R() * 0.06,      // ±3%
    glyphGlowK: 0.75 + R() * 0.6,
    glyphFont: fonts[Math.floor(R() * fonts.length)],
    ringK: 0.85 + R() * 0.3,
    kind: ['male', 'female', 'player'][Math.floor(R() * 3)],
  };
}

let SL_V = null;

function slKindNow(V) {
  return SL.kind === 'random' ? (V ? V.kind : 'male') : SL.kind;
}

function slSize() { return SL.ratio === '16:9' ? [1600, 900] : [1000, 1000]; }

/* 둥근 사각형 경로 (구형 브라우저에도 안전하게 직접 그림) */
function slRR(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
  ctx.fill();
}

/* '#RRGGBB' + 알파 → 'rgba(...)' */
function slA(hex, a) {
  const h = String(hex || '#FF2A2A').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* 고정 난수 — 다시 그려도 같은 질감이 나오게 */
function slRnd(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* 배경 — 중앙 딥레드 + 연기 질감 + 입자 + 비네트 */
function slBackground(ctx, W, H, cfg, V) {
  V = V || slVariant();
  const S = Math.min(W, H);
  ctx.fillStyle = cfg.to;
  ctx.fillRect(0, 0, W, H);

  const rg = ctx.createRadialGradient(W * V.glowX, H * (V.glowY - 0.04), S * 0.02, W * V.glowX, H * (V.glowY + 0.04), S * (0.80 + V.ringK * 0.05));
  rg.addColorStop(0, cfg.hot);
  rg.addColorStop(0.42, cfg.from);
  rg.addColorStop(1, cfg.to);
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);

  /* 머리 뒤 역광 */
  const bk = ctx.createRadialGradient(W * V.glowX, H * V.glowY, S * 0.04, W * V.glowX, H * (V.glowY + 0.02), S * 0.40);
  bk.addColorStop(0, slA(cfg.neon, 0.30));
  bk.addColorStop(0.55, slA(cfg.neon, 0.14));
  bk.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bk;
  ctx.fillRect(0, 0, W, H);

  /* 연기·구름 질감 */
  const rnd = slRnd(V.smokeSeed);
  for (let i = 0; i < V.smokeN; i++) {
    const x = W * (0.08 + rnd() * 0.84);
    const y = H * (0.04 + rnd() * 0.80);
    const r = S * (0.07 + rnd() * 0.32);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.30;
    const a = (dark ? 0.10 : 0.06) + rnd() * 0.10;
    g.addColorStop(0, dark ? 'rgba(0,0,0,' + a.toFixed(3) + ')' : 'rgba(255,86,70,' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* 거친 입자 */
  for (let i = 0; i < 2200 + V.smokeN * 8; i++) {
    const x = rnd() * W, y = rnd() * H;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,225,215,.035)' : 'rgba(0,0,0,.055)';
    ctx.fillRect(x, y, 1.7, 1.7);
  }

  /* 바깥 비네트 */
  const vg = ctx.createRadialGradient(W * 0.5, H * 0.44, S * 0.16, W * 0.5, H * 0.44, S * 0.86);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.55, 'rgba(0,0,0,.26)');
  vg.addColorStop(1, 'rgba(0,0,0,.90)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

/* 정면 상반신 실루엣 — 머리통이 화면 세로의 60%쯤 되는 큼직한 클로즈업
   (레퍼런스: 머리 위 여백 최소 · 어깨는 아래 25~30%만) */
function slFigure(ctx, W, H, opt) {
  opt = opt || {};
  const S = opt.s || Math.min(W, H);
  const cx = (opt.cx != null) ? opt.cx : W / 2;
  const rh = S * (opt.headK || 0.30);        // 머리 세로 반지름
  const rw = rh * (opt.headW || 1.04);       // 머리 가로 반지름
  const cy = H * (opt.cyK || 0.385);         // 머리 중심
  const eff = opt.kind || slKindNow(SL_V);
  const female = eff === 'female';
  const player = eff === 'player';
  const neckW = rw * (female ? 0.40 : 0.46) * (opt.neckW || 1);
  const neckTop = cy + rh * 0.62;
  const neckBot = cy + rh * (opt.neckK || 1.22);
  const capY = Math.max(neckBot + rh * 0.30, H * (opt.capHK || 0.68));   // 어깨 시작 (목 밑보다 반드시 아래)
  const shoulderDrop = Math.max(H * 0.02, rh * 0.06);

  ctx.save();
  ctx.fillStyle = '#050505';

  /* 어깨 + 몸통 (화면 밖까지) */
  const sw = Math.max(W * 0.62, rw * 2.8);
  const capX = Math.max(W * (opt.capF || 0.30), rw * 1.00);   // 어깨 끝 x
  const outX = W * 0.60;                              // 어깨가 화면 밖으로 빠지는 x
  const outY = capY + Math.max(H * 0.02, (H - capY) * (opt.outK || 0.34));
  const p1y = shoulderDrop * (opt.p1y != null ? opt.p1y : 0.7);
  const p2x = neckW * (opt.p2x || 1.4);
  const p2y = rh * (opt.p2y || 0);
  ctx.beginPath();
  ctx.moveTo(cx - sw - W * 0.06, H * 1.05);
  ctx.lineTo(cx - sw - W * 0.06, outY + H * 0.02);
  ctx.quadraticCurveTo(cx - sw, outY, cx - outX, outY);
  ctx.bezierCurveTo(cx - outX * 0.72, outY - shoulderDrop * 0.5, cx - capX * 1.25, capY + shoulderDrop * 0.6, cx - capX, capY);
  ctx.bezierCurveTo(cx - capX * 0.8, capY - p1y, cx - p2x, neckBot + p2y, cx - neckW, neckBot);
  ctx.lineTo(cx + neckW, neckBot);
  ctx.bezierCurveTo(cx + p2x, neckBot + p2y, cx + capX * 0.8, capY - p1y, cx + capX, capY);
  ctx.bezierCurveTo(cx + capX * 1.25, capY + shoulderDrop * 0.6, cx + outX * 0.72, outY - shoulderDrop * 0.5, cx + outX, outY);
  ctx.quadraticCurveTo(cx + sw, outY, cx + sw + W * 0.06, outY + H * 0.02);
  ctx.lineTo(cx + sw + W * 0.06, H * 1.05);
  ctx.closePath();
  ctx.fill();

  /* 목 */
  ctx.beginPath();
  ctx.moveTo(cx - neckW, neckTop);
  ctx.lineTo(cx + neckW, neckTop);
  ctx.lineTo(cx + neckW * 1.06, neckBot);
  ctx.lineTo(cx - neckW * 1.06, neckBot);
  ctx.closePath();
  ctx.fill();

  /* 턱 + 머리 */
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
  ctx.fill();
  /* 턱선을 조금 좁게 다듬기 */
  ctx.beginPath();
  ctx.ellipse(cx, cy + rh * 0.42, rw * 0.86, rh * 0.62, 0, 0, Math.PI);
  ctx.fill();

  /* 귀 */
  [1, -1].forEach((s) => {
    ctx.beginPath();
    ctx.ellipse(cx + s * rw * 0.95, cy + rh * 0.12, rw * 0.09, rh * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  if (female) {
    /* 긴 머리 — 정수리에서 턱선 아래까지 */
    ctx.beginPath();
    ctx.ellipse(cx, cy - rh * 0.06, rw * 1.10, rh * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    /* 턱선까지만 떨어지는 단발 (목이 보이게 짧게) */
    slRR(ctx, cx - rw * 1.10, cy - rh * 0.10, rw * 0.44, rh * 0.86, rw * 0.22);
    slRR(ctx, cx + rw * 0.66, cy - rh * 0.10, rw * 0.44, rh * 0.86, rw * 0.22);
  } else {
    /* 짧은 머리 — 정수리에 잔머리 결 */
    ctx.beginPath();
    ctx.ellipse(cx, cy - rh * 0.09, rw * 1.04, rh * 0.99, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!player) {
      /* 물결치는 머리 결 — 원을 붙이지 않고 반지름을 흔들어 그린다 */
      ctx.beginPath();
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const a = Math.PI * (1.0 + i / N);          // 위쪽 반원
        const wob = 1 + 0.032 * Math.sin(a * 7.5 + 0.6) + 0.016 * Math.sin(a * 17);
        const px = cx + Math.cos(a) * rw * wob;
        const py = cy - rh * 0.04 + Math.sin(a) * rh * wob;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineTo(cx + rw * 1.02, cy + rh * 0.08);
      ctx.lineTo(cx - rw * 1.02, cy + rh * 0.08);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (player) {
    /* 야구 모자 — 둥근 챙 + 앞으로 짧게 나온 챙 */
    ctx.beginPath();
    ctx.ellipse(cx, cy - rh * 0.46, rw * 1.08, rh * 0.56, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    slRR(ctx, cx + rw * 0.16, cy - rh * 0.56, rw * 1.16, rh * 0.20, rh * 0.10);
  }

  ctx.restore();
  return { cx, cy, rh, rw };
}

/* 사진을 캔버스에 꽉 차게(cover) */
function slCover(ctx, im, x, y, w, h) {
  const k = Math.max(w / im.width, h / im.height);
  const dw = im.width * k, dh = im.height * k;
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/* 사진 블러(선택) — 캔버스만으로. filter 미지원 브라우저도 되도록 축소→확대 방식
   강도 0 = 거의 원본 / 100 = 아주 흐리게 */
function slBlurPhoto(ctx, im, W, H, strength) {
  const b = Math.max(0, Math.min(100, strength == null ? SL.blur : strength)) / 100;
  const k = Math.max(2, Math.round(2 + b * 26));
  const small = document.createElement('canvas');
  small.width = Math.max(2, Math.round(W / k));
  small.height = Math.max(2, Math.round(H / k));
  const sc = small.getContext('2d');
  const s = Math.max(small.width / im.width, small.height / im.height);
  const dw = im.width * s, dh = im.height * s;
  sc.drawImage(im, (small.width - dw) / 2, (small.height - dh) / 2, dw, dh);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (b > 0.02) { try { ctx.filter = 'blur(' + Math.round(Math.min(W, H) * 0.012 * b) + 'px)'; } catch (e) { /* 무시 */ } }
  ctx.drawImage(small, 0, 0, W, H);
  ctx.filter = 'none';
  ctx.restore();
}

function slDrawPhoto(ctx, W, H) {
  slBlurPhoto(ctx, SL.img, W, H);
  /* 원본 색감 유지 — 붉은 틴트 없이 아주 살짝만 어둡게 (하얀 ?가 보이도록) */
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  ctx.fillRect(0, 0, W, H);
  const cg = ctx.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.06, W * 0.5, H * 0.46, Math.min(W, H) * 0.42);
  cg.addColorStop(0, 'rgba(0,0,0,.30)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, W, H);
  /* 가장자리만 살짝 비네트 */
  const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.30, W * 0.5, H * 0.5, Math.min(W, H) * 0.80);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  return { cx: W / 2, cy: H * 0.46, rh: Math.min(W, H) * 0.20, rw: Math.min(W, H) * 0.16 };
}

/* 배경 + 실루엣(+네온 글로우) 한 벌 — 본 캔버스·VS 좌우 패널이 같이 쓴다 */
let SL_MASK = null;
function slPaintFigure(ctx, W, H, cfg, V, opt) {
  slBackground(ctx, W, H, cfg, V);
  SL_MASK = SL_MASK || document.createElement('canvas');
  SL_MASK.width = W; SL_MASK.height = H;
  const mctx = SL_MASK.getContext('2d');
  mctx.clearRect(0, 0, W, H);
  const p = slFigure(mctx, W, H, opt);

  const S = Math.min(W, H);
  const ax = W / 2, ay = H * 0.58;
  const put = (fn) => {
    ctx.save();
    ctx.translate(ax + W * V.offX, ay + H * V.offY);
    ctx.scale(V.scale, V.scale);
    ctx.translate(-ax, -ay);
    fn();
    ctx.restore();
  };
  const gk = (opt && opt.glow) || 1;
  put(() => {
    ctx.shadowColor = cfg.neon;
    ctx.shadowBlur = S * 0.085 * V.ringK * gk; ctx.drawImage(SL_MASK, 0, 0);
    ctx.shadowBlur = S * 0.045 * V.ringK * gk; ctx.drawImage(SL_MASK, 0, 0);
    ctx.shadowBlur = S * 0.012; ctx.drawImage(SL_MASK, 0, 0);
  });
  put(() => ctx.drawImage(SL_MASK, 0, 0));
  return p;
}

/* 기호 기본 크기 — 레퍼런스처럼 얼굴을 꽉 채우는 크기 (? 높이가 캔버스 세로의 60%쯤) */
function slGlyphBase(W, H) {
  const S = Math.min(W, H);
  if (SL.glyph === 'VS') return S * 0.40;
  if (SL.glyph === '!') return S * 0.94;
  return S * 0.88;
}

/* 가운데 큰 기호 — 화이트(붉은 빛 번짐) / 블랙(흰 테두리 + 흰 번짐) */
function slGlyph(ctx, W, H, p, V) {
  if (SL.glyph === 'none') return;
  V = V || slVariant();
  const cfg = SL_BG[SL.bg] || SL_BG.red;
  const txt = SL.glyph;
  const fs = Math.max(12, slGlyphBase(W, H) * (SL.size / 100) * (V.glyphSizeK || 1));
  const font = (V.glyphFont || SL_FONT).replace('%s', Math.round(fs) + 'px');
  const cx = p.cx + W * (SL.ox / 100);
  const gy = (SL.mode === 'photo' ? p.cy : p.cy + p.rh * 0.26) + H * (SL.oy / 100);
  const S = Math.min(W, H);
  ctx.save();
  ctx.translate(cx, gy);
  ctx.rotate((V.glyphRot || 0) * Math.PI / 180);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font;

  if (SL.ink === 'black') {
    /* 블랙 — 밝은 사진 위에서도 읽히도록 흰 테두리 + 살짝 흰 번짐 */
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.96)';
    ctx.lineWidth = Math.max(3, fs * 0.055);
    ctx.shadowColor = 'rgba(255,255,255,.85)';
    ctx.shadowBlur = S * 0.035 * (V.glyphGlowK || 1);
    ctx.strokeText(txt, 0, 0);
    ctx.strokeText(txt, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0A0A0A';
    ctx.fillText(txt, 0, 0);
  } else {
    /* 화이트 — 붉은 네온 번짐 (사진 모드는 흰 빛으로) */
    ctx.shadowColor = SL.mode === 'photo' ? 'rgba(255,255,255,.95)' : cfg.neon;
    ctx.shadowBlur = S * 0.07 * (V.glyphGlowK || 1);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(txt, 0, 0);
    ctx.fillText(txt, 0, 0);
    /* 선명한 본체 */
    ctx.shadowBlur = S * 0.012;
    ctx.shadowColor = 'rgba(255,255,255,.85)';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(txt, 0, 0);
  }
  ctx.restore();
}

/* ⚔️ VS 콜라주 — 한쪽 패널(사진 또는 실루엣)을 따로 그린다 */
function slVSPanel(g, W, H, side, cfg, V) {
  const im = side === 'L' ? SL.vsL : SL.vsR;
  const kind = side === 'L' ? SL.vsLeftKind : SL.vsRightKind;
  if (im) {
    slCover(g, im, 0, 0, W, H);
    /* 사진은 또렷하게 — 살짝만 어둡게 + 비네트로 좌우 대비를 살린다 */
    g.fillStyle = 'rgba(0,0,0,.16)';
    g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.28, W * 0.5, H * 0.5, Math.min(W, H) * 0.86);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    return null;
  }
  return slPaintFigure(g, W, H, cfg, V, {
    s: Math.min(W, H) * 1.02,
    cyK: 0.32,
    outK: 0.85,
    neckK: 1.22,
    capHK: 0.70,
    capF: 0.29,
    neckW: 0.9,
    glow: 0.55,
    kind: kind === 'random' ? V.kind : kind,
  });
}

/* 가운데 VS 배지 — 붉은/다크 테마에 어울리는 원형 배지 */
function slVSBadge(ctx, W, H, cfg) {
  const S = Math.min(W, H);
  const r = S * 0.125;
  const dark = SL.ink !== 'black';
  ctx.save();
  ctx.translate(W / 2, H / 2);

  /* 빛 번짐 */
  ctx.shadowColor = dark ? cfg.neon : 'rgba(0,0,0,.55)';
  ctx.shadowBlur = r * 1.1;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.14, 0, Math.PI * 2);
  ctx.fillStyle = dark ? 'rgba(12,2,4,.94)' : 'rgba(255,250,247,.97)';
  ctx.fill();
  ctx.shadowBlur = 0;

  /* 안쪽 원 */
  const gd = ctx.createRadialGradient(0, -r * 0.38, r * 0.08, 0, 0, r);
  if (dark) {
    gd.addColorStop(0, '#C4151B');
    gd.addColorStop(0.55, '#7C0A10');
    gd.addColorStop(1, '#2B0306');
  } else {
    gd.addColorStop(0, '#FFFFFF');
    gd.addColorStop(1, '#F1E4E0');
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = gd;
  ctx.fill();

  /* 테두리 */
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.strokeStyle = dark ? cfg.neon : '#7C0A10';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2);
  ctx.stroke();

  /* VS 글자 */
  ctx.font = '900 ' + Math.round(r * 0.92) + 'px "Arial Black",Impact,"Malgun Gothic",system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (dark) {
    ctx.shadowColor = 'rgba(255,60,50,.85)';
    ctx.shadowBlur = r * 0.35;
  }
  ctx.fillStyle = dark ? '#FFFFFF' : '#0A0A0A';
  ctx.fillText('VS', 0, r * 0.05);
  ctx.restore();
}

/* ⚔️ VS 콜라주 본체 */
function slDrawVS(ctx, W, H, cfg, V) {
  const half = W / 2;
  const skew = SL.split === 'diagonal' ? W * 0.045 : 0;
  const pw = Math.ceil(half + skew * 2) + 2;

  const cl = document.createElement('canvas'); cl.width = pw; cl.height = H;
  slVSPanel(cl.getContext('2d'), pw, H, 'L', cfg, slVariant(SL.seed + 11));
  const cr = document.createElement('canvas'); cr.width = pw; cr.height = H;
  slVSPanel(cr.getContext('2d'), pw, H, 'R', cfg, slVariant(SL.seed + 7919));

  /* 왼쪽 */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(half - skew, 0);
  ctx.lineTo(half + skew, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(cl, -skew, 0);
  ctx.restore();

  /* 오른쪽 */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(half - skew, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H);
  ctx.lineTo(half + skew, H);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(cr, half - skew, 0);
  ctx.restore();

  /* 경계선 — 어두운 테두리 + 흰 선으로 또렷하게 */
  const drawSeam = (width, color, blur) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(half - skew, 0);
    ctx.lineTo(half + skew, H);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.shadowColor = blur ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,0)';
    ctx.shadowBlur = blur ? Math.min(W, H) * 0.02 : 0;
    ctx.stroke();
    ctx.restore();
  };
  drawSeam(Math.max(7, W * 0.012), 'rgba(10,4,6,.55)', true);
  drawSeam(Math.max(3, W * 0.005), 'rgba(255,255,255,.92)', false);

  /* VS 배지 */
  slVSBadge(ctx, W, H, cfg);
}

function slDraw() {
  const cv = $('#slCanvas');
  if (!cv) return;
  const [W, H] = slSize();
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const base = SL_BG[SL.bg] || SL_BG.red;
  const V = (SL_V = slVariant());
  const cfg = Object.assign({}, base, {
    hot: (base.hots || [base.hot])[V.hotIdx % (base.hots || [base.hot]).length],
    from: (base.froms || [base.from])[V.fromIdx % (base.froms || [base.from]).length],
  });
  let p;

  if (SL.mode === 'vs') {
    slDrawVS(ctx, W, H, cfg, V);
  } else if (SL.mode === 'photo' && SL.img) {
    p = slDrawPhoto(ctx, W, H);
    slGlyph(ctx, W, H, p, V);
  } else {
    p = slPaintFigure(ctx, W, H, cfg, V);
    slGlyph(ctx, W, H, p, V);
  }

  /* 하단 문구 */
  if (SL.caption && String(SL.caption).trim()) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const S = Math.min(W, H);
    const fs = S * 0.045;
    ctx.font = '800 ' + Math.round(fs) + 'px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,.7)';
    ctx.shadowBlur = S * 0.014;
    ctx.fillStyle = 'rgba(255,248,244,.96)';
    ctx.fillText(String(SL.caption).trim().slice(0, 34), W / 2, H - fs * 0.85);
    ctx.restore();
  }

  const meta = $('#slMeta');
  if (meta) {
    let what;
    if (SL.mode === 'vs') {
      const d = (side) => {
        const im = side === 'L' ? SL.vsL : SL.vsR;
        if (im) return '사진';
        return '실루엣(' + SL_KIND[side === 'L' ? SL.vsLeftKind : SL.vsRightKind].replace('🎲 ', '') + ')';
      };
      what = '⚔️ VS 콜라주 · 왼쪽 ' + d('L') + ' vs 오른쪽 ' + d('R');
    } else if (SL.mode === 'photo' && SL.img) {
      what = '내 사진 블러 모드';
    } else {
      what = base.name + ' · ' + SL_KIND[slKindNow(V)] + ' 실루엣';
    }
    meta.textContent = W + ' × ' + H + ' · ' + what + ' · 고유 시드 ' + String(SL.seed).slice(-4);
  }
  slSyncUI();
  slPhotoPaint();
}

/* ── 화면 상태 반영 ── */
function slSyncUI() {
  const root = $('#view-silhouette');
  if (!root) return;
  const vs = SL.mode === 'vs';
  const ph = SL.mode === 'photo' && !!SL.img;
  const show = (sel, on) => { const el = $(sel, root); if (el) el.classList.toggle('hidden', !on); };

  show('#slGlyphBox', !vs);
  show('#slPhotoRow', !vs);
  show('#slBlurRow', ph);
  show('#slVsPanel', vs);
  show('#slVsRow', !vs);
  show('#slKindRowL', !SL.vsL);
  show('#slKindRowR', !SL.vsR);
  show('#slBack', ph);
  show('#slThumbL', !!SL.vsL);
  show('#slThumbR', !!SL.vsR);
  const bL = $('#slBackL'), bR = $('#slBackR');
  if (bL) { bL.classList.toggle('hidden', !SL.vsL); bL.textContent = '✕'; }
  if (bR) { bR.classList.toggle('hidden', !SL.vsR); bR.textContent = '✕'; }
  const nmL = $('#slNameL'), nmR = $('#slNameR');
  if (nmL) nmL.textContent = SL.vsL ? (SL.vsLName || '사진').slice(0, 18) : '사진 없이 실루엣';
  if (nmR) nmR.textContent = SL.vsR ? (SL.vsRName || '사진').slice(0, 18) : '사진 없이 실루엣';
  const tL = $('#slThumbL'), tR = $('#slThumbR');
  if (tL && SL.vsL) tL.src = SL.vsL.src || '';
  if (tR && SL.vsR) tR.src = SL.vsR.src || '';

  const setRange = (sel, val) => { const el = $(sel, root); if (el && el.value !== String(val)) el.value = val; };
  setRange('#slSize', Math.round(SL.size));
  setRange('#slOx', Math.round(SL.ox));
  setRange('#slOy', Math.round(SL.oy));
  setRange('#slBlur', Math.round(SL.blur));
  const lbl = (sel, txt) => { const el = $(sel, root); if (el) el.textContent = txt; };
  lbl('#slSizeV', Math.round(SL.size) + '%');
  lbl('#slOxV', Math.round(SL.ox) + '%');
  lbl('#slOyV', Math.round(SL.oy) + '%');
  lbl('#slBlurV', Math.round(SL.blur) + '%');

  $$('[data-sl]', root).forEach((b) => b.classList.toggle('on', String(SL[b.dataset.sl]) === b.dataset.v));
  const mk = $('#slMake');
  if (mk) mk.textContent = vs ? '⚔️ VS 콜라주 만들기' : '🎨 실루엣 이미지 만들기';
  const cv = $('#slCanvas');
  if (cv) cv.classList.toggle('nodrag', vs || SL.glyph === 'none');
}

function slPhotoPaint() {
  const on = SL.mode === 'photo' && !!SL.img;
  const back = $('#slBack');
  const pick = $('#slPick');
  const nm = $('#slPhName');
  if (back) back.classList.toggle('hidden', !on);
  if (pick) pick.classList.toggle('on', on);
  if (nm) nm.textContent = on && SL.imgName ? SL.imgName.slice(0, 24) : '';
}

function slReadFile(file, cb) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => { cb(im, file); };
  im.onerror = () => toast('사진을 읽지 못했어요 · 다른 파일로 해보세요');
  im.src = url;
}

function slLoadPhoto(file) {
  slReadFile(file, (im, f) => {
    SL.img = im; SL.imgName = f.name || 'photo'; SL.mode = 'photo';
    slDraw();
    toast('사진에 블러 + 물음표를 얹었어요 · 직접 찍은 사진만 쓰세요');
  });
}

function slLoadVsPhoto(side, file) {
  slReadFile(file, (im, f) => {
    if (side === 'L') { SL.vsL = im; SL.vsLName = f.name || 'left'; }
    else { SL.vsR = im; SL.vsRName = f.name || 'right'; }
    SL.mode = 'vs';
    slDraw();
    toast((side === 'L' ? '왼쪽' : '오른쪽') + ' 사진을 넣었어요 · VS 콜라주 미리보기 ⚔️');
  });
}

/* 미리보기 캔버스 드래그 — 마우스·터치 모두 (X/Y 슬라이더와 연동) */
function slBindDrag() {
  const cv = $('#slCanvas');
  if (!cv || cv._dragBound) return;
  cv._dragBound = true;
  let on = false, sx = 0, sy = 0, ox0 = 0, oy0 = 0, id = null, raf = 0;

  const pos = (ev) => {
    const r = cv.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * cv.width / Math.max(1, r.width),
             y: (ev.clientY - r.top) * cv.height / Math.max(1, r.height) };
  };
  const down = (ev) => {
    if (SL.mode === 'vs' || SL.glyph === 'none') return;
    on = true; id = ev.pointerId;
    const p = pos(ev);
    sx = p.x; sy = p.y; ox0 = SL.ox; oy0 = SL.oy;
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* 무시 */ }
    cv.classList.add('dragging');
    ev.preventDefault();
  };
  const move = (ev) => {
    if (!on || (id != null && ev.pointerId !== id)) return;
    const p = pos(ev);
    SL.ox = Math.max(-50, Math.min(50, ox0 + (p.x - sx) * 100 / cv.width));
    SL.oy = Math.max(-50, Math.min(50, oy0 + (p.y - sy) * 100 / cv.height));
    LS.set('yc.sl.ox', Math.round(SL.ox * 10) / 10);
    LS.set('yc.sl.oy', Math.round(SL.oy * 10) / 10);
    slSyncUI();
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; slDraw(); });
    ev.preventDefault();
  };
  const up = (ev) => {
    if (!on) return;
    on = false;
    cv.classList.remove('dragging');
    try { cv.releasePointerCapture(id != null ? id : ev.pointerId); } catch (e) { /* 무시 */ }
    id = null;
  };
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', (ev) => { if (on && ev.buttons === 0) up(ev); });
}

function renderSilhouette() {
  if (!SL.seed) slNewSeed();
  if (!SL.bound) {
    $('#view-silhouette').innerHTML = `
      <div class="sec">
        <div class="hero" style="padding:18px 20px">
          <div class="hero-top">
            <div class="avatar">🎨</div>
            <div><h2>실루엣 썸네일</h2>
              <div class="hero-sub">사진을 못 쓰는 글(고소·저작권 주의)에 쓰는 대표 이미지 · 배경 + 큼직한 인물 실루엣 + 큰 기호 · 100% 브라우저에서 그림</div></div>
          </div>
        </div>
      </div>

      <div class="sec card card-pad">
        <div class="sl-grid">
          <div class="sl-controls">
            <div class="sl-row"><span class="sl-lb">인물</span>
              <div class="sl-chips" data-slgroup="kind">
                ${Object.keys(SL_KIND).map((k) => `<button class="sl-chip${SL.kind === k ? ' on' : ''}" data-sl="kind" data-v="${k}">${SL_KIND[k]}</button>`).join('')}
              </div>
            </div>
            <div class="sl-row"><span class="sl-lb">배경</span>
              <div class="sl-chips" data-slgroup="bg">
                ${Object.keys(SL_BG).map((k) => `<button class="sl-chip sw${SL.bg === k ? ' on' : ''}" data-sl="bg" data-v="${k}"><i style="background:linear-gradient(135deg,${SL_BG[k].from},${SL_BG[k].to})"></i>${SL_BG[k].name}</button>`).join('')}
              </div>
            </div>
            <div class="sl-row"><span class="sl-lb">가운데 글자</span>
              <div class="sl-chips" data-slgroup="glyph">
                ${Object.keys(SL_GLYPH).map((k) => `<button class="sl-chip${SL.glyph === k ? ' on' : ''}" data-sl="glyph" data-v="${k}">${esc(SL_GLYPH[k])}</button>`).join('')}
              </div>
            </div>
            <div class="sl-row"><span class="sl-lb">글자 색</span>
              <div class="sl-chips" data-slgroup="ink">
                ${Object.keys(SL_INK).map((k) => `<button class="sl-chip${SL.ink === k ? ' on' : ''}" data-sl="ink" data-v="${k}"><i class="sl-inkdot ${k}"></i>${SL_INK[k]}</button>`).join('')}
              </div>
            </div>
            <div class="sl-row"><span class="sl-lb">비율</span>
              <div class="sl-chips" data-slgroup="ratio">
                ${['1:1', '16:9'].map((k) => `<button class="sl-chip${SL.ratio === k ? ' on' : ''}" data-sl="ratio" data-v="${k}">${k === '1:1' ? '1:1 정사각 (1000×1000)' : '16:9 가로 (1600×900)'}</button>`).join('')}
              </div>
            </div>

            <div class="sl-box" id="slGlyphBox">
              <div class="sl-box-h">기호 크기·위치 <span class="sl-box-h2">미리보기를 끌어도 움직여요</span></div>
              <div class="sl-row"><span class="sl-lb">크기</span>
                <div class="sl-slide"><input type="range" id="slSize" min="50" max="200" step="1" value="${Math.round(SL.size)}"><span class="sl-val" id="slSizeV">${Math.round(SL.size)}%</span></div>
              </div>
              <div class="sl-row"><span class="sl-lb">가로 (X)</span>
                <div class="sl-slide"><input type="range" id="slOx" min="-50" max="50" step="1" value="${Math.round(SL.ox)}"><span class="sl-val" id="slOxV">${Math.round(SL.ox)}%</span></div>
              </div>
              <div class="sl-row"><span class="sl-lb">세로 (Y)</span>
                <div class="sl-slide"><input type="range" id="slOy" min="-50" max="50" step="1" value="${Math.round(SL.oy)}"><span class="sl-val" id="slOyV">${Math.round(SL.oy)}%</span></div>
              </div>
              <div class="sl-row tight"><span class="sl-lb"></span>
                <div class="sl-chips"><button class="btn ghost sm" id="slReset">↺ 위치·크기 초기화</button></div>
              </div>
            </div>

            <div class="sl-row col"><span class="sl-lb">하단 문구 (선택)</span>
              <input id="slCaption" class="sc-input" type="text" maxlength="34" placeholder="예: 2026 KBO 이적 시장 정리" value="${esc(SL.caption)}">
            </div>

            <div class="sl-row col" id="slVsRow"><span class="sl-lb">⚔️ VS 콜라주</span>
              <div class="sl-chips"><button class="btn ghost sm" id="slVsOn">⚔️ 사진 2장 VS 콜라주 만들기</button></div>
              <p class="sl-help">왼쪽·오른쪽 사진을 넣으면 좌우 분할 콜라주, 사진이 없으면 실루엣 2명 대결로 만들어요.</p>
            </div>

            <div class="sl-box hidden" id="slVsPanel">
              <div class="sl-box-h">⚔️ VS 콜라주 <span class="sl-box-h2">사진 2장 또는 실루엣 2명</span></div>
              <div class="sl-row"><span class="sl-lb">분할</span>
                <div class="sl-chips" data-slgroup="split">
                  ${Object.keys(SL_SPLIT).map((k) => `<button class="sl-chip${SL.split === k ? ' on' : ''}" data-sl="split" data-v="${k}">${SL_SPLIT[k]}</button>`).join('')}
                </div>
              </div>
              <div class="sl-row col"><span class="sl-lb">왼쪽</span>
                <div class="sl-vsline">
                  <img class="sl-thumb hidden" id="slThumbL" alt="">
                  <button class="btn ghost sm" id="slPickL">📷 왼쪽 사진</button>
                  <button class="btn ghost sm hidden" id="slBackL">✕</button>
                  <span class="sl-ph" id="slNameL"></span>
                </div>
                <div class="sl-chips" data-slgroup="vsLeftKind" id="slKindRowL">
                  ${['male', 'female', 'player'].map((k) => `<button class="sl-chip${SL.vsLeftKind === k ? ' on' : ''}" data-sl="vsLeftKind" data-v="${k}">${SL_KIND[k]}</button>`).join('')}
                </div>
              </div>
              <div class="sl-row col"><span class="sl-lb">오른쪽</span>
                <div class="sl-vsline">
                  <img class="sl-thumb hidden" id="slThumbR" alt="">
                  <button class="btn ghost sm" id="slPickR">📷 오른쪽 사진</button>
                  <button class="btn ghost sm hidden" id="slBackR">✕</button>
                  <span class="sl-ph" id="slNameR"></span>
                </div>
                <div class="sl-chips" data-slgroup="vsRightKind" id="slKindRowR">
                  ${['male', 'female', 'player'].map((k) => `<button class="sl-chip${SL.vsRightKind === k ? ' on' : ''}" data-sl="vsRightKind" data-v="${k}">${SL_KIND[k]}</button>`).join('')}
                </div>
              </div>
              <div class="sl-row tight"><span class="sl-lb"></span>
                <div class="sl-chips"><button class="btn ghost sm" id="slVsOff">↩ 일반 썸네일로</button></div>
              </div>
              <input type="file" id="slVsInputL" accept="image/*" class="hidden">
              <input type="file" id="slVsInputR" accept="image/*" class="hidden">
            </div>

            <div class="sl-row col" id="slPhotoRow"><span class="sl-lb">내 사진 (선택)</span>
              <div class="sl-photo">
                <button class="btn ghost sm" id="slPick">📷 내 사진 올려서 블러+기호</button>
                <button class="btn ghost sm hidden" id="slBack">↩ 실루엣으로</button>
                <span class="sl-ph" id="slPhName"></span>
              </div>
              <input type="file" id="slPhotoInput" accept="image/*" class="hidden">
            </div>

            <div class="sl-row hidden" id="slBlurRow"><span class="sl-lb">블러 강도</span>
              <div class="sl-slide"><input type="range" id="slBlur" min="0" max="100" step="1" value="${Math.round(SL.blur)}"><span class="sl-val" id="slBlurV">${Math.round(SL.blur)}%</span></div>
            </div>

            <p class="sl-caution">※ TV조선·채널A 등 금지 방송 캡처는 블러해도 사용 금지예요. <b>직접 찍은 사진</b>만 올려 주세요. VS 콜라주에 넣는 사진도 마찬가지예요.</p>

            <div class="sl-btns">
              <button class="btn" id="slMake">🎨 실루엣 이미지 만들기</button>
              <button class="btn ghost" id="slReroll">🎲 다른 느낌으로 다시 생성</button>
              <button class="btn soft" id="slSave">💾 PNG 저장</button>
            </div>
            <p class="sl-seednote">※ 매번 고유 이미지로 생성돼 유사 이미지 걱정 없이 사용할 수 있어요.</p>
            <p class="sl-note">사진·폰트 파일 없이 캔버스로만 그립니다. 네이버 대표 이미지는 1000×1000(1:1)을 권장해요.</p>
          </div>
          <div class="sl-preview">
            <canvas id="slCanvas" width="1000" height="1000"></canvas>
            <div class="sl-meta" id="slMeta"></div>
          </div>
        </div>
      </div>`;
    SL.bound = true;

    const root = $('#view-silhouette');
    root.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-sl]');
      if (chip) {
        const key = chip.dataset.sl, val = chip.dataset.v;
        SL[key] = val;
        LS.set('yc.sl.' + key, val);
        if (key === 'glyph') {
          if (val === 'VS') SL.mode = 'vs';
          else if (SL.mode === 'vs') SL.mode = 'silhouette';
        }
        slDraw();
        return;
      }
      if (ev.target.closest('#slMake')) { slNewSeed(); slDraw(); toast(SL.mode === 'vs' ? '새 VS 콜라주를 만들었어요 · 매번 다른 그림 ⚔️' : '새 썸네일을 만들었어요 · 매번 다른 그림 🎨'); return; }
      if (ev.target.closest('#slReroll')) { slNewSeed(); slDraw(); toast('다른 느낌으로 다시 그렸어요 🎲'); return; }
      if (ev.target.closest('#slSave')) { slSave(); return; }
      if (ev.target.closest('#slReset')) {
        SL.size = 100; SL.ox = 0; SL.oy = 0;
        LS.set('yc.sl.size', 100); LS.set('yc.sl.ox', 0); LS.set('yc.sl.oy', 0);
        slDraw(); toast('기호 위치·크기를 처음 자리로 되돌렸어요 ↺');
        return;
      }
      if (ev.target.closest('#slVsOn')) {
        SL.mode = 'vs'; SL.glyph = 'VS'; LS.set('yc.sl.glyph', 'VS');
        slDraw(); toast('⚔️ VS 콜라주 모드 — 왼쪽·오른쪽 사진을 넣어 보세요');
        return;
      }
      if (ev.target.closest('#slVsOff')) {
        SL.mode = 'silhouette';
        if (SL.glyph === 'VS') { SL.glyph = '?'; LS.set('yc.sl.glyph', '?'); }
        slDraw(); toast('일반 썸네일로 돌아왔어요');
        return;
      }
      if (ev.target.closest('#slPick')) { const f = $('#slPhotoInput'); if (f) f.click(); return; }
      if (ev.target.closest('#slPickL')) { const f = $('#slVsInputL'); if (f) f.click(); return; }
      if (ev.target.closest('#slPickR')) { const f = $('#slVsInputR'); if (f) f.click(); return; }
      if (ev.target.closest('#slBackL')) { SL.vsL = null; SL.vsLName = ''; slDraw(); toast('왼쪽 사진을 뺐어요 · 실루엣으로 대신해요'); return; }
      if (ev.target.closest('#slBackR')) { SL.vsR = null; SL.vsRName = ''; slDraw(); toast('오른쪽 사진을 뺐어요 · 실루엣으로 대신해요'); return; }
      if (ev.target.closest('#slBack')) {
        SL.mode = 'silhouette'; SL.img = null; SL.imgName = '';
        slDraw(); toast('실루엣 모드로 돌아왔어요');
        return;
      }
    });

    root.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.id === 'slCaption') {
        SL.caption = t.value;
        LS.set('yc.sl.caption', t.value);
        clearTimeout(t._tt); t._tt = setTimeout(slDraw, 120);
        return;
      }
      if (t.id === 'slSize') { SL.size = Number(t.value); LS.set('yc.sl.size', SL.size); slDraw(); return; }
      if (t.id === 'slOx') { SL.ox = Number(t.value); LS.set('yc.sl.ox', SL.ox); slDraw(); return; }
      if (t.id === 'slOy') { SL.oy = Number(t.value); LS.set('yc.sl.oy', SL.oy); slDraw(); return; }
      if (t.id === 'slBlur') { SL.blur = Number(t.value); LS.set('yc.sl.blur', SL.blur); slDraw(); return; }
    });

    const phIn = $('#slPhotoInput');
    if (phIn) phIn.addEventListener('change', () => { if (phIn.files && phIn.files[0]) slLoadPhoto(phIn.files[0]); });
    const vl = $('#slVsInputL');
    if (vl) vl.addEventListener('change', () => { if (vl.files && vl.files[0]) slLoadVsPhoto('L', vl.files[0]); });
    const vr = $('#slVsInputR');
    if (vr) vr.addEventListener('change', () => { if (vr.files && vr.files[0]) slLoadVsPhoto('R', vr.files[0]); });
  }
  $('#nav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'silhouette'));
  slDraw();
  slBindDrag();
}

function slSave() {
  const cv = $('#slCanvas');
  if (!cv) return;
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '') + '_' + d.toISOString().slice(11, 19).replace(/:/g, '');
  const rnd4 = Math.random().toString(36).slice(2, 6).toUpperCase();
  const name = (SL.mode === 'vs' ? 'yeb_vs_' : 'yeb_thumb_') + stamp + '_' + rnd4 + '.png';
  cv.toBlob((blob) => {
    if (!blob) { toast('저장이 막혔어요 · 미리보기를 길게 눌러 저장해 주세요'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('PNG로 저장했어요 · 다운로드 폴더 확인 💾');
  }, 'image/png');
}

/* 테스트용 */
window.__sl = {
  state: SL, draw: slDraw, save: slSave, render: renderSilhouette, loadPhoto: slLoadPhoto,
  loadVsPhoto: slLoadVsPhoto, reseed: slNewSeed, variant: slVariant, syncUI: slSyncUI,
  dataUrl: () => ($('#slCanvas') ? $('#slCanvas').toDataURL('image/png') : ''),
  size: slSize,
  glyphBox: () => {
    const cv = $('#slCanvas');
    if (!cv) return null;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (d[i] > 235 && d[i + 1] > 225 && d[i + 2] > 218) {
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx < 0) return null;
    return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 };
  },
  darkBox: () => {
    const cv = $('#slCanvas');
    if (!cv) return null;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (d[i] < 26 && d[i + 1] < 22 && d[i + 2] < 22) {
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx < 0) return null;
    return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
  },
};
