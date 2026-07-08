// Vercel Serverless Function: Proxy für Tankerkönig-Spritpreise (MTS-K)
//
// CommonJS-Format (module.exports) — läuft auf Vercel auch ohne package.json.
//
// Der API-Key wird NICHT im Code gespeichert, sondern als Environment-Variable
// "TANKERKOENIG_KEY" in den Vercel-Projekteinstellungen hinterlegt.
//
// Aufruf vom Client (same-origin, daher kein CORS nötig):
//   /api/preise?lat=50.65&lng=8.66&rad=5

module.exports = async function handler(req, res) {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  let rad = parseFloat(req.query.rad);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    res.status(400).json({ error: "Parameter lat/lng fehlen oder sind ungültig." });
    return;
  }
  if (Number.isNaN(rad) || rad <= 0) rad = 5;
  if (rad > 25) rad = 25; // Tankerkönig erlaubt max. 25 km

  const key = process.env.TANKERKOENIG_KEY;
  if (!key) {
    res.status(500).json({ error: "TANKERKOENIG_KEY ist nicht konfiguriert (Vercel Environment Variables)." });
    return;
  }

  const url = "https://creativecommons.tankerkoenig.de/json/list.php"
    + "?lat=" + lat + "&lng=" + lng + "&rad=" + rad + "&sort=dist&type=all&apikey=" + key;

  try {
    const upstream = await fetch(url, { headers: { "User-Agent": "Spritkosten-PWA" } });
    const data = await upstream.json();

    if (data && data.ok === false) {
      res.status(502).json({ error: "Tankerkönig: " + (data.message || data.status || "Anfrage abgelehnt") });
      return;
    }

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");

    // Felder an den Client durchreichen — jetzt inkl. lat/lng für die Kartenansicht
    const stations = Array.isArray(data.stations)
      ? data.stations.map(function (s) {
          return {
            id: s.id,
            name: s.name,
            brand: s.brand,
            street: s.street,
            place: s.place,
            dist: s.dist,
            isOpen: s.isOpen,
            lat: s.lat,
            lng: s.lng,
            e5: s.e5,
            e10: s.e10,
            diesel: s.diesel
          };
        })
      : [];

    res.status(200).json({ ok: true, stations: stations, license: data.license || "MTS-K / Tankerkönig" });
  } catch (e) {
    res.status(502).json({ error: "Tankerkönig ist momentan nicht erreichbar." });
  }
};
