// api/newsilko.js
export default function handler(req, res) {
  return res.status(200).json({
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text: "🐱 일꼬 살아났다. (서버 복구 완료) 이제 뉴스 붙이러 간다.",
          },
        },
        {
          basicCard: {
            thumbnail: {
              imageUrl:
                "https://upload.wikimedia.org/wikipedia/commons/7/7e/CatB4SVG.png",
            },
            title: "기사 보고 싶으면",
            description: "아직은 테스트 중이라 기사버튼은 다음 단계에서 붙일게 😼",
            buttons: [
              {
                action: "webLink",
                label: "일단 여기 눌러",
                webLinkUrl: "https://newsilko.vercel.app/",
              },
            ],
          },
        },
      ],
    },
  });
}
