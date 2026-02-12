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

// 네이버 뉴스 1개 (제목만)
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

  const j = await r.json().catch(() => ({}));
  const item = j?.items?.[0];
  if (!item) return null;

  return { title: clean(item.title), link: item.link };
}

// OpenAI: 제목 -> 구어체 1~2문장
async function gptCasual(title) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY missing");

  // 카카오가 타임아웃 민감해서 3.5초 안에 끝내고, 안 끝나면 그냥 fallback
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

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
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content:
              '너는 "뉴스일꼬"라는 고양이야. 뉴스 "제목"만 보고 친구한테 말하듯 아주 자연스러운 한국어 구어체로 1~2문장으로 바꿔. 어려운 단어/기자명/괄호태그/… 같은 말줄임표는 쓰지 마. 마지막에 "~대" "~했대" 느낌으로 마무리.',
          },
          { role: "user", content: title },
        ],
      }),
    });

    const j = await r.json().catch(() => ({}));
    const out = j?.choices?.[0]?.message?.content;
    return clean(out || "");
  } finally {
    clearTimeout(timeout);
  }
}

function kakaoOk(casualText, link) {
  return {
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text: casualText } },
        {
          basicCard: {
            thumbnail: { imageUrl: THUMBNAIL_URL },
            title: "기사 보고 싶으면 눌러",
            description: "",
            buttons: [
              { action: "webLink", label: "기사보기", webLinkUrl: link },
            ],
          },
        },
      ],
    },
  };
}

function kakaoFail(msg) {
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text: msg } }] },
  };
}

export default async function handler(req, res) {
  try {
    const q = getUtterance(req);
    const item = await fetchNaverNews(q);
    if (!item) return res.status(200).json(kakaoFail("😿 오늘은 뉴스가 안 잡힌다… 다시 한번!"));

    // GPT가 늦거나 에러나면 제목으로라도 답 보내기
    let casual = "";
    try {
      casual = await gptCasual(item.title);
    } catch (e) {
      casual = item.title; // fallback
    }

    if (!casual) casual = item.title;

    return res.status(200).json(kakaoOk(casual, item.link));
  } catch (e) {
    return res.status(200).json(kakaoFail("😿 지금 일꼬가 잠깐 멍 때렸어… 다시!"));
  }
}
