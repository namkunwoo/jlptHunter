/* 로마자 → 가나 변환
 *
 * 왜 필요한가: 데스크톱에서 일본어 입력기를 따로 깔지 않아도 읽기를 적을 수 있게 한다.
 * 인출 연습(답을 떠올려 적어보기)이 학습 효과의 핵심인데, 입력이 번거로우면
 * 그 단계를 건너뛰게 된다.
 *
 * 규칙
 *   소문자 로마자 → 히라가나   eikyou  → えいきょう
 *   대문자 로마자 → 가타카나   NICHI   → ニチ
 *   그 외 문자(한글·공백·기호)는 그대로 통과 → 「eikyou 영향」 이 「えいきょう 영향」
 *
 * 미완성 조각은 변환하지 않고 남겨둔다. 타이핑 중간 상태를 망치지 않기 위해서다.
 *   "ky" 는 아직 ky|a, ky|u, ky|o 로 자랄 수 있으므로 그대로 둔다.
 */
(function (global) {
  "use strict";

  // 3글자 → 2글자 → 1글자 순으로 가장 긴 것부터 맞춘다
  var MAP = {
    // 요음 (3글자)
    kya:"きゃ", kyu:"きゅ", kyo:"きょ", gya:"ぎゃ", gyu:"ぎゅ", gyo:"ぎょ",
    sha:"しゃ", shu:"しゅ", sho:"しょ", shi:"し",
    ja:"じゃ", ju:"じゅ", jo:"じょ", ji:"じ",
    cha:"ちゃ", chu:"ちゅ", cho:"ちょ", chi:"ち",
    nya:"にゃ", nyu:"にゅ", nyo:"にょ",
    hya:"ひゃ", hyu:"ひゅ", hyo:"ひょ",
    bya:"びゃ", byu:"びゅ", byo:"びょ",
    pya:"ぴゃ", pyu:"ぴゅ", pyo:"ぴょ",
    mya:"みゃ", myu:"みゅ", myo:"みょ",
    rya:"りゃ", ryu:"りゅ", ryo:"りょ",
    tsu:"つ", fu:"ふ",
    // 2글자
    ka:"か", ki:"き", ku:"く", ke:"け", ko:"こ",
    ga:"が", gi:"ぎ", gu:"ぐ", ge:"げ", go:"ご",
    sa:"さ", su:"す", se:"せ", so:"そ",
    za:"ざ", zi:"じ", zu:"ず", ze:"ぜ", zo:"ぞ",
    ta:"た", te:"て", to:"と",
    da:"だ", di:"ぢ", du:"づ", de:"で", do:"ど",
    na:"な", ni:"に", nu:"ぬ", ne:"ね", no:"の",
    ha:"は", hi:"ひ", he:"へ", ho:"ほ",
    ba:"ば", bi:"び", bu:"ぶ", be:"べ", bo:"ぼ",
    pa:"ぱ", pi:"ぴ", pu:"ぷ", pe:"ぺ", po:"ぽ",
    ma:"ま", mi:"み", mu:"む", me:"め", mo:"も",
    ya:"や", yu:"ゆ", yo:"よ",
    ra:"ら", ri:"り", ru:"る", re:"れ", ro:"ろ",
    wa:"わ", wo:"を", wi:"ゐ", we:"ゑ",
    vu:"ヴ",
    // 1글자
    a:"あ", i:"い", u:"う", e:"え", o:"お", n:"ん"
  };

  var HIRA_TO_KATA_OFFSET = 0x30a0 - 0x3040;
  // 히라가나 → 가타카나
  function kata(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      out += (code >= 0x3041 && code <= 0x3096)
        ? String.fromCharCode(code + HIRA_TO_KATA_OFFSET) : s[i];
    }
    return out;
  }

  var CONSONANT = /^[bcdfghjklmpqrstvwxyz]$/;
  var ROMAJI_CHAR = /[a-zA-Z]/;

  // 남은 조각이 더 자라서 유효한 음절이 될 수 있는가
  function canGrow(frag) {
    if (!frag) return false;
    for (var k in MAP) if (k.indexOf(frag) === 0 && k !== frag) return true;
    return false;
  }

  /**
   * @param {string} input
   * @returns {string} 변환 결과. 미완성 로마자 조각은 원문 그대로 남는다.
   */
  function convert(input, opts) {
    var live = !!(opts && opts.live);
    var out = "", i = 0;
    while (i < input.length) {
      var ch = input[i];
      if (!ROMAJI_CHAR.test(ch)) { out += ch; i++; continue; }

      // 로마자 덩어리를 통째로 떼어 처리한다 (대소문자 섞임은 덩어리 단위로 판정)
      var j = i;
      while (j < input.length && ROMAJI_CHAR.test(input[j])) j++;
      var chunk = input.slice(i, j);
      var upper = chunk === chunk.toUpperCase();
      var low = chunk.toLowerCase();
      var lastChunk = (j === input.length);

      var res = "", p = 0;
      while (p < low.length) {
        // っ (촉음): 같은 자음이 겹치면. 단 nn 은 ん 으로 처리
        if (p + 1 < low.length && low[p] === low[p + 1] &&
            CONSONANT.test(low[p]) && low[p] !== "n") {
          res += "っ"; p++; continue;
        }
        if (low[p] === "n" && p + 1 < low.length) {
          var nx = low[p + 1];
          // nn → ん, 또는 n + 자음(y 제외) → ん
          // nn 은 ん 하나 + 다음 な행. n 한 글자만 소비해야 onna → おんな 가 된다
          if (nx === "n") { res += "ん"; p += 1; continue; }
          if (CONSONANT.test(nx) && nx !== "y") { res += "ん"; p++; continue; }
        }
        // 입력 중에 끝에 홀로 남은 n 은 확정하지 않는다.
        // 실제 입력기와 같은 동작이다 — N 을 바로 ン 으로 굳히면
        // NICHI 를 칠 때 ン+イ+チ 가 되어버린다. 확정은 nn·n+자음·입력 종료 때.
        if (live && lastChunk && low[p] === "n" && p === low.length - 1) {
          res += chunk.slice(p);
          break;
        }
        var hit = null;
        for (var len = 3; len >= 1; len--) {
          var cand = low.slice(p, p + len);
          if (cand.length === len && MAP[cand]) { hit = cand; break; }
        }
        if (hit) { res += MAP[hit]; p += hit.length; continue; }
        // 못 맞춘 조각 — 더 자랄 수 있으면 원문 유지, 아니면 그대로 흘린다
        var rest = low.slice(p);
        res += canGrow(rest) ? chunk.slice(p) : chunk.slice(p);
        break;
      }
      out += upper ? kata(res) : res;
      i = j;
    }
    return out;
  }

  global.Romaji = { convert: convert, kata: kata };
})(typeof window !== "undefined" ? window : globalThis);
