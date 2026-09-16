// api/newsilko.js
//
// 뉴스일꼬
// 1) 뉴스/속보 -> 최신 기사 검색
// 2) 카테고리 -> 여러 검색어를 순서대로 시도
// 3) 오늘(KST) 기사 우선 -> 최근 24시간 -> 최신 기사 fallback
// 4) GPT 2단계: 인명 치환 -> 뉴스일꼬 말투 변환
// 5) 기사 페이지 대표 이미지(og:image 등)를 썸네일로 사용
// 6) 기사 이미지를 못 찾으면 뉴스일꼬 기본 썸네일 사용
// 7) Kakao basicCard + 기사보기 + quickReplies


// ==================================================
// 기본 썸네일
// ==================================================

const THUMBNAIL_URL =
  "https://newsilko.vercel.app/newsilko-thumbnail.png";


// ==================================================
// UTIL
// ==================================================

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .trim();
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
  return decodeEntities(stripHtml(s))
    .replace(/\s+/g, " ")
    .trim();
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
    .filter(
      ([k, v]) =>
        typeof k === "string" &&
        typeof v === "string" &&
        k &&
        v &&
        k !== v
    )
    .sort((a, b) => b[0].length - a[0].length);

  for (const [from, to] of entries) {
    const re = new RegExp(escapeRegExp(from), "g");
    out = out.replace(re, to);
  }

  return out;
}


function normalizeIntent(s) {
  return clean(s)
    .replace(/\s+/g, "")
    .toLowerCase();
}


// ==================================================
// 오늘 날짜 판별 (KST)
// ==================================================

function isTodayKST(pubDateStr) {
  if (!pubDateStr) {
    return false;
  }

  const d = new Date(pubDateStr);

  if (Number.isNaN(d.getTime())) {
    return false;
  }

  const kstOffsetMs = 9 * 60 * 60 * 1000;

  const now = new Date();

  const nowKST =
    new Date(
      now.getTime() + kstOffsetMs
    );

  const startKST =
    new Date(nowKST);

  startKST.setHours(
    0,
    0,
    0,
    0
  );

  const endKST =
    new Date(startKST);

  endKST.setDate(
    endKST.getDate() + 1
  );

  const articleKST =
    new Date(
      d.getTime() + kstOffsetMs
    );

  return (
    articleKST >= startKST &&
    articleKST < endKST
  );
}


// ==================================================
// 검색어 라우터
// ==================================================

function buildQueryFromUtterance(utterance) {
  const u =
    normalizeIntent(utterance);


  const isGeneral =
    !u ||
    u === "뉴스" ||
    u === "속보" ||
    u === "최신" ||
    u === "랜덤" ||
    u === "아무거나";


  if (isGeneral) {
    return {
      queries: [
        "속보",
        "뉴스",
      ],
      topic: "뉴스",
      mode: "general",
    };
  }


  const categoryMap = {

    경제: {
      queries: [
        "경제",
        "증시",
        "코스피",
        "코스닥",
        "금리",
        "환율",
        "물가",
        "부동산",
        "반도체",
      ],

      aliases: [
        "경제",
        "주식",
        "증시",
        "코스피",
        "코스닥",
        "환율",
        "금리",
        "물가",
        "부동산",
      ],
    },


    사회: {
      queries: [
        "사회",
        "사건 사고",
        "경찰",
        "법원",
        "교육",
        "노동",
        "의료",
        "재난",
      ],

      aliases: [
        "사회",
        "사건",
        "사고",
        "재난",
        "경찰",
        "법원",
        "교육",
        "노동",
        "복지",
        "의료",
      ],
    },


    정치: {
      queries: [
        "정치",
        "국회",
        "대통령실",
        "여야",
        "정당",
        "법안",
        "외교",
      ],

      aliases: [
        "정치",
        "국회",
        "대통령",
        "대통령실",
        "여야",
        "선거",
        "정당",
        "외교",
      ],
    },


    국제: {
      queries: [
        "국제",
        "해외",
        "미국",
        "중국",
        "일본",
        "유럽",
        "우크라이나",
        "중동",
      ],

      aliases: [
        "국제",
        "해외",
        "미국",
        "중국",
        "일본",
        "유럽",
        "우크라이나",
        "중동",
      ],
    },


    과학: {
      queries: [
        "과학",
        "인공지능",
        "AI",
        "기술",
        "우주",
        "연구",
        "반도체 기술",
      ],

      aliases: [
        "과학",
        "기술",
        "ai",
        "인공지능",
        "반도체",
        "우주",
        "연구",
        "논문",
      ],
    },


    연예: {
      queries: [
        "연예",
        "아이돌",
        "배우",
        "가수",
        "드라마",
        "영화",
      ],

      aliases: [
        "연예",
        "셀럽",
        "아이돌",
        "배우",
        "가수",
        "드라마",
        "영화",
        "열애",
      ],
    },


    스포츠: {
      queries: [
        "스포츠",
        "아시안게임",
        "국가대표",
        "축구",
        "야구",
        "농구",
        "배구",
        "e스포츠",
      ],

      aliases: [
        "스포츠",
        "축구",
        "야구",
        "농구",
        "배구",
        "e스포츠",
        "이스포츠",
        "국가대표",
        "아시안게임",
      ],
    },

  };


  for (
    const [cat, cfg]
    of Object.entries(categoryMap)
  ) {

    if (
      cfg.aliases.some(
        (word) => u.includes(word)
      )
    ) {

      return {
        queries: cfg.queries,
        topic: cat,
        mode: `category:${cat}`,
      };

    }

  }


  // 자유 검색
  // 예: 삼성전자 / 나고야 / 특정 인물
  return {
    queries: [
      clean(utterance)
    ],
    topic: "검색",
    mode: "free",
  };
}


