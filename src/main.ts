import './style.css';
import {
  searchProviders,
  listProviderApis,
  getApiDetail,
  loadSpec,
  operationsOf,
  buildMergedOpenApi,
  buildApisJson,
  parseApisJson,
  toYaml,
  slugify,
  GROUPINGS,
  type ProviderCard,
  type ApiSummary,
  type ApiDetail,
  type ApiProperty,
  type Member,
  type PlatformState,
  type SelectedOp,
} from './api';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = (tag: string, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ---------- State ----------

const state: PlatformState = {
  name: '',
  description: '',
  groups: [{ id: 'general', name: 'General' }],
  members: [],
};

const opKey = (o: { specUrl: string; method: string; path: string }) => `${o.specUrl}|${o.method}|${o.path}`;
const propKey = (p: { type: string; url?: string }) => `${p.type}|${p.url || ''}`;

// ---------- Toast ----------

let toastTimer: number | undefined;
function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 2600);
}

// ---------- Palette ----------

let paletteQuery = '';
let palettePage = 1;
let paletteTotal = 0;
let palettePages = 1;
let paletteBusy = false;
let searchTimer: number | undefined;

async function runSearch(reset = true) {
  if (paletteBusy) return;
  paletteBusy = true;
  const list = $('#palette-list');
  const moreBtn = $<HTMLButtonElement>('#palette-more-btn');
  if (reset) {
    palettePage = 1;
    list.innerHTML = '<div class="loading">Searching…</div>';
  } else {
    moreBtn.textContent = 'Loading…';
  }
  try {
    const { total, pages, data } = await searchProviders(paletteQuery, palettePage, 40);
    paletteTotal = total;
    palettePages = pages;
    if (reset) list.innerHTML = '';
    if (!data.length && reset) list.innerHTML = '<div class="empty">No providers match. Try another term.</div>';
    for (const p of data) list.appendChild(providerCardEl(p));
    $('#palette-total').textContent = paletteTotal ? `· ${paletteTotal.toLocaleString()}` : '';
    moreBtn.hidden = palettePage >= palettePages;
    moreBtn.textContent = 'Load more';
  } catch (e: any) {
    if (reset) list.innerHTML = `<div class="empty">Search failed: ${e.message}</div>`;
    toast('APIs.io search failed');
  } finally {
    paletteBusy = false;
  }
}

function providerCardEl(p: ProviderCard): HTMLElement {
  const card = el('div', 'pcard');
  card.draggable = true;
  card.dataset.slug = p.slug;
  const onBoard = state.members.some((m) => m.slug === p.slug);
  if (onBoard) card.classList.add('on-board');

  const img = el('img', 'pcard-img') as HTMLImageElement;
  img.src = p.image || '';
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = () => (img.style.visibility = 'hidden');

  const body = el('div', 'pcard-body');
  const top = el('div', 'pcard-top');
  top.appendChild(el('span', 'pcard-name', p.name));
  if (p.score?.composite != null) {
    const s = el('span', `pcard-score band-${p.score.band || ''}`, String(Math.round(p.score.composite)));
    s.title = `APIs.io score: ${p.score.composite} (${p.score.band || ''})`;
    top.appendChild(s);
  }
  body.appendChild(top);
  const meta = el('div', 'pcard-meta muted small');
  meta.textContent = `${p.api_count ?? 0} API${p.api_count === 1 ? '' : 's'}${p.tags?.length ? ' · ' + p.tags.slice(0, 3).join(', ') : ''}`;
  body.appendChild(meta);

  const add = el('button', 'pcard-add', onBoard ? '✓' : '+') as HTMLButtonElement;
  add.title = onBoard ? 'Already on the board' : 'Add to General';
  add.disabled = onBoard;
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    addMember(p, 'general');
  });

  card.appendChild(img);
  card.appendChild(body);
  card.appendChild(add);

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData('application/x-app', JSON.stringify({ kind: 'provider', card: p }));
    e.dataTransfer!.effectAllowed = 'copy';
  });
  return card;
}

