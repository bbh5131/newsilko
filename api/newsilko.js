// api/newsilko.js

const THUMBNAIL_URL =
  "https://upload.wikimedia.org/wikipedia/commons/7/7e/CatB4SVG.png";

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
        temperature: 0.9,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content:
              '너는 "뉴스일꼬"라는 고양이야. 입력은 "뉴스 제목"이야. 출력은 친구한테 말하듯 자연스러운 한국어 구어체 1문장.\n규칙:\n- 분류(정치/사회) 같은 말 절대 넣지 마\n- 기자/매체/따옴표/괄호/대괄호/말줄임표(…) 금지\n- 어려운 단어는 쉬운 말로\n- 예: "전주에서 달리던 차에 불 났는데 다행히 사람은 안 다쳤대"\n- 45~80자 사이',
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
  // 1차 시도
  const a = await callOpenAI(title, 8000);

  if (!a.ok) return a;

  // 제목이랑 너무 비슷하면(거의 복붙) 2차로 더 강하게 재요청
  const t0 = normalizeForCompare(title);
  const t1 = normalizeForCompare(a.text);

  const tooSimilar = t1 && t0 && (t1 === t0 || t1.includes(t0) || t0.includes(t1));
  if (!tooSimilar) return a;

  const b = await callOpenAI(
    `제목을 그대로 쓰지 말고, 내용을 풀어서 말해줘: ${title}`,
    8000
  );

  return b.ok ? b : a;
}

function kakaoCard(text, link) {
  return {
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text } },
        {
          basicCard: {
            thumbnail: { imageUrl: THUMBNAIL_URL }, // ✅ 외부 URL이라 401 안 남
            title: "기사 보고 싶으면 눌러",
            description: "",
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

export default async function handler(req, res) {
  try {
    const q = getUtterance(req);
    const item = await fetchNaverNews(q);
    if (!item) return res.status(200).json(kakaoText("😿 뉴스가 안 잡혀… 다시 한 번!"));

    const g = await makeCasual(item.title);

    if (!g.ok) {
      // ✅ 실패 이유를 Vercel 로그에 남김 (카톡엔 너무 자세히 안 보여줌)
      console.error("[OPENAI_FAIL]", g.why);
      return res
        .status(200)
        .json(kakaoCard(`😿 말투 변환이 막혔어…(지금은 제목으로 보낼게)\n${item.title}`, item.link));
    }

    return res.status(200).json(kakaoCard(g.text, item.link));
  } catch (e) {
    console.error("[NEWSILKO_ERR]", e);
    return res.status(200).json(kakaoText("😿 일꼬가 잠깐 멈췄어… 다시!"));
  }
}
