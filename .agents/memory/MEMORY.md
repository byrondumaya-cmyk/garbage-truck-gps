# Memory Index

## Project
- [project] Always create a new dedicated branch for major code changes → project-conventions.md
- [project] AG Kit only supports Gemini CLI and Google Antigravity (not other AI coding tools) → project-conventions.md

## Reference — GPS Tracker System
- [reference] MCU: LILYGO T-Call A7670 ESP32. Storage: SD Card + LittleFS → tech-decisions.md
- [reference] Backend: Supabase (PostgreSQL + PostGIS + Edge Functions + Realtime + Auth) → tech-decisions.md
- [reference] Frontend: Vite + React + TypeScript + shadcn/ui + Leaflet.js + Vercel → tech-decisions.md
- [reference] Connectivity: HTTPS REST (ESP32→Supabase), Supabase Realtime (Server→Dashboard) → tech-decisions.md
- [reference] Maps: Leaflet.js + OpenStreetMap, centered on Aliaga Nueva Ecija (15.49°N, 120.83°E) → tech-decisions.md
- [reference] Power: LiFePO4 12V 10Ah + 10W solar + MPPT controller + 12V→5V 3A buck → tech-decisions.md
- [reference] Firmware: C++ Arduino + FreeRTOS tasks, 15s GPS interval moving / 60s stopped → tech-decisions.md
- [reference] Security: API Key (X-API-Key header, bcrypt hashed), JWT, TLS 1.2+, RLS → tech-decisions.md