// ---------- Members ----------

function addMember(p: ProviderCard, groupId: string) {
  if (state.members.some((m) => m.slug === p.slug)) {
    toast(`${p.name} is already on the board`);
    return;
  }
  const m: Member = {
    slug: p.slug,
    name: p.name,
    description: p.description,
    image: p.image,
    tags: p.tags || [],
    groupId,
    ops: [],
    props: [],
  };
  state.members.push(m);
  renderBoard();
  refreshPaletteBadges();
  updateCounts();
}

function moveMember(slug: string, groupId: string) {
  const m = state.members.find((x) => x.slug === slug);
  if (m && m.groupId !== groupId) {
    m.groupId = groupId;
    renderBoard();
    updateCounts();
  }
}

function removeMember(slug: string) {
  const i = state.members.findIndex((m) => m.slug === slug);
  if (i >= 0) {
    state.members.splice(i, 1);
    renderBoard();
    refreshPaletteBadges();
    updateCounts();
  }
}

function refreshPaletteBadges() {
  document.querySelectorAll<HTMLElement>('.pcard').forEach((c) => {
    const on = state.members.some((m) => m.slug === c.dataset.slug);
    c.classList.toggle('on-board', on);
    const add = c.querySelector('.pcard-add') as HTMLButtonElement;
    if (add) {
      add.textContent = on ? '✓' : '+';
      add.disabled = on;
      add.title = on ? 'Already on the board' : 'Add to General';
    }
  });
}

// ---------- Board ----------

function renderBoard() {
  const board = $('#board');
  board.innerHTML = '';
  for (const g of state.groups) {
    board.appendChild(groupEl(g));
  }
  const hint = el('p', 'board-hint muted small');
  hint.innerHTML =
    'Drag providers from the left into a group. Drag chips between groups. Click a provider to choose its operations and properties.';
  board.appendChild(hint);
}

function groupEl(g: Group): HTMLElement {
  const wrap = el('section', 'group');
  wrap.dataset.groupId = g.id;

  const head = el('div', 'group-head');
  const title = el('input', 'group-title') as HTMLInputElement;
  title.value = g.name;
  title.addEventListener('change', () => {
    g.name = title.value.trim() || 'Untitled';
  });
  head.appendChild(title);

  const members = state.members.filter((m) => m.groupId === g.id);
  head.appendChild(el('span', 'group-count muted small', String(members.length)));

  if (g.id !== 'general') {
    const del = el('button', 'mini-btn danger', 'Remove') as HTMLButtonElement;
    del.title = 'Remove group (its providers move to General)';
    del.addEventListener('click', () => {
      state.members.forEach((m) => {
        if (m.groupId === g.id) m.groupId = 'general';
      });
      state.groups = state.groups.filter((x) => x.id !== g.id);
      renderBoard();
      updateCounts();
    });
    head.appendChild(del);
  }
  wrap.appendChild(head);

  const zone = el('div', 'group-zone');
  if (!members.length) zone.appendChild(el('div', 'group-empty muted small', 'Drop providers here'));
  for (const m of members) zone.appendChild(memberChipEl(m));

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drop-hot');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop-hot'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drop-hot');
    const raw = e.dataTransfer?.getData('application/x-app');
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload.kind === 'provider') addMember(payload.card, g.id);
    else if (payload.kind === 'member') moveMember(payload.slug, g.id);
  });
  wrap.appendChild(zone);
  return wrap;
}

