/* ────────────── 🚨 고소·저작권 주의 대상 (예닝 님 지정 12개 + 갤럭시코퍼레이션 5명 + 언론사 4곳) ──────────────
   2026-11-20 예닝 님이 보내 주신 '자갈쟁이 부자들' 주의 리스트 12개를 그대로 옮겼습니다.
   (attachments/2026-11-20/35245-1c193a05733d415fa5fb2721c8fdd605.jpg)

     1. TV조선              2. 채널A               3. G드레곤(지드래곤 · 갤럭시코퍼레이션)
     4. 김호중              5. 과즙세연            6. 아옳이
     7. 홍진경              8. 옥주현(옥장판)      9. 이승기 소속사 회장(후크엔터테인먼트)
    10. 김수현 소송 관련   11. 김범(영화배우)     12. 디자이너 박시영

   + 2026-11-20 예닝 님 추가 지시: "연예인만" — 갤럭시코퍼레이션 소속 연예인 5명도 같은 빨간 차단
     김종국 · 송강호 · 태민 · 류준열 · 정일우

   + 2026-11-20 예닝 님 추가 지시: 저작권 주의 언론사·방송사 4곳 (중앙·조선·동아 계열)
     JTBC · 중앙일보 · 조선일보 · 동아일보
   ⚠️ 이정후는 차단하지 않는다 — 노란 주의 배지만 띄우고 채점·변환·쓸게요는 그대로 된다.

   쓰이는 곳 (이 파일 한 곳만 고치면 양쪽에 같이 적용됩니다)
     · 예브 챌린지 → 홈판 제목 점수기 : 채점 전에 빨간 경고로 막음 / 이정후는 노란 배지만
     · 예브 챌린지 → 서식 변환기     : 원고·첫인사·끝인사에 있으면 미리보기 위 배너 + 복사 전 확인
     · 예브 챌린지 → 오늘의 소재     : 해당 항목은 경고 표시하고 '쓸게요' 막음 (이정후는 '쓸게요' 그대로)
     · 찐찡이네 작업실 → 서식 변환기  : 본문·첫인사·마무리에 있으면 배너 + 복사 전 확인
   ─────────────────────────────────────────────────────────────────────────────────────── */
