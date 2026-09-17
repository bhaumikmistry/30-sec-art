#!/usr/bin/env node
/**
 * Turns the drawing files into things you can look at.
 *
 *   index.json      every drawing, newest first
 *   docs/index.html the gallery, one self-contained file
 *   preview.svg     a contact sheet for the README
 *
 * No dependencies, so the workflow is a checkout and a `node build.mjs`.
 *
 * A drawing is strokes of points in the 400x400 space of the canvas it was
 * drawn on. Nobody uses the whole canvas, so each one is cropped to its own
 * ink before it is drawn: a face that was sketched in one corner fills its
 * tile instead of sitting small in the middle of a lot of white.
 */

import fs from 'node:fs'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)
const GRID_URL = 'https://www.bhaumikmistry.com/projects/30-sec-art-grid'
const DRAW_URL = 'https://www.bhaumikmistry.com/projects/30-sec-art'

const files = fs
  .readdirSync(root)
  .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'package.json')

/**
 * Points carry sub-pixel precision from the pointer events, sampled as fast as
 * the browser fired them. A 150px tile cannot show any of that, so points
 * nearer than `tol` canvas units to the one before are dropped and the rest
 * are rounded. The last point is always kept so the stroke still ends where it
 * ended.
 */
function clean(points, tol) {
  if (points.length < 2) return []
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const q = out[out.length - 1]
    if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) >= tol) out.push(p)
  }
  out.push(points[points.length - 1])

  const seen = []
  let last = ''
  for (const p of out) {
    const k = `${Math.round(p.x)},${Math.round(p.y)}`
    if (k !== last) {
      seen.push(k)
      last = k
    }
  }
  return seen
}

function read(file, tol) {
  const d = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  const strokes = (d.strokes || [])
    .map((s) => ({ pts: clean(s.points || [], tol), color: s.color || '#000', width: s.width || 2 }))
    .filter((s) => s.pts.length >= 2)

  // the box the ink actually occupies
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of strokes) {
    for (const p of s.pts) {
      const [x, y] = p.split(',').map(Number)
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (!strokes.length) return null

  // square it off so nothing is stretched, then pad by a tenth
  const side = Math.max(x1 - x0, y1 - y0, 1)
  const pad = side * 0.1
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const box = side + pad * 2
  const view = `${(cx - box / 2).toFixed(0)} ${(cy - box / 2).toFixed(0)} ${box.toFixed(0)} ${box.toFixed(0)}`

  // stroke width is in canvas units, so cropping in makes lines look thin
  const scale = 400 / box

  return {
    id: d.id || file.replace(/\.json$/, ''),
    file,
    artist: (d.artist || 'Anonymous').trim() || 'Anonymous',
    theme: (d.theme || 'unknown').trim().toLowerCase(),
    date: d.date || '',
    strokes,
    view,
    scale,
    points: strokes.reduce((n, s) => n + s.pts.length, 0),
  }
}

/** The gallery is looked at up close, the contact sheet is 150px a tile. */
const drawings = files.map((f) => read(f, 1.5)).filter(Boolean)
drawings.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

/* ---------- svg ---------- */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const pathOf = (s) => `M${s.pts.join('L')}`

/**
 * `pathLength="1"` normalises every path to a length of 1 whatever its real
 * geometry, which is what lets one CSS rule draw all of them on: dash 1,
 * offset 1, animate the offset to 0. Without it each path would need its own
 * measured length.
 */
function svg(d, { animate = false } = {}) {
  const paths = d.strokes
    .map((s, i) => {
      const delay = animate ? ` style="--i:${i}"` : ''
      return `<path d="${pathOf(s)}" pathLength="1" stroke="${esc(s.color)}" stroke-width="${(
        s.width / d.scale
      ).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"${delay}/>`
    })
    .join('')
  return { paths, view: d.view }
}

/* ---------- index.json ---------- */

fs.writeFileSync(
  path.join(root, 'index.json'),
  `${JSON.stringify(
    drawings.map((d) => ({
      file: d.file,
      id: d.id,
      artist: d.artist,
      theme: d.theme,
      date: d.date,
      strokes: d.strokes.length,
    })),
    null,
    2,
  )}\n`,
)

/* ---------- contact sheet for the README ---------- */

/**
 * GitHub will not run scripts in a README image, so this one is static, and it
 * is capped because the README should not pull a megabyte to say hello.
 */
const SHEET_COLS = 8
const SHEET_ROWS = 3
const CELL = 150
const sheet = drawings
  .slice(0, SHEET_COLS * SHEET_ROWS)
  .map((d) => read(d.file, 5))
  .filter(Boolean)
const sheetSvg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_COLS * CELL}" height="${
    SHEET_ROWS * CELL
  }" viewBox="0 0 ${SHEET_COLS * CELL} ${SHEET_ROWS * CELL}">`,
  `<rect width="100%" height="100%" fill="#ffffff"/>`,
  ...sheet.map((d, i) => {
    const x = (i % SHEET_COLS) * CELL
    const y = Math.floor(i / SHEET_COLS) * CELL
    const { paths, view } = svg(d)
    return `<svg x="${x}" y="${y}" width="${CELL}" height="${CELL}" viewBox="${view}">${paths}</svg>`
  }),
  `</svg>`,
].join('\n')
fs.writeFileSync(path.join(root, 'preview.svg'), `${sheetSvg}\n`)

/* ---------- the gallery ---------- */

const themes = [...new Set(drawings.map((d) => d.theme))].sort()
const years = [...new Set(drawings.map((d) => d.date.slice(0, 4)).filter(Boolean))].sort().reverse()
const artists = new Set(drawings.map((d) => d.artist)).size
const totalStrokes = drawings.reduce((n, d) => n + d.strokes.length, 0)

const when = (iso) => {
  if (!iso) return ''
  const m = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const d = new Date(iso)
  return `${m[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

const tiles = drawings
  .map((d) => {
    const { paths, view } = svg(d, { animate: true })
    return `<figure class="t" data-theme="${esc(d.theme)}" data-year="${esc(d.date.slice(0, 4))}">
<svg viewBox="${view}" role="img" aria-label="${esc(d.theme)} by ${esc(d.artist)}">${paths}</svg>
<figcaption><b>${esc(d.artist)}</b><span>${esc(d.theme)} · ${esc(when(d.date))}</span></figcaption>
</figure>`
  })
  .join('\n')

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>30 second art</title>
<meta name="description" content="${drawings.length} drawings, each made in about thirty seconds.">
<meta property="og:title" content="30 second art">
<meta property="og:description" content="${drawings.length} drawings, each made in about thirty seconds.">
<meta property="og:image" content="https://raw.githubusercontent.com/bhaumikmistry/30-sec-art/main/preview.svg">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✏️</text></svg>">
<style>
*{box-sizing:border-box}
:root{--bg:#0b0b0c;--fg:#ededef;--dim:#8b8b93;--line:#25252a;--paper:#f7f7f4}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit}
.wrap{max-width:1100px;margin:0 auto;padding:56px 20px 80px}
h1{margin:0;font-size:clamp(34px,7vw,58px);line-height:1.02;letter-spacing:-.03em;font-weight:600}
.sub{margin:14px 0 0;max-width:46ch;color:var(--dim)}
.stats{display:flex;flex-wrap:wrap;gap:22px;margin:26px 0 0;padding:0;list-style:none}
.stats b{display:block;font-size:26px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stats span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.acts{display:flex;flex-wrap:wrap;gap:10px;margin:30px 0 0}
.acts a{padding:9px 15px;border:1px solid var(--line);border-radius:999px;font-size:13px;
  text-decoration:none;transition:border-color .15s,background .15s}
.acts a:hover{border-color:var(--dim);background:#141417}
.acts a.p{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.acts a.p:hover{background:#fff}
.bar{position:sticky;top:0;z-index:5;margin:44px 0 0;padding:12px 0;
  background:color-mix(in srgb,var(--bg) 94%,transparent);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.bar button{font:inherit;font-size:12.5px;color:var(--dim);background:none;cursor:pointer;
  border:1px solid var(--line);border-radius:999px;padding:5px 12px;transition:.15s}
.bar button:hover{color:var(--fg);border-color:var(--dim)}
.bar button[aria-pressed=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.count{margin-left:auto;font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.grid{display:grid;gap:14px;margin:22px 0 0;
  grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.t{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--paper)}
.t svg{display:block;width:100%;aspect-ratio:1;background:var(--paper)}
.t path{stroke-dasharray:1;stroke-dashoffset:1}
/* drawn on when it scrolls into view, in the order the strokes were made */
.t.in path{animation:draw .5s linear forwards;animation-delay:calc(var(--i) * .1s)}
@keyframes draw{to{stroke-dashoffset:0}}
.t figcaption{display:flex;flex-direction:column;gap:2px;padding:9px 11px;
  background:var(--bg);border-top:1px solid var(--line)}
.t figcaption b{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t figcaption span{font-size:11px;color:var(--dim)}
.t:hover path{animation:draw .45s linear forwards;animation-delay:calc(var(--i) * .07s)}
.none{padding:50px 0;color:var(--dim);text-align:center}
footer{margin:64px 0 0;padding-top:22px;border-top:1px solid var(--line);
  font-size:13px;color:var(--dim)}
footer a{text-decoration-color:var(--line)}
@media (prefers-reduced-motion:reduce){
  .t path{stroke-dashoffset:0}
  .t.in path,.t:hover path{animation:none}
}
</style>

<div class="wrap">
<header>
  <h1>30 second art</h1>
  <p class="sub">Open the canvas, draw whatever the theme is, do not think about it for
  longer than half a minute. Every drawing here is kept as the strokes that made it,
  so they can be drawn again.</p>
  <ul class="stats">
    <li><b>${drawings.length}</b><span>drawings</span></li>
    <li><b>${artists}</b><span>artists</span></li>
    <li><b>${totalStrokes}</b><span>strokes</span></li>
    <li><b>${themes.length}</b><span>themes</span></li>
  </ul>
  <p class="acts">
    <a class="p" href="${DRAW_URL}">Draw one</a>
    <a href="${GRID_URL}?year=${years[0] || ''}">See them by year</a>
    <a href="https://github.com/bhaumikmistry/30-sec-art">Source</a>
  </p>
</header>

<nav class="bar" aria-label="Filter">
  <button type="button" data-f="all" aria-pressed="true">Everything</button>
  ${themes.map((t) => `<button type="button" data-f="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('\n  ')}
  ${years.map((y) => `<button type="button" data-f="${y}" aria-pressed="false">${y}</button>`).join('\n  ')}
  <span class="count" aria-live="polite">${drawings.length} shown</span>
</nav>

<div class="grid" id="g">
${tiles}
</div>
<p class="none" id="none" hidden>Nothing under that one.</p>

<footer>
  Drawn by ${artists} people. Add yours at
  <a href="${DRAW_URL}">bhaumikmistry.com/projects/30-sec-art</a>, or open a pull
  request with a drawing file. Laid out by year on
  <a href="${GRID_URL}">the grid</a>.
</footer>
</div>

<script>
// draw the strokes on as each tile arrives, rather than all at once off-screen
var tiles = document.querySelectorAll('.t')
if ('IntersectionObserver' in window) {
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } })
  }, { rootMargin: '80px' })
  tiles.forEach(function (t) { io.observe(t) })
} else {
  tiles.forEach(function (t) { t.classList.add('in') })
}

// one filter at a time, matched against either theme or year
var count = document.querySelector('.count')
var none = document.getElementById('none')
document.querySelector('.bar').addEventListener('click', function (ev) {
  var b = ev.target.closest('button')
  if (!b) return
  var f = b.dataset.f
  document.querySelectorAll('.bar button').forEach(function (o) {
    o.setAttribute('aria-pressed', String(o === b))
  })
  var n = 0
  tiles.forEach(function (t) {
    var hit = f === 'all' || t.dataset.theme === f || t.dataset.year === f
    t.hidden = !hit
    if (hit) n++
  })
  count.textContent = n + ' shown'
  none.hidden = n > 0
})
</script>
</html>
`

fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
fs.writeFileSync(path.join(root, 'docs/index.html'), html)
fs.writeFileSync(path.join(root, 'docs/.nojekyll'), '')

/* ---------- keep the README count honest ---------- */

// the one number in the README that goes stale on its own
const readmePath = path.join(root, 'README.md')
if (fs.existsSync(readmePath)) {
  const before = fs.readFileSync(readmePath, 'utf8')
  const after = before.replace(/See all \d+ drawings/, `See all ${drawings.length} drawings`)
  if (after !== before) fs.writeFileSync(readmePath, after)
}

const kb = (n) => `${Math.round(n / 1024)} KB`
console.log(`  ${drawings.length} drawings, ${artists} artists, ${totalStrokes} strokes`)
console.log(`  index.json      ${kb(fs.statSync(path.join(root, 'index.json')).size)}`)
console.log(`  preview.svg     ${kb(fs.statSync(path.join(root, 'preview.svg')).size)}  (${sheet.length} tiles)`)
console.log(`  docs/index.html ${kb(fs.statSync(path.join(root, 'docs/index.html')).size)}`)
