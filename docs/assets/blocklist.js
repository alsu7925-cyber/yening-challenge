/* ───────────────────────── 🚨 고소·저작권 주의 대상 (예닝 님 지정 12개) ─────────────────────────
   2026-11-20 예닝 님이 보내 주신 '자갈쟁이 부자들' 주의 리스트 12개를 그대로 옮겼습니다.
   (attachments/2026-11-20/35245-1c193a05733d415fa5fb2721c8fdd605.jpg)

     1. TV조선              2. 채널A               3. G드레곤(지드래곤 · 갤럭시코퍼레이션)
     4. 김호중              5. 과즙세연            6. 아옳이
     7. 홍진경              8. 옥주현(옥장판)      9. 이승기 소속사 회장(후크엔터테인먼트)
    10. 김수현 소송 관련   11. 김범(영화배우)     12. 디자이너 박시영

   쓰이는 곳 (이 파일 한 곳만 고치면 양쪽에 같이 적용됩니다)
     · 예브 챌린지 → 홈판 제목 점수기 : 채점 전에 빨간 경고로 막음
     · 예브 챌린지 → 서식 변환기     : 원고·첫인사·끝인사에 있으면 미리보기 위 빨간 배너 + 복사 전 확인
     · 예브 챌린지 → 오늘의 소재     : 해당 항목은 경고 표시하고 '쓸게요' 막음
     · 찐찡이네 작업실 → 서식 변환기  : 본문·첫인사·마무리에 있으면 빨간 배너 + 복사 전 확인
   ───────────────────────────────────────────────────────────────────────── */
(function (g) {
  'use strict';

  var DEMO = '이름·사진·관련 기사는 인용하지 않기 (고소·저작권 주의)';   /* 기본 설명 */

  var ITEMS = [
    { id: 'tv_chosun', label: 'TV조선', why: '사진·영상은 저작권 문제로 쓰지 않기',
      pats: [/tv\s*조선/i, /티비\s*조선/, /\btvchosun\b/i, /\btv[\s_-]*chosun\b/i] },

    { id: 'channel_a', label: '채널A', why: '사진·영상은 저작권 문제로 쓰지 않기',
      pats: [/채널\s*a(?![a-z])/i, /\bchannel\s*a\b/i, /\bchannela\b/i] },

    { id: 'gdragon', label: 'G드레곤(지드래곤)', why: '갤럭시코퍼레이션 소속 연예인 — 고소·저작권 주의',
      pats: [/지드래곤/, /지드레곤/, /g\s*드래곤/i, /g\s*드레곤/i, /지디/, /갤럭시\s*코퍼레이션/,
             /(^|[^a-z])gd([^a-z]|$)/i] },

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

  g.YC_BLOCK = { items: ITEMS, scan: scan, banner: banner, labels: labels };
  g.ycBlockScan = scan;
  g.ycBlockBanner = banner;
  g.ycBlockLabels = labels;
})(typeof window !== 'undefined' ? window : this);
