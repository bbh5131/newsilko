// api/newsilko.js
// 기능:
// 1) "뉴스/속보" -> 오늘(KST) 올라온 기사 중 랜덤 1개
// 2) "경제/사회/정치/국제/과학/연예/스포츠" 등 -> 해당 주제 오늘 기사 중 랜덤 1개
// 3) GPT 2단계: (인명치환맵 JSON 추출) -> (뉴스일꼬 말투 변환)
// 4) 카카오 quickReplies(버튼) 제공

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
    "뉴스"
  );
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyReplacements(text, map) {
  let out = String(text || "");
  const entries = Object.entries(map || {})
    .filter(([k, v]) => typeof k === "string" && typeof v === "string" && k && v && k !== v)
    .sort((a, b) => b[0].length - a[0].length); // 긴 키부터

  for (const [from, to] of entries) {
    const re = new RegExp(escapeRegExp(from), "g");
    out = out.replace(re, to);
  }
  return out;
}

function normalizeIntent(s) {
  return clean(s).replace(/\s+/g, "").toLowerCase();
}

// ---------- today filter (KST) ----------
function isTodayKST(pubDateStr) {
  if (!pubDateStr) return false;

  // Naver pubDate: RFC822 (예: "Fri, 13 Feb 2026 10:12:00 +0900")
  const d = new Date(pubDateStr);
  if (Number.isNaN(d.getTime())) return false;

  const kstOffsetMs = 9 * 60 * 60 * 1000;

  const now = new Date();
  const nowKST = new Date(now.getTime() + kstOffsetMs);

  const startKST = new Date(nowKST);
  startKST.setHours(0, 0, 0, 0);

  const endKST = new Date(startKST);
  endKST.setDate(endKST.getDate() + 1);

  const dKST = new Date(d.getTime() + kstOffsetMs);

  return dKST >= startKST && dKST < endKST;
}

// ---------- query router ----------
function buildQueryFromUtterance(utterance) {
  const u = normalizeIntent(utterance);

  const isGeneral =
    !u ||
    u === "뉴스" ||
    u === "속보" ||
    u === "최신" ||
    u === "랜덤" ||
    u === "아무거나";

  if (isGeneral) return { query: "속보", mode: "general", topic: "뉴스" };

  const categoryMap = {
    경제: {
      query: "경제 (증시 OR 코스피 OR 코스닥 OR 환율 OR 금리 OR 물가 OR 경기 OR 부동산 OR 반도체)",
      aliases: ["경제", "주식", "증시", "코스피", "코스닥", "환율", "금리", "부동산", "물가"],
    },
    사회: {
      query: "사회 (사건 OR 사고 OR 재난 OR 경찰 OR 법원 OR 교육 OR 노동 OR 복지 OR 의료)",
      aliases: ["사회", "사건", "사고", "재난", "경찰", "법원", "교육", "노동", "복지", "의료"],
    },
    정치: {
      query: "정치 (국회 OR 대통령실 OR 여야 OR 선거 OR 정당 OR 법안 OR 외교)",
      aliases: ["정치", "국회", "대통령", "대통령실", "여야", "선거", "정당", "외교"],
    },
    국제: {
      query: "국제 (미국 OR 중국 OR 일본 OR 유럽 OR 우크라이나 OR 중동 OR 정상회담)",
      aliases: ["국제", "해외", "미국", "중국", "일본", "유럽", "우크라이나", "중동"],
    },
    과학: {
      query: "과학 (ai OR 인공지능 OR 반도체 OR 우주 OR 연구 OR 논문 OR 기술)",
      aliases: ["과학", "기술", "ai", "인공지능", "반도체", "우주", "연구", "논문"],
    },
    연예: {
      query: "연예 (배우 OR 아이돌 OR 가수 OR 드라마 OR 영화 OR 열애)",
      aliases: ["연예", "셀럽", "아이돌", "배우", "가수", "드라마", "영화", "열애"],
    },
    스포츠: {
      query: "스포츠 (축구 OR 야구 OR 농구 OR 배구 OR e스포츠 OR 국가대표)",
      aliases: ["스포츠", "축구", "야구", "농구", "배구", "e스포츠", "이스포츠", "국가대표"],
    },
  };

  for (const [cat, cfg] of Object.entries(categoryMap)) {
    if (cfg.aliases.some((w) => u.includes(w))) {
      return { query: cfg.query, mode: `category:${cat}`, topic: cat };
    }
  }

  return { query: clean(utterance), mode: "free", topic: "검색" };
}

// ---------- NAVER ----------
async function fetchNaverNewsTodayOnly(query, display = 50) {
  const url =
    "https://openapi.naver.com/v1/search/news.json?" +
    new URLSearchParams({
      query,
      display: String(display),
      sort: "date",
    }).toString();

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
  const items = Array.isArray(j?.items) ? j.items : [];
  if (!items.length) return null;

  const todays = items.filter((it) => isTodayKST(it?.pubDate));
  if (!todays.length) return null;

  const pick = todays[Math.floor(Math.random() * todays.length)];
  return {
    title: clean(pick.title),
    link: pick.link,
    pubDate: pick.pubDate,
  };
}

