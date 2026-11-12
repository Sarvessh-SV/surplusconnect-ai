# SurplusConnect AI

**SurplusConnect AI** is a full-stack, AI-coordinated surplus inventory redistribution platform that connects businesses with surplus food inventory (`restaurants`, `bakeries`, `supermarkets`, `groceries`, `retailers`) to verified community recipient organizations (`orphanages`, `old-age homes`, `NGOs`, `shelters`, `food banks`, `community kitchens`), optimizes cold-chain logistics, funds transport through PayPal Developer Sandbox, and records transparent social impact.

## Core Architecture

- **Frontend:** Next.js App Router, TypeScript, Tailwind CSS v4, Framer Motion, Recharts, Lucide Icons, `@vis.gl/react-google-maps` (Google Maps Platform & Routes visualization)
- **Backend:** Python FastAPI, Pydantic v2, PyJWT + bcrypt RBAC (`business`, `organization`, `delivery_partner`, `sponsor`, `admin`)
- **Database:** MongoDB Atlas via async `motor` (with a transparent local JSON disk-persisted `mongomock-motor` fallback for instant offline/hackathon bootstrapping when `MONGODB_URI` is unset)
- **AI & ML:**
  - **Scikit-learn:** `SurplusDetectionEngine` (`RandomForestClassifier` + `GradientBoostingRegressor` + strict expiry/storage safety rules) and `DemandIntelligenceEngine` (7-day predictive demand forecasting with urgency scoring and online retraining)
  - **LangGraph:** Stateful multi-stage `COORDINATION_GRAPH` orchestrating surplus analysis, primary matching + multi-organization quantity splitting, **Intelligent Fallback Matching** (radius expansion, alternative organizations, safe storage hubs, future rescue windows), logistics optimization, funding recommendation, and **Human-in-the-Loop (HITL)** approval gates
  - **Gemini API:** `google-genai` (`gemini-3.8-flash`) `client.interactions.create` with structured JSON schemas and authorized backend tool calls
- **Maps & Routing:** Google Maps Platform JavaScript SDK + backend Google Routes API v2 proxy (`routes.googleapis.com/directions/v2:computeRoutes`) + Geocoding API
- **Payments:** PayPal Developer Sandbox REST API (`api-m.sandbox.paypal.com`):
  - **Orders API v2** (`POST /v2/checkout/orders`, `POST /v2/checkout/orders/{id}/capture`) for sponsor & organization transport funding
  - **Payouts API v1** (`POST /v1/payments/payouts`) for admin-approved delivery partner disbursements upon confirmed delivery completion

## Environment Configuration

Copy `.env.example` to `backend/.env` (and set `NEXT_PUBLIC_*` variables in `frontend/.env.local` if desired):

- `MONGODB_URI`: MongoDB Atlas connection string (`mongodb+srv://...`)
- `GEMINI_API_KEY`: Google Gemini Developer API key (uses `gemini-3.8-flash`)
- `GOOGLE_MAPS_API_KEY` & `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: Google Maps Platform key (or Google Maps Demo Key for prototyping)
- `PAYPAL_CLIENT_ID` & `PAYPAL_CLIENT_SECRET`: PayPal Developer Sandbox REST App credentials

> **Integrity & Transparency:** When external API keys (`PAYPAL_CLIENT_ID`, `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `MONGODB_URI`) are not configured, the platform explicitly surfaces configuration status rather than fabricating live payments or production statistics. Demo seed records (`is_demo_seed=true`) are tracked separately from live session metrics.

## Seeded Hackathon Demo Accounts

All demo accounts share the password **`SurplusDemo2026!`** and can be switched with one click inside the app header or `/login`:

- **Business / Donor:** `donor@greenhearthbakery.demo`, `donor@freshharvestmarket.demo`
- **Recipient Organization:** `org@hopehaven.demo` (+ Bay Area shelters, orphanages, food banks)
- **Delivery Partner:** `driver@ecohaul.demo`, `driver@swiftgreen.demo`, `driver@urbanbike.demo`
- **Sponsor:** `sponsor@impactfund.demo`
- **Admin:** `admin@surplusconnect.demo`

## Running Locally

### 1. Backend (FastAPI + Pytest)

```powershell
cd d:\surplusconnect-ai\backend
.\.venv\Scripts\python.exe -m pytest -v
.\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
```

### 2. Frontend (Next.js)

```powershell
cd d:\surplusconnect-ai\frontend
npm run dev
```

Visit `http://localhost:3000`.