function memberChipEl(m: Member): HTMLElement {
  const chip = el('div', 'mchip');
  chip.draggable = true;
  chip.dataset.slug = m.slug;

  const img = el('img', 'mchip-img') as HTMLImageElement;
  img.src = m.image || '';
  img.alt = '';
  img.onerror = () => (img.style.visibility = 'hidden');
  chip.appendChild(img);

  const body = el('div', 'mchip-body');
  body.appendChild(el('span', 'mchip-name', m.name));
  const badges = el('div', 'mchip-badges');
  const opb = el('span', 'mbadge' + (m.ops.length ? ' on' : ''), `${m.ops.length} ops`);
  const prb = el('span', 'mbadge' + (m.props.length ? ' on prop' : ''), `${m.props.length} props`);
  badges.appendChild(opb);
  badges.appendChild(prb);
  body.appendChild(badges);
  chip.appendChild(body);

  const rm = el('button', 'mchip-x', '×') as HTMLButtonElement;
  rm.title = 'Remove from board';
  rm.addEventListener('click', (e) => {
    e.stopPropagation();
    removeMember(m.slug);
  });
  chip.appendChild(rm);

  chip.addEventListener('click', () => openDetail(m));
  chip.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData('application/x-app', JSON.stringify({ kind: 'member', slug: m.slug }));
    e.dataTransfer!.effectAllowed = 'move';
  });
  return chip;
}

// ---------- Detail drawer (operations + properties) ----------

let detailMember: Member | null = null;
const detailCache = new Map<string, ApiDetail>(); // aid -> detail
const aggProps = new Map<string, { type: string; url?: string; apiName?: string }>();

async function openDetail(m: Member) {
  detailMember = m;
  detailCache.clear();
  aggProps.clear();
  $('#detail-title').textContent = m.name;
  $('#detail-sub').innerHTML = `<a href="https://apis.io/providers/${m.slug}/" target="_blank" rel="noopener">apis.io/providers/${m.slug}</a>`;
  $('#detail-back').hidden = false;
  ($('#op-filter') as HTMLInputElement).value = '';
  const opsList = $('#ops-list');
  const propsList = $('#props-list');
  opsList.innerHTML = '<div class="loading">Loading APIs…</div>';
  propsList.innerHTML = '<div class="loading">Expand APIs to collect their properties…</div>';
  updateDetailCount();

  // Seed already-selected properties so they appear even before their API is expanded.
  for (const p of m.props) aggProps.set(propKey(p), { type: p.type, url: p.url, apiName: p.apiName });
  renderProps();

  try {
    const apis = await listProviderApis(m.slug);
    renderApiList(apis);
  } catch (e: any) {
    opsList.innerHTML = `<div class="empty">Could not load APIs: ${e.message}</div>`;
  }
}

function renderApiList(apis: ApiSummary[]) {
  const opsList = $('#ops-list');
  opsList.innerHTML = '';
  if (!apis.length) {
    opsList.innerHTML = '<div class="empty">This provider has no APIs indexed.</div>';
    return;
  }
  const bar = el('div', 'ops-bar');
  const loadAll = el('button', 'mini-btn', 'Expand all APIs') as HTMLButtonElement;
  loadAll.addEventListener('click', async () => {
    loadAll.disabled = true;
    loadAll.textContent = 'Loading…';
    for (const sec of Array.from(opsList.querySelectorAll<HTMLElement>('.api-sec[data-collapsed="1"]'))) {
      await expandApi(sec);
    }
    loadAll.textContent = 'Expanded';
  });
  bar.appendChild(loadAll);
  bar.appendChild(el('span', 'muted small', `${apis.length} API${apis.length === 1 ? '' : 's'}`));
  opsList.appendChild(bar);

  for (const a of apis) opsList.appendChild(apiSectionEl(a));
}

function apiSectionEl(a: ApiSummary): HTMLElement {
  const sec = el('section', 'api-sec');
  sec.dataset.aid = a.aid;
  sec.dataset.collapsed = '1';

  const head = el('div', 'api-sec-head');
  const chev = el('span', 'chev', '▸');
  head.appendChild(chev);
  head.appendChild(el('span', 'api-sec-name', a.name));
  const hasOpenapi = (a.artifact_types || []).includes('OpenAPI');
  const sel = detailMember!.ops.filter((o) => o.aid === a.aid).length;
  const cnt = el('span', 'api-sec-cnt muted small', sel ? `${sel} selected` : hasOpenapi ? '' : 'no OpenAPI');
  head.appendChild(cnt);
  head.addEventListener('click', () => expandApi(sec));
  sec.appendChild(head);

  const bodyWrap = el('div', 'api-sec-body');
  bodyWrap.hidden = true;
  sec.appendChild(bodyWrap);
  return sec;
}

