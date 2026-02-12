// api/newsilko.js

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

function normalizeText(s) {
  return decodeEntities(stripHtml(s)).replace(/\s+/g, " ").trim();
}

function clamp(s, n) {
  const t = normalizeText(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
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
    throw new Error(`Naver API error ${r.status}: ${body}`);
  }

  const data = await r.json();
  const item = data?.items?.[0];
  if (!item) return null;

  return {
    title: normalizeText(item.title),
    link: item.link,
    desc: normalizeText(item.description),
  };
}

// ----- 말투 튜닝 -----
const NICK = [
  ["이재명", "재명이"],
  ["정청래", "청래"],
  ["장동혁", "동혁이"],
  ["대통령", ""],
  ["대표", ""],
  ["의원", ""],
  ["위원장", ""],
];

function slangify(text) {
  let t = normalizeText(text);

  t = t.replace(/\[[^\]]*\]/g, "");
  t = t.replace(/\([^)]+\)/g, "");
  t = t.replace(/\s+/g, " ").trim();

  for (const [from, to] of NICK) t = t.split(from).join(to);

  t = t
    .replace(/오찬/g, "밥")
    .replace(/회동/g, "만남")
    .replace(/밝혔다/g, "그랬대")
    .replace(/말했다/g, "그랬대")
    .replace(/전했다/g, "그랬대")
    .replace(/취소했다/g, "취소했대")
    .replace(/거부했다/g, "안 한대")
    .replace(/검토/g, "고민")
    .replace(/재고/g, "다시 생각");

  t = clamp(t, 95);

  if (!/[.!?]$/.test(t)) t += "!";
  t = t.replace(/!$/, "!!");
  return t;
}

function getUtterance(req) {
  return (
    req?.body?.userRequest?.utterance ||
    req?.body?.userRequest?.params?.utterance ||
    req?.body?.utterance ||
    ""
  );
}

// 유저가 “정치/사회/연예/부동산/주식 …” 같은 단어를 치면 그걸로 검색.
// 기본은 속보.
function pickQuery(utterance) {
  const u = String(utterance || "");

  if (u.includes("연예")) return "연예";
  if (u.includes("사회")) return "사회";
  if (u.includes("정치")) return "정치";

  let cleaned = u
    .replace(/뉴스줘/g, "")
    .replace(/오늘뉴스/g, "")
    .replace(/뉴스일꼬/g, "")
    .replace(/일꼬야/g, "")
    .trim();

  if (cleaned.length >= 2) return cleaned;
  return "속보";
}

// ----- 카카오 응답 (카드 + 버튼만 느낌) -----
// 카드 필드는 “빈 값”이면 가이드 위반 날 수 있음.
// 그래서 title은 한 글자라도 넣고, description은 '.' 처럼 최소로.
function kakaoResponse(oneLine, link) {
  return {
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text: oneLine } },
        {
          basicCard: {
            title: " ",
            description: ".",
            buttons: [
              {
                action: "webLink",
                label: "기사보기",
                webLinkUrl: link,
              },
            ],
          },
        },
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
            { simpleText: { text: "🐱 열쇠가 없어… Vercel 환경변수부터 확인해줘." } },
          ],
        },
      });
    }

    const utterance = getUtterance(req);
    const query = pickQuery(utterance);

    const item = await fetchNaverNews(query);
    if (!item) {
      return res.status(200).json({
        version: "2.0",
        template: { outputs: [{ simpleText: { text: "🐱 오늘은 건질 뉴스가 없다…" } }] },
      });
    }

    const raw =
      item.title && item.title.length >= 18
        ? item.title
        : `${item.title} ${item.desc}`.trim();

    const oneLine = slangify(raw);

    return res.status(200).json(kakaoResponse(oneLine, item.link));
  } catch (e) {
    return res.status(200).json({
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: `🐱 에러났어…\n${e?.message || e}`,
            },
          },
        ],
      },
    });
  }
}
