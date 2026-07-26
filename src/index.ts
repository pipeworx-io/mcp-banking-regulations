interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Banking Regulations MCP — US banking & consumer-finance rules (12 CFR).
 *
 * The Federal Reserve, OCC, FDIC, CFPB and NCUA rules ARE US federal
 * regulations codified in Title 12 of the CFR (Banks and Banking). Agents
 * search "banking regulation on X", "Regulation Z truth in lending",
 * "12 CFR 1026.19", "what does Regulation E require" — never "eCFR title 12".
 * This is a thin, banking-branded, keyless wrapper over the official eCFR API
 * (www.ecfr.gov/api), scoped to the whole of Title 12: OCC parts 1-199,
 * Federal Reserve parts 200-299 (capital, Reg O, Reg W, Reg Y, Reg CC),
 * FDIC parts 300-399, NCUA parts 700-799, and CFPB parts 1000-1099
 * (Reg Z/1026, Reg B/1002, Reg C/1003, Reg E/1005, Reg X/1024, Reg DD/1030).
 *
 * Tools:
 * - banking_regulation:          full text of one banking rule by citation
 * - banking_regulations_search:  keyword search across the banking regulations
 *
 * Self-contained: does NOT import the eCFR pack — calls the eCFR API directly.
 */


const BASE = 'https://www.ecfr.gov/api';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';
const TITLE = 12;
const CITE = '12 CFR';

// --- XML/entity helpers ------------------------------------------------------
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripHtml(s: unknown): string {
  if (typeof s !== 'string') return '';
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function xmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<HEAD>[\s\S]*?<\/HEAD>/g, '')
      .replace(/<\/(P|FP|HEAD|DIV\d+)>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

// --- eCFR fetch with per-attempt timeout + 503 retry -------------------------
async function ecfrOnce(path: string, accept: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}${path}`, {
      headers: { Accept: accept, 'User-Agent': UA },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function ecfrFetch(path: string, accept: string, retries = 3): Promise<Response> {
  let res: Response | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      res = await ecfrOnce(path, accept, 12000);
      if (res.status !== 503) return res;
    } catch {
      res = null; // aborted (timeout) or network error — retry
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  if (res) return res;
  throw new Error('eCFR temporarily unavailable (the eCFR text endpoint is timing out — retry in a few seconds).');
}

async function ecfrGet(path: string): Promise<Record<string, unknown>> {
  const res = await ecfrFetch(path, 'application/json');
  if (!res.ok) throw new Error(`eCFR: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Record<string, unknown>;
}

// Current currency date for this title, with a 7-day-ago fallback.
async function currentDate(): Promise<string> {
  try {
    const data = await ecfrGet('/versioner/v1/titles.json');
    const titles = Array.isArray(data.titles) ? (data.titles as Array<Record<string, unknown>>) : [];
    const t = titles.find((x) => Number(x.number) === TITLE);
    if (t && typeof t.up_to_date_as_of === 'string' && t.up_to_date_as_of) return t.up_to_date_as_of;
  } catch {
    /* fall through to date fallback */
  }
  return new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
}

