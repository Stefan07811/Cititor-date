'use strict';
const $ = id => document.getElementById(id);
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_PREAMBLE =
  'Mai jos sunt datele extrase din capturi de ecran cu statistici despre meciuri de fotbal și echipele implicate. ' +
  'Analizează-le și spune-mi ce concluzii poți trage despre meciuri și despre echipe.';
const PROMPT =
  'Aceasta este o captură de ecran cu informații despre un meci de fotbal sau despre echipe (statistici, clasament, formă, ' +
  'cote, H2H, lot, program etc.). Transcrie TOATE informațiile vizibile EXACT așa cum apar: nume de echipe și jucători, ' +
  'scoruri, date și ore, competiție/etapă, fiecare etichetă de statistică împreună cu valorile ambelor echipe, procente, ' +
  'cote, tabele (păstrează rândurile și coloanele). Reguli: nu interpreta, nu rezuma, nu corecta, nu omite nimic, nu ' +
  'inventa valori. Dacă un text sau un număr este ilizibil scrie [ilizibil]. Păstrează limba originală. ' +
  'Format: Markdown; folosește tabele Markdown pentru date tabelare și pentru statistici de tip „echipă A | statistică | echipă B". ' +
  'Răspunde doar cu transcrierea, fără introducere sau comentarii.';

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};

let items = []; // {file, url, status, text}

/* ---------- Setări ---------- */
function loadSettings() {
  $('mode').value = store.get('mode', 'claude');
  $('apiKey').value = store.get('apiKey', '');
  $('model').value = store.get('model', '');
  $('preamble').value = store.get('preamble', DEFAULT_PREAMBLE);
  refreshMode();
}
function refreshMode() {
  const claude = $('mode').value === 'claude';
  $('claudeOpts').hidden = !claude;
  $('modeInfo').textContent = claude
    ? (store.get('apiKey', '') ? 'Metodă: Claude Vision (citire exactă).' : 'Metodă: Claude Vision – adaugă cheia API din ⚙️ Setări (sau treci pe OCR local).')
    : 'Metodă: OCR local (rulează pe telefon; verifică numerele în rezultat).';
}
$('btnSettings').onclick = () => $('dlg').showModal();
$('mode').onchange = () => { $('claudeOpts').hidden = $('mode').value !== 'claude'; };
$('settings').addEventListener('submit', () => {
  store.set('mode', $('mode').value);
  store.set('apiKey', $('apiKey').value.trim());
  store.set('model', $('model').value.trim());
  store.set('preamble', $('preamble').value);
  refreshMode();
});

/* ---------- Imagini ---------- */
$('file').onchange = e => {
  for (const f of e.target.files) items.push({ file: f, url: URL.createObjectURL(f), status: '', text: '' });
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
    d.querySelector('.st').textContent = it.status || String(i + 1);
    d.querySelector('button').onclick = () => { URL.revokeObjectURL(it.url); items.splice(i, 1); renderThumbs(); };
    box.appendChild(d);
  });
  $('count').textContent = items.length ? `${items.length} imagini selectate.` : 'Nicio imagine.';
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
  }
  const { data } = await ocrWorker.recognize(await toJpeg(file, 2600));
  return data.text.trim();
}

$('btnRun').onclick = async () => {
  const mode = store.get('mode', 'claude');
  if (mode === 'claude' && !store.get('apiKey', '')) { $('dlg').showModal(); return; }
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
      it.text = mode === 'claude'
        ? await readWithClaude(it.file)
        : await readWithOcr(it.file, p => { $('bar').style.width = (base + p / items.length) * 100 + '%'; });
      it.status = '✓';
    } catch (err) {
      failed++;
      it.text = `[EROARE la citirea imaginii: ${err.message}]`;
      it.status = '✗';
    }
    renderThumbs();
  }
  $('bar').style.width = '100%';
  $('status').textContent = failed ? `Gata, dar ${failed} imagini au eșuat (marcate cu ✗). Poți reîncerca.` : 'Gata!';
  $('btnRun').disabled = false;
  buildResult();
};

function buildResult() {
  const pre = store.get('preamble', DEFAULT_PREAMBLE).trim();
  const parts = items.map((it, i) => `## Imaginea ${i + 1}${it.file.name ? ` (${it.file.name})` : ''}\n\n${it.text}`);
  $('result').value = (pre ? pre + '\n\n---\n\n' : '') + '# Date extrase din imagini\n\n' + parts.join('\n\n---\n\n') + '\n';
  $('resultCard').hidden = false;
  $('resultCard').scrollIntoView({ behavior: 'smooth' });
}

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
  let p = $('printArea');
  if (!p) { p = document.createElement('div'); p.id = 'printArea'; document.body.appendChild(p); }
  p.textContent = text();
  window.print();
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
loadSettings();
renderThumbs();