// ==================================================
// NAVER NEWS API
// ==================================================

async function fetchNaverNews(
  query,
  display = 50
) {

  const url =
    "https://openapi.naver.com/v1/search/news.json?" +
    new URLSearchParams({

      query,

      display:
        String(display),

      sort:
        "date",

    }).toString();


  const response =
    await fetch(url, {

      headers: {

        "X-Naver-Client-Id":
          process.env.NAVER_CLIENT_ID || "",

        "X-Naver-Client-Secret":
          process.env.NAVER_CLIENT_SECRET || "",

      },

    });


  if (!response.ok) {

    const body =
      await response
        .text()
        .catch(() => "");

    throw new Error(
      `Naver ${response.status}: ${body.slice(0, 200)}`
    );

  }


  const data =
    await response
      .json()
      .catch(() => ({}));


  const items =
    Array.isArray(data?.items)
      ? data.items
      : [];


  if (!items.length) {
    return null;
  }


  const pickRandom =
    (arr) =>
      arr[
        Math.floor(
          Math.random() *
          arr.length
        )
      ];


  function formatItem(item) {

    // 가능하면 언론사 원문 링크 사용
    const link =
      item?.originallink ||
      item?.link ||
      "";


    return {

      title:
        clean(item?.title),

      link,

      pubDate:
        item?.pubDate,

      searchQuery:
        query,

    };

  }


  // ---------------------------------
  // 1. 오늘 기사
  // ---------------------------------

  const todayItems =
    items.filter(
      (item) =>
        isTodayKST(item?.pubDate)
    );


  if (todayItems.length) {

    return formatItem(
      pickRandom(todayItems)
    );

  }


  // ---------------------------------
  // 2. 최근 24시간
  // ---------------------------------

  const nowMs =
    Date.now();


  const DAY =
    24 *
    60 *
    60 *
    1000;


  const last24h =
    items.filter(
      (item) => {

        const d =
          new Date(
            item?.pubDate
          );


        if (
          Number.isNaN(
            d.getTime()
          )
        ) {

          return false;

        }


        const age =
          nowMs -
          d.getTime();


        return (
          age >= 0 &&
          age <= DAY
        );

      }
    );


  if (last24h.length) {

    return formatItem(
      pickRandom(last24h)
    );

  }


  // ---------------------------------
  // 3. 그냥 최신 목록 랜덤
  // ---------------------------------

  return formatItem(
    pickRandom(items)
  );

}


// ==================================================
// 여러 검색어 순차 fallback
// ==================================================

