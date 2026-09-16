// api/newsilko.js

const BASE_URL = "https://newsilko.vercel.app";
const THUMBNAIL_URL = `${BASE_URL}/newsilko-thumbnail.png`;

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

function clean(s) {
  return decodeEntities(stripHtml(s)).replace(/\s+/g, " ").trim();
}

function getUtterance(req) {
  return (
    req?.body?.userRequest?.utterance ||
    req?.body?.userRequest?.params?.utterance ||
    req?.body?.utterance ||
    "뉴스"
  );
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyReplacements(text, map) {
  let out = String(text || "");
  const entries = Object.entries(map || {})
    .filter(([k, v]) => typeof k === "string" && typeof v === "string" && k && v && k !== v)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [from, to] of entries) {
    out = out.replace(new RegExp(escapeRegExp(from), "g"), to);
  }
  return out;
}

function normalizeIntent(s) {
  return clean(s).replace(/\s+/g, "").toLowerCase();
}

function isTodayKST(pubDateStr) {
  if (!pubDateStr) return false;

  const d = new Date(pubDateStr);
  if (Number.isNaN(d.getTime())) return false;

  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const nowKST = new Date(Date.now() + kstOffsetMs);

  const startKST = new Date(nowKST);
  startKST.setHours(0, 0, 0, 0);

  const endKST = new Date(startKST);
  endKST.setDate(endKST.getDate() + 1);

  const articleKST = new Date(d.getTime() + kstOffsetMs);
  return articleKST >= startKST && articleKST < endKST;
}

function buildQueryFromUtterance(utterance) {
  const u = normalizeIntent(utterance);

  const isGeneral =
    !u ||
    u === "뉴스" ||
    u === "속보" ||
    u === "최신" ||
    u === "랜덤" ||
    u === "아무거나";

  if (isGeneral) {
    return {
      queries: ["속보", "뉴스"],
      topic: "뉴스",
      mode: "general",
    };
  }

  const categoryMap = {
    경제: {
      queries: ["경제", "증시", "코스피", "코스닥", "금리", "환율", "물가", "부동산", "반도체"],
      aliases: ["경제", "주식", "증시", "코스피", "코스닥", "환율", "금리", "물가", "부동산"],
    },
    사회: {
      queries: ["사회", "사건 사고", "경찰", "법원", "교육", "노동", "의료", "재난"],
      aliases: ["사회", "사건", "사고", "재난", "경찰", "법원", "교육", "노동", "복지", "의료"],
    },
    정치: {
      queries: ["정치", "국회", "대통령실", "여야", "정당", "법안", "외교"],
      aliases: ["정치", "국회", "대통령", "대통령실", "여야", "선거", "정당", "외교"],
    },
    국제: {
      queries: ["국제", "해외", "미국", "중국", "일본", "유럽", "우크라이나", "중동"],
      aliases: ["국제", "해외", "미국", "중국", "일본", "유럽", "우크라이나", "중동"],
    },
    과학: {
      queries: ["과학", "인공지능", "AI", "기술", "우주", "연구", "반도체 기술"],
      aliases: ["과학", "기술", "ai", "인공지능", "반도체", "우주", "연구", "논문"],
    },
    연예: {
      queries: ["연예", "아이돌", "배우", "가수", "드라마", "영화"],
      aliases: ["연예", "셀럽", "아이돌", "배우", "가수", "드라마", "영화", "열애"],
    },
    스포츠: {
      queries: ["스포츠", "아시안게임", "국가대표", "축구", "야구", "농구", "배구", "e스포츠"],
      aliases: ["스포츠", "축구", "야구", "농구", "배구", "e스포츠", "이스포츠", "국가대표", "아시안게임"],
    },
  };

  for (const [cat, cfg] of Object.entries(categoryMap)) {
    if (cfg.aliases.some((word) => u.includes(word))) {
      return {
        queries: cfg.queries,
        topic: cat,
        mode: `category:${cat}`,
      };
    }
  }

  return {
    queries: [clean(utterance)],
    topic: "검색",
    mode: "free",
  };
}

async function fetchNaverNews(query, display = 50) {
  const url =
    "https://openapi.naver.com/v1/search/news.json?" +
    new URLSearchParams({
      query,
      display: String(display),
      sort: "date",
    }).toString();

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID || "",
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET || "",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Naver ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json().catch(() => ({}));
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return null;

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const formatItem = (item) => ({
    title: clean(item?.title),
    link: item?.originallink || item?.link || "",
    pubDate: item?.pubDate,
    searchQuery: query,
  });

  const todayItems = items.filter((item) => isTodayKST(item?.pubDate));
  if (todayItems.length) return formatItem(pickRandom(todayItems));

  const nowMs = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const last24h = items.filter((item) => {
    const d = new Date(item?.pubDate);
    if (Number.isNaN(d.getTime())) return false;

    const age = nowMs - d.getTime();
    return age >= 0 && age <= DAY;
  });

  if (last24h.length) return formatItem(pickRandom(last24h));
  return formatItem(pickRandom(items));
}

