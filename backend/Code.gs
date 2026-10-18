/**
 * NCLEX/Prometric Prep Platform - Google Apps Script Backend
 * ==========================================================
 * Deploy as Web App: Execute as "Me", access "Anyone".
 *
 * Endpoints:
 *   POST ?action=login        {email, password} -> {success, user_id, target_exam}
 *   GET  ?action=get_exam     ?exam_type=&count=&category= -> {questions:[{q_id, question_text, options, is_ngn}]}
 *   POST ?action=grade_question {q_id, user_answer} -> {correct_answer, rationale, is_correct}
 *   POST ?action=submit_exam  {user_id, mode, answers:[{q_id,user_answer}]} -> {score, total, session_id}
 *   POST ?action=register     {email, password, target_exam} -> {success, user_id}
 */

const SHEET_ID = '10kMeeH_4uvVaVWHDbI4iPjkZF8oWO6Ijf7L8Vw7pqUg'; // Replace with your Google Sheet ID

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(name);
}

// ---------- Helpers ----------

function sha256(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function uuid() {
  return Utilities.getUuid();
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function corsResponse(obj) {
  // GAS web apps handle CORS via deployment settings; returning JSON is enough.
  return jsonResponse(obj);
}

function parseBody(e) {
  try {
    if (e.postData && e.postData.contents) {
      return JSON.parse(e.postData.contents);
    }
  } catch (err) {}
  return e.parameter || {};
}

function findUserRow(sheet, email) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === String(email).toLowerCase()) {
      return { row: i + 1, values: data[i] };
    }
  }
  return null;
}

// ---------- doGet ----------

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  if (action === 'get_exam') {
    return handleGetExam(e.parameter);
  }
  if (action === 'health') {
    return corsResponse({ status: 'ok', time: new Date().toISOString() });
  }
  return corsResponse({ error: 'Unknown GET action: ' + action });
}

// ---------- doPost ----------

function doPost(e) {
  const body = parseBody(e);
  const action = body.action || (e.parameter && e.parameter.action) || '';
  switch (action) {
    case 'login':            return handleLogin(body);
    case 'register':         return handleRegister(body);
    case 'grade_question':   return handleGradeQuestion(body);
    case 'submit_exam':      return handleSubmitExam(body);
    default:
      return corsResponse({ error: 'Unknown POST action: ' + action });
  }
}

// ---------- Auth ----------

function handleRegister(body) {
  const email = (body.email || '').trim();
  const password = body.password || '';
  const targetExam = body.target_exam || 'NCLEX-RN';
  if (!email || !password) {
    return corsResponse({ success: false, error: 'Email and password required.' });
  }
  const users = getSheet('Users');
  if (findUserRow(users, email)) {
    return corsResponse({ success: false, error: 'Email already registered.' });
  }
  const userId = uuid();
  const hash = sha256(password);
  users.appendRow([userId, email, hash, targetExam]);
  return corsResponse({ success: true, user_id: userId, target_exam: targetExam });
}

function handleLogin(body) {
  const email = (body.email || '').trim();
  const password = body.password || '';
  if (!email || !password) {
    return corsResponse({ success: false, error: 'Email and password required.' });
  }
  const users = getSheet('Users');
  const found = findUserRow(users, email);
  if (!found) {
    return corsResponse({ success: false, error: 'Invalid credentials.' });
  }
  const hash = sha256(password);
  if (hash !== String(found.values[2])) {
    return corsResponse({ success: false, error: 'Invalid credentials.' });
  }
  return corsResponse({
    success: true,
    user_id: found.values[0],
    email: found.values[1],
    target_exam: found.values[3]
  });
}

// ---------- Exam retrieval (scrubbed) ----------

function handleGetExam(params) {
  const examType = params.exam_type || 'NCLEX-RN';
  const count = parseInt(params.count, 10) || 10;
  const category = params.category || '';
  const questionsSheet = getSheet('Questions');
  const data = questionsSheet.getDataRange().getValues();
  let pool = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[1]) !== examType) continue;
    if (category && String(row[2]) !== category) continue;
    pool.push({
      q_id: row[0],
      exam_type: row[1],
      category: row[2],
      question_text: row[3],
      options: safeParse(row[4], []),
      is_ngn: row[7] === true || String(row[7]).toLowerCase() === 'true'
    });
  }
  // Randomize
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  const selected = pool.slice(0, Math.min(count, pool.length));
  return corsResponse({ success: true, questions: selected, total: selected.length });
}

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

// ---------- Grading single question ----------

