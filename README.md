**▶ Live demo — [patienttriage-ai.vercel.app](https://patienttriage-ai.vercel.app)** · sign in with roll number `NUR-1042` and any password. Runs on the deterministic rule engine; the AI layer is disabled in the hosted build so no API key ships in the bundle.

# PatientTriage.ai

**A real-time patient routing intelligence layer for overwhelmed emergency departments.**

Built for the **Accenture Innovation Challenge 2026** by **Team Themistocles** (IIT Kanpur) — Aadi Chhajed, Team Leader.

> PatientTriage.ai does not diagnose. It recommends where a patient should go and how urgently, using a deterministic rule engine informed by real-time hospital state — and every recommendation is reviewable and overridable by the nurse. The clinical decision always stays human.

---

## The problem

ED triage is a 30-second, high-stakes classification made under load by one person. National ESI research puts the error rate at roughly 1 in 6, worst in the undifferentiated middle of the severity scale — and those errors show up as delayed time-to-treatment.

Two things make this hard to solve generically:

- **Every hospital is different.** Departments, care pathways, room types, escalation rules, and staffing constraints vary enormously — a one-size-fits-all triage model routes patients to the wrong destination.
- **Resources move in real time.** Doctors, nurses, beds, rooms, and equipment change by the hour. A routing decision made without live visibility into hospital state is already stale by the time it's acted on.

## The solution

PatientTriage.ai combines patient information with real-time hospital context to recommend the safest, fastest, appropriate route — while the nurse stays in control the entire time.

- **Ask less, understand more.** Multimodal intake (typed, voice-simulated, photo) extracts what it can and only asks for what's actually missing and routing-relevant.
- **AI analyzes, rules decide.** An LLM turns unstructured narrative into structured fields and gives a second opinion — but the urgency score and pathway always come from an auditable, deterministic rule engine, never from the model directly.
- **Clear insight, not a black box.** Every recommendation ships with its reasons, its confidence score, and an explicit list of what's missing or uncertain.
- **Nurse in control.** Accept, override, or escalate any recommendation. Every override is logged with who, what changed, and why.

---

## What's in this repo

This repo holds two parallel implementations built from the same design spec (see [`AGENTS.md`](AGENTS.md)):

| | Path | Stack | Status |
|---|---|---|---|
| **Mobile app** (primary) | [`expo-app/`](expo-app) | React Native + Expo, TypeScript | Actively developed, verified on Android device and web |
| **Web prototype** | [`src/`](src) | Next.js, TypeScript | Earlier reference implementation |

The mobile app in `expo-app/` is the fully-featured, actively maintained build — start there.

> **Full inventory:** [FEATURES.md](FEATURES.md) lists exactly what is in the app,
> including known limitations, and carries the commands to re-verify itself.

### Core features (verified working, not aspirational)

- **8-step nurse onboarding wizard** — arrival mode, patient basics with photo capture, information source/language, chief concern with AI-assisted extraction, onset/trend, symptom-adaptive risk screening, medical history, vitals (every field can be marked "not available" instead of guessed).
- **Deterministic routing engine** ([`expo-app/src/lib/routing.ts`](expo-app/src/lib/routing.ts)) — most-urgent-pathway-wins precedence across 14+ clinical rules, age-differentiated vital thresholds (pediatric *and* geriatric each have their own numeric cutoffs — a fever that's unremarkable in an adult is escalated for a geriatric patient), an asymmetric undertriage safeguard, and a hard cap so stacked risk signals escalate by at most one level rather than compounding unboundedly.
- **Automatic queue monitoring** — a background monitor watches every waiting patient against a safe-wait threshold for their urgency level and raises a critical alert with a full audit entry the moment it's breached, with zero nurse action required.
- **Optional AI layer** ([`expo-app/src/lib/ai.ts`](expo-app/src/lib/ai.ts)) — supports Groq, Google Gemini, or Anthropic for narrative extraction and an advisory second opinion. The app runs fully on rules with no key configured; the AI layer only fills fields a nurse left blank and never touches the urgency score.
- **Live dashboard** — color-coded urgency queue, hospital status (staff/beds/rooms), draft-resume for interrupted intakes, search and filtering.
- **Override + audit trail** — every accept, override, escalate, and reassessment is timestamped and attributed.
- **Simulation controls** — one-tap 3x surge (injects a real arrival burst and constrains actual beds/staff), staff shortage, EHR/device outage, and a full demo-data reset.
- **PDF routing summary** and patient-detail/timeline views for the chart.

### Regulatory framing

The seeded hospital is configured for **India (DPDP Act + hospital privacy policy)** as the assumed jurisdiction. All patient records, vitals, and transcripts in the demo are synthetic. Clinical thresholds used here are illustrative and would require clinical validation before any real deployment — this is a routing decision-support prototype, not a certified medical device.

---

## Getting started

### Mobile app (`expo-app/`) — recommended

```bash
cd expo-app
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone, or press `w` to run it in a browser.

**Optional — enable the AI layer:**

```bash
cp .env.example .env
# paste a Groq / Gemini / Anthropic key into .env, then restart:
npx expo start --clear
```

See [`expo-app/.env.example`](expo-app/.env.example) for all provider options. Without a key, the app runs the full flow on the deterministic rule engine alone.

### Web prototype (`src/`)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Demo video

A walkthrough video is linked from this repository as part of the submission. *(Add the link here once recorded.)*

---

## Design principles

The full behavioral spec this build follows is in [`AGENTS.md`](AGENTS.md): routing over diagnosis, human-in-the-loop, real-time hospital state, fast initial response with progressive enrichment, worst-case-aware degradation, and an explicit bias toward escalation under uncertainty rather than optimizing for average-case accuracy.
