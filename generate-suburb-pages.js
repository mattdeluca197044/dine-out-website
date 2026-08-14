// generate-suburb-pages.js
//
// Generates static, crawlable landing pages — one per suburb — with real
// restaurant data baked directly into the HTML. This exists because the
// main site (index.html) only renders results after JavaScript runs a
// search in the browser, which means search engines have nothing
// suburb-specific to index for a query like "restaurants in Newtown".
// These pages are what actually let outtoeat rank for those searches.
//
// Run with: node generate-suburb-pages.js
// (No npm install needed — uses only Node's built-in fetch/fs/path.)

const fs = require("fs");
const path = require("path");

const SEARCH_API = "https://eat-out-oz.vercel.app/api/search";
const SITE_URL = "https://outtoeat.com.au";
const OUTPUT_DIR = path.join(__dirname, "restaurants");

// Same suburbs already featured as the homepage's "Popular suburbs" chips —
// keeps the two in sync and starts with a manageable, high-value set.
const SUBURBS = ["Sydney CBD", "Bondi", "Manly", "Surry Hills", "Newtown", "Parramatta", "Chatswood", "Coogee"];

// Categories to include on each suburb page. Kept to the two most
// commonly searched — "restaurants" and "cafes" — rather than all six
// categories the main site supports, so each page stays focused and
// generation stays fast and well within the backend's rate limit (40
// requests/60s per IP — 8 suburbs × 2 categories = 16 requests, well under).
const CATEGORIES = ["restaurant", "cafe"];

const MAX_RESULTS_PER_PAGE = 24;

function slugify(suburb) {
  return suburb.toLowerCase().trim().replace(/\s+/g, "-");
}

async function fetchCategory(suburb, category) {
  const url = `${SEARCH_API}?suburb=${encodeURIComponent(suburb)}&category=${category}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ⚠ ${suburb} / ${category}: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.results || []).map((r) => ({ ...r, category }));
  } catch (err) {
    console.warn(`  ⚠ ${suburb} / ${category}: ${err.message}`);
    return [];
  }
}

function priceFromLevel(level, category) {
  const table = { 0: [10, 15], 1: [15, 25], 2: [25, 40], 3: [50, 75], 4: [80, 120] };
  if (level !== null && level !== undefined && table[level]) return table[level];
  if (category === "cafe") return [20, 30];
  return [35, 55];
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function starString(rating) {
  const full = Math.round(rating || 0);
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function mapsUrl(placeId) {
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

function buildCardHtml(place) {
  const [priceLow, priceHigh] = priceFromLevel(place.priceLevel, place.category);
  const rating = place.rating || 0;
  const reviews = place.reviews || 0;
  const cuisine = place.cuisine || (place.category === "cafe" ? "Café" : "Restaurant");
  const listingUrl = place.placeId ? `${SITE_URL}/listing.html?place=${encodeURIComponent(place.placeId)}` : null;

  return `
    <div class="card">
      <div class="card-top">
        <div>
          <h2 class="card-title">${escapeHtml(place.name)}</h2>
          <div class="card-sub">${escapeHtml(cuisine)} · ${escapeHtml(place.suburb || "")}</div>
        </div>
      </div>
      ${rating ? `
      <div class="rating-row">
        <span class="stars">${starString(rating)}</span>
        <span>${rating.toFixed(1)}</span>
        <span class="rating-count">(${reviews.toLocaleString()} reviews)</span>
      </div>` : ""}
      <div class="price-ticket">
        <span class="price-label">Cost per head</span>
        <span class="price-value">$${priceLow}–${priceHigh}</span>
      </div>
      <div class="hours-line">${escapeHtml(place.address || "")}</div>
      <div class="card-actions">
        <a class="primary" href="${mapsUrl(place.placeId)}" target="_blank" rel="noopener">Get directions</a>
        ${listingUrl ? `<a href="${listingUrl}">View listing</a>` : ""}
      </div>
    </div>`;
}

function buildJsonLd(suburb, places) {
  const itemListElement = places.slice(0, 20).map((place, idx) => {
    const [priceLow, priceHigh] = priceFromLevel(place.priceLevel, place.category);
    const entry = {
      "@type": "Restaurant",
      name: place.name,
      address: {
        "@type": "PostalAddress",
        streetAddress: place.address || undefined,
        addressLocality: place.suburb || suburb,
        addressRegion: place.state || "NSW",
        addressCountry: "AU",
      },
      priceRange: `$${priceLow}-${priceHigh}`,
      servesCuisine: place.cuisine || undefined,
    };
    if (place.rating) {
      entry.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: place.rating,
        reviewCount: place.reviews || 0,
      };
    }
    return { "@type": "ListItem", position: idx + 1, item: entry };
  });

  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Restaurants and cafés in ${suburb}, Sydney`,
      itemListElement,
    },
    null,
    2
  );
}

