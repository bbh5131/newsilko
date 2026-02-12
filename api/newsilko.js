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

function cleanText(s) {
  let t = decodeEntities(stripHtml(s));
  t = t.replace(/[▲■◆●▶▷★☆]/g, "");
  t = t.replace(/\u2026/g, "");
  t = t.replace(/\.{3,}/g, "");
  t = t.replace(/\s*-\s*/g, " ");
  t = t.replace(/\[[^\]]*\]/g, "");
  t = t.replace(/\([^)]+\)/g, "");
  return t.replace(/\s+/g, " ").trim();
}

function clamp(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

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
    title: cleanText(item.title),
    desc: cleanText(item.description),
    link: item.link,
  };
}

// 자연스러운 말투 생성 (과하지 않게)
function friendify(title, desc) {
  let topic = title.replace(/美/g, "미국");
  topic = clamp(topic, 60);

  let gist = desc
    .replace(/밝혔다/g, "그랬대")
    .replace(/말했다/g, "그랬대")
    .replace(/전했다/g, "그랬대")
    .replace(/진단이 제기됐다/g, "는 말이 나왔대")
    .replace(/전망이다/g, "같대");

  gist = clamp(gist, 60);

  if (!gist || gist.length < 10) {
    return `${topic}래!!`;
  }

  return `${topic} 얘긴데, ${gist}래!!`;
}

function pickQuery(utterance) {
  if (!utterance) return "속보";
  if (utterance.includes("연예")) return "연예";
  if (utterance.includes("사회")) return "사회";
  if (utterance.includes("정치")) return "정치";

  const cleaned = utterance
    .replace(/뉴스줘/g, "")
    .replace(/뉴스일꼬/g, "")
    .trim();

  return cleaned.length >= 2 ? cleaned : "속보";
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
                text: "🐱 네이버 API 키가 없어. 환경변수부터 확인해줘.",
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
          outputs: [
            { simpleText: { text: "🐱 오늘은 건질 뉴스가 없다…" } },
          ],
        },
      });
    }

    const oneLine = friendify(item.title, item.desc);

    return res.status(200).json({
      version: "2.0",
      template: {
        outputs: [
          { simpleText: { text: oneLine } },
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
              text: "🐱 뉴스 불러오다 에러났다. 잠깐 뒤에 다시 해봐.",
            },
          },
        ],
      },
    });
  }
}
