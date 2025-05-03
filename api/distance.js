
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const CACHE_PATH = path.resolve('./cache.json');
const KEYS_PATH = path.resolve('./keys.json');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET requests are allowed' });
  }

  const { from, to, userKey, orsKey } = req.query;

  if (!from || !to) return res.status(400).json({ error: "Missing 'from' or 'to'" });
  if (!orsKey) return res.status(400).json({ error: "Missing ORS key" });

  try {
    const keysRaw = await fs.readFile(KEYS_PATH, 'utf-8');
    const keys = JSON.parse(keysRaw);
    if (!userKey || !keys[userKey]) return res.status(403).json({ error: "Invalid or missing API key" });
  } catch {
    return res.status(500).json({ error: "API key kontrolü başarısız" });
  }

  const key = `${from.toLowerCase()}_${to.toLowerCase()}`;

  let cache = {};
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf-8');
    cache = JSON.parse(raw);
  } catch {}

  if (cache[key]) {
    return res.json({ distance_km: cache[key], source: "cache" });
  }

  try {
    const coord1Res = await fetch(`https://api.openrouteservice.org/geocode/search?text=${encodeURIComponent(from)}&size=1`, {
      headers: { Authorization: orsKey }
    });
    const coord2Res = await fetch(`https://api.openrouteservice.org/geocode/search?text=${encodeURIComponent(to)}&size=1`, {
      headers: { Authorization: orsKey }
    });

    const coord1 = await coord1Res.json();
    const coord2 = await coord2Res.json();

    if (!coord1.features.length || !coord2.features.length) {
      return res.status(400).json({ error: "Geocoding failed", coord1, coord2 });
    }

    const [lon1, lat1] = coord1.features[0].geometry.coordinates;
    const [lon2, lat2] = coord2.features[0].geometry.coordinates;

    const routeRes = await fetch(`https://api.openrouteservice.org/v2/directions/driving-car?start=${lon1},${lat1}&end=${lon2},${lat2}`, {
      headers: {
        Accept: 'application/geo+json',
        Authorization: orsKey
      }
    });

    const route = await routeRes.json();

    if (!route.features || !route.features.length) {
      const responseText = await routeRes.text();
      console.error("ORS RESPONSE:", responseText);
      return res.status(500).json({ error: "Route calculation failed", detail: responseText });
    }

    const distance = route.features[0].properties.segments[0].distance / 1000;
    const rounded = Math.round(distance * 100) / 100;

    cache[key] = rounded;
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));

    res.json({ distance_km: rounded, source: "api" });
  } catch (err) {
    console.error("ORS ERROR:", err);
    res.status(500).json({ error: "Distance calculation failed", detail: err.message });
  }
}
