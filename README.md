# NursePrep Pro — Free NCLEX & Prometric Prep

A zero-cost, serverless nursing exam preparation platform.

## Stack
- **Backend:** Google Apps Script (Web App) + Google Sheets
- **Frontend:** Vanilla JS/HTML/CSS SPA (host on GitHub Pages or Vercel)

## Setup

### 1. Google Sheets (Database)
1. Create a new Google Sheet.
2. Copy its ID from the URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`).
3. Open **Extensions → Apps Script**.
4. Paste the contents of `backend/Code.gs` into `Code.gs`.
5. Replace `YOUR_SPREADSHEET_ID_HERE` with your Sheet ID.
6. Run the `setupSheets` function once (authorize when prompted) to create tabs and seed sample questions.
7. Deploy: **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Copy the Web App URL.

### 2. Frontend
1. Open `frontend/js/api.js` and set `API_BASE` to your Web App URL (or use `setApiBase(url)` in the browser console).
2. Serve `frontend/` via GitHub Pages, Vercel, or any static host.
   - Vercel: import the repo and set the **Root Directory** to `frontend` (or keep the repo root — `vercel.json` already points `outputDirectory` to `frontend`).
3. For local testing, open `frontend/index.html` directly (some browsers block fetch to GAS from file://; use a local server).

## API Endpoints
- `POST ?action=login` — `{email, password}` → `{success, user_id, target_exam}`
- `POST ?action=register` — `{email, password, target_exam}` → `{success, user_id}`
- `GET  ?action=get_exam` — `?exam_type=&count=&category=` → `{questions:[...]}`
- `POST ?action=grade_question` — `{q_id, user_answer}` → `{correct_answer, rationale, is_correct}`
- `POST ?action=submit_exam` — `{user_id, mode, exam_type, answers}` → `{score, total, session_id}`
- `GET  ?action=get_dashboard` — `?user_id=` → `{sessions, categoryStats, overall}`
- `GET  ?action=get_categories` — `?exam_type=` → `{categories:[...]}`

## Notes
- Passwords are SHA-256 hashed before storage.
- Correct answers are never sent to the client during Mock Exams until final submission (grading happens server-side).
- SATA questions require exact array match for full credit.
