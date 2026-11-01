// 진행 중인 지원사업 공고를 받아 data/notices.json으로 저장한다.
//  - 기업마당 지원사업정보 API: 인증키 환경변수 BIZINFO_KEY
//  - K-Startup 사업공고 조회서비스(공공데이터포털): 인증키 환경변수 DATA_GO_KR_KEY
// 인증키는 GitHub 저장소 Secrets로만 받는다. 키를 파일이나 로그에 쓰지 말 것.
import { writeFile, mkdir } from "node:fs/promises";

const BIZINFO_KEY = process.env.BIZINFO_KEY;
const DATA_GO_KR_KEY = process.env.DATA_GO_KR_KEY;
const BIZINFO_API = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
const KSTARTUP_API = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";
const KSTARTUP_LIST = "https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do";
const OUT = new URL("../data/notices.json", import.meta.url);

const REGIONS = { 서울: "seoul", 부산: "busan", 대구: "daegu", 인천: "incheon", 전남광주: "jngj", 광주: "jngj", 전남: "jngj",
  대전: "daejeon", 울산: "ulsan", 세종: "sejong", 경기: "gyeonggi", 강원: "gangwon", 충북: "chungbuk", 충남: "chungnam",
  전북: "jeonbuk", 경북: "gyeongbuk", 경남: "gyeongnam", 제주: "jeju" };

const strip = (s = "") => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const ymd = (s) => { const d = String(s ?? "").replace(/\D/g, "").slice(0, 8); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : ""; };
const pick = (o, keys) => { for (const k of keys) if (o[k] != null && String(o[k]).trim() !== "") return o[k]; return ""; };
const regionOf = (text) => { const hit = Object.keys(REGIONS).filter((k) => String(text).includes(k)); return hit.length === 1 ? REGIONS[hit[0]] : "all"; };
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ── 기업마당 ───────────────────────────────────────────────
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
    src: "bizinfo",
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

async function fetchBizinfo() {
  const url = `${BIZINFO_API}?crtfcKey=${encodeURIComponent(BIZINFO_KEY)}&dataType=json&searchCnt=0`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`기업마당 API 응답 오류: HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("기업마당 API가 JSON이 아닌 응답을 보냈습니다(인증키 확인): " + strip(text).slice(0, 160)); }
  if (json && json.reqErr) throw new Error("기업마당 API 오류: " + strip(json.reqErr) + " (기업마당에서 발급한 인증키인지 확인)");
  const items = itemsOf(json);
  // 0건이면 응답 앞부분을 남겨 원인(인증키 오류 메시지 등)을 볼 수 있게 한다. 응답에는 인증키가 들어 있지 않다.
  if (!items.length) console.log("::warning::기업마당 응답에 공고가 없습니다. 응답 앞부분: " + strip(text).replace(BIZINFO_KEY, "(키)").slice(0, 300));
  return items.map(normalize);
}

// ── K-Startup ─────────────────────────────────────────────
// 응답 항목 이름은 2026.11.1 실제 응답(aply_mthd_*_rcpt_istc, detl_pg_url, prch_cnpl_no …)으로 확인함.
const isUrl = (s) => /^https?:\/\//i.test(String(s).trim());
// 접수 방법 항목(온라인·방문·이메일·우편·팩스·기타)을 "온라인 접수 · 방문 접수 (…)"처럼 묶는다. 온라인 접수 주소는 신청 링크로 쓴다.
function kstartupHow(it) {
  const ways = [["aply_mthd_onli_rcpt_istc", "온라인 접수"], ["aply_mthd_vst_rcpt_istc", "방문 접수"], ["aply_mthd_eml_rcpt_istc", "이메일 접수"],
    ["aply_mthd_pssr_rcpt_istc", "우편 접수"], ["aply_mthd_fax_rcpt_istc", "팩스 접수"], ["aply_mthd_etc_istc", "기타"]];
  let ap = "";
  const parts = [];
  for (const [k, label] of ways) {
    const v = strip(it[k]);
    if (!v) continue;
    if (isUrl(v)) { if (!ap) ap = v; parts.push(label); }
    else parts.push(`${label}(${cut(v, 60)})`);
  }
  return { how: cut(parts.join(" · "), 200), ap };
}

export function normalizeKstartup(it) {
  const regionText = strip(pick(it, ["supt_regin", "supt_regin_nm"]));
  const m = kstartupHow(it);
  const applyUrl = pick(it, ["biz_aply_url", "aply_url"]);
  return {
    src: "kstartup",
    id: "KS" + String(pick(it, ["pbanc_sn", "id", "biz_pbanc_sn"])),
    n: strip(pick(it, ["biz_pbanc_nm", "intg_pbanc_biz_nm", "pbanc_nm"])),
    a: strip(pick(it, ["pbanc_ntrp_nm", "sprv_inst", "biz_prch_dprt_nm", "pbanc_inst_nm"])),
    ex: strip(pick(it, ["biz_prch_dprt_nm", "exc_inst_nm"])),
    cat: strip(pick(it, ["supt_biz_clsfc", "supt_biz_clsfc_nm"])),
    tgt: cut(strip(pick(it, ["aply_trgt_ctnt", "aply_trgt"])), 120),
    r: regionOf(regionText),
    tags: [regionText, strip(pick(it, ["biz_enyy"])), strip(pick(it, ["biz_trgt_age"]))].filter(Boolean),
    d: cut(strip(pick(it, ["pbanc_ctnt", "biz_pbanc_ctnt", "pbanc_cn"])), 260),
    how: m.how,
    tel: cut(strip(pick(it, ["prch_cnpl_no"])), 120),
    u: pick(it, ["detl_pg_url"]) || KSTARTUP_LIST,
    ap: isUrl(applyUrl) ? applyUrl : m.ap,
    start: ymd(pick(it, ["pbanc_rcpt_bgng_dt"])), end: ymd(pick(it, ["pbanc_rcpt_end_dt"])), per: "",
    reg: ymd(pick(it, ["pbanc_rcpt_bgng_dt"])),
  };
}

async function fetchKstartup() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const qs = new URLSearchParams({ page: String(page), perPage: "500", returnType: "json", "cond[rcrt_prgs_yn::EQ]": "Y" });
    const url = `${KSTARTUP_API}?serviceKey=${encodeURIComponent(DATA_GO_KR_KEY)}&${qs}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`K-Startup API가 JSON이 아닌 응답을 보냈습니다(HTTP ${res.status}, 활용신청·인증키 확인): ` + strip(text).slice(0, 160)); }
    const rows = Array.isArray(json.data) ? json.data : [];
    if (page === 1 && rows[0]) console.log("::notice::K-Startup 응답 항목: " + Object.keys(rows[0]).join(", "));
    all.push(...rows);
    const total = Number(json.totalCount || json.matchCount || 0);
    if (!rows.length || all.length >= total) break;
  }
  return all.map(normalizeKstartup);
}

