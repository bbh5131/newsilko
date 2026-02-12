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

function removeJunk(s) {
  let t = normalize(s);

  // 특수기호/말줄임표
  t = t.replace(/[▲■◆●▶▷★☆]/g, "");
  t = t.replace(/\u2026/g, "");
  t = t.replace(/\.{2,}/g, ""); // ".." "..." 제거
  t = t.replace(/\s*-\s*/g, " ");
  t = t.replace(/\s*\|\s*/g, " ");

  // 대괄호/괄호 덩어리
  t = t.replace(/\[[^\]]*\]/g, "");
  t = t.replace(/\([^)]+\)/g, "");

  // 매체/기자 패턴 제거
  t = t.replace(/\|[^|]{1,40}기자\|/g, "");
  t = t.replace(/[^ ]{1,15}\s*기자/g, "");

  // 따옴표/군더더기
  t = t.replace(/[“”"']/g, "");
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

// ---------- fetch (제목만 사용) ----------
async function fetchNewsTitleOnly(query) {
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
    title: removeJunk(item.title), // ✅ 제목만
    link: item.link,
  };
}

// ---------- 말투 (제목만으로 자연스럽게) ----------
function titleToChat(title) {
  let t = removeJunk(title);

  // 약어 한글화(원하면 더 추가 가능)
  t = t.replace(/美/g, "미국").replace(/日/g, "일본").replace(/中/g, "중국");

  // 너무 딱딱한 단어 완화
  t = t
    .replace(/오찬/g, "밥")
    .replace(/회동/g, "만남")
    .replace(/재고/g, "다시 생각")
    .replace(/검토/g, "고민")
    .replace(/촉구/g, "하라고 함")
    .replace(/강조/g, "힘줘 말함");

  t = clamp(t, 70);

  // 제목을 “사람이 말하는 문장”으로 바꿔주는 고정 템플릿
  // 1줄만 너무 건조하면 2줄로 나눔
  const tails = [
    "이래.",
    "그렇대.",
    "요즘 이런 분위기래.",
    "아무튼 그렇대.",
    "암튼 그럼.",
  ];
  const tail = tails[Math.floor(Math.random() * tails.length)];

  // 문장 끝 보정
  const line1 = `${t}래.`;
  const line2 = tail;

  return `${line1}\n${line2}`;
}

// ---------- helpers ----------
function pickQuery(u) {
  if (!u) return "속보";
  if (u.includes("연예")) return "연예";
  if (u.includes("사회")) return "사회";
  if (u.includes("정치")) return "정치";

  const cleaned = u
    .replace(/뉴스줘/g, "")
    .replace(/오늘뉴스/g, "")
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
    const item = await fetchNewsTitleOnly(query);

    if (!item) {
      return res.status(200).json({
        version: "2.0",
        template: {
          outputs: [{ simpleText: { text: "🐱 오늘은 건질 뉴스가 없다…" } }],
        },
      });
    }

    const line = titleToChat(item.title);

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
