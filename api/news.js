// LifeOS News-Proxy für Vercel  (Datei: /api/news.js)
// Holt F1- und Tech-RSS-Feeds serverseitig (kein CORS-Problem im Browser),
// parst sie ohne externe Pakete und liefert sortiertes JSON.
//
// Aufruf aus LifeOS:  /api/news?cat=all|f1|tech
//
// Node 18+ auf Vercel hat globales fetch – keine Dependencies nötig.

const FEEDS = {
  f1: [
    { url: 'https://www.motorsport-total.com/rss/f1.xml',      src: 'Motorsport-Total' },
    { url: 'https://www.motorsport.com/rss/f1/news/',          src: 'Motorsport.com' },
    { url: 'https://www.motorsport-magazin.com/rss/formel1.xml', src: 'Motorsport-Magazin' }
  ],
  tech: [
    { url: 'https://www.heise.de/rss/heise-atom.xml',          src: 'heise online' },
    { url: 'https://rss.golem.de/rss.php?feed=RSS2.0',         src: 'Golem' },
    { url: 'https://t3n.de/rss.xml',                            src: 't3n' }
  ]
};

// --- winziger RSS/Atom-Parser (regex-basiert, robust genug für Standard-Feeds) ---
function decode(s){
  if(!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')            // HTML-Tags aus Titeln entfernen
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m,n)=>String.fromCharCode(parseInt(n,10)))
    .replace(/&nbsp;/g, ' ')
    .trim();
}
function tag(block, name){
  const m = block.match(new RegExp('<'+name+'[^>]*>([\\s\\S]*?)<\\/'+name+'>', 'i'));
  return m ? m[1] : '';
}
function attrLink(block){
  // Atom: <link href="..."/>
  const m = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return m ? m[1] : '';
}
function parseFeed(xml, src){
  const items = [];
  // RSS <item> oder Atom <entry>
  const chunks = xml.split(/<item[\s>]/i).slice(1).map(c=>'<item '+c);
  const entries = chunks.length ? chunks : xml.split(/<entry[\s>]/i).slice(1).map(c=>'<entry '+c);
  for(const raw of entries){
    const block = raw.split(/<\/(item|entry)>/i)[0];
    const title = decode(tag(block, 'title'));
    let link = decode(tag(block, 'link')) || attrLink(block);
    const date = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date');
    let ts = Date.parse(decode(date));
    if(isNaN(ts)) ts = 0;
    if(title && link){
      items.push({ title, link: link.trim(), src, ts });
    }
    if(items.length >= 15) break; // pro Feed begrenzen
  }
  return items;
}

async function fetchFeed(f){
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 6000);
    const r = await fetch(f.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (LifeOS News Reader)' }
    });
    clearTimeout(t);
    if(!r.ok) return [];
    const xml = await r.text();
    return parseFeed(xml, f.src);
  }catch(e){ return []; }
}

module.exports = async (req, res) => {
  const cat = (req.query && req.query.cat) || 'all';
  let feeds = [];
  if(cat === 'f1') feeds = FEEDS.f1;
  else if(cat === 'tech') feeds = FEEDS.tech;
  else feeds = [...FEEDS.f1, ...FEEDS.tech];

  const results = await Promise.all(feeds.map(fetchFeed));
  let items = [].concat(...results);

  // nach Datum absteigend sortieren, Duplikate (gleicher Titel) entfernen
  const seen = new Set();
  items = items
    .sort((a,b)=> b.ts - a.ts)
    .filter(it => { const k = it.title.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 40);

  // 10 Min Cache am CDN, damit die Feeds nicht bei jedem Aufruf neu geholt werden
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({ ok: true, cat, count: items.length, updated: Date.now(), items });
};