// ── 합치기 ────────────────────────────────────────────────
const titleKey = (s) => s.replace(/\[[^\]]*\]|\([^)]*\)|\s|공고|모집|안내|20\d\d년?/g, "");

async function main() {
  if (!BIZINFO_KEY && !DATA_GO_KR_KEY) {
    // 실행 요약(Annotations)에 보이도록 GitHub 경고 형식으로 남긴다
    console.log("::warning::인증키가 없어 공고를 받지 않았습니다. Settings → Secrets and variables → Actions에 BIZINFO_KEY(기업마당) 또는 DATA_GO_KR_KEY(공공데이터포털)를 등록하세요.");
    return;
  }
  const today = todayKST();
  const sources = [];
  const results = [];
  const errors = [];
  for (const [name, key, fn] of [["기업마당", BIZINFO_KEY, fetchBizinfo], ["K-Startup", DATA_GO_KR_KEY, fetchKstartup]]) {
    if (!key) { console.log(`::warning::${name} 인증키가 없어 건너뜁니다.`); continue; }
    try {
      const got = (await fn()).filter((x) => x.id && x.n).filter((x) => !x.end || x.end >= today);
      console.log(`::notice::${name} 진행 중 공고 ${got.length}건`);
      if (got.length) { sources.push(name); results.push(...got); }
    } catch (e) {
      // 접속 실패면 원인 코드(시간 초과·연결 거부 등)를 함께 남긴다
      const why = e.cause ? ` (${e.cause.code || e.cause.name || ""} ${e.cause.message || ""})`.trim() : "";
      const msg = `${name}: ${e.message}${why ? " " + why : ""}`;
      errors.push(msg); console.log(`::error::${msg}`);
    }
  }
  // 같은 공고가 두 곳에 있으면 기업마당 쪽을 남긴다
  const seen = new Set();
  const items = results.filter((x) => { const k = titleKey(x.n); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!items.length) throw new Error("받아온 공고가 0건입니다. " + (errors.join(" / ") || "인증키나 API 상태를 확인하세요."));
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: today, source: sources.join(" · "), count: items.length, items }));
  console.log(`::notice::진행 중 공고 총 ${items.length}건 저장 (${today}, ${sources.join(" · ")})`);
  // 한쪽만 실패하면 받은 공고는 저장하고, 실패 내용은 위의 ::error:: 표시로 실행 요약에 남긴다
}

if (process.argv[1]?.endsWith("fetch-notices.mjs")) {
  main().catch((e) => { console.log("::error::" + e.message); process.exit(1); });
}