// --- Regulation-letter / statute-name -> part map ----------------------------
// Bank regulations are cited by LETTER ("Regulation Z", "Reg E") or by the
// underlying statute ("Truth in Lending", "HMDA") far more often than by CFR
// part. Names resolve to a part (whose section list is returned) or straight
// to a section.
const NAME_MAP: Record<string, { part: string; section?: string }> = {
  // CFPB consumer-finance regulations
  'regulation z': { part: '1026' },
  'truth in lending': { part: '1026' },
  'tila': { part: '1026' },
  'trid': { part: '1026' },
  'regulation b': { part: '1002' },
  'equal credit opportunity': { part: '1002' },
  'ecoa': { part: '1002' },
  'regulation c': { part: '1003' },
  'hmda': { part: '1003' },
  'home mortgage disclosure': { part: '1003' },
  'regulation e': { part: '1005' },
  'electronic fund transfer': { part: '1005' },
  'efta': { part: '1005' },
  'regulation x': { part: '1024' },
  'respa': { part: '1024' },
  'real estate settlement procedures': { part: '1024' },
  'regulation dd': { part: '1030' },
  'truth in savings': { part: '1030' },
  'regulation p': { part: '1016' },
  'privacy of consumer financial information': { part: '1016' },
  'regulation v': { part: '1022' },
  'fcra': { part: '1022' },
  'fair credit reporting': { part: '1022' },
  'regulation f': { part: '1006' },
  'fdcpa': { part: '1006' },
  'debt collection': { part: '1006' },
  'regulation n': { part: '1014' },
  'mortgage acts and practices': { part: '1014' },
  'regulation o mortgage assistance': { part: '1015' },
  'regulation g mortgage assistance': { part: '1015' },
  // Federal Reserve regulations
  'regulation d': { part: '204' },
  'reserve requirements': { part: '204' },
  'regulation h': { part: '208' },
  'membership of state banking institutions': { part: '208' },
  'regulation j': { part: '210' },
  'regulation k': { part: '211' },
  'international banking operations': { part: '211' },
  'regulation l': { part: '212' },
  'management interlocks': { part: '212' },
  'regulation o': { part: '215' },
  'insider lending': { part: '215' },
  'loans to executive officers': { part: '215' },
  'regulation q': { part: '217' },
  'capital adequacy': { part: '217' },
  'capital requirements': { part: '217' },
  'basel iii': { part: '217' },
  'risk-based capital': { part: '217' },
  'regulation t': { part: '220' },
  'margin credit': { part: '220' },
  'regulation u': { part: '221' },
  'regulation w': { part: '223' },
  'transactions with affiliates': { part: '223' },
  'regulation y': { part: '225' },
  'bank holding company': { part: '225' },
  'regulation bb': { part: '228' },
  'community reinvestment': { part: '228' },
  'cra': { part: '228' },
  'regulation cc': { part: '229' },
  'availability of funds': { part: '229' },
  'funds availability': { part: '229' },
  'check collection': { part: '229' },
  'regulation gg': { part: '233' },
  'unlawful internet gambling': { part: '233' },
  'regulation hh': { part: '234' },
  'regulation ii': { part: '235' },
  'debit card interchange': { part: '235' },
  'durbin amendment': { part: '235' },
  'regulation jj': { part: '236' },
  'incentive-based compensation': { part: '236' },
  'regulation kk': { part: '237' },
  'regulation ll': { part: '238' },
  'savings and loan holding company': { part: '238' },
  'regulation mm': { part: '239' },
  'regulation nn': { part: '240' },
  'regulation qq': { part: '243' },
  'resolution plans': { part: '243' },
  'living wills': { part: '243' },
  'regulation rr': { part: '244' },
  'credit risk retention': { part: '244' },
  'regulation vv': { part: '248' },
  'volcker rule': { part: '248' },
  'proprietary trading': { part: '248' },
  'regulation ww': { part: '249' },
  'liquidity coverage ratio': { part: '249' },
  'lcr': { part: '249' },
  'regulation xx': { part: '251' },
  'concentration limits': { part: '251' },
  'regulation yy': { part: '252' },
  'enhanced prudential standards': { part: '252' },
  'stress testing': { part: '252' },
  'ccar': { part: '252' },
};

function lookupName(norm: string): { part: string; section?: string } | null {
  const variants = [
    norm,
    norm.replace(/^(the|fed|federal reserve|cfpb|occ|fdic|ncua)\s+/, ''),
    norm.replace(/^12\s*cfr\s*/, ''),
    norm.replace(/\s+(rules?|regulations?|requirements?|act)$/, ''),
    norm.replace(/^(the|fed|federal reserve|cfpb|occ|fdic|ncua)\s+/, '').replace(/\s+(rules?|regulations?|requirements?|act)$/, ''),
    norm.replace(/^reg\.?\s+/, 'regulation '),
    norm.replace(/^regulation\s+/, 'reg '),
  ];
  for (const v of variants) {
    const hit = NAME_MAP[v.trim()];
    if (hit) return hit;
  }
  return null;
}

