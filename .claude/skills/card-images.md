# Card Images

Bulk-scrape eBay for card images, review candidates, and upload selections to R2.

## When to Use

Use when the user wants to find and add images for cards that are missing them. Invoked as `/card-images` with an optional phase argument.

## Phases

Run in order, or specify one: `/card-images analyze`, `/card-images scrape`, `/card-images review`, `/card-images upload`

## Working Directory

All files go in `_image-candidates/` (gitignored). Key files:
- `manifest.json` - Current batch of cards being processed
- `review.html` - Browser-based review UI (generate from template below)
- `upload-node.js` - Node upload script (generate from template below)
- `batch-*.json` - Cards split into parallel scraping batches
- `{checklist}/{category}_{index}_{slug}/card_N.jpg` - Downloaded candidate images

Ensure `sharp` is installed: `cd _image-candidates && npm install sharp`

## Constants

```
GIST_ID = 5f2b43f0588d72892273ae8f24f68c2d
R2_UPLOAD_URL = https://cards-oauth.iammikec.workers.dev/upload-image
R2_IMAGE_BASE = https://cards-oauth.iammikec.workers.dev/images/
ORIGIN_HEADER = https://iammike.github.io  (required for R2 uploads)
```

GitHub token: ask user, or get from live site `localStorage.getItem('github_token')`

---

## Phase 1: Analyze

Fetch gist, find cards without `img` field across all checklists. Cross-reference with existing `manifest.json` to identify:
- **New cards** (never scraped) - `offset: 0`
- **Re-scrape cards** (scraped but rejected) - `offset: 3` (skip first 3 eBay results)

Report: total missing, new vs re-scrape, by checklist/category.

---

## Phase 2: Scrape

### Generate manifest

Build `manifest.json` array. Each entry:
```json
{
  "id": "{checklist}_{category}_{index}",
  "checklist": "personal-favorites",
  "category": "tier-2",
  "index": 5,
  "player": "Don Mattingly",
  "set": "1984 Donruss",
  "num": "#248",
  "variant": "",
  "offset": 0,
  "dir": "personal-favorites/tier-2_5_don-mattingly-1984-donruss",
  "images": []
}
```

Split into batches of ~14 cards. Create directories for each card.

### eBay search

URL: `https://www.ebay.com/sch/i.html?_nkw={query}&_sacat=212&LH_Sold=1&_ipg=60`

Query: `{set} {player} {num}` (e.g., "1984 Donruss Don Mattingly #248")
- Jayden Daniels premium cards: add "Jayden Daniels" since player field is empty
- Don't include grade variants (PSA 7, Grade 9) in search
- Cards with no set: search `{player} {num}` (just player name and card number if available)
- 2025 Donruss WNBA: search `2024-25 Donruss WNBA {player} {num}`

### Image extraction

From eBay results, extract `i.ebayimg.com` URLs. Upgrade thumbnails: replace `s-l225`/`s-l140` with `s-l1600`.

Skip first N images per card's `offset` value. Download up to 3 candidates:
```bash
curl -sL -o "{dir}/card_1.jpg" "{url}"
```

### Parallel execution

Launch up to 8 agents (subagent_type: "general-purpose") with one batch each. Each agent uses WebFetch for eBay searches and Bash curl for downloads.

### After scraping

Update `manifest.json` with image paths:
```python
for entry in manifest:
    dir = entry['dir']
    images = sorted(glob(f"{dir}/card_*.jpg"))
    entry['images'] = [str(p) for p in images]
```

Ensure `review.html` exists (generate from template below if not).

Start local server: `python3 -m http.server 8888` from `_image-candidates/`

Tell user to open `http://localhost:8888/review.html`

---

## Phase 3: Review

User reviews images in the browser UI. They can:
- Click an image to select it
- "Reject All" if none are good
- "Skip" to defer
- Paste a custom eBay image URL
- "Search eBay" link opens a pre-built search

When done, user clicks "Export Selections" to download `image-selections.json`.

---

## Phase 4: Upload

### CRITICAL: Match by set+num+variant, NEVER by array index

```javascript
function matchKey(set, num, variant) {
    const s = (set || '').toLowerCase().trim();
    const n = (num || '').toLowerCase().trim().replace(/^#/, '');
    const v = (variant || '').toLowerCase().trim();
    return `${s}|${n}|${v}`;
}
```

### Process

1. Read selections JSON
2. Load manifest.json for set/num/variant per cardId
3. Load current gist card data
4. For each selection: find card by set+num+variant match, convert to WebP, upload to R2, set card.img
5. Save gist
6. For custom URL selections: download the URL first, then process same as file