async function fetchNaverNewsWithFallback(
  queries,
  display = 50
) {

  const queryList =
    Array.isArray(queries)
      ? queries
      : [queries];


  for (
    const query
    of queryList
  ) {

    if (!query) {
      continue;
    }


    try {

      console.log(
        "[NAVER_SEARCH_TRY]",
        query
      );


      const item =
        await fetchNaverNews(
          query,
          display
        );


      if (item) {

        console.log(
          "[NAVER_SEARCH_OK]",
          query,
          item.title
        );


        return item;

      }


      console.log(
        "[NAVER_SEARCH_EMPTY]",
        query
      );


    } catch (e) {

      console.error(
        "[NAVER_SEARCH_FAIL]",
        query,
        String(e)
      );

    }

  }


  return null;
}


// ==================================================
// 기사 대표 이미지 추출
// ==================================================

async function getArticleImage(
  articleUrl,
  timeoutMs = 1000
) {

  if (
    !articleUrl ||
    typeof articleUrl !== "string"
  ) {

    return null;

  }


  let parsedArticleUrl;


  try {

    parsedArticleUrl =
      new URL(articleUrl);


    if (
      parsedArticleUrl.protocol !== "http:" &&
      parsedArticleUrl.protocol !== "https:"
    ) {

      return null;

    }

  } catch {

    return null;

  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );


  try {

    const response =
      await fetch(
        articleUrl,
        {

          signal:
            controller.signal,

          redirect:
            "follow",

          headers: {

            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",

            Accept:
              "text/html,application/xhtml+xml",

          },

        }
      );


    if (!response.ok) {

      console.log(
        "[ARTICLE_FETCH_FAIL]",
        response.status,
        articleUrl
      );


      return null;

    }


    const html =
      await response
        .text()
        .catch(() => "");


    if (!html) {
      return null;
    }


    // ---------------------------------
    // 이미지 URL 정리
    // ---------------------------------

    const normalizeImageUrl =
      (rawUrl) => {

        if (!rawUrl) {
          return null;
        }


        let value =
          decodeEntities(
            String(rawUrl)
              .trim()
          );


        // data:image 제외
        if (
          value.startsWith(
            "data:"
          )
        ) {

          return null;

        }


        try {

          // 상대경로 이미지도 절대경로로 변환
          const imageUrl =
            new URL(
              value,
              articleUrl
            );


          if (
            imageUrl.protocol !==
              "http:" &&
            imageUrl.protocol !==
              "https:"
          ) {

            return null;

          }


          return imageUrl.href;


        } catch {

          return null;

        }

      };


    // ---------------------------------
    // 1. og:image
    // ---------------------------------

    const metaPatterns = [

      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,

      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,

      /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,

      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:url["']/i,


      // ---------------------------------
      // 2. twitter:image
      // ---------------------------------

      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,

      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,

      /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i,

      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image:src["']/i,

    ];


    for (
      const pattern
      of metaPatterns
    ) {

      const match =
        html.match(pattern);


      if (
        match &&
        match[1]
      ) {

        const imageUrl =
          normalizeImageUrl(
            match[1]
          );


        if (imageUrl) {

          console.log(
            "[ARTICLE_IMAGE_META]",
            imageUrl
          );


          return imageUrl;

        }

      }

    }


    // ---------------------------------
    // 3. 본문 img fallback
    // ---------------------------------

    // src / data-src / data-original 등
    // 일반적인 lazy loading 방식도 찾는다.

    const imgTagRegex =
      /<img\b[^>]*>/gi;


    const imgTags =
      html.match(
        imgTagRegex
      ) || [];


    for (
      const tag
      of imgTags
    ) {

      // 광고 / 로고 등으로 보이는 태그 제외
      if (
        /logo|icon|banner|advert|advertisement|sprite|avatar|profile|tracking|pixel/i.test(
          tag
        )
      ) {

        continue;

      }


      const attrPatterns = [

        /\bsrc=["']([^"']+)["']/i,

        /\bdata-src=["']([^"']+)["']/i,

        /\bdata-original=["']([^"']+)["']/i,

        /\bdata-lazy-src=["']([^"']+)["']/i,

      ];


      for (
        const attrPattern
        of attrPatterns
      ) {

        const match =
          tag.match(
            attrPattern
          );


        if (
          !match ||
          !match[1]
        ) {

          continue;

        }


        const candidate =
          match[1];


        // 작은 아이콘/광고 이미지로 보이는 URL 제외
        if (
          /logo|icon|banner|advert|sprite|avatar|profile|pixel|favicon/i.test(
            candidate
          )
        ) {

          continue;

        }


        const imageUrl =
          normalizeImageUrl(
            candidate
          );


        if (imageUrl) {

          console.log(
            "[ARTICLE_IMAGE_IMG]",
            imageUrl
          );


          return imageUrl;

        }

      }

    }


    console.log(
      "[ARTICLE_IMAGE_NONE]",
      articleUrl
    );


    return null;


  } catch (e) {

    if (
      String(e?.name) ===
      "AbortError"
    ) {

      console.log(
        "[ARTICLE_IMAGE_TIMEOUT]",
        articleUrl
      );


      return null;

    }


    console.log(
      "[ARTICLE_IMAGE_ERROR]",
      String(e)
    );


    return null;


  } finally {

    clearTimeout(timer);

  }

}


// ==================================================
// OPENAI BASE
// ==================================================

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
  {
    temperature = 0.4,
    max_tokens = 220,
    timeoutMs = 8000,
  } = {}
) {

  const key =
    process.env.OPENAI_API_KEY || "";


  if (!key) {

    return {

      ok: false,

      text: "",

      why:
        "OPENAI_API_KEY 없음",

    };

  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );


  try {

    const response =
      await fetch(
        "https://api.openai.com/v1/chat/completions",
        {

          method:
            "POST",

          signal:
            controller.signal,

          headers: {

            Authorization:
              `Bearer ${key}`,

            "Content-Type":
              "application/json",

          },

          body:
            JSON.stringify({

              model:
                "gpt-4o-mini",

              temperature,

              max_tokens,

              messages,

            }),

        }
      );


    if (!response.ok) {

      const body =
        await response
          .text()
          .catch(() => "");


      return {

        ok: false,

        text: "",

        why:
          `OpenAI ${response.status}: ${body.slice(0, 200)}`,

      };

    }


    const data =
      await response
        .json()
        .catch(() => ({}));


    const output =
      clean(
        data?.choices?.[0]?.message?.content ||
        ""
      );


    if (!output) {

      return {

        ok: false,

        text: "",

        why:
          "OpenAI 응답 비었음",

      };

    }


    return {

      ok: true,

      text:
        output,

      why: "",

    };


  } catch (e) {

    if (
      String(e?.name) ===
      "AbortError"
    ) {

      return {

        ok: false,

        text: "",

        why:
          `OpenAI 타임아웃(${timeoutMs}ms)`,

      };

    }


    return {

      ok: false,

      text: "",

      why:
        `OpenAI 호출 오류: ${String(e).slice(0, 200)}`,

    };


  } finally {

    clearTimeout(timer);

  }

}


// ==================================================
// GPT #1
// 인명 치환
// ==================================================

async function buildNameMap(title) {

  const systemPrompt = `
너는 한국어 뉴스 제목에서
"사람 이름(인명)"만 찾아
치환 맵을 만드는 도구야.

출력은 JSON 하나만.
다른 말 절대 금지.

규칙:

- 입력 제목에 등장하는 사람 이름만 대상으로 한다.
- 기관명, 지명, 브랜드, 단체는 제외한다.

- 한국인 이름이 성+이름으로 나오면
  성을 제거하고 이름만 남긴다.

- 이름 끝 글자에 받침이 있으면
  "이"를 붙인다.

- 받침이 없으면 붙이지 않는다.

예:

윤석열 -> 석열이
문재인 -> 재인이
이재명 -> 재명이
김찬희 -> 찬희
박지우 -> 지우
유진 -> 유진이

- 직책/호칭이 붙은 표현도
  같은 사람이라면 함께 매핑한다.

예:

"윤 대통령"
"문 전 대통령"
"이 대표"

치환 대상이 없으면

{}

만 출력한다.

JSON 형식:

{
  "원문표현1": "치환표현1",
  "원문표현2": "치환표현2"
}
`;


  const result =
    await callOpenAI(

      [

        {
          role:
            "system",

          content:
            systemPrompt,
        },

        {
          role:
            "user",

          content:
            title,
        },

      ],

      {

        temperature:
          0.2,

        max_tokens:
          260,

        timeoutMs:
          8000,

      }

    );


  if (!result.ok) {

    return {

      ok: false,

      map: {},

      why:
        result.why,

    };

  }


  try {

    // ```json 블록이 붙어도 처리
    const jsonText =
      result.text
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/i,
          ""
        )
        .replace(
          /```$/i,
          ""
        )
        .trim();


    const obj =
      JSON.parse(
        jsonText
      );


    if (
      !obj ||
      typeof obj !== "object" ||
      Array.isArray(obj)
    ) {

      return {

        ok: false,

        map: {},

        why:
          "인명맵 JSON 형식이 아님",

      };

    }


    const map = {};


    for (
      const [key, value]
      of Object.entries(obj)
    ) {

      if (
        typeof key === "string" &&
        typeof value === "string" &&
        key.trim() &&
        value.trim()
      ) {

        map[
          key.trim()
        ] =
          value.trim();

      }

    }


    return {

      ok: true,

      map,

      why: "",

    };


  } catch (e) {

    return {

      ok: false,

      map: {},

      why:
        `인명맵 JSON 파싱 실패: ${String(e).slice(0, 120)}`,

    };

  }

}


// ==================================================
// GPT #2
// 뉴스일꼬 말투 변환
// ==================================================

async function toNewsilkoStyle(
  titleAfterReplace
) {

  const systemPrompt = `
너는 "뉴스일꼬"라는 츤데레 고양이야 🐱

입력은 뉴스 제목이고,
인명 치환은 이미 완료된 상태야.

출력은 친구에게 카톡 보내듯
귀엽고 자연스러운 한국어 구어체
1~2문장으로 만들어.

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

      {
        role:
          "system",

        content:
          systemPrompt,
      },

      {
        role:
          "user",

        content:
          titleAfterReplace,
      },

    ],

    {

      temperature:
        0.95,

      max_tokens:
        170,

      timeoutMs:
        8000,

    }

  );

}


