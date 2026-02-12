// api/newsilko.js

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

// ✅ &quot; &#39; 같은 HTML 엔티티 디코딩
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
  return decodeEntities(stripHtml(s))
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(s, n) {
  const t = normalizeText(s);
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
    title: normalizeText(item.title),
    link: item.link,
    desc: normalizeText(item.description),
  };
}

// 닉네임/말투 (필요하면 계속 튜닝 가능)
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

  // 괄호류 제거(남아있으면 보기 지저분)
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

  t = clamp(t, 110);

  // 끝맺음
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

// ✅ 카카오 응답: simpleText만 2개 (가이드 위반 최소)
function kakaoSimple(text) {
  return { simpleText: { text } };
}

function kakaoResponse(line, link) {
  // 링크는 한 줄로만, 너무 길면 줄여서 표시(겉보기)
  // 실제 링크는 그대로 들어가니까 클릭은 됨
  const pretty = link
    ? link.replace(/^https?:\/\//, "").slice(0, 45) + (link.length > 53 ? "…" : "")
    : "";

  const linkLine = link ? `기사보기 👉 ${pretty}\n(${link})` : "기사 링크가 없네…";

  return {
    version: "2.0",
    template: {
      outputs: [kakaoSimple(line), kakaoSimple(linkLine)],
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
            kakaoSimple("🐱 열쇠가 없어… Vercel 환경변수(NAVE
::contentReference[oaicite:0]{index=0}
