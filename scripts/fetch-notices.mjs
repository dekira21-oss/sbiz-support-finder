// 기업마당 지원사업정보 API에서 진행 중인 공고를 받아 data/notices.json으로 저장한다.
// 인증키는 환경변수 BIZINFO_KEY(GitHub 저장소 Secrets)로만 받는다. 키를 파일에 쓰지 말 것.
import { writeFile, mkdir } from "node:fs/promises";

const KEY = process.env.BIZINFO_KEY;
const API = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
const OUT = new URL("../data/notices.json", import.meta.url);

const REGIONS = { 서울: "seoul", 부산: "busan", 대구: "daegu", 인천: "incheon", 전남광주: "jngj", 광주: "jngj", 전남: "jngj",
  대전: "daejeon", 울산: "ulsan", 세종: "sejong", 경기: "gyeonggi", 강원: "gangwon", 충북: "chungbuk", 충남: "chungnam",
  전북: "jeonbuk", 경북: "gyeongbuk", 경남: "gyeongnam", 제주: "jeju" };

const strip = (s = "") => String(s).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const ymd = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");

// "20260101 ~ 20261231" 같은 신청기간을 시작·종료일로 나눈다. 상시·예산 소진 등 글자는 그대로 둔다.
export function period(raw = "") {
  const m = String(raw).match(/(\d{8})\s*~\s*(\d{8})/);
  return m ? { start: ymd(m[1]), end: ymd(m[2]), raw: "" } : { start: "", end: "", raw: strip(raw) };
}

export function normalize(it) {
  const tags = String(it.hashTags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const region = tags.map((t) => REGIONS[t]).find(Boolean) || "all";
  const p = period(it.reqstBeginEndDe || it.reqstDt);
  return {
    id: it.pblancId || it.seq,
    n: strip(it.pblancNm || it.title),
    a: strip(it.jrsdInsttNm || it.author),
    ex: strip(it.excInsttNm),
    cat: strip(it.pldirSportRealmLclasCodeNm || it.lcategory),
    tgt: strip(it.trgetNm),
    r: region,
    tags,
    d: cut(strip(it.bsnsSumryCn || it.description), 260),
    how: cut(strip(it.reqstMthPapersCn), 200),
    tel: cut(strip(it.refrncNm), 120),
    u: it.pblancUrl || it.link || "",
    ap: it.rceptEngnHmpgUrl || "",
    start: p.start, end: p.end, per: p.raw,
    reg: String(it.creatPnttm || it.pubDate || "").slice(0, 10),
  };
}

export function itemsOf(json) {
  const ja = json && json.jsonArray;
  if (Array.isArray(ja)) return ja;
  if (ja && Array.isArray(ja.item)) return ja.item;
  return [];
}

async function main() {
  if (!KEY) {
    console.warn("BIZINFO_KEY가 없어 공고를 받지 않았습니다. 저장소 Settings → Secrets에 키를 등록하세요.");
    return;
  }
  const url = `${API}?crtfcKey=${encodeURIComponent(KEY)}&dataType=json&searchCnt=0`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`기업마당 API 응답 오류: HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("기업마당 API가 JSON이 아닌 응답을 보냈습니다: " + text.slice(0, 200)); }
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜
  const items = itemsOf(json).map(normalize)
    .filter((x) => x.id && x.n)
    .filter((x) => !x.end || x.end >= today); // 마감 지난 공고 제외
  if (!items.length) throw new Error("받아온 공고가 0건입니다. 인증키나 API 상태를 확인하세요.");
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: today, source: "기업마당 지원사업정보 API", count: items.length, items }));
  console.log(`진행 중 공고 ${items.length}건 저장 (${today})`);
}

if (process.argv[1]?.endsWith("fetch-notices.mjs")) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