// ==================================================
// 뉴스일꼬 문장 만들기
// ==================================================

async function makeCasual(title) {

  // 1. 인명 변환
  const nameMap =
    await buildNameMap(
      title
    );


  const replacedTitle =
    nameMap.ok

      ? applyReplacements(
          title,
          nameMap.map
        )

      : title;


  // 2. 뉴스일꼬 말투
  const styled =
    await toNewsilkoStyle(
      replacedTitle
    );


  if (!styled.ok) {

    return {

      ok: false,

      text: "",

      why:
        styled.why,

      replacedTitle,

      nameMapOk:
        nameMap.ok,

      nameMapWhy:
        nameMap.why,

    };

  }


  const original =
    normalizeForCompare(
      replacedTitle
    );


  const result =
    normalizeForCompare(
      styled.text
    );


  const tooSimilar =
    result &&
    original &&
    (
      result === original ||
      result.includes(original) ||
      original.includes(result)
    );


  if (tooSimilar) {

    console.log(
      "[STYLE_SIMILAR]",
      {
        original:
          replacedTitle,

        result:
          styled.text,
      }
    );

  }


  return {

    ok: true,

    text:
      styled.text,

    why: "",

    replacedTitle,

    nameMapOk:
      nameMap.ok,

    nameMapWhy:
      nameMap.why,

  };

}


