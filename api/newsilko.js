export default function handler(req, res) {
  res.status(200).json({
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text: "🐱 뉴스일꼬 테스트 성공! 이제 진짜 뉴스 가져오면 된다냥."
          }
        }
      ]
    }
  });
}
