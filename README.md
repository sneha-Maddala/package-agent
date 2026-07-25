# Package Agent 🎙️📦

A voice agent that lets you talk to your DHL package. Say a real tracking
number out loud — it responds in first person with real status, real dwell
time at its current hub, and (if it's running slow) a real reason why,
cross-referencing live weather and public holiday data.

## Stack
- [Vapi](https://vapi.ai) — voice layer
- DHL Shipment Tracking (Unified) API — real tracking data
- Open-Meteo — real weather at the package's current location
- Nominatim (OpenStreetMap) — geocoding hub names
- Nager.Date — public holiday lookup
- Render — webhook hosting
- Vercel — frontend hosting

## Structure
- `/webhook` — Node/Express backend, orchestrates all API calls, deploy to Render
- `/frontend` — static page with Vapi widget, deploy to Vercel
- `vapi-assistant-config.json` — reference config for the Vapi assistant (system prompt + function schema)

## Setup
See deployment guide in project chat / repo issues.
