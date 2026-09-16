// api/newsilko.js
//
// 뉴스일꼬
// 1) 뉴스/속보 -> 최신 기사 검색
// 2) 카테고리 -> 여러 검색어를 순서대로 시도
// 3) 오늘(KST) 기사 우선 -> 최근 24시간 -> 최신 기사 fallback
// 4) GPT 2단계: 인명 치환 -> 뉴스일꼬 말투 변환
// 5) Kakao basicCard + 기사보기 + quickReplies
// 6) 기사 og:image 수집 제거: 응답 안정성 우선

// --------------------------------------------------
// 썸네일
// --------------------------------------------------
//
// 나중에 public/newsilko-thumbnail.png를 올리면
// 아래 주소로 변경하면 됨.
//
// const THUMBNAIL_URL =
//   "https://newsilko.vercel.app/newsilko-thumbnail.png";
//
// 일단 기존 이미지 유지
//
const THUMBNAIL_URL =
  "https://upload.wikimedia.org/wikipedia/commons/7/7e/CatB4SVG.png";


// --------------------------------------------------
// UTIL
// --------------------------------------------------

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


// --------------------------------------------------
// 오늘 날짜 판별 (KST)
// --------------------------------------------------

function isTodayKST(pubDateStr) {
  if (!pubDateStr) return false;

  const d = new Date(pubDateStr);

  if (Number.isNaN(d.getTime())) {
    return false;
  }

  const kstOffsetMs = 9 * 60 * 60 * 1000;

  const now = new Date();
  const nowKST = new Date(now.getTime() + kstOffsetMs);

  const startKST = new Date(nowKST);
  startKST.setHours(0, 0, 0, 0);

  const endKST = new Date(startKST);
  endKST.setDate(endKST.getDate() + 1);

  const dKST = new Date(d.getTime() + kstOffsetMs);

  return dKST >= startKST && dKST < endKST;
}


// --------------------------------------------------
// 검색어 라우터
// --------------------------------------------------

