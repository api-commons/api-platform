// APIs.io client + OpenAPI merge + APIs.json (platform) build/parse.
// Everything is browser-side against the public, CORS-open APIs.io API
// (https://apis.io/developer/) and the API Evangelist OpenAPI repos.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export const APIS_IO = 'https://apis.io/api/v1';

// ---------- Types ----------

export interface ProviderCard {
  slug: string;
  name: string;
  description?: string;
  image?: string;
  api_count?: number;
  tags?: string[];
  artifact_types?: string[];
  score?: { composite?: number; band?: string };
}

export interface ApiSummary {
  aid: string;
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
  humanURL?: string;
  artifact_types?: string[];
}

export interface ApiProperty {
  type: string;
  url?: string;
  data?: string;
  content?: string; // apis.io inlines body under `content`
}

export interface ApiDetail {
  aid: string;
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
  humanURL?: string;
  properties: ApiProperty[];
}

export interface OpInfo {
  method: string; // upper
  path: string;
  operationId?: string;
  summary?: string;
}

// A selected operation, keyed to its source spec so we can rebuild the merged OpenAPI.
export interface SelectedOp {
  aid: string;
  apiName: string;
  specUrl: string; // source OpenAPI url (identity for the spec)
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
}

// A property the user chose to carry into the platform for this provider.
export interface SelectedProp {
  type: string;
  url?: string;
  apiName?: string;
}

// A provider placed on the board.
export interface Member {
  slug: string;
  name: string;
  description?: string;
  image?: string;
  tags?: string[];
  groupId: string;
  ops: SelectedOp[];
  props: SelectedProp[];
}

export interface Group {
  id: string;
  name: string;
}

export interface PlatformState {
  name: string;
  description: string;
  groups: Group[];
  members: Member[];
}

// ---------- APIs.io fetch helpers ----------

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function searchProviders(
  q: string,
  page = 1,
  limit = 40,
): Promise<{ total: number; pages: number; data: ProviderCard[] }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q.trim()) params.set('q', q.trim());
  const j = await getJson(`${APIS_IO}/providers?${params}`);
  return { total: j.meta?.total ?? 0, pages: j.meta?.pages ?? 1, data: j.data ?? [] };
}

export async function listProviderApis(slug: string): Promise<ApiSummary[]> {
  const out: ApiSummary[] = [];
  let page = 1;
  for (;;) {
    const j = await getJson(`${APIS_IO}/providers/${encodeURIComponent(slug)}/apis?limit=100&page=${page}`);
    out.push(...(j.data ?? []));
    if (page >= (j.meta?.pages ?? 1)) break;
    page++;
    if (page > 20) break; // safety
  }
  return out;
}

export async function getApiDetail(aid: string): Promise<ApiDetail> {
  // aid is provider-slug:api-slug — keep the colon raw; the API 403s on %3A.
  const j = await getJson(`${APIS_IO}/apis/${aid}?include=content`);
  return j as ApiDetail;
}

// ---------- OpenAPI parsing / merging ----------

const specCache = new Map<string, any>(); // specUrl -> parsed doc

function parseSpec(text: string): any {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  return parseYaml(t);
}

// A parsed doc only counts as OpenAPI if it carries the version key or a paths
// object. This guards against garbage like APIs.io's cached `content: "404: Not
// Found"`, which YAML happily parses into `{404: "Not Found"}` — an object with
// no `paths`, which would otherwise show up as a silent "0 operations".
function looksLikeOpenApi(doc: any): boolean {
  return !!doc && typeof doc === 'object' && (doc.openapi || doc.swagger || (doc.paths && typeof doc.paths === 'object'));
}