// ---------- OpenAI base ----------
function normalizeForCompare(s) {
  return clean(s)
    .replace(/[“”"']/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function callOpenAI(messages, { temperature = 0.4, max_tokens = 220, timeoutMs = 8000 } = {}) {
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
        temperature,
        max_tokens,
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

// ---------- GPT #1: 인명 치환 맵(JSON) ----------
async function buildNameMap(title) {
  const sys = `너는 한국어 뉴스 제목에서 "사람 이름(인명)"만 찾아 치환 맵을 만드는 도구야.
출력은 JSON 하나만. 다른 말 절대 금지.

규칙:
- 입력 제목에 등장하는 "사람 이름(인명)"만 대상으로 한다. (기관/지명/브랜드/단체는 제외)
- 한국인 이름이 성+이름(보통 2~4글자)로 나오면 성(첫 글자) 제거, 이름만 남긴다.
- 이름 끝 글자에 받침이 있으면 "이"를 붙인다. 받침이 없으면 붙이지 않는다.
  예: 윤석열→석열이, 문재인→재인이, 이재명→재명이, 김찬희→찬희, 박지우→지우, 유진→유진이
- 직책/호칭이 붙은 형태도 함께 매핑한다.
  예: "윤 대통령", "문 전 대통령", "이 대표" 같은 표현이 제목에 있으면 그것도 키로 추가해 같은 값으로 매핑한다.
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
    { temperature: 0.2, max_tokens: 260, timeoutMs: 8000 }
  );

  if (!r.ok) return { ok: false, map: {}, why: r.why };

  try {
    const obj = JSON.parse(r.text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, map: {}, why: "인명맵 JSON 형식이 아님" };
    }

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

// ---------- GPT #2: 뉴스일꼬 말투 ----------
async function toNewsilkoStyle(titleAfterReplace) {
  const sys = `너는 "뉴스일꼬"라는 츤데레 고양이야 🐱
입력은 "뉴스 제목(이미 인명 치환 완료)"이고, 출력은 친구한테 카톡 보내듯 귀엽고 자연스러운 한국어 구어체로 1~2문장이야.

말투 규칙:
- 존댓말 금지(합니다/됩니다 금지)
- 딱딱한 뉴스체 금지(…/기자/매체/인용부호/괄호/대괄호/말줄임표 사용 금지)
- "~했다" 대신 "~했대", "~라네", "~래" 같은 느낌
- 과장 너무 심하게 하지 말고 자연스럽게
- 40~95자 정도
- 제목을 그대로 베끼지 말고 말로 풀어쓰기
- 출력에 성 포함 원문 인명이 다시 등장하면 안 됨`;

  return await callOpenAI(
    [
      { role: "system", content: sys },
      { role: "user", content: titleAfterReplace },
    ],
    { temperature: 0.95, max_tokens: 170, timeoutMs: 8000 }
  );
}

async function makeCasual(title) {
  const nm = await buildNameMap(title);
  const replacedTitle = nm.ok ? applyReplacements(title, nm.map) : title;

  const a = await toNewsilkoStyle(replacedTitle);
  if (!a.ok) {
    return { ok: false, text: "", why: a.why, replacedTitle, nameMapOk: nm.ok, nameMapWhy: nm.why };
  }

  const t0 = normalizeForCompare(replacedTitle);
  const t1 = normalizeForCompare(a.text);
  const tooSimilar = t1 && t0 && (t1 === t0 || t1.includes(t0) || t0.includes(t1));
  if (!tooSimilar) {
    return { ok: true, text: a.text, why: "", replacedTitle, nameMapOk: nm.ok, nameMapWhy: nm.why };
  }

  const b = await toNewsilkoStyle(`제목 그대로 쓰지 말고 친구한테 말하듯 풀어써: ${replacedTitle}`);
  return b.ok
    ? { ok: true, text: b.text, why: "", replacedTitle, nameMapOk: nm.ok, nameMapWhy: nm.why }
    : { ok: true, text: a.text, why: "", replacedTitle, nameMapOk: nm.ok, nameMapWhy: nm.why };
}

// ---------- Kakao ----------
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

function quickReplies() {
  // 사용자가 누르면 해당 텍스트가 그대로 utterance로 들어옴
  const mk = (label, messageText) => ({
    action: "message",
    label,
    messageText,
  });

  return [
    mk("오늘 뉴스", "뉴스"),
    mk("경제", "경제"),
    mk("사회", "사회"),
    mk("정치", "정치"),
    mk("국제", "국제"),
    mk("과학", "과학"),
    mk("연예", "연예"),
    mk("스포츠", "스포츠"),
  ];
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
      quickReplies: quickReplies(),
    },
  };
}

function kakaoText(msg) {
  return {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text: msg } }],
      quickReplies: quickReplies(),
    },
  };
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    const utter = getUtterance(req);
    const { query, topic } = buildQueryFromUtterance(utter);

    const item = await fetchNaverNewsTodayOnly(query, 50);

    if (!item) {
      return res
        .status(200)
        .json(
          kakaoText(
            `😿 오늘 올라온 ${topic} 기사 중에선 딱 잡히는 게 없네… 다른 버튼 눌러봐.`
          )
        );
    }

    const g = await makeCasual(item.title);

    if (!g.ok) {
      console.error("[OPENAI_FAIL]", g.why, { nameMapOk: g.nameMapOk, nameMapWhy: g.nameMapWhy });
      return res
        .status(200)
        .json(
          kakaoCard(
            `😿 말투 변환이 잠깐 막혔어…\n오늘 기사 제목만 던져줄게.\n\n${item.title}`,
            item.link
          )
        );
    }

    return res.status(200).json(kakaoCard(g.text, item.link));
  } catch (e) {
    console.error("[NEWSILKO_ERR]", e);
    return res.status(200).json(kakaoText("😿 일꼬가 잠깐 멈췄어… 다시!"));
  }
}
