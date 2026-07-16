---
type: reference
created: 2026-07-16
updated: 2026-07-16
---

# Tech Decisions — Garbage Truck GPS Tracking System

> All decisions finalized from brainstorm session. Use these in ALL future sessions.

## Hardware
- **MCU:** LILYGO T-Call A7670 (ESP32) — primary edge device
- **GPS Antenna:** External active GPS antenna (SMA connector) — better sky view
- **LTE Antenna:** External LTE antenna (SMA connector) — better rural signal
- **Local Storage:** SD Card (8GB, SanDisk Industrial) as primary + LittleFS as fallback/config
- **Battery:** LiFePO4 12V 10Ah — temperature-safe, 2000+ cycles
- **Solar Panel:** 10W monocrystalline
- **Charge Controller:** MPPT (not PWM) — 20–30% more efficient
- **Buck Converter:** 12V → 5V 3A DC-DC for stable ESP32 power
- **Enclosure:** IP67 waterproof, temperature-resistant

## Connectivity
- **ESP32 → Backend:** HTTPS REST (POST batches every 15s) — reliable, battery-efficient
- **Backend → Dashboard:** Supabase Realtime (WebSocket) — live map updates
- **Protocol Rejected:** MQTT (requires broker), WebSocket from device (battery drain)

## Backend
- **Platform:** Supabase (single platform: DB + Auth + Realtime + Edge Functions)
- **Database:** PostgreSQL with PostGIS extension
- **Validation Layer:** Supabase Edge Functions (API key validation before DB writes)
- **Auth:** Supabase Auth (JWT for dashboard users)
- **Rejected:** Firebase (NoSQL limitations), Cloudflare Workers (complexity)

## Frontend / Dashboard
- **Framework:** Vite + React + TypeScript
- **UI Components:** shadcn/ui
- **Maps:** Leaflet.js + OpenStreetMap tiles (free, no API key)
- **Map Center:** Aliaga, Nueva Ecija (15.49°N, 120.83°E)
- **Hosting:** Vercel (free tier, auto-deploy)
- **Rejected:** Google Maps (pay-per-use), Mapbox (SaaS cost)

## Firmware
- **Language:** C++ (Arduino framework + FreeRTOS)
- **Task Architecture:** FreeRTOS multi-task (GPS Mgr, LTE Mgr, Buffer Mgr, Upload Mgr, Power Mgr, Watchdog, Config Mgr, OTA Mgr)
- **Inter-task Comms:** FreeRTOS Queues + EventGroups + Mutexes
- **Buffer Format:** JSONL (one record per line) on SD card
- **Logging Interval:** 15s moving / 60s stationary / 5min low-battery

## GPS Record Fields
- lat, lon, timestamp, speed_kmh, heading_deg, hdop, satellites, battery_mv, battery_pct, rssi_dbm, lte_connected, gps_fix, sequence_no, device_id

## Security
- Device auth: API key in X-API-Key header, bcrypt-hashed in DB
- Dashboard auth: Supabase JWT
- Transport: TLS 1.2+ only
- Row-Level Security (RLS) on all tables
- Rate limiting: max 10 req/min per device in Edge Function

## Power System
- Average draw: ~300mA @ 5V = 1.5W
- Solar generation: 50Wh/day (Philippines, 10W panel × 5h peak sun)
- Battery backup: ~68 hours on LiFePO4 10Ah pack

## Database Tables
- devices, gps_records (with PostGIS GEOGRAPHY column), device_status, system_events
