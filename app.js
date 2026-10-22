'use strict';
const $ = id => document.getElementById(id);
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_GEMINI = 'gemini-2.5-flash';
const DEFAULT_PREAMBLE =
  'Mai jos sunt datele extrase din capturi de ecran cu statistici despre meciuri de fotbal și echipele implicate. ' +
  'Analizează-le și spune-mi ce concluzii poți trage despre meciuri și despre echipe.';
const PROMPT =
  'Imaginea este o captură cu statistici/informații despre un meci de fotbal sau despre echipe. Extrage DOAR datele statistice ' +
  'și informațiile despre meci/echipe/jucători și organizează-le pe capitole (ex: Rezultat, Statistici meci, Clasament, Formă recentă, ' +
  'Meciuri directe (H2H), Cote, Lot și accidentări, Program, Clasament marcatori etc.). IGNORĂ complet: reclame, meniuri, butoane, ' +
  'taburi de navigare, logo-uri, bannere de pariuri, ceasul/bateria/semnalul telefonului. ' +
  'Reguli: copiază valorile EXACT ca în imagine (numere, procente, scoruri, minute, cote) ca text; nu interpreta, nu rezuma, nu corecta, ' +
  'nu inventa; dacă ceva nu se poate citi scrie "[ilizibil]"; păstrează limba originală a etichetelor. ' +
  'Răspunde DOAR cu JSON valid, fără alt text, exact în forma: ' +
  '{"meci":{"gazde":"","oaspeti":"","scor":"","competitie":"","data":"","ora":"","stadion":""},' +
  '"capitole":[{"titlu":"","coloane":["..."],"randuri":[["..."]],"note":["..."]}]}. ' +
  'Detalii: câmpurile necunoscute din "meci" rămân "" (șir gol). Toate celulele sunt șiruri de caractere. ' +
  'Pentru comparații între cele două echipe folosește coloane ["Statistică","<nume gazde>","<nume oaspeți>"] cu un rând pe statistică. ' +
  'Pentru clasamente/tabele păstrează toate coloanele și toate rândurile din imagine. ' +
  'Dacă un capitol nu e tabel (ex: o informație text), folosește coloane [] și randuri [] și pune textul în "note". ' +
  'Dacă imaginea e despre o singură echipă, pune-o la "gazde" și lasă "oaspeti" gol.';

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};

let items = []; // {file, url, status, data, error}

/* ---------- Setări ---------- */
function loadSettings() {
  $('mode').value = store.get('mode', 'gemini');
  $('geminiKey').value = store.get('geminiKey', '');
  $('geminiModel').value = store.get('geminiModel', '');
  $('apiKey').value = store.get('apiKey', '');
  $('model').value = store.get('model', '');
  $('preamble').value = store.get('preamble', DEFAULT_PREAMBLE);
  refreshMode();
}
function showOpts() {
  const m = $('mode').value;
  $('claudeOpts').hidden = m !== 'claude';
  $('geminiOpts').hidden = m !== 'gemini';
}
function refreshMode() {
  showOpts();
  const m = store.get('mode', 'gemini');
  $('modeInfo').textContent =
    m === 'gemini' ? (store.get('geminiKey', '') ? 'Metodă: Gemini (gratuit).' : 'Metodă: Gemini – adaugă cheia gratuită din ⚙️ Setări (sau treci pe OCR local).')
    : m === 'claude' ? (store.get('apiKey', '') ? 'Metodă: Claude Vision (citire exactă).' : 'Metodă: Claude Vision – adaugă cheia API din ⚙️ Setări.')
    : 'Metodă: OCR local (rulează pe telefon; verifică numerele în rezultat).';
}
$('btnSettings').onclick = () => $('dlg').showModal();
$('mode').onchange = showOpts;
$('settings').addEventListener('submit', () => {
  store.set('mode', $('mode').value);
  store.set('apiKey', $('apiKey').value.trim());
  store.set('geminiKey', $('geminiKey').value.trim());
  store.set('geminiModel', $('geminiModel').value.trim());
  store.set('model', $('model').value.trim());
  store.set('preamble', $('preamble').value);
  refreshMode();
});

/* ---------- Imagini ---------- */
$('file').onchange = e => {
  for (const f of e.target.files) items.push({ file: f, url: URL.createObjectURL(f), status: '', data: null, error: '' });
  e.target.value = '';
  renderThumbs();
};
function renderThumbs() {
  const box = $('thumbs');
  box.innerHTML = '';
  items.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.innerHTML = '<img alt=""><button aria-label="Șterge">✕</button><span class="st"></span>';
    d.querySelector('img').src = it.url;
    const st = d.querySelector('.st');
    st.textContent = it.status || String(i + 1);
    if (it.status === '✓') st.classList.add('ok');
    if (it.status === '✗') st.classList.add('err');
    d.querySelector('button').onclick = () => { URL.revokeObjectURL(it.url); items.splice(i, 1); renderThumbs(); };
    box.appendChild(d);
  });
  $('count').textContent = items.length ? `${items.length} imagini selectate.` : '';
  $('btnClear').hidden = !items.length;
  $('btnRun').disabled = !items.length;
}