async function expandApi(sec: HTMLElement) {
  const aid = sec.dataset.aid!;
  const bodyWrap = sec.querySelector('.api-sec-body') as HTMLElement;
  const chev = sec.querySelector('.chev') as HTMLElement;
  const collapsed = sec.dataset.collapsed === '1';
  if (!collapsed) {
    sec.dataset.collapsed = '1';
    bodyWrap.hidden = true;
    chev.textContent = '▸';
    return;
  }
  sec.dataset.collapsed = '0';
  chev.textContent = '▾';
  bodyWrap.hidden = false;

  if (bodyWrap.dataset.loaded !== '1') {
    bodyWrap.innerHTML = '<div class="loading small">Loading operations…</div>';
    try {
      let detail = detailCache.get(aid);
      if (!detail) {
        detail = await getApiDetail(aid);
        detailCache.set(aid, detail);
      }
      collectProps(detail);
      renderProps();
      await renderApiOps(bodyWrap, detail);
      bodyWrap.dataset.loaded = '1';
    } catch (e: any) {
      bodyWrap.innerHTML = `<div class="empty small">Failed to load: ${e.message}</div>`;
    }
  }
  applyOpFilter();
}

function collectProps(detail: ApiDetail) {
  for (const p of detail.properties || []) {
    if (p.type === 'OpenAPI') continue;
    const k = propKey({ type: p.type, url: p.url });
    if (!aggProps.has(k)) aggProps.set(k, { type: p.type, url: p.url, apiName: detail.name });
  }
}

async function renderApiOps(bodyWrap: HTMLElement, detail: ApiDetail) {
  bodyWrap.innerHTML = '';
  const specs = (detail.properties || []).filter((p) => p.type === 'OpenAPI');
  if (!specs.length) {
    bodyWrap.innerHTML = '<div class="empty small">No OpenAPI for this API.</div>';
    return;
  }
  for (const prop of specs) {
    const specUrl = prop.url || `inline:${detail.aid}`;
    const box = el('div', 'spec-ops');
    box.innerHTML = '<div class="loading small">Parsing OpenAPI…</div>';
    bodyWrap.appendChild(box);
    let doc: any;
    try {
      doc = await loadSpec(prop);
    } catch (e: any) {
      box.innerHTML = `<div class="empty small">Could not parse OpenAPI: ${e.message}</div>`;
      continue;
    }
    const ops = operationsOf(doc);
    box.innerHTML = '';
    if (specs.length > 1) {
      const label = el('div', 'spec-label muted small', shortUrl(specUrl));
      box.appendChild(label);
    }
    // select-all row
    const allRow = el('label', 'op-row op-all');
    const allCb = el('input') as HTMLInputElement;
    allCb.type = 'checkbox';
    const selectedHere = () => detailMember!.ops.filter((o) => o.specUrl === specUrl).length;
    allCb.checked = ops.length > 0 && selectedHere() === ops.length;
    allCb.addEventListener('change', () => {
      // Row handlers resync allCb.checked mid-loop; capture the target first.
      const want = allCb.checked;
      for (const cb of Array.from(box.querySelectorAll<HTMLInputElement>('.op-row:not(.op-all) input'))) {
        if (cb.checked !== want) {
          cb.checked = want;
          cb.dispatchEvent(new Event('change'));
        }
      }
      allCb.checked = want;
    });
    allRow.appendChild(allCb);
    allRow.appendChild(el('span', 'op-all-label', `All ${ops.length} operations`));
    box.appendChild(allRow);

    for (const op of ops) {
      const so: SelectedOp = {
        aid: detail.aid,
        apiName: detail.name,
        specUrl,
        method: op.method,
        path: op.path,
        operationId: op.operationId,
        summary: op.summary,
      };
      box.appendChild(opRowEl(so, () => {
        allCb.checked = ops.length > 0 && selectedHere() === ops.length;
        updateApiSecCount(detail.aid);
      }));
    }
  }
}