function handleGradeQuestion(body) {
  const qId = body.q_id;
  const userAnswer = body.user_answer;
  const questionsSheet = getSheet('Questions');
  const data = questionsSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(qId)) {
      const correct = safeParse(data[i][5], data[i][5]);
      const rationale = data[i][6];
      const isCorrect = gradeAnswer(userAnswer, correct);
      return corsResponse({
        success: true,
        correct_answer: correct,
        rationale: rationale,
        is_correct: isCorrect
      });
    }
  }
  return corsResponse({ success: false, error: 'Question not found.' });
}

function gradeAnswer(userAnswer, correctAnswer) {
  // SATA requires exact match of arrays
  const norm = function(v) {
    if (Array.isArray(v)) return JSON.stringify(v.slice().sort());
    return String(v).trim().toLowerCase();
  };
  return norm(userAnswer) === norm(correctAnswer);
}

// ---------- Submit exam ----------

function handleSubmitExam(body) {
  const userId = body.user_id;
  const mode = body.mode || 'mock';
  const answers = body.answers || [];
  const questionsSheet = getSheet('Questions');
  const qData = questionsSheet.getDataRange().getValues();
  const qMap = {};
  for (let i = 1; i < qData.length; i++) {
    qMap[qData[i][0]] = { correct: safeParse(qData[i][5], qData[i][5]), row: qData[i] };
  }

  let correctCount = 0;
  const progressRows = [];
  answers.forEach(function(a) {
    const q = qMap[a.q_id];
    if (!q) return;
    const isCorrect = gradeAnswer(a.user_answer, q.correct);
    if (isCorrect) correctCount++;
    progressRows.push([uuid(), null, a.q_id, isCorrect]); // session_id filled below
  });

  const sessionId = uuid();
  const score = answers.length ? Math.round((correctCount / answers.length) * 100) : 0;
  const sessions = getSheet('Sessions');
  sessions.appendRow([sessionId, userId, mode, score, new Date().toISOString()]);

  // Write progress with session_id
  const progress = getSheet('Progress');
  progressRows.forEach(function(r) {
    r[1] = sessionId;
    progress.appendRow(r);
  });

  return corsResponse({
    success: true,
    session_id: sessionId,
    score: score,
    correct: correctCount,
    total: answers.length
  });
}

// ---------- Setup helper (run once manually) ----------

function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabs = {
    'Users': ['user_id','email','password_hash','target_exam'],
    'Questions': ['q_id','exam_type','category','question_text','options_json','correct_answer','rationale','is_ngn'],
    'Sessions': ['session_id','user_id','mode','score','timestamp'],
    'Progress': ['log_id','session_id','q_id','is_correct']
  };
  Object.keys(tabs).forEach(function(name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.clear();
    sh.appendRow(tabs[name]);
    sh.getRange(1,1,1,tabs[name].length).setFontWeight('bold');
  });
  // Seed sample questions
  seedSampleQuestions();
}

function seedSampleQuestions() {
  const q = getSheet('Questions');
  const samples = [
    ['q1','NCLEX-RN','Pharmacological Therapies','A client is prescribed metformin. Which side effect is most common?', JSON.stringify(['Nausea','Hypoglycemia','Weight gain','Bradycardia']), 'Nausea', 'Metformin commonly causes GI upset such as nausea, especially when starting therapy.', false],
    ['q2','NCLEX-RN','Infection Prevention & Control','Which action best prevents catheter-associated urinary tract infection (CAUTI)?', JSON.stringify(['Routine catheter changes','Maintain closed drainage system','Irrigate daily','Use larger catheter']), 'Maintain closed drainage system', 'Maintaining a closed drainage system reduces bacterial entry.', false],
    ['q3','NCLEX-RN','Pharmacological Therapies','Select all that apply: Which are signs of digoxin toxicity?', JSON.stringify(['Nausea','Visual halos','Bradycardia','Tachycardia']), JSON.stringify(['Nausea','Visual halos','Bradycardia']), 'Digoxin toxicity presents with GI symptoms, visual disturbances, and bradycardia.', true],
    ['q4','Prometric','Pharmacological Therapies','A patient on warfarin should avoid which food?', JSON.stringify(['Spinach','Chicken','Rice','Apples']), 'Spinach', 'Vitamin K-rich foods like spinach antagonize warfarin.', false],
    ['q5','Prometric','Infection Prevention & Control','Hand hygiene should be performed for at least how many seconds?', JSON.stringify(['10','15','20','30']), '20', 'WHO recommends at least 20 seconds of handwashing.', false],
  ];
  samples.forEach(function(r){ q.appendRow(r); });
}
