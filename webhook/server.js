// Package Agent Webhook
// Receives function-call requests from Vapi, orchestrates DHL Tracking API +
// Open-Meteo + Nominatim + Nager.Date, returns a narrated insight.

const express = require('express');
const app = express();
app.use(express.json());

const DHL_API_KEY = process.env.DHL_API_KEY;
const PORT = process.env.PORT || 3000;

// ---------- Helpers ----------

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}) for ${url}: ${text}`);
  }
  return res.json();
}

async function getDhlTracking(trackingNumber) {
  const url = `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`;
  const data = await fetchJson(url, {
    headers: {
      'DHL-API-Key': DHL_API_KEY,
      'Accept': 'application/json'
    }
  });
  const shipment = data.shipments && data.shipments[0];
  if (!shipment) throw new Error('No shipment found for that tracking number');
  return shipment;
}

async function geocode(placeName) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName)}&format=json&limit=1`;
    const data = await fetchJson(url, {
      headers: { 'User-Agent': 'package-agent-demo/1.0' }
    });
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch (e) {
    return null;
  }
}

async function getWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code,wind_speed_10m`;
    const data = await fetchJson(url);
    return data.current || null;
  } catch (e) {
    return null;
  }
}

async function isHoliday(countryCode) {
  try {
    const year = new Date().getFullYear();
    const url = `https://date.nager.at/api/v3/IsTodayPublicHoliday/${countryCode}`;
    const res = await fetch(url);
    return res.status === 200; // 200 = holiday today, 204 = not
  } catch (e) {
    return false;
  }
}

// weather_code 51-67, 80-99 roughly = rain/storm in Open-Meteo's WMO codes
function isBadWeather(weather) {
  if (!weather) return false;
  const code = weather.weather_code;
  return (code >= 51 && code <= 99) || weather.wind_speed_10m > 40;
}

function computeDwellHours(events) {
  if (!events || events.length === 0) return null;
  const last = new Date(events[0].timestamp);
  const now = new Date();
  return Math.round((now - last) / (1000 * 60 * 60) * 10) / 10;
}

// Very rough benchmark dwell times per status type, in hours.
// This is intentionally simple heuristic logic for v1 — no ML needed.
const DWELL_BENCHMARKS = {
  'transit': 8,
  'pre-transit': 24,
  'delivered': 0,
  'failure': 4,
  'unknown': 12
};

function buildNarrative({ shipment, dwellHours, weather, holiday, currentLocation }) {
  const status = shipment.status?.statusCode || 'unknown';
  const description = shipment.status?.description || 'Status unavailable';
  const benchmark = DWELL_BENCHMARKS[status] ?? DWELL_BENCHMARKS.unknown;

  let pace = 'on normal pace';
  let cause = null;

  if (dwellHours !== null && dwellHours > benchmark * 1.5) {
    pace = 'running slower than usual';
    if (weather && isBadWeather(weather)) {
      cause = `there's rough weather here right now — ${weather.precipitation > 0 ? 'rain' : 'strong wind'}`;
    } else if (holiday) {
      cause = "today's a public holiday here, which likely means fewer staff processing shipments";
    }
  }

  let narrative = `I'm currently at ${currentLocation || 'an unknown hub'}. Status: ${description}.`;
  if (dwellHours !== null) {
    narrative += ` I've been here about ${dwellHours} hours, ${pace}.`;
  }
  if (cause) {
    narrative += ` My best guess why: ${cause}.`;
  }

  return narrative;
}

// ---------- Route ----------
// Configured as a Vapi Custom Function / Server URL tool.
// Vapi POSTs { message: { toolCalls: [ { function: { name, arguments } } ] } }
app.post('/track', async (req, res) => {
  try {
    const toolCall = req.body?.message?.toolCalls?.[0];
    const trackingNumber = toolCall?.function?.arguments?.trackingNumber
      || req.body?.trackingNumber; // fallback for direct/manual testing

    if (!trackingNumber) {
      return res.status(400).json({ error: 'trackingNumber is required' });
    }

    const shipment = await getDhlTracking(trackingNumber);
    const events = shipment.events || [];
    const dwellHours = computeDwellHours(events);
    const currentLocation = shipment.status?.location?.address?.addressLocality
      || events[0]?.location?.address?.addressLocality
      || null;
    const countryCode = shipment.status?.location?.address?.countryCode
      || events[0]?.location?.address?.countryCode
      || null;

    let weather = null;
    let holiday = false;

    if (currentLocation) {
      const coords = await geocode(currentLocation);
      if (coords) {
        weather = await getWeather(coords.lat, coords.lon);
      }
    }
    if (countryCode) {
      holiday = await isHoliday(countryCode);
    }

    const narrative = buildNarrative({ shipment, dwellHours, weather, holiday, currentLocation });

    const result = {
      results: [
        {
          toolCallId: toolCall?.id || 'manual-test',
          result: narrative
        }
      ]
    };

    res.json(result);
  } catch (err) {
    console.error(err);
    const toolCall = req.body?.message?.toolCalls?.[0];
    res.json({
      results: [
        {
          toolCallId: toolCall?.id || 'manual-test',
          result: `I couldn't find any info on that tracking number — double check it and try again. (${err.message})`
        }
      ]
    });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Package agent webhook running on port ${PORT}`));
