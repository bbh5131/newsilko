// api/newsilko.js

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function fetchNaver() {
  const url =
    "https://openapi.naver.com/v1/search/news.json?query=속보&display=1&sort=date";

  const r = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
    },
  });

  const j = await r.json();
  return j.items?.[0];
}

async function makeCasual(title) {
  const prompt = `
너는 "뉴스일꼬"라는 고양이야.
뉴스 제목을 아주 자연스러운 한국어 구어체로 바꿔줘.

조건:
- 친구한테 말하듯
- 어려운 단어 쓰지 말기
- "(정치)" 같은 분류 제거
- 기자 이름 제거
- "래!!" 이런 거 쓰지 말기
- 문장 하나로 요약

원문:
${title}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return res.choices[0].message.content.trim();
}

export default async function handler(req, res) {
  try {
    const item = await fetchNaver();
    if (!item) throw "뉴스 없음";

    const title = clean(item.title);
    const link = item.link;

    const casual = await makeCasual(title);

    return res.status(200).json({
      version: "2.0",
      template: {
        outputs: [
          {
            basicCard: {
              title: "🐱 오늘 뉴스 한 줄",
              description: casual,
              buttons: [
                {
                  action: "webLink",
                  label: "기사 보러 가기",
                  webLinkUrl: link,
                },
              ],
              thumbnail: {
                imageUrl:
                  "https://raw.githubusercontent.com/bbh5131/newsilko/main/public/cat.png",
              },
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
              text: "😿 오늘 뉴스 못 가져왔어… 잠깐만 기다려줘",
            },
          },
        ],
      },
    });
  }
}