function buildPageHtml(suburb, places) {
  const slug = slugify(suburb);
  const pageUrl = `${SITE_URL}/restaurants/${slug}.html`;
  const sorted = [...places].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, MAX_RESULTS_PER_PAGE);
  const otherSuburbs = SUBURBS.filter((s) => s !== suburb);

  const cardsHtml = sorted.length
    ? sorted.map(buildCardHtml).join("\n")
    : `<p class="empty-note">No live listings found for ${escapeHtml(suburb)} right now — <a href="${SITE_URL}/?suburb=${encodeURIComponent(suburb)}">try the live search</a> instead.</p>`;

  const otherSuburbsHtml = otherSuburbs
    .map((s) => `<a href="${SITE_URL}/restaurants/${slugify(s)}.html">${escapeHtml(s)}</a>`)
    .join(" · ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Restaurants &amp; Cafés in ${escapeHtml(suburb)}, Sydney | outtoeat</title>
<meta name="description" content="Find the best restaurants and cafés in ${escapeHtml(suburb)}, Sydney. Real cost-per-head estimates, ratings, and directions — updated daily on outtoeat.">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="outtoeat">
<meta property="og:title" content="Restaurants &amp; Cafés in ${escapeHtml(suburb)}, Sydney">
<meta property="og:description" content="Find the best restaurants and cafés in ${escapeHtml(suburb)}, Sydney, with real cost-per-head estimates.">
<meta property="og:url" content="${pageUrl}">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Work+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">
${buildJsonLd(suburb, sorted)}
</script>
<style>
  :root{
    --ink:#DE3937; --paper:#FFFFFF; --paper-dim:#FBEBEA; --brass:#C42B29;
    --line:#F0D9D8; --text:#241412; --text-dim:#7A6E6A;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--text);font-family:'Work Sans',sans-serif;-webkit-font-smoothing:antialiased;}
  header{background:var(--ink);color:#fff;padding:40px 24px;}
  .header-inner{max-width:1080px;margin:0 auto;}
  .brand-mark{font-family:'Fraunces',serif;font-weight:700;font-size:24px;color:#fff;}
  h1{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(28px,4vw,42px);margin:14px 0 10px;}
  .sub{font-size:15px;color:#FBDAD9;max-width:640px;line-height:1.5;}
  .cta-link{display:inline-block;margin-top:18px;background:#fff;color:var(--ink);text-decoration:none;font-weight:600;padding:11px 20px;border-radius:4px;font-size:14px;}
  main{max-width:1080px;margin:0 auto;padding:36px 24px 60px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;}
  .card{background:#FFFDF8;border:1px solid var(--line);border-radius:4px;padding:20px;display:flex;flex-direction:column;gap:10px;}
  .card-title{font-family:'Fraunces',serif;font-size:18px;font-weight:600;margin:0;}
  .card-sub{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-dim);text-transform:uppercase;margin-top:4px;}
  .rating-row{display:flex;align-items:center;gap:8px;font-size:13px;}
  .stars{color:var(--brass);font-size:12px;}
  .rating-count{color:var(--text-dim);font-size:12px;}
  .price-ticket{border-top:1px dashed var(--line);border-bottom:1px dashed var(--line);padding:8px 0;display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;}
  .price-label{font-size:11px;color:var(--text-dim);text-transform:uppercase;}
  .price-value{font-size:15px;font-weight:600;color:var(--ink);}
  .hours-line{font-size:12.5px;color:var(--text-dim);}
  .card-actions{display:flex;gap:8px;margin-top:auto;}
  .card-actions a{flex:1;text-align:center;font-size:12.5px;font-weight:600;text-decoration:none;padding:9px 8px;border-radius:4px;border:1px solid var(--ink);color:var(--ink);}
  .card-actions a.primary{background:var(--ink);color:#fff;}
  .empty-note{color:var(--text-dim);font-size:14px;}
  .nearby{margin-top:48px;padding-top:24px;border-top:1px solid var(--line);font-size:13.5px;color:var(--text-dim);}
  .nearby a{color:var(--ink);text-decoration:none;font-weight:600;}
  .nearby a:hover{text-decoration:underline;}
  footer{max-width:1080px;margin:0 auto;padding:20px 24px 50px;color:var(--text-dim);font-size:12px;font-family:'IBM Plex Mono',monospace;}
  footer a{color:var(--ink);}
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <span class="brand-mark">outtoeat</span>
    <h1>Restaurants &amp; Cafés in ${escapeHtml(suburb)}, Sydney</h1>
    <p class="sub">Real cost-per-head estimates so nobody gets surprised by the bill — sourced live and updated regularly.</p>
    <a class="cta-link" href="${SITE_URL}/?suburb=${encodeURIComponent(suburb)}">Search live &amp; book a table on outtoeat →</a>
  </div>
</header>

<main>
  <div class="grid">
${cardsHtml}
  </div>

  <div class="nearby">
    Explore other suburbs: ${otherSuburbsHtml}
  </div>
</main>

<footer>
  outtoeat is a trading name of Eat Out Oz. Data sourced live from Google Places; cost-per-head figures are estimates, not menu totals.
  <br><a href="${SITE_URL}/">← Back to outtoeat home</a>
</footer>

</body>
</html>
`;
}

function buildSitemap(generatedSlugs) {
  const staticUrls = [
    { loc: `${SITE_URL}/`, priority: "1.0", freq: "daily" },
    { loc: `${SITE_URL}/featured.html`, priority: "0.6", freq: "weekly" },
  ];
  const suburbUrls = generatedSlugs.map((slug) => ({
    loc: `${SITE_URL}/restaurants/${slug}.html`,
    priority: "0.8",
    freq: "daily",
  }));

  const all = [...staticUrls, ...suburbUrls];
  const body = all
    .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

async function main() {
  console.log(`Generating landing pages for ${SUBURBS.length} suburbs...`);
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const generatedSlugs = [];

  for (const suburb of SUBURBS) {
    console.log(`→ ${suburb}`);
    const resultsPerCategory = await Promise.all(CATEGORIES.map((cat) => fetchCategory(suburb, cat)));
    const places = resultsPerCategory.flat();

    const html = buildPageHtml(suburb, places);
    const slug = slugify(suburb);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${slug}.html`), html, "utf8");
    generatedSlugs.push(slug);
    console.log(`  ✓ ${places.length} listings → restaurants/${slug}.html`);
  }

  const sitemap = buildSitemap(generatedSlugs);
  fs.writeFileSync(path.join(__dirname, "sitemap.xml"), sitemap, "utf8");
  console.log(`\nDone. sitemap.xml updated with ${generatedSlugs.length} suburb pages.`);
}

main().catch((err) => {
  console.error("Generation failed:", err);
  process.exit(1);
});