function buildQueryFromUtterance(utterance) {
  const u = normalizeIntent(utterance);

  const isGeneral =
    !u ||
    u === "뉴스" ||
    u === "속보" ||
    u === "최신" ||
    u === "랜덤" ||
    u === "아무거나";


  // 일반 뉴스
  if (isGeneral) {
    return {
      queries: [
        "속보",
        "뉴스"
      ],
      mode: "general",
      topic: "뉴스",
    };
  }


  // 카테고리
  //
  // 네이버 뉴스 API에
  // "스포츠 (축구 OR 야구 ...)"
  // 같은 검색문을 넣지 않고,
  // 검색어를 하나씩 시도한다.
  //
  const categoryMap = {

    경제: {
      queries: [
        "경제",
        "증시",
        "코스피",
        "코스닥",
        "금리",
        "환율",
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
        "부동산",
        "물가",
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


  for (const [cat, cfg] of Object.entries(categoryMap)) {

    if (cfg.aliases.some((word) => u.includes(word))) {

      return {
        queries: cfg.queries,
        mode: `category:${cat}`,
        topic: cat,
      };

    }
  }


  // 카테고리에 없는 자유 검색
  // 예: "삼성전자", "나고야", 특정 인물
  return {
    queries: [clean(utterance)],
    mode: "free",
    topic: "검색",
  };
}


// --------------------------------------------------
// NAVER NEWS API
// --------------------------------------------------

async function fetchNaverNews(query, display = 50) {

  const url =
    "https://openapi.naver.com/v1/search/news.json?" +
    new URLSearchParams({
      query,
      display: String(display),
      sort: "date",
    }).toString();


  const r = await fetch(url, {
    headers: {
      "X-Naver-Client-Id":
        process.env.NAVER_CLIENT_ID || "",

      "X-Naver-Client-Secret":
        process.env.NAVER_CLIENT_SECRET || "",
    },
  });


  if (!r.ok) {

    const body =
      await r.text().catch(() => "");

    throw new Error(
      `Naver ${r.status}: ${body.slice(0, 200)}`
    );

  }


  const j =
    await r.json().catch(() => ({}));


  const items =
    Array.isArray(j?.items)
      ? j.items
      : [];


  if (!items.length) {
    return null;
  }


  const pickFrom = (arr) =>
    arr[Math.floor(Math.random() * arr.length)];


  // ---------------------------
  // 1. 오늘 기사 우선
  // ---------------------------

  const todays =
    items.filter((item) =>
      isTodayKST(item?.pubDate)
    );


  if (todays.length) {

    const pick = pickFrom(todays);

    return {
      title: clean(pick.title),
      link: pick.link,
      pubDate: pick.pubDate,
      searchQuery: query,
    };

  }


  // ---------------------------
  // 2. 최근 24시간
  // ---------------------------

  const nowMs = Date.now();
  const DAY =
    24 * 60 * 60 * 1000;


  const last24h =
    items.filter((item) => {

      const d =
        new Date(item?.pubDate);

      if (Number.isNaN(d.getTime())) {
        return false;
      }

      return (
        nowMs - d.getTime() <= DAY
      );

    });


  if (last24h.length) {

    const pick = pickFrom(last24h);

    return {
      title: clean(pick.title),
      link: pick.link,
      pubDate: pick.pubDate,
      searchQuery: query,
    };

  }


  // ---------------------------
  // 3. 최종 fallback
  // ---------------------------

  const pick = pickFrom(items);

  return {
    title: clean(pick.title),
    link: pick.link,
    pubDate: pick.pubDate,
    searchQuery: query,
  };
}


// --------------------------------------------------
// 여러 검색어 순차 fallback
// --------------------------------------------------

async function fetchNaverNewsWithFallback(
  queries,
  display = 50
) {

  const queryList =
    Array.isArray(queries)
      ? queries
      : [queries];


  for (const query of queryList) {

    if (!query) continue;


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


// --------------------------------------------------
// OPENAI
// --------------------------------------------------

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
      why: "OPENAI_API_KEY 없음",
    };

  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );


  try {

    const r = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",

        signal:
          controller.signal,

        headers: {

          Authorization:
            `Bearer ${key}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({

          model:
            "gpt-4o-mini",

          temperature,

          max_tokens,

          messages,
        }),
      }
    );


    if (!r.ok) {

      const body =
        await r.text().catch(() => "");

      return {
        ok: false,
        text: "",
        why:
          `OpenAI ${r.status}: ${body.slice(0, 200)}`,
      };

    }


    const j =
      await r.json().catch(() => ({}));


    const out =
      clean(
        j?.choices?.[0]?.message?.content ||
        ""
      );


    if (!out) {

      return {
        ok: false,
        text: "",
        why:
          "OpenAI 응답 비었음",
      };

    }


    return {
      ok: true,
      text: out,
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


// --------------------------------------------------
// GPT #1
// 인명 치환 맵 생성
// --------------------------------------------------

async function buildNameMap(title) {

  const sys = `
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

- 직책이나 호칭이 붙은 형태도
  함께 매핑한다.

예:

"윤 대통령"
"문 전 대통령"
"이 대표"

등이 제목에 있으면
같은 이름으로 치환한다.

치환할 인물이 없으면:

{}

만 출력한다.

JSON 형식:

{
  "원문표현1": "치환표현1",
  "원문표현2": "치환표현2"
}
`;


  const r =
    await callOpenAI(

      [
        {
          role: "system",
          content: sys,
        },

        {
          role: "user",
          content: title,
        },
      ],

      {
        temperature: 0.2,
        max_tokens: 260,
        timeoutMs: 8000,
      }

    );


  if (!r.ok) {

    return {
      ok: false,
      map: {},
      why: r.why,
    };

  }


  try {

    // 가끔 ```json ... ``` 형태로 오는 경우 대비
    const jsonText =
      r.text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();


    const obj =
      JSON.parse(jsonText);


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
      const [k, v]
      of Object.entries(obj)
    ) {

      if (
        typeof k === "string" &&
        typeof v === "string" &&
        k.trim() &&
        v.trim()
      ) {

        map[k.trim()] =
          v.trim();

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


// --------------------------------------------------
// GPT #2
// 뉴스일꼬 말투
// --------------------------------------------------

async function toNewsilkoStyle(
  titleAfterReplace
) {

  const sys = `
너는 "뉴스일꼬"라는
츤데레 고양이야 🐱

입력은 뉴스 제목이고
이미 인명 치환이 완료된 상태야.

출력은 친구에게 카톡 보내듯
귀엽고 자연스러운 한국어 구어체
1~2문장으로 만들어.

말투 규칙:

- 존댓말 금지
- "합니다", "됩니다" 같은 말투 금지

- 딱딱한 뉴스체 금지

- 기자, 매체 등
  불필요한 뉴스 문체는 빼기

- "~했다"보다
  "~했대", "~라네", "~래"
  같은 자연스러운 말투 사용

- 너무 과장하지 말 것

- 약 40~95자

- 뉴스 제목을 그대로 복사하지 말고
  친구에게 설명하듯 풀어쓸 것

- 이미 치환된 사람 이름을
  다시 원래 성명으로 복구하면 안 됨
`;


  return await callOpenAI(

    [
      {
        role: "system",
        content: sys,
      },

      {
        role: "user",
        content: titleAfterReplace,
      },
    ],

    {
      temperature: 0.95,
      max_tokens: 170,
      timeoutMs: 8000,
    }

  );

}


// --------------------------------------------------
// 뉴스일꼬 문장 생성
// --------------------------------------------------

async function makeCasual(title) {

  // 1단계: 인명
  const nm =
    await buildNameMap(title);


  const replacedTitle =
    nm.ok
      ? applyReplacements(
          title,
          nm.map
        )
      : title;


  // 2단계: 말투
  const styled =
    await toNewsilkoStyle(
      replacedTitle
    );


  if (!styled.ok) {

    return {
      ok: false,
      text: "",
      why: styled.why,
      replacedTitle,
      nameMapOk: nm.ok,
      nameMapWhy: nm.why,
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


  // 예전에는 비슷하면 GPT를 한 번 더 호출했지만
  // 응답 지연 방지를 위해 추가 호출하지 않는다.
  //
  // 그래도 GPT가 만든 문장은 그대로 사용.
  //
  if (tooSimilar) {

    console.log(
      "[STYLE_SIMILAR]",
      replacedTitle,
      styled.text
    );

  }


  return {
    ok: true,
    text: styled.text,
    why: "",
    replacedTitle,
    nameMapOk: nm.ok,
    nameMapWhy: nm.why,
  };

}


// --------------------------------------------------
// KAKAO
// --------------------------------------------------

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

  const descs = [

    "…흥.",

    "난 그냥 알려준 거야.",

    "괜히 눌러주는 거 아냐?",

    "몰라. 궁금하면 봐.",

  ];


  return descs[
    Math.floor(
      Math.random() *
      descs.length
    )
  ];

}


function quickReplies() {

  const mk =
    (label, messageText) => ({

      action: "message",

      label,

      messageText,

    });


  return [

    mk(
      "오늘 뉴스",
      "뉴스"
    ),

    mk(
      "경제",
      "경제"
    ),

    mk(
      "사회",
      "사회"
    ),

    mk(
      "정치",
      "정치"
    ),

    mk(
      "국제",
      "국제"
    ),

    mk(
      "과학",
      "과학"
    ),

    mk(
      "연예",
      "연예"
    ),

    mk(
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

    version: "2.0",

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

    version: "2.0",

    template: {

      outputs: [

        {
          simpleText: {
            text: msg,
          },
        },

      ],


      quickReplies:
        quickReplies(),

    },

  };

}


// --------------------------------------------------
// HANDLER
// --------------------------------------------------

export default async function handler(
  req,
  res
) {

  try {

    const utter =
      getUtterance(req);


    console.log(
      "[USER_INPUT]",
      utter
    );


    const {
      queries,
      topic,
      mode,
    } =
      buildQueryFromUtterance(
        utter
      );


    console.log(
      "[SEARCH_MODE]",
      mode,
      queries
    );


    // 여러 검색어 중
    // 실제 기사 잡히는 검색어까지 진행
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
      }
    );


    // 기사 이미지 fetch 없음.
    // 바로 GPT 실행
    const g =
      await makeCasual(
        item.title
      );


    // GPT 실패하더라도
    // 챗봇 자체는 반드시 답변
    if (!g?.ok) {

      console.error(
        "[OPENAI_FAIL]",
        g?.why,
        {
          nameMapOk:
            g?.nameMapOk,

          nameMapWhy:
            g?.nameMapWhy,
        }
      );


      return res
        .status(200)
        .json(

          kakaoCard(

            `😿 말투 변환이 잠깐 막혔어…\n일단 제목만 던져줄게.\n\n${item.title}`,

            item.link,

            THUMBNAIL_URL

          )

        );

    }


    // 정상 응답
    return res
      .status(200)
      .json(

        kakaoCard(

          g.text,

          item.link,

          THUMBNAIL_URL

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