// Resolve the OpenAPI body for a property: prefer inlined content, else fetch the
// url. Inlined content is only trusted when it actually parses to an OpenAPI doc;
// otherwise we fall back to the url so a bad cache entry can't mask a live spec.
export async function loadSpec(prop: ApiProperty): Promise<any> {
  const key = prop.url || prop.data || '';
  if (key && specCache.has(key)) return specCache.get(key);
  let doc: any;

  const body = prop.content ?? prop.data;
  if (body) {
    try {
      const parsed = parseSpec(body);
      if (looksLikeOpenApi(parsed)) doc = parsed;
    } catch {
      /* fall through to the url */
    }
  }

  if (!doc && prop.url) {
    const res = await fetch(prop.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseSpec(await res.text());
    if (!looksLikeOpenApi(parsed)) throw new Error('not an OpenAPI document');
    doc = parsed;
  }

  if (!doc) throw new Error('no valid OpenAPI content or url');
  if (key) specCache.set(key, doc);
  return doc;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

// Every operation across every path in a spec.
export function operationsOf(doc: any): OpInfo[] {
  const ops: OpInfo[] = [];
  const paths = doc?.paths ?? {};
  for (const path of Object.keys(paths)) {
    const item = paths[path] || {};
    for (const m of HTTP_METHODS) {
      const op = item[m];
      if (op && typeof op === 'object') {
        ops.push({ method: m.toUpperCase(), path, operationId: op.operationId, summary: op.summary || op.description });
      }
    }
  }
  return ops;
}

// Build a single OpenAPI for one provider from the operations selected across its specs.
// `specs` maps specUrl -> parsed source doc.
export function buildMergedOpenApi(
  providerName: string,
  ops: SelectedOp[],
  specs: Map<string, any>,
): any {
  const merged: any = {
    openapi: '3.1.0',
    info: {
      title: `${providerName} — Platform Selection`,
      version: '1.0.0',
      description: `Merged OpenAPI of the ${ops.length} operation${ops.length === 1 ? '' : 's'} this platform uses from ${providerName}. Assembled by API Platform (platform.apicommons.org) from source specifications published on APIs.io.`,
    },
    servers: [],
    paths: {},
    components: {},
    tags: [],
  };
  const servers = new Set<string>();
  const tagNames = new Set<string>();

  for (const op of ops) {
    const doc = specs.get(op.specUrl);
    if (!doc) continue;
    const srcPath = doc.paths?.[op.path];
    const srcOp = srcPath?.[op.method.toLowerCase()];
    if (!srcOp) continue;

    // servers: operation > path > document
    for (const s of srcOp.servers || srcPath.servers || doc.servers || []) {
      if (s?.url) servers.add(s.url);
    }
    // paths
    merged.paths[op.path] = merged.paths[op.path] || {};
    // carry path-level parameters once
    if (srcPath.parameters && !merged.paths[op.path].parameters) {
      merged.paths[op.path].parameters = srcPath.parameters;
    }
    merged.paths[op.path][op.method.toLowerCase()] = srcOp;
    for (const t of srcOp.tags || []) tagNames.add(t);

    // components: shallow-merge every bucket from the source (best-effort $ref support)
    if (doc.components && typeof doc.components === 'object') {
      for (const bucket of Object.keys(doc.components)) {
        merged.components[bucket] = { ...(merged.components[bucket] || {}), ...doc.components[bucket] };
      }
    }
  }

  merged.servers = [...servers].map((url) => ({ url }));
  merged.tags = [...tagNames].map((name) => ({ name }));
  if (!merged.servers.length) delete merged.servers;
  if (!merged.tags.length) delete merged.tags;
  if (!Object.keys(merged.components).length) delete merged.components;
  return merged;
}

// ---------- APIs.json (platform) build / parse ----------

const STATE_EXT = 'x-api-platform';

// Build the platform APIs.json object. `mergedByMember` maps slug -> merged OpenAPI doc.
export function buildApisJson(state: PlatformState, mergedByMember: Map<string, any>): any {
  const groupName = (id: string) => state.groups.find((g) => g.id === id)?.name || 'General';

  const apis = state.members.map((m) => {
    const properties: any[] = [];
    const merged = mergedByMember.get(m.slug);
    if (merged && merged.paths && Object.keys(merged.paths).length) {
      properties.push({ type: 'OpenAPI', data: merged });
    }
    for (const p of m.props) {
      const entry: any = { type: p.type };
      if (p.url) entry.url = p.url;
      if (p.apiName) entry['x-api'] = p.apiName;
      properties.push(entry);
    }
    return {
      name: m.name,
      slug: m.slug,
      description: m.description || undefined,
      humanURL: `https://apis.io/providers/${m.slug}/`,
      image: m.image || undefined,
      tags: m.tags && m.tags.length ? m.tags.slice(0, 20) : undefined,
      'x-group': groupName(m.groupId),
      'x-operation-count': m.ops.length,
      properties,
    };
  });

  const doc: any = {
    name: state.name || 'My Company Platform',
    type: 'platform',
    description:
      state.description ||
      'The API platform this organization runs on — the providers, operations, and supporting properties that make up our stack.',
    specificationVersion: '0.21',
    tags: ['API Platform', 'Stack'],
    apis,
    // Lossless editor state so the file round-trips back into the UI.
    [STATE_EXT]: {
      version: 1,
      generatedBy: 'platform.apicommons.org',
      groups: state.groups,
      members: state.members.map((m) => ({
        slug: m.slug,
        name: m.name,
        description: m.description,
        image: m.image,
        tags: m.tags,
        groupId: m.groupId,
        ops: m.ops,
        props: m.props,
      })),
    },
  };
  return doc;
}

export function toYaml(doc: any): string {
  return stringifyYaml(doc, { lineWidth: 0 });
}

// Parse an uploaded apis.yml back into editor state.
export function parseApisJson(text: string): PlatformState {
  const doc = parseSpec(text);
  const ext = doc?.[STATE_EXT];
  if (ext && Array.isArray(ext.groups) && Array.isArray(ext.members)) {
    return {
      name: doc.name || '',
      description: doc.description || '',
      groups: ext.groups,
      members: ext.members.map((m: any) => ({
        slug: m.slug,
        name: m.name,
        description: m.description,
        image: m.image,
        tags: m.tags || [],
        groupId: m.groupId || 'general',
        ops: m.ops || [],
        props: m.props || [],
      })),
    };
  }
  // Fallback: reconstruct a best-effort board from a plain APIs.json.
  const groups = new Map<string, Group>();
  groups.set('general', { id: 'general', name: 'General' });
  const members: Member[] = [];
  for (const a of doc?.apis || []) {
    const gname = a['x-group'] || 'General';
    let gid = [...groups.values()].find((g) => g.name === gname)?.id;
    if (!gid) {
      gid = slugify(gname);
      groups.set(gid, { id: gid, name: gname });
    }
    members.push({
      slug: a.slug || slugify(a.name || 'provider'),
      name: a.name || a.slug || 'Provider',
      description: a.description,
      image: a.image,
      tags: a.tags || [],
      groupId: gid,
      ops: [],
      props: (a.properties || [])
        .filter((p: any) => p.type !== 'OpenAPI')
        .map((p: any) => ({ type: p.type, url: p.url, apiName: p['x-api'] })),
    });
  }
  return {
    name: doc?.name || '',
    description: doc?.description || '',
    groups: [...groups.values()],
    members,
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'group';
}

// ---------- Enterprise operation groupings (palette quick-filters) ----------
// Each maps a common area of enterprise operations to an APIs.io free-text query.

export interface Grouping {
  label: string;
  query: string;
}

export const GROUPINGS: Grouping[] = [
  { label: 'Payments & Billing', query: 'payments' },
  { label: 'Communications', query: 'messaging' },
  { label: 'Identity & Access', query: 'identity authentication' },
  { label: 'CRM & Sales', query: 'crm' },
  { label: 'Marketing', query: 'marketing' },
  { label: 'Commerce', query: 'ecommerce' },
  { label: 'Data & Analytics', query: 'analytics' },
  { label: 'AI & ML', query: 'artificial intelligence' },
  { label: 'DevOps & Cloud', query: 'infrastructure cloud' },
  { label: 'HR & People', query: 'human resources' },
  { label: 'Finance & Accounting', query: 'accounting' },
  { label: 'Support & Service', query: 'customer support' },
  { label: 'Logistics & Shipping', query: 'shipping logistics' },
  { label: 'Security & Compliance', query: 'security compliance' },
  { label: 'Documents & Storage', query: 'documents storage' },
  { label: 'Location & Maps', query: 'maps location' },
];
