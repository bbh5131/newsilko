export default function handler(req, res) {
  return res.status(200).json({
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text: "뉴스일꼬 연결 테스트 성공!"
          }
        }
      ]
    }
  });
}
