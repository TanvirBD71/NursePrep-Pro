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
5. Confirm `SHEET_ID` in `backend/Code.gs` points to your intended Google Sheet.
6. For a brand-new database only, run `setupSheets()` once (authorize when prompted) to create tabs and seed sample questions. Never rerun it for an existing database.
7. Deploy: **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Copy the Web App URL.
9. After backend code changes, open **Deploy → Manage deployments**, edit the web app deployment, choose **New version**, and deploy. Keep the same deployment URL in `frontend/js/api.js`. The dashboard requires a deployment that includes the `get_dashboard` action for GET or POST.
10. For an existing database, deploy the updated backend without running `setupSheets()`: it clears existing tabs. The profile endpoints safely append missing profile columns to the existing `Users` header after the user authenticates.

### 2. Frontend
1. Open `frontend/js/api.js` and set `API_BASE` to your Web App URL (or use `setApiBase(url)` in the browser console).
2. Serve `frontend/` via GitHub Pages, Vercel, or any static host.
   - Vercel: import the repo and set the **Root Directory** to `frontend` (or keep the repo root — `vercel.json` already points `outputDirectory` to `frontend`).
3. For local testing, open `frontend/index.html` directly (some browsers block fetch to GAS from file://; use a local server).

## API Endpoints
- `POST ?action=login` — `{email, password}` → `{success, user_id, target_exam}`
- `POST ?action=register` — `{email, password, target_exam, profile:{full_name, mobile, blood_group, birth_date, nursing_college, address}}` → `{success, user_id, target_exam}`; name, email, password, mobile, birth date, nursing college, and target exam are required.
- `POST ?action=get_profile` — `{user_id, current_password}` → `{profile, target_exam}`
- `POST ?action=update_account` — `{user_id, current_password, target_exam, profile, new_password?}` → `{profile, target_exam, password_changed}`
- `POST ?action=delete_account` — `{user_id, current_password}` → permanently deletes the user, their profile, sessions, and associated progress.
- `GET  ?action=get_exam` — `?exam_type=&count=&category=` → `{questions:[...]}`
- `POST ?action=grade_question` — `{q_id, user_answer}` → `{correct_answer, rationale, is_correct}`
- `POST ?action=submit_exam` — `{user_id, mode, exam_type, answers}` → `{score, correct, total, session_id}`
- `GET/POST ?action=get_dashboard` — `?user_id=` (or JSON `{action:"get_dashboard", user_id}`) → `{sessions:[{session_id, mode, score, correct, total, timestamp, exam_type}], categoryStats, overall}`; sessions are returned newest first. The frontend falls back to POST if the deployment does not recognize the GET action.
- `GET  ?action=get_categories` — `?exam_type=` → `{categories:[...]}`

## Notes
- Passwords are SHA-256 hashed before storage.
- Profile updates require a full name and a 7–15 digit mobile number. Registration status is required, and an RN number is required only when registered. Blood group, address, nursing college, and birthday are optional in profile updates. Age is calculated from the birthday in the profile screen and is not stored separately.
- New registrations require name, email, an 8+ character password, mobile number, birthday, nursing college, and target exam. Blood group and address are optional. Users need to remember their password to view or edit profile details later.
- Viewing or saving profile/account details requires the current password. New passwords must be at least 8 characters; leave the new password blank to keep the existing one.
- Registration and password forms provide show/hide controls and require confirmation before creating/changing a password. Account deletion requires the current password and typing `DELETE`; it permanently removes the user's sessions and progress.
- After updating `backend/Code.gs`, deploy a new Apps Script web app version before using Profile & Account. The first authenticated profile request adds missing profile headers to the existing `Users` sheet without clearing account or question data.
- Correct answers are never sent to the client during Mock Exams until final submission (grading happens server-side).
- SATA questions require exact array match for full credit.