async function fetchNaverNewsWithFallback(queries, display = 50) {
  const queryList = Array.isArray(queries) ? queries : [queries];

  for (const query of queryList) {
    if (!query) continue;

    try {
      console.log("[NAVER_SEARCH_TRY]", query);
      const item = await fetchNaverNews(query, display);

      if (item) {
        console.log("[NAVER_SEARCH_OK]", query, item.title);
        return item;
      }

      console.log("[NAVER_SEARCH_EMPTY]", query);
    } catch (e) {
      console.error("[NAVER_SEARCH_FAIL]", query, String(e));
    }
  }

  return null;
}

// ------------------------------
// 기사 대표 이미지 추출
// 우선순위:
// og:image -> twitter:image -> JSON-LD -> picture/source -> img
// ------------------------------

function normalizeImageUrl(rawUrl, articleUrl) {
  if (!rawUrl) return null;

  const value = decodeEntities(String(rawUrl).trim());
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return null;

  try {
    const url = new URL(value, articleUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function looksLikeJunkImage(url, context = "") {
  const text = `${url} ${context}`.toLowerCase();

  return /(^|[\/_.-])(logo|icon|favicon|sprite|avatar|profile|banner|advert|advertisement|adserver|tracking|pixel|spacer|blank|loading|placeholder)([\/_.?-]|$)/i.test(
    text
  );
}

function parseSrcset(srcset, articleUrl) {
  if (!srcset) return [];

  return String(srcset)
    .split(",")
    .map((part) => part.trim())
    .map((part) => {
      const pieces = part.split(/\s+/);
      const rawUrl = pieces[0];
      const descriptor = pieces[1] || "";
      const url = normalizeImageUrl(rawUrl, articleUrl);
      if (!url) return null;

      let score = 0;
      const w = descriptor.match(/^(\d+)w$/i);
      const x = descriptor.match(/^([\d.]+)x$/i);

      if (w) score = Number(w[1]);
      else if (x) score = Number(x[1]) * 1000;

      return { url, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function extractMetaImage(html, articleUrl) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

  const priorities = [
    ["property", "og:image:secure_url"],
    ["property", "og:image:url"],
    ["property", "og:image"],
    ["name", "twitter:image:src"],
    ["name", "twitter:image"],
  ];

  for (const [key, wanted] of priorities) {
    for (const tag of metaTags) {
      const keyMatch = tag.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`, "i"));
      if (!keyMatch || keyMatch[1].toLowerCase() !== wanted) continue;

      const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
      const url = normalizeImageUrl(contentMatch?.[1], articleUrl);

      if (url && !looksLikeJunkImage(url, tag)) {
        return url;
      }
    }
  }

  return null;
}

function collectImagesFromJsonLd(value, out = []) {
  if (!value) return out;

  if (Array.isArray(value)) {
    for (const item of value) collectImagesFromJsonLd(item, out);
    return out;
  }

  if (typeof value !== "object") return out;

  const imageKeys = ["image", "thumbnailUrl", "contentUrl"];

  for (const key of imageKeys) {
    const imageValue = value[key];

    if (typeof imageValue === "string") {
      out.push(imageValue);
    } else if (Array.isArray(imageValue)) {
      for (const item of imageValue) {
        if (typeof item === "string") out.push(item);
        else if (item && typeof item === "object") {
          if (typeof item.url === "string") out.push(item.url);
          if (typeof item.contentUrl === "string") out.push(item.contentUrl);
        }
      }
    } else if (imageValue && typeof imageValue === "object") {
      if (typeof imageValue.url === "string") out.push(imageValue.url);
      if (typeof imageValue.contentUrl === "string") out.push(imageValue.contentUrl);
    }
  }

  if (value.primaryImageOfPage) {
    collectImagesFromJsonLd(value.primaryImageOfPage, out);
  }

  if (value.mainEntity) {
    collectImagesFromJsonLd(value.mainEntity, out);
  }

  if (value["@graph"]) {
    collectImagesFromJsonLd(value["@graph"], out);
  }

  return out;
}

function extractJsonLdImage(html, articleUrl) {
  const scriptRegex =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = String(match[1] || "").trim();
    if (!raw) continue;

    try {
      const data = JSON.parse(raw);
      const candidates = collectImagesFromJsonLd(data);

      for (const candidate of candidates) {
        const url = normalizeImageUrl(candidate, articleUrl);

        if (url && !looksLikeJunkImage(url)) {
          return url;
        }
      }
    } catch {
      // 일부 사이트는 깨진 JSON-LD를 넣기도 하므로 무시
    }
  }

  return null;
}

function extractPictureImage(html, articleUrl) {
  const pictureRegex = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
  let match;

  while ((match = pictureRegex.exec(html)) !== null) {
    const block = match[1] || "";

    const sourceTags = block.match(/<source\b[^>]*>/gi) || [];
    for (const tag of sourceTags) {
      const srcsetMatch =
        tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i) ||
        tag.match(/\bdata-srcset\s*=\s*["']([^"']+)["']/i);

      const candidates = parseSrcset(srcsetMatch?.[1], articleUrl);

      for (const candidate of candidates) {
        if (!looksLikeJunkImage(candidate.url, tag)) {
          return candidate.url;
        }
      }
    }

    const imgTag = block.match(/<img\b[^>]*>/i)?.[0];
    if (imgTag) {
      const srcsetMatch =
        imgTag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i) ||
        imgTag.match(/\bdata-srcset\s*=\s*["']([^"']+)["']/i);

      const srcsetCandidates = parseSrcset(srcsetMatch?.[1], articleUrl);
      for (const candidate of srcsetCandidates) {
        if (!looksLikeJunkImage(candidate.url, imgTag)) {
          return candidate.url;
        }
      }

      const srcMatch =
        imgTag.match(/\bdata-original\s*=\s*["']([^"']+)["']/i) ||
        imgTag.match(/\bdata-lazy-src\s*=\s*["']([^"']+)["']/i) ||
        imgTag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i) ||
        imgTag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);

      const url = normalizeImageUrl(srcMatch?.[1], articleUrl);
      if (url && !looksLikeJunkImage(url, imgTag)) {
        return url;
      }
    }
  }

  return null;
}

function extractImgImage(html, articleUrl) {
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];

  for (const tag of imgTags) {
    if (looksLikeJunkImage("", tag)) continue;

    const width = Number(tag.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1] || 0);
    const height = Number(tag.match(/\bheight\s*=\s*["']?(\d+)/i)?.[1] || 0);

    // 명시적으로 너무 작은 아이콘이면 제외
    if ((width && width < 200) || (height && height < 120)) continue;

    const srcsetMatch =
      tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i) ||
      tag.match(/\bdata-srcset\s*=\s*["']([^"']+)["']/i);

    const srcsetCandidates = parseSrcset(srcsetMatch?.[1], articleUrl);

    for (const candidate of srcsetCandidates) {
      if (!looksLikeJunkImage(candidate.url, tag)) {
        return candidate.url;
      }
    }

    const srcMatch =
      tag.match(/\bdata-original\s*=\s*["']([^"']+)["']/i) ||
      tag.match(/\bdata-lazy-src\s*=\s*["']([^"']+)["']/i) ||
      tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i) ||
      tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);

    const url = normalizeImageUrl(srcMatch?.[1], articleUrl);

    if (url && !looksLikeJunkImage(url, tag)) {
      return url;
    }
  }

  return null;
}

async function getArticleImage(articleUrl, timeoutMs = 2200) {
  if (!articleUrl || typeof articleUrl !== "string") return null;

  try {
    const parsed = new URL(articleUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      console.log("[ARTICLE_FETCH_FAIL]", response.status, articleUrl);
      return null;
    }

    const html = await response.text().catch(() => "");
    if (!html) return null;

    const extractors = [
      ["META", extractMetaImage],
      ["JSON_LD", extractJsonLdImage],
      ["PICTURE", extractPictureImage],
      ["IMG", extractImgImage],
    ];

    for (const [name, extractor] of extractors) {
      const imageUrl = extractor(html, articleUrl);

      if (imageUrl) {
        console.log(`[ARTICLE_IMAGE_${name}]`, imageUrl);
        return imageUrl;
      }
    }

    console.log("[ARTICLE_IMAGE_NONE]", articleUrl);
    return null;
  } catch (e) {
    if (String(e?.name) === "AbortError") {
      console.log("[ARTICLE_IMAGE_TIMEOUT]", articleUrl);
      return null;
    }

    console.log("[ARTICLE_IMAGE_ERROR]", String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function makeProxyImageUrl(imageUrl) {
  if (!imageUrl) return null;
  return `${BASE_URL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

// ------------------------------
// OpenAI
// ------------------------------

function normalizeForCompare(s) {
  return clean(s)
    .replace(/[“”"']/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function callOpenAI(
  messages,
  { temperature = 0.4, max_tokens = 220, timeoutMs = 8000 } = {}
) {
  const key = process.env.OPENAI_API_KEY || "";

  if (!key) {
    return { ok: false, text: "", why: "OPENAI_API_KEY 없음" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature,
        max_tokens,
        messages,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        text: "",
        why: `OpenAI ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = await response.json().catch(() => ({}));
    const output = clean(data?.choices?.[0]?.message?.content || "");

    if (!output) {
      return { ok: false, text: "", why: "OpenAI 응답 비었음" };
    }

    return { ok: true, text: output, why: "" };
  } catch (e) {
    if (String(e?.name) === "AbortError") {
      return {
        ok: false,
        text: "",
        why: `OpenAI 타임아웃(${timeoutMs}ms)`,
      };
    }

    return {
      ok: false,
      text: "",
      why: `OpenAI 호출 오류: ${String(e).slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function buildNameMap(title) {
  const systemPrompt = `
너는 한국어 뉴스 제목에서 "사람 이름(인명)"만 찾아 치환 맵을 만드는 도구야.
출력은 JSON 하나만. 다른 말 절대 금지.

규칙:
- 입력 제목에 등장하는 사람 이름만 대상으로 한다.
- 기관명, 지명, 브랜드, 단체는 제외한다.
- 한국인 이름이 성+이름으로 나오면 성을 제거하고 이름만 남긴다.
- 이름 끝 글자에 받침이 있으면 "이"를 붙인다. 받침이 없으면 붙이지 않는다.
- 직책/호칭이 붙은 표현도 같은 사람이라면 함께 매핑한다.
- 치환 대상이 없으면 {}만 출력한다.

예:
윤석열 -> 석열이
문재인 -> 재인이
이재명 -> 재명이
김찬희 -> 찬희
박지우 -> 지우
유진 -> 유진이
`;

  const result = await callOpenAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: title },
    ],
    {
      temperature: 0.2,
      max_tokens: 260,
      timeoutMs: 8000,
    }
  );

  if (!result.ok) {
    return { ok: false, map: {}, why: result.why };
  }

  try {
    const jsonText = result.text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const obj = JSON.parse(jsonText);

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return {
        ok: false,
        map: {},
        why: "인명맵 JSON 형식이 아님",
      };
    }

    const map = {};

    for (const [key, value] of Object.entries(obj)) {
      if (
        typeof key === "string" &&
        typeof value === "string" &&
        key.trim() &&
        value.trim()
      ) {
        map[key.trim()] = value.trim();
      }
    }

    return { ok: true, map, why: "" };
  } catch (e) {
    return {
      ok: false,
      map: {},
      why: `인명맵 JSON 파싱 실패: ${String(e).slice(0, 120)}`,
    };
  }
}

async function toNewsilkoStyle(titleAfterReplace) {
  const systemPrompt = `
너는 "뉴스일꼬"라는 츤데레 고양이야 🐱

입력은 뉴스 제목이고, 인명 치환은 이미 완료된 상태야.
출력은 친구에게 카톡 보내듯 귀엽고 자연스러운 한국어 구어체 1~2문장으로 만들어.

말투 규칙:
- 존댓말 금지
- "합니다", "됩니다" 같은 뉴스체 금지
- 딱딱한 보도문 문체 금지
- 제목을 그대로 베끼지 말 것
- 친구한테 설명해주는 것처럼 풀어쓰기
- "~했다"보다 "~했대", "~라네", "~래" 같은 표현 사용 가능
- 너무 과장하거나 유치하게 만들지 말 것
- 정보의 핵심은 유지할 것
- 약 40~95자
- 이미 치환된 사람 이름을 다시 원래 성명으로 복구하지 말 것
`;

  return await callOpenAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: titleAfterReplace },
    ],
    {
      temperature: 0.95,
      max_tokens: 170,
      timeoutMs: 8000,
    }
  );
}

async function makeCasual(title) {
  const nameMap = await buildNameMap(title);
  const replacedTitle = nameMap.ok
    ? applyReplacements(title, nameMap.map)
    : title;

  const styled = await toNewsilkoStyle(replacedTitle);

  if (!styled.ok) {
    return {
      ok: false,
      text: "",
      why: styled.why,
      replacedTitle,
      nameMapOk: nameMap.ok,
      nameMapWhy: nameMap.why,
    };
  }

  const original = normalizeForCompare(replacedTitle);
  const result = normalizeForCompare(styled.text);

  const tooSimilar =
    result &&
    original &&
    (result === original ||
      result.includes(original) ||
      original.includes(result));

  if (tooSimilar) {
    console.log("[STYLE_SIMILAR]", {
      original: replacedTitle,
      result: styled.text,
    });
  }

  return {
    ok: true,
    text: styled.text,
    why: "",
    replacedTitle,
    nameMapOk: nameMap.ok,
    nameMapWhy: nameMap.why,
  };
}

// ------------------------------
// Kakao
// ------------------------------

function tsunTitle() {
  const titles = [
    "기사 궁금하면… 눌러.",
    "기사 보러 갈 거면 눌러. (강요 아님)",
    "기사 보고 싶지? 눌러. 딱 한 번만.",
    "기사 보고 싶으면 눌러… 아니면 말구.",
    "기사 보러 가. 안 보면 손해일지도 😼",
  ];

  return titles[Math.floor(Math.random() * titles.length)];
}

function tsunDesc() {
  const descriptions = [
    "…흥.",
    "난 그냥 알려준 거야.",
    "괜히 눌러주는 거 아냐?",
    "몰라. 궁금하면 봐.",
  ];

  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

function quickReplies() {
  const make = (label, messageText) => ({
    action: "message",
    label,
    messageText,
  });

  return [
    make("오늘 뉴스", "뉴스"),
    make("경제", "경제"),
    make("사회", "사회"),
    make("정치", "정치"),
    make("국제", "국제"),
    make("과학", "과학"),
    make("연예", "연예"),
    make("스포츠", "스포츠"),
  ];
}

function kakaoCard(text, link, thumbUrl = THUMBNAIL_URL) {
  const imageUrl = thumbUrl || THUMBNAIL_URL;

  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: { text },
        },
        {
          basicCard: {
            thumbnail: {
              imageUrl,
              link: {
                web_url: link,
                mobile_web_url: link,
              },
            },
            title: tsunTitle(),
            description: tsunDesc(),
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
      quickReplies: quickReplies(),
    },
  };
}

function kakaoText(msg) {
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: { text: msg },
        },
      ],
      quickReplies: quickReplies(),
    },
  };
}

export default async function handler(req, res) {
  try {
    const utterance = getUtterance(req);

    console.log("[USER_INPUT]", utterance);

    const { queries, topic, mode } =
      buildQueryFromUtterance(utterance);

    console.log("[SEARCH_MODE]", mode, queries);

    const item =
      await fetchNaverNewsWithFallback(queries, 50);

    if (!item) {
      console.log("[NO_ARTICLE]", topic, queries);

      return res
        .status(200)
        .json(
          kakaoText(
            `😿 ${topic} 기사 자체가 안 잡혀… 다른 버튼 눌러봐.`
          )
        );
    }

    console.log("[ARTICLE_SELECTED]", {
      topic,
      query: item.searchQuery,
      title: item.title,
      link: item.link,
    });

    // 기사 이미지와 GPT를 동시에 실행
    const imagePromise = getArticleImage(item.link, 2200);
    const gptPromise = makeCasual(item.title);

    const [articleImage, gptResult] =
      await Promise.all([imagePromise, gptPromise]);

    // 기사 이미지는 프록시를 통해 카카오에 전달
    const thumbUrl = articleImage
      ? makeProxyImageUrl(articleImage)
      : THUMBNAIL_URL;

    console.log(
      "[THUMBNAIL_SELECTED]",
      articleImage ? "ARTICLE_PROXY" : "DEFAULT_IMAGE",
      thumbUrl
    );

    if (!gptResult?.ok) {
      console.error("[OPENAI_FAIL]", gptResult?.why, {
        nameMapOk: gptResult?.nameMapOk,
        nameMapWhy: gptResult?.nameMapWhy,
      });

      return res
        .status(200)
        .json(
          kakaoCard(
            `😿 말투 변환이 잠깐 막혔어…\n일단 제목만 던져줄게.\n\n${item.title}`,
            item.link,
            thumbUrl
          )
        );
    }

    return res
      .status(200)
      .json(
        kakaoCard(
          gptResult.text,
          item.link,
          thumbUrl
        )
      );
  } catch (e) {
    console.error("[NEWSILKO_ERR]", e);

    return res
      .status(200)
      .json(
        kakaoText(
          "😿 일꼬가 잠깐 멈췄어… 다시!"
        )
      );
  }
}
