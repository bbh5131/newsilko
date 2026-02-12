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

// ✅ 기사에 섞이는 잡기호/말줄임표 정리
function cleanNewsText(s) {
  let t = normalizeText(s);

  // 흔한 기호 제거
  t = t.replace(/[▲■◆●▶▷★☆]/g, "");
  // 유니코드 말줄임(…)과 점 3개(...) 제거
  t = t.replace(/\u2026/g, "");
  t = t.replace(/\.{3,}/g, "");
  // 제목에서 흔한 구분자 완화
  t = t.replace(/\s*-\s*/g, " ");
  t = t.replace(/\s*\|\s*/g, " ");
  t = t.replace(/\s+/g, " ").trim();

  // 대괄호/괄호 덩어리 제거
  t = t.replace(/\[[^\]]*\]/g, "");
  t = t.replace(/\([^)]+\)/g, "");

  return t.replace(/\s+/g, " ").trim();
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
    title: cleanNewsText(item.title),
    link: item.link,
    desc: cleanNewsText(item.description),
  };
}

// --- 말투/별명 ---
// (너무 비하처럼 보이지 않게 “~이” 정도만)
const NICK = [
  ["이재명", "재명이"],
  ["정청래", "청래"],
  ["장동혁", "동혁이"],
];

function applyNick(s) {
  let t = String(s || "");
  for (const [from, to] of NICK) t = t.split(from).join(to);
  return t;
}

// ✅ “읽을 수 있는 한 줄” 생성: 제목 + 요약을 ‘대화체’로 재구성
function friendify(title, desc) {
  const T = applyNick(cleanNewsText(title));
  const D = applyNick(cleanNewsText(desc));

  // 제목이 너무 딱딱하면 부드럽게
  let topic = T
    .replace(/美/g, "미국")
    .replace(/日/g, "일본")
    .replace(/中/g, "중국");

  // 설명은 “무슨 얘기냐” 한 문장으로만
  let gist = D
    .replace(/밝혔다/g, "그랬대")
    .replace(/말했다/g, "그랬대")
    .replace(/전했다/g, "그랬대")
    .replace(/진단이 제기됐다/g, "는 말이 나왔대")
    .replace(/주목해야 한다/g, "지켜봐야 한대")
    .replace(/전망이다/g, "같대");

  topic = clamp(topic, 58);
  gist = clamp(gist, 62);

  // gist가 너무 빈약하면 topic만으로 처리
  let line;
  if (gist.length < 12) {
    line = `${topic}래!!`;
  } else {
    line = `${topic} 얘긴데, ${gist}래!!`;
  }

  // 마지막 군더더기 제거/정리
  line = line.replace(/\s+/g, " ").trim();
  return clamp(line, 110);
}

function getUtterance(req) {
  return (
    req?.body?.userRequest?.utterance ||
    req?.body?.userRequest?.params?.utterance ||
    req?.body?.utterance ||
    ""
  );
}

// 유저가 키워드를 주면 그걸로 검색. 기본은 속보.
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

// ✅ 카카오 응답: simpleText 1개 + basicCard 1개(기사보기 버튼)
// ⚠️ 오류(2461) 방지: thumbnail.imageUrl 반드시 포함
const THUMBNAIL_URL =
  "https://upload.wikimedia.org/wikipedia/commons/7/7e/CatB4SVG.png"; // CC0 cat icon

function kakaoResponse(oneLine, link) {
  return {
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text: oneLine } },
        {
          basicCard: {
            thumbnail: { imageUrl: THUMBNAIL_URL },
            title: "기사 보고 싶으면",
            description: "눌러라 😼",
            buttons: [{ action: "webLink", label: "기사보기", webLinkUrl: link }],
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
            {https://github.com/bbh5131/newsilko/blob/main/api/newsilko.js
              simpleText: {
                text: "🐱 열쇠가 없어… Vercel 환경변수(NAVER_CLIENT_ID/SECRET)부터 확인해줘.",
              },
            },
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

    const oneLine = friendify(item.title, item.desc);
    return res.status(200).json(kakaoResponse(oneLine, item.link));
  } catch (e) {
    return res.status(200).json({
      version: "2.0",
      template: {
        outputs: [{ simpleText: { text: `🐱 에러났어…\n${e?.message || e}` } }],
      },
    });
  }
}
