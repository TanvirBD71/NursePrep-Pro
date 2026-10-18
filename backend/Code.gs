/**
 * NCLEX/Prometric Prep Platform - Google Apps Script Backend
 * ==========================================================
 * Deploy as Web App: Execute as "Me", access "Anyone".
 *
 * Endpoints:
 *   POST ?action=login        {email, password} -> {success, user_id, target_exam}
 *   POST ?action=register     {email, password, target_exam, profile} -> {success, user_id, target_exam}
 *   POST ?action=get_profile  {user_id, current_password} -> {profile, target_exam}
 *   POST ?action=update_account {user_id, current_password, target_exam, profile, new_password?} -> {profile, target_exam}
 *   POST ?action=delete_account {user_id, current_password} -> {success}
 *   GET  ?action=get_exam     ?exam_type=&count=&category= -> {questions:[{q_id, question_text, options, is_ngn}]}
 *   POST ?action=grade_question {q_id, user_answer} -> {correct_answer, rationale, is_correct}
 *   POST ?action=submit_exam  {user_id, mode, exam_type, answers:[{q_id,user_answer}]} -> {score, correct, total, session_id}
 *   GET/POST ?action=get_dashboard ?user_id= -> {sessions:[{session_id,mode,score,correct,total,timestamp,exam_type}], categoryStats, overall}
 *   GET  ?action=get_categories ?exam_type= -> {categories:[...]}
 *   GET  ?action=health       -> {status, time}
 */

const SHEET_ID = "10kMeeH_4uvVaVWHDbI4iPjkZF8oWO6Ijf7L8Vw7pqUg"; // Replace with your Google Sheet ID
const PROFILE_FIELDS = [
  "full_name",
  "mobile",
  "blood_group",
  "address",
  "nursing_college",
  "is_registered",
  "rn_number",
  "birth_date",
];
const SUPPORTED_EXAM_TYPES = [
  "NCLEX-RN",
  "Prometric",
  "Licence Exam Preparation",
  "IBN SINA Trust Nursing Exam",
];

function getExamTemplate(examType) {
  const normalized = String(examType || "").trim();
  if (normalized === "Licence Exam Preparation") {
    return {
      id: "mixed_100_mark",
      name: normalized,
      totalMarks: 100,
      passMark: 60,
      questionTypes: ["true_false_matrix", "best_answer"],
    };
  }
  if (normalized === "IBN SINA Trust Nursing Exam") {
    return {
      id: "scenario_case_based",
      name: normalized,
      totalMarks: 100,
      passMark: 60,
      negativeMarking: 0.25,
      questionTypes: [
        "scenario_best_answer",
        "scenario_multi_select",
        "best_answer",
      ],
    };
  }
  return {
    id: "standard_mcq",
    name: normalized || "NCLEX-RN",
    totalMarks: 100,
    passMark: 60,
    questionTypes: ["standard_mcq", "best_answer"],
  };
}

function normalizeOptionText(value) {
  if (value == null) return "";
  return String(value)
    .replace(/^[A-Za-z]\s*[\)\.\:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeAnswerList(answerValue, options) {
  const optionLabels = Array.isArray(options)
    ? options.map(function (opt) {
        return String(
          typeof opt === "string" ? opt : (opt && (opt.label || opt.text || opt.option || opt.value)) || "",
        ).trim();
      })
    : [];

  const answerArray = Array.isArray(answerValue)
    ? answerValue
    : typeof answerValue === "string"
      ? answerValue
          .split(/[\n,;|]/)
          .map(function (v) {
            return v.trim();
          })
          .filter(Boolean)
      : [];

  if (!answerArray.length) {
    return [];
  }

  return answerArray
    .map(function (value) {
      const text = String(value).trim();
      if (!text) return "";
      const direct = normalizeOptionText(text);
      const matchedOption = optionLabels.find(function (opt) {
        const optionText = normalizeOptionText(opt);
        return direct === optionText || direct.indexOf(optionText) >= 0 || optionText.indexOf(direct) >= 0;
      });
      return matchedOption ? normalizeOptionText(matchedOption) : direct;
    })
    .filter(Boolean);
}

function inferQuestionType(question) {
  if (question && question.question_type) {
    const normalized = String(question.question_type).trim().toLowerCase();
    if (
      ["true_false_matrix", "true_false", "matrix", "multi_select", "check_all_that_apply"].indexOf(normalized) >= 0
    ) {
      return "true_false_matrix";
    }
    if (normalized === "scenario_multi_select") return "scenario_multi_select";
    if (normalized === "scenario_best_answer") return "scenario_best_answer";
    if (normalized === "best_answer") return "best_answer";
  }
  const options = Array.isArray(question && question.options)
    ? question.options
    : [];
  const correctAnswer = question && question.correct_answer;
  const normalizedCorrect = normalizeAnswerList(correctAnswer, options);
  const hasMatrixPattern =
    options.length >= 5 &&
    (Array.isArray(correctAnswer) || typeof correctAnswer === "string" || typeof correctAnswer === "object");
  if (hasMatrixPattern && normalizedCorrect.length > 1) return "true_false_matrix";
  if (Array.isArray(correctAnswer) && options.length <= 5) return "multi_select";
  return "best_answer";
}

function getQuestionPoints(question) {
  const explicit = Number(
    (question && (question.points_value || question.points)) || 0,
  );
  if (explicit > 0) return explicit;
  const type = String(
    (question && question.question_type) || inferQuestionType(question),
  );
  if (type === "true_false_matrix") return 1;
  if (type === "scenario_multi_select" || type === "multi_select") return 1;
  return 1;
}

function readQuestionRow(row) {
  const r = row || [];
  const options = safeParse(r[4], []);
  const correctAnswer = safeParse(r[5], r[5]);
  const questionType =
    String(r[8] || "").trim() ||
    inferQuestionType({
      options: options,
      correct_answer: correctAnswer,
      is_ngn: r[7] === true || String(r[7]).toLowerCase() === "true",
    });
  return {
    q_id: r[0],
    exam_type: r[1],
    category: r[2],
    question_text: r[3],
    options: Array.isArray(options) ? options : [],
    correct_answer: correctAnswer,
    rationale: r[6],
    is_ngn: r[7] === true || String(r[7]).toLowerCase() === "true",
    question_type: questionType,
    template_id: r[9] || "",
    section_name: r[10] || "",
    points_value:
      Number(r[11]) || getQuestionPoints({ question_type: questionType }),
    raw_row: r,
  };
}

function scoreQuestion(question, userAnswer) {
  if (!question) return 0;
  const qType = String(question.question_type || inferQuestionType(question));
  const points = getQuestionPoints(question);

  if (qType === "true_false_matrix") {
    const optionLabels = Array.isArray(question.options)
      ? question.options.map(function (opt) {
          return typeof opt === "string"
            ? opt
            : (opt && (opt.label || opt.text || opt.option || opt.value)) || "";
        })
      : [];
    const selected = normalizeAnswerList(userAnswer, optionLabels);
    const correct = normalizeAnswerList(question.correct_answer, optionLabels);
    let score = 0;
    optionLabels.forEach(function (label) {
      const item = normalizeOptionText(label);
      const selectedValue = selected.indexOf(item) >= 0;
      const expectedCorrect = correct.indexOf(item) >= 0;
      if (selectedValue && expectedCorrect) score += 0.2;
      if (!selectedValue && !expectedCorrect) score += 0.2;
    });
    return Math.min(points, score);
  }

  if (qType === "scenario_multi_select" || qType === "multi_select") {
    const optionLabels = Array.isArray(question.options)
      ? question.options.map(function (opt) {
          return typeof opt === "string"
            ? opt
            : (opt && (opt.label || opt.text || opt.option || opt.value)) || "";
        })
      : [];
    const selected = normalizeAnswerList(userAnswer, optionLabels);
    const correct = normalizeAnswerList(question.correct_answer, optionLabels);
    const selectedSet = {};
    const correctSet = {};
    selected.forEach(function (v) {
      selectedSet[v] = true;
    });
    correct.forEach(function (v) {
      correctSet[v] = true;
    });
    const allCorrect =
      correct.length === selected.length &&
      correct.every(function (v) {
        return selectedSet[v];
      });
    if (allCorrect) return points;
    let matched = 0;
    correct.forEach(function (v) {
      if (selectedSet[v]) matched++;
    });
    return (matched / Math.max(correct.length, 1)) * points;
  }

  if (
    qType === "standard_mcq" ||
    qType === "best_answer" ||
    qType === "scenario_best_answer"
  ) {
    const userChoice = String(userAnswer == null ? "" : userAnswer).trim();
    const correctChoice = String(
      question.correct_answer == null ? "" : question.correct_answer,
    ).trim();
    return userChoice && userChoice === correctChoice ? points : 0;
  }

  return gradeAnswer(userAnswer, question.correct_answer) ? points : 0;
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(name);
}

// ---------- Helpers ----------

function sha256(str) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    str,
    Utilities.Charset.UTF_8,
  );
  return bytes
    .map(function (b) {
      const v = b < 0 ? b + 256 : b;
      return ("0" + v.toString(16)).slice(-2);
    })
    .join("");
}

function uuid() {
  return Utilities.getUuid();
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
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

function findUserById(sheet, userId) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      return { row: i + 1, values: data[i] };
    }
  }
  return null;
}

function ensureProfileColumns(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(String);
  PROFILE_FIELDS.forEach(function (field) {
    if (headers.indexOf(field) < 0) {
      headers.push(field);
      sheet.getRange(1, headers.length).setValue(field);
    }
  });
  const columns = {};
  PROFILE_FIELDS.forEach(function (field) {
    columns[field] = headers.indexOf(field);
  });
  return columns;
}

function getProfileFromRow(values, columns) {
  const profile = {};
  PROFILE_FIELDS.forEach(function (field) {
    const value = values[columns[field]];
    profile[field] =
      value instanceof Date
        ? Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd")
        : value == null
          ? ""
          : String(value);
  });
  return profile;
}

function isValidBirthDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (
    date.getFullYear() === parts[0] &&
    date.getMonth() === parts[1] - 1 &&
    date.getDate() === parts[2] &&
    date <= today
  );
}

function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function gradeAnswer(userAnswer, correctAnswer) {
  const norm = function (v) {
    if (Array.isArray(v)) return JSON.stringify(v.slice().sort());
    return String(v).trim().toLowerCase();
  };
  return norm(userAnswer) === norm(correctAnswer);
}

// ---------- doGet ----------

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || "";
  if (action === "get_exam") {
    return handleGetExam(e.parameter);
  }
  if (action === "get_dashboard") {
    return handleGetDashboard(e.parameter);
  }
  if (action === "get_categories") {
    return handleGetCategories(e.parameter);
  }
  if (action === "health") {
    return corsResponse({ status: "ok", time: new Date().toISOString() });
  }
  return corsResponse({ error: "Unknown GET action: " + action });
}

