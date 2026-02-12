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

function normalize(s) {
  return decodeEntities(stripHtml(s)).replace(/\s+/g, " ").trim();
}

function clamp(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// 기사 특수기호 제거
function cleanNews(s) {
  let t = normalize(s);
  t = t.replace(/[▲■◆●▶▷★☆]/g, "");
  t = t.replace(/\u2026/g, "");
  t = t.replace(/\.{3,}/g, "");
  t = t.replace(/\[[^\]]*\]/g, "");
  t = t.replace(/\([^)]+\)/g, "");
  t = t.replace(/\s*-\s*/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// ---------- fetch ----------
async function fetchNews(query) {
  const url =
    "https://openapi.naver.com/v1/search/news.json?" +
    new URLSearchParams({ query, display: "1", sort: "date" }).toString();

  const r = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID || "",
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET || "",
    },
  });

  if (!r.ok) throw new Error("naver api error");

  const data = await r.json();
  const item = data?.items?.[0];
  if (!item) return null;

  return {
    title: cleanNews(item.title),
    desc: cleanNews(item.description),
    link: item.link,
  };
}

// ---------- 말투 ----------
function friendify(title, desc) {
  let main = title.replace(/美/g, "미국");
  main = clamp(main, 70);

  let sub = desc
    .replace(/밝혔다/g, "그랬대")
    .replace(/말했다/g, "그랬대")
    .replace(/전했다/g, "그랬대")
    .replace(/진단이 제기됐다/g, "는 말이 나왔대")
    .replace(/전망이다/g, "같대")
    .replace(/주목해야 한다/g, "지켜봐야 한대");

  sub = clamp(sub, 60);

  const tails = [
    "아무튼 그렇대.",
    "대충 이런 분위기래.",
    "이래.",
    "그렇다네.",
    "암튼 그럼.",
  ];
  const tail = tails[Math.floor(Math.random() * tails.length)];

  if (sub.length > 15) {
    return `${main}. ${sub}. ${tail}`;
  } else {
    return `${main}. ${tail}`;
  }
}

// ---------- helpers ----------
function pickQuery(u) {
  if (!u) return "속보";
  if (u.includes("연예")) return "연예";
  if (u.includes("사회")) return "사회";
  if (u.includes("정치")) return "정치";

  const cleaned = u
    .replace(/뉴스줘/g, "")
    .replace(/뉴스일꼬/g, "")
    .trim();

  return cleaned.length >= 2 ? cleaned : "속보";
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      return res.status(200).json({
        version: "2.0",
        template: {
          outputs: [
            {
              simpleText: {
                text: "🐱 네이버 API 키 없어… Vercel 환경변수부터 확인해줘.",
              },
            },
          ],
        },
      });
    }

    const utterance =
      req?.body?.userRequest?.utterance ||
      req?.body?.utterance ||
      "";

    const query = pickQuery(utterance);

    const item = await fetchNews(query);
    if (!item) {
      return res.status(200).json({
        version: "2.0",
        template: {
          outputs: [{ simpleText: { text: "🐱 오늘은 건질 뉴스가 없다…" } }],
        },
      });
    }

    const line = friendify(item.title, item.desc);

    return res.status(200).json({
      version: "2.0",
      template: {
        outputs: [
          { simpleText: { text: line } },
          {
            basicCard: {
              thumbnail: { imageUrl: THUMBNAIL_URL },
              title: "기사 보고 싶으면",
              description: "눌러라 😼",
              buttons: [
                {
                  action: "webLink",
                  label: "기사보기",
                  webLinkUrl: item.link,
                },
              ],
            },
          },
        ],
      },
    });
  } catch (e) {
    return res.status(200).json({
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: "🐱 뉴스 불러오다 에러났다… 잠깐 뒤에 다시 해봐.",
            },
          },
        ],
      },
    });
  }
}