// --- citation parsing --------------------------------------------------------
// Forgiving: "1026.19", "12 CFR 1026.19", "§ 217.10", "1026.19(e)", "part 1026",
// "Regulation Z", "Reg E", "truth in lending".
// Title-12 quirk: parentheses are always PARAGRAPHS, never part of the section
// number, so "1026.19(e)(1)(i)" -> section 1026.19. Part numbers run to four
// digits (CFPB parts are 1002-1099), so "1026.19" is part 1026, section 1026.19.
function parseCitation(raw: string): { section: string | null; part: string | null; resolved_from: string | null } {
  const norm = raw
    .trim()
    .toLowerCase()
    .replace(/§+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.,;]+$/, '')
    .trim();

  const named = lookupName(norm);
  if (named) return { section: named.section ?? null, part: named.part, resolved_from: raw.trim() };

  let s = norm;
  s = s.replace(/\b(12\s*cfr|cfr|parts?|subparts?|sections?|sec\.?|rules?|regulations?|reg\.?)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  const secMatch = s.match(/(\d{1,4})\.(\d+[A-Za-z]*(?:-[0-9A-Za-z]+)?)/);
  if (secMatch) return { section: `${secMatch[1]}.${secMatch[2]}`, part: secMatch[1], resolved_from: null };
  const partMatch = s.match(/\b(\d{1,4})\b/);
  if (partMatch) return { section: null, part: partMatch[1], resolved_from: null };
  return { section: null, part: null, resolved_from: null };
}

// Best-effort subpart lookup for a section, via the eCFR search hierarchy.
async function lookupSubpart(section: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ query: section, per_page: '5', order: 'relevance' });
    params.append('hierarchy[title]', String(TITLE));
    const data = await ecfrGet(`/search/v1/results?${params.toString()}`);
    const results = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
    for (const r of results) {
      const h = (r.hierarchy as Record<string, unknown> | undefined) ?? {};
      if (h.section != null && String(h.section) === section && h.subpart != null) {
        return String(h.subpart);
      }
    }
  } catch {
    /* ignore — subpart is optional metadata */
  }
  return null;
}