// Redimensionează la max 2000px și convertește în JPEG (mai mic = mai rapid, sub limita API).
async function toJpeg(file, max = 2000) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}
const blobToB64 = b => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result.split(',')[1]);
  fr.onerror = rej;
  fr.readAsDataURL(b);
});

$('btnClear').onclick = () => { items.forEach(i => URL.revokeObjectURL(i.url)); items = []; $('resultCard').hidden = true; $('status').textContent = ''; renderThumbs(); };

/* ---------- Extragere ---------- */
async function readWithClaude(file) {
  const key = store.get('apiKey', '');
  if (!key) throw new Error('Lipsește cheia API (⚙️ Setări).');
  const b64 = await blobToB64(await toJpeg(file));
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: store.get('model', '') || DEFAULT_MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: PROMPT }
      ] }]
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Eroare API (${r.status})`);
  return j.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

async function readWithGemini(file) {
  const key = store.get('geminiKey', '');
  if (!key) throw new Error('Lipsește cheia Gemini (⚙️ Setări).');
  const b64 = await blobToB64(await toJpeg(file));
  const model = store.get('geminiModel', '') || DEFAULT_GEMINI;
  let r, j;
  for (let t = 0; t < 3; t++) { // reîncearcă la limita pe minut (429) / suprasolicitare (503)
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    });
    j = await r.json().catch(() => ({}));
    if (r.status !== 429 && r.status !== 503) break;
    await new Promise(res => setTimeout(res, 15000 * (t + 1)));
  }
  if (!r.ok) throw new Error(j.error?.message || `Eroare API (${r.status})`);
  const out = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim();
  if (!out) throw new Error('Răspuns gol (imaginea poate fi blocată de filtre).');
  return out;
}

// Pregătire pentru OCR: mărire, tonuri de gri, inversare pe fundal închis, contrast.
async function prepForOcr(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(3, Math.max(1, 2400 / Math.max(bmp.width, bmp.height)) * (bmp.width < 1200 ? 1.5 : 1));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data, n = d.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    d[i] = g; hist[g]++;
  }
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * hist[v];
  const invert = sum / n < 128; // fundal închis → text deschis: inversăm
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.01) { hi = v; break; } }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let g = Math.max(0, Math.min(255, (d[i] - lo) * k));
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise(r => c.toBlob(r, 'image/png'));
}

let ocrWorker;
async function readWithOcr(file, onProgress) {
  if (!window.Tesseract) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Nu pot încărca motorul OCR (verifică internetul).'));
      document.head.appendChild(s);
    });
  }
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('ron+eng', 1, { logger: m => m.status === 'recognizing text' && onProgress(m.progress) });
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  }
  const { data } = await ocrWorker.recognize(await prepForOcr(file));
  return data.text.trim();
}

$('btnRun').onclick = async () => {
  const mode = store.get('mode', 'gemini');
  if ((mode === 'claude' && !store.get('apiKey', '')) || (mode === 'gemini' && !store.get('geminiKey', ''))) { $('dlg').showModal(); return; }
  $('btnRun').disabled = true;
  $('progress').hidden = false;
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    it.status = '…'; renderThumbs();
    $('status').textContent = `Citesc imaginea ${i + 1} din ${items.length}…`;
    const base = i / items.length;
    $('bar').style.width = base * 100 + '%';
    try {
      if (mode === 'ocr') {
        const raw = await readWithOcr(it.file, p => { $('bar').style.width = (base + p / items.length) * 100 + '%'; });
        it.data = { meci: {}, capitole: [{ titlu: 'Text citit prin OCR', coloane: [], randuri: [], note: raw.split('\n').filter(l => l.trim()) }] };
      } else {
        it.data = parseData(mode === 'claude' ? await readWithClaude(it.file) : await readWithGemini(it.file));
      }
      it.error = '';
      it.status = '✓';
    } catch (err) {
      failed++;
      it.data = null;
      it.error = err.message;
      it.status = '✗';
    }
    renderThumbs();
  }
  $('bar').style.width = '100%';
  $('status').textContent = failed ? `Gata, dar ${failed} imagini au eșuat (marcate cu ✗). Poți reîncerca.` : 'Gata!';
  $('btnRun').disabled = false;
  buildResult();
};

/* ---------- Date → structură ---------- */
function parseData(raw) {
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  try {
    const o = JSON.parse(i >= 0 ? t.slice(i, j + 1) : t);
    const str = v => (v == null ? '' : String(v).trim());
    const meci = {};
    for (const k of ['gazde', 'oaspeti', 'scor', 'competitie', 'data', 'ora', 'stadion']) meci[k] = str(o.meci?.[k]);
    const capitole = (Array.isArray(o.capitole) ? o.capitole : []).map(c => ({
      titlu: str(c.titlu) || 'Alte informații',
      coloane: (c.coloane || []).map(str),
      randuri: (c.randuri || []).map(r => (Array.isArray(r) ? r : [r]).map(str)),
      note: (c.note || []).map(str).filter(Boolean)
    }));
    return { meci, capitole };
  } catch {
    // Răspuns care nu e JSON: păstrăm textul ca atare, ca să nu pierdem nimic.
    return { meci: {}, capitole: [{ titlu: 'Text citit', coloane: [], randuri: [], note: raw.split('\n').filter(l => l.trim()) }] };
  }
}

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const META_KEYS = ['scor', 'competitie', 'data', 'ora', 'stadion'];

// Grupează imaginile pe meci și îmbină capitolele cu același titlu și aceleași coloane.
function groupByMatch() {
  const groups = new Map();
  for (const it of items) {
    if (!it.data) continue;
    const m = it.data.meci;
    const key = m.gazde && m.oaspeti ? norm(m.gazde) + '|' + norm(m.oaspeti) : m.gazde ? norm(m.gazde) : '';
    if (!groups.has(key)) groups.set(key, { meci: { gazde: '', oaspeti: '', scor: '', competitie: '', data: '', ora: '', stadion: '' }, capitole: [] });
    const g = groups.get(key);
    for (const k of ['gazde', 'oaspeti', ...META_KEYS]) if (!g.meci[k] && m[k]) g.meci[k] = m[k];
    for (const c of it.data.capitole) {
      const same = g.capitole.find(x => norm(x.titlu) === norm(c.titlu) && JSON.stringify(x.coloane.map(norm)) === JSON.stringify(c.coloane.map(norm)));
      if (same) {
        const seen = new Set(same.randuri.map(r => r.join('\u0001')));
        for (const r of c.randuri) if (!seen.has(r.join('\u0001'))) { same.randuri.push(r); seen.add(r.join('\u0001')); }
        for (const n of c.note) if (!same.note.includes(n)) same.note.push(n);
      } else g.capitole.push({ ...c, randuri: [...c.randuri], note: [...c.note] });
    }
  }
  return [...groups.values()];
}

const title = m => (m.gazde && m.oaspeti ? `${m.gazde} – ${m.oaspeti}` : m.gazde || 'Date generale');
const num = s => { const n = parseFloat(String(s).replace(',', '.').replace('%', '')); return isNaN(n) ? null : n; };
const isCmp = c => c.coloane.length === 3 && c.randuri.length && c.randuri.filter(r => r.length === 3 && num(r[1]) !== null && num(r[2]) !== null).length >= c.randuri.length * 0.5;

/* ---------- Afișare vizuală ---------- */
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
function renderChapter(c, openByDefault) {
  const d = el('details', 'chap');
  d.open = openByDefault;
  d.appendChild(el('summary', null, c.titlu));
  const body = el('div', 'cbody');
  if (isCmp(c)) {
    const lg = el('div', 'legend');
    lg.append(el('span', null, c.coloane[1]), el('span', null, c.coloane[2]));
    body.appendChild(lg);
    for (const r of c.randuri) {
      const box = el('div', 'cmp');
      const row = el('div', 'row');
      row.append(el('span', 'v', r[1] ?? ''), el('span', 'l', r[0] ?? ''), el('span', 'v', r[2] ?? ''));
      box.appendChild(row);
      const a = num(r[1]), b = num(r[2]);
      if (a !== null && b !== null && a + b > 0) {
        const bar = el('div', 'bar');
        const x = el('i'), y = el('i');
        x.style.width = (a / (a + b)) * 100 + '%'; y.style.width = (b / (a + b)) * 100 + '%';
        bar.append(x, y);
        box.appendChild(bar);
      }
      body.appendChild(box);
    }
  } else if (c.randuri.length) {
    const w = el('div', 'tw'), t = el('table');
    if (c.coloane.length) {
      const tr = el('tr');
      c.coloane.forEach(h => tr.appendChild(el('th', null, h)));
      t.appendChild(el('thead')).appendChild(tr);
    }
    const tb = el('tbody');
    for (const r of c.randuri) { const tr = el('tr'); r.forEach(v => tr.appendChild(el('td', null, v))); tb.appendChild(tr); }
    t.appendChild(tb); w.appendChild(t); body.appendChild(w);
  }
  if (c.note.length) { const ul = el('ul', 'notes'); c.note.forEach(n => ul.appendChild(el('li', null, n))); body.appendChild(ul); }
  d.appendChild(body);
  return d;
}
function renderView(groups) {
  const v = $('view');
  v.innerHTML = '';
  for (const g of groups) {
    const card = el('div', 'match'), head = el('div', 'mhead'), tm = el('div', 'teams');
    if (g.meci.gazde && g.meci.oaspeti) {
      tm.append(el('div', 't', g.meci.gazde), el('div', 'sc', g.meci.scor || 'vs'), el('div', 't', g.meci.oaspeti));
    } else {
      tm.style.display = 'block';
      tm.appendChild(el('div', 't', title(g.meci) + (g.meci.scor ? '  ' + g.meci.scor : '')));
    }
    head.appendChild(tm);
    const meta = el('div', 'meta');
    for (const k of ['competitie', 'data', 'ora', 'stadion']) if (g.meci[k]) meta.appendChild(el('span', null, g.meci[k]));
    if (meta.childNodes.length) head.appendChild(meta);
    card.appendChild(head);
    g.capitole.forEach((c, i) => card.appendChild(renderChapter(c, i < 3)));
    v.appendChild(card);
  }
  const errs = items.filter(i => i.error);
  if (errs.length) {
    const b = el('div', 'errbox');
    b.appendChild(el('strong', null, `${errs.length} imagini nu au putut fi citite:`));
    errs.forEach(i => b.appendChild(el('div', null, `• ${i.file.name || 'imagine'}: ${i.error}`)));
    v.appendChild(b);
  }
}

/* ---------- Text (Markdown) pentru AI ---------- */
const cell = s => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
function toMarkdown(groups) {
  const out = [];
  for (const g of groups) {
    out.push(`# ${title(g.meci)}`);
    if (g.meci.gazde && g.meci.oaspeti) out.push(`- Gazde: ${g.meci.gazde}\n- Oaspeți: ${g.meci.oaspeti}`);
    const info = { scor: 'Scor', competitie: 'Competiție', data: 'Data', ora: 'Ora', stadion: 'Stadion' };
    const lines = Object.entries(info).filter(([k]) => g.meci[k]).map(([k, l]) => `- ${l}: ${g.meci[k]}`);
    if (lines.length) out.push(lines.join('\n'));
    for (const c of g.capitole) {
      out.push(`## ${c.titlu}`);
      if (c.randuri.length) {
        const cols = c.coloane.length ? c.coloane : c.randuri[0].map((_, i) => `Col ${i + 1}`);
        out.push([`| ${cols.map(cell).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...c.randuri.map(r => `| ${cols.map((_, i) => cell(r[i] ?? '')).join(' | ')} |`)].join('\n'));
      }
      if (c.note.length) out.push(c.note.map(n => `- ${n}`).join('\n'));
    }
  }
  const errs = items.filter(i => i.error);
  if (errs.length) out.push('## Imagini necitite\n' + errs.map(i => `- ${i.file.name || 'imagine'}: ${i.error}`).join('\n'));
  return out.join('\n\n');
}

function buildResult() {
  const groups = groupByMatch();
  const pre = store.get('preamble', DEFAULT_PREAMBLE).trim();
  renderView(groups);
  $('result').value = (pre ? pre + '\n\n---\n\n' : '') + toMarkdown(groups) + '\n';
  $('resultCard').hidden = false;
  showTab('view');
  $('resultCard').scrollIntoView({ behavior: 'smooth' });
}
function showTab(t) {
  $('view').hidden = t !== 'view';
  $('textPane').hidden = t !== 'text';
  $('tabView').classList.toggle('on', t === 'view');
  $('tabText').classList.toggle('on', t === 'text');
}
$('tabView').onclick = () => showTab('view');
$('tabText').onclick = () => showTab('text');

/* ---------- Export ---------- */
const text = () => $('result').value;
function download(name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text()], { type: type + ';charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(text()); } catch { $('result').select(); document.execCommand('copy'); }
  $('status').textContent = 'Copiat în clipboard.';
};
$('btnTxt').onclick = () => download('date-fotbal.txt', 'text/plain');
$('btnMd').onclick = () => download('date-fotbal.md', 'text/markdown');
$('btnShare').onclick = async () => {
  const file = new File([text()], 'date-fotbal.txt', { type: 'text/plain' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Date fotbal' });
    else if (navigator.share) await navigator.share({ title: 'Date fotbal', text: text() });
    else $('btnCopy').click();
  } catch {}
};
// PDF: folosește dialogul de tipărire al telefonului → „Salvează ca PDF" (păstrează diacriticele).
$('btnPdf').onclick = () => {
  const p = $('printArea');
  p.innerHTML = $('view').innerHTML;
  p.querySelectorAll('details').forEach(d => { d.open = true; });
  window.print();
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
loadSettings();
renderThumbs();