function opRowEl(so: SelectedOp, after: () => void): HTMLElement {
  const row = el('label', 'op-row');
  row.dataset.text = `${so.method} ${so.path} ${so.operationId || ''} ${so.summary || ''}`.toLowerCase();
  const cb = el('input') as HTMLInputElement;
  cb.type = 'checkbox';
  cb.checked = detailMember!.ops.some((o) => opKey(o) === opKey(so));
  cb.addEventListener('change', () => {
    const key = opKey(so);
    const idx = detailMember!.ops.findIndex((o) => opKey(o) === key);
    if (cb.checked && idx < 0) detailMember!.ops.push(so);
    else if (!cb.checked && idx >= 0) detailMember!.ops.splice(idx, 1);
    updateDetailCount();
    syncMemberBadges();
    after();
  });
  row.appendChild(cb);
  const m = el('span', `method ${so.method.toLowerCase()}`, so.method);
  row.appendChild(m);
  row.appendChild(el('span', 'op-path', so.path));
  if (so.summary) row.appendChild(el('span', 'op-sum muted small', so.summary));
  return row;
}

function updateApiSecCount(aid: string) {
  const sec = document.querySelector<HTMLElement>(`.api-sec[data-aid="${cssEsc(aid)}"]`);
  if (!sec) return;
  const cnt = sec.querySelector('.api-sec-cnt') as HTMLElement;
  const n = detailMember!.ops.filter((o) => o.aid === aid).length;
  cnt.textContent = n ? `${n} selected` : '';
}

function renderProps() {
  const propsList = $('#props-list');
  propsList.innerHTML = '';
  const items = [...aggProps.values()].sort((a, b) => a.type.localeCompare(b.type));
  if (!items.length) {
    propsList.innerHTML = '<div class="empty small">Expand an API on the left to collect its properties.</div>';
    return;
  }
  for (const p of items) {
    const row = el('label', 'prop-row');
    const cb = el('input') as HTMLInputElement;
    cb.type = 'checkbox';
    cb.checked = detailMember!.props.some((x) => propKey(x) === propKey(p));
    cb.addEventListener('change', () => {
      const key = propKey(p);
      const idx = detailMember!.props.findIndex((x) => propKey(x) === key);
      if (cb.checked && idx < 0) detailMember!.props.push({ type: p.type, url: p.url, apiName: p.apiName });
      else if (!cb.checked && idx >= 0) detailMember!.props.splice(idx, 1);
      updateDetailCount();
      syncMemberBadges();
    });
    row.appendChild(cb);
    row.appendChild(el('span', 'prop-type', p.type));
    if (p.url) {
      const a = el('a', 'prop-url muted small', shortUrl(p.url)) as HTMLAnchorElement;
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.addEventListener('click', (e) => e.stopPropagation());
      row.appendChild(a);
    }
    propsList.appendChild(row);
  }
}

function updateDetailCount() {
  if (!detailMember) return;
  $('#detail-count').textContent = `${detailMember.ops.length} ops · ${detailMember.props.length} props`;
}

function syncMemberBadges() {
  if (!detailMember) return;
  const chip = document.querySelector<HTMLElement>(`.mchip[data-slug="${cssEsc(detailMember.slug)}"]`);
  if (!chip) return;
  const badges = chip.querySelectorAll('.mbadge');
  if (badges[0]) {
    badges[0].textContent = `${detailMember.ops.length} ops`;
    badges[0].classList.toggle('on', detailMember.ops.length > 0);
  }
  if (badges[1]) {
    badges[1].textContent = `${detailMember.props.length} props`;
    badges[1].classList.toggle('on', detailMember.props.length > 0);
  }
}