### R2 key generation

```javascript
function generateKey(checklistId, card) {
    const parts = [];
    if (card.set) parts.push(card.set.toLowerCase().replace(/\s+/g, '_'));
    if (card.player) parts.push(card.player.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '-'));
    if (card.variant) parts.push(card.variant.toLowerCase().replace(/\s+/g, '_'));
    if (card.num) parts.push(card.num.replace('#', ''));
    const name = parts.join('_').replace(/[^a-z0-9_-]/g, '');
    return `images/${checklistId}/${name}.webp`;
}
```

### Cache busting

R2 worker serves with `Cache-Control: public, max-age=31536000, immutable`. ALWAYS use `_v2` suffix on keys for personal-favorites checklist (due to orphaned cached images from a bad round 1 upload). For other checklists, append `_v2` if overwriting an existing key.

### Cards with abbreviated/missing set names

Some cards (e.g., JD premium) have shortened names in the manifest vs full names in gist. If exact match fails, try fuzzy: check if the gist card's set contains the manifest set name as a substring.

---

## Upload Script Template

Generate `upload-node.js` with this structure. Bake the selections array directly into the script.

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OAUTH_PROXY_URL = 'https://cards-oauth.iammikec.workers.dev';
const GIST_ID = '5f2b43f0588d72892273ae8f24f68c2d';
const BASE_DIR = __dirname;
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('Set GITHUB_TOKEN env var'); process.exit(1); }

const IMAGE_SELECTIONS = [/* bake selections here */];

function generateKey(checklistId, card) {
    const parts = [];
    if (card.set) parts.push(card.set.toLowerCase().replace(/\s+/g, '_'));
    if (card.player) parts.push(card.player.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '-'));
    if (card.variant) parts.push(card.variant.toLowerCase().replace(/\s+/g, '_'));
    if (card.num) parts.push(card.num.replace('#', ''));
    const name = parts.join('_').replace(/[^a-z0-9_-]/g, '');
    return `images/${checklistId}/${name}.webp`;
}