// ==================================================
// KAKAO
// ==================================================

function tsunTitle() {

  const titles = [

    "기사 궁금하면… 눌러.",

    "기사 보러 갈 거면 눌러. (강요 아님)",

    "기사 보고 싶지? 눌러. 딱 한 번만.",

    "기사 보고 싶으면 눌러… 아니면 말구.",

    "기사 보러 가. 안 보면 손해일지도 😼",

  ];


  return titles[
    Math.floor(
      Math.random() *
      titles.length
    )
  ];

}


function tsunDesc() {

  const descriptions = [

    "…흥.",

    "난 그냥 알려준 거야.",

    "괜히 눌러주는 거 아냐?",

    "몰라. 궁금하면 봐.",

  ];


  return descriptions[
    Math.floor(
      Math.random() *
      descriptions.length
    )
  ];

}


function quickReplies() {

  const make =
    (
      label,
      messageText
    ) => ({

      action:
        "message",

      label,

      messageText,

    });


  return [

    make(
      "오늘 뉴스",
      "뉴스"
    ),

    make(
      "경제",
      "경제"
    ),

    make(
      "사회",
      "사회"
    ),

    make(
      "정치",
      "정치"
    ),

    make(
      "국제",
      "국제"
    ),

    make(
      "과학",
      "과학"
    ),

    make(
      "연예",
      "연예"
    ),

    make(
      "스포츠",
      "스포츠"
    ),

  ];

}