// ---------- doPost ----------

function doPost(e) {
  const body = parseBody(e);
  const action = body.action || (e.parameter && e.parameter.action) || "";
  switch (action) {
    case "login":
      return handleLogin(body);
    case "register":
      return handleRegister(body);
    case "get_profile":
      return handleGetProfile(body);
    case "update_account":
      return handleUpdateAccount(body);
    case "delete_account":
      return handleDeleteAccount(body);
    case "grade_question":
      return handleGradeQuestion(body);
    case "submit_exam":
      return handleSubmitExam(body);
    case "get_dashboard":
      return handleGetDashboard(body);
    default:
      return corsResponse({ error: "Unknown POST action: " + action });
  }
}

// ---------- Auth ----------

function handleRegister(body) {
  const email = (body.email || "").trim();
  const password = body.password || "";
  const targetExam = String(body.target_exam || "");
  const profile = body.profile || {};
  const fullName = String(profile.full_name || "").trim();
  const mobile = String(profile.mobile || "").trim();
  const mobileDigits = mobile.replace(/\D/g, "");
  const bloodGroup = String(profile.blood_group || "");
  const birthDate = String(profile.birth_date || "");
  const nursingCollege = String(profile.nursing_college || "").trim();
  const address = String(profile.address || "").trim();
  if (
    !email ||
    !password ||
    !fullName ||
    !mobile ||
    !birthDate ||
    !nursingCollege ||
    !targetExam
  ) {
    return corsResponse({
      success: false,
      error:
        "Name, email, password, mobile, birth date, nursing college, and target exam are required.",
    });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return corsResponse({
      success: false,
      error: "Enter a valid email address.",
    });
  }
  if (password.length < 8) {
    return corsResponse({
      success: false,
      error: "Password must be at least 8 characters.",
    });
  }
  if (SUPPORTED_EXAM_TYPES.indexOf(targetExam) < 0) {
    return corsResponse({
      success: false,
      error: "Select a valid target exam.",
    });
  }
  if (
    !/^[+\d\s().-]+$/.test(mobile) ||
    mobileDigits.length < 7 ||
    mobileDigits.length > 15
  ) {
    return corsResponse({
      success: false,
      error: "Enter a valid mobile number with 7 to 15 digits.",
    });
  }
  if (
    ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].indexOf(bloodGroup) <
    0
  ) {
    return corsResponse({
      success: false,
      error: "Select a valid blood group.",
    });
  }
  if (!isValidBirthDate(birthDate)) {
    return corsResponse({
      success: false,
      error: "Enter a valid birth date that is not in the future.",
    });
  }
  const users = getSheet("Users");
  if (findUserRow(users, email)) {
    return corsResponse({ success: false, error: "Email already registered." });
  }
  const columns = ensureProfileColumns(users);
  const userId = uuid();
  const hash = sha256(password);
  const row = new Array(users.getLastColumn()).fill("");
  row[0] = userId;
  row[1] = email;
  row[2] = hash;
  row[3] = targetExam;
  row[columns.full_name] = fullName;
  row[columns.mobile] = mobile;
  row[columns.blood_group] = bloodGroup;
  row[columns.address] = address;
  row[columns.nursing_college] = nursingCollege;
  row[columns.birth_date] = birthDate;
  users.appendRow(row);
  return corsResponse({
    success: true,
    user_id: userId,
    target_exam: targetExam,
  });
}

function handleLogin(body) {
  const email = (body.email || "").trim();
  const password = body.password || "";
  if (!email || !password) {
    return corsResponse({
      success: false,
      error: "Email and password required.",
    });
  }
  const users = getSheet("Users");
  const found = findUserRow(users, email);
  if (!found) {
    return corsResponse({ success: false, error: "Invalid credentials." });
  }
  const hash = sha256(password);
  if (hash !== String(found.values[2])) {
    return corsResponse({ success: false, error: "Invalid credentials." });
  }
  return corsResponse({
    success: true,
    user_id: found.values[0],
    email: found.values[1],
    target_exam: found.values[3],
  });
}

function handleGetProfile(body) {
  const userId = String(body.user_id || "");
  const currentPassword = body.current_password || "";
  if (!userId || !currentPassword) {
    return corsResponse({
      success: false,
      error: "User ID and current password are required.",
    });
  }
  const users = getSheet("Users");
  let found = findUserById(users, userId);
  if (!found || sha256(currentPassword) !== String(found.values[2])) {
    return corsResponse({
      success: false,
      error: "Current password is incorrect.",
    });
  }
  const columns = ensureProfileColumns(users);
  found = findUserById(users, userId);
  return corsResponse({
    success: true,
    target_exam: found.values[3],
    profile: getProfileFromRow(found.values, columns),
  });
}

function handleUpdateAccount(body) {
  const userId = String(body.user_id || "");
  const currentPassword = body.current_password || "";
  const targetExam = String(body.target_exam || "");
  const profile = body.profile || {};
  const newPassword = body.new_password || "";
  if (!userId || !currentPassword) {
    return corsResponse({
      success: false,
      error: "User ID and current password are required.",
    });
  }
  if (SUPPORTED_EXAM_TYPES.indexOf(targetExam) < 0) {
    return corsResponse({
      success: false,
      error: "Select a valid target exam.",
    });
  }
  const fullName = String(profile.full_name || "").trim();
  const mobile = String(profile.mobile || "").trim();
  const mobileDigits = mobile.replace(/\D/g, "");
  const bloodGroup = String(profile.blood_group || "");
  const address = String(profile.address || "").trim();
  const nursingCollege = String(profile.nursing_college || "").trim();
  const isRegistered = String(profile.is_registered || "");
  const rnNumber = String(profile.rn_number || "").trim();
  const birthDate = String(profile.birth_date || "");
  if (!fullName)
    return corsResponse({ success: false, error: "Full name is required." });
  if (
    !/^[+\d\s().-]+$/.test(mobile) ||
    mobileDigits.length < 7 ||
    mobileDigits.length > 15
  ) {
    return corsResponse({
      success: false,
      error: "Enter a valid mobile number with 7 to 15 digits.",
    });
  }
  if (
    ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].indexOf(bloodGroup) <
    0
  ) {
    return corsResponse({
      success: false,
      error: "Select a valid blood group.",
    });
  }
  if (["Yes", "No"].indexOf(isRegistered) < 0) {
    return corsResponse({
      success: false,
      error: "Select whether you are registered.",
    });
  }
  if (isRegistered === "Yes" && !rnNumber) {
    return corsResponse({
      success: false,
      error: "RN number is required when registered.",
    });
  }
  if (!isValidBirthDate(birthDate)) {
    return corsResponse({
      success: false,
      error: "Enter a valid birthday that is not in the future.",
    });
  }
  if (newPassword && newPassword.length < 8) {
    return corsResponse({
      success: false,
      error: "New password must be at least 8 characters.",
    });
  }

  const users = getSheet("Users");
  let found = findUserById(users, userId);
  if (!found || sha256(currentPassword) !== String(found.values[2])) {
    return corsResponse({
      success: false,
      error: "Current password is incorrect.",
    });
  }

  const columns = ensureProfileColumns(users);
  found = findUserById(users, userId);
  users.getRange(found.row, 4).setValue(targetExam);
  PROFILE_FIELDS.forEach(function (field) {
    let value = profile[field] == null ? "" : String(profile[field]).trim();
    if (field === "rn_number" && isRegistered !== "Yes") value = "";
    const cell = users.getRange(found.row, columns[field] + 1);
    cell.setNumberFormat("@");
    cell.setValue(value);
  });
  if (newPassword) users.getRange(found.row, 3).setValue(sha256(newPassword));

  const updated = findUserById(users, userId);
  return corsResponse({
    success: true,
    target_exam: targetExam,
    password_changed: !!newPassword,
    profile: getProfileFromRow(updated.values, columns),
  });
}

function handleDeleteAccount(body) {
  const userId = String(body.user_id || "");
  const currentPassword = body.current_password || "";
  if (!userId || !currentPassword) {
    return corsResponse({
      success: false,
      error: "User ID and current password are required.",
    });
  }

  const users = getSheet("Users");
  const user = findUserById(users, userId);
  if (!user || sha256(currentPassword) !== String(user.values[2])) {
    return corsResponse({
      success: false,
      error: "Current password is incorrect.",
    });
  }

  const sessions = getSheet("Sessions");
  const sessionData = sessions.getDataRange().getValues();
  const sessionIds = {};
  const sessionRows = [];
  for (let i = 1; i < sessionData.length; i++) {
    if (String(sessionData[i][1]) === userId) {
      const sessionId = String(sessionData[i][0]);
      sessionIds[sessionId] = true;
      sessionRows.push(i + 1);
    }
  }

  const progress = getSheet("Progress");
  const progressData = progress.getDataRange().getValues();
  const progressRows = [];
  for (let i = 1; i < progressData.length; i++) {
    if (sessionIds[String(progressData[i][1])]) progressRows.push(i + 1);
  }

  progressRows.reverse().forEach(function (row) {
    progress.deleteRow(row);
  });
  sessionRows.reverse().forEach(function (row) {
    sessions.deleteRow(row);
  });
  users.deleteRow(user.row);
  return corsResponse({ success: true });
}

// ---------- Exam retrieval (scrubbed) ----------

