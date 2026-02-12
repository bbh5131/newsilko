// api/newsilko.js

const REPLACEMENTS = [
  ["오찬", "밥자리"],
  ["회동", "만남"],
  ["재고", "다시 생각"],
  ["검토", "고민"],
  ["논란", "사람들 시끄러움"],
  ["촉구", "하라고 함"],
  ["강조", "힘줘 말함"],
  ["발표했다", "래"],
  ["밝혔다", "래"],
  ["말했다", "래"],
];

function catify(text) {
  let t = String(text || "");
  for (const [from, to] of REPLACEMENTS) t = t.split(from).join(to);
  // 너무 길면 자르기
  if (t.length > 70) t = t.slice(0, 70) + "…";
  return t;
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

async function fetchNaverNews(query) {
  const url =
    "https://openapi.naver.com/v1/search/news.json?" +
    new URLSearchParams({
      query,
      display: "1",
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
    throw new Error(`Naver API error ${r.status}: ${body}`);
  }

  const data = await r.json();
  const item = data?.items?.[0];
  if (!item) return null;

  return {
    title: stripHtml(item.title),
    link: item.link,
    desc: stripHtml(item.description),
  };
}

function kakaoSimpleText(text) {
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: { text },
        },
      ],
    },
  };
}

export default async function handler(req, res) {
  try {
    // 키 없으면 친절하게 안내
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      return res
        .status(200)
        .json(
          kakaoSimpleText(
            "🐱 일꼬가 열쇠를 못 찾았어…\nVercel 환경변수 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 먼저 넣어줘!"
          )
        );
    }

    // 3개 카테고리
    const queries = ["정치", "사회", "연예"];

    const results = [];
    for (const q of queries) {
      const item = await fetchNaverNews(q);
      if (item) results.push({ q, ...item });
    }

    if (results.length === 0) {
      return res
        .status(200)
        .json(kakaoSimpleText("🐱 오늘은 뉴스 냄새가 안 나… 다시 불러줘."));
    }

    const lines = [];
    lines.push("🐱 뉴스일꼬 — 오늘의 인간 소식");
    lines.push("");

    results.forEach((n, idx) => {
      lines.push(`${idx + 1}️⃣ (${n.q}) ${catify(n.title)}`);
      if (n.link) lines.push(`🔗 ${n.link}`);
      lines.push("");
    });

    lines.push("끝. 나는 창가 간다냥.");

    return res.status(200).json(kakaoSimpleText(lines.join("\n")));
  } catch (e) {
    return res
      .status(200)
      .json(
        kakaoSimpleText(
          `🐱 에러 났다냥…\n${e?.message || e}\n(잠깐 뒤에 다시 '뉴스줘' 해봐)`
        )
      );
  }
}