(function (g) {
  'use strict';

  var DEMO = '이름·사진·관련 기사는 인용하지 않기 (고소·저작권 주의)';   /* 기본 설명 */

  var ITEMS = [
    { id: 'tv_chosun', label: 'TV조선', why: '사진·영상은 저작권 문제로 쓰지 않기',
      pats: [/tv\s*조선/i, /티비\s*조선/, /\btvchosun\b/i, /\btv[\s_-]*chosun\b/i] },

    { id: 'channel_a', label: '채널A', why: '사진·영상은 저작권 문제로 쓰지 않기',
      pats: [/채널\s*a(?![a-z])/i, /\bchannel\s*a\b/i, /\bchannela\b/i] },

    /* 2026-11-20 추가 — 저작권 주의 언론사·방송사 (중앙그룹·조선·동아 계열) */
    { id: 'jtbc', label: 'JTBC', why: '방송사 사진·영상은 저작권 문제로 쓰지 않기',
      pats: [/\bjtbc\b/i, /제이\s*티\s*비\s*씨/] },
    { id: 'joongang', label: '중앙일보', why: '언론사 사진·기사는 저작권 문제로 쓰지 않기', pats: [/중앙\s*일보/] },
    { id: 'chosun_daily', label: '조선일보', why: '언론사 사진·기사는 저작권 문제로 쓰지 않기', pats: [/조선\s*일보/] },
    { id: 'donga', label: '동아일보', why: '언론사 사진·기사는 저작권 문제로 쓰지 않기', pats: [/동아\s*일보/] },

    { id: 'gdragon', label: 'G드레곤(지드래곤)', why: '갤럭시코퍼레이션 소속 연예인 — 고소·저작권 주의',
      pats: [/지드래곤/, /지드레곤/, /g\s*드래곤/i, /g\s*드레곤/i, /지디/, /갤럭시\s*코퍼레이션/,
             /(^|[^a-z])gd([^a-z]|$)/i] },

    /* 갤럭시코퍼레이션 소속 연예인 5명 (2026-11-20 추가 지시) — 지드래곤과 같은 빨간 차단 */
    { id: 'kim_jongkook', label: '김종국', why: '갤럭시코퍼레이션 소속 연예인 — 고소·저작권 주의', pats: [/김종국/] },
    { id: 'song_kangho', label: '송강호', why: '갤럭시코퍼레이션 소속 연예인 — 고소·저작권 주의', pats: [/송강호/] },
    { id: 'taemin', label: '태민', why: '갤럭시코퍼레이션 소속 연예인 — 고소·저작권 주의',
      /* '상태민감' 같은 말에 걸리지 않도록 앞 글자를 본다 */
      test: function (s) {
        var i = s.indexOf('태민');
        while (i >= 0) {
          var prev = s.charAt(i - 1);
          if (prev !== '상' && prev !== '사' && prev !== '형' && prev !== '피') return '태민';
          i = s.indexOf('태민', i + 1);
        }
        return null;
      } },
    { id: 'ryu_junyeol', label: '류준열', why: '갤럭시코퍼레이션 소속 연예인 — 고소·저작권 주의', pats: [/류준열/] },
    { id: 'jung_ilwoo', label: '정일우', why: '갤럭시코퍼레이션 소속 연예인 — 고소·저작권 주의', pats: [/정일우/] },

    { id: 'kim_hojung', label: '김호중', why: DEMO, pats: [/김호중/] },

    { id: 'gwajeub', label: '과즙세연', why: DEMO, pats: [/과즙\s*세연/] },

    { id: 'aholli', label: '아옳이', why: DEMO, pats: [/아옳이/] },

    { id: 'hong_jinkyoung', label: '홍진경', why: DEMO, pats: [/홍진경/] },

    { id: 'ok_juhyun', label: '옥주현(옥장판)', why: DEMO, pats: [/옥주현/, /옥장판/] },

    { id: 'lee_seunggi', label: '이승기 소속사 회장', why: DEMO,
      test: function (s) {
        if (/이승기\s*(?:의\s*)?소속사/.test(s)) return '이승기 소속사';
        if (/후크\s*엔터/.test(s)) return '후크엔터테인먼트';
        if (/권진영/.test(s)) return '권진영';
        if (/이승기/.test(s) && /회장|대표/.test(s)) return '이승기 소속사 회장';
        return null;
      } },

    { id: 'kim_suhyun', label: '김수현 소송 관련', why: DEMO,
      test: function (s) {
        if (/김수현\s*(?:관련\s*)?(?:소송|고소|논란|의혹|수사|고발|재판|경찰)/.test(s)) return '김수현 소송';
        if (/(?:소송|고소|논란|의혹|수사|고발|재판)/.test(s) && /김수현/.test(s)) return '김수현 + 소송·논란';
        return null;
      } },

    { id: 'kim_bum', label: '김범(영화배우)', why: DEMO,
      pats: [/김범(?![수준석])/] },

    { id: 'park_siyoung', label: '디자이너 박시영', why: DEMO,
      pats: [/박시영/, /디자이너\s*박시영/] }
  ];

  /* ⚠️ 소프트 주의 — 차단하지 않고 노란 배지만. (2026-11-20 예닝 님: "연예인만 / 이정후는 주의") */
  var SOFT_ITEMS = [
    { id: 'lee_junghoo', label: '이정후',
      head: '⚠️ 이정후(갤럭시코퍼레이션 소속) — 경기 팩트·공식 출처 사진만 사용 권장',
      why: '이름·경기 내용은 사실대로, 사진은 구단·공식 출처만 쓰면 됩니다. (차단하지 않아요)',
      pats: [/이정후/] }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 글자에서 주의 대상을 찾는다 → [{ id, label, hit, why }] (같은 대상은 한 번만) */
  function scan(text) {
    var s = String(text == null ? '' : text);
    if (!s.trim()) return [];
    var out = [], seen = {};
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i], hit = null;
      if (typeof it.test === 'function') {
        hit = it.test(s);
      } else {
        for (var j = 0; j < it.pats.length; j++) {
          var m = s.match(it.pats[j]);
          if (m) { hit = m[0]; break; }
        }
      }
      if (hit && !seen[it.id]) {
        seen[it.id] = 1;
        out.push({ id: it.id, label: it.label, hit: String(hit).trim(), why: it.why || '' });
      }
    }
    return out;
  }

  function labels(hits) {
    return (hits || []).map(function (h) { return h.label; }).join(', ');
  }

  /* 노란 주의 배지 — 막지 않으니 스코어도 복사도 그대로 된다 */
  function softScan(text) {
    var s = String(text == null ? '' : text);
    if (!s.trim()) return [];
    var out = [];
    for (var i = 0; i < SOFT_ITEMS.length; i++) {
      var it = SOFT_ITEMS[i], hit = null;
      for (var j = 0; j < it.pats.length; j++) {
        var m = s.match(it.pats[j]);
        if (m) { hit = m[0]; break; }
      }
      if (hit) out.push({ id: it.id, label: it.label, hit: String(hit).trim(), head: it.head, why: it.why || '' });
    }
    return out;
  }

  function softBanner(hits, opt) {
    opt = opt || {};
    hits = hits || [];
    if (!hits.length) return '';
    var rows = hits.map(function (h) {
      return '<div class="soft-h">' + esc(h.head || ('⚠️ ' + h.label)) + '</div>' +
        (h.why ? '<div class="soft-why">' + esc(h.why) + '</div>' : '');
    }).join('');
    var foot = opt.note ? '<div class="soft-note">' + esc(opt.note) + '</div>' : '';
    return '<div class="soft-warn" role="status" data-soft="1">' + rows + foot + '</div>';
  }

  /* 빨간 경고 박스 HTML — 제목·원고 어디에 넣어도 같은 모양
     제목줄에 매칭된 항목이 그대로 들어간다: "🚨 고소·저작권 주의 대상 포함 — 사용 금지 권장: 김호중" */
  function banner(hits, opt) {
    opt = opt || {};
    hits = hits || [];
    if (!hits.length) return '';
    var head = opt.title || ('🚨 고소·저작권 주의 대상 포함 — 사용 금지 권장: ' + labels(hits));
    var spec = hits.filter(function (h) { return h.why && h.why !== DEMO; });
    var items = spec.map(function (h) {
      return '<li><b>' + esc(h.label) + '</b> · ' + esc(h.why) + '</li>';
    });
    if (spec.length < hits.length) items.push('<li>' + esc(DEMO) + '</li>');
    var note = opt.note ? '<div class="blk-note">' + esc(opt.note) + '</div>' : '';
    return '<div class="blk-warn" role="alert" data-blk="1">' +
      '<div class="blk-h">' + esc(head) + '</div>' +
      '<ul class="blk-why">' + items.join('') + '</ul>' + note + '</div>';
  }

  g.YC_BLOCK = { items: ITEMS, softItems: SOFT_ITEMS, scan: scan, banner: banner, labels: labels,
                 softScan: softScan, softBanner: softBanner };
  g.ycBlockScan = scan;
  g.ycBlockBanner = banner;
  g.ycBlockLabels = labels;
  g.ycSoftScan = softScan;
  g.ycSoftBanner = softBanner;
})(typeof window !== 'undefined' ? window : this);
