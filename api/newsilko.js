// api/newsilko.js

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

function clamp(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// 고양이 말투: "과장 없이, 짧게"
function catLine(desc) {
  const t = clamp(desc, 60);
  // 너무 딱딱하면 어미만 살짝 바꿈
  // (의미 왜곡 최소화)
  const tweaks = [
    [/했습니다\.$/g, "했대."],
    [/했습니다$/g, "했대."],
    [/밝혔습니다\.$/g, "라고 했대."],
    [/밝혔습니다$/g, "라고 했대."],
    [/이라고 했습니다\.$/g, "래."],
    [/이라고 했습니다$/g, "래."],
    [/라고 했습니다\.$/g, "래."],
    [/라고 했습니다$/g, "래."],
    [/입니다\.$/g, "래."],
    [/입니다$/g, "래."],
  ];

  let out = t;
  for (const [re, rep] of tweaks) out = out.replace(re, rep);

  // 문장 끝이 딱 안 떨어지면 마침표 보정
  if (!/[.!?…。]$/.test(out)) out += ".";
  return out;
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

// 카카오 응답: simpleText + basicCard 3개
function kakaoResponse(headerText, cards) {
  return {
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text: headerText } },
        ...cards.map((c) => ({
          basicCard: {
            title: c.title,
            description: c.description,
            buttons: [
              {
                action: "webLink",
                label: "기사 보기",
                webLinkUrl: c.link,
              },
            ],
          },
        })),
      ],
    },
  };
}

export default async function handler(req, res) {
  try {
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      return res.status(200).json({
        version: "2.0",
        template: {
          outputs: [
            {
              simpleText: {
                text: "🐱 열쇠가 없어… Vercel 환경변수(NAVER_CLIENT_ID/SECRET)부터 확인해줘.",
              },
            },
          ],
        },
      });
    }

    const queries = [
      { label: "정치", q: "정치" },
      { label: "사회", q: "사회" },
      { label: "연예", q: "연예" },
    ];

    const results = [];
    for (const it of queries) {
      const item = await fetchNaverNews(it.q);
      if (item) results.push({ label: it.label, ...item });
    }

    if (results.length === 0) {
      return res.status(200).json({
        version: "2.0",
        template: { outputs: [{ simpleText: { text: "🐱 오늘은 조용하네. 뉴스 냄새가 안 나." } }] },
      });
    }

    const header =
      "🐱 뉴스일꼬 — 오늘의 인간 소식\n" +
      "대충 세 줄로 가져왔어. (클릭하면 기사로 가.)";

    const cards = results.map((n) => ({
      title: `(${n.label}) ${clamp(n.title, 38)}`,
      description: catLine(n.desc),
      link: n.link,
    }));

    return res.status(200).json(kakaoResponse(header, cards));
  } catch (e) {
    return res.status(200).json({
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: `🐱 에러났어…\n${e?.message || e}\n(잠깐 뒤에 다시 '뉴스줘' 해봐)`,
            },
          },
        ],
      },
    });
  }
}
