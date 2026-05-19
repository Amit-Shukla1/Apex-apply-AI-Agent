<div align="center">

# APEX // APPLY
### AI-Powered Job Application Agent

*Discovers jobs. Fills forms. Applies automatically.*

![Status](https://img.shields.io/badge/status-in%20development-f59e0b)
![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20React%20%7C%20Playwright%20%7C%20Groq-3b82f6)
![License](https://img.shields.io/badge/license-MIT-22c55e)

</div>

---

## What is this?

APEX APPLY is an AI agent that automates the job application process end-to-end.

You upload your resume once. The agent finds jobs on Greenhouse and Lever, reads the form, maps your profile to every field using a deterministic matcher + Groq AI, fills the form, verifies every field was filled correctly, and submits — automatically, across dozens of applications.

---

## How it works

```
Resume PDF
    ↓
Gemini parses → structured profile
    ↓
DuckDuckGo searches Greenhouse + Lever job boards
    ↓
Strict URL validator keeps only real job listings
    ↓
Relevance score — skips jobs below threshold or experience mismatch
    ↓
Playwright opens the apply form
    ↓
DOM fingerprinter reads every field (label, type, options, context)
    ↓
Deterministic matcher fills ~80% of fields instantly (no AI)
    ↓
Groq fills remaining unknown fields (chunked, hallucination-filtered)
    ↓
Verify fill — reads back every field, retries mismatches
    ↓
Submit (or hold for manual review if any field failed)
    ↓
Dashboard tracks everything
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express + Socket.IO |
| Frontend | React |
| Database | MongoDB (Mongoose) |
| Browser Automation | Playwright + stealth plugin |
| AI — Form Mapping | Groq (`llama-3.1-8b-instant`) |
| AI — Resume Parsing | Google Gemini 1.5 Pro |
| Job Discovery | DuckDuckGo HTML search |

---

## Features

- **Automated Discovery** — searches Greenhouse and Lever via DuckDuckGo, validates URLs to reject docs/marketing pages, saves only real job listings
- **Relevance Scoring** — checks required experience vs your resume before wasting a Groq call. Skips jobs you're underqualified for.
- **Two-phase Form Filling** — deterministic label matcher covers 80% of fields with zero AI. Groq only handles what's genuinely unknown.
- **Hallucination Filter** — every selector Groq returns is validated against the actual DOM fingerprint. Invented selectors are dropped before they touch the form.
- **Verify Fill** — after filling, the agent reads back every field value and confirms it actually landed. Mismatches are retried automatically.
- **Autocomplete Handler** — handles custom dropdown components (country, location pickers) that aren't real `<select>` elements
- **Self-healing** — when selectors break, sends page HTML to Groq to generate new ones
- **Live Dashboard** — real-time agent step tracker, job pipeline with status cards, relevance scores, retry buttons, collapsible log panel

---

## Dashboard

The dashboard shows:
- Live agent activity — which step it's on right now (Score → Fingerprint → Map → Fill → Verify → Submit)
- Queue of upcoming jobs
- Job cards with status badges, relevance score bar, and per-job retry button
- Real-time log stream

---

## Setup

### Prerequisites
- Node.js 18+
- MongoDB running locally
- Groq API key — [console.groq.com](https://console.groq.com)
- Gemini API key — [aistudio.google.com](https://aistudio.google.com)

### Install

```bash
git clone https://github.com/Amit-Shukla1/apex-apply.git
cd apex-apply
npm install
cd client && npm install && cd ..
```

### Environment

Create a `.env` file in the root:

```env
GROQ_API_KEY=your_groq_key_here
GEMINI_API_KEY=your_gemini_key_here
MONGO_URI=mongodb://127.0.0.1:27017/apex
CLIENT_URL=http://localhost:3000
PORT=5000
```

### Run

```bash
npm run start        # runs backend + frontend together
npm run backend      # backend only
npm run client       # frontend only
```

Open `http://localhost:3000`

---

## Usage

1. Upload your resume PDF — the agent parses it automatically
2. Fill in your profile details (education, salary range, URLs)
3. Click **▶ Google** to deploy the discovery + application engine
4. Watch the dashboard — jobs are discovered, scored, and applied to in real time
5. Manual review jobs are held open for 90 seconds so you can complete any fields the agent couldn't fill

---

## Project Structure

```
server.js                    Express + Socket.IO server
engines/
  discovery.agent.js         DuckDuckGo search → Greenhouse/Lever URLs
  application.agent.js       Form fingerprint → fill → verify → submit
  healing.agent.js           Self-heals broken selectors via Groq
  orchestrator.js            State machine routing between agents
services/
  browser.manager.js         Playwright context launcher
  parser.service.js          Resume parsing utilities
  stealth.utils.js           Anti-detection helpers
models/
  JobLead.js                 Job lead schema + status tracking
client/src/
  App.js                     Dashboard UI
```

---

## Status

| Feature | Status |
|---|---|
| Job Discovery (Greenhouse + Lever) | ✅ Working |
| Resume Parsing | ✅ Working |
| DOM Fingerprinting | ✅ Working |
| Deterministic Field Mapping | ✅ Working |
| Groq AI Field Mapping | ✅ Working |
| Verify Fill + Retry | ✅ Working |
| Relevance Scoring | ✅ Working |
| Submit | 🔨 Built, enabled for testing |
| Self-healing | ✅ Working |
| Cover Letter Generator | 📋 Planned |
| Adaptive Learning | 📋 Planned |
| Chrome Extension | 📋 Planned |
| Multi-user Auth | 📋 Planned |

---

## Roadmap

- [ ] Enable submit across 10+ verified forms
- [ ] ATS field registry — agent gets smarter with every form it fills
- [ ] Cover letter generator — per-job tailored via Groq
- [ ] Chrome extension — one-click apply from any job page
- [ ] Gmail response tracker — detect when companies reply
- [ ] Multi-user auth + Stripe billing
- [ ] Agency / white-label tier

---

## Contributing

PRs welcome. Please keep files under 600 lines and one responsibility per module.

---

<div align="center">
Built with the intention of making job hunting less painful.
</div>
