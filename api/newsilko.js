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

// --- 말투/별명 ---
const NICK = [
  ["이재명", "재명이"],
  ["정청래", "청래"],
  ["장동혁", "동혁이"],
  ["한동훈", "동훈이"],
  ["윤석열", "석열이"],
];

function applyNick(s) {
  let t = String(s || "");
  for (const [from, to] of NICK) t = t.split(from).join(to);
  return t;
}

// 문장을 “친구가 말하듯” 템플릿으로 변환
function friendify(title, desc) {
  const T = applyNick(normalizeText(title));
  const D = applyNick(normalizeText(desc));

  // 1) 제목 기반으로 핵심만 남기기(괄호/따옴표 제거)
  let core = T
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]+\)/g, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 2) 너무 기자문체면 톤만 부드럽게
  core = core
    .replace(/밝혔다/g, "그랬대")
    .replace(/말했다/g, "그랬대")
    .replace(/전했다/g, "그랬대")
    .replace(/검토/g, "고민")
    .replace(/재고/g, "다시 생각")
    .replace(/오찬/g, "밥")
    .replace(/회동/g, "만남")
    .replace(/취소/g, "캔슬");

  // 3) 제목이 애매/짧으면 설명에서 한 조각 끌어오기
  let extra = D
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]+\)/g, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  extra = extra
    .replace(/밝혔다/g, "그랬대")
    .replace(/말했다/g, "그랬대")
    .replace(/전했다/g, "그랬대");

  let line = core;
  if (line.length < 18 && extra.length > 0) {
    line = `${core}… 아무튼 ${extra}`;
  }

  // 4) “너가 원한 느낌”으로 한 번 더 다듬기(과하지 않게)
  // 예: “A가 B한테 ~하자고 했는데, 주변에서 말렸다!”
  line = line
    .replace(/의사를 밝혔다/g, "할지 말지 고민 중이래")
    .replace(/거부했다/g, "안 한대")
    .replace(/제안했다/g, "하자고 했대")
    .replace(/요청했다/g, "해달라 했대");

  line = clamp(line, 95);

  // 끝맺음
  if (!/[.!?]$/.test(line)) line += "!";
  line = line.replace(/!$/, "!!");

  // 5) 진짜 “대화체 한 줄” 느낌 내는 마무리 꼬리표(너무 과하면 빼도 됨)
  const tails = ["…그렇다네", "…이런 분위기래", "…대충 이렇대", "…암튼 그럼"];
  const tail = tails[Math.floor(Math.random() * tails.length)];
  return clamp(`${line} ${tail}`, 110);
}

// --- 카카오 응답(카드 + 버튼) ---
// 점(.) 대신 문장 넣기
function kakaoResponse(oneLine, link) {
  return {
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text: oneLine } },
        {
          basicCard: {
            title: "기사 보고 싶으면",
            description: "눌러라. 내가 대신 읽어줬잖아 😼",
            buttons: [
              { action: "webLink", label: "기사보기", webLinkUrl: link },
            ],
          },
        },
      ],
    },
  };
}

function getUtterance(req) {
  return (
    req?.body?.userRequest?.utterance ||
    req?.body?.userRequest?.params?.utterance ||
    req?.body?.utterance ||
    ""
  );
}

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

    const utterance = getUtterance(req);
    const query = pickQuery(utterance);

    const item = await fetchNaverNews(query);
    if (!item) {
      return res.status(200).json({
        version: "2.0",
        template: {
          outputs: [{ simpleText: { text: "🐱 오늘은 건질 뉴스가 없다…" } }],
        },
      });
    }

    const oneLine = friendify(item.title, item.desc);
    return res.status(200).json(kakaoResponse(oneLine, item.link));
  } catch (e) {
    return res.status(200).json({
      version: "2.0",
      template: {
        outputs: [
          { simpleText: { text: `🐱 에러났어…\n${e?.message || e}` } },
        ],
      },
    });
  }
}
