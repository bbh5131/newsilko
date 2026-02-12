// api/newsilko.js

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}
function clamp(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
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

// ✅ 말투를 "친구가 말하듯" 가볍게 바꾸는 규칙들
// 필요하면 여기만 계속 다듬으면 됨
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
  let t = String(text || "");

  // 괄호/따옴표/군더더기 제거
  t = t.replace(/[“”"']/g, "");
  t = t.replace(/\[[^\]]*\]/g, "");
  t = t.replace(/\([^)]+\)/g, "");
  t = t.replace(/\s+/g, " ").trim();

  // 닉네임 치환
  for (const [from, to] of NICK) t = t.split(from).join(to);

  // 딱딱한 표현 조금만 부드럽게
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

  // 끝맺음
  t = clamp(t, 85);
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

// 유저가 키워드를 주면 그걸로 검색, 아니면 기본은 속보 느낌으로
function pickQuery(utterance) {
  const u = String(utterance || "");
  // 사용자가 "정치/사회/연예" 같은 말 하면 그걸 따라감
  if (u.includes("연예")) return "연예";
  if (u.includes("사회")) return "사회";
  if (u.includes("정치")) return "정치";

  // 사용자가 "뉴스줘" 외에 특정 키워드를 붙였으면 그걸로도 가능
  // 예: "부동산 뉴스줘" -> "부동산"
  // "뉴스줘" / "오늘뉴스" 같은 트리거 단어는 제거
  let cleaned = u
    .replace(/뉴스줘/g, "")
    .replace(/오늘뉴스/g, "")
    .replace(/뉴스일꼬/g, "")
    .replace(/일꼬야/g, "")
    .trim();

  if (cleaned.length >= 2) return cleaned;

  return "속보";
}

// ✅ 카카오 응답: simpleText(한 줄) + basicCard(기사보기 버튼만 깔끔하게)
function kakaoResponse(line, link) {
  return {
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text: line } },
        {
          basicCard: {
            title: "기사보기",
            description: "눌러서 원문 보면 돼.",
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
          outputs: [{ simpleText: { text: "🐱 오늘은 건질 게 없다… 다시 불러줘." } }],
        },
      });
    }

    // 제목+요약을 섞되 너무 길면 제목 중심
    const raw =
      item.title && item.title.length >= 18
        ? item.title
        : `${item.title || ""} ${item.desc || ""}`.trim();

    // 최종 한 줄
    const line = slangify(raw);

    return res.status(200).json(kakaoResponse(line, item.link));
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