// --- tools -------------------------------------------------------------------
const tools: McpToolExport['tools'] = [
  {
    name: 'banking_regulation',
    description:
      'Get the full text of one banking regulation — a US Federal Reserve, OCC, FDIC, CFPB or NCUA rule codified in 12 CFR — by its citation or Regulation letter. Returns the exact regulatory wording currently in force. Answers "what does Regulation E require", "what is the Federal Reserve regulation for X", "read 12 CFR 1026.19", "the CFPB rule on X", "the OCC / FDIC regulation for X", "bank capital requirement". Forgiving input: "1026.19", "12 CFR 1026.19", "§ 217.10", "1026.19(e)" (paragraph stripped to the section), "part 1026". Fed "Regulation letters" resolve automatically: "Regulation Z" (truth in lending) -> part 1026, "Reg B" (ECOA) -> 1002, "Reg C" (HMDA) -> 1003, "Reg D" -> 204, "Reg E" (EFTA) -> 1005, "Reg O" (insider lending) -> 215, "Reg W" (affiliate transactions) -> 223, "Reg X" (RESPA) -> 1024, "Reg Y" (bank holding companies) -> 225, "Reg CC" (funds availability) -> 229, "Reg DD" (truth in savings) -> 1030, "Reg Q" / capital -> 217, plus "Volcker rule" -> 248, "CRA" -> 228, "liquidity coverage ratio" -> 249. Covers bank compliance across all of Title 12: consumer financial protection, mortgage disclosure and servicing, deposits and payments, capital and liquidity, holding-company supervision, safety and soundness. Pass a whole part or Regulation letter to get that part\'s section list. Example: banking_regulation({ citation: "1026.19" }) -> certain mortgage and variable-rate transactions; banking_regulation({ citation: "Regulation Z" }) -> the truth-in-lending part\'s section list. Keyless.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        citation: {
          type: 'string',
          description:
            'Banking-regulation citation or Regulation letter. A section: "1026.19", "12 CFR 1026.19", "§ 217.10", "1002.9", "1026.19(e)". A Regulation letter or statute name: "Regulation Z", "Reg E", "truth in lending", "HMDA", "Volcker rule". Or a whole part: "1026", "part 217" -> returns the part\'s section list.',
        },
      },
      required: ['citation'],
    },
  },
  {
    name: 'banking_regulations_search',
    description:
      'Keyword search across the US banking regulations — Federal Reserve, OCC, FDIC, CFPB and NCUA rules in 12 CFR. Answers "what banking regulations cover X", "the Federal Reserve regulation about X", "find the CFPB rule for X", "which consumer financial protection rule applies to X", "the bank compliance requirement for X". Great for topics: truth in lending disclosure, mortgage origination and servicing, closing disclosures and TRID, ability to repay and qualified mortgages, electronic fund transfers and error resolution, overdraft and remittances, fair lending and adverse action notices, HMDA reporting, funds availability and check holds, deposit insurance, risk-based capital and leverage ratios, liquidity coverage, transactions with affiliates, insider lending limits, bank holding company activities, stress testing, community reinvestment. Returns matching banking rules with citation (12 CFR), heading, excerpt, and source URL. Example: banking_regulations_search({ query: "truth in lending disclosure" }); banking_regulations_search({ query: "ability to repay qualified mortgage", limit: 15 }). Keyless.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Banking-regulation topic or phrase, e.g. "truth in lending disclosure", "ability to repay", "overdraft", "capital conservation buffer", "adverse action notice", "funds availability".',
        },
        limit: { type: 'number', description: 'Max results to return, 1-20 (default 10).' },
      },
      required: ['query'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'banking_regulation':
        return getRegulation(args);
      case 'banking_regulations_search':
        return searchRegulations(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function getRegulation(args: Record<string, unknown>): Promise<unknown> {
  const raw = typeof args.citation === 'string' ? args.citation : '';
  if (!raw.trim()) return { error: 'provide a citation, e.g. "1026.19", "12 CFR 217.10" or "Regulation Z"' };

  const { section, part, resolved_from } = parseCitation(raw);
  if (!part) {
    return {
      error: `Could not parse a banking citation from "${raw}". Use a section like "1026.19" or "217.10", a Regulation letter like "Regulation Z", or a part like "1026".`,
    };
  }

  const date = await currentDate();

  // ---- whole part requested: return its section list -----------------------
  if (!section) {
    const res = await ecfrFetch(
      `/versioner/v1/full/${date}/title-${TITLE}.xml?part=${encodeURIComponent(part)}`,
      'application/xml',
    );
    if (res.status === 404) return { error: `${CITE} part ${part} not found as of ${date}.`, part, date };
    if (res.status === 503) return { error: 'eCFR temporarily unavailable — retry in a few seconds.', part };
    if (!res.ok) throw new Error(`eCFR: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const xml = await res.text();
    const blocks = xml.split(/<DIV8\b/).slice(1);
    const sections = blocks
      .map((b) => {
        const n = b.match(/\bN="([^"]+)"/)?.[1] ?? null;
        const head = b.match(/<HEAD>([\s\S]*?)<\/HEAD>/);
        return { section: n, heading: head ? stripHtml(head[1]) : null };
      })
      .filter((s) => s.section);
    return {
      part,
      citation: `${CITE} Part ${part}`,
      resolved_from: resolved_from ?? null,
      date,
      source: 'eCFR / 12 CFR (Banks and Banking — Federal Reserve, OCC, FDIC, CFPB, NCUA)',
      source_url: `https://www.ecfr.gov/current/title-${TITLE}/part-${part}`,
      section_count: sections.length,
      note: `This is a whole banking-regulation part (${sections.length} sections). Call banking_regulation with a specific citation (e.g. "${sections[0]?.section ?? part + '.1'}") to get full text.`,
      sections,
    };
  }

  // ---- single section ------------------------------------------------------
  const res = await ecfrFetch(
    `/versioner/v1/full/${date}/title-${TITLE}.xml?part=${encodeURIComponent(part)}&section=${encodeURIComponent(section)}`,
    'application/xml',
  );
  if (res.status === 404 || res.status === 400) {
    return {
      error: `Banking regulation ${CITE} ${section} not found as of ${date}. Check the citation, or use banking_regulations_search to find it.`,
      citation: `${CITE} ${section}`,
      part,
      date,
    };
  }
  if (res.status === 503) return { error: 'eCFR temporarily unavailable — retry in a few seconds.', citation: `${CITE} ${section}` };
  if (!res.ok) throw new Error(`eCFR: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.text();
  // eCFR returns JSON {"error":"No matching content found."} for removed/absent sections
  if (body.trim().startsWith('{')) {
    return {
      error: `Banking regulation ${CITE} ${section} not found as of ${date}. Check the citation, or use banking_regulations_search to find it.`,
      citation: `${CITE} ${section}`,
      part,
      date,
    };
  }
  const xml = body;

  const headMatch = xml.match(/<HEAD>([\s\S]*?)<\/HEAD>/);
  const heading = headMatch ? stripHtml(headMatch[1]) : null;
  const full = xmlToText(xml);
  const CAP = 30000;
  const truncated = full.length > CAP;
  const subpart = await lookupSubpart(section);

  return {
    citation: `${CITE} ${section}`,
    part,
    subpart: subpart ?? null,
    resolved_from: resolved_from ?? null,
    heading,
    text: truncated ? full.slice(0, CAP) : full,
    truncated,
    date,
    source: 'eCFR / 12 CFR (Banks and Banking — Federal Reserve, OCC, FDIC, CFPB, NCUA)',
    source_url: `https://www.ecfr.gov/current/title-${TITLE}/section-${section}`,
  };
}

async function searchRegulations(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { error: 'provide a query, e.g. "truth in lending disclosure" or "ability to repay"' };

  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);

  // eCFR search returns one row per matching PARAGRAPH, so a single dense
  // section can fill an entire page. Dedupe by citation and walk up to 3 pages
  // (20/page, the API max) until `limit` distinct sections are collected.
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];
  let total: unknown = null;

  for (let page = 1; page <= 3 && results.length < limit; page++) {
    const params = new URLSearchParams({
      query,
      per_page: '20',
      page: String(page),
      order: 'relevance',
    });
    params.append('hierarchy[title]', String(TITLE));

    const data = await ecfrGet(`/search/v1/results?${params.toString()}`);
    const meta = (data.meta as Record<string, unknown> | undefined) ?? {};
    if (total == null) total = meta.total_count ?? null;
    const rawResults = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
    if (rawResults.length === 0) break;

    for (const r of rawResults) {
      if (results.length >= limit) break;
      const h = (r.hierarchy as Record<string, unknown> | undefined) ?? {};
      const headings = (r.headings as Record<string, unknown> | undefined) ?? {};
      const hHeadings = (r.hierarchy_headings as Record<string, unknown> | undefined) ?? {};
      const part = h.part != null ? String(h.part) : null;
      const section = h.section != null ? String(h.section) : null;
      const subpart = h.subpart != null ? String(h.subpart) : null;
      if (!section && !part) continue;
      const heading =
        (typeof headings.section === 'string' && stripHtml(headings.section)) ||
        (typeof hHeadings.section === 'string' && stripHtml(hHeadings.section)) ||
        null;
      let citation: string;
      let source_url: string;
      if (section) {
        citation = `${CITE} ${section}`;
        source_url = `https://www.ecfr.gov/current/title-${TITLE}/section-${section}`;
      } else {
        citation = `${CITE} Part ${part}`;
        source_url = `https://www.ecfr.gov/current/title-${TITLE}/part-${part}`;
      }
      if (seen.has(citation)) continue;
      seen.add(citation);
      results.push({
        part,
        subpart,
        section,
        citation,
        heading,
        excerpt: stripHtml(r.full_text_excerpt ?? (r as Record<string, unknown>).excerpt).slice(0, 300),
        source_url,
      });
    }
    if (rawResults.length < 20) break;
  }

  return {
    query,
    total_matches: total,
    count: results.length,
    scope: 'US banking regulations — 12 CFR (Federal Reserve, OCC, FDIC, CFPB, NCUA)',
    source: 'eCFR / 12 CFR',
    results,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
