import { Resolver } from "node:dns/promises";
import { get } from "node:https";
import { BlockList } from "node:net";

const nonPublic = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) nonPublic.addSubnet(address, prefix);

const htmlLimit = 1_500_000;
const mailAddress = /^[\w.!#$%&'*+/=?^`{|}~-]+@[a-z\d.-]+\.[a-z]{2,}$/i;

async function readPublicHtml(url: URL): Promise<string | undefined> {
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z][a-z\d-]*$/i.test(url.hostname)) return;

  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const addresses = await resolver.resolve4(url.hostname).catch(() => []);
  if (!addresses.length || addresses.some((address) => nonPublic.check(address))) return;

  return new Promise((resolve) => {
    const request = get(url, {
      agent: false,
      family: 4,
      lookup: (_host, _options, callback) => callback(null, addresses[0], 4),
      signal: AbortSignal.timeout(6500),
      headers: {
        Accept: "text/html",
        "Accept-Language": "ru,en;q=0.5",
        "User-Agent": "MercuryRegistry/0.1",
      },
    }, (response) => {
      const contentType = response.headers["content-type"] ?? "";
      if (response.statusCode !== 200 || !/^text\/html(?:\s*;|$)/i.test(contentType) ||
          Number(response.headers["content-length"]) > htmlLimit) {
        response.destroy();
        resolve(undefined);
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on("error", () => resolve(undefined));
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > htmlLimit) {
          response.destroy();
          resolve(undefined);
        } else chunks.push(chunk);
      });
      response.on("end", () => {
        const encoding = /charset\s*=\s*["']?windows-1251/i.test(contentType) ? "windows-1251" : "utf-8";
        resolve(new TextDecoder(encoding).decode(Buffer.concat(chunks)));
      });
    });
    request.on("error", () => resolve(undefined));
  });
}

function decodeHtml(value: string): string {
  const entities: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", commat: "@" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|nbsp|quot|apos|commat);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return entities[code.toLowerCase()] ?? entity;
    const number = code.slice(1).replace(/^x/i, "0x");
    const point = Number(number);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function visibleText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function pageContent(html: string): string {
  return html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
}

function pageEmail(html: string): string | undefined {
  const footer = /<footer\b[^>]*>([\s\S]*?)<\/footer\s*>/i.exec(html)?.[1];
  const emails = new Map<string, string>();
  for (const [, href] of (footer ?? html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']mailto:([^"'?]+)["'?]/gi)) {
    const email = decodeHtml(href).trim();
    if (mailAddress.test(email)) emails.set(email.toLowerCase(), email);
  }
  return emails.size === 1 ? emails.values().next().value : undefined;
}

export async function readInstitutionSiteEmail(
  origin: string,
  matchesInstitution: (headings: string, text: string) => boolean,
): Promise<{ email: string; url: string } | undefined> {
  const homeUrl = new URL("/", origin);
  const body = await readPublicHtml(homeUrl);
  if (!body) return;
  const home = pageContent(body);
  const headings = [...home.matchAll(/<(title|h1|header)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
    .map(([, , html]) => visibleText(html)).join(" ");
  if (!matchesInstitution(headings, visibleText(home))) return;

  const contactUrls = new Map<string, URL>();
  for (const [, href] of home.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const decodedHref = decodeHtml(href);
    if (!URL.canParse(decodedHref, homeUrl)) continue;
    const url = new URL(decodedHref, homeUrl);
    if (url.origin !== homeUrl.origin || url.search ||
        !/\/(?:contacts?|kontakty|kontakti|osnovnye-svedeniya|sveden\/common)\/?$/i.test(url.pathname)) continue;
    url.hash = "";
    contactUrls.set(url.href, url);
  }
  const urls = [...contactUrls.values()].sort((left, right) =>
    Number(/sveden/i.test(left.pathname)) - Number(/sveden/i.test(right.pathname)),
  ).slice(0, 2);
  const pages = await Promise.all(urls.map(async (url) => {
    const html = await readPublicHtml(url);
    const email = html && pageEmail(pageContent(html));
    return email ? { email, url: url.href } : undefined;
  }));
  const contact = pages.find((page) => page);
  if (contact) return contact;
  const email = pageEmail(home);
  if (email) return { email, url: homeUrl.href };
}
