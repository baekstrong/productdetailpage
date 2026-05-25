# Admin Real Data Connection Implementation Plan

> **For Hermes:** Implement this plan task-by-task with TDD and browser smoke checks.

**Goal:** Replace the mock `admin.html` reservation table with real Supabase-backed class and reservation data.

**Architecture:** `admin.html` stays on GitHub Pages and only holds the public Supabase URL/key. Private reservation reads and status updates go through a Supabase Edge Function that verifies an admin password hash and uses the service role key server-side.

**Tech Stack:** Static HTML/JS, Supabase REST API, Supabase Edge Functions, Python unittest static checks.

---

## Task 1: Add static tests for the real-data admin contract

**Objective:** Lock the expected implementation shape before changing production code.

**Files:**
- Modify: `tests/test_static_pages.py`

**Acceptance:** Tests require `admin-reservations`, reject demo rows/localStorage mock data, and require class/reservation API helpers.

## Task 2: Implement `admin-reservations` Edge Function

**Objective:** Provide a server-side admin API for list/update without exposing service role credentials.

**Files:**
- Create: `supabase/functions/admin-reservations/index.ts`

**API:**
- `POST { action: "list", password }`
- `POST { action: "updateReservation", password, reservationId, updates }`

**Security:**
- Verify `ADMIN_PASSWORD_HASH` using SHA-256.
- Read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from function secrets.
- Never return the service role key.

## Task 3: Replace `admin.html` mock data with real API calls

**Objective:** Render actual classes and reservations from the Edge Function.

**Files:**
- Modify: `admin.html`

**Behavior:**
- Login keeps admin password in memory only.
- `loadAdminData()` calls `/functions/v1/admin-reservations`.
- Class dropdown displays Supabase classes.
- Reservation table filters by selected class.
- Row buttons update reservation/payment status through Edge Function.

## Task 4: Verify locally and commit

**Objective:** Prove static tests pass and the page has no obvious browser JS error.

**Commands:**
- `python3 -m unittest tests/test_static_pages.py`
- local browser smoke check with `python3 -m http.server` and console inspection

## Out of scope for this step

- Solapi real SMS sending
- Supabase Edge Function deployment from this machine if CLI is unavailable
- Strong signed admin session tokens