function applyOpFilter() {
  const q = ($('#op-filter') as HTMLInputElement).value.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>('#ops-list .op-row:not(.op-all)').forEach((r) => {
    r.style.display = !q || (r.dataset.text || '').includes(q) ? '' : 'none';
  });
}

function closeDetail() {
  $('#detail-back').hidden = true;
  detailMember = null;
  renderBoard(); // reflect badge counts
  updateCounts();
}

// ---------- Download / Upload ----------

async function buildPlatformYaml(): Promise<string> {
  syncPlatformMeta();
  const mergedByMember = new Map<string, any>();
  for (const m of state.members) {
    if (!m.ops.length) continue;
    // Ensure every source spec is parsed & cached.
    const specs = new Map<string, any>();
    const bySpec = new Map<string, SelectedOp[]>();
    for (const o of m.ops) {
      if (!bySpec.has(o.specUrl)) bySpec.set(o.specUrl, []);
      bySpec.get(o.specUrl)!.push(o);
    }
    for (const specUrl of bySpec.keys()) {
      try {
        const prop: ApiProperty = specUrl.startsWith('inline:') ? await inlineSpecProp(specUrl) : { type: 'OpenAPI', url: specUrl };
        specs.set(specUrl, await loadSpec(prop));
      } catch {
        /* skip unresolved spec */
      }
    }
    mergedByMember.set(m.slug, buildMergedOpenApi(m.name, m.ops, specs));
  }
  return toYaml(buildApisJson(state, mergedByMember));
}