function handleGetExam(params) {
  const examType = params.exam_type || "NCLEX-RN";
  const count = parseInt(params.count, 10) || 10;
  const category = params.category || "";
  const questionsSheet = getSheet("Questions");
  const data = questionsSheet.getDataRange().getValues();
  let pool = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const q = readQuestionRow(row);
    if (String(q.exam_type) !== examType) continue;
    if (category && String(q.category) !== category) continue;
    pool.push({
      q_id: q.q_id,
      exam_type: q.exam_type,
      category: q.category,
      question_text: q.question_text,
      options: q.options,
      correct_answer: q.correct_answer,
      rationale: q.rationale,
      is_ngn: q.is_ngn,
      question_type: q.question_type,
      template_id: q.template_id,
      section_name: q.section_name,
      points_value: q.points_value,
    });
  }

  if (examType === "Licence Exam Preparation") {
    const matrixPool = pool.filter(function (q) {
      return (
        String(q.question_type || "").toLowerCase() === "true_false_matrix"
      );
    });
    const bestPool = pool.filter(function (q) {
      return String(q.question_type || "").toLowerCase() === "best_answer";
    });
    const matrixTarget = Math.min(
      50,
      matrixPool.length,
      Math.max(0, Math.round(count * 0.5)),
    );
    const bestTarget = Math.min(
      50,
      bestPool.length,
      Math.max(0, count - matrixTarget),
    );
    const selected = [];
    const shuffledMatrix = matrixPool.slice();
    const shuffledBest = bestPool.slice();
    for (let i = shuffledMatrix.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffledMatrix[i];
      shuffledMatrix[i] = shuffledMatrix[j];
      shuffledMatrix[j] = tmp;
    }
    for (let i = shuffledBest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffledBest[i];
      shuffledBest[i] = shuffledBest[j];
      shuffledBest[j] = tmp;
    }
    selected.push.apply(selected, shuffledMatrix.slice(0, matrixTarget));
    selected.push.apply(selected, shuffledBest.slice(0, bestTarget));
    return corsResponse({
      success: true,
      questions: selected,
      total: selected.length,
      template: getExamTemplate(examType),
    });
  }

  if (examType === "IBN SINA Trust Nursing Exam") {
    const scenarioPool = pool.filter(function (q) {
      const t = String(q.question_type || "").toLowerCase();
      return t === "scenario_best_answer" || t === "scenario_multi_select";
    });
    const selected = [];
    for (let i = scenarioPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = scenarioPool[i];
      scenarioPool[i] = scenarioPool[j];
      scenarioPool[j] = tmp;
    }
    return corsResponse({
      success: true,
      questions: scenarioPool.slice(0, Math.min(count, scenarioPool.length)),
      total: Math.min(count, scenarioPool.length),
      template: getExamTemplate(examType),
    });
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const selected = pool.slice(0, Math.min(count, pool.length));
  return corsResponse({
    success: true,
    questions: selected,
    total: selected.length,
    template: getExamTemplate(examType),
  });
}

// ---------- Categories ----------

function handleGetCategories(params) {
  const examType = params.exam_type || "";
  const data = getSheet("Questions").getDataRange().getValues();
  const set = {};
  for (let i = 1; i < data.length; i++) {
    if (examType && String(data[i][1]) !== examType) continue;
    const c = String(data[i][2] || "").trim();
    if (c) set[c] = true;
  }
  const categories = Object.keys(set).sort();
  return corsResponse({ success: true, categories: categories });
}

// ---------- Grading single question ----------

function handleGradeQuestion(body) {
  const qId = body.q_id;
  const userAnswer = body.user_answer;
  const questionsSheet = getSheet("Questions");
  const data = questionsSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(qId)) {
      const question = readQuestionRow(data[i]);
      const correct = question.correct_answer;
      const rationale = question.rationale || "";
      const score = scoreQuestion(question, userAnswer);
      const isCorrect = score > 0;
      return corsResponse({
        success: true,
        correct_answer: correct,
        rationale: rationale,
        is_correct: isCorrect,
        points_awarded: score,
        points_possible: getQuestionPoints(question),
      });
    }
  }
  return corsResponse({ success: false, error: "Question not found." });
}

// ---------- Submit exam ----------

function handleSubmitExam(body) {
  const userId = body.user_id;
  const mode = body.mode || "mock";
  const examType = body.exam_type || "";
  const answers = body.answers || [];
  const questionsSheet = getSheet("Questions");
  const qData = questionsSheet.getDataRange().getValues();
  const qMap = {};
  for (let i = 1; i < qData.length; i++) {
    const q = readQuestionRow(qData[i]);
    qMap[q.q_id] = q;
  }

  let rawScore = 0;
  let totalPossible = 0;
  const negativeMarking = examType === "IBN SINA Trust Nursing Exam" ? 0.25 : 0;
  const progressRows = [];
  answers.forEach(function (a) {
    const q = qMap[a.q_id];
    if (!q) return;
    const baseScore = scoreQuestion(q, a.user_answer);
    const isCorrect = baseScore > 0;
    const questionScore =
      negativeMarking > 0 && q.question_type === "scenario_best_answer" && !isCorrect
        ? -negativeMarking
        : baseScore;
    rawScore += questionScore;
    totalPossible += getQuestionPoints(q);
    progressRows.push([uuid(), null, a.q_id, isCorrect]);
  });

  const sessionId = uuid();
  const score = totalPossible
    ? Math.round((rawScore / totalPossible) * 100)
    : 0;
  const sessions = getSheet("Sessions");
  sessions.appendRow([
    sessionId,
    userId,
    mode,
    score,
    new Date().toISOString(),
    examType,
  ]);

  const progress = getSheet("Progress");
  progressRows.forEach(function (r) {
    r[1] = sessionId;
    progress.appendRow(r);
  });

  return corsResponse({
    success: true,
    session_id: sessionId,
    score: score,
    correct: rawScore,
    total: totalPossible,
    raw_score: rawScore,
    total_possible: totalPossible,
  });
}

// ---------- Dashboard aggregation ----------

function handleGetDashboard(params) {
  const userId = params.user_id;
  const sessionsSheet = getSheet("Sessions");
  const progressSheet = getSheet("Progress");
  const questionsSheet = getSheet("Questions");

  const qMap = {};
  const qData = questionsSheet.getDataRange().getValues();
  for (let i = 1; i < qData.length; i++) {
    qMap[qData[i][0]] = {
      category: String(qData[i][2] || "Unknown"),
      exam_type: String(qData[i][1] || ""),
    };
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
      exam_type: sData[i][5] || "",
    });
    sessionIds[sid] = true;
  }

  const pData = progressSheet.getDataRange().getValues();
  const catStats = {};
  const sessionStats = {};
  let totalQ = 0,
    totalCorrect = 0;
  for (let i = 1; i < pData.length; i++) {
    const sid = pData[i][1];
    if (!sessionIds[sid]) continue;
    const qid = pData[i][2];
    const isCorrect =
      pData[i][3] === true || String(pData[i][3]).toLowerCase() === "true";
    const q = qMap[qid];
    const cat = q ? q.category : "Unknown";
    if (!catStats[cat]) catStats[cat] = { total: 0, correct: 0 };
    catStats[cat].total++;
    if (!sessionStats[sid]) sessionStats[sid] = { total: 0, correct: 0 };
    sessionStats[sid].total++;
    if (isCorrect) catStats[cat].correct++;
    if (isCorrect) sessionStats[sid].correct++;
    totalQ++;
    if (isCorrect) totalCorrect++;
  }

  sessions.forEach(function (session) {
    const stats = sessionStats[session.session_id];
    session.correct = stats ? stats.correct : 0;
    session.total = stats ? stats.total : 0;
    if (stats && stats.total) {
      session.score = Math.round((stats.correct / stats.total) * 100);
    }
  });

  const categoryStats = Object.keys(catStats)
    .map(function (c) {
      return {
        category: c,
        total: catStats[c].total,
        correct: catStats[c].correct,
        accuracy: catStats[c].total
          ? Math.round((catStats[c].correct / catStats[c].total) * 100)
          : 0,
      };
    })
    .sort(function (a, b) {
      return a.accuracy - b.accuracy;
    });

  const scores = sessions.map(function (s) {
    return Number(s.score) || 0;
  });
  const overall = {
    sessions: sessions.length,
    avgScore: scores.length
      ? Math.round(
          scores.reduce(function (a, b) {
            return a + b;
          }, 0) / scores.length,
        )
      : 0,
    bestScore: scores.length ? Math.max.apply(null, scores) : 0,
    totalQuestions: totalQ,
    overallAccuracy: totalQ ? Math.round((totalCorrect / totalQ) * 100) : 0,
  };

  sessions.sort(function (a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  return corsResponse({
    success: true,
    sessions: sessions,
    categoryStats: categoryStats,
    overall: overall,
  });
}

// ---------- Setup helper (run once manually) ----------

function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabs = {
    Users: ["user_id", "email", "password_hash", "target_exam"],
    Questions: [
      "q_id",
      "exam_type",
      "category",
      "question_text",
      "options_json",
      "correct_answer",
      "rationale",
      "is_ngn",
      "question_type",
      "template_id",
      "section_name",
      "points_value",
    ],
    Sessions: [
      "session_id",
      "user_id",
      "mode",
      "score",
      "timestamp",
      "exam_type",
    ],
    Progress: ["log_id", "session_id", "q_id", "is_correct"],
  };
  Object.keys(tabs).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.clear();
    sh.appendRow(tabs[name]);
    sh.getRange(1, 1, 1, tabs[name].length).setFontWeight("bold");
  });
  seedSampleQuestions();
}

