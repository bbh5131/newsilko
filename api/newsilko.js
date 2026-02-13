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

// ---------- name replace safety net ----------
function replaceNames(text) {
  return String(text || "")
    .replace(/윤석열|윤 대통령/g, "석열이")
    .replace(/문재인|문 전 대통령/g, "재인이")
    .replace(/이재명|이 대통령/g, "재명이");
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

async function callOpenAI(title, timeoutMs = 8000) {
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
        temperature: 0.95,
        max_tokens: 140,
        messages: [
          {
            role: "system",
            content: `너는 "뉴스일꼬"라는 츤데레 고양이야 🐱
입력은 "뉴스 제목"이고, 출력은 친구한테 카톡 보내듯 귀엽고 자연스러운 한국어 구어체로 1~2문장이야.

말투 규칙:
- 존댓말 금지(합니다/됩니다 금지)
- 딱딱한 뉴스체 금지(…/기자/매체/인용부호/괄호/대괄호/말줄임표 사용 금지)
- "~했다" 대신 "~했대", "~라네", "~래" 같은 느낌으로
- 과장 너무 심하게 하지 말고 자연스럽게
- 40~95자 정도

이름 치환(반드시 적용):
- 윤석열, 윤 대통령 → 석열이
- 문재인, 문 전 대통령 → 재인이
- 이재명, 이 대통령 → 재명이

좋은 예:
- "전주에서 달리던 차에 불 났는데 다행히 사람은 안 다쳤대. 깜짝이야 😿"
- "석열이랑 재명이 또 말이 나왔대. 시끄럽다 진짜 😼"

나쁜 예:
- "윤 대통령은…" (이름 치환 안 함)
- "…로 확인됐다." (딱딱함)

제목을 그대로 베끼지 말고, 말로 풀어서 써.`,
          },
          { role: "user", content: title },
        ],
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

async function makeCasual(title) {
  const a = await callOpenAI(title, 8000);
  if (!a.ok) return a;

  // 결과가 제목이랑 너무 비슷하면 한 번 더 강하게
  const t0 = normalizeForCompare(title);
  const t1 = normalizeForCompare(a.text);

  const tooSimilar = t1 && t0 && (t1 === t0 || t1.includes(t0) || t0.includes(t1));
  if (!tooSimilar) return a;

  const b = await callOpenAI(`제목을 그대로 쓰지 말고, 친구한테 말하듯 풀어서 말해줘: ${title}`, 8000);
  return b.ok ? b : a;
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
      const fallback = replaceNames(item.title);
      return res
        .status(200)
        .json(kakaoCard(`😿 말투 변환이 잠깐 막혔어…\n일단 제목만 던져줄게.\n\n${fallback}`, item.link));
    }

    const finalText = replaceNames(g.text);
    return res.status(200).json(kakaoCard(finalText, item.link));
  } catch (e) {
    console.error("[NEWSILKO_ERR]", e);
    return res.status(200).json(kakaoText("😿 일꼬가 잠깐 멈췄어… 다시!"));
  }
}