async function download() {
  const btn = $<HTMLButtonElement>('#download-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    const yaml = await buildPlatformYaml();
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slugify(state.name || 'platform')}-apis.yml`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Downloaded platform definition');
  } catch (e: any) {
    toast(`Build failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function viewYaml() {
  const btn = $<HTMLButtonElement>('#view-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    $('#yaml-body').textContent = await buildPlatformYaml();
    $('#yaml-back').hidden = false;
  } catch (e: any) {
    toast(`Build failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Recover an inline spec by re-fetching the API detail it came from.
async function inlineSpecProp(specUrl: string): Promise<ApiProperty> {
  const aid = specUrl.slice('inline:'.length);
  const detail = detailCache.get(aid) || (await getApiDetail(aid));
  detailCache.set(aid, detail);
  const p = (detail.properties || []).find((x) => x.type === 'OpenAPI');
  if (!p) throw new Error('inline spec not found');
  return p;
}

function uploadFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseApisJson(String(reader.result));
      state.name = parsed.name;
      state.description = parsed.description;
      state.groups = parsed.groups.length ? parsed.groups : [{ id: 'general', name: 'General' }];
      if (!state.groups.some((g) => g.id === 'general')) state.groups.unshift({ id: 'general', name: 'General' });
      state.members = parsed.members;
      ($('#plat-name') as HTMLInputElement).value = state.name;
      ($('#plat-desc') as HTMLInputElement).value = state.description;
      renderBoard();
      refreshPaletteBadges();
      updateCounts();
      toast(`Loaded ${state.members.length} providers from apis.yml`);
    } catch (e: any) {
      toast(`Could not read file: ${e.message}`);
    }
  };
  reader.readAsText(file);
}

// ---------- Misc ----------

function syncPlatformMeta() {
  state.name = ($('#plat-name') as HTMLInputElement).value.trim();
  state.description = ($('#plat-desc') as HTMLInputElement).value.trim();
}

function updateCounts() {
  const ops = state.members.reduce((n, m) => n + m.ops.length, 0);
  const props = state.members.reduce((n, m) => n + m.props.length, 0);
  $('#counts').innerHTML = `<b>${state.members.length}</b> providers · <b>${state.groups.length}</b> groups · <b>${ops}</b> ops · <b>${props}</b> props`;
}

function addGroup() {
  const base = 'Group';
  let n = state.groups.length;
  let name = `${base} ${n}`;
  while (state.groups.some((g) => g.name === name)) name = `${base} ${++n}`;
  let id = slugify(name);
  while (state.groups.some((g) => g.id === id)) id = slugify(name) + '-' + Math.floor(n++);
  state.groups.push({ id, name });
  renderBoard();
  updateCounts();
}

const shortUrl = (u: string) =>
  u.replace(/^https?:\/\//, '').replace('raw.githubusercontent.com/', '').replace(/\?.*$/, '');
const cssEsc = (s: string) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

// ---------- Wire up ----------

function renderGroupings() {
  const box = $('#grouping-chips');
  const all = el('button', 'gchip active', 'All') as HTMLButtonElement;
  all.addEventListener('click', () => {
    document.querySelectorAll('.gchip').forEach((c) => c.classList.remove('active'));
    all.classList.add('active');
    paletteQuery = '';
    ($('#prov-search') as HTMLInputElement).value = '';
    runSearch(true);
  });
  box.appendChild(all);
  for (const g of GROUPINGS) {
    const b = el('button', 'gchip', g.label) as HTMLButtonElement;
    b.title = `Search: ${g.query}`;
    b.addEventListener('click', () => {
      document.querySelectorAll('.gchip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      paletteQuery = g.query;
      ($('#prov-search') as HTMLInputElement).value = g.query;
      runSearch(true);
    });
    box.appendChild(b);
  }
}

function init() {
  renderGroupings();
  renderBoard();
  updateCounts();
  runSearch(true);

  const search = $('#prov-search') as HTMLInputElement;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      document.querySelectorAll('.gchip').forEach((c) => c.classList.remove('active'));
      paletteQuery = search.value;
      runSearch(true);
    }, 300);
  });
  $('#palette-more-btn').addEventListener('click', () => {
    palettePage++;
    runSearch(false);
  });

  $('#plat-name').addEventListener('input', syncPlatformMeta);
  $('#plat-desc').addEventListener('input', syncPlatformMeta);
  $('#add-group').addEventListener('click', addGroup);
  $('#download-btn').addEventListener('click', download);
  $('#view-btn').addEventListener('click', viewYaml);
  $('#yaml-x').addEventListener('click', () => ($('#yaml-back').hidden = true));
  $('#yaml-back').addEventListener('click', (e) => {
    if (e.target === $('#yaml-back')) $('#yaml-back').hidden = true;
  });
  $('#yaml-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('#yaml-body').textContent || '');
    toast('Copied apis.yml to clipboard');
  });
  $('#yaml-download').addEventListener('click', () => {
    const blob = new Blob([$('#yaml-body').textContent || ''], { type: 'text/yaml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slugify(state.name || 'platform')}-apis.yml`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#upload-btn').addEventListener('click', () => ($('#upload-file') as HTMLInputElement).click());
  $('#upload-file').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) uploadFile(f);
    (e.target as HTMLInputElement).value = '';
  });

  $('#op-filter').addEventListener('input', applyOpFilter);
  $('#detail-x').addEventListener('click', closeDetail);
  $('#detail-done').addEventListener('click', closeDetail);
  $('#detail-back').addEventListener('click', (e) => {
    if (e.target === $('#detail-back')) closeDetail();
  });

  $('#nav-about').addEventListener('click', (e) => {
    e.preventDefault();
    $('#about-back').hidden = false;
  });
  $('#about-x').addEventListener('click', () => ($('#about-back').hidden = true));
  $('#about-back').addEventListener('click', (e) => {
    if (e.target === $('#about-back')) $('#about-back').hidden = true;
  });
  $('#engage-ae').addEventListener('click', () => {
    location.href =
      'mailto:info@apievangelist.com?subject=' +
      encodeURIComponent('Defining our API platform — API Platform tool');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#yaml-back').hidden) $('#yaml-back').hidden = true;
      else if (!$('#detail-back').hidden) closeDetail();
      else if (!$('#about-back').hidden) $('#about-back').hidden = true;
    }
  });
}

// Group type alias for local use.
type Group = PlatformState['groups'][number];

init();
