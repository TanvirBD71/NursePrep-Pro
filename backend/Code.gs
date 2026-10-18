/**
 * NCLEX/Prometric Prep Platform - Google Apps Script Backend
 * ==========================================================
 * Deploy as Web App: Execute as "Me", access "Anyone".
 *
 * Endpoints:
 *   POST ?action=login        {email, password} -> {success, user_id, target_exam}
 *   POST ?action=register     {email, password, target_exam} -> {success, user_id}
 *   GET  ?action=get_exam     ?exam_type=&count=&category= -> {questions:[{q_id, question_text, options, is_ngn}]}
 *   POST ?action=grade_question {q_id, user_answer} -> {correct_answer, rationale, is_correct}
 *   POST ?action=submit_exam  {user_id, mode, exam_type, answers:[{q_id,user_answer}]} -> {score, correct, total, session_id}
 *   GET/POST ?action=get_dashboard ?user_id= -> {sessions:[{session_id,mode,score,correct,total,timestamp,exam_type}], categoryStats, overall}
 *   GET  ?action=get_categories ?exam_type= -> {categories:[...]}
 *   GET  ?action=health       -> {status, time}
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

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

function gradeAnswer(userAnswer, correctAnswer) {
  const norm = function(v) {
    if (Array.isArray(v)) return JSON.stringify(v.slice().sort());
    return String(v).trim().toLowerCase();
  };
  return norm(userAnswer) === norm(correctAnswer);
}

// ---------- doGet ----------

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  if (action === 'get_exam') {
    return handleGetExam(e.parameter);
  }
  if (action === 'get_dashboard') {
    return handleGetDashboard(e.parameter);
  }
  if (action === 'get_categories') {
    return handleGetCategories(e.parameter);
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
    case 'get_dashboard':    return handleGetDashboard(body);
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

// ---------- Categories ----------

function handleGetCategories(params) {
  const examType = params.exam_type || '';
  const data = getSheet('Questions').getDataRange().getValues();
  const set = {};
  for (let i = 1; i < data.length; i++) {
    if (examType && String(data[i][1]) !== examType) continue;
    const c = String(data[i][2] || '').trim();
    if (c) set[c] = true;
  }
  const categories = Object.keys(set).sort();
  return corsResponse({ success: true, categories: categories });
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

// ---------- Submit exam ----------

function handleSubmitExam(body) {
  const userId = body.user_id;
  const mode = body.mode || 'mock';
  const examType = body.exam_type || '';
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
    progressRows.push([uuid(), null, a.q_id, isCorrect]);
  });

  const sessionId = uuid();
  const total = progressRows.length;
  const score = total ? Math.round((correctCount / total) * 100) : 0;
  const sessions = getSheet('Sessions');
  sessions.appendRow([sessionId, userId, mode, score, new Date().toISOString(), examType]);

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
    total: total
  });
}

// ---------- Dashboard aggregation ----------

function handleGetDashboard(params) {
  const userId = params.user_id;
  const sessionsSheet = getSheet('Sessions');
  const progressSheet = getSheet('Progress');
  const questionsSheet = getSheet('Questions');

  const qMap = {};
  const qData = questionsSheet.getDataRange().getValues();
  for (let i = 1; i < qData.length; i++) {
    qMap[qData[i][0]] = { category: String(qData[i][2] || 'Unknown'), exam_type: String(qData[i][1] || '') };
  }

  const sData = sessionsSheet.getDataRange().getValues();
  const sessions = [];
  const sessionIds = {};
  for (let i = 1; i < sData.length; i++) {
    if (String(sData[i][1]) !== String(userId)) continue;
    const sid = sData[i][0];
    sessions.push({
      session_id: sid,
      user_id: sData[i][1],
      mode: sData[i][2],
      score: Number(sData[i][3]) || 0,
      timestamp: sData[i][4],
      exam_type: sData[i][5] || ''
    });
    sessionIds[sid] = true;
  }

  const pData = progressSheet.getDataRange().getValues();
  const catStats = {};
  const sessionStats = {};
  let totalQ = 0, totalCorrect = 0;
  for (let i = 1; i < pData.length; i++) {
    const sid = pData[i][1];
    if (!sessionIds[sid]) continue;
    const qid = pData[i][2];
    const isCorrect = pData[i][3] === true || String(pData[i][3]).toLowerCase() === 'true';
    const q = qMap[qid];
    const cat = q ? q.category : 'Unknown';
    if (!catStats[cat]) catStats[cat] = { total: 0, correct: 0 };
    catStats[cat].total++;
    if (!sessionStats[sid]) sessionStats[sid] = { total: 0, correct: 0 };
    sessionStats[sid].total++;
    if (isCorrect) catStats[cat].correct++;
    if (isCorrect) sessionStats[sid].correct++;
    totalQ++;
    if (isCorrect) totalCorrect++;
  }

  sessions.forEach(function(session) {
    const stats = sessionStats[session.session_id];
    session.correct = stats ? stats.correct : 0;
    session.total = stats ? stats.total : 0;
    if (stats && stats.total) {
      session.score = Math.round(stats.correct / stats.total * 100);
    }
  });

  const categoryStats = Object.keys(catStats).map(function(c) {
    return {
      category: c,
      total: catStats[c].total,
      correct: catStats[c].correct,
      accuracy: catStats[c].total ? Math.round(catStats[c].correct / catStats[c].total * 100) : 0
    };
  }).sort(function(a, b) { return a.accuracy - b.accuracy; });

  const scores = sessions.map(function(s) { return Number(s.score) || 0; });
  const overall = {
    sessions: sessions.length,
    avgScore: scores.length ? Math.round(scores.reduce(function(a, b) { return a + b; }, 0) / scores.length) : 0,
    bestScore: scores.length ? Math.max.apply(null, scores) : 0,
    totalQuestions: totalQ,
    overallAccuracy: totalQ ? Math.round(totalCorrect / totalQ * 100) : 0
  };

  sessions.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

  return corsResponse({ success: true, sessions: sessions, categoryStats: categoryStats, overall: overall });
}

// ---------- Setup helper (run once manually) ----------

function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabs = {
    'Users': ['user_id','email','password_hash','target_exam'],
    'Questions': ['q_id','exam_type','category','question_text','options_json','correct_answer','rationale','is_ngn'],
    'Sessions': ['session_id','user_id','mode','score','timestamp','exam_type'],
    'Progress': ['log_id','session_id','q_id','is_correct']
  };
  Object.keys(tabs).forEach(function(name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.clear();
    sh.appendRow(tabs[name]);
    sh.getRange(1,1,1,tabs[name].length).setFontWeight('bold');
  });
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

    ['q6','NCLEX-RN','Management of Care','Which task can be delegated to an unlicensed assistive personnel (UAP)?', JSON.stringify(['Administer oral medications','Obtain vital signs on a stable client','Perform sterile dressing change','Assess pain level']), 'Obtain vital signs on a stable client', 'UAPs may obtain vital signs on stable clients; assessment and medication administration remain with licensed staff.', false],
    ['q7','NCLEX-RN','Management of Care','A nurse is prioritizing care for four clients. Which client should be seen first?', JSON.stringify(['Client with stable COPD awaiting discharge','Client with chest pain and diaphoresis','Client needing routine wound dressing',' Client with scheduled lab draw']), 'Client with chest pain and diaphoresis', 'Chest pain with diaphoresis suggests acute cardiac event and takes highest priority.', false],
    ['q8','NCLEX-RN','Safety and Infection Control','Which precaution is required for a client with suspected tuberculosis?', JSON.stringify(['Contact precautions','Droplet precautions','Airborne precautions','Standard precautions only']), 'Airborne precautions', 'TB is transmitted via airborne droplet nuclei; airborne precautions with N95 are required.', false],
    ['q9','NCLEX-RN','Safety and Infection Control','Select all that apply: Which are standard precautions?', JSON.stringify(['Hand hygiene','Use of PPE','Safe injection practices','Isolation of all clients']), JSON.stringify(['Hand hygiene','Use of PPE','Safe injection practices']), 'Standard precautions apply to all clients and include hand hygiene, PPE, and safe injection practices.', true],
    ['q10','NCLEX-RN','Health Promotion and Maintenance','Which screening is recommended for women aged 50-74?', JSON.stringify(['Mammogram every 1-2 years','Pap smear annually','Colonoscopy at age 30','PSA testing']), 'Mammogram every 1-2 years', 'USPSTF recommends biennial mammography for women 50-74.', false],

    ['q11','NCLEX-RN','Psychosocial Integrity','A client with schizophrenia reports hearing voices. The best response is:', JSON.stringify(['Tell them the voices are not real','Ask what the voices are saying',' Ignore the statement','Increase antipsychotic dose']), 'Ask what the voices are saying', 'Assessing the content of hallucinations is essential for safety.', false],
    ['q12','NCLEX-RN','Basic Care and Comfort','Which position helps relieve dyspnea in a client with heart failure?', JSON.stringify(['Supine','Trendelenburg','High Fowler','Prone']), 'High Fowler', 'High Fowler position reduces venous return and eases breathing.', false],
    ['q13','NCLEX-RN','Basic Care and Comfort','Which intervention prevents pressure ulcers in an immobilized client?', JSON.stringify(['Massage bony prominences','Reposition every 2 hours','Keep head of bed at 45 degrees','Use donut cushions']), 'Reposition every 2 hours', 'Regular repositioning offloads pressure and prevents ulcers.', false],
    ['q14','NCLEX-RN','Reduction of Risk Potential','Which lab value indicates therapeutic warfarin effect?', JSON.stringify(['PT 12 sec','INR 2.5','aPTT 60 sec','Platelets 150k']), 'INR 2.5', 'Therapeutic INR for warfarin is typically 2.0-3.0.', false],
    ['q15','NCLEX-RN','Reduction of Risk Potential','A client with low potassium should be monitored for:', JSON.stringify(['Bradycardia','Peaked T waves','Muscle weakness','Hypertension']), 'Muscle weakness', 'Hypokalemia causes muscle weakness and cardiac dysrhythmias.', false],

    ['q16','NCLEX-RN','Physiological Adaptation','Which finding indicates increased intracranial pressure?', JSON.stringify(['Bradycardia','Hypotension','Tachypnea','Pinpoint pupils']), 'Bradycardia', 'Cushings triad includes bradycardia, hypertension, and irregular respirations.', false],
    ['q17','NCLEX-RN','Physiological Adaptation','Select all that apply: Signs of hypoglycemia include:', JSON.stringify(['Sweating','Confusion','Polyuria','Tremors']), JSON.stringify(['Sweating','Confusion','Tremors']), 'Hypoglycemia presents with sweating, tremors, confusion; polyuria is hyperglycemia.', true],
    ['q18','NCLEX-RN','Pharmacological Therapies','Which medication requires monitoring of serum drug levels?', JSON.stringify(['Amoxicillin','Vancomycin','Acetaminophen','Lisinopril']), 'Vancomycin', 'Vancomycin requires trough level monitoring to prevent toxicity.', false],
    ['q19','NCLEX-RN','Pharmacological Therapies','A client starting SSRIs should be taught about:', JSON.stringify(['Immediate mood improvement','Risk of serotonin syndrome','No drug interactions',' Stop abruptly if side effects']), 'Risk of serotonin syndrome', 'SSRIs carry risk of serotonin syndrome, especially with other serotonergic drugs.', false],
    ['q20','NCLEX-RN','Infection Prevention & Control','Which is the most effective way to prevent MRSA transmission?', JSON.stringify(['Prophylactic antibiotics','Hand hygiene',' Isolation of all visitors',' Daily chlorhexidine baths for all']), 'Hand hygiene', 'Hand hygiene is the single most effective infection prevention measure.', false],

    ['q21','Prometric','Management of Care','Which action should the nurse take first when a fire occurs on the unit?', JSON.stringify(['Pull fire alarm','Evacuate clients','Extinguish fire','Close doors']), 'Pull fire alarm', 'RACE: Rescue, Alarm, Confine, Extinguish; alarm is priority after rescue.', false],
    ['q22','Prometric','Safety and Infection Control','Which client is at highest risk for falls?', JSON.stringify(['Young adult post-appendectomy','Elderly client on opioids and sedatives','Adolescent with sprained ankle','Middle-aged client with HTN']), 'Elderly client on opioids and sedatives', 'Advanced age plus CNS-depressing medications increases fall risk.', false],
    ['q23','Prometric','Pharmacological Therapies','Which antidote is used for heparin overdose?', JSON.stringify(['Vitamin K','Protamine sulfate','Naloxone','Flumazenil']), 'Protamine sulfate', 'Protamine sulfate reverses heparin.', false],
    ['q24','Prometric','Pharmacological Therapies','Select all that apply: Adverse effects of opioids include:', JSON.stringify(['Respiratory depression','Constipation','Hypertension','Sedation']), JSON.stringify(['Respiratory depression','Constipation','Sedation']), 'Opioids cause respiratory depression, constipation, and sedation; not hypertension.', true],
    ['q25','Prometric','Physiological Adaptation','Which sign indicates shock?', JSON.stringify(['Hypertension','Warm dry skin','Tachycardia','Bradypnea']), 'Tachycardia', 'Shock presents with tachycardia, hypotension, and cool clammy skin.', false],
    ['q26','Prometric','Basic Care and Comfort','Which diet is appropriate for a client with dysphagia?', JSON.stringify(['Regular diet','Clear liquid only','Thickened liquids and pureed foods','High fiber diet']), 'Thickened liquids and pureed foods', 'Dysphagia diets use thickened liquids and pureed textures to prevent aspiration.', false],
    ['q27','Prometric','Health Promotion and Maintenance','Which vaccine is recommended annually?', JSON.stringify(['Hepatitis B','Influenza','MMR','Varicella']), 'Influenza', 'Influenza vaccine is recommended annually for all eligible individuals.', false],
    ['q28','Prometric','Reduction of Risk Potential','Which finding requires immediate intervention in a post-op client?', JSON.stringify(['Pain 4/10','Urine output 30 mL/hr','Oxygen saturation 88%','Temperature 37.2 C']), 'Oxygen saturation 88%', 'SpO2 88% indicates hypoxemia requiring immediate action.', false],
    ['q29','Prometric','Psychosocial Integrity','Best response to a grieving client is:', JSON.stringify(['"You should move on."','"Everything happens for a reason."','"I am here with you."','"At least they lived a long life."']), '"I am here with you."', 'Therapeutic presence and empathy support grieving clients.', false],
    ['q30','Prometric','Infection Prevention & Control','Which PPE is used for droplet precautions?', JSON.stringify(['N95 respirator','Surgical mask','Gown and gloves only','Face shield only']), 'Surgical mask', 'Droplet precautions require a surgical mask within 3 feet of the client.', false]
  ];
  samples.forEach(function(r){ q.appendRow(r); });
}