import sharp from 'sharp';
import { readFileSync } from 'fs';

const W = 1280, H = 640;

// Load screenshot
const screenshot = await sharp('RevisionGraph_vs_code.png').metadata();
const ssW = screenshot.width, ssH = screenshot.height;

// Scale screenshot to fill left half (640px wide) maintaining aspect ratio
const targetW = 620, targetH = 560;
const scale = Math.max(targetW / ssW, targetH / ssH);
const scaledW = Math.round(ssW * scale);
const scaledH = Math.round(ssH * scale);

const screenshotBuf = await sharp('RevisionGraph_vs_code.png')
  .resize(scaledW, scaledH)
  .extract({ left: 0, top: 0, width: Math.min(targetW, scaledW), height: Math.min(targetH, scaledH) })
  .png()
  .toBuffer();

// Build right-side SVG overlay (text + branding)
// Left half is transparent so screenshot shows through
const rightSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI', system-ui, sans-serif">
  <defs>
    <linearGradient id="blue" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0078d4"/>
      <stop offset="100%" stop-color="#50a0ff"/>
    </linearGradient>
    <!-- Fade from transparent (left) to solid bg (right) — blends screenshot into right panel -->
    <linearGradient id="fadeR" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="55%" stop-color="#0d1117" stop-opacity="0"/>
      <stop offset="90%" stop-color="#0d1117" stop-opacity="1"/>
    </linearGradient>
    <!-- Right panel solid background -->
    <linearGradient id="rightBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
  </defs>

  <!-- Solid background only on the right half -->
  <rect x="660" y="0" width="620" height="${H}" fill="url(#rightBg)"/>

  <!-- Fade overlay that blends the screenshot into the right panel -->
  <rect x="0" y="0" width="780" height="${H}" fill="url(#fadeR)"/>

  <!-- Vertical separator line accent -->
  <rect x="664" y="60" width="3" height="520" rx="1.5" fill="url(#blue)" opacity="0.4"/>

  <!-- VS logo -->
  <rect x="690" y="72" width="40" height="40" rx="7" fill="#68217a"/>
  <text x="710" y="100" text-anchor="middle" fill="white" font-size="20" font-weight="700">VS</text>
  <text x="738" y="99" fill="#8b949e" font-size="12">Visual Studio 2022/2026</text>

  <!-- VS Code logo -->
  <rect x="690" y="125" width="40" height="40" rx="7" fill="#007acc"/>
  <text x="710" y="151" text-anchor="middle" fill="white" font-size="13" font-weight="600">VSC</text>
  <text x="738" y="152" fill="#8b949e" font-size="12">Visual Studio Code</text>

  <!-- Divider -->
  <line x1="678" y1="180" x2="1250" y2="180" stroke="#21262d" stroke-width="1.5"/>

  <!-- Main title -->
  <text x="960" y="255" text-anchor="middle" fill="#f0f6fc" font-size="48" font-weight="700" letter-spacing="-1">Git Revision Graph</text>

  <!-- Subtitle -->
  <text x="960" y="295" text-anchor="middle" fill="#8b949e" font-size="18">TortoiseSVN-style commit graph for Git</text>

  <!-- Accent line -->
  <rect x="820" y="312" width="280" height="3" rx="2" fill="url(#blue)"/>

  <!-- Feature pills -->
  <rect x="690" y="332" width="120" height="28" rx="14" fill="#0078d4" fill-opacity="0.15" stroke="#0078d4" stroke-width="1"/>
  <text x="750" y="351" text-anchor="middle" fill="#58a6ff" font-size="12" font-weight="500">DAG layout</text>

  <rect x="822" y="332" width="124" height="28" rx="14" fill="#3fb950" fill-opacity="0.12" stroke="#3fb950" stroke-width="1"/>
  <text x="884" y="351" text-anchor="middle" fill="#3fb950" font-size="12" font-weight="500">Branch &amp; tags</text>

  <rect x="958" y="332" width="132" height="28" rx="14" fill="#d29922" fill-opacity="0.12" stroke="#d29922" stroke-width="1"/>
  <text x="1024" y="351" text-anchor="middle" fill="#d29922" font-size="12" font-weight="500">Native Git actions</text>

  <rect x="1102" y="332" width="138" height="28" rx="14" fill="#8957e5" fill-opacity="0.12" stroke="#8957e5" stroke-width="1"/>
  <text x="1171" y="351" text-anchor="middle" fill="#a371f7" font-size="12" font-weight="500">Zoom &amp; pan</text>

  <!-- Legend items (matching real app) -->
  <rect x="690" y="384" width="14" height="14" rx="2" fill="#e05252"/>
  <text x="712" y="396" fill="#c9d1d9" font-size="14">HEAD / current branch</text>

  <rect x="690" y="412" width="14" height="14" rx="2" fill="#6aaa64"/>
  <text x="712" y="424" fill="#c9d1d9" font-size="14">Local branch</text>

  <rect x="690" y="440" width="14" height="14" rx="2" fill="#4a90d9"/>
  <text x="712" y="452" fill="#c9d1d9" font-size="14">Remote branch</text>

  <rect x="690" y="468" width="14" height="14" rx="2" fill="#c9a84c"/>
  <text x="712" y="480" fill="#c9d1d9" font-size="14">Tag (version)</text>

  <rect x="690" y="496" width="14" height="14" rx="2" fill="#555"/>
  <text x="712" y="508" fill="#c9d1d9" font-size="14">Commit</text>

  <!-- Bottom bar -->
  <line x1="678" y1="543" x2="1250" y2="543" stroke="#21262d" stroke-width="1.5"/>
  <text x="690" y="566" fill="#6e7681" font-size="12">Open Source · MIT</text>
  <text x="960" y="566" text-anchor="middle" fill="#6e7681" font-size="12">github.com/BenKoncsik/vs_2026_git_Revision_Graph</text>
  <text x="1250" y="566" text-anchor="end" fill="#0078d4" font-size="12" font-weight="600">⭐ Star it!</text>
</svg>`;

const rightBuf = Buffer.from(rightSvg);

await sharp({
  create: { width: W, height: H, channels: 4, background: { r: 13, g: 17, b: 23, alpha: 1 } }
})
.composite([
  // Screenshot on left, offset into the frame
  { input: screenshotBuf, left: 30, top: 40 },
  // SVG overlay (full canvas, transparent where not drawn)
  { input: rightBuf, left: 0, top: 0 },
])
.png()
.toFile('social-preview.png');

console.log('Done → social-preview.png');