function seedSampleQuestions() {
  const q = getSheet("Questions");

  const licenseMatrix = [
    {
      prompt:
        "A patient with pneumonia should increase oral fluids during fever.",
      correct: ["True"],
      rationale:
        "Hydration helps maintain mucous membrane moisture and supports recovery.",
    },
    {
      prompt:
        "A patient with chest pain and diaphoresis should be left in bed and observed without intervention while vital signs are taken.",
      correct: ["False"],
      rationale:
        "Chest pain and diaphoresis require immediate assessment and urgent management.",
    },
    {
      prompt:
        "A patient with a blood pressure of 80/50 mmHg and cool extremities is in shock.",
      correct: ["True"],
      rationale:
        "Hypotension with cool extremities suggests circulatory shock and poor perfusion.",
    },
    {
      prompt:
        "Routine hand hygiene before and after patient contact is optional in a stable ward.",
      correct: ["False"],
      rationale:
        "Hand hygiene is required for every patient interaction to prevent infection spread.",
    },
    {
      prompt:
        "A patient receiving digoxin should be monitored for visual halos and nausea.",
      correct: ["True"],
      rationale:
        "Visual halos, nausea, and bradycardia are classic digoxin toxicity clues.",
    },
    {
      prompt:
        "A patient with severe dyspnea should be positioned supine to rest.",
      correct: ["False"],
      rationale:
        "High Fowler position improves breathing and reduces venous return.",
    },
    {
      prompt:
        "A postoperative patient with a saturated dressing should have the dressing changed immediately without assessment.",
      correct: ["False"],
      rationale:
        "Post-op bleeding requires assessment of vital signs, wound, and bleeding source first.",
    },
    {
      prompt:
        "A patient with wheezing and stridor needs urgent airway assessment.",
      correct: ["True"],
      rationale:
        "Airway obstruction and respiratory distress require immediate evaluation.",
    },
    {
      prompt: "A patient on warfarin should report black stools promptly.",
      correct: ["True"],
      rationale:
        "Black stools may indicate gastrointestinal bleeding while on anticoagulants.",
    },
    {
      prompt:
        "A patient who is drowsy after a sedative dose can be left alone until the next shift.",
      correct: ["False"],
      rationale:
        "Sedation requires frequent monitoring and reassessment of airway and level of consciousness.",
    },
    {
      prompt:
        "An NG tube insertion should be verified by checking placement before feeding.",
      correct: ["True"],
      rationale:
        "Correct NG tube placement reduces aspiration and injury risk.",
    },
    {
      prompt:
        "A patient with an oxygen saturation of 88% should receive immediate oxygen assessment and intervention.",
      correct: ["True"],
      rationale:
        "Low oxygen saturation suggests hypoxemia needing prompt evaluation.",
    },
    {
      prompt:
        "A patient with a newly inserted urinary catheter should have the catheter changed daily.",
      correct: ["False"],
      rationale:
        "Routine catheter changes are not recommended unless clinically indicated.",
    },
    {
      prompt:
        "A patient with diabetes who misses meals can develop hypoglycemia.",
      correct: ["True"],
      rationale:
        "Skipping food can cause a drop in blood glucose, especially with insulin or sulfonylureas.",
    },
    {
      prompt:
        "A patient with severe pain should be given a higher dose only after the physician confirms it.",
      correct: ["False"],
      rationale:
        "Pain management requires appropriate assessment and provider orders, but not necessarily physician confirmation for an existing order.",
    },
    {
      prompt:
        "A patient with a fever and rigors should receive additional fluids without assessment.",
      correct: ["False"],
      rationale:
        "Fever evaluation includes assessment of cause, hydration needs, and vital signs.",
    },
    {
      prompt:
        "A patient with suspected tuberculosis should be isolated under airborne precautions.",
      correct: ["True"],
      rationale:
        "TB is transmitted through airborne particles and requires airborne isolation.",
    },
    {
      prompt:
        "A patient with a stable blood pressure and mild cough can avoid infection prevention steps.",
      correct: ["False"],
      rationale: "Standard precautions remain necessary for all patients.",
    },
    {
      prompt:
        "A patient with severe headache and vomiting may have increased intracranial pressure.",
      correct: ["True"],
      rationale:
        "Headache and vomiting can be warning signs of raised intracranial pressure.",
    },
    {
      prompt:
        "A patient with peripheral edema and shortness of breath should be placed in Trendelenburg position.",
      correct: ["False"],
      rationale: "Trendelenburg worsens breathing and is not used for dyspnea.",
    },
    {
      prompt:
        "A patient with chronic kidney disease should avoid potassium-rich foods unless prescribed.",
      correct: ["True"],
      rationale: "Renal impairment raises the risk of hyperkalemia.",
    },
    {
      prompt:
        "A patient with low urine output should be assessed for dehydration and renal compromise.",
      correct: ["True"],
      rationale:
        "Low urine output can indicate inadequate perfusion or kidney dysfunction.",
    },
    {
      prompt:
        "A patient with dry mucous membranes needs oral fluids even without fever.",
      correct: ["True"],
      rationale: "Dry mucous membranes indicate possible dehydration.",
    },
    {
      prompt:
        "A patient with a simple laceration should have all care delayed until the next clinic day.",
      correct: ["False"],
      rationale: "Acute wounds require timely assessment and wound care.",
    },
    {
      prompt:
        "A patient with suspected myocardial infarction should receive emergency assessment without delay.",
      correct: ["True"],
      rationale:
        "Time-sensitive cardiac events require rapid evaluation and management.",
    },
    {
      prompt:
        "A patient with a known allergy should be asked about triggers before administering medication.",
      correct: ["True"],
      rationale:
        "Allergy checking is essential before medication administration.",
    },
    {
      prompt:
        "A patient receiving insulin needs regular blood glucose monitoring.",
      correct: ["True"],
      rationale:
        "Insulin therapy requires monitoring to prevent hypo- and hyperglycemia.",
    },
    {
      prompt:
        "A patient with a high fever should be covered with a blanket to prevent chills.",
      correct: ["False"],
      rationale:
        "Cooling measures and fluid assessment are preferred unless shivering indicates hypothermia.",
    },
    {
      prompt:
        "A patient with suspected sepsis should have blood cultures obtained before antibiotics when possible.",
      correct: ["True"],
      rationale:
        "Blood cultures help identify the source and guide antimicrobials.",
    },
    {
      prompt:
        "A patient with a blood transfusion reaction should continue the transfusion until the physician arrives.",
      correct: ["False"],
      rationale:
        "Transfusion reactions require immediate stopping of the transfusion and urgent assessment.",
    },
    {
      prompt:
        "A patient with appendicitis should be encouraged to eat freely before surgery.",
      correct: ["False"],
      rationale:
        "NPO status is often required before surgery to reduce aspiration risk.",
    },
    {
      prompt:
        "A patient with constipation should be assessed for bowel obstruction before giving laxatives.",
      correct: ["True"],
      rationale:
        "Constipation can have serious causes including obstruction, which requires careful assessment.",
    },
    {
      prompt:
        "A patient with a bed sore should have the area massaged to encourage circulation.",
      correct: ["False"],
      rationale: "Massage over bony prominences can worsen tissue injury.",
    },
    {
      prompt:
        "A patient with abdominal distension and absent bowel sounds should be assessed urgently.",
      correct: ["True"],
      rationale:
        "Absent bowel sounds may indicate obstruction or ileus requiring evaluation.",
    },
    {
      prompt:
        "A patient with a spinal injury should be moved quickly to prevent long-term complications.",
      correct: ["False"],
      rationale:
        "Spinal precautions prioritize immobilization and careful movement to avoid worsening injury.",
    },
    {
      prompt:
        "A patient with acute confusion should be assessed for reversible causes such as infection or medication effects.",
      correct: ["True"],
      rationale: "Delirium often has an underlying treatable cause.",
    },
    {
      prompt:
        "A patient requiring a sterile dressing change should use sterile technique.",
      correct: ["True"],
      rationale: "Sterile technique reduces infection risk in wound care.",
    },
    {
      prompt:
        "A patient with a small, uncomplicated wound should not need documentation.",
      correct: ["False"],
      rationale:
        "All patient care, including wound assessment, should be documented.",
    },
    {
      prompt:
        "A patient with severe dehydration should receive fluids based on assessment and physician orders.",
      correct: ["True"],
      rationale:
        "Fluid replacement depends on the degree of dehydration and any underlying conditions.",
    },
    {
      prompt:
        "An elderly patient taking opioids should be monitored for respiratory depression.",
      correct: ["True"],
      rationale:
        "Opioids depress respiratory drive, especially in older adults.",
    },
    {
      prompt:
        "A patient with a normal temperature but persistent nausea should be ignored until symptoms worsen.",
      correct: ["False"],
      rationale: "Nausea can indicate many conditions and should be assessed.",
    },
    {
      prompt:
        "A patient with poor oral intake and weight loss should receive nutritional assessment.",
      correct: ["True"],
      rationale:
        "Malnutrition risk increases when intake is poor and weight drops.",
    },
    {
      prompt:
        "A patient with a urinary tract infection should avoid hydration to reduce urgency.",
      correct: ["False"],
      rationale:
        "Hydration supports urinary flow and may help prevent complications.",
    },
    {
      prompt:
        "A patient with chest pain and diaphoresis should be placed on an ECG monitor urgently.",
      correct: ["True"],
      rationale:
        "This pattern may indicate acute coronary syndrome and requires monitoring.",
    },
    {
      prompt:
        "A patient with suspected pregnancy should receive abdominal x-rays without discussion.",
      correct: ["False"],
      rationale:
        "Radiation safety and pregnancy assessment are essential before imaging.",
    },
    {
      prompt:
        "A patient with a history of falls should have the bed in the lowest position and call bell within reach.",
      correct: ["True"],
      rationale:
        "Fall prevention strategies include lowering the bed and ensuring access to assistance.",
    },
    {
      prompt:
        "A patient with stable vitals and a scheduled dressing change should be left unattended while staff rest.",
      correct: ["False"],
      rationale:
        "Patients still require monitoring and care regardless of stability.",
    },
    {
      prompt:
        "A patient with fever and productive cough should be assessed for pneumonia.",
      correct: ["True"],
      rationale:
        "Productive cough with fever is a common pneumonia presentation.",
    },
    {
      prompt:
        "A patient with severe back pain is always an emergency and should not be assessed further.",
      correct: ["False"],
      rationale:
        "Back pain requires evaluation but not every case is emergent.",
    },
    {
      prompt:
        "A patient with known hypertension should be taught to report persistent headaches and visual changes.",
      correct: ["True"],
      rationale:
        "These symptoms may indicate uncontrolled hypertension or complications.",
    },
    {
      prompt:
        "A patient with postpartum hemorrhage should receive urgent assessment and intervention.",
      correct: ["True"],
      rationale:
        "Postpartum hemorrhage is a maternal emergency requiring immediate action.",
    },
  ];

  const licenseBest = [
    {
      question:
        "Which action is the priority when a patient reports sudden severe shortness of breath?",
      options: [
        "Reassure the patient and continue charting",
        "Raise the head of the bed and assess airway and breathing",
        "Offer oral fluids",
        "Apply a cold compress",
      ],
      correct: "Raise the head of the bed and assess airway and breathing",
      rationale:
        "Airway and breathing assessment are the immediate priority in acute respiratory distress.",
    },
    {
      question:
        "A patient on warfarin should be counseled to report which sign immediately?",
      options: ["Mild fatigue", "Black stools", "Dry skin", "Mild cough"],
      correct: "Black stools",
      rationale:
        "Black stools may indicate internal bleeding and anticoagulant complications.",
    },
    {
      question:
        "Which is the most appropriate first step for a patient with chest pain and diaphoresis?",
      options: [
        "Offer a snack",
        "Place the patient on cardiac monitoring and assess symptoms urgently",
        "Reassure and discharge home",
        "Teach breathing exercises only",
      ],
      correct:
        "Place the patient on cardiac monitoring and assess symptoms urgently",
      rationale:
        "Acute chest pain with diaphoresis requires urgent cardiac assessment and monitoring.",
    },
    {
      question:
        "A patient with suspected sepsis is most likely to show which early sign?",
      options: [
        "Cool calm skin and normal temperature",
        "Hypotension and tachycardia",
        "Slow pulse and elevated blood pressure",
        "Decreased appetite only",
      ],
      correct: "Hypotension and tachycardia",
      rationale:
        "Sepsis commonly causes tachycardia and hypotension as perfusion falls.",
    },
    {
      question:
        "Which intervention is appropriate for a patient with dysphagia?",
      options: [
        "Offer large hard chunks of food",
        "Provide thickened fluids and safe textures",
        "Encourage rapid drinking",
        "Give normal fluids with no observation",
      ],
      correct: "Provide thickened fluids and safe textures",
      rationale:
        "Dysphagia management reduces aspiration risk and protects the airway.",
    },
    {
      question:
        "A postoperative patient develops a sudden drop in oxygen saturation. What is the nurse’s priority?",
      options: [
        "Document and wait for the next round",
        "Assess airway, breathing, and circulation immediately",
        "Tell the patient to rest",
        "Change the room temperature",
      ],
      correct: "Assess airway, breathing, and circulation immediately",
      rationale: "Hypoxemia requires rapid assessment and intervention.",
    },
    {
      question: "Which action best prevents catheter-associated UTI?",
      options: [
        "Daily irrigation",
        "Maintaining a closed drainage system",
        "Frequent catheter changes",
        "Using a larger catheter",
      ],
      correct: "Maintaining a closed drainage system",
      rationale: "Closed drainage reduces entry points for bacteria.",
    },
    {
      question:
        "The best immediate response to a patient experiencing a tonic-clonic seizure is to:",
      options: [
        "Restrain the patient forcefully",
        "Protect the head and ensure airway safety",
        "Give oral fluids",
        "Leave the patient alone",
      ],
      correct: "Protect the head and ensure airway safety",
      rationale: "Safety and airway protection are priorities during seizures.",
    },
    {
      question:
        "A patient with suspected aspiration should be placed in which position?",
      options: [
        "Supine with legs elevated",
        "High Fowler position",
        "Prone with head down",
        "Trendelenburg",
      ],
      correct: "High Fowler position",
      rationale:
        "High Fowler supports airway protection and reduces aspiration risk.",
    },
    {
      question:
        "What should the nurse do first when a patient becomes unresponsive?",
      options: [
        "Start a full shower",
        "Assess responsiveness and call for emergency help",
        "Document the event later",
        "Turn off the monitor",
      ],
      correct: "Assess responsiveness and call for emergency help",
      rationale:
        "Immediate assessment and emergency response are essential in unresponsive patients.",
    },
    {
      question:
        "A patient experiencing acute pain after surgery should be assessed for:",
      options: [
        "Only emotional status",
        "Pain severity, location, and response to treatment",
        "No further assessment unless blood pressure changes",
        "Only the day of discharge",
      ],
      correct: "Pain severity, location, and response to treatment",
      rationale:
        "Pain assessment includes severity, location, and response to treatment.",
    },
    {
      question:
        "Which finding requires immediate follow-up in a patient with heart failure?",
      options: [
        "Mild fatigue",
        "Sudden shortness of breath and crackles",
        "Plan to rest at home",
        "Normal appetite",
      ],
      correct: "Sudden shortness of breath and crackles",
      rationale:
        "Acute dyspnea and crackles may indicate worsening heart failure or pulmonary edema.",
    },
    {
      question:
        "The nurse should teach a patient receiving SSRIs to report which symptom first?",
      options: [
        "Mild dizziness",
        "Agitation, fever, and tremors",
        "Mild sleepiness",
        "Dry mouth",
      ],
      correct: "Agitation, fever, and tremors",
      rationale:
        "These signs may represent serotonin syndrome and require immediate attention.",
    },
    {
      question: "Which method is best for preventing pressure ulcers?",
      options: [
        "Massage bony prominences",
        "Regular repositioning and skin assessment",
        "Keep the patient on a hard mattress",
        "Limit fluids",
      ],
      correct: "Regular repositioning and skin assessment",
      rationale:
        "Pressure reduction and skin monitoring prevent ulcer formation.",
    },
    {
      question: "Which patient should the nurse see first?",
      options: [
        "Stable patient waiting for discharge",
        "Patient with chest pain and diaphoresis",
        "Patient with routine morning bath needs",
        "Patient needing a scheduled blood draw",
      ],
      correct: "Patient with chest pain and diaphoresis",
      rationale:
        "Chest pain with diaphoresis may indicate acute cardiac ischemia, the highest priority.",
    },
    {
      question: "The most appropriate response to a grieving patient is:",
      options: [
        '"You should move on."',
        '"I am here with you and listening."',
        '"At least you can be strong."',
        '"Time heals all."',
      ],
      correct: '"I am here with you and listening."',
      rationale:
        "Therapeutic presence and empathy are most helpful during grief.",
    },
    {
      question:
        "What should the nurse prioritize when using a fire extinguisher on a hospital unit?",
      options: [
        "Use the extinguisher before alerting anyone",
        "Follow the PASS method and ensure the area is safe",
        "Ignore the alarm if the fire is small",
        "Leave the patient and run",
      ],
      correct: "Follow the PASS method and ensure the area is safe",
      rationale:
        "Safety and correct extinguisher use are essential during a fire emergency.",
    },
    {
      question:
        "A patient with suspected stroke has facial drooping and arm weakness. The priority is:",
      options: [
        "Offer a meal",
        "Call for emergency stroke response and perform rapid assessment",
        "Wait 30 minutes and observe",
        "Start gentle stretching",
      ],
      correct:
        "Call for emergency stroke response and perform rapid assessment",
      rationale: "Stroke care must be time-sensitive and rapid.",
    },
    {
      question:
        "Which is the highest priority for a patient with suspected anaphylaxis?",
      options: [
        "Offer food",
        "Maintain airway and administer epinephrine per protocol",
        "Call the patient’s family",
        "Let the patient rest",
      ],
      correct: "Maintain airway and administer epinephrine per protocol",
      rationale: "Airway and immediate allergy management are lifesaving.",
    },
    {
      question:
        "The nurse understands that a blood glucose of 48 mg/dL requires:",
      options: [
        "No action because it is normal",
        "Immediate management of hypoglycemia",
        "High-fat meal only",
        "Increased oral fluids",
      ],
      correct: "Immediate management of hypoglycemia",
      rationale:
        "Hypoglycemia below 70 mg/dL requires prompt treatment, especially when low enough to be severe.",
    },
    {
      question:
        "Which action should the nurse take before giving oral medications?",
      options: [
        "Check the medication label and patient identification",
        "Administer without checking because the order is already placed",
        "Only check the bedside table",
        "Call family for consent",
      ],
      correct: "Check the medication label and patient identification",
      rationale:
        "Safe medication administration requires right patient, drug, dose, route, and time.",
    },
    {
      question:
        "A patient with suspected pulmonary embolism is likely to have which sign?",
      options: [
        "Sudden shortness of breath and pleuritic chest pain",
        "Dry skin only",
        "Low blood sugar",
        "High urine output",
      ],
      correct: "Sudden shortness of breath and pleuritic chest pain",
      rationale: "PE commonly presents with dyspnea and pleuritic chest pain.",
    },
    {
      question: "Which is the most effective way to reduce MRSA transmission?",
      options: [
        "Prophylactic antibiotics for all",
        "Hand hygiene and contact precautions when indicated",
        "Daily room deodorizer",
        "Open windows only",
      ],
      correct: "Hand hygiene and contact precautions when indicated",
      rationale:
        "Hand hygiene and targeted precautions help prevent MRSA transmission.",
    },
    {
      question:
        "A patient with diarrhea should be assessed for which complication first?",
      options: [
        "Dehydration",
        "Hair growth",
        "Improved appetite",
        "Weight gain",
      ],
      correct: "Dehydration",
      rationale:
        "Diarrhea can rapidly lead to fluid loss and electrolyte imbalance.",
    },
    {
      question: "Which patient is at highest fall risk?",
      options: [
        "Young adult with stable vitals",
        "Elderly patient on opioids and sedatives",
        "Healthy student on a regular walk",
        "Patient walking with a support person",
      ],
      correct: "Elderly patient on opioids and sedatives",
      rationale: "Age and sedating medication increase fall risk.",
    },
    {
      question:
        "Which statement indicates correct teaching for a patient receiving insulin?",
      options: [
        '"I can skip meals and still be safe."',
        '"I should recognize symptoms of hypoglycemia and carry a snack."',
        '"I only need to monitor at the end of the month."',
        '"I should inject in the same site every time."',
      ],
      correct:
        '"I should recognize symptoms of hypoglycemia and carry a snack."',
      rationale:
        "Patients on insulin need hypoglycemia prevention and recognition education.",
    },
    {
      question: "Which action best supports a patient with delirium?",
      options: [
        "Restrain without assessment",
        "Assess for reversible causes and provide a calm environment",
        "Encourage sleep deprivation",
        "Speak loudly and quickly",
      ],
      correct: "Assess for reversible causes and provide a calm environment",
      rationale:
        "Delirium care should reduce stimulation and identify triggers.",
    },
    {
      question:
        "A patient with suspected appendicitis should be monitored for which symptom?",
      options: [
        "Severe right lower quadrant pain",
        "Back pain only",
        "Weight gain",
        "Increased appetite",
      ],
      correct: "Severe right lower quadrant pain",
      rationale: "Appendicitis often presents with RLQ pain and tenderness.",
    },
    {
      question:
        "Which symptom is most concerning in a patient with hyperkalemia?",
      options: [
        "Mild thirst",
        "Muscle weakness and ECG changes",
        "Increased appetite",
        "Dry eyes",
      ],
      correct: "Muscle weakness and ECG changes",
      rationale: "Hyperkalemia can produce arrhythmias and weakness.",
    },
    {
      question: "The nurse should prioritize which patient?",
      options: [
        "Patient with stable blood pressure and no complaints",
        "Patient with severe bleeding and hypotension",
        "Patient with scheduled wound care",
        "Patient awaiting discharge medications",
      ],
      correct: "Patient with severe bleeding and hypotension",
      rationale:
        "Hemorrhage with hypotension is an immediate life-threatening situation.",
    },
    {
      question:
        "Which is the correct response to a patient who is refusing treatment?",
      options: [
        "Force treatment immediately",
        "Assess the reason, educate, and respect patient autonomy while maintaining safety",
        "Ignore the refusal",
        "Document and leave the room",
      ],
      correct:
        "Assess the reason, educate, and respect patient autonomy while maintaining safety",
      rationale:
        "Informed refusal must be respected when legally and clinically appropriate, with safety considered.",
    },
    {
      question:
        "What should the nurse do for a patient with a high fever and signs of dehydration?",
      options: [
        "Encourage fluids and monitor vitals",
        "Restrict all oral intake",
        "Ignore it until the next day",
        "Offer only caffeine",
      ],
      correct: "Encourage fluids and monitor vitals",
      rationale:
        "Hydration and monitoring are essential in febrile dehydration.",
    },
    {
      question:
        "A patient with suspected asthma exacerbation should be assessed for:",
      options: [
        "Wheezing and difficulty breathing",
        "Low urinary output only",
        "Severe constipation",
        "Warm dry skin",
      ],
      correct: "Wheezing and difficulty breathing",
      rationale:
        "Asthma exacerbation commonly causes wheeze and breathing difficulty.",
    },
    {
      question:
        "Which fluid is most appropriate for a patient with severe dehydration?",
      options: [
        "Plain water only without assessment",
        "IV or oral fluids based on assessment and provider orders",
        "Hot soup only",
        "No fluids",
      ],
      correct: "IV or oral fluids based on assessment and provider orders",
      rationale: "Fluid choice depends on severity, route, and patient needs.",
    },
    {
      question: "Which finding in a patient with hypokalemia is expected?",
      options: [
        "Muscle weakness",
        "Rapid weight gain",
        "Hypertension only",
        "Reduced thirst",
      ],
      correct: "Muscle weakness",
      rationale:
        "Hypokalemia commonly causes weakness, cramps, and cardiac issues.",
    },
    {
      question: "The best action for a patient with persistent vomiting is to:",
      options: [
        "Give large amounts of food",
        "Assess dehydration and provide antiemetic plan as ordered",
        "Ignore until the next staff shift",
        "Offer a full meal",
      ],
      correct: "Assess dehydration and provide antiemetic plan as ordered",
      rationale:
        "Vomiting can cause fluid loss and should be evaluated and managed.",
    },
    {
      question:
        "A patient with suspected urinary retention should be assessed for:",
      options: [
        "Bladder distension and discomfort",
        "Shortness of breath only",
        "Low blood sugar",
        "Excessive hunger",
      ],
      correct: "Bladder distension and discomfort",
      rationale:
        "Retention often presents with bladder fullness and urinary discomfort.",
    },
    {
      question:
        "Which is an appropriate nursing action when a patient complains of pain?",
      options: [
        "Dismiss the complaint",
        "Assess the pain and administer ordered interventions as appropriate",
        "Only chart without assessment",
        "Wait until the patient asks again",
      ],
      correct:
        "Assess the pain and administer ordered interventions as appropriate",
      rationale: "Pain requires assessment and appropriate management.",
    },
    {
      question: "A patient with a suspected fracture should be assessed for:",
      options: [
        "Pain, swelling, and deformity",
        "Fever alone",
        "Cough only",
        "Improved mobility",
      ],
      correct: "Pain, swelling, and deformity",
      rationale:
        "Fractures commonly present with pain, swelling, and deformity.",
    },
    {
      question: "Which patient needs immediate attention?",
      options: [
        "Stable patient awaiting discharge",
        "Patient with severe abdominal pain and pallor",
        "Patient needing routine vital signs",
        "Patient wanting education materials",
      ],
      correct: "Patient with severe abdominal pain and pallor",
      rationale:
        "Severe abdominal pain with pallor may indicate hemorrhage or acute abdomen requiring urgent evaluation.",
    },
    {
      question:
        "Which is a priority in a patient with an indwelling urinary catheter?",
      options: [
        "Daily assessment of patency and infection signs",
        "Weekly removal without evaluation",
        "No monitoring",
        "Only checking if the patient complains",
      ],
      correct: "Daily assessment of patency and infection signs",
      rationale:
        "Catheters require monitoring to reduce infection and obstruction risk.",
    },
    {
      question: "The best action for a patient with a fever and chills is to:",
      options: [
        "Ignore it until morning",
        "Assess for infection, monitor vitals, and initiate provider-directed care",
        "Increase caffeine",
        "Limit fluids",
      ],
      correct:
        "Assess for infection, monitor vitals, and initiate provider-directed care",
      rationale: "Systemic symptoms require evaluation and appropriate care.",
    },
  ];

  const ibnSina = [
    {
      question:
        "A 58-year-old diabetic patient with foul-smelling wound drainage and poor glycemic control develops fever. What is the most appropriate first action?",
      options: [
        "Discharge with oral antibiotics",
        "Assess the wound, obtain ordered cultures, and initiate infection-control measures",
        "Ignore the drainage because it is minor",
        "Delay care until the next clinic day",
      ],
      correct:
        "Assess the wound, obtain ordered cultures, and initiate infection-control measures",
      rationale:
        "A wound infection requires evaluation, possible culture, and infection control.",
    },
    {
      question:
        "A patient with facial drooping and arm weakness arrives in the clinic. What should be done first?",
      options: [
        "Offer a meal",
        "Activate emergency stroke response and perform rapid assessment",
        "Begin gentle exercise",
        "Tell the patient to rest and wait",
      ],
      correct:
        "Activate emergency stroke response and perform rapid assessment",
      rationale:
        "Stroke symptoms require immediate action and rapid assessment to preserve brain tissue.",
    },
    {
      question:
        "A postpartum woman with heavy bleeding and dizziness is most likely experiencing:",
      options: [
        "Normal adaptation",
        "Postpartum hemorrhage requiring urgent assessment",
        "Night recovery",
        "Transient hunger",
      ],
      correct: "Postpartum hemorrhage requiring urgent assessment",
      rationale: "Heavy bleeding with dizziness is a postpartum emergency.",
    },
    {
      question:
        "A patient with a history of asthma develops wheezing and respiratory distress after exposure to dust. What is the priority?",
      options: [
        "Teach breathing exercises only",
        "Assess airway and provide ordered bronchodilator therapy",
        "Discharge without treatment",
        "Offer fluids and observe",
      ],
      correct: "Assess airway and provide ordered bronchodilator therapy",
      rationale:
        "Acute bronchospasm requires prompt airway and breathing support.",
    },
    {
      question:
        "A patient with suspected pulmonary embolism has dyspnea and pleuritic chest pain. What should the nurse do next?",
      options: [
        "Administer a sedative",
        "Initiate rapid assessment, elevate head of bed, and notify provider urgently",
        "Delay care until morning",
        "Offer oral hydration only",
      ],
      correct:
        "Initiate rapid assessment, elevate head of bed, and notify provider urgently",
      rationale:
        "PE can be life-threatening and requires urgent assessment and intervention.",
    },
    {
      question:
        "A patient with severe abdominal pain, fever, and guarding is most likely experiencing:",
      options: [
        "Simple constipation",
        "Acute abdomen that requires urgent assessment",
        "Tiredness after work",
        "Transient indigestion",
      ],
      correct: "Acute abdomen that requires urgent assessment",
      rationale:
        "Abdominal guarding and fever may indicate a surgical emergency.",
    },
    {
      question:
        "A patient with burns on the hands is brought in. What should the nurse prioritize?",
      options: [
        "Warm the patient and delay care",
        "Assess airway, pain, extent of burn, and fluids as indicated",
        "Leave the dressing off",
        "Offer food",
      ],
      correct: "Assess airway, pain, extent of burn, and fluids as indicated",
      rationale:
        "Burn assessment includes airway, circulation, and fluid needs based on severity.",
    },
    {
      question:
        "A patient with chronic kidney disease reports palpitations and weakness. Which assessment is most important?",
      options: [
        "Check potassium level and ECG changes",
        "Assess shoe size",
        "Ignore symptoms if vitals are normal",
        "Measure room temperature",
      ],
      correct: "Check potassium level and ECG changes",
      rationale: "Hyperkalemia can cause weakness and arrhythmias.",
    },
    {
      question:
        "A patient on insulin becomes sweaty, shaky, and confused. What is the best next step?",
      options: [
        "Give a rapid-acting carbohydrate and monitor glucose",
        "Offer a large meal",
        "Leave alone because the patient is tired",
        "Check blood pressure only",
      ],
      correct: "Give a rapid-acting carbohydrate and monitor glucose",
      rationale:
        "These symptoms are consistent with hypoglycemia, which requires immediate treatment.",
    },
    {
      question:
        "A patient with a newly inserted central line develops fever and chills. What is the priority?",
      options: [
        "Continue the infusion",
        "Assess for central line infection and notify the provider urgently",
        "Ignore if blood pressure is normal",
        "Delay until the next shift",
      ],
      correct:
        "Assess for central line infection and notify the provider urgently",
      rationale:
        "Central line infection can be life-threatening and requires prompt recognition.",
    },
    {
      question:
        "A patient with severe chest pain has a history of hypertension and smoking. What is the priority action?",
      options: [
        "Start exercise therapy",
        "Rapidly assess for ACS and activate emergency response",
        "Offer a warm drink",
        "Document only",
      ],
      correct: "Rapidly assess for ACS and activate emergency response",
      rationale:
        "Chest pain in high-risk patients may signal acute coronary syndrome.",
    },
    {
      question:
        "A patient with suspected meningitis has fever, photophobia, and neck stiffness. What is the most immediate priority?",
      options: [
        "Start seizure precautions and urgent medical assessment",
        "Offer a snack",
        "Wait for outpatient follow-up",
        "Check for dental pain",
      ],
      correct: "Start seizure precautions and urgent medical assessment",
      rationale:
        "Meningitis requires urgent assessment, treatment, and safety measures.",
    },
    {
      question:
        "A patient with severe dehydration is lethargic and has dry mucous membranes. What is the priority?",
      options: [
        "Assess perfusion and provide ordered fluid replacement",
        "Delay fluids until discharge",
        "Change the room lights",
        "Observe without intervention",
      ],
      correct: "Assess perfusion and provide ordered fluid replacement",
      rationale:
        "Severe dehydration needs prompt fluid restoration and monitoring.",
    },
    {
      question:
        "A patient with a new cough, fever, and dyspnea has COVID-like symptoms. What is the most appropriate nursing action?",
      options: [
        "Ignore symptoms until full recovery",
        "Use standard precautions, monitor respiratory status, and notify the provider per protocol",
        "Ask the patient to schedule a later visit",
        "Send the patient home with a prescription",
      ],
      correct:
        "Use standard precautions, monitor respiratory status, and notify the provider per protocol",
      rationale:
        "Respiratory symptoms require assessment and infection-control measures.",
    },
    {
      question:
        "A patient reports worsening lower limb swelling and shortness of breath after surgery. What is the most likely concern?",
      options: [
        "Deep vein thrombosis with possible pulmonary embolism",
        "A minor bruise",
        "An expected side effect of hydration",
        "A normal recovery sign",
      ],
      correct: "Deep vein thrombosis with possible pulmonary embolism",
      rationale: "Swelling and dyspnea after surgery may signal DVT or PE.",
    },
    {
      question:
        "An elderly patient with confusion, fever, and wandering behavior is most likely experiencing:",
      options: [
        "Delirium requiring assessment of reversible causes",
        "Routine aging",
        "Mood normalcy",
        "Expected sleep pattern",
      ],
      correct: "Delirium requiring assessment of reversible causes",
      rationale:
        "Acute confusion with fever may indicate delirium from infection or medication effects.",
    },
    {
      question:
        "A patient with a blood transfusion reaction develops chills and flank pain. What should the nurse do first?",
      options: [
        "Continue the transfusion until it finishes",
        "Stop the transfusion and notify the provider immediately",
        "Reduce the IV flow rate and hide the reaction",
        "Delay charting",
      ],
      correct: "Stop the transfusion and notify the provider immediately",
      rationale:
        "Acute transfusion reaction requires immediate stop, assessment, and provider notification.",
    },
    {
      question:
        "A patient with severe lower abdominal pain and inability to urinate is likely to have:",
      options: [
        "Urinary retention",
        "Normal variation",
        "Food intolerance",
        "Mood disorder",
      ],
      correct: "Urinary retention",
      rationale:
        "Urinary retention causes lower abdominal discomfort and inability to void.",
    },
    {
      question:
        "A patient with severe burns over the chest has wheezing and dyspnea. What is the priority?",
      options: [
        "Assess airway and breathing immediately",
        "Offer a drink only",
        "Observe without intervention",
        "Leave the patient alone",
      ],
      correct: "Assess airway and breathing immediately",
      rationale:
        "Airway involvement in burns can be life-threatening and needs urgent assessment.",
    },
    {
      question:
        "A patient with diabetes reports frequent urination and thirst. What is the likely issue?",
      options: [
        "Hyperglycemia",
        "Hypoglycemia",
        "Normal hydration",
        "Constipation",
      ],
      correct: "Hyperglycemia",
      rationale: "Polyuria and polydipsia are classic hyperglycemia symptoms.",
    },
    {
      question:
        "A patient with a pressure ulcer is being taught to prevent worsening. Which teaching is correct?",
      options: [
        '"I should massage the wound daily."',
        '"I should reposition frequently and protect the skin."',
        '"I can ignore the wound if it does not hurt."',
        '"I need no skin assessment."',
      ],
      correct: '"I should reposition frequently and protect the skin."',
      rationale:
        "Repositioning and skin protection reduce pressure-ulcer progression.",
    },
  ];

  const samples = [];

  const pushLicenseMatrix = function () {
    licenseMatrix.forEach(function (item, idx) {
      samples.push([
        "lic-m-" + String(idx + 1).padStart(2, "0"),
        "Licence Exam Preparation",
        "True or False Matrix",
        item.prompt,
        JSON.stringify([
          "True",
          "False",
          "Uncertain",
          "Not applicable",
          "No answer",
        ]),
        JSON.stringify(item.correct),
        item.rationale,
        false,
        "true_false_matrix",
        "mixed_100_mark",
        "Section A",
        1,
      ]);
    });
  };

  const pushLicenseBest = function () {
    licenseBest.forEach(function (item, idx) {
      samples.push([
        "lic-b-" + String(idx + 1).padStart(2, "0"),
        "Licence Exam Preparation",
        "Best Answer",
        item.question,
        JSON.stringify(item.options),
        item.correct,
        item.rationale,
        false,
        "best_answer",
        "mixed_100_mark",
        "Section B",
        1,
      ]);
    });
  };

  const pushIbnSina = function () {
    ibnSina.forEach(function (item, idx) {
      samples.push([
        "ibn-" + String(idx + 1).padStart(2, "0"),
        "IBN SINA Trust Nursing Exam",
        "Scenario Best Answer",
        item.question,
        JSON.stringify(item.options),
        item.correct,
        item.rationale,
        false,
        "scenario_best_answer",
        "scenario_case_based",
        "Case Scenario",
        1,
      ]);
    });
  };

  const statementBasedExamples = [
    [
      "lic-m-13",
      "Licence Exam Preparation",
      "Basic Needs for Newborns",
      "Which of the following are included in basic needs for a newborn?",
      JSON.stringify([
        "To be warm",
        "To give bath",
        "To breathe normally",
        "To be weighted",
        "To be fed",
      ]),
      JSON.stringify(["To be warm", "To breathe normally", "To be fed"]),
      "A newborn needs warmth, breathing support, and feeding; weight is recorded but not a basic physiological need in the same sense.",
      false,
      "true_false_matrix",
      "mixed_100_mark",
      "Section A",
      0.2,
    ],
    [
      "lic-m-14",
      "Licence Exam Preparation",
      "Pre-operative Patient Preparation",
      "Which of the following are included in pre-operative patient preparation?",
      JSON.stringify(["Fasting (NPO)", "Skin preparation", "Patient education"]),
      JSON.stringify(["Fasting (NPO)", "Skin preparation", "Patient education"]),
      "Pre-operative preparation includes NPO status, skin preparation, and patient education.",
      false,
      "true_false_matrix",
      "mixed_100_mark",
      "Section A",
      0.2,
    ],
    [
      "lic-m-15",
      "Licence Exam Preparation",
      "Levels of Management",
      "What are the levels of management in nursing?",
      JSON.stringify(["Top management", "Middle management", "Lower management"]),
      JSON.stringify(["Top management", "Middle management", "Lower management"]),
      "Management in nursing is typically categorized into top, middle, and lower levels.",
      false,
      "true_false_matrix",
      "mixed_100_mark",
      "Section A",
      0.2,
    ],
    [
      "lic-m-16",
      "Licence Exam Preparation",
      "Vital Signs",
      "What do vital signs include?",
      JSON.stringify([
        "Pulse",
        "Respiration",
        "Temperature",
        "Blood pressure",
        "Weight",
      ]),
      JSON.stringify(["Pulse", "Respiration", "Temperature", "Blood pressure"]),
      "The classic vital signs are pulse, respiration, temperature, and blood pressure.",
      false,
      "true_false_matrix",
      "mixed_100_mark",
      "Section A",
      0.2,
    ],
    [
      "ibn-13",
      "IBN SINA Trust Nursing Exam",
      "Nursing Technical Practice",
      "In a ventilated patient, a sudden high peak airway pressure may indicate?",
      JSON.stringify([
        "Disconnection",
        "Hyperventilation",
        "Bronchospasm or obstruction",
      ]),
      "Bronchospasm or obstruction",
      "High peak airway pressure in a ventilated patient often points to obstruction or bronchospasm.",
      false,
      "scenario_best_answer",
      "scenario_case_based",
      "Case Scenario",
      1,
    ],
    [
      "ibn-14",
      "IBN SINA Trust Nursing Exam",
      "Surgical Protocol",
      "NPO status for solid food before elective surgery typically requires fasting for?",
      JSON.stringify(["2 hours", "4 hours", "6–8 hours", "12 hours"]),
      "6–8 hours",
      "Pre-operative fasting for solid food is typically 6–8 hours to reduce aspiration risk.",
      false,
      "scenario_best_answer",
      "scenario_case_based",
      "Case Scenario",
      1,
    ],
    [
      "ibn-15",
      "IBN SINA Trust Nursing Exam",
      "Pharmacology",
      "Which solution is most commonly used to treat cerebral edema?",
      JSON.stringify(["0.9% NaCl", "Dextrose 5%", "Ringer's lactate", "Mannitol"]),
      "Mannitol",
      "Mannitol is an osmotic diuretic used to reduce intracranial pressure and cerebral edema.",
      false,
      "scenario_best_answer",
      "scenario_case_based",
      "Case Scenario",
      1,
    ],
    [
      "ibn-16",
      "IBN SINA Trust Nursing Exam",
      "Biochemistry",
      "Which of the following tests is used to assess kidney function?",
      JSON.stringify(["Serum lipase", "Serum creatinine", "AST", "ALP"]),
      "Serum creatinine",
      "Serum creatinine is a standard indicator of kidney function.",
      false,
      "scenario_best_answer",
      "scenario_case_based",
      "Case Scenario",
      1,
    ],
    [
      "ibn-17",
      "IBN SINA Trust Nursing Exam",
      "Microbiology",
      "The infective stage of Entamoeba histolytica is?",
      JSON.stringify(["Trophozoite", "Cyst", "Oocyst", "Sporozoite"]),
      "Cyst",
      "The infective cyst form is responsible for transmission of Entamoeba histolytica.",
      false,
      "scenario_best_answer",
      "scenario_case_based",
      "Case Scenario",
      1,
    ],
    [
      "ibn-18",
      "IBN SINA Trust Nursing Exam",
      "Anatomy and Physiology",
      "Which electrolyte abnormality directly causes tetany?",
      JSON.stringify(["Hypocalcemia", "Hyperkalemia", "Hyponatremia"]),
      "Hypocalcemia",
      "Low calcium levels increase neuromuscular excitability and can cause tetany.",
      false,
      "scenario_best_answer",
      "scenario_case_based",
      "Case Scenario",
      1,
    ],
  ];

  const legacySamples = [
    [
      "q1",
      "NCLEX-RN",
      "Pharmacological Therapies",
      "A client is prescribed metformin. Which side effect is most common?",
      JSON.stringify(["Nausea", "Hypoglycemia", "Weight gain", "Bradycardia"]),
      "Nausea",
      "Metformin commonly causes GI upset such as nausea, especially when starting therapy.",
      false,
    ],
    [
      "q2",
      "NCLEX-RN",
      "Infection Prevention & Control",
      "Which action best prevents catheter-associated urinary tract infection (CAUTI)?",
      JSON.stringify([
        "Routine catheter changes",
        "Maintain closed drainage system",
        "Irrigate daily",
        "Use larger catheter",
      ]),
      "Maintain closed drainage system",
      "Maintaining a closed drainage system reduces bacterial entry.",
      false,
    ],
    [
      "q3",
      "NCLEX-RN",
      "Pharmacological Therapies",
      "Select all that apply: Which are signs of digoxin toxicity?",
      JSON.stringify(["Nausea", "Visual halos", "Bradycardia", "Tachycardia"]),
      JSON.stringify(["Nausea", "Visual halos", "Bradycardia"]),
      "Digoxin toxicity presents with GI symptoms, visual disturbances, and bradycardia.",
      true,
    ],
    [
      "q4",
      "Prometric",
      "Pharmacological Therapies",
      "A patient on warfarin should avoid which food?",
      JSON.stringify(["Spinach", "Chicken", "Rice", "Apples"]),
      "Spinach",
      "Vitamin K-rich foods like spinach antagonize warfarin.",
      false,
    ],
    [
      "q5",
      "Prometric",
      "Infection Prevention & Control",
      "Hand hygiene should be performed for at least how many seconds?",
      JSON.stringify(["10", "15", "20", "30"]),
      "20",
      "WHO recommends at least 20 seconds of handwashing.",
      false,
    ],
    [
      "q6",
      "NCLEX-RN",
      "Management of Care",
      "Which task can be delegated to an unlicensed assistive personnel (UAP)?",
      JSON.stringify([
        "Administer oral medications",
        "Obtain vital signs on a stable client",
        "Perform sterile dressing change",
        "Assess pain level",
      ]),
      "Obtain vital signs on a stable client",
      "UAPs may obtain vital signs on stable clients; assessment and medication administration remain with licensed staff.",
      false,
    ],
    [
      "q7",
      "NCLEX-RN",
      "Management of Care",
      "A nurse is prioritizing care for four clients. Which client should be seen first?",
      JSON.stringify([
        "Client with stable COPD awaiting discharge",
        "Client with chest pain and diaphoresis",
        "Client needing routine wound dressing",
        "Client with scheduled lab draw",
      ]),
      "Client with chest pain and diaphoresis",
      "Chest pain with diaphoresis suggests acute cardiac event and takes highest priority.",
      false,
    ],
    [
      "q8",
      "NCLEX-RN",
      "Safety and Infection Control",
      "Which precaution is required for a client with suspected tuberculosis?",
      JSON.stringify([
        "Contact precautions",
        "Droplet precautions",
        "Airborne precautions",
        "Standard precautions only",
      ]),
      "Airborne precautions",
      "TB is transmitted via airborne droplet nuclei; airborne precautions with N95 are required.",
      false,
    ],
    [
      "q9",
      "NCLEX-RN",
      "Safety and Infection Control",
      "Select all that apply: Which are standard precautions?",
      JSON.stringify([
        "Hand hygiene",
        "Use of PPE",
        "Safe injection practices",
        "Isolation of all clients",
      ]),
      JSON.stringify([
        "Hand hygiene",
        "Use of PPE",
        "Safe injection practices",
      ]),
      "Standard precautions apply to all clients and include hand hygiene, PPE, and safe injection practices.",
      true,
    ],
    [
      "q10",
      "NCLEX-RN",
      "Health Promotion and Maintenance",
      "Which screening is recommended for women aged 50-74?",
      JSON.stringify([
        "Mammogram every 1-2 years",
        "Pap smear annually",
        "Colonoscopy at age 30",
        "PSA testing",
      ]),
      "Mammogram every 1-2 years",
      "USPSTF recommends biennial mammography for women 50-74.",
      false,
    ],
    [
      "q11",
      "NCLEX-RN",
      "Psychosocial Integrity",
      "A client with schizophrenia reports hearing voices. The best response is:",
      JSON.stringify([
        "Tell them the voices are not real",
        "Ask what the voices are saying",
        "Ignore the statement",
        "Increase antipsychotic dose",
      ]),
      "Ask what the voices are saying",
      "Assessing the content of hallucinations is essential for safety.",
      false,
    ],
    [
      "q12",
      "NCLEX-RN",
      "Basic Care and Comfort",
      "Which position helps relieve dyspnea in a client with heart failure?",
      JSON.stringify(["Supine", "Trendelenburg", "High Fowler", "Prone"]),
      "High Fowler",
      "High Fowler position reduces venous return and eases breathing.",
      false,
    ],
    [
      "q13",
      "NCLEX-RN",
      "Basic Care and Comfort",
      "Which intervention prevents pressure ulcers in an immobilized client?",
      JSON.stringify([
        "Massage bony prominences",
        "Reposition every 2 hours",
        "Keep head of bed at 45 degrees",
        "Use donut cushions",
      ]),
      "Reposition every 2 hours",
      "Regular repositioning offloads pressure and prevents ulcers.",
      false,
    ],
    [
      "q14",
      "NCLEX-RN",
      "Reduction of Risk Potential",
      "Which lab value indicates therapeutic warfarin effect?",
      JSON.stringify(["PT 12 sec", "INR 2.5", "aPTT 60 sec", "Platelets 150k"]),
      "INR 2.5",
      "Therapeutic INR for warfarin is typically 2.0-3.0.",
      false,
    ],
    [
      "q15",
      "NCLEX-RN",
      "Reduction of Risk Potential",
      "A client with low potassium should be monitored for:",
      JSON.stringify([
        "Bradycardia",
        "Peaked T waves",
        "Muscle weakness",
        "Hypertension",
      ]),
      "Muscle weakness",
      "Hypokalemia causes muscle weakness and cardiac dysrhythmias.",
      false,
    ],
    [
      "q16",
      "NCLEX-RN",
      "Physiological Adaptation",
      "Which finding indicates increased intracranial pressure?",
      JSON.stringify([
        "Bradycardia",
        "Hypotension",
        "Tachypnea",
        "Pinpoint pupils",
      ]),
      "Bradycardia",
      "Cushing triad includes bradycardia, hypertension, and irregular respirations.",
      false,
    ],
    [
      "q17",
      "NCLEX-RN",
      "Physiological Adaptation",
      "Select all that apply: Signs of hypoglycemia include:",
      JSON.stringify(["Sweating", "Confusion", "Polyuria", "Tremors"]),
      JSON.stringify(["Sweating", "Confusion", "Tremors"]),
      "Hypoglycemia presents with sweating, tremors, confusion; polyuria is hyperglycemia.",
      true,
    ],
    [
      "q18",
      "NCLEX-RN",
      "Pharmacological Therapies",
      "Which medication requires monitoring of serum drug levels?",
      JSON.stringify([
        "Amoxicillin",
        "Vancomycin",
        "Acetaminophen",
        "Lisinopril",
      ]),
      "Vancomycin",
      "Vancomycin requires trough level monitoring to prevent toxicity.",
      false,
    ],
    [
      "q19",
      "NCLEX-RN",
      "Pharmacological Therapies",
      "A client starting SSRIs should be taught about:",
      JSON.stringify([
        "Immediate mood improvement",
        "Risk of serotonin syndrome",
        "No drug interactions",
        "Stop abruptly if side effects",
      ]),
      "Risk of serotonin syndrome",
      "SSRIs carry risk of serotonin syndrome, especially with other serotonergic drugs.",
      false,
    ],
    [
      "q20",
      "NCLEX-RN",
      "Infection Prevention & Control",
      "Which is the most effective way to prevent MRSA transmission?",
      JSON.stringify([
        "Prophylactic antibiotics",
        "Hand hygiene",
        "Isolation of all visitors",
        "Daily chlorhexidine baths for all",
      ]),
      "Hand hygiene",
      "Hand hygiene is the single most effective infection prevention measure.",
      false,
    ],
    [
      "q21",
      "Prometric",
      "Management of Care",
      "Which action should the nurse take first when a fire occurs on the unit?",
      JSON.stringify([
        "Pull fire alarm",
        "Evacuate clients",
        "Extinguish fire",
        "Close doors",
      ]),
      "Pull fire alarm",
      "RACE: Rescue, Alarm, Confine, Extinguish; alarm is priority after rescue.",
      false,
    ],
    [
      "q22",
      "Prometric",
      "Safety and Infection Control",
      "Which client is at highest risk for falls?",
      JSON.stringify([
        "Young adult post-appendectomy",
        "Elderly client on opioids and sedatives",
        "Adolescent with sprained ankle",
        "Middle-aged client with HTN",
      ]),
      "Elderly client on opioids and sedatives",
      "Advanced age plus CNS-depressing medications increases fall risk.",
      false,
    ],
    [
      "q23",
      "Prometric",
      "Pharmacological Therapies",
      "Which antidote is used for heparin overdose?",
      JSON.stringify([
        "Vitamin K",
        "Protamine sulfate",
        "Naloxone",
        "Flumazenil",
      ]),
      "Protamine sulfate",
      "Protamine sulfate reverses heparin.",
      false,
    ],
    [
      "q24",
      "Prometric",
      "Pharmacological Therapies",
      "Select all that apply: Adverse effects of opioids include:",
      JSON.stringify([
        "Respiratory depression",
        "Constipation",
        "Hypertension",
        "Sedation",
      ]),
      JSON.stringify(["Respiratory depression", "Constipation", "Sedation"]),
      "Opioids cause respiratory depression, constipation, and sedation; not hypertension.",
      true,
    ],
    [
      "q25",
      "Prometric",
      "Physiological Adaptation",
      "Which sign indicates shock?",
      JSON.stringify([
        "Hypertension",
        "Warm dry skin",
        "Tachycardia",
        "Bradypnea",
      ]),
      "Tachycardia",
      "Shock presents with tachycardia, hypotension, and cool clammy skin.",
      false,
    ],
    [
      "q26",
      "Prometric",
      "Basic Care and Comfort",
      "Which diet is appropriate for a client with dysphagia?",
      JSON.stringify([
        "Regular diet",
        "Clear liquid only",
        "Thickened liquids and pureed foods",
        "High fiber diet",
      ]),
      "Thickened liquids and pureed foods",
      "Dysphagia diets use thickened liquids and pureed textures to prevent aspiration.",
      false,
    ],
    [
      "q27",
      "Prometric",
      "Health Promotion and Maintenance",
      "Which vaccine is recommended annually?",
      JSON.stringify(["Hepatitis B", "Influenza", "MMR", "Varicella"]),
      "Influenza",
      "Influenza vaccine is recommended annually for all eligible individuals.",
      false,
    ],
    [
      "q28",
      "Prometric",
      "Reduction of Risk Potential",
      "Which finding requires immediate intervention in a post-op client?",
      JSON.stringify([
        "Pain 4/10",
        "Urine output 30 mL/hr",
        "Oxygen saturation 88%",
        "Temperature 37.2 C",
      ]),
      "Oxygen saturation 88%",
      "SpO2 88% indicates hypoxemia requiring immediate action.",
      false,
    ],
    [
      "q29",
      "Prometric",
      "Psychosocial Integrity",
      "Best response to a grieving client is:",
      JSON.stringify([
        "You should move on.",
        "Everything happens for a reason.",
        "I am here with you.",
        "At least they lived a long life.",
      ]),
      "I am here with you.",
      "Therapeutic presence and empathy support grieving clients.",
      false,
    ],
    [
      "q30",
      "Prometric",
      "Infection Prevention & Control",
      "Which PPE is used for droplet precautions?",
      JSON.stringify([
        "N95 respirator",
        "Surgical mask",
        "Gown and gloves only",
        "Face shield only",
      ]),
      "Surgical mask",
      "Droplet precautions require a surgical mask within 3 feet of the client.",
      false,
    ],
  ];

  statementBasedExamples.forEach(function (r) {
    samples.push(r);
  });

  legacySamples.forEach(function (r) {
    const transformed = r.slice();
    transformed[7] =
      transformed[7] === true ||
      String(transformed[7]).toLowerCase() === "true";
    transformed[8] = transformed[8] || "best_answer";
    transformed[9] = transformed[9] || "standard_mcq";
    transformed[10] = transformed[10] || "General";
    transformed[11] = transformed[11] == null ? 1 : transformed[11];
    samples.push(transformed);
  });

  pushLicenseMatrix();
  pushLicenseBest();
  pushIbnSina();

  samples.forEach(function (r) {
    q.appendRow(r);
  });
}
