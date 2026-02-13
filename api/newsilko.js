// api/newsilko.js

const THUMBNAIL_URL =
  "https://upload.wikimedia.org/wikipedia/commons/7/7e/CatB4SVG.png";

// ---------- util ----------
function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

function decodeEntities(str) {
  return String(str || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function clean(s) {
  return decodeEntities(stripHtml(s)).replace(/\s+/g, " ").trim();
}

function getUtterance(req) {
  return (
    req?.body?.userRequest?.utterance ||
    req?.body?.userRequest?.params?.utterance ||
    req?.body?.utterance ||
    "속보"
  );
}

// 정규식 escape
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 긴 문자열 먼저 치환(부분 겹침 방지)
function applyReplacements(text, map) {
  let out = String(text || "");
  const entries = Object.entries(map || {})
    .filter(([k, v]) => k && v && k !== v)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [from, to] of entries) {
    const re = new RegExp(escapeRegExp(from), "g");
    out = out.replace(re, to);
  }
  return out;
}

// ---------- NAVER ----------
async function fetchNaverNews(query) {
  const url =
    "https://openapi.naver.com/v1/search/news.json?" +
    new URLSearchParams({ query, display: "1", sort: "date" }).toString();

  const r = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID || "",
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET || "",
    },
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Naver ${r.status}: ${body.slice(0, 200)}`);
  }

  const j = await r.json().catch(() => ({}));
  const item = j?.items?.[0];
  if (!item) return null;

  return { title: clean(item.title), link: item.link };
}

// ---------- OpenAI ----------
function normalizeForCompare(s) {
  return clean(s)
    .replace(/[“”"']/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function callOpenAI(messages, timeoutMs = 8000) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) return { ok: false, text: "", why: "OPENAI_API_KEY 없음" };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4, // 추출/규칙 작업은 낮게
        max_tokens: 220,
        messages,
      }),
    });

    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, text: "", why: `OpenAI ${r.status}: ${body.slice(0, 200)}` };
    }

    const j = await r.json().catch(() => ({}));
    const out = clean(j?.choices?.[0]?.message?.content || "");
    if (!out) return { ok: false, text: "", why: "OpenAI 응답 비었음" };

    return { ok: true, text: out, why: "" };
  } catch (e) {
    if (String(e?.name) === "AbortError") {
      return { ok: false, text: "", why: `OpenAI 타임아웃(${timeoutMs}ms)` };
    }
    return { ok: false, text: "", why: `OpenAI 호출 오류: ${String(e).slice(0, 200)}` };
  } finally {
    clearTimeout(t);
  }
}

// ---------- GPT #1: 인명 치환 맵 만들기 ----------
async function buildNameMap(title) {
  const sys = `너는 한국어 제목에서 "사람 이름(인명)"을 찾아 치환하는 도구야.
출력은 반드시 JSON 하나만. 다른 말 절대 금지.

규칙:
- 입력 제목에 등장하는 "사람 이름(인명)"만 대상으로 한다. (기관/지명/브랜드는 제외)
- 한국인 이름이 성+이름(보통 2~4글자)로 나오면 성(첫 글자) 제거, 이름만 남긴다.
- 이름 끝 글자에 받침이 있으면 "이"를 붙인다. 받침이 없으면 붙이지 않는다.
  예: 윤석열→석열이, 문재인→재인이, 이재명→재명이, 김찬희→찬희, 박지우→지우
- 직책/호칭이 붙은 형태도 함께 매핑한다.
  예: "윤 대통령" 같은 표현이 있으면 그것도 키로 추가해 같은 값으로 매핑.
- 치환 대상이 없으면 빈 객체 {} 를 출력한다.

JSON 형식:
{
  "원문표현1": "치환표현1",
  "원문표현2": "치환표현2"
}`;

  const r = await callOpenAI(
    [
      { role: "system", content: sys },
      { role: "user", content: title },
    ],
    8000
  );

  if (!r.ok) return { ok: false, map: {}, why: r.why };

  // JSON 파싱 안전 처리
  try {
    const obj = JSON.parse(r.text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, map: {}, why: "인명맵 JSON 형식이 아님" };
    }
    // 값이 문자열인 것만
    const map = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
        map[k.trim()] = v.trim();
      }
    }
    return { ok: true, map, why: "" };
  } catch (e) {
    return { ok: false, map: {}, why: `인명맵 JSON 파싱 실패: ${String(e).slice(0, 120)}` };
  }
}

// ---------- GPT #2: 뉴스일꼬 말투 변환 ----------
async function toNewsilkoStyle(titleAfterReplace) {
  const sys = `너는 "뉴스일꼬"라는 츤데레 고양이야 🐱
입력은 "뉴스 제목(이미 인명 치환 완료)"이고, 출력은 친구한테 카톡 보내듯 귀엽고 자연스러운 한국어 구어체로 1~2문장이야.

말투 규칙:
- 존댓말 금지(합니다/됩니다 금지)
- 딱딱한 뉴스체 금지(…/기자/매체/인용부호/괄호/대괄호/말줄임표 사용 금지)
- "~했다" 대신 "~했대", "~라네", "~래" 같은 느낌
- 40~95자 정도
- 제목을 그대로 베끼지 말고 말로 풀어쓰기
- 출력에 원문 인명(성 포함)이 다시 등장하면 안 됨`;

  // 스타일 변환은 살짝 온도 올림
  const r = await (async () => {
    const key = process.env.OPENAI_API_KEY || "";
    if (!key) return { ok: false, text: "", why: "OPENAI_API_KEY 없음" };

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.95,
          max_tokens: 160,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: titleAfterReplace },
          ],
        }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, text: "", why: `OpenAI ${resp.status}: ${body.slice(0, 200)}` };
      }

      const j = await resp.json().catch(() => ({}));
      const out = clean(j?.choices?.[0]?.message?.content || "");
      if (!out) return { ok: false, text: "", why: "OpenAI 응답 비었음" };
      return { ok: true, text: out, why: "" };
    } catch (e) {
      if (String(e?.name) === "AbortError") {
        return { ok: false, text: "", why: `OpenAI 타임아웃(8000ms)` };
      }
      return { ok: false, text: "", why: `OpenAI 호출 오류: ${String(e).slice(0, 200)}` };
    } finally {
      clearTimeout(t);
    }
  })();

  return r;
}

async function makeCasual(title) {
  // 1) 인명맵 생성
  const nm = await buildNameMap(title);
  const replacedTitle = nm.ok ? applyReplacements(title, nm.map) : title;

  // 2) 말투 변환
  const a = await toNewsilkoStyle(replacedTitle);
  if (!a.ok) return { ok: false, text: "", why: a.why, replacedTitle, nameMapOk: nm.ok, nameMapWhy: nm.why };

  // 제목이랑 너무 비슷하면 한 번 더
  const t0 = normalizeForCompare(replacedTitle);
  const t1 = normalizeForCompare(a.text);
  const tooSimilar = t1 && t0 && (t1 === t0 || t1.includes(t0) || t0.includes(t1));
  if (!tooSimilar) return { ok: true, text: a.text, why: "", replacedTitle, nameMapOk: nm.ok, nameMapWhy: nm.why };

  const b = await toNewsilkoStyle(`제목 그대로 쓰지 말고 친구한테 말하듯 풀어써: ${replacedTitle}`);
  return b.ok
    ? { ok: true, text: b.text, why: "", replacedTitle, nameMapOk: nm.ok, nameMapWhy: nm.why }
    : { ok: true, text: a.text, why: "", replacedTitle, nameMapOk: nm.ok, nameMapWhy: nm.why };
}

// ---------- Kakao response ----------
function tsunTitle() {
  const titles = [
    "기사 궁금하면… 눌러.",
    "기사 보러 갈 거면 눌러. (강요 아님)",
    "기사 보고 싶지? 눌러. 딱 한 번만.",
    "기사 보고 싶으면 눌러… 아니면 말구.",
    "기사 보러 가. 안 보면 손해일지도 😼",
  ];
  return titles[Math.floor(Math.random() * titles.length)];
}

function tsunDesc() {
  const descs = ["…흥.", "난 그냥 알려준 거야.", "괜히 눌러주는 거 아냐?", "몰라. 궁금하면 봐.", ""];
  return descs[Math.floor(Math.random() * descs.length)];
}

function kakaoCard(text, link) {
  return {
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text } },
        {
          basicCard: {
            thumbnail: { imageUrl: THUMBNAIL_URL },
            title: tsunTitle(),
            description: tsunDesc(),
            buttons: [{ action: "webLink", label: "기사보기", webLinkUrl: link }],
          },
        },
      ],
    },
  };
}

function kakaoText(msg) {
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text: msg } }] },
  };
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    const q = getUtterance(req);
    const item = await fetchNaverNews(q);
    if (!item) return res.status(200).json(kakaoText("😿 오늘은 뉴스가 안 잡힌다… 다시 말 걸어봐."));

    const g = await makeCasual(item.title);

    if (!g.ok) {
      console.error("[OPENAI_FAIL]", g.why);
      return res
        .status(200)
        .json(kakaoCard(`😿 말투 변환이 잠깐 막혔어…\n일단 제목만 던져줄게.\n\n${item.title}`, item.link));
    }

    return res.status(200).json(kakaoCard(g.text, item.link));
  } catch (e) {
    console.error("[NEWSILKO_ERR]", e);
    return res.status(200).json(kakaoText("😿 일꼬가 잠깐 멈췄어… 다시!"));
  }
}