function matchKey(set, num, variant) {
    const s = (set || '').toLowerCase().trim();
    const n = (num || '').toLowerCase().trim().replace(/^#/, '');
    const v = (variant || '').toLowerCase().trim();
    return `${s}|${n}|${v}`;
}

async function convertToWebP(filePath) {
    return (await sharp(filePath)
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()).toString('base64');
}

async function uploadToR2(key, base64) {
    const resp = await fetch(OAUTH_PROXY_URL + '/upload-image', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`,
            'Origin': 'https://iammike.github.io',
        },
        body: JSON.stringify({ key, base64, contentType: 'image/webp' }),
    });
    if (!resp.ok) throw new Error(`Upload failed (${resp.status})`);
    return (await resp.json()).url;
}

async function main() {
    const manifest = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'manifest.json'), 'utf-8'));
    const manifestById = Object.fromEntries(manifest.map(e => [e.id, e]));

    // Group by checklist
    const byChecklist = {};
    for (const sel of IMAGE_SELECTIONS) {
        (byChecklist[sel.checklist] ||= []).push(sel);
    }

    let uploaded = 0, failed = 0;

    for (const [checklistId, sels] of Object.entries(byChecklist)) {
        console.log(`\n--- ${checklistId} (${sels.length}) ---`);
        const gistResp = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        const gist = await gistResp.json();
        const cardData = JSON.parse(gist.files[`${checklistId}-cards.json`].content);
        let modified = false;

        for (const sel of sels) {
            const me = manifestById[sel.cardId];
            if (!me) { console.log(`  NO MANIFEST: ${sel.cardId}`); failed++; continue; }

            const catCards = cardData.categories?.[sel.category];
            if (!catCards) { console.log(`  NO CATEGORY: ${sel.category}`); failed++; continue; }

            // Match by set+num+variant
            const target = matchKey(me.set, me.num, me.variant);
            let matched = null;
            for (let i = 0; i < catCards.length; i++) {
                if (matchKey(catCards[i].set, catCards[i].num, catCards[i].variant) === target) {
                    matched = { card: catCards[i], index: i };
                    break;
                }
            }
            if (!matched) { console.log(`  NO MATCH: ${sel.cardId}`); failed++; continue; }

            try {
                process.stdout.write(`  [${matched.index}] ${me.player || me.set} ${me.num}...`);

                let base64;
                if (sel.isCustomUrl) {
                    // Download custom URL, convert to WebP
                    const imgResp = await fetch(sel.imageFile);
                    const buf = Buffer.from(await imgResp.arrayBuffer());
                    base64 = (await sharp(buf)
                        .resize({ width: 800, withoutEnlargement: true })
                        .webp({ quality: 82 })
                        .toBuffer()).toString('base64');
                } else {
                    base64 = await convertToWebP(path.join(BASE_DIR, sel.imageFile));
                }

                const key = generateKey(checklistId, matched.card);
                const url = await uploadToR2(key, base64);
                matched.card.img = url;
                modified = true;
                uploaded++;
                console.log(' OK');
                await new Promise(r => setTimeout(r, 100));
            } catch (e) {
                console.log(` FAILED: ${e.message}`);
                failed++;
            }
        }

        if (modified) {
            process.stdout.write(`  Saving...`);
            const saveResp = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    files: { [`${checklistId}-cards.json`]: { content: JSON.stringify(cardData, null, 2) } }
                }),
            });
            console.log(saveResp.ok ? ' OK' : ` FAILED (${saveResp.status})`);
        }
    }

    console.log(`\nDONE: ${uploaded} uploaded, ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

---

## Review HTML Template

Generate `review.html` if it doesn't exist. Write this file to `_image-candidates/review.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Card Image Review</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
        h1 { text-align: center; margin-bottom: 10px; color: #e94560; }
        .stats { text-align: center; margin-bottom: 20px; color: #888; }
        .stats span { color: #e94560; font-weight: bold; }
        .filters { display: flex; gap: 10px; justify-content: center; margin-bottom: 20px; flex-wrap: wrap; }
        .filters button { padding: 8px 16px; border: 1px solid #333; background: #16213e; color: #eee; border-radius: 6px; cursor: pointer; font-size: 14px; }
        .filters button.active { background: #e94560; border-color: #e94560; }
        .card-group { background: #16213e; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        .card-group.selected { border: 2px solid #4ecca3; }
        .card-group.skipped { opacity: 0.4; }
        .card-group.rejected { border: 2px solid #e94560; }
        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .card-info h3 { font-size: 18px; color: #e94560; }
        .card-info .meta { color: #888; font-size: 13px; margin-top: 4px; }
        .card-info .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-left: 8px; }
        .status-badge.selected-badge { background: #4ecca3; color: #1a1a2e; }
        .status-badge.rejected-badge { background: #e94560; color: #fff; }
        .card-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }
        .card-actions button { padding: 6px 14px; border: 1px solid #333; background: #0f3460; color: #eee; border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap; }
        .card-actions button:hover { background: #1a4a8a; }
        .card-actions button.skip-btn { background: #333; }
        .card-actions button.skip-btn.active, .card-actions button.reject-btn.active { background: #e94560; }
        .card-actions button.reject-btn { background: #8b0000; }
        .card-actions a.ebay-link { padding: 6px 14px; border: 1px solid #f5a623; background: #3d2e00; color: #f5a623; border-radius: 6px; font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
        .card-actions a.ebay-link:hover { background: #5a4400; }
        .image-options { display: flex; gap: 15px; overflow-x: auto; padding-bottom: 10px; align-items: flex-start; }
        .image-option { flex: 0 0 auto; width: 280px; border: 3px solid transparent; border-radius: 10px; overflow: hidden; cursor: pointer; transition: all 0.2s; background: #0f3460; }
        .image-option:hover { border-color: #e94560; transform: translateY(-2px); }
        .image-option.selected { border-color: #4ecca3; box-shadow: 0 0 15px rgba(78, 204, 163, 0.3); }
        .image-option img { width: 100%; height: 350px; object-fit: contain; background: #fff; }
        .image-option .label { padding: 8px; text-align: center; font-size: 13px; color: #888; }
        .no-images { color: #666; font-style: italic; padding: 20px; text-align: center; }
        .custom-url-box { flex: 0 0 auto; width: 280px; border: 3px dashed #444; border-radius: 10px; background: #0a0a1a; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 200px; padding: 20px; gap: 12px; }
        .custom-url-box.has-preview { border-color: #4ecca3; border-style: solid; }
        .custom-url-box .paste-label { color: #666; font-size: 13px; text-align: center; }
        .custom-url-box input { width: 100%; padding: 8px; border: 1px solid #333; background: #16213e; color: #eee; border-radius: 6px; font-size: 12px; }
        .custom-url-box input:focus { outline: none; border-color: #e94560; }
        .custom-url-box button { padding: 6px 16px; background: #4ecca3; color: #1a1a2e; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; }
        .custom-url-box button:hover { background: #3db88c; }
        .custom-url-box img { width: 100%; max-height: 300px; object-fit: contain; background: #fff; border-radius: 6px; }
        .custom-url-box .remove-btn { background: #e94560; color: #fff; font-size: 11px; padding: 4px 10px; }
        .export-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #0f3460; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #e94560; z-index: 100; }
        .export-bar button { padding: 10px 24px; background: #4ecca3; color: #1a1a2e; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; }
        .export-bar button:hover { background: #3db88c; }
        .spacer { height: 80px; }
    </style>
</head>
<body>
    <h1>Card Image Review</h1>
    <div class="stats">
        <span id="selectedCount">0</span> selected /
        <span id="rejectedCount">0</span> rejected /
        <span id="skippedCount">0</span> skipped /
        <span id="totalCount">0</span> total
    </div>
    <div class="filters">
        <button class="active" data-filter="all">All</button>
        <button data-filter="pending">Pending</button>
        <button data-filter="selected">Selected</button>
        <button data-filter="rejected">Rejected</button>
        <button data-filter="skipped">Skipped</button>
    </div>
    <div id="cardGroups"></div>
    <div class="spacer"></div>
    <div class="export-bar">
        <div id="exportStatus">Select images to export</div>
        <button onclick="exportSelections()">Export Selections (JSON)</button>
    </div>
    <script>
        let selections = {}, customUrls = {};
        let rejected = new Set(), skipped = new Set();
        let cardData = [];
        function loadState() { try { const s = JSON.parse(localStorage.getItem('imageReviewState')||'{}'); selections = s.selections||{}; rejected = new Set(s.rejected||[]); skipped = new Set(s.skipped||[]); customUrls = s.customUrls||{}; } catch(e){} }
        function saveState() { localStorage.setItem('imageReviewState', JSON.stringify({ selections, rejected:[...rejected], skipped:[...skipped], customUrls })); }
        function buildEbayUrl(c) { let q=''; if(c.set) q+=c.set+' '; if(c.player) q+=c.player+' '; if(c.num) q+=c.num+' '; return 'https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(q.trim())+'&_sacat=212&LH_Sold=1'; }
        async function loadCards() { loadState(); try { cardData = await (await fetch('manifest.json')).json(); } catch(e) { document.getElementById('cardGroups').innerHTML='<div class="no-images">Could not load manifest.json</div>'; return; } document.getElementById('totalCount').textContent=cardData.length; updateCounts(); renderCards(getFilteredCards()); }
        function renderCards(cards) {
            const ct = document.getElementById('cardGroups'); ct.innerHTML='';
            for (const c of cards) {
                const div=document.createElement('div'); const isSel=!!selections[c.id]; const isRej=rejected.has(c.id); const isSkip=skipped.has(c.id); const hasCust=!!customUrls[c.id];
                div.className='card-group'+(isSel?' selected':'')+(isSkip?' skipped':'')+(isRej&&!hasCust?' rejected':'')+(hasCust&&isSel?' selected':''); div.dataset.id=c.id;
                const hasImg=c.images&&c.images.length>0; const ebUrl=buildEbayUrl(c);
                let badge=''; if(isSel&&selections[c.id].isCustomUrl) badge='<span class="status-badge selected-badge">CUSTOM URL</span>'; else if(isSel) badge='<span class="status-badge selected-badge">SELECTED</span>'; else if(isRej) badge='<span class="status-badge rejected-badge">REJECTED</span>';
                let custHtml=''; if(hasCust&&isSel) { custHtml=`<div class="custom-url-box has-preview"><img src="${customUrls[c.id]}" onerror="this.style.display='none'"><div class="label" style="color:#4ecca3;font-weight:bold">Custom URL</div><button class="remove-btn" onclick="removeCustomUrl('${c.id}')">Remove</button></div>`; } else { custHtml=`<div class="custom-url-box"><div class="paste-label">Paste image URL</div><input type="text" placeholder="https://i.ebayimg.com/..." id="custom-input-${c.id}" onkeydown="if(event.key==='Enter')useCustomUrl('${c.id}','${c.checklist}','${c.category}',${c.index})"><button onclick="useCustomUrl('${c.id}','${c.checklist}','${c.category}',${c.index})">Use This Image</button></div>`; }
                div.innerHTML=`<div class="card-header"><div class="card-info"><h3>${c.player?c.player+' - ':''}${c.set} ${c.num}${badge}</h3><div class="meta">${c.checklist} / ${c.category}${c.variant?' / '+c.variant:''}</div></div><div class="card-actions"><button class="reject-btn ${isRej?'active':''}" onclick="toggleReject('${c.id}')">${isRej?'Unreject':'Reject All'}</button><a class="ebay-link" href="${ebUrl}" target="_blank">Search eBay</a><button class="skip-btn ${isSkip?'active':''}" onclick="toggleSkip('${c.id}')">${isSkip?'Unskip':'Skip'}</button></div></div><div class="image-options">${hasImg?c.images.map((img,i)=>`<div class="image-option ${selections[c.id]?.file===img&&!selections[c.id]?.isCustomUrl?'selected':''}" onclick="selectImage('${c.id}','${img}','${c.checklist}','${c.category}',${c.index})"><img src="${img}" loading="lazy" onerror="this.parentElement.style.display='none'"><div class="label">Option ${i+1}</div></div>`).join(''):'<div class="no-images">No scraped images</div>'}${custHtml}</div>`; ct.appendChild(div);
            }
        }
        function selectImage(id,file,cl,cat,idx) { if(selections[id]?.file===file&&!selections[id]?.isCustomUrl) delete selections[id]; else { selections[id]={file,checklist:cl,category:cat,index:idx,isCustomUrl:false}; skipped.delete(id); rejected.delete(id); delete customUrls[id]; } updateCounts(); saveState(); renderCards(getFilteredCards()); }
        function useCustomUrl(id,cl,cat,idx) { const inp=document.getElementById('custom-input-'+id); let url=inp?.value?.trim(); if(!url) return; if(url.includes('i.ebayimg.com')) url=url.replace(/s-l\d+/,'s-l1600'); customUrls[id]=url; selections[id]={file:url,checklist:cl,category:cat,index:idx,isCustomUrl:true}; rejected.delete(id); skipped.delete(id); updateCounts(); saveState(); renderCards(getFilteredCards()); }
        function removeCustomUrl(id) { delete customUrls[id]; delete selections[id]; updateCounts(); saveState(); renderCards(getFilteredCards()); }
        function toggleReject(id) { if(rejected.has(id)) rejected.delete(id); else { rejected.add(id); delete selections[id]; delete customUrls[id]; skipped.delete(id); } updateCounts(); saveState(); renderCards(getFilteredCards()); }
        function toggleSkip(id) { if(skipped.has(id)) skipped.delete(id); else { skipped.add(id); delete selections[id]; delete customUrls[id]; rejected.delete(id); } updateCounts(); saveState(); renderCards(getFilteredCards()); }
        function updateCounts() { document.getElementById('selectedCount').textContent=Object.keys(selections).length; document.getElementById('rejectedCount').textContent=rejected.size; document.getElementById('skippedCount').textContent=skipped.size; }
        function getFilteredCards() { const f=document.querySelector('.filters button.active')?.dataset.filter||'all'; return cardData.filter(c=>{if(f==='all')return true;if(f==='selected')return!!selections[c.id];if(f==='rejected')return rejected.has(c.id);if(f==='skipped')return skipped.has(c.id);if(f==='pending')return!selections[c.id]&&!rejected.has(c.id)&&!skipped.has(c.id);return true;}); }
        document.querySelector('.filters').addEventListener('click',e=>{if(e.target.tagName==='BUTTON'){document.querySelectorAll('.filters button').forEach(b=>b.classList.remove('active'));e.target.classList.add('active');renderCards(getFilteredCards());}});
        function exportSelections() { const d={selections:Object.entries(selections).map(([id,i])=>({cardId:id,imageFile:i.file,checklist:i.checklist,category:i.category,cardIndex:i.index,isCustomUrl:!!i.isCustomUrl})),rejected:[...rejected],skipped:[...skipped],customUrls,timestamp:new Date().toISOString()}; const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download='image-selections.json'; a.click(); URL.revokeObjectURL(u); document.getElementById('exportStatus').textContent=`Exported ${d.selections.length} selections`; }
        loadCards();
    </script>
</body>
</html>
```

---

## Lessons Learned

- **NEVER match cards by array index** - gist arrays change. Always match by set+num+variant.
- **Origin header required** for R2 uploads - worker validates it.
- **CDN caching is immutable** - overwriting an R2 key doesn't update cached responses. Use versioned keys (`_v2`).
- **eBay image URLs** - upgrade `s-l225` to `s-l1600` for full resolution.
- **Browser console uploads don't work** - GitHub Pages CSP blocks localhost. Use Node.js instead.
- **Parallel scraping** - up to 8 agents, each with its own batch file.
- **Cards with abbreviated set names** - JD premium cards may need fuzzy matching (substring) if exact match fails.
- **Re-scrape offset** - set offset=3 for cards that were previously scraped and rejected, so eBay results skip the images the user already saw.