function kakaoCard(
  text,
  link,
  thumbUrl = THUMBNAIL_URL
) {

  const imageUrl =
    thumbUrl ||
    THUMBNAIL_URL;


  return {

    version:
      "2.0",

    template: {

      outputs: [

        {
          simpleText: {

            text,

          },
        },


        {
          basicCard: {

            thumbnail: {

              imageUrl,

              link: {

                web_url:
                  link,

                mobile_web_url:
                  link,

              },

            },


            title:
              tsunTitle(),


            description:
              tsunDesc(),


            buttons: [

              {

                action:
                  "webLink",

                label:
                  "기사보기",

                webLinkUrl:
                  link,

              },

            ],

          },
        },

      ],


      quickReplies:
        quickReplies(),

    },

  };

}


function kakaoText(msg) {

  return {

    version:
      "2.0",

    template: {

      outputs: [

        {

          simpleText: {

            text:
              msg,

          },

        },

      ],


      quickReplies:
        quickReplies(),

    },

  };

}


// ==================================================
// HANDLER
// ==================================================

export default async function handler(
  req,
  res
) {

  try {

    // ---------------------------------
    // 사용자 입력
    // ---------------------------------

    const utterance =
      getUtterance(req);


    console.log(
      "[USER_INPUT]",
      utterance
    );


    const {
      queries,
      topic,
      mode,
    } =
      buildQueryFromUtterance(
        utterance
      );


    console.log(
      "[SEARCH_MODE]",
      mode,
      queries
    );


    // ---------------------------------
    // 뉴스 검색
    // ---------------------------------

    const item =
      await fetchNaverNewsWithFallback(
        queries,
        50
      );


    if (!item) {

      console.log(
        "[NO_ARTICLE]",
        topic,
        queries
      );


      return res
        .status(200)
        .json(

          kakaoText(
            `😿 ${topic} 기사 자체가 안 잡혀… 다른 버튼 눌러봐.`
          )

        );

    }


    console.log(
      "[ARTICLE_SELECTED]",
      {

        topic,

        query:
          item.searchQuery,

        title:
          item.title,

        link:
          item.link,

      }
    );


    // ---------------------------------
    // 기사 이미지 + GPT 동시에 실행
    // ---------------------------------

    const imagePromise =
      getArticleImage(
        item.link,
        1000
      );


    const gptPromise =
      makeCasual(
        item.title
      );


    const [
      articleImage,
      gptResult,
    ] =
      await Promise.all([
        imagePromise,
        gptPromise,
      ]);


    // 기사 이미지를 찾으면 기사 사진
    // 못 찾으면 뉴스일꼬 기본 이미지
    const thumbUrl =
      articleImage ||
      THUMBNAIL_URL;


    console.log(
      "[THUMBNAIL_SELECTED]",
      articleImage
        ? "ARTICLE_IMAGE"
        : "DEFAULT_IMAGE",
      thumbUrl
    );


    // ---------------------------------
    // GPT 실패
    // ---------------------------------

    if (!gptResult?.ok) {

      console.error(
        "[OPENAI_FAIL]",
        gptResult?.why,
        {

          nameMapOk:
            gptResult?.nameMapOk,

          nameMapWhy:
            gptResult?.nameMapWhy,

        }
      );


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


    // ---------------------------------
    // 정상 응답
    // ---------------------------------

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

    console.error(
      "[NEWSILKO_ERR]",
      e
    );


    return res
      .status(200)
      .json(

        kakaoText(
          "😿 일꼬가 잠깐 멈췄어… 다시!"
        )

      );

  }

}
