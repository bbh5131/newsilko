// api/image-proxy.js
//
// 카카오가 언론사 이미지를 직접 불러오지 못하는 경우를 줄이기 위한
// 안전한 이미지 프록시.
//
// 주의:
// - http/https만 허용
// - localhost / private IP 차단
// - 리다이렉트도 단계마다 재검증
// - image/* 응답만 통과
// - 최대 8MB

import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 5000;

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();

  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    normalized.startsWith("::ffff:169.254.")
  );
}

function isPrivateAddress(ip) {
  const family = net.isIP(ip);

  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);

  return true;
}

async function assertSafeUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("잘못된 URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("허용되지 않은 프로토콜");
  }

  if (url.username || url.password) {
    throw new Error("인증정보가 포함된 URL은 허용하지 않음");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("로컬 주소 차단");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("사설 IP 차단");
    }
    return url;
  }

  const resolved = await dns.lookup(hostname, {
    all: true,
    verbatim: true,
  });

  if (!resolved.length) {
    throw new Error("DNS 확인 실패");
  }

  for (const record of resolved) {
    if (isPrivateAddress(record.address)) {
      throw new Error("사설 IP로 해석되는 호스트 차단");
    }
  }

  return url;
}

async function fetchImageWithSafeRedirects(rawUrl) {
  let current = await assertSafeUrl(rawUrl);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS
    );

    let response;

    try {
      response = await fetch(current.href, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error("리다이렉트 위치 없음");
      }

      const nextUrl = new URL(location, current.href).href;
      current = await assertSafeUrl(nextUrl);
      continue;
    }

    return response;
  }

  throw new Error("리다이렉트 횟수 초과");
}

export default async function handler(req, res) {
  const rawUrl =
    typeof req.query?.url === "string"
      ? req.query.url
      : "";

  if (!rawUrl) {
    return res
      .status(400)
      .send("url 파라미터가 필요함");
  }

  try {
    const response =
      await fetchImageWithSafeRedirects(rawUrl);

    if (!response.ok) {
      return res
        .status(502)
        .send(`원본 이미지 응답 실패: ${response.status}`);
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().startsWith("image/")) {
      return res
        .status(415)
        .send("이미지 응답이 아님");
    }

    const declaredLength =
      Number(response.headers.get("content-length") || 0);

    if (declaredLength > MAX_BYTES) {
      return res
        .status(413)
        .send("이미지가 너무 큼");
    }

    const buffer =
      Buffer.from(await response.arrayBuffer());

    if (buffer.length > MAX_BYTES) {
      return res
        .status(413)
        .send("이미지가 너무 큼");
    }

    res.setHeader("Content-Type", contentType);

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=86400, stale-while-revalidate=604800"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    return res
      .status(200)
      .send(buffer);

  } catch (e) {
    console.error(
      "[IMAGE_PROXY_FAIL]",
      rawUrl,
      String(e)
    );

    return res
      .status(502)
      .send("이미지를 가져오지 못했어");
  }
}
