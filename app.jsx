const { useState, useEffect, useCallback, useRef } = React;

/* ---------- config ---------- */
// Owner is pinned by immutable Firebase Auth UID — the same check firestore.rules makes (never email:
// an email can be re-created on a deleted account, a uid can't). Add a second owner in BOTH places.
const OWNER_UIDS = ["plexusOwnerNeil"];
const isOwnerUser = (u) => !!u && OWNER_UIDS.includes(String(u.uid||""));
// Delegated PTO approver(s), pinned by immutable auth UID. The REAL gate is isPtoAdmin() in
// firestore.rules (backups repo) — keep the two lists in sync (+ backfill-mirrors.mjs). This
// list only routes the UI; never gate it on a roster flag (staff can write their own mirror,
// so a self-set flag would show the tab — the rules pin is what makes that harmless).
const PTO_ADMIN_UIDS = [];   // none yet — pin by auth uid here AND in firestore.rules isPtoAdmin()
const isPtoAdminUid = (uid) => !!uid && PTO_ADMIN_UIDS.includes(uid);
const FIXED = [
  { key: "consults",  label: "Consults",   rate: 60, unit: "ea" },
  { key: "followups", label: "Follow-ups", rate: 30, unit: "ea" },
];
// per-user variable pay types. rate is set per employee in owner panel.
// decimal:true => accept fractional quantities (e.g. 7.5 hrs).
const VARIABLE = [
  { key: "clinic_pts", label: "Clinic Patients",    unit: "patient", decimal: false },
  { key: "perdiem",    label: "Per diem",           unit: "days",  decimal: false },
  { key: "clinic_hr",  label: "Clinic hourly",      unit: "hrs",   decimal: true },
  { key: "virtual_hr", label: "Virtual hourly",     unit: "hrs",   decimal: true },
  { key: "hosp_hr",    label: "In-hospital hourly", unit: "hrs",   decimal: true },
];
const ALL_TYPES = [...FIXED, ...VARIABLE];
// Employee-entered "Other" one-off amounts are deactivated (abuse vector). All Other logic stays
// wired (build/save/load/totals) and the roll-up Other column remains — flip to true to re-enable.
const OTHER_ENABLED = false;
// PTO feature: ON for all staff who have a PTO allowance (ptoDays>0).
const PTO_ENABLED = true;
const ptoVisibleFor = () => PTO_ENABLED;
// a person sees PTO only if the feature is on for them AND they actually have a PTO allowance (>0)
const ptoEligible = (emp) => !!emp && ptoVisibleFor(emp.username) && Number(emp.ptoDays) > 0;
// employee roles — canonical set + display order for the roster grouping
const ROLE_CANON = ["MD", "NP", "Staff", "Scribe"];
const ROLE_RANK = { md: 0, np: 1, staff: 2, scribe: 3 };
const ROLE_LABEL = { md: "MD", np: "NP", staff: "Staff", scribe: "Scribe" };
// PTO resets each year on the employee's work anniversary (their start date). Returns the Date that
// the CURRENT PTO year began (the most recent anniversary on or before today), or null if no start date.
function ptoYearStartDate(startDate) {
  // POLICY 2026-09-09 (Neil): PTO resets Jan 1 for everyone — the PTO year is the calendar year.
  // `startDate` is the employment start date (informational) and no longer drives the PTO year.
  // Returning null makes every caller fall back to the calendar year.
  return null;
  if (!startDate) return null;
  const s = parseDate(startDate); if (isNaN(s)) return null;
  const t = parseDate(todayISO());
  let y = t.getFullYear();
  if (t < new Date(y, s.getMonth(), s.getDate())) y -= 1;   // anniversary not reached yet this year → last year's
  return new Date(y, s.getMonth(), s.getDate());
}
// local-date YYYY-MM-DD for a Date object (calendar cells are local, not UTC)
const localISO = (dt) => dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0");
const ptoDayValue = (r) => (r && r.half ? 0.5 : 1);
const isFixed = key => FIXED.some(f => f.key === key);
const isDecimal = key => VARIABLE.some(v => v.key === key && v.decimal);
// dollar value of a counts map for a given employee (per-emp rates for variable types)
const payForCounts = (counts, emp) => ALL_TYPES.reduce((s,t) => {
  const qty = Number((counts||{})[t.key] || 0);
  const rate = isFixed(t.key) ? t.rate : Number(emp && emp.rates ? emp.rates[t.key] : 0) || 0;
  return s + qty*rate;
}, 0);
// round quantities: decimals to 2 places, counts to int
const qtyRound = (key, v) => isDecimal(key) ? Math.round(v*100)/100 : Math.round(v);
// per-day caps on how much of a pay type can be logged (undefined = uncapped)
const QTY_MAX = { perdiem: 1, clinic_hr: 9, virtual_hr: 8, hosp_hr: 12 };
const capQty = (key, v) => QTY_MAX[key] != null ? Math.min(QTY_MAX[key], v) : v;
// merge owner-only salaries {empId:annual} into a roster draft as an editable annualSalary field
const mergeSalaryDraft = (emps, sal) => emps.map(e => ({ ...e, annualSalary: (sal && sal[e.id] != null) ? String(sal[e.id]) : "" }));
const normU = s => String(s||"").trim().toLowerCase();
// sort key by last name, ignoring trailing credentials (NP, MD, …); first name as tiebreak
const CRED_SUFFIX = new Set(["np","md","do","pa","rn","aprn","fnp","dnp","crna","pac","pa-c","msn","apn","facp"]);
const lastNameKey = (name) => {
  const w = String(name||"").trim().toLowerCase().replace(/[.,]/g,"").split(/\s+/).filter(x => x && !CRED_SUFFIX.has(x));
  return (w[w.length-1] || "") + " " + (w[0] || "");
};
// admin display: "Last, First [credential]" from a stored "First [Middle] Last [credential]" name
const lastFirst = (name) => {
  const raw = String(name||"").trim();
  if (!raw || /\(removed\)/i.test(raw)) return raw;
  const words = raw.split(/\s+/);
  const creds = [];
  while (words.length > 2 && CRED_SUFFIX.has(words[words.length-1].toLowerCase().replace(/[.,]/g,""))) creds.unshift(words.pop());
  if (words.length < 2) return raw;
  const last = words.pop();
  return last + ", " + words.join(" ") + (creds.length ? " " + creds.join(" ") : "");
};

const money = n => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
// All date/period boundaries anchor to US CENTRAL time (the practice's timezone) — not the
// device timezone, and not UTC (the old toISOString() flipped "today" at ~6-7pm CT).
// "Today", the future-date block, period cutoffs, and the 72h pre-payday lock all use CT.
const CT_TZ = "America/Chicago";
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: CT_TZ });   // YYYY-MM-DD in CT
const nowCT = () => new Date(new Date().toLocaleString("en-US", { timeZone: CT_TZ }));  // CT wall-clock as a Date

/* ---------- pay period model — PER ENTITY ----------
   Each LLC runs its own payroll calendar, stored at pay/{eid}/meta/config (owner-written, staff-readable):
     { cycle:"monthly",  payday:10, lockHours:48 }                             // Plexus Pulm: period = calendar month,
                                                                                  paid the 10th of the next month, locks 48h before
     { cycle:"biweekly", anchor:"2026-06-14", paydayOffset:6, lockHours:72 }    // HRG-style 14-day Sun–Sat, Friday payday
   periodModel(cfg) builds the period functions (below, after the date helpers). EntityApp installs the
   active entity's model with setPeriodModel() at the top of its render, and the same-named shims
   (periodIndexFor / periodByIndex / …) serve every component unchanged. Only ONE EntityApp is ever
   mounted (entity tabs are keyed), so a module-level current model is safe.                         */

// parse 'YYYY-MM-DD' as a local date at midnight (avoids UTC shift bugs)
function parseDate(iso) { const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d); }
function fmtISO(dt) { return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0"); }
function addDays(dt, n) { const x = new Date(dt); x.setDate(x.getDate()+n); return x; }
function fmtShort(iso) { const d = parseDate(iso); return d.toLocaleDateString(undefined,{month:"short",day:"numeric"}); }
function fmtShortYr(iso) { const d = parseDate(iso); return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }

// Salaried BASE for one pay period. A full period pays annual ÷ periods-per-year (12 monthly, 26
// biweekly). When the person's start date or last day (roster startDate / endDate) falls inside the
// period, the base is prorated by WEEKDAYS (Mon–Fri) employed ÷ weekdays in the period — for EVERYONE, W-2 and 1099 alike
// (Neil, 2026-09-09: "keep all prorated amounts based on weekdays only going forward").
// A period entirely before the start date or after the last day pays 0. Returns { base, days, of }
// so callers can flag a partial period ("5/10 weekdays"). The payroll email (backups repo
// payroll-summary.mjs) carries an identical copy — change both together.
function proratedBase(annual, period, emp) {
  const full = Number(annual) > 0 ? Number(annual) / periodsPerYear() : 0;
  if (!full || !period) return { base: 0, days: 0, of: 0 };
  const isISO = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const sd = emp && emp.startDate, ed = emp && emp.endDate;
  const from = isISO(sd) && sd > period.start ? sd : period.start;
  const to   = isISO(ed) && ed < period.end   ? ed : period.end;
  const countDays = (a, b) => { let n = 0; for (let d = parseDate(a); fmtISO(d) <= b; d = addDays(d, 1)) if (d.getDay() >= 1 && d.getDay() <= 5) n++; return n; };
  const of = countDays(period.start, period.end);   // weekdays in the period (10 biweekly, 20–23 monthly)
  if (from > to) return { base: 0, days: 0, of };
  const days = countDays(from, to);
  if (days >= of) return { base: full, days: of, of };
  return { base: full * days / of, days, of };
}
const DEFAULT_PAY_CFG = { cycle: "monthly", payday: 10, lockHours: 48 };
function ordinal(n) { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
// Build the period functions for one payroll calendar. Every period object has the same shape the
// app has always used: { index, start, end, payday, lockAt (Date, CT wall-clock), label, paydayLabel }.
function periodModel(cfgIn) {
  const cfg = { ...DEFAULT_PAY_CFG, ...(cfgIn || {}) };
  const lockHours = Number(cfg.lockHours) > 0 ? Number(cfg.lockHours) : DEFAULT_PAY_CFG.lockHours;
  const lockFor = (payday) => { const l = new Date(payday); l.setHours(0,0,0,0); l.setHours(l.getHours() - lockHours); return l; };
  const mk = (i, start, end, payday) => ({
    index: i, start: fmtISO(start), end: fmtISO(end), payday: fmtISO(payday), lockAt: lockFor(payday),
    label: fmtShort(fmtISO(start)) + " – " + fmtShort(fmtISO(end)), paydayLabel: fmtShort(fmtISO(payday)),
  });
  if (cfg.cycle === "biweekly") {
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.anchor || "")) ? cfg.anchor : "2026-06-14";   // a Sunday
    const LEN = 14, off = Number(cfg.paydayOffset) >= 0 ? Number(cfg.paydayOffset) : 6;              // end (Sat) + 6 = Friday
    return {
      cfg, perYear: 26,
      periodIndexFor: (iso) => Math.floor(Math.floor((parseDate(iso) - parseDate(anchor)) / 86400000) / LEN),
      periodByIndex: (i) => { const start = addDays(parseDate(anchor), i * LEN), end = addDays(start, LEN - 1); return mk(i, start, end, addDays(end, off)); },
      describe: "Pay periods run Sunday–Saturday (14 days), paid " + off + " days after close; a period locks " + lockHours + " hours before payday.",
    };
  }
  // monthly: period = calendar month; index 0 = January 2026; payday = the Nth of the FOLLOWING month
  const EPOCH_YEAR = 2026;
  const payDay = Math.min(28, Math.max(1, Math.round(Number(cfg.payday)) || DEFAULT_PAY_CFG.payday));
  return {
    cfg, perYear: 12,
    periodIndexFor: (iso) => { const [y, m] = String(iso).split("-").map(Number); return (y - EPOCH_YEAR) * 12 + (m - 1); },
    periodByIndex: (i) => {
      const y = EPOCH_YEAR + Math.floor(i / 12), m = ((i % 12) + 12) % 12;        // m = 0..11
      return mk(i, new Date(y, m, 1), new Date(y, m + 1, 0), new Date(y, m + 1, payDay));
    },
    describe: "Pay periods are calendar months, paid on the " + ordinal(payDay) + " of the following month; a period locks " + lockHours + " hours before payday.",
  };
}
// the ACTIVE entity's model — installed by EntityApp before render; shims below keep every call site unchanged
let PM = periodModel(DEFAULT_PAY_CFG);
function setPeriodModel(cfg) { PM = periodModel(cfg); return PM; }
function periodsPerYear() { return PM.perYear; }
function periodDescription() { return PM.describe; }
// which period index contains a given ISO date (can be negative for dates before the epoch/anchor)
function periodIndexFor(iso) { return PM.periodIndexFor(iso); }
// build a period object from its index
function periodByIndex(i) { return PM.periodByIndex(i); }
// every ISO day of a period, inclusive (14 biweekly, 28–31 monthly)
function periodDayList(p) { const out = []; for (let d = parseDate(p.start); fmtISO(d) <= p.end; d = addDays(d, 1)) out.push(fmtISO(d)); return out; }
// is a period locked right now? (auto: lockHours before payday). lockAt is CT wall-clock
// (built from date components), so compare against "now" in the same CT frame.
function isPeriodLocked(p, now = nowCT()) { return now >= p.lockAt; }
// combined lock: an admin force-unlock overrides everything, then admin force-lock, then auto-lock
function isPeriodLockedCombined(periodIndex, manualLocks, manualUnlocks = [], now = nowCT()) {
  if (Array.isArray(manualUnlocks) && manualUnlocks.includes(periodIndex)) return false;   // admin override: unlocked
  if (Array.isArray(manualLocks) && manualLocks.includes(periodIndex)) return true;         // admin force-lock
  return isPeriodLocked(periodByIndex(periodIndex), now);                                    // auto (lockHours pre-payday)
}
// is a given ISO date inside any locked period?
function dateInLockedPeriod(iso, manualLocks, manualUnlocks = [], now = nowCT()) {
  return isPeriodLockedCombined(periodIndexFor(iso), manualLocks, manualUnlocks, now);
}
// the period index for "today"
function currentPeriodIndex() { return periodIndexFor(todayISO()); }
// a window of selectable periods around now (past `back`, future `fwd`)
function periodList(back = 8, fwd = 2) {
  const c = currentPeriodIndex();
  const out = [];
  for (let i = c + fwd; i >= c - back; i--) out.push(periodByIndex(i));
  return out; // newest first
}
// recurring per-period stipend (employees-doc fields: stipend, stipendNote, stipendStart)
const stipendFor = (emp, period) => {
  const amt = Number(emp && emp.stipend) || 0;
  if (amt <= 0 || !period) return 0;
  const s = emp.stipendStart;
  return (!s || s <= period.end) ? amt : 0;
};

/* ---------- storage layer (Firebase Firestore) — EVERY path is scoped to one entity (LLC) ----------
     pay/{eid}/meta/{employees|ptoAdmin|manualLocks|manualUnlocks|config}   -> { value: ... }   (sGet/sSet)
     pay/{eid}/entries/{uid}  + the owner-only salaries / adjustments docs                       (per-person)
     pay/{eid}/pto/{uid}
   Same shapes and helpers as HRG; the only difference is the leading `eid` argument. Each LLC is a
   separate employer, so its roster, rates, salaries, entries, PTO and locks never mix with another's. */
async function sGet(eid, key, fallback) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "meta", key);
    const snap = await window._fs.getDoc(ref);
    if (snap.exists() && snap.data() && "value" in snap.data()) return snap.data().value;
    return fallback;
  } catch (e) { console.error("read failed", e); return fallback; }
}
async function sSet(eid, key, val) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "meta", key);
    await window._fs.setDoc(ref, { value: val });
    return true;
  } catch (e) { console.error("write failed", e); return false; }
}

/* ---------- per-person entries (pay/{eid}/entries, one doc per auth uid) ----------
   Each NP can read/write only their own doc; the owner can read every doc.
   Document shape matches the rest of the app: { value: [ {id,empId,username,date,counts,other} ] } */
async function loadEntriesForUid(eid, uid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    const snap = await window._fs.getDoc(ref);
    if (snap.exists() && snap.data() && "value" in snap.data()) return snap.data().value || [];
    return [];
  } catch (e) { console.error("entries read failed", e); return []; }
}
async function saveEntriesForUid(eid, uid, val) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { value: val }, { merge: true });   // merge so per-period cap certs aren't wiped
    return true;
  } catch (e) { console.error("entries write failed", e); return false; }
}
// per-NP, per-period cap certifications, stored alongside the NP's entries: { "<periodIdx>": {cap, at} }
async function loadCertsForUid(eid, uid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    const snap = await window._fs.getDoc(ref);
    if (snap.exists() && snap.data() && snap.data().certs) return snap.data().certs;
    return {};
  } catch (e) { return {}; }
}
async function saveCertForUid(eid, uid, periodIdx, cap, atISO) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { certs: { [String(periodIdx)]: { cap, at: atISO } } }, { merge: true });
    return true;
  } catch (e) { console.error("cert write failed", e); return false; }
}
// empId → auth-uid registry. Learned from (a) the empId marker every staffer stamps into
// their own doc at login (authoritative — works for people with zero entries, e.g.
// no-pay-type staff) and (b) the empId on logged entries (legacy fallback; a manager's doc
// maps her managed staff here, so the self-stamped marker wins). Populated on every
// owner loadAllEntries; consumed by resolveUidForEmp for mirrors and View-as.
let UID_BY_EMP = {};   // {eid: {empId: uid}} — per entity (rosters and empIds are per entity)
const resolveUidForEmp = (eid, empId, entries) =>
  (UID_BY_EMP[eid] || {})[empId] || ((entries || []).find(e => e.empId === empId) || {})._uid || null;
// owner-only: merge every NP's entries, tagging each with the uid doc it came from
async function loadAllEntries(eid) {
  try {
    const snap = await window._fs.getDocs(window._fs.collection(window._db, "pay", eid, "entries"));
    const all = [], byEntries = {}, byMarker = {};
    snap.forEach(d => {
      if (d.id === SALARY_DOC || d.id === ADJ_DOC) return;   // owner-only object-valued docs live here too — skip
      const data = d.data() || {};
      const isEmpDoc = String(d.id).startsWith("emp_");      // legacy empId-keyed docs aren't real logins
      if (data.empId && !isEmpDoc) byMarker[data.empId] = d.id;
      const v = data.value;
      if (!Array.isArray(v)) return;     // defensive: only per-NP entry arrays (never an object-valued doc)
      if (!isEmpDoc) v.forEach(e => { if (e && e.empId) byEntries[e.empId] = d.id; });
      v.forEach(e => all.push({ ...e, _uid: d.id }));
    });
    UID_BY_EMP[eid] = { ...byEntries, ...byMarker };   // marker beats entry-derived (manager docs)
    return all;
  } catch (e) { console.error("all-entries read failed", e); return []; }
}
/* ---------- PTO (pay/{eid}/pto, one doc per auth uid) ----------
   Shape: { value: [ {id, empId, date, half, status:"requested"|"approved", requestedAt, approvedAt, deniedAt} ] }
   Each user reads/writes only their own; the owner reads/writes all (approve/deny/enter-on-behalf). */
async function loadPto(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "pto", uid));
    return (snap.exists() && Array.isArray(snap.data()?.value)) ? snap.data().value : [];
  } catch (e) { return []; }
}
async function savePto(eid, uid, list) {
  try { await window._fs.setDoc(window._fs.doc(window._db, "pay", eid, "pto", uid), { value: list }); return true; }
  catch (e) { console.error("pto write failed", e); return false; }
}
async function loadAllPto(eid) {
  try {
    const snap = await window._fs.getDocs(window._fs.collection(window._db, "pay", eid, "pto"));
    const all = [];
    snap.forEach(d => { const v = d.data()?.value; if (Array.isArray(v)) v.forEach(r => all.push({ ...r, _uid: d.id })); });
    return all;
  } catch (e) { console.error("all-pto read failed", e); return []; }
}
/* ---------- admin-entered PTO (pay/{eid}/meta/ptoAdmin, ONE doc for everyone) ----------
   Shape: { value: { [empId]: [ {id, empId, date, half, status:"approved", by, approvedAt} ] } }
   Keyed by EMPLOYEE id (exists from the roster), not auth uid — so the owner can record
   time off for someone who has never logged in, and it shows up for them the moment they
   do. Lives at pay/{eid}/meta/ptoAdmin: staff-readable, owner-writable — no rules
   change. Merged with the per-uid self-requested docs everywhere PTO is displayed/counted. */
async function loadPtoAdmin(eid) { const v = await sGet(eid, "ptoAdmin", {}); return v && typeof v === "object" ? v : {}; }
async function savePtoAdmin(eid, map) { return await sSet(eid, "ptoAdmin", map); }
// Annual salaries (owner-only): stored at pay/{eid}/entries/<SALARY_DOC>. The existing rule on
// that collection is `isOwner() || auth.uid == docId` — and no staff account's uid can equal the
// literal "salaries", so this doc is owner-only with no rules change. Shape: { value: {empId: annual} }.
const SALARY_DOC = "salaries";
async function loadSalaries(eid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", SALARY_DOC);
    const snap = await window._fs.getDoc(ref);
    if (snap.exists() && snap.data() && snap.data().value) return snap.data().value;
    return {};
  } catch (e) { return {}; }
}
async function saveSalaries(eid, map) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", SALARY_DOC);
    await window._fs.setDoc(ref, { value: map });
    return true;
  } catch (e) { console.error("salaries write failed", e); return false; }
}
// a person's OWN salary, mirrored into their own entries doc so THEY can see their Base (owner pushes it)
async function loadMySalary(eid, uid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    const snap = await window._fs.getDoc(ref);
    return (snap.exists() && snap.data() && Number(snap.data().salary)) || 0;
  } catch (e) { return 0; }
}
async function saveMySalary(eid, uid, annual) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { salary: Number(annual) || 0 }, { merge: true });
    return true;
  } catch (e) { console.error("my-salary write failed", e); return false; }
}
// owner-only roll-up overrides/adjustments per pay period: { value: { "<periodIdx>": { "<empId>":
// { counts:{type:val}, other, base, bonus, reimbursement, notes } } } }. Owner-only (same trick as salaries).
const ADJ_DOC = "adjustments";
async function loadAdjustments(eid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", ADJ_DOC);
    const snap = await window._fs.getDoc(ref);
    return (snap.exists() && snap.data() && snap.data().value) || {};
  } catch (e) { return {}; }
}
async function saveAdjustments(eid, map) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", ADJ_DOC);
    await window._fs.setDoc(ref, { value: map });
    return true;
  } catch (e) { console.error("adjustments write failed", e); return false; }
}
// a person's OWN bonus/reimbursement per period, mirrored to their doc so they see it in their breakdown
async function loadMyAdj(eid, uid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    const snap = await window._fs.getDoc(ref);
    return (snap.exists() && snap.data() && snap.data().adj) || {};
  } catch (e) { return {}; }
}
async function saveMyAdj(eid, uid, map) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { adj: map }, { merge: true });
    return true;
  } catch (e) { console.error("my-adj write failed", e); return false; }
}

// ---- per-person mirror (2026-07-27): each staffer's OWN scoped roster + admin PTO live on
// their own doc, so nobody but the owner reads the shared roster/ptoAdmin. Rules make those
// docs OWNER-ONLY — managers included (a manager's mirror carries self + managed staff);
// everyone who isn't the owner falls back to their mirror.
async function loadMyRoster(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "entries", uid));
    const r = snap.exists() && snap.data() && snap.data().roster;
    return Array.isArray(r) ? r : null;
  } catch (e) { return null; }
}
async function loadMyAdminPto(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "entries", uid));
    return (snap.exists() && snap.data() && snap.data().adminPto) || {};
  } catch (e) { return {}; }
}
async function saveMyMirror(eid, uid, roster, adminPto, isManager) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { roster, adminPto, isManager: !!isManager }, { merge: true });
    return true;
  } catch (e) { console.error("mirror write failed", e); return false; }
}
// Try the shared roster first (only the owner passes — rules are owner-only, managers too);
// everyone else is denied and silently falls back to their own mirrored record (which for a
// manager includes their managed staff). Quiet catch so non-owners don't log errors.
async function loadVisibleRoster(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "meta", "employees"));
    const v = snap.exists() && snap.data() && snap.data().value;
    if (Array.isArray(v) && v.length) return v;
  } catch (e) {}
  return (await loadMyRoster(eid, uid)) || [];
}
async function loadVisibleAdminPto(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "meta", "ptoAdmin"));
    const v = snap.exists() && snap.data() && snap.data().value;
    if (v && typeof v === "object" && Object.keys(v).length) return v;
  } catch (e) {}
  return await loadMyAdminPto(eid, uid);
}
// the records a given employee may see: their own + (managers) the staff they manage +
// (the PTO approver) everyone — but non-self rows stripped to what the Time off tab needs:
// name/allowance/start date only, never rates/emails/caps/salary. No undefined values
// (Firestore rejects them on write).
const ptoRosterRow = (s) => { const o = { id: s.id, name: s.name, salaryOnly: !!s.salaryOnly }; if (s.ptoDays != null) o.ptoDays = s.ptoDays; if (s.startDate) o.startDate = s.startDate; return o; };
function scopedRosterFor(emp, all, ptoApprover) {
  if (!emp) return [];
  const out = [emp];
  if (emp.isManager) for (const s of (all || [])) if (s && s.managedBy === emp.id) out.push(s);
  if (ptoApprover) for (const s of (all || [])) if (s && !out.some(x => x.id === s.id)) out.push(ptoRosterRow(s));
  return out;
}
function scopedAdminPtoFor(emp, all, ptoAdmin, ptoApprover) {
  if (!emp) return {};
  if (ptoApprover) return { ...(ptoAdmin || {}) };
  const ids = new Set([emp.id]);
  if (emp.isManager) for (const s of (all || [])) if (s && s.managedBy === emp.id) ids.add(s.id);
  const out = {};
  for (const id of ids) if ((ptoAdmin || {})[id]) out[id] = ptoAdmin[id];
  return out;
}


/* ---------- app ---------- */
// Office manager: a scoped login that enters hours on behalf of assigned staff (no pay of their own).
// Reuses EntryView per selected employee; entries live in the manager's own doc, tagged by empId,
// so they roll up to the owner exactly like self-entry.
function ManagerView({ manager, employees, entries, upsertEntry, manualLocks, manualUnlocks, showToast }) {
  const managed = employees.filter(e => e.managedBy === manager.id);
  const [selId, setSelId] = useState(() => (managed[0] ? managed[0].id : null));
  const sel = managed.find(e => e.id === selId) || managed[0] || null;
  if (!managed.length) {
    return <div className="card"><div className="empty">No staff are assigned to you yet. Ask the owner to set someone's "Entered by" to your name in Employees &amp; rates.</div></div>;
  }
  return (
    <>
      <div className="card">
        <h2 style={{marginTop:0}}>Enter hours for staff</h2>
        <p className="hint">Pick whose hours you're entering, then fill their days below. Switching keeps each person separate.</p>
        <div className="manager-picker">
          {managed.map(e => (
            <button key={e.id} className={"btn " + (sel && e.id===sel.id ? "btn-primary" : "btn-ghost")} onClick={()=>setSelId(e.id)}>{e.name}</button>
          ))}
        </div>
      </div>
      {sel && <EntryView key={sel.id} emp={sel} entries={entries} upsertEntry={upsertEntry} certs={{}} certifyPeriod={()=>{}} manualLocks={manualLocks} manualUnlocks={manualUnlocks} showToast={showToast} />}
    </>
  );
}

// PTO request calendar (modal): month view, weekdays only, tap a day to cycle full → ½ → off.
function PtoCalendar({ pto, allowance, startDate, onSubmit, onClose, onCancel, allowPast }) {
  const todayStr = todayISO();
  const t0 = parseDate(todayStr);
  const [calY, setCalY] = useState(t0.getFullYear());
  const [calM, setCalM] = useState(t0.getMonth());
  const [sel, setSel] = useState({});

  const byDate = {};
  for (const r of (pto||[])) byDate[r.date] = r;
  // PTO year = the employee's anniversary year (resets on their start date); fall back to calendar year
  const yStart = ptoYearStartDate(startDate);
  const wStart = yStart ? localISO(yStart) : null;
  const wEnd = yStart ? localISO(new Date(yStart.getFullYear()+1, yStart.getMonth(), yStart.getDate())) : null;
  const inThisYear = (date) => wStart ? (date >= wStart && date < wEnd) : (String(date||"").slice(0,4) === String(t0.getFullYear()));
  const usedApproved = (pto||[]).filter(r => r.status === "approved" && inThisYear(r.date))
    .reduce((s,r) => s + ptoDayValue(r), 0);
  const requestedDays = (pto||[]).filter(r => r.status === "requested").reduce((s,r) => s + ptoDayValue(r), 0);
  const selDays = Object.values(sel).reduce((s,v) => s + (v.half ? 0.5 : 1), 0);
  const allow = Number(allowance) || 0;
  const remaining = Math.max(0, allow - usedApproved);

  const first = new Date(calY, calM, 1);
  const monthName = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cells = [];
  for (let i=0; i<first.getDay(); i++) cells.push(null);
  const dim = new Date(calY, calM+1, 0).getDate();
  for (let d=1; d<=dim; d++) cells.push(new Date(calY, calM, d));

  const cycle = (ds) => setSel(s => {
    const cur = s[ds]; const next = { ...s };
    if (!cur) next[ds] = { half:false };
    else if (!cur.half) next[ds] = { half:true };
    else delete next[ds];
    return next;
  });
  const prevM = () => { if (calM===0){ setCalM(11); setCalY(calY-1);} else setCalM(calM-1); };
  const nextM = () => { if (calM===11){ setCalM(0); setCalY(calY+1);} else setCalM(calM+1); };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal pto-modal" onClick={e=>e.stopPropagation()}>
        <div className="pto-head"><h3>{allowPast ? "Enter PTO" : "Request PTO"}</h3><button className="btn btn-ghost" style={{padding:"4px 10px"}} onClick={onClose}>✕</button></div>
        <div className="pto-counter"><strong>{remaining}</strong> of {allow} day{allow===1?"":"s"} left{requestedDays>0 ? <span> · {requestedDays} requested</span> : null}{selDays>0 ? <span> · selecting {selDays}</span> : null}</div>
        <div className="pto-monthnav"><button onClick={prevM} aria-label="Previous month">‹</button><span>{monthName}</span><button onClick={nextM} aria-label="Next month">›</button></div>
        <div className="pto-grid">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><div key={"dow"+i} className="pto-dow">{d[0]}</div>)}
          {cells.map((dt,i) => {
            if (!dt) return <div key={"b"+i} className="pto-cell blank" />;
            const ds = localISO(dt);
            const past = ds < todayStr;
            const ex = byDate[ds];
            const ss = sel[ds];
            // weekends are selectable (several staff work weekend rotations). Past days are
            // locked for self-service requests, but the admin can enter already-taken PTO on
            // someone's behalf (allowPast) — e.g. backfilling days off from earlier.
            const hardLocked = (past && !allowPast) || (ex && ex.status === "approved");
            let cls = "pto-cell";
            if (ex && ex.status==="approved") cls += " approved";
            else if (ex && ex.status==="requested") cls += " requested";
            else if (ss) cls += ss.half ? " sel half" : " sel";
            else if (past && !allowPast) cls += " muted";
            return (
              <div key={ds} className={cls} onClick={()=>{
                if (hardLocked) return;
                if (ex && ex.status === "requested") { onCancel && onCancel(ds); return; }   // tap a yellow day to cancel
                cycle(ds);
              }}>
                {dt.getDate()}{((ss && ss.half) || (ex && ex.half)) ? <span className="half-mark">½</span> : null}
              </div>
            );
          })}
        </div>
        <div className="pto-legend"><span className="lg sel" /> requested&nbsp;&nbsp;&nbsp;<span className="lg approved" /> approved</div>
        <div className="pto-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={selDays===0} onClick={()=>onSubmit(sel)}>Submit{selDays>0 ? " ("+selDays+"d)" : ""}</button>
        </div>
      </div>
    </div>
  );
}

// Admin PTO tab: approve/deny requests (single or batch), overlap flags, enter PTO on someone's behalf.
function PtoAdmin({ employees, allPto, onSetStatus, onAddPto, showToast }) {
  const [addFor, setAddFor] = useState(null);
  const nameOf = (empId) => { const e = employees.find(x => x.id === empId); return e ? lastFirst(e.name) : empId; };
  // salary-only staff don't log pay, but they DO take PTO — include anyone with an allowance
  const sortedEmps = employees.filter(e => !e.salaryOnly || Number(e.ptoDays) > 0).slice().sort((a,b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
  const sm = { padding: "5px 11px", fontSize: 13 };

  // who's off (requested or approved) by date → overlap detection
  const byDate = {};
  for (const r of (allPto || [])) if (r.status === "requested" || r.status === "approved") (byDate[r.date] = byDate[r.date] || []).push(r);
  const overlapsFor = (rec) => (byDate[rec.date] || []).filter(o => o.empId !== rec.empId);

  return (
    <div className="card">
      <h2>Time off</h2>
      <p className="hint">Approve or deny requested PTO — one at a time or all of a person's at once. ⚠ marks days when someone else is also off.</p>

      <div className="emp-section">
        <label>Enter PTO for someone (added as approved)</label>
        <select value="" onChange={e=>{ const emp = employees.find(x=>x.id===e.target.value); if (emp) setAddFor(emp); }} style={{maxWidth:340}}>
          <option value="">Choose an employee…</option>
          {sortedEmps.map(e => <option key={e.id} value={e.id}>{lastFirst(e.name)}</option>)}
        </select>
      </div>
      {addFor && <PtoCalendar pto={allPto.filter(r=>r.empId===addFor.id)} allowance={addFor.ptoDays} startDate={addFor.startDate}
        allowPast={true}
        onClose={()=>setAddFor(null)}
        onSubmit={(sel)=>{ onAddPto(addFor, sel); setAddFor(null); showToast && showToast("PTO added for " + addFor.name); }} />}

      {/* ---- the ENTIRE PTO picture, per employee: allowance, used, pending, remaining,
              and every day (self-requested AND admin-entered) with inline actions ---- */}
      <div className="emp-section">
        <label>PTO by employee</label>
        {(() => {
          const withPto = employees
            .filter(e => Number(e.ptoDays) > 0 || (allPto || []).some(r => r.empId === e.id))
            .sort((a,b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
          if (!withPto.length) return <div className="empty">No PTO allowances or records yet.</div>;
          return withPto.map(e => {
            const recs = (allPto || []).filter(r => r.empId === e.id)
              .slice().sort((a,b) => a.date.localeCompare(b.date));
            // PTO year window: anniversary if a start date is set, else calendar year
            const yStart = ptoYearStartDate(e.startDate);
            const wStart = yStart ? localISO(yStart) : null;
            const wEnd = yStart ? localISO(new Date(yStart.getFullYear()+1, yStart.getMonth(), yStart.getDate())) : null;
            const inYear = (d) => wStart ? (d >= wStart && d < wEnd) : String(d||"").slice(0,4) === todayISO().slice(0,4);
            const used = recs.filter(r => r.status === "approved" && inYear(r.date)).reduce((s,r) => s + ptoDayValue(r), 0);
            const pend = recs.filter(r => r.status === "requested");
            const pendDays = pend.reduce((s,r) => s + ptoDayValue(r), 0);
            const allow = Number(e.ptoDays) || 0;
            const left = Math.max(0, allow - used);
            const pendItems = pend.map(r => ({ _uid: r._uid, id: r.id }));
            return (
              <div className="pto-group" key={"sum"+e.id}>
                <div className="pto-group-head">
                  <strong>{lastFirst(e.name)}</strong>
                  <span className="pto-group-count">
                    {allow > 0 ? `${used} used of ${allow} · ${left} left` : `${used} used (no allowance set)`}
                    {pendDays > 0 ? ` · ${pendDays} pending` : ""}
                  </span>
                  {pend.length > 0 && (
                    <span style={{marginLeft:"auto", whiteSpace:"nowrap"}}>
                      <button className="btn btn-ghost" style={sm} onClick={()=>onSetStatus(pendItems, "approved")}>Approve all</button>
                      <button className="btn btn-danger" style={{...sm, marginLeft:8}} onClick={()=>onSetStatus(pendItems, null)}>Deny all</button>
                    </span>
                  )}
                </div>
                {recs.length === 0 && <div className="pto-req"><span style={{color:"var(--muted)"}}>No days recorded.</span></div>}
                {recs.map(r => {
                  const ov = r.status === "requested" ? overlapsFor(r) : [];
                  const item = r._admin ? { _admin: true, empId: r.empId, id: r.id } : { _uid: r._uid, id: r.id };
                  return (
                    <div className="pto-req" key={r.id}>
                      <span>
                        {fmtShortYr(r.date)}{r.half ? " · ½ day" : ""}
                        <span style={{marginLeft:8, fontSize:12, color: r.status==="requested" ? "var(--amber)" : "var(--muted)"}}>
                          {r.status === "requested" ? "requested" : r._admin ? "approved · admin-entered" : "approved"}
                        </span>
                        {!inYear(r.date) && r.status === "approved" ? <span style={{marginLeft:8, fontSize:12, color:"var(--faint)"}}>(outside current PTO year)</span> : null}
                        {ov.length ? <span className="pto-overlap"> ⚠ also off: {ov.map(o=>nameOf(o.empId)).join(", ")}</span> : null}
                      </span>
                      <span style={{whiteSpace:"nowrap"}}>
                        {r.status === "requested"
                          ? <>
                              <button className="btn btn-ghost" style={sm} onClick={()=>onSetStatus([item], "approved")}>Approve</button>
                              <button className="btn btn-danger" style={{...sm, marginLeft:8}} onClick={()=>onSetStatus([item], null)}>Deny</button>
                            </>
                          : <button className="btn btn-danger" style={sm} onClick={()=>onSetStatus([item], null)}>Remove</button>}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

// The pay tracker for ONE entity (LLC). `eid` is constant for the life of a mount (the shell keys on it),
// so callbacks may close over it freely. Everything below is the HRG app with `eid` threaded into storage.
function EntityApp({ eid, payCfg, authUser, header }) {
  setPeriodModel(payCfg);   // install this LLC's payroll calendar before anything below renders
  const [loaded, setLoaded] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);        // when data was last pulled fresh from the server
  const [tab, setTab] = useState("entry");
  const [employees, setEmployees] = useState([]); // {id,name,rates:{}}
  const [entries, setEntries] = useState([]);     // owner: everyone's (tagged _uid); NP: just theirs
  const [certs, setCerts] = useState({});         // NP's per-period cap certifications {periodIdx:{cap,at}}
  const [salaries, setSalaries] = useState({});   // owner-only annual salaries {empId: annual}
  const [mySalary, setMySalary] = useState(0);    // the signed-in NP's own salary (from their own doc)
  const [adjustments, setAdjustments] = useState({});  // owner-only roll-up overrides {periodIdx:{empId:{...}}}
  const [myAdj, setMyAdj] = useState({});         // the signed-in NP's own bonus/reimbursement by period
  const [pto, setPto] = useState([]);             // the signed-in user's own PTO records
  const [allPto, setAllPto] = useState([]);       // owner: everyone's PTO (for the approval tab)
  const [ptoAdmin, setPtoAdmin] = useState({});   // admin-entered PTO by empId (staff-readable)
  const [impersonate, setImpersonate] = useState(null);       // owner "view as" target employee (or null)
  const [impersonateDoc, setImpersonateDoc] = useState(null); // the entries doc that employee's data lives in
  const [impersonateCerts, setImpersonateCerts] = useState({});
  const [manualLocks, setManualLocks] = useState([]);
  const [manualUnlocks, setManualUnlocks] = useState([]);   // admin force-unlocks that override the auto-lock
  const [toast, setToast] = useState("");

  const isOwner = isOwnerUser(authUser);
  const uid = authUser ? authUser.uid : null;
  // the signed-in NP's own employee record, matched by their real email or internal login email
  const myEmp = (authUser && !isOwner)
    ? employees.find(e => {
        const ae = String(authUser.email||"").toLowerCase();
        return !!ae && String(e.email||"").trim().toLowerCase() === ae;
      })
    : null;
  // PTO shown/counted anywhere = the person's own requests (per-uid doc) + admin-entered
  // days (pay/{eid}/meta/ptoAdmin, keyed by empId — works even if they've never logged in)
  const adminPtoFlat = Object.entries(ptoAdmin || {}).flatMap(([empId, list]) =>
    (Array.isArray(list) ? list : []).map(r => ({ ...r, empId, _admin: true })));
  const allPtoMerged = [...allPto, ...adminPtoFlat];
  const myPtoMerged = [...pto, ...(myEmp ? adminPtoFlat.filter(r => r.empId === myEmp.id) : [])];

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }, []);

  // load the data appropriate to whoever is signed in
  const refreshBusy = useRef(false);
  const refresh = useCallback(async (user) => {
    const u = user || (window._auth && window._auth.currentUser);
    if (!u) { setEmployees([]); setEntries([]); setManualLocks([]); setManualUnlocks([]); return; }
    if (refreshBusy.current) return;   // focus + visibility + heartbeat can stack — one pull at a time
    refreshBusy.current = true;
    try {
      const owner = isOwnerUser(u);
      // fire every read at once (they're independent) — was 8 sequential round-trips
      const [emps, locks, unlocks, entries, certs, salaries, mySalary, adjustments, myAdj, myPto, everyPto, adminPto] = await Promise.all([
        loadVisibleRoster(eid, u.uid),        // owner: full roster; everyone else (incl. managers): own mirror
        sGet(eid, "manualLocks", []),
        sGet(eid, "manualUnlocks", []),
        owner ? loadAllEntries(eid) : loadEntriesForUid(eid, u.uid),
        owner ? Promise.resolve({}) : loadCertsForUid(eid, u.uid),
        owner ? loadSalaries(eid) : Promise.resolve({}),
        owner ? Promise.resolve(0) : loadMySalary(u.uid),
        owner ? loadAdjustments(eid) : Promise.resolve({}),
        owner ? Promise.resolve({}) : loadMyAdj(u.uid),
        loadPto(eid, u.uid),                                  // the user's own PTO (owner has one too)
        (owner || isPtoAdminUid(u.uid)) ? loadAllPto(eid) : Promise.resolve([]),   // owner + PTO approver: everyone's PTO
        loadVisibleAdminPto(eid, u.uid),                      // owner: all admin PTO; NP: own scoped mirror
      ]);
      // only touch state that actually changed — an unchanged pull must not re-render, because
      // browsers close/reset an open <select> (the View-as picker) when its options are rebuilt
      const setIfChanged = (setter, next) => setter(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setIfChanged(setEmployees, emps && emps.length ? emps : []);
      setIfChanged(setManualLocks, Array.isArray(locks) ? locks : []);
      setIfChanged(setManualUnlocks, Array.isArray(unlocks) ? unlocks : []);
      setIfChanged(setEntries, entries);
      setIfChanged(setCerts, certs);
      setIfChanged(setSalaries, salaries);
      setMySalary(mySalary);
      setIfChanged(setAdjustments, adjustments);
      setIfChanged(setMyAdj, myAdj);
      setIfChanged(setPto, Array.isArray(myPto) ? myPto : []);
      setIfChanged(setAllPto, Array.isArray(everyPto) ? everyPto : []);
      setIfChanged(setPtoAdmin, adminPto && typeof adminPto === "object" ? adminPto : {});
      setSyncedAt(new Date());     // mark data as freshly pulled
    } finally { refreshBusy.current = false; }
  }, [eid]);

  // first load for this entity (the shell owns auth; another entity = a fresh EntityApp via key)
  useEffect(() => {
    let dead = false;
    refresh(authUser).then(() => { if (!dead) setLoaded(true); });
    return () => { dead = true; };
  }, [refresh, authUser]);

  // keep data live: re-pull on focus, on tab-visible, and on a 60s heartbeat (so a left-open
  // payroll tab is never stale). Reads always hit the server, so each pull is the latest.
  useEffect(() => {
    const pull = () => { if (window._auth && window._auth.currentUser && !document.hidden) refresh(); };
    const onVis = () => { if (!document.hidden) pull(); };
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(pull, 60000);
    return () => { window.removeEventListener("focus", pull); document.removeEventListener("visibilitychange", onVis); clearInterval(id); };
  }, [refresh]);

  // LIVE roster: subscribe to the employee list in real time, so an owner's "Entered by" assignment
  // (and any rate/name change) shows up on the manager's / everyone's screen instantly — no waiting
  // for a refresh. The Rates editor's dirty-guard means this won't clobber an in-progress owner edit.
  useEffect(() => {
    if (!uid || !isOwner || !window._fs || !window._fs.onSnapshot) return;   // owner-only: NPs can't read the shared roster
    const ref = window._fs.doc(window._db, "pay", eid, "meta", "employees");
    const unsub = window._fs.onSnapshot(ref, (snap) => {
      const v = snap.exists() && snap.data() ? snap.data().value : [];
      const next = Array.isArray(v) ? v : [];
      // skip no-op snapshots (cache→server echoes) so an open View-as picker isn't reset
      setEmployees(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, () => {});   // on listener error, the 60s heartbeat still covers it
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [uid]);

  // Identity registry: every signed-in staffer stamps their empId into their OWN entries
  // doc (merge write, once per session). This is the empId→auth-uid map that makes salary/
  // bonus mirrors and View-as reach people who never log a pay entry (no-pay-type staff).
  const stampedRef = useRef(false);
  useEffect(() => {
    if (!uid || isOwner || !myEmp || stampedRef.current) return;
    stampedRef.current = true;
    try {
      window._fs.setDoc(window._fs.doc(window._db, "pay", eid, "entries", uid),
        { empId: myEmp.id, username: normU(myEmp.username) }, { merge: true }).catch(() => {});
    } catch (e) {}
  }, [uid, isOwner, myEmp && myEmp.id]);

  // Self-healing mirrors (owner, once per session): re-push salary + bonus/reimb mirrors
  // wherever a uid is known — covers staff who registered AFTER the last roster save
  // (their mirror was unreachable then, e.g. Base showed $0 until the next owner save).
  const healedRef = useRef(false);
  useEffect(() => {
    if (!isOwner || healedRef.current) return;
    if (!entries.length && !Object.keys(salaries || {}).length) return;   // wait for the data pull
    healedRef.current = true;
    // a PTO request also reveals someone's uid (their pto doc is uid-keyed) — lets the heal
    // reach people whose first-ever write was a PTO request, before they've stamped a marker
    const uidOf = (empId) => {
      const viaReg = resolveUidForEmp(eid, empId, entries);
      if (viaReg && !String(viaReg).startsWith("emp_")) return viaReg;
      const viaPto = (allPto.find(r => r.empId === empId && r._uid && !String(r._uid).startsWith("emp_")) || {})._uid;
      return viaPto || null;
    };
    (async () => {
      for (const [empId, annual] of Object.entries(salaries || {})) {
        const docId = uidOf(empId);
        if (docId) await saveMySalary(eid, docId, annual);
      }
      const byEmp = {};
      for (const [pIdx, perEmp] of Object.entries(adjustments || {}))
        for (const [empId, a] of Object.entries(perEmp || {})) {
          const m = { bonus: Number(a.bonus)||0, reimbursement: Number(a.reimbursement)||0 };
          // per-period stipend OVERRIDE — mirror it only when the adjustment actually carries one.
          // Absence means "fall back to the recurring computed stipend", so never default this to 0:
          // that would wipe the computed stipend from the breakdown of anyone with a bonus/reimb.
          if (a.stipend != null && a.stipend !== "") m.stipend = Number(a.stipend)||0;
          (byEmp[empId] = byEmp[empId] || {})[pIdx] = m;
        }
      for (const [empId, perPeriod] of Object.entries(byEmp)) {
        const docId = uidOf(empId);
        if (docId) await saveMyAdj(eid, docId, perPeriod);
      }
      // roster/PTO mirrors: give everyone their own scoped view so NPs need not read the shared docs
      for (const e of (employees || [])) {
        const docId = uidOf(e.id);
        if (docId) await saveMyMirror(eid, docId, scopedRosterFor(e, employees, isPtoAdminUid(docId)), scopedAdminPtoFor(e, employees, ptoAdmin, isPtoAdminUid(docId)), !!e.isManager);
      }
    })().catch(() => {});
  }, [isOwner, entries, salaries, adjustments, allPto, employees, ptoAdmin]);

  const persistEmployees = useCallback(async (next) => {
    setEmployees(next);
    await sSet(eid, "employees", next);
    // re-push each person's scoped roster/PTO mirror so their own view reflects the edit
    for (const e of next) {
      const docId = resolveUidForEmp(eid, e.id, entries);
      if (docId && !String(docId).startsWith("emp_"))
        await saveMyMirror(eid, docId, scopedRosterFor(e, next, isPtoAdminUid(docId)), scopedAdminPtoFor(e, next, ptoAdmin, isPtoAdminUid(docId)), !!e.isManager);
    }
  }, [entries, ptoAdmin]);
  // mirrors only go to REAL login docs (never legacy emp_-keyed docs staff can't read)
  const mirrorTarget = useCallback((empId) => {
    const docId = resolveUidForEmp(eid, empId, entries);
    return docId && !String(docId).startsWith("emp_") ? docId : null;
  }, [entries]);
  const persistSalaries = useCallback(async (map) => {
    setSalaries(map);
    await saveSalaries(eid, map);
    // mirror each person's own salary into their own entries doc so they can see their Base
    for (const [empId, annual] of Object.entries(map)) {
      const docId = mirrorTarget(empId);
      if (docId) await saveMySalary(eid, docId, annual);
    }
  }, [mirrorTarget]);
  const persistAdjustments = useCallback(async (map) => {
    setAdjustments(map);
    await saveAdjustments(eid, map);
    // mirror each person's own bonus/reimbursement into their doc so they see it in their breakdown
    const byEmp = {};   // {empId: {periodIdx: {bonus, reimbursement, stipend?}}}
    for (const [pIdx, perEmp] of Object.entries(map || {}))
      for (const [empId, a] of Object.entries(perEmp || {})) {
        const m = { bonus: Number(a.bonus)||0, reimbursement: Number(a.reimbursement)||0 };
        // per-period stipend OVERRIDE — mirror it only when the adjustment actually carries one.
        // Absence means "fall back to the recurring computed stipend", so never default this to 0:
        // that would wipe the computed stipend from the breakdown of anyone with a bonus/reimb.
        if (a.stipend != null && a.stipend !== "") m.stipend = Number(a.stipend)||0;
        (byEmp[empId] = byEmp[empId] || {})[pIdx] = m;
      }
    for (const [empId, perPeriod] of Object.entries(byEmp)) {
      const docId = mirrorTarget(empId);
      if (docId) await saveMyAdj(eid, docId, perPeriod);
    }
  }, [mirrorTarget]);
  // owner or the delegated PTO approver approves (status→approved) or denies (removes) PTO requests.
  // items = [{_uid, id}] for self-requested records, [{_admin:true, empId, id}] for admin-entered.
  const setPtoStatus = useCallback(async (items, newStatus) => {
    const adminItems = items.filter(it => it._admin);
    const regItems = items.filter(it => !it._admin);
    const byUid = {};
    for (const it of regItems) (byUid[it._uid] = byUid[it._uid] || []).push(it.id);
    const now = new Date().toISOString();
    // audit: with approval delegated, record WHO acted (email of the signed-in approver)
    const whoBy = String((window._auth && window._auth.currentUser && window._auth.currentUser.email) || "admin").toLowerCase();
    const approvedRecs = [];   // (empId, date) of newly approved — to dedupe vs admin-entered
    for (const [docId, ids] of Object.entries(byUid)) {
      const latest = await loadPto(eid, docId);
      const next = newStatus === null
        ? latest.filter(r => !ids.includes(r.id))                                                   // deny = remove
        : latest.map(r => ids.includes(r.id) ? { ...r, status: newStatus, approvedAt: now, approvedBy: whoBy } : r);   // approve
      if (newStatus === "approved") approvedRecs.push(...latest.filter(r => ids.includes(r.id)));
      await savePto(eid, docId, next);
    }
    // admin-entered records can only be removed (they're born approved)
    if (adminItems.length || approvedRecs.length) {
      const map = await loadPtoAdmin(eid);
      for (const it of adminItems)
        map[it.empId] = (map[it.empId] || []).filter(r => r.id !== it.id);
      // if a self-request just got approved for a day the admin had also entered, drop the
      // admin copy so the day isn't counted twice
      for (const r of approvedRecs)
        if (map[r.empId]) map[r.empId] = map[r.empId].filter(a => a.date !== r.date);
      for (const k of Object.keys(map)) if (!map[k] || !map[k].length) delete map[k];
      await savePtoAdmin(eid, map);
      setPtoAdmin(await loadPtoAdmin(eid));
    }
    setAllPto(await loadAllPto(eid));
  }, []);
  // owner enters PTO for someone (added directly as approved) — goes to the admin-entered
  // doc keyed by EMPLOYEE id, so it works whether or not the person has ever logged in and
  // is readable by them the moment they do.
  const addPtoForEmployee = useCallback(async (emp, sel) => {
    if (!emp) return;
    const now = new Date().toISOString();
    const map = await loadPtoAdmin(eid);
    const list = Array.isArray(map[emp.id]) ? map[emp.id] : [];
    // dedupe against both stores: their own requests/approvals AND prior admin entries
    const taken = new Set([...list.map(r => r.date),
                           ...allPto.filter(r => r.empId === emp.id).map(r => r.date)]);
    const fresh = Object.entries(sel || {})
      .filter(([date]) => !taken.has(date))
      .map(([date, v]) => ({ id: "pto_" + date + "_" + Math.random().toString(36).slice(2,6), empId: emp.id, date, half: !!(v && v.half), status: "approved", approvedAt: now,
        by: String((window._auth && window._auth.currentUser && window._auth.currentUser.email) || "admin").toLowerCase() }));
    if (!fresh.length) return;
    map[emp.id] = [...list, ...fresh];
    await savePtoAdmin(eid, map);
    setPtoAdmin(await loadPtoAdmin(eid));
  }, [allPto]);
  // admin sets a period's lock state explicitly. shouldLock=true → force-locked; false → force-unlocked
  // (overrides the 72h auto-lock). The two lists are kept mutually exclusive.
  const setPeriodLock = useCallback(async (periodIndex, shouldLock) => {
    const curLocks = new Set((await sGet(eid, "manualLocks", [])) || []);
    const curUnlocks = new Set((await sGet(eid, "manualUnlocks", [])) || []);
    if (shouldLock) { curLocks.add(periodIndex); curUnlocks.delete(periodIndex); }
    else { curUnlocks.add(periodIndex); curLocks.delete(periodIndex); }
    const nextLocks = [...curLocks], nextUnlocks = [...curUnlocks];
    setManualLocks(nextLocks); setManualUnlocks(nextUnlocks);
    await sSet(eid, "manualLocks", nextLocks);
    await sSet(eid, "manualUnlocks", nextUnlocks);
  }, []);

  // NP upsert: one row per (empId,date) inside this NP's own entries doc.
  // Returns {saved} — callers MUST surface saved:false (a rejected write must never
  // look like "✓ Saved"; that's silent payroll loss).
  const upsertEntry = useCallback(async (entry) => {
    if (!uid) return { saved: false };
    const latest = await loadEntriesForUid(eid, uid);
    const rest = latest.filter(e => !(e.empId === entry.empId && e.date === entry.date));
    const hasCounts = entry.counts && Object.values(entry.counts).some(v => Number(v) > 0);
    const hasOther = entry.other && Number(entry.other.amount) > 0;
    const hasAny = hasCounts || hasOther;
    const next = hasAny ? [...rest, entry] : rest;
    const ok = await saveEntriesForUid(eid, uid, next);
    if (ok) setEntries(next);
    return { saved: ok, hasAny };
  }, [uid]);

  // capped NP certifies they've met their cap for a given pay period (records the cap value + time)
  const certifyPeriod = useCallback(async (periodIdx, cap) => {
    if (!uid) return;
    const at = new Date().toISOString();
    setCerts(c => ({ ...c, [String(periodIdx)]: { cap, at } }));
    await saveCertForUid(eid, uid, periodIdx, cap, at);
  }, [uid]);
  // user submits a batch of requested PTO dates (sel = { "YYYY-MM-DD": {half} })
  const requestPto = useCallback(async (sel) => {
    if (!uid) return;
    const empId = (myEmp && myEmp.id) || null;
    const now = new Date().toISOString();
    const latest = await loadPto(eid, uid);
    const taken = new Set(latest.map(r => r.date));
    const fresh = Object.entries(sel || {})
      .filter(([date]) => !taken.has(date))
      .map(([date, v]) => ({ id: "pto_" + date + "_" + Math.random().toString(36).slice(2,6), empId, date, half: !!(v && v.half), status: "requested", requestedAt: now }));
    if (!fresh.length) return true;
    const merged = [...latest, ...fresh];
    const ok = await savePto(eid, uid, merged);   // only reflect a request the server actually took
    if (ok) setPto(merged);
    return ok;
  }, [uid, myEmp]);
  // cancel a still-pending (requested) PTO date by tapping it again
  const cancelPto = useCallback(async (date) => {
    if (!uid) return;
    const latest = await loadPto(eid, uid);
    const next = latest.filter(r => !(r.date === date && r.status === "requested"));
    if (next.length === latest.length) return;   // nothing to cancel (approved dates are protected)
    setPto(next);
    await savePto(eid, uid, next);
  }, [uid]);

  // owner "view as employee": find which entries doc their data lives in (their own uid, the manager's
  // doc for managed staff, or their empId as a fallback) and load their certs so the view matches theirs.
  const startImpersonate = useCallback(async (emp) => {
    if (!emp) return;
    let docId;
    if (emp.isManager) {
      // a manager's entries live in HER own uid doc, tagged with each managed staffer's empId
      const managedIds = new Set(employees.filter(e => e.managedBy === emp.id).map(e => e.id));
      docId = (entries.find(e => managedIds.has(e.empId)) || {})._uid || resolveUidForEmp(eid, emp.id, entries) || emp.id;
    } else {
      docId = resolveUidForEmp(eid, emp.id, entries) || emp.id;
    }
    setImpersonateDoc(docId);
    setImpersonateCerts({});
    setImpersonate(emp);            // show their page immediately — don't block on the certs read
    try { window.scrollTo(0, 0); } catch (e) {}
    // certs only affect the cap-cert banner (audit mode bypasses the gate), so they can fill in late
    loadCertsForUid(eid, docId).then(setImpersonateCerts).catch(() => {});
  }, [entries, employees]);
  const exitImpersonate = useCallback(() => { setImpersonate(null); setImpersonateDoc(null); setImpersonateCerts({}); }, []);
  // owner edits on an employee's behalf — writes to THEIR entries doc (rules allow it: isOwner)
  const upsertForImpersonated = useCallback(async (entry) => {
    const docId = impersonateDoc || (impersonate && impersonate.id);
    if (!docId) return { saved: false };
    const latest = await loadEntriesForUid(eid, docId);
    const rest = latest.filter(e => !(e.empId === entry.empId && e.date === entry.date));
    const hasCounts = entry.counts && Object.values(entry.counts).some(v => Number(v) > 0);
    const hasOther = entry.other && Number(entry.other.amount) > 0;
    const hasAny = hasCounts || hasOther;
    const next = hasAny ? [...rest, entry] : rest;
    const ok = await saveEntriesForUid(eid, docId, next);
    if (ok) setEntries(await loadAllEntries(eid));
    return { saved: ok, hasAny };
  }, [impersonate, impersonateDoc]);
  const certifyForImpersonated = useCallback(async (periodIdx, cap) => {
    const docId = impersonateDoc || (impersonate && impersonate.id);
    if (!docId) return;
    const at = new Date().toISOString();
    setImpersonateCerts(c => ({ ...c, [String(periodIdx)]: { cap, at } }));
    await saveCertForUid(eid, docId, periodIdx, cap, at);
  }, [impersonate, impersonateDoc]);
  // owner requests PTO on a staffer's behalf (View-as) — writes to THEIR pto doc
  const requestPtoForImpersonated = useCallback(async (sel) => {
    const docId = impersonateDoc;
    if (!docId || !impersonate) return;
    const now = new Date().toISOString();
    const latest = await loadPto(eid, docId);
    const taken = new Set(latest.map(r => r.date));
    const fresh = Object.entries(sel || {})
      .filter(([date]) => !taken.has(date))
      .map(([date, v]) => ({ id: "pto_" + date + "_" + Math.random().toString(36).slice(2,6), empId: impersonate.id, date, half: !!(v && v.half), status: "requested", requestedAt: now, by: "admin" }));
    if (!fresh.length) return;
    await savePto(eid, docId, [...latest, ...fresh]);
    setAllPto(await loadAllPto(eid));
  }, [impersonate, impersonateDoc]);
  const cancelPtoForImpersonated = useCallback(async (date) => {
    const docId = impersonateDoc;
    if (!docId) return;
    const latest = await loadPto(eid, docId);
    const next = latest.filter(r => !(r.date === date && r.status === "requested"));
    if (next.length === latest.length) return;
    await savePto(eid, docId, next);
    setAllPto(await loadAllPto(eid));
  }, [impersonate, impersonateDoc]);

  // owner deletes an entry from whichever NP doc it came from (tagged _uid on merge)
  const deleteOwnerEntry = useCallback(async (entry) => {
    if (!entry || !entry._uid) return;
    const latest = await loadEntriesForUid(eid, entry._uid);
    await saveEntriesForUid(eid, entry._uid, latest.filter(e => e.id !== entry.id));
    setEntries(await loadAllEntries(eid));
  }, []);

  if (!loaded) return <div className="wrap">{header}<div className="empty">Loading…</div></div>;

  return (
    <div className={"wrap" + (isOwner && !impersonate ? " wide" : "")}>
      {header}

      {/* owner "view as" → that employee's dashboard, editable, with a return bar */}
      {isOwner && impersonate && (
        <>
          <div className="impersonate-bar">
            <span>👁 Viewing as <strong>{lastFirst(impersonate.name)}</strong>{impersonate.isManager ? " (office manager) — their staff page" : " — edits save to their record (audit)."}</span>
            <button className="btn" onClick={exitImpersonate}>Exit view</button>
          </div>
          {impersonate.isManager
            ? <ManagerView key={impersonate.id} manager={impersonate} employees={employees} entries={entries}
                upsertEntry={upsertForImpersonated} manualLocks={manualLocks} manualUnlocks={manualUnlocks} showToast={showToast} />
            : <EntryView key={impersonate.id} emp={impersonate} entries={entries} upsertEntry={upsertForImpersonated}
                certs={impersonateCerts} certifyPeriod={certifyForImpersonated} manualLocks={manualLocks} manualUnlocks={manualUnlocks}
                audit={true} baseSalary={salaries[impersonate.id]}
                empAdj={(() => { const o = {}; for (const [p, byEmp] of Object.entries(adjustments||{})) if (byEmp && byEmp[impersonate.id]) o[p] = byEmp[impersonate.id]; return o; })()}
                pto={allPtoMerged.filter(r => r.empId === impersonate.id)} ptoAllowance={impersonate.ptoDays} ptoStartDate={impersonate.startDate}
                onRequestPto={ptoEligible(impersonate) ? requestPtoForImpersonated : undefined}
                onCancelPto={ptoEligible(impersonate) ? cancelPtoForImpersonated : undefined}
                showToast={showToast} />}
        </>
      )}

      {/* signed in as owner → full panel */}
      {isOwner && !impersonate && (
        <OwnerView employees={employees} entries={entries} salaries={salaries} adjustments={adjustments} manualLocks={manualLocks} manualUnlocks={manualUnlocks} setPeriodLock={setPeriodLock}
          persistEmployees={persistEmployees} persistSalaries={persistSalaries} persistAdjustments={persistAdjustments} deleteEntry={deleteOwnerEntry}
          allPto={allPtoMerged} onSetPtoStatus={setPtoStatus} onAddPto={addPtoForEmployee}
          onViewAs={startImpersonate} syncedAt={syncedAt} onRefresh={refresh} showToast={showToast} />
      )}

      {/* signed in as staff/manager → scoped entry screen. The delegated PTO approver
          additionally gets a "Time off" tab = the same PtoAdmin panel the owner uses
          (her mirror roster carries everyone, PTO fields only — rules enforce the rest). */}
      {authUser && !isOwner && (
        !myEmp
          ? <div className="card"><div className="empty">You're signed in, but your account isn't in the roster yet. Ask the owner to add your email in Employees &amp; rates, then sign out and back in.</div></div>
          : <>
              {isPtoAdminUid(uid) && (
                <div className="tabs">
                  <button className={"tab"+(tab!=="pto"?" active":"")} onClick={()=>setTab("entry")}>My pay</button>
                  <button className={"tab"+(tab==="pto"?" active":"")} onClick={()=>setTab("pto")}>Time off{(() => { const n = allPtoMerged.filter(r=>r.status==="requested").length; return n ? " (" + n + ")" : ""; })()}</button>
                </div>
              )}
              {isPtoAdminUid(uid) && tab==="pto"
                ? <PtoAdmin employees={employees} allPto={allPtoMerged} onSetStatus={setPtoStatus} onAddPto={addPtoForEmployee} showToast={showToast} />
                : myEmp.isManager
                  ? <ManagerView manager={myEmp} employees={employees} entries={entries} upsertEntry={upsertEntry} manualLocks={manualLocks} manualUnlocks={manualUnlocks} showToast={showToast} />
                  : myEmp.managedBy
                    ? <div className="card"><div className="empty">Your hours are entered for you — there's nothing to log here. Reach out to the office if something looks off.</div></div>
                    : <EntryView emp={myEmp} entries={entries} upsertEntry={upsertEntry} certs={certs} certifyPeriod={certifyPeriod} manualLocks={manualLocks} manualUnlocks={manualUnlocks} baseSalary={mySalary} empAdj={myAdj}
                        pto={myPtoMerged} ptoAllowance={myEmp && myEmp.ptoDays} ptoStartDate={myEmp && myEmp.startDate}
                        onRequestPto={ptoEligible(myEmp) ? requestPto : undefined}
                        onCancelPto={ptoEligible(myEmp) ? cancelPto : undefined}
                        showToast={showToast} />}
            </>
      )}

      <div className={"toast"+(toast?" show":"")}>{toast}</div>
    </div>
  );
}


/* ---------- entity shell ----------
   One Firebase project, one login, N LLCs. The shell owns auth and the entity list, and renders the
   unchanged pay tracker (EntityApp) for ONE entity at a time. Owner: a tab per active entity.
   Staff: only the entities whose roster mirror names them (pay/{eid}/entries/{uid}.roster — written
   by the owner's self-heal / backfill-mirrors, readable only by that person). */
async function loadEntities() {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "plexus", "entities"));
    const v = snap.exists() && snap.data() && snap.data().value;
    return (v && typeof v === "object") ? v : {};
  } catch (e) { console.error("entities read failed", e); return {}; }
}
async function loadPayConfig(eid) {
  const v = await sGet(eid, "config", null);
  return (v && typeof v === "object") ? v : DEFAULT_PAY_CFG;
}
// staff: which entities list me? my own entries doc is readable; its roster mirror is non-empty iff I'm on that roster
async function probeMyEntities(uid, eids) {
  const hits = await Promise.all(eids.map(async (eid) => {
    const r = await loadMyRoster(eid, uid);
    return Array.isArray(r) && r.length ? eid : null;
  }));
  return hits.filter(Boolean);
}
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 120 120" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round">
        <path d="M32 32 60 60M88 32 60 60M32 88 60 60M88 88 60 60" />
      </g>
      <g fill="currentColor">
        <circle cx="32" cy="32" r="8.5" /><circle cx="88" cy="32" r="8.5" />
        <circle cx="32" cy="88" r="8.5" /><circle cx="88" cy="88" r="8.5" />
      </g>
      <circle cx="60" cy="60" r="12" fill="var(--fx, currentColor)" />
    </svg>
  );
}
function App() {
  const [authUser, setAuthUser] = useState(undefined);   // undefined=checking, null=signed out, object=signed in
  const [entities, setEntities] = useState(null);         // {eid: {name, kind, active}}
  const [payCfgs, setPayCfgs] = useState({});             // {eid: payroll-calendar config}
  const [eids, setEids] = useState(null);                 // entities this account may open (display order)
  const [eid, setEid] = useState(null);
  const [toast, setToast] = useState("");
  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); }, []);

  useEffect(() => {
    if (!window._auth || !window._authfns) { setAuthUser(null); return; }
    return window._authfns.onAuthStateChanged(window._auth, (u) => setAuthUser(u || null));
  }, []);

  // after sign-in: entity list → which ones this account may open → each one's payroll calendar
  useEffect(() => {
    if (!authUser) { setEntities(null); setEids(null); setEid(null); return; }
    let dead = false;
    (async () => {
      const ents = await loadEntities();
      const active = Object.entries(ents).filter(([, e]) => e && e.active !== false).map(([id]) => id).sort();
      const mine = isOwnerUser(authUser) ? active : await probeMyEntities(authUser.uid, active);
      const cfgs = {};
      await Promise.all(mine.map(async (id) => { cfgs[id] = await loadPayConfig(id); }));
      if (dead) return;
      setEntities(ents); setPayCfgs(cfgs); setEids(mine);
      setEid(prev => (prev && mine.includes(prev)) ? prev : (mine[0] || null));
    })();
    return () => { dead = true; };
  }, [authUser]);

  const signOutNow = useCallback(async () => {
    try { await window._authfns.signOut(window._auth); } catch (e) {}
    // hard, cache-busted reload so signing back in always lands on the latest deployed build
    // (a unique query bypasses GitHub Pages' ~10-min HTML cache). Falls back to a plain reload.
    try { window.location.replace(window.location.pathname + "?v=" + Date.now()); }
    catch (e) { try { window.location.reload(); } catch (e2) { showToast("Signed out"); } }
  }, [showToast]);

  const entityName = (id) => (entities && entities[id] && entities[id].name) || id;
  const header = (
    <>
      <div className="brand-header">
        <BrandMark />
        <div className="brand-word"><span className="brand-name">PLEXUS</span><span className="brand-sub">MANAGEMENT GROUP</span></div>
      </div>
      {authUser && (
        <div className="topbar">
          <h1>Pay Tracker{eid && eids && eids.length === 1 ? <span className="topbar-entity"> · {entityName(eid)}</span> : null}</h1>
          <button className="btn btn-ghost" style={{fontSize:13, padding:"6px 12px"}} onClick={signOutNow}>Sign out</button>
        </div>
      )}
      {authUser && eids && eids.length > 1 && (
        <div className="tabs entity-tabs" role="tablist" aria-label="Entity">
          {eids.map(id => <button key={id} role="tab" aria-selected={id === eid} className={"tab" + (id === eid ? " active" : "")} onClick={() => setEid(id)}>{entityName(id)}</button>)}
        </div>
      )}
    </>
  );
  const toastEl = <div className={"toast"+(toast?" show":"")}>{toast}</div>;

  if (authUser === undefined) return <div className="wrap">{header}<div className="empty">Loading…</div></div>;
  if (!authUser) return <div className="wrap">{header}<LoginScreen showToast={showToast} />{toastEl}</div>;
  if (!eids) return <div className="wrap">{header}<div className="empty">Loading…</div></div>;
  if (!eids.length) return (
    <div className="wrap">{header}
      <div className="card"><div className="empty">You're signed in, but your account isn't on any roster yet. Ask the owner to add your email in Employees &amp; rates, then sign out and back in.</div></div>
      {toastEl}
    </div>
  );
  return <EntityApp key={eid} eid={eid} payCfg={payCfgs[eid]} authUser={authUser} header={header} />;
}

/* ---------- login (email + password for everyone) ---------- */
function LoginScreen({ showToast }) {
  return (
    <div className="card lock-screen">
      <EmailLogin showToast={showToast} />
    </div>
  );
}

// Unified login (2026-07-27): everyone signs in with their email + password; the app routes
// owner vs. staff after sign-in via isOwnerUser. No username→email directory exists, so no
// staff emails are exposed publicly. New logins are created admin-side (signup is disabled);
// first access is via "Forgot password", which mails a reset link to the real email.
function EmailLogin({ showToast }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    if (e) e.preventDefault();
    setErr("");
    const em = String(email||"").trim().toLowerCase();
    if (!em || !em.includes("@")) { setErr("Enter the email your account is set up with."); return; }
    setBusy(true);
    try { await window._authfns.signInWithEmailAndPassword(window._auth, em, pw); }
    catch (ex) { setErr("Wrong email or password. New here? Use “Forgot password” or ask the admin."); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setErr("");
    const em = String(email||"").trim().toLowerCase();
    if (!em || !em.includes("@")) { setErr("Enter your email first, then tap “Forgot password”."); return; }
    setBusy(true);
    try { await window._authfns.sendPasswordResetEmail(window._auth, em); showToast("If that email has an account, a reset link is on its way."); }
    catch (ex) { setErr("Couldn’t send a reset link. Check the email or ask the admin."); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit}>
      <h2>Sign in</h2>
      <p className="hint">Enter your email and password. Your browser can save these.</p>
      <label>Email</label>
      <input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
      <div style={{height:12}} />
      <label>Password</label>
      <input type="password" autoComplete="current-password" value={pw} onChange={e=>setPw(e.target.value)} />
      {err && <div className="fixed-note" style={{color:"var(--danger)", marginTop:8}}>{err}</div>}
      <div style={{height:14}} />
      <button type="submit" className="btn btn-primary" style={{width:"100%"}} disabled={busy}>{busy?"Signing in…":"Sign in"}</button>
      <div style={{height:8}} />
      <button type="button" className="btn btn-ghost" style={{width:"100%", fontSize:13}} onClick={reset} disabled={busy}>Forgot password?</button>
    </form>
  );
}
/* ---------- entry view ---------- */
function EntryView({ emp, entries, upsertEntry, certs, certifyPeriod, manualLocks, manualUnlocks, showToast, audit, baseSalary, empAdj, pto, ptoAllowance, ptoStartDate, onRequestPto, onCancelPto }) {
  const [ptoOpen, setPtoOpen] = useState(false);
  const ptoEnabled = !!onRequestPto;   // only passed for the staff member's own screen, gated to test users
  const approvedPto = (pto || []).filter(r => r.status === "approved" && r.date >= todayISO())
    .sort((a,b) => a.date.localeCompare(b.date));
  const requestedPto = (pto || []).filter(r => r.status === "requested" && r.date >= todayISO())
    .sort((a,b) => a.date.localeCompare(b.date));
  const ptoFmt = (list) => list.map(r => fmtShort(r.date) + (r.half ? " ½" : "")).join(", ");
  const [date, setDate] = useState(todayISO());
  const [counts, setCounts] = useState({});
  const [shift, setShift] = useState("regular");     // capped NPs: "regular" (cap applies) vs "extra" (no cap)
  const [periodIdx, setPeriodIdx] = useState(currentPeriodIndex());
  const [otherOn, setOtherOn] = useState(false);     // "Other" one-off pay for the selected day
  const [otherAmt, setOtherAmt] = useState("");
  const [otherNote, setOtherNote] = useState("");
  const [entryDirty, setEntryDirty] = useState(false);   // unsaved edits on the selected day
  const [entrySaving, setEntrySaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);   // last save REJECTED — never show "Saved"
  const entryDirtyRef = useRef(false);
  const markEntryDirty = () => { entryDirtyRef.current = true; setEntryDirty(true); };
  const clearEntryDirty = () => { entryDirtyRef.current = false; setEntryDirty(false); };

  // is the chosen date inside a period that's already locked?
  const dateLocked = date ? dateInLockedPeriod(date, manualLocks, manualUnlocks) : false;

  // ----- pay-period grid -----
  const maxPeriodIdx = currentPeriodIndex();                // can't advance into a future (un-happened) period
  const period = periodByIndex(periodIdx);
  const periodDays = periodDayList(period);                           // every day of the period (14 biweekly, 28–31 monthly)
  const leadBlanks = parseDate(period.start).getDay();                // monthly periods start mid-week — pad so columns stay Sun–Sat
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // this employee's saved rows for an ISO day (legacy data may hold >1), and their dollar value
  const dayEntries = (iso) => (emp ? entries.filter(e => e.empId === emp.id && e.date === iso) : []);
  const dayDollars = (iso) => dayEntries(iso).reduce((s,e) => s + payForEntry(emp, e), 0);
  const periodDollars = periodDays.reduce((s,iso) => s + dayDollars(iso), 0);

  // patient-cap certification: capped NPs must certify once per pay period before logging.
  // The cert records the cap value it was signed at, so changing the cap re-prompts.
  const cap = Number(emp && emp.patientCap) || 0;
  const capped = cap > 0;
  const cert = certs && certs[String(periodIdx)];
  const certifiedForPeriod = !capped || (cert && Number(cert.cap) === cap);
  const onExtraShift = capped && shift === "extra";   // extra shifts aren't cap-covered → no cert gate
  const gateOpen = certifiedForPeriod || onExtraShift || !!audit;   // owner audit ("view as") edits past the cap gate
  const basePr = proratedBase(baseSalary, period, emp);   // shown when known (owner view-as / NP own); prorated by start / last day
  const basePeriod = basePr.base;
  const baseProrated = basePr.days > 0 && basePr.days < basePr.of;
  const periodAdj = (empAdj && empAdj[String(periodIdx)]) || {};   // this period's bonus / reimbursement
  const periodBonus = Number(periodAdj.bonus) || 0;
  const periodReimb = Number(periodAdj.reimbursement) || 0;
  // per-period stipend: an owner override for this period wins, else the recurring roster stipend
  const periodStipend = (periodAdj.stipend != null && periodAdj.stipend !== "") ? (Number(periodAdj.stipend) || 0) : (emp ? stipendFor(emp, period) : 0);
  const periodLabel = fmtShortYr(period.start) + " – " + fmtShortYr(period.end);

  // when navigating to another period, pull the selected day into that period
  useEffect(() => {
    if (periodIndexFor(date) !== periodIdx) setDate(period.start);
  }, [periodIdx]);

  // load the selected day's saved counts (merging any legacy duplicate rows) whenever the
  // day or the verified employee changes — so tapping a day shows what's there to edit
  useEffect(() => {
    if (!emp) return;
    const es = dayEntries(date);
    const merged = {};
    es.forEach(e => Object.entries(e.counts || {}).forEach(([k,v]) => {
      merged[k] = (merged[k] || 0) + Number(v || 0);
    }));
    setCounts(merged);
    const withShift = es.find(e => e.shift);
    setShift(withShift && withShift.shift === "extra" ? "extra" : "regular");   // default regular
    const withOther = es.find(e => e.other && Number(e.other.amount) > 0);
    if (withOther) { setOtherOn(true); setOtherAmt(String(withOther.other.amount)); setOtherNote(withOther.other.note || ""); }
    else { setOtherOn(false); setOtherAmt(""); setOtherNote(""); }
    clearEntryDirty();   // freshly loaded day = no unsaved edits
  }, [date, emp && emp.id]);

  const visibleTypes = emp ? ALL_TYPES.filter(t => {
    if (isFixed(t.key)) return !!emp.fixedEligible;
    const r = emp.rates?.[t.key];
    return r != null && Number(r) > 0;
  }) : [];
  // salary-only view: no counted pay types (and no Other entry) = nothing to log day-to-day.
  // Hide the logging UI entirely — show pay breakdown, payday, and PTO only.
  const noPayTypes = !!emp && visibleTypes.length === 0 && !OTHER_ENABLED;

  // typing: keep the raw text so the field can be emptied and hold decimals (e.g. "7.5") while editing
  const typeCount = (key, raw) => {
    if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;   // digits + at most one decimal point
    if (raw !== "" && QTY_MAX[key] != null && Number(raw) > QTY_MAX[key]) raw = String(QTY_MAX[key]);   // cap
    setCounts(c => ({...c, [key]: raw})); markEntryDirty();
  };
  // − / + buttons (and a clamp): always step by a whole 1, between 0 and the cap
  const bump = (key, delta) => { setCounts(c => {
    const n = capQty(key, Math.max(0, qtyRound(key, Number(c[key]||0) + delta)));
    return {...c, [key]: n};
  }); markEntryDirty(); };

  const liveTotal = (emp ? visibleTypes.reduce((sum,t) => {
    const qty = Number(counts[t.key]||0);
    const rate = isFixed(t.key) ? t.rate : Number(emp.rates?.[t.key]||0);
    return sum + qty*rate;
  }, 0) : 0) + (otherOn && Number(otherAmt) > 0 ? Number(otherAmt) : 0);

  // build the selected day's entry from the current inputs → {entry}, {incomplete}, or {skip}
  const buildEntry = () => {
    if (!emp) return { skip: true };
    let other = null;
    if (otherOn) {
      if (!(Number(otherAmt) > 0) || !otherNote.trim()) return { incomplete: true };   // Other started, not finished
      other = { amount: Math.round(Number(otherAmt)*100)/100, note: otherNote.trim() };
    }
    const cleanCounts = {};
    Object.keys(counts).forEach(k => { const n = capQty(k, qtyRound(k, Number(counts[k]||0))); if (n > 0) cleanCounts[k] = n; });
    const existing = dayEntries(date);
    if (!Object.keys(cleanCounts).length && !other && existing.length === 0) return { skip: true };   // nothing to save
    const id = (existing[0] && existing[0].id) || ("e_"+Date.now()+"_"+Math.random().toString(36).slice(2,7));
    const entry = { id, empId: emp.id, username: normU(emp.username), date, counts: cleanCounts };
    if (other) entry.other = other;
    if (capped) entry.shift = shift;   // regular (cap applies) vs extra (no cap) — only meaningful for capped NPs
    return { entry };
  };
  const saveEntry = async () => {
    if (date > todayISO()) { clearEntryDirty(); return; }   // never save a future date
    const r = buildEntry();
    if (r.incomplete) return;                       // wait until the Other line is complete (stay dirty)
    if (r.skip) { clearEntryDirty(); return; }       // nothing to save
    setEntrySaving(true);
    const res = await upsertEntry(r.entry);
    setEntrySaving(false);
    if (!res || res.saved === false) {              // write REJECTED → stay dirty, show retry
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    clearEntryDirty();
  };
  // flush a pending save immediately (e.g. before switching days, so edits aren't lost)
  const flushEntry = () => { if (entryDirtyRef.current) saveEntry(); };
  // debounced auto-save after the last edit
  useEffect(() => {
    if (!entryDirty) return;
    const id = setTimeout(() => saveEntry(), 700);
    return () => clearTimeout(id);
  }, [entryDirty, counts, otherOn, otherAmt, otherNote]);

  return (
    <div className="card">
      {ptoOpen && <PtoCalendar pto={pto} allowance={ptoAllowance} startDate={ptoStartDate}
        onClose={()=>setPtoOpen(false)}
        onCancel={(date)=>{ onCancelPto && onCancelPto(date); showToast && showToast("PTO request canceled"); }}
        onSubmit={async (sel)=>{ const ok = await onRequestPto(sel); setPtoOpen(false);
          showToast && showToast(ok === false ? "⚠ Couldn't submit your PTO request — try again" : "PTO request submitted"); }} />}
      <h2>{noPayTypes ? "Your pay" : "Log your work"}</h2>
      <p className="hint">{noPayTypes
        ? <>Signed in as <strong>{emp.name}</strong>. You're salaried — there's nothing to log day-to-day.</>
        : <>Logging as <strong>{emp.name}</strong>. Tap a day below to add or edit it.</>}</p>
      {ptoEnabled && (
        <div className="pto-line">
          {approvedPto.length > 0 && <div className="pto-status">Approved PTO: {ptoFmt(approvedPto)}</div>}
          {requestedPto.length > 0 && <div className="pto-status pending">Requested PTO: {ptoFmt(requestedPto)} · pending</div>}
          <a className="pto-link" onClick={()=>setPtoOpen(true)}>Request PTO</a>
        </div>
      )}

      {emp && (
        <>
          <div style={{height:22}} />
          <div className="period-nav">
            <div style={{display:"flex", alignItems:"center", gap:10}}>
              <button onClick={()=>{ flushEntry(); setPeriodIdx(i=>i-1); }} aria-label="Previous pay period">‹</button>
              <div className="pn-label">{fmtShortYr(period.start)} – {fmtShortYr(period.end)}</div>
              <button onClick={()=>{ flushEntry(); setPeriodIdx(i=>Math.min(maxPeriodIdx, i+1)); }} disabled={periodIdx>=maxPeriodIdx} aria-label="Next pay period">›</button>
            </div>
            <div className="period-total">
              {(basePeriod > 0 || periodBonus > 0 || periodReimb > 0 || periodStipend > 0)
                ? <div className="pay-breakdown">
                    {/* a stipend-only person (no salary) must not see a dead "Base $0.00" row */}
                    {basePeriod > 0 &&
                      <div><span>Base{baseProrated ? " (prorated " + basePr.days + "/" + basePr.of + " weekdays)" : ""}</span><span className="pay">{money(basePeriod)}</span></div>}
                    {/* salary-only staff have no variable pay — don't show a dead $0.00 row
                        (still shown if a legacy period has real logged dollars) */}
                    {(!noPayTypes || periodDollars > 0) &&
                      <div><span>Variable</span><span className="pay">{money(periodDollars)}</span></div>}
                    {periodBonus > 0 && <div><span>Bonus</span><span className="pay">{money(periodBonus)}</span></div>}
                    {periodReimb > 0 && <div><span>Reimbursement</span><span className="pay">{money(periodReimb)}</span></div>}
                    {periodStipend > 0 && <div><span>{(emp && String(emp.stipendNote||"").trim()) || "Stipend"}</span><span className="pay">{money(periodStipend)}</span></div>}
                    <div className="pay-total"><span>Total</span><span className="pay">{money(basePeriod + periodDollars + periodBonus + periodReimb + periodStipend)}</span></div>
                  </div>
                : <span>This period:<span className="pay" style={{marginLeft:6}}>{money(periodDollars)}</span></span>}
              <div style={{fontSize:12, color:"var(--muted)", marginTop:4}}>Payday {period.paydayLabel}</div>
            </div>
          </div>
          {!noPayTypes && <>
          <div style={{height:12}} />
          <div className="week-grid">
            {DOW.map(d => <div className="dow" key={"dow-"+d}>{d}</div>)}
            {Array.from({length: leadBlanks}, (_, i) => <div className="day-cell pad" key={"pad-"+i} aria-hidden="true" />)}
            {periodDays.map(iso => {
              const logged = dayEntries(iso).length > 0;
              const locked = dateInLockedPeriod(iso, manualLocks, manualUnlocks);
              const future = iso > todayISO();
              const cls = "day-cell"
                + (iso===date ? " selected" : "")
                + (logged ? " logged" : "")
                + (iso===todayISO() ? " today" : "")
                + (locked ? " locked" : "")
                + (future ? " future" : "");
              return (
                <div className={cls} key={iso} title={future ? "Can't log a future date" : undefined}
                  onClick={()=>{ if (future) return; flushEntry(); setDate(iso); }}>
                  <div className="dnum">{parseDate(iso).getDate()}{locked ? " 🔒" : ""}</div>
                  {logged
                    ? <div className="damt">{money(dayDollars(iso))}</div>
                    : <div className="dempty">—</div>}
                </div>
              );
            })}
          </div>
          {dateLocked && (
            <div className="fixed-note" style={{color:"var(--amber)", marginTop:12}}>
              Heads up: {fmtShortYr(date)} is in a pay period that's already locked for payroll. You can still save, but the owner will be notified it came in late.
            </div>
          )}
          </>}
        </>
      )}

      {emp && capped && !dateLocked && (
        <div style={{marginTop:14}}>
          <label style={{marginBottom:6}}>Shift type for {fmtShort(date)}</label>
          <div className="tabs" style={{marginBottom:0}}>
            <button className={"tab"+(shift==="regular"?" active":"")} onClick={()=>{ if (shift!=="regular") { setShift("regular"); markEntryDirty(); } }}>Regular shift</button>
            <button className={"tab"+(shift==="extra"?" active":"")} onClick={()=>{ if (shift!=="extra") { setShift("extra"); markEntryDirty(); } }}>Extra shift</button>
          </div>
          {onExtraShift && (
            <div className="fixed-note" style={{marginTop:8, color:"var(--accent-ink)"}}>
              Extra shift — not covered by your salary cap. Log <strong>every</strong> patient you saw; no certification needed.
            </div>
          )}
        </div>
      )}

      {emp && capped && shift==="regular" && !certifiedForPeriod && !audit && (
        <div className="cap-gate">
          <div className="cap-gate-title">⚠ Salary cap</div>
          <div className="cap-gate-body">
            Your salary covers your first <strong>{cap}</strong> patients this pay period ({periodLabel}). Only log <strong>additional</strong> consults / follow-ups here.
          </div>
          <label className="cap-gate-check">
            <input type="checkbox" checked={false} onChange={()=>certifyPeriod(periodIdx, cap)} />
            <span>I certify I've met my {cap}-patient cap this period and these are additional patients.</span>
          </label>
        </div>
      )}
      {emp && capped && shift==="regular" && !certifiedForPeriod && audit && (
        <div className="fixed-note" style={{marginTop:14, color:"var(--amber)"}}>
          ⚠ Hasn't certified the {cap}-patient cap this period — you're editing as owner (audit).
        </div>
      )}
      {emp && capped && shift==="regular" && certifiedForPeriod && (
        <div className="fixed-note" style={{marginTop:14, color:"var(--accent-ink)"}}>
          ✓ Certified for {periodLabel} — logging additional patients.
        </div>
      )}

      {emp && gateOpen && visibleTypes.length > 0 && (
        <>
          <div style={{height:18}} />
          <label style={{marginBottom:10}}>
            Counts for {fmtShortYr(date)}{dayEntries(date).length ? " — editing your saved day" : ""}
          </label>
          <div className="counter-grid">
            {visibleTypes.map(t => {
              const rate = isFixed(t.key) ? t.rate : Number(emp.rates?.[t.key]||0);
              const dec = isDecimal(t.key);
              return (
                <div className="counter" key={t.key}>
                  <div>
                    <div className="clabel">{t.label}</div>
                    <div className="crate">{money(rate)} / {t.unit}{QTY_MAX[t.key] != null ? " · max " + QTY_MAX[t.key] : ""}</div>
                  </div>
                  <div className="stepper">
                    <button onClick={()=>bump(t.key, -1)}>−</button>
                    <input type="text" inputMode={dec ? "decimal" : "numeric"}
                      value={counts[t.key] ? counts[t.key] : ""} placeholder="0"
                      onChange={e=>typeCount(t.key, e.target.value)}
                      onKeyDown={e=>{ if(e.key==="ArrowUp"){e.preventDefault();bump(t.key,1);} else if(e.key==="ArrowDown"){e.preventDefault();bump(t.key,-1);} }} />
                    <button onClick={()=>bump(t.key, 1)}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ("no counted pay types" nag removed — people with no pay types get the salary-only
          view above; if OTHER_ENABLED is ever flipped back on they get the Other box below) */}

      {emp && gateOpen && !noPayTypes && (
        <>
          {OTHER_ENABLED && (<>
          <div style={{height:18}} />
          <div className="other-box">
            <label style={{display:"flex", alignItems:"center", gap:10, cursor:"pointer", marginBottom:0}}>
              <input type="checkbox" style={{width:"auto", margin:0}}
                checked={otherOn} onChange={e=>{ setOtherOn(e.target.checked); markEntryDirty(); }} />
              <span style={{color:"var(--ink)", fontWeight:500}}>Other — a one-off amount not covered above</span>
            </label>
            {otherOn && (
              <>
                <div className="other-fields">
                  <div style={{maxWidth:200}}>
                    <label>Amount ($)</label>
                    <input type="number" min="0" step="0.01" placeholder="0.00"
                      value={otherAmt} onChange={e=>{ setOtherAmt(e.target.value); markEntryDirty(); }}
                      style={ !(Number(otherAmt) > 0) ? {borderColor:"var(--danger)"} : null } />
                  </div>
                  <div style={{flex:"1 1 220px", minWidth:0}}>
                    <label>Explanation (required)</label>
                    <input type="text" placeholder="What is this for?"
                      value={otherNote} onChange={e=>{ setOtherNote(e.target.value); markEntryDirty(); }}
                      style={ !otherNote.trim() ? {borderColor:"var(--danger)"} : null } />
                  </div>
                </div>
                {(!(Number(otherAmt) > 0) || !otherNote.trim()) && (
                  <div className="fixed-note" style={{color:"var(--danger)", marginTop:8}}>
                    An Other line needs both a dollar amount and an explanation before it can be saved.
                  </div>
                )}
              </>
            )}
          </div>
          </>)}

          <div className="savebar">
            <div style={{alignSelf:"center", marginRight:"auto", fontSize:14, color:"var(--muted)"}}>
              This entry: <span className="pay">{money(liveTotal)}</span>
            </div>
            {saveFailed
              ? <button className="btn btn-danger" style={{alignSelf:"center", fontSize:13}} onClick={saveEntry}>
                  ⚠ Not saved — tap to retry
                </button>
              : <span style={{alignSelf:"center", fontSize:13, fontWeight:500, color:"var(--accent-ink)"}}>
                  {(entrySaving || entryDirty) ? "Saving…" : dayEntries(date).length ? "✓ Saved" : ""}
                </span>}
            <button className="btn btn-ghost" onClick={()=>{ setCounts({}); setOtherOn(false); setOtherAmt(""); setOtherNote(""); markEntryDirty(); }}>Clear</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- owner view ---------- */
function OwnerView({ employees, entries, salaries, adjustments, manualLocks, manualUnlocks, setPeriodLock, persistEmployees, persistSalaries, persistAdjustments, deleteEntry, allPto, onSetPtoStatus, onAddPto, onViewAs, syncedAt, onRefresh, showToast }) {
  const [sub, setSub] = useState("rollup");
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };
  const syncLabel = syncedAt ? syncedAt.toLocaleTimeString([], { hour:"numeric", minute:"2-digit", second:"2-digit" }) : "—";
  const viewable = employees.filter(e => !e.salaryOnly)   // include office managers (view their staff page)
    .slice().sort((a,b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
  return (
    <>
      <div style={{display:"flex", flexWrap:"wrap", gap:10, alignItems:"center", justifyContent:"space-between", marginTop:"-6px", marginBottom:14}}>
        <div className="tabs" style={{margin:0}}>
          <button className={"tab"+(sub==="rollup"?" active":"")} onClick={()=>setSub("rollup")}>Roll-up</button>
          <button className={"tab"+(sub==="rates"?" active":"")} onClick={()=>setSub("rates")}>Employees &amp; rates</button>
          <button className={"tab"+(sub==="entries"?" active":"")} onClick={()=>setSub("entries")}>All entries</button>
          <button className={"tab"+(sub==="pto"?" active":"")} onClick={()=>setSub("pto")}>PTO{(() => { const n = (allPto||[]).filter(r=>r.status==="requested").length; return n ? " (" + n + ")" : ""; })()}</button>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:12, flexWrap:"wrap"}}>
          <div style={{display:"flex", alignItems:"center", gap:8, fontSize:12, color:"var(--muted)"}}>
            <span title="Data is pulled live from the server on every load, on a 60s heartbeat, and whenever you return to the tab.">Synced {syncLabel}</span>
            <button className="btn btn-ghost" title="Refresh" aria-label="Refresh" style={{padding:"4px 10px", fontSize:16, lineHeight:1}} onClick={doRefresh} disabled={refreshing}>↻</button>
          </div>
          {onViewAs && (
            <select value="" onChange={e=>{ const emp = viewable.find(x=>x.id===e.target.value); if (emp) onViewAs(emp); }} style={{maxWidth:240}}>
              <option value="">👁 View as employee…</option>
              {viewable.map(e => <option key={e.id} value={e.id}>{lastFirst(e.name)}</option>)}
            </select>
          )}
        </div>
      </div>
      {sub==="rollup"  && <Rollup employees={employees} entries={entries} salaries={salaries} adjustments={adjustments} persistAdjustments={persistAdjustments} manualLocks={manualLocks} manualUnlocks={manualUnlocks} setPeriodLock={setPeriodLock} showToast={showToast} />}
      {sub==="rates"   && <Rates employees={employees} salaries={salaries} persistEmployees={persistEmployees} persistSalaries={persistSalaries} showToast={showToast} />}
      {sub==="entries" && <AllEntries employees={employees} entries={entries} deleteEntry={deleteEntry} showToast={showToast} />}
      {sub==="pto"     && <PtoAdmin employees={employees} allPto={allPto} onSetStatus={onSetPtoStatus} onAddPto={onAddPto} showToast={showToast} />}
    </>
  );
}

/* ---------- roll-up + CSV ---------- */
function payForEntry(emp, entry) {
  let total = 0;
  for (const t of ALL_TYPES) {
    const qty = Number(entry.counts?.[t.key]||0);
    if (!qty) continue;
    const rate = isFixed(t.key) ? t.rate : Number(emp?.rates?.[t.key]||0);
    total += qty*rate;
  }
  const ov = Number(entry.other?.amount);
  if (ov > 0) total += ov;
  return total;
}

function Rollup({ employees, entries, salaries, adjustments, persistAdjustments, manualLocks, manualUnlocks, setPeriodLock, showToast }) {
  const periods = periodList(10, 0);                 // selectable window — no future periods (until their first day)
  const [mode, setMode] = useState("period");        // "period" | "day" | "custom"
  const [periodIdx, setPeriodIdx] = useState(currentPeriodIndex());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dayDate, setDayDate] = useState(todayISO());
  // remembered roll-up sort. localStorage survives reloads; window._rollupSort* survives remounts
  // (tab-switch, data refresh) even when storage is blocked (e.g. Private mode) — so it stops resetting.
  const [sortKey, setSortKey] = useState(() => { try { return localStorage.getItem("plexusRollupSortKey") || window._rollupSortKey || null; } catch(e){ return window._rollupSortKey || null; } });
  const [sortDir, setSortDir] = useState(() => { try { return localStorage.getItem("plexusRollupSortDir") || window._rollupSortDir || "desc"; } catch(e){ return window._rollupSortDir || "desc"; } });
  useEffect(() => {
    window._rollupSortKey = sortKey; window._rollupSortDir = sortDir;
    try {
      if (sortKey) { localStorage.setItem("plexusRollupSortKey", sortKey); localStorage.setItem("plexusRollupSortDir", sortDir); }
      else { localStorage.removeItem("plexusRollupSortKey"); localStorage.removeItem("plexusRollupSortDir"); }
    } catch (e) {}
  }, [sortKey, sortDir]);
  const [calY, setCalY] = useState(parseDate(todayISO()).getFullYear());
  const [calM, setCalM] = useState(parseDate(todayISO()).getMonth());   // 0-11

  const selPeriod = periodByIndex(periodIdx);
  const locked = isPeriodLockedCombined(periodIdx, manualLocks, manualUnlocks);

  // owner-only editable overrides/adjustments, debounced auto-save (like the roster editor)
  const [adjDraft, setAdjDraft] = useState(adjustments || {});
  const adjDirty = useRef(false);
  useEffect(() => { if (!adjDirty.current) setAdjDraft(adjustments || {}); }, [adjustments]);
  useEffect(() => {
    if (!adjDirty.current) return;
    const id = setTimeout(() => { adjDirty.current = false; persistAdjustments && persistAdjustments(adjDraft); }, 700);
    return () => clearTimeout(id);
  }, [adjDraft]);
  const editable = mode === "period";   // overrides are per pay period
  const periodAdj = (editable && adjDraft[periodIdx]) || {};
  const setAdj = (empId, field, value) => {
    adjDirty.current = true;
    setAdjDraft(d => {
      const next = { ...d };
      const p = { ...(next[periodIdx] || {}) };
      const cur = { ...(p[empId] || {}) };
      if (field.indexOf("count.") === 0) {
        const t = field.slice(6);
        cur.counts = { ...(cur.counts || {}) };
        if (value === "") delete cur.counts[t]; else cur.counts[t] = value;
        if (!Object.keys(cur.counts).length) delete cur.counts;
      } else { if (value === "" || value == null) delete cur[field]; else cur[field] = value; }
      if (!Object.keys(cur).length) delete p[empId]; else p[empId] = cur;
      next[periodIdx] = p;
      return next;
    });
  };

  // effective date window
  const winFrom = mode === "period" ? selPeriod.start : mode === "day" ? dayDate : from;
  const winTo   = mode === "period" ? selPeriod.end   : mode === "day" ? dayDate : to;

  const filtered = entries.filter(e => {
    if (winFrom && e.date < winFrom) return false;
    if (winTo && e.date > winTo) return false;
    return true;
  });

  const has = (v) => v != null && v !== "";
  const buildRow = (emp, empEntries, removed) => {
    const computedCounts = {}; let computedOther = 0;
    const otherNotes = [];
    for (const t of ALL_TYPES) computedCounts[t.key] = 0;
    for (const e of empEntries) {
      for (const t of ALL_TYPES) computedCounts[t.key] += Number(e.counts?.[t.key]||0);
      const ov = Number(e.other?.amount);
      if (ov > 0) { computedOther += ov; otherNotes.push({ date: e.date, amount: ov, note: (e.other.note || "").trim() }); }
    }
    const adj = periodAdj[emp.id] || {};
    // counts: per-type override
    const counts = {};
    for (const t of ALL_TYPES) counts[t.key] = (adj.counts && has(adj.counts[t.key])) ? Number(adj.counts[t.key]) : computedCounts[t.key];
    const other = has(adj.other) ? Number(adj.other) : computedOther;
    // variable: direct override (e.g. collection-based admin-entered pay), else from effective counts + Other
    let variable;
    if (has(adj.variable)) variable = Number(adj.variable);
    else { variable = other; for (const t of ALL_TYPES) variable += counts[t.key] * (isFixed(t.key) ? t.rate : Number((removed ? null : emp)?.rates?.[t.key]||0)); }
    const annual = Number((salaries && salaries[emp.id]) || 0);
    const pr = (mode === "period" && annual > 0 && !removed) ? proratedBase(annual, selPeriod, emp) : { base: 0, days: 0, of: 0 };
    const computedBase = pr.base;
    const base = computedBase;   // Base is read-only in the roll-up (salary ÷ periods per year, prorated by start/last day) — change it in Employees & rates
    const bonus = Number(adj.bonus) || 0;
    const reimb = Number(adj.reimbursement) || 0;
    // recurring stipend: Pay-period view only (like Base), never for removed staff.
    // A typed cell overrides it for THIS period only; clearing reverts to the computed value.
    const computedStip = (mode === "period" && !removed) ? stipendFor(emp, selPeriod) : 0;
    const stip = has(adj.stipend) ? Number(adj.stipend) : computedStip;
    const notes = adj.notes || "";
    return { emp, adj, computedCounts, computedOther, counts, base, baseDays: pr.days, baseOf: pr.of, variable, bonus, reimb, stip, notes, other, otherAmt: other,
      pay: base + variable + bonus + reimb + stip, n: empEntries.length, otherNotes, removed };
  };
  const rows = employees.map(emp => buildRow(emp, filtered.filter(e => e.empId === emp.id), false));
  // include entries from staff who have since been removed (orphaned but still recorded/owed)
  const currentIds = new Set(employees.map(e => e.id));
  const orphanGroups = {};
  filtered.forEach(e => { if (!currentIds.has(e.empId)) (orphanGroups[e.empId] = orphanGroups[e.empId] || []).push(e); });
  Object.entries(orphanGroups).forEach(([id, es]) => {
    rows.push(buildRow({ id, name: ((es[0] && es[0].username) || id) + " (removed)" }, es, true));
  });

  const grand = rows.reduce((s,r)=>s+r.pay,0);
  const totalBase = rows.reduce((s,r)=>s+r.base,0);
  const totalVariable = rows.reduce((s,r)=>s+r.variable,0);
  const totalBonus = rows.reduce((s,r)=>s+r.bonus,0);
  const totalReimb = rows.reduce((s,r)=>s+r.reimb,0);
  const totalStipend = rows.reduce((s,r)=>s+r.stip,0);
  const totalConsults = rows.reduce((s,r)=>s+r.counts.consults,0);
  const totalFollow = rows.reduce((s,r)=>s+r.counts.followups,0);
  const totalOther = rows.reduce((s,r)=>s+r.otherAmt,0);

  // sortable roll-up table: click a header to sort (asc → desc → back to roster order)
  const sortVal = (r, k) => k==="name" ? lastNameKey(r.emp.name)
    : k==="pay" ? r.pay : k==="base" ? r.base : k==="variable" ? r.variable : k==="bonus" ? r.bonus : k==="reimb" ? r.reimb : k==="stipend" ? r.stip : k==="other" ? r.otherAmt : (r.counts[k]||0);
  const sortedRows = sortKey
    ? [...rows].sort((a,b) => { const va=sortVal(a,sortKey), vb=sortVal(b,sortKey);
        const cmp = typeof va==="string" ? va.localeCompare(vb) : (va-vb); return sortDir==="asc"?cmp:-cmp; })
    : rows;
  const sortBy = (k) => {
    const firstDir = k==="name" ? "asc" : "desc";
    if (sortKey !== k) { setSortKey(k); setSortDir(firstDir); }
    else if (sortDir === firstDir) setSortDir(firstDir==="asc"?"desc":"asc");
    else setSortKey(null);   // third click clears back to roster order
  };
  const sortTh = (k, label, num) => (
    <th className={num ? "num" : ""} onClick={()=>sortBy(k)} style={{cursor:"pointer", userSelect:"none", whiteSpace:"nowrap"}}>
      {label}{sortKey===k ? (sortDir==="asc" ? " ▲" : " ▼") : ""}
    </th>
  );
  // editable roll-up cells (Pay-period view only): dollar / count overrides; Pay stays computed
  // Confirm before overriding a cell that already has a value (guards accidental edits to the pre-filled grid).
  const [pendingCell, setPendingCell] = useState(null);
  const [overrideOk, setOverrideOk] = useState(false);
  const confirmedRef = useRef(new Set());   // cells the owner has already approved this session
  const pendingElRef = useRef(null);
  const guardEdit = (e, key, label, cur) => {
    if (confirmedRef.current.has(key) || cur === "" || cur == null) { confirmedRef.current.add(key); return; }
    pendingElRef.current = e.target;
    e.target.blur();                         // block editing until they approve the override
    setPendingCell({ key, label, cur });
  };
  const ovCell = (r, field, eff, label) => {
    const cur = has(r.adj[field]) ? r.adj[field] : (eff ? Math.round(eff*100)/100 : "");
    const key = periodIdx + ":" + r.emp.id + ":" + field;
    return (
      <td className="num">
        {editable
          ? <input className="cell-in" type="text" inputMode="decimal" value={cur}
              onFocus={(e)=>guardEdit(e, key, (lastFirst(r.emp.name)||"This person") + " · " + label, cur)}
              onChange={e=>setAdj(r.emp.id, field, e.target.value)} />
          : (eff ? money(eff) : "")}
      </td>
    );
  };
  const cntCell = (r, t, label) => {
    const cur = (r.adj.counts && has(r.adj.counts[t])) ? r.adj.counts[t] : (r.counts[t] || "");
    const key = periodIdx + ":" + r.emp.id + ":count." + t;
    return (
      <td className="num cnt">
        {editable
          ? <input className="cell-in cnt-in" type="text" inputMode="numeric" value={cur}
              onFocus={(e)=>guardEdit(e, key, (lastFirst(r.emp.name)||"This person") + " · " + label, cur)}
              onChange={e=>setAdj(r.emp.id, "count."+t, e.target.value)} />
          : (r.counts[t] || "")}
      </td>
    );
  };

  // ----- day-view month calendar -----
  const empById = (id) => employees.find(x=>x.id===id);
  const dayTotal = (iso) => entries.filter(e=>e.date===iso).reduce((s,e)=> s + payForEntry(empById(e.empId), e), 0);
  const calFirst = new Date(calY, calM, 1);
  const calCells = [];
  for (let i=0; i<calFirst.getDay(); i++) calCells.push(null);            // leading blanks
  for (let d=1; d<=new Date(calY, calM+1, 0).getDate(); d++) calCells.push(d);
  const calLabel = calFirst.toLocaleDateString(undefined, {month:"long", year:"numeric"});
  const prevMonth = () => (calM<=0 ? (setCalM(11), setCalY(calY-1)) : setCalM(calM-1));
  const nextMonth = () => (calM>=11 ? (setCalM(0), setCalY(calY+1)) : setCalM(calM+1));

  // late entries: entries inside this window that were created after the period locked
  const lateEntries = mode === "period"
    ? filtered.filter(e => {
        const created = e.id && e.id.startsWith("e_") ? Number(e.id.split("_")[1]) : null;
        return locked && created && created > selPeriod.lockAt.getTime();
      })
    : [];
  // one readable line per late entry (who, work date, when it was logged, what, $) — stacked cards, so it
  // reads on a phone without the wide roll-up table. Newest-logged first.
  const [showLate, setShowLate] = useState(true);
  const lateAfter = (h) => h < 1 ? Math.max(1, Math.round(h * 60)) + " min" : h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " d";
  const lateRows = lateEntries.map(e => {
    const emp = employees.find(x => x.id === e.empId);
    const created = Number(e.id.split("_")[1]);
    const parts = ALL_TYPES.filter(t => Number(e.counts?.[t.key]||0) > 0).map(t => `${e.counts[t.key]} ${t.label.toLowerCase()}`);
    let amt = 0;
    for (const t of ALL_TYPES) amt += Number(e.counts?.[t.key]||0) * (isFixed(t.key) ? t.rate : Number(emp?.rates?.[t.key]||0));
    if (e.other && Number(e.other.amount) > 0) { amt += Number(e.other.amount); parts.push("Other " + money(Number(e.other.amount)) + (e.other.note ? " (" + e.other.note + ")" : "")); }
    return { id: e.id, name: emp ? lastFirst(emp.name) : (e.username ? e.username + " (removed)" : e.empId), date: e.date, created,
      after: lateAfter((created - selPeriod.lockAt.getTime()) / 3600000), parts, amt };
  }).sort((a, b) => b.created - a.created);

  // ADP-ready CSV — SAME format/semantics as the payroll email (payroll-summary.mjs,
  // Shikha's 7/14 spec): W2 → salary as EXCLUDED + production as BONUS; 1099 → everything as
  // 1099COMP; $0 rows kept as "no pay"; removed staff exported as 1099. The old export put
  // base salary in "Other Earnings Amount", which would DOUBLE-PAY W2 salaried staff if keyed
  // into ADP (ADP already pays their salary) — never resurrect that format.
  const exportADP = () => {
    const DASH = "—";
    const cents = n => Math.round(n * 100);
    const header = ["EMPLOYEE (ADP NAME)","TYPE","1099COMP AMOUNT","BONUS AMOUNT","EXCLUDED SALARY","TOTAL PAY"];
    const out = [header];
    let t1099 = 0, tBonus = 0, tExcl = 0;
    const srows = [...rows].sort((a,b) => lastFirst(a.emp.name).localeCompare(lastFirst(b.emp.name)));
    for (const r of srows) {
      const taxType = r.removed ? "1099" : (r.emp.taxType || (r.base > 0 ? "w2" : "1099"));
      if (r.pay === 0) { out.push([lastFirst(r.emp.name), "no pay", DASH, DASH, DASH, DASH]); continue; }
      if (taxType === "w2") {
        const bonus = r.pay - r.base;
        tBonus += cents(bonus); tExcl += cents(r.base);
        out.push([lastFirst(r.emp.name), "W2", DASH, bonus ? money(bonus) : DASH, r.base ? money(r.base) : DASH, money(r.pay)]);
      } else {
        t1099 += cents(r.pay);
        out.push([lastFirst(r.emp.name), "1099", money(r.pay), DASH, DASH, money(r.pay)]);
      }
    }
    out.push(["Total payroll", "", money(t1099/100), money(tBonus/100), money(tExcl/100), money(grand)]);
    const cell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
    const csv = "\ufeff" + out.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";   // BOM: Excel renders the em-dashes
    const blob = new Blob([csv], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const tag = mode === "period" ? `${selPeriod.start}_to_${selPeriod.end}` : `${winFrom||"all"}_${winTo||"all"}`;
    a.href = url; a.download = `payroll_${tag}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const autoLocked = isPeriodLocked(selPeriod);
  const manualLocked = Array.isArray(manualLocks) && manualLocks.includes(periodIdx);
  const forceUnlocked = Array.isArray(manualUnlocks) && manualUnlocks.includes(periodIdx);

  return (
    <div className="card">
      {pendingCell && (
        <div className="modal-backdrop" onClick={()=>{ setPendingCell(null); setOverrideOk(false); }}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Override an existing value?</h3>
            <p><strong>{pendingCell.label}</strong> already has the value <strong>{pendingCell.cur}</strong>. Editing it replaces that value for payroll.</p>
            <label className="modal-check"><input type="checkbox" checked={overrideOk} onChange={e=>setOverrideOk(e.target.checked)} /> Yes, I want to override it</label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>{ setPendingCell(null); setOverrideOk(false); }}>Cancel</button>
              <button className="btn btn-primary" disabled={!overrideOk} onClick={()=>{ confirmedRef.current.add(pendingCell.key); setPendingCell(null); setOverrideOk(false); const el = pendingElRef.current; setTimeout(()=>{ try { el && el.focus(); } catch(ex){} }, 0); }}>Continue</button>
            </div>
          </div>
        </div>
      )}
      <h2>Roll-up</h2>
      <p className="hint">Review by pay period, a single day, or a custom range. {periodDescription()}</p>

      {/* mode toggle */}
      <div className="tabs" style={{marginBottom:18}}>
        <button className={"tab"+(mode==="period"?" active":"")} onClick={()=>setMode("period")}>Pay period</button>
        <button className={"tab"+(mode==="day"?" active":"")} onClick={()=>setMode("day")}>Day</button>
        <button className={"tab"+(mode==="custom"?" active":"")} onClick={()=>setMode("custom")}>Custom range</button>
      </div>

      {mode === "period" && (
        <div style={{marginBottom:18}}>
          <label>Pay period</label>
          <select value={periodIdx} onChange={e=>setPeriodIdx(Number(e.target.value))}>
            {periods.map(p => (
              <option key={p.index} value={p.index}>
                {fmtShortYr(p.start)} – {fmtShortYr(p.end)}  ·  paid {fmtShortYr(p.payday)}
                {p.index === currentPeriodIndex() ? "  (current)" : ""}
              </option>
            ))}
          </select>
          <div style={{display:"flex", alignItems:"center", gap:10, marginTop:10, flexWrap:"wrap"}}>
            <span style={{fontSize:13, color:"var(--muted)"}}>
              Payday <strong>{fmtShortYr(selPeriod.payday)}</strong>
            </span>
            {locked ? (
              <span className="pill" style={{background:"var(--danger-soft)", color:"var(--danger)"}}>
                🔒 Locked{manualLocked ? " (manual)" : autoLocked ? " (72h pre-payday)" : ""}
              </span>
            ) : (
              <span className="pill" style={{background:"var(--accent-soft)", color:"var(--accent-ink)"}}>Open{forceUnlocked && autoLocked ? " (admin override)" : ""}</span>
            )}
            <button className="btn btn-ghost" style={{padding:"5px 12px", fontSize:13}}
              onClick={()=>{ setPeriodLock(periodIdx, !locked); showToast(locked ? "Period unlocked" : "Period locked"); }}>
              {locked ? "Unlock period" : "Lock period now"}
            </button>
          </div>
          {autoLocked && !manualLocked && !forceUnlocked && (
            <div className="fixed-note" style={{marginTop:6}}>
              Auto-locked because it's within 72 hours of payday. New entries dated in this period will be flagged below. Use “Unlock period” to override.
            </div>
          )}
          {forceUnlocked && autoLocked && (
            <div className="fixed-note" style={{marginTop:6, color:"var(--amber)"}}>
              ⚠ You've manually unlocked this period even though it's within 72 hours of payday — entries can be edited again.
            </div>
          )}
        </div>
      )}

      {mode === "custom" && (
        <div className="row" style={{marginBottom:18}}>
          <div><label>From date</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></div>
          <div><label>To date</label><input type="date" value={to} onChange={e=>setTo(e.target.value)} /></div>
        </div>
      )}

      {mode === "day" && (
        <div style={{marginBottom:18}}>
          <div className="period-nav">
            <div style={{display:"flex", alignItems:"center", gap:10}}>
              <button onClick={prevMonth} aria-label="Previous month">‹</button>
              <div className="pn-label">{calLabel}</div>
              <button onClick={nextMonth} aria-label="Next month">›</button>
            </div>
            <div className="period-total">Showing <span className="pay" style={{marginLeft:6}}>{fmtShortYr(dayDate)}</span></div>
          </div>
          <p className="hint" style={{marginTop:0, marginBottom:10}}>Tap a date to see that day's per-NP breakdown below. Each cell shows the total logged that day.</p>
          <div className="week-grid">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div className="dow" key={"cd"+d}>{d}</div>)}
            {calCells.map((d, i) => {
              if (d === null) return <div key={"blank"+i} />;
              const iso = fmtISO(new Date(calY, calM, d));
              const tot = dayTotal(iso);
              const cls = "day-cell" + (iso===dayDate ? " selected" : "") + (tot>0 ? " logged" : "") + (iso===todayISO() ? " today" : "");
              return (
                <div className={cls} key={iso} onClick={()=>setDayDate(iso)}>
                  <div className="dnum">{d}</div>
                  {tot>0 ? <div className="damt">{money(tot)}</div> : <div className="dempty">—</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lateEntries.length > 0 && (
        <div className="card late-card">
          <div className="late-head">
            <div style={{color:"var(--danger)", fontWeight:600, fontSize:14}}>
              ⚠ {lateEntries.length} late {lateEntries.length===1?"entry":"entries"} added after this period locked · {money(lateRows.reduce((s, r) => s + r.amt, 0))}
            </div>
            <button className="btn btn-ghost" style={{padding:"4px 10px", fontSize:13}} onClick={()=>setShowLate(v=>!v)}>{showLate ? "Hide" : "Show"}</button>
          </div>
          <div style={{fontSize:13, color:"var(--danger)", marginTop:4}}>
            Logged after the lock cutoff and included in the totals below. Review before paying — this period may already have been processed.
          </div>
          {showLate && (
            <div className="late-list">
              {lateRows.map(r => (
                <div className="late-item" key={r.id}>
                  <div className="late-who">{r.name}</div>
                  <div className="late-amt">{money(r.amt)}</div>
                  <div className="late-meta">Work dated <strong>{fmtShortYr(r.date)}</strong> · logged {new Date(r.created).toLocaleString(undefined, {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"})} · {r.after} after lock</div>
                  <div className="late-what">{r.parts.length ? r.parts.join(", ") : "no counts"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="metric-grid">
        <div className="metric"><div className="m-label">Total payout</div><div className="m-val">{money(grand)}</div></div>
        <div className="metric"><div className="m-label">Consults</div><div className="m-val">{totalConsults}</div></div>
        <div className="metric"><div className="m-label">Follow-ups</div><div className="m-val">{totalFollow}</div></div>
        <div className="metric"><div className="m-label">Entries</div><div className="m-val">{filtered.length}</div></div>
      </div>

      <div className="scroll-x">
        <table className="rollup-table">
          <thead>
            <tr>
              {sortTh("name", "Employee")}
              {sortTh("pay", "Pay", true)}
              {sortTh("base", "Base", true)}{sortTh("variable", "Variable", true)}
              {sortTh("bonus", "Bonus", true)}{sortTh("reimb", "Reimburse", true)}
              {sortTh("stipend", "Stipend", true)}
              {sortTh("consults", "Cons", true)}{sortTh("followups", "F/U", true)}
              {sortTh("clinic_pts", "Clinic pts", true)}
              {sortTh("perdiem", "Per diem", true)}
              {sortTh("clinic_hr", "Clinic hr", true)}{sortTh("virtual_hr", "Virtual hr", true)}{sortTh("hosp_hr", "Hosp hr", true)}
              {sortTh("other", "Other", true)}
              <th style={{whiteSpace:"nowrap"}}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(r => (
              <tr key={r.emp.id}>
                <td style={{whiteSpace:"nowrap"}}>{lastFirst(r.emp.name)}</td>
                <td className="num pay">{money(r.pay)}</td>
                <td className="num" title={r.baseDays > 0 && r.baseDays < r.baseOf ? "Prorated: " + r.baseDays + " of " + r.baseOf + " weekdays in this period (start / last day)" : undefined}>
                  {r.base ? money(r.base) : ""}{r.baseDays > 0 && r.baseDays < r.baseOf ? <span className="hint-sm"> · {r.baseDays}/{r.baseOf}wd</span> : null}</td>
                {ovCell(r, "variable", r.variable, "Variable")}
                {ovCell(r, "bonus", r.bonus, "Bonus")}
                {ovCell(r, "reimbursement", r.reimb, "Reimbursement")}
                {ovCell(r, "stipend", r.stip, "Stipend")}
                {cntCell(r, "consults", "Consults")}
                {cntCell(r, "followups", "Follow-ups")}
                {cntCell(r, "clinic_pts", "Clinic pts")}
                {cntCell(r, "perdiem", "Per diem")}
                {cntCell(r, "clinic_hr", "Clinic hr")}
                {cntCell(r, "virtual_hr", "Virtual hr")}
                {cntCell(r, "hosp_hr", "Hosp hr")}
                {ovCell(r, "other", r.otherAmt, "Other")}
                <td>{editable
                  ? <input className="cell-in notes-in" type="text" placeholder="—"
                      value={r.adj.notes || ""} onChange={e=>setAdj(r.emp.id, "notes", e.target.value)} />
                  : (r.notes || "")}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              <td className="num pay">{money(grand)}</td>
              <td className="num">{totalBase ? money(totalBase) : ""}</td>
              <td className="num">{totalVariable ? money(totalVariable) : ""}</td>
              <td className="num">{totalBonus ? money(totalBonus) : ""}</td>
              <td className="num">{totalReimb ? money(totalReimb) : ""}</td>
              <td className="num">{totalStipend ? money(totalStipend) : ""}</td>
              <td className="num">{rows.reduce((s,r)=>s+r.counts.consults,0)}</td>
              <td className="num">{rows.reduce((s,r)=>s+r.counts.followups,0)}</td>
              <td className="num">{rows.reduce((s,r)=>s+r.counts.clinic_pts,0)}</td>
              <td className="num">{rows.reduce((s,r)=>s+r.counts.perdiem,0)}</td>
              <td className="num">{rows.reduce((s,r)=>s+r.counts.clinic_hr,0)}</td>
              <td className="num">{rows.reduce((s,r)=>s+r.counts.virtual_hr,0)}</td>
              <td className="num">{rows.reduce((s,r)=>s+r.counts.hosp_hr,0)}</td>
              <td className="num">{totalOther ? money(totalOther) : ""}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {rows.some(r => r.otherNotes.length > 0) && (
        <div className="scroll-x" style={{marginTop:18}}>
          <label style={{marginBottom:8}}>Other adjustments — explanations</label>
          <table>
            <thead>
              <tr><th>Date</th><th>Employee</th><th className="num">Amount</th><th>Explanation</th></tr>
            </thead>
            <tbody>
              {rows.flatMap(r => r.otherNotes.map((o, i) => (
                <tr key={r.emp.id+"-o"+i}>
                  <td style={{whiteSpace:"nowrap"}}>{fmtShortYr(o.date)}</td>
                  <td style={{whiteSpace:"nowrap"}}>{lastFirst(r.emp.name)}</td>
                  <td className="num pay">{money(o.amount)}</td>
                  <td>{o.note || "—"}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions" style={{marginTop:18}}>
        <button className="btn btn-primary" onClick={exportADP}>Export ADP CSV</button>
        {mode === "period" && <span style={{alignSelf:"center", fontSize:13, color:"var(--muted)"}}>Period & payday auto-filled in the export.</span>}
      </div>
    </div>
  );
}

/* ---------- employees & rates ---------- */
function Rates({ employees, salaries, persistEmployees, persistSalaries, showToast }) {
  const [draft, setDraft] = useState(() => mergeSalaryDraft(JSON.parse(JSON.stringify(employees)), salaries));
  const salariesRef = useRef(salaries);
  useEffect(() => { salariesRef.current = salaries; }, [salaries]);
  const [newName, setNewName] = useState("");
  const [openIds, setOpenIds] = useState(() => new Set());   // expanded employee rows; default collapsed
  const [dirty, setDirty] = useState(false);     // unsaved local changes? drives the Save button
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);               // a save is in flight — parent state updates mid-save must not rebuild the draft
  const [modalId, setModalId] = useState(null);  // employee being edited in the "Add employee" popup
  const listRef = useRef(null);
  const draftRef = useRef(draft);
  const dirtyR = useRef(false);                  // mirror of `dirty` for use inside effects
  const markDirty = () => { dirtyR.current = true; setDirty(true); };
  const markClean = () => { dirtyR.current = false; setDirty(false); };

  useEffect(() => { draftRef.current = draft; }, [draft]);
  // pull in saved data, but never clobber unsaved local edits (e.g. on a background refresh)
  // Also skipped while a save is in flight: persistEmployees() sets `employees` BEFORE persistSalaries() sets
  // `salaries`, so merging at that moment rebuilt the draft with the PRE-save salary map — the salary the
  // user had just typed vanished, and the next autosave then deleted it from the salaries doc for real.
  useEffect(() => { if (!dirtyR.current && !savingRef.current) setDraft(mergeSalaryDraft(JSON.parse(JSON.stringify(employees)), salariesRef.current)); }, [employees, salaries]);

  // (roster order is now derived: grouped by role, alphabetical within — no manual drag-to-reorder)

  const addEmp = () => {
    const name = newName.trim();
    const id = "emp_"+Date.now()+"_"+Math.random().toString(36).slice(2,6);
    const next = [...draft, { id, name, rates: {}, fixedEligible: false }];   // Consults + Follow-ups off by default
    setDraft(next); setNewName(""); if (name) markDirty();
    setModalId(id);   // edit the new person in a popup — not in a row at the bottom of a long list
  };
  const cancelNewEmp = () => {   // discard the person being added (removes the row; autosave drops it server-side too)
    if (modalId) { setDraft(draft.filter(e => e.id !== modalId)); markDirty(); }
    setModalId(null);
  };
  const removeEmp = (id) => {
    const emp = draft.find(e => e.id === id);
    const who = (emp && emp.name && emp.name.trim()) || "this person";
    if (!window.confirm("Remove " + who + " from the roster?\n\nThey'll be taken off the staff list and can no longer log in. Their past entries stay in the roll-up. You can re-add them later.")) return;
    setDraft(draft.filter(e=>e.id!==id)); markDirty();
  };
  const setRate = (id, key, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, rates:{...e.rates, [key]: val}} : e));
    markDirty();
  };
  const setName = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, name: val} : e));
    markDirty();
  };
  const setRole = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, role: val} : e));
    markDirty();
  };
  // role suggestions: the four canonical roles first, then any other roles already in use
  const inUseRoles = [...new Set(draft.map(e => String(e.role||"").trim()).filter(Boolean))];
  const roleOptions = [...ROLE_CANON, ...inUseRoles.filter(r => !ROLE_CANON.some(c => c.toLowerCase() === r.toLowerCase())).sort()];
  // group + order the roster for display: MD, NP, Staff, Scribe, then other roles, then unassigned
  const roleGroups = (() => {
    const by = {};
    for (const e of draft) { const k = String(e.role||"").trim().toLowerCase(); (by[k] = by[k] || []).push(e); }
    const keys = Object.keys(by).sort((a,b) => {
      const ra = a in ROLE_RANK ? ROLE_RANK[a] : (a === "" ? 99 : 50);
      const rb = b in ROLE_RANK ? ROLE_RANK[b] : (b === "" ? 99 : 50);
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
    return keys.map(k => ({
      key: k || "_unassigned",
      label: k === "" ? "Unassigned" : (ROLE_LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1))),
      emps: by[k].slice().sort((a,b) => lastFirst(a.name||"").localeCompare(lastFirst(b.name||""))),
    }));
  })();
  const setUsername = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, username: val} : e));
    markDirty();
  };
  const setFixedElig = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, fixedEligible: val} : e));
    markDirty();
  };
  const setEmail = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, email: val} : e));
    markDirty();
  };
  const setCap = (id, val) => {
    if (val !== "" && !/^\d*$/.test(val)) return;   // whole numbers only
    setDraft(draft.map(e => e.id===id ? {...e, patientCap: val} : e));
    markDirty();
  };
  const setIsManager = (id, val) => {
    // a manager enters for others and isn't paid here; clear pay + any "entered by" link
    setDraft(draft.map(e => e.id===id ? {...e, isManager: val, managedBy: "", fixedEligible: val ? false : e.fixedEligible, patientCap: val ? "" : e.patientCap} : e));
    markDirty();
  };
  const setManagedBy = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, managedBy: val} : e));
    markDirty();
  };
  const setSalary = (id, val) => {
    if (val !== "" && !/^\d*$/.test(val)) return;   // whole dollars
    setDraft(draft.map(e => e.id===id ? {...e, annualSalary: val} : e));
    markDirty();
  };
  const setTaxType = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, taxType: val} : e));   // "w2" | "1099" | "" = auto (salaried→W2, else 1099)
    markDirty();
  };
  const setPtoDays = (id, val) => {
    if (val !== "" && !/^\d*\.?\d*$/.test(val)) return;   // allow half days (e.g. 12.5)
    setDraft(draft.map(e => e.id===id ? {...e, ptoDays: val} : e));
    markDirty();
  };
  const setShifts = (id, val) => {
    if (val !== "" && !/^\d*\.?\d*$/.test(val)) return;   // shifts per month (half shifts ok)
    setDraft(draft.map(e => e.id===id ? {...e, shiftsPerMonth: val} : e));
    markDirty();
  };
  const setStartDate = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, startDate: val} : e));   // YYYY-MM-DD; employment start (informational — PTO year is the calendar year)
    markDirty();
  };
  const setEndDate = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, endDate: val} : e));   // YYYY-MM-DD; last day worked — prorates the final period
    markDirty();
  };
  const setStipend = (id, val) => {
    if (val !== "" && !/^\d*\.?\d*$/.test(val)) return;   // dollars, cents allowed
    setDraft(draft.map(e => e.id===id ? {...e, stipend: val} : e));
    markDirty();
  };
  const setStipendNote = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, stipendNote: val} : e));
    markDirty();
  };
  const setStipendStart = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, stipendStart: val} : e));   // YYYY-MM-DD; first period containing it
    markDirty();
  };
  const setSalaryOnly = (id, val) => {
    setDraft(draft.map(e => e.id===id ? {...e, salaryOnly: val, isManager: val ? false : e.isManager, managedBy: "", fixedEligible: val ? false : e.fixedEligible} : e));
    markDirty();
  };
  const toggleOpen = (id) => setOpenIds(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expandAll = () => setOpenIds(new Set(draft.map(e=>e.id)));
  const collapseAll = () => setOpenIds(new Set());
  // one-line summary shown when an employee row is collapsed
  const empMeta = (emp) => {
    const u = normU(emp.username);
    const nRates = VARIABLE.filter(t => Number(emp.rates?.[t.key]) > 0).length;
    const bits = [];
    if (emp.salaryOnly) { bits.push("salary only"); }
    else if (emp.isManager) { bits.push("office manager"); }
    else {
      if (emp.fixedEligible) bits.push("consults+FU");
      if (nRates) bits.push(nRates + " rate" + (nRates===1?"":"s"));
      if (Number(emp.patientCap) > 0) bits.push("cap " + Math.round(Number(emp.patientCap)));
      if (emp.managedBy) bits.push(emp.managedBy === "ADMIN" ? "admin-entered" : "manager-entered");
    }
    if (Number(emp.annualSalary) > 0) bits.push("$" + Math.round(Number(emp.annualSalary)/1000) + "k");
    if (emp.taxType === "w2" || emp.taxType === "1099") bits.push(emp.taxType === "w2" ? "W-2" : "1099");
    if (Number(emp.shiftsPerMonth) > 0) bits.push(Number(emp.shiftsPerMonth) + " shifts/mo");
    if (emp.endDate) bits.push("last day " + fmtShort(emp.endDate));
    if (Number(emp.stipend) > 0) bits.push("$" + Number(emp.stipend) + "/period " + String(emp.stipendNote || "stipend").toLowerCase());
    if (emp.role && String(emp.role).trim()) bits.unshift(String(emp.role).trim());
    const noLogin = emp.salaryOnly;
    const em = String(emp.email||"").trim();
    return { user: noLogin ? "no login" : (em || "needs email"), right: bits.length ? bits.join(" · ") : "no pay set", warn: !noLogin && !em };
  };
  // validate the roster → {clean} or {error}
  const buildClean = (source) => {
    // Keep any row with real content, so clearing a name to retype never DELETES the person.
    // Only an entirely-empty row (an abandoned "Add employee") is dropped.
    const hasContent = (e) => e.name.trim() || normU(e.username) || String(e.email||"").trim() || e.salaryOnly || e.isManager || e.managedBy || Number(e.annualSalary) > 0 || Number(e.stipend) > 0 || (e.rates && Object.values(e.rates).some(v => Number(v) > 0));
    const kept = source.filter(hasContent);
    // a blank name BLOCKS the save (it just waits) rather than dropping that person
    const noName = kept.find(e => !e.name.trim());
    if (noName) return { error: "Every person needs a name — finish typing and it'll save." };
    // email required for everyone who signs in (it's their login identity now); salary-only and
    // manager-/admin-entered people don't sign in themselves, so they don't need one.
    const missing = kept.find(e => !e.salaryOnly && !e.managedBy && !String(e.email||"").trim());
    if (missing) return { error: "Add an email for " + missing.name.trim() + " — that's their login (or mark them salary-only)" };
    const seenE = {};
    for (const e of kept) { const em = String(e.email||"").trim().toLowerCase(); if (!em) continue; if (seenE[em]) return { error: 'Email "'+em+'" is used by two people — make it unique' }; seenE[em] = true; }
    const salariesMap = {};
    const clean = kept.map(e => {
      const rates = {};
      for (const t of VARIABLE) { const v = e.rates?.[t.key]; if (v !== "" && v != null && !isNaN(Number(v)) && Number(v) > 0) rates[t.key] = Number(v); }
      const out = { ...e, name: e.name.trim(), username: normU(e.username), email: String(e.email||"").trim().toLowerCase(), rates, fixedEligible: !!e.fixedEligible };
      if (e.role && String(e.role).trim()) out.role = String(e.role).trim(); else delete out.role;
      const annual = Number(e.annualSalary);
      if (annual > 0) salariesMap[e.id] = Math.round(annual);   // → owner-only salaries doc
      delete out.annualSalary;                                  // never store the amount in the employees record
      const tt = String(e.taxType||"").toLowerCase();
      if (tt === "w2" || tt === "1099") out.taxType = tt; else delete out.taxType;   // ADP pay type; blank = auto (salaried→W2, else 1099)
      if (e.salaryOnly) { out.salaryOnly = true; out.username = ""; out.email = ""; out.fixedEligible = false; out.rates = {}; delete out.managedBy; delete out.isManager; }
      else delete out.salaryOnly;
      const cap = Number(e.patientCap);
      if (cap > 0 && !e.isManager && !e.salaryOnly) out.patientCap = Math.round(cap); else delete out.patientCap;
      const pto = Number(e.ptoDays);
      if (pto > 0) out.ptoDays = pto; else delete out.ptoDays;   // annual PTO allowance (supports half days)
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(e.startDate||""))) out.startDate = e.startDate; else delete out.startDate;   // employment start date
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(e.endDate||""))) out.endDate = e.endDate; else delete out.endDate;   // last day worked
      const spm = Number(e.shiftsPerMonth);
      if (spm > 0) out.shiftsPerMonth = spm; else delete out.shiftsPerMonth;   // required shifts per month (1099 contractors)
      // recurring per-period stipend (e.g. parking). Start date defaults to today so already-paid
      // past periods never change retroactively.
      const st = Number(e.stipend);
      if (st > 0) {
        out.stipend = Math.round(st * 100) / 100;
        out.stipendStart = /^\d{4}-\d{2}-\d{2}$/.test(String(e.stipendStart||"")) ? e.stipendStart : todayISO();
        const sn = String(e.stipendNote||"").trim();
        if (sn) out.stipendNote = sn; else delete out.stipendNote;
      } else { delete out.stipend; delete out.stipendStart; delete out.stipendNote; }
      if (out.isManager) { delete out.managedBy; } else if (!e.salaryOnly) { if (e.managedBy) out.managedBy = String(e.managedBy); else delete out.managedBy; }
      return out;
    });
    return { clean, salaries: salariesMap };
  };
  const persistClean = async (clean, salariesMap) => {
    setSaving(true); savingRef.current = true; markClean();
    salariesRef.current = salariesMap;   // any merge that does run sees the salaries being saved, never the stale pre-save map
    try { await persistEmployees(clean); await persistSalaries(salariesMap); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const save = async (sourceArr) => {        // explicit/manual (surfaces validation errors)
    const r = buildClean(sourceArr || draftRef.current);
    if (r.error) { showToast(r.error); return; }
    await persistClean(r.clean, r.salaries);
  };
  const autoSave = async () => {             // quiet; waits silently until valid
    const r = buildClean(draftRef.current);
    if (!r.error) await persistClean(r.clean, r.salaries);
  };
  // debounced auto-save: persist shortly after the last edit
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => autoSave(), 800);
    return () => clearTimeout(id);
  }, [dirty, draft]);
  const blockReason = dirty ? (buildClean(draft).error || null) : null;

  // the expanded per-employee editor — shared by the inline row and the Add-employee popup
  const editorFor = (emp) => (
            <>
              <div className="emp-section" style={{marginTop:12}}>
                <div className="field-row">
                  <div>
                    <label>Name</label>
                    <input type="text" value={emp.name} onChange={e=>setName(emp.id, e.target.value)} style={{fontWeight:600}} />
                  </div>
                  <div>
                    <label>Role</label>
                    <input type="text" list="role-options" value={emp.role ?? ""} placeholder="e.g. NP, Scribe, MA"
                      autoComplete="off" onChange={e=>setRole(emp.id, e.target.value)} />
                  </div>
                </div>
                {!emp.salaryOnly && (
                  <div className="field-row" style={{marginTop:12}}>
                    <div>
                      <label>Email (their sign-in)</label>
                      <input type="email" value={emp.email ?? ""} autoComplete="off" placeholder="name@plexusmedicalgroup.com"
                        onChange={e=>setEmail(emp.id, e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              <div className="emp-section">
                <div className="check-cluster">
                  {emp.managedBy !== "ADMIN" && (
                    <label><input type="checkbox" checked={!!emp.salaryOnly} onChange={e=>setSalaryOnly(emp.id, e.target.checked)} /> Salary only <span className="hint-sm">no login · Base only</span></label>
                  )}
                  {!emp.salaryOnly && (
                    <label><input type="checkbox" checked={!!emp.isManager} onChange={e=>setIsManager(emp.id, e.target.checked)} /> Office manager <span className="hint-sm">enters for others</span></label>
                  )}
                  {!emp.salaryOnly && !emp.isManager && (
                    <label><input type="checkbox" checked={!!emp.fixedEligible} onChange={e=>setFixedElig(emp.id, e.target.checked)} /> Consults + follow-ups <span className="hint-sm">$60 / $30</span></label>
                  )}
                </div>
              </div>

              <div className="emp-section">
                <div className="field-row">
                  <div>
                    <label>Pay type <span className="hint-sm">ADP: W-2 or 1099</span></label>
                    <select value={emp.taxType || ""} onChange={e=>setTaxType(emp.id, e.target.value)} style={{maxWidth:340}}>
                      <option value="">Auto — W-2 if salaried, otherwise 1099</option>
                      <option value="w2">W-2 employee</option>
                      <option value="1099">1099 contractor</option>
                    </select>
                  </div>
                  <div>
                    <label>Annual salary <span className="hint-sm">base · paid by ADP</span></label>
                    <input type="text" inputMode="numeric" value={emp.annualSalary ?? ""} placeholder="none"
                      onChange={e=>setSalary(emp.id, e.target.value)} />
                    {Number(emp.annualSalary) > 0 && (
                      <div className="fixed-note" style={{marginTop:4}}>{money(Number(emp.annualSalary)/periodsPerYear())} per full period · prorated by weekdays around a start / last day</div>
                    )}
                  </div>
                </div>
                <div className="field-row">
                  <div>
                    <label>PTO days <span className="hint-sm">per calendar year · resets Jan 1 · blank = none</span></label>
                    <input type="text" inputMode="decimal" value={emp.ptoDays ?? ""} placeholder="none"
                      onChange={e=>setPtoDays(emp.id, e.target.value)} />
                  </div>
                  <div>
                    <label>Shifts / month <span className="hint-sm">required · 1099 · blank = none</span></label>
                    <input type="text" inputMode="decimal" value={emp.shiftsPerMonth ?? ""} placeholder="none"
                      onChange={e=>setShifts(emp.id, e.target.value)} />
                  </div>
                </div>
                <div className="field-row">
                  <div>
                    <label>Start date <span className="hint-sm">employment start · first period prorated</span></label>
                    <input type="date" value={emp.startDate || ""} onChange={e=>setStartDate(emp.id, e.target.value)} />
                  </div>
                  <div>
                    <label>Last day <span className="hint-sm">final period prorated · blank = active</span></label>
                    <input type="date" value={emp.endDate || ""} onChange={e=>setEndDate(emp.id, e.target.value)} />
                  </div>
                </div>
                <div className="field-row">
                  {!emp.salaryOnly && !emp.isManager && (
                    <div>
                      <label>Patient cap <span className="hint-sm">salary-covered</span></label>
                      <input type="text" inputMode="numeric" value={emp.patientCap ?? ""} placeholder="none"
                        onChange={e=>setCap(emp.id, e.target.value)} />
                      {Number(emp.patientCap) > 0 && (
                        <div className="fixed-note" style={{marginTop:4}}>Certifies once/period; changing it re-prompts.</div>
                      )}
                    </div>
                  )}
                </div>
                <div style={{marginTop:12}}>
                  <label>Stipend <span className="hint-sm">$ / pay period · paid automatically</span></label>
                  <div className="stipend-row" style={{gridTemplateColumns: Number(emp.stipend) > 0 ? undefined : "84px minmax(0,1fr)"}}>
                    <input type="text" inputMode="decimal" value={emp.stipend ?? ""} placeholder="$"
                      onChange={e=>setStipend(emp.id, e.target.value)} />
                    <input type="text" value={emp.stipendNote ?? ""} placeholder="note — e.g. Parking"
                      onChange={e=>setStipendNote(emp.id, e.target.value)} />
                    {Number(emp.stipend) > 0 &&
                      <input type="date" title="Start — first period containing this date" value={emp.stipendStart || ""}
                        onChange={e=>setStipendStart(emp.id, e.target.value)} />}
                  </div>
                </div>
                {!emp.salaryOnly && !emp.isManager && (
                  <>
                    <div className="rate-grid" style={{marginTop:12}}>
                      {VARIABLE.map(t => (
                        <div className="rate-field" key={t.key}>
                          <label>{t.label} ($/{t.unit})</label>
                          <input type="number" min="0" step="0.01" placeholder="0"
                            value={emp.rates?.[t.key] ?? ""}
                            onChange={e=>setRate(emp.id, t.key, e.target.value)} />
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:12}}>
                      <label>Entered by</label>
                      <select value={emp.managedBy || ""} onChange={e=>setManagedBy(emp.id, e.target.value)} style={{maxWidth:340}}>
                        <option value="">Self — logs in &amp; enters their own</option>
                        <option value="ADMIN">Administrator — you enter their hours</option>
                        {draft.filter(m => m.isManager && m.id !== emp.id).map(m => (
                          <option key={m.id} value={m.id}>Entered by {lastFirst(m.name) || "(unnamed manager)"}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {!emp.salaryOnly && emp.isManager && (
                  <div className="hint-sm" style={{marginTop:6}}>Assign staff to this manager via each person's <strong>Entered by</strong> field.</div>
                )}
              </div>
            </>
  );

  return (
    <div className="card">
      <h2>Employees &amp; pay rates</h2>
      <p className="hint">Each person signs in with their email. Consults ($60) and follow-ups ($30) are fixed; toggle eligibility per person. Set variable rates below — leave a field blank or 0 and that pay type won't appear in their entry screen.</p>

      <div className="add-emp">
        <input type="text" placeholder="Add employee name…" value={newName}
          onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmp()} />
        <button className="btn btn-ghost" onClick={addEmp}>Add</button>
      </div>

      {draft.length===0 && <div className="empty">No employees yet. Add your first staff member above.</div>}

      {draft.length>1 && (
        <div className="rates-toolbar">
          <button onClick={expandAll}>Expand all</button>
          <button onClick={collapseAll}>Collapse all</button>
        </div>
      )}

      <datalist id="role-options">{roleOptions.map(r => <option key={r} value={r} />)}</datalist>
      <div>
      {roleGroups.map(g => (
        <div className="role-group" key={g.key}>
          <div className="role-header">{g.label} <span className="role-count">{g.emps.length}</span></div>
          {g.emps.map(emp => {
        const open = openIds.has(emp.id);
        const meta = empMeta(emp);
        return (
        <div className={"emp-rate-block" + (open ? " open" : " collapsed")} key={emp.id}>
          <div className="ename">
            <div className="emp-head" onClick={()=>toggleOpen(emp.id)}>
              <span className="emp-chev">{open ? "▾" : "▸"}</span>
              <span className="emp-name-txt">{lastFirst(emp.name) || "Unnamed employee"}</span>
              {!open && <span className={"emp-meta"+(meta.warn?" warn":"")}>{meta.user} · {meta.right}</span>}
            </div>
            {open && <button className="btn btn-danger" onClick={()=>removeEmp(emp.id)}>Remove</button>}
          </div>
          {open && editorFor(emp)}
        </div>
        );
      })}
        </div>
      ))}
      </div>

      {modalId && (() => {
        const emp = draft.find(e => e.id === modalId);
        if (!emp) return null;
        return (
          <div className="modal-backdrop" onClick={()=>setModalId(null)}>
            <div className="modal emp-modal" onClick={e=>e.stopPropagation()}>
              <div className="pto-head"><h3>Add employee</h3><button className="btn btn-ghost" onClick={cancelNewEmp}>Cancel</button></div>
              {editorFor(emp)}
              <div className="modal-actions" style={{marginTop:14, alignItems:"center", justifyContent:"space-between"}}>
                <span style={{fontSize:13, fontWeight:500, color: blockReason ? "var(--amber)" : "var(--accent-ink)"}}>
                  {saving ? "Saving…" : blockReason ? blockReason : dirty ? "Saving…" : "✓ Saved"}
                </span>
                <button className="btn" onClick={()=>setModalId(null)}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      {draft.length>0 && (
        <div className="actions" style={{justifyContent:"flex-end", alignItems:"center"}}>
          <span style={{fontSize:13, fontWeight:500, color: blockReason ? "var(--amber)" : "var(--accent-ink)"}}>
            {saving ? "Saving…" : blockReason ? blockReason : dirty ? "Saving…" : "✓ All changes saved"}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- all entries (audit / delete) ---------- */
function AllEntries({ employees, entries, deleteEntry, showToast }) {
  const nameOf = e => { const m = employees.find(x=>x.id===e.empId); return m ? m.name : (e.username ? e.username + " (removed)" : "—"); };
  const sorted = [...entries].sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  const del = async (entry) => {
    await deleteEntry(entry);
    showToast("Entry deleted");
  };

  const summarize = (entry) => {
    const parts = ALL_TYPES.filter(t => Number(entry.counts?.[t.key]||0) > 0)
      .map(t => `${entry.counts[t.key]} ${t.label.toLowerCase()}`);
    if (entry.other && Number(entry.other.amount) > 0)
      parts.push(`Other ${money(entry.other.amount)}${entry.other.note ? " ("+entry.other.note+")" : ""}`);
    return parts.join(", ") || "—";
  };

  if (!entries.length) return <div className="card"><div className="empty">No entries logged yet.</div></div>;

  return (
    <div className="card">
      <h2>All entries</h2>
      <p className="hint">Every logged entry. Delete any mistakes here.</p>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Date</th><th>Employee</th><th>Logged</th><th className="num">Pay</th><th></th></tr></thead>
          <tbody>
            {sorted.map(e => {
              const emp = employees.find(x=>x.id===e.empId);
              return (
                <tr key={(e._uid||"")+e.id}>
                  <td style={{whiteSpace:"nowrap"}}>{e.date}</td>
                  <td>{lastFirst(nameOf(e))}</td>
                  <td style={{color:"var(--muted)"}}>{summarize(e)}</td>
                  <td className="num pay">{money(payForEntry(emp, e))}</td>
                  <td style={{textAlign:"right"}}><button className="btn btn-danger" style={{padding:"5px 12px"}} onClick={()=>del(e)}>Delete</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function mountApp() {
  ReactDOM.createRoot(document.getElementById("root")).render(<App />);
}
if (window._firebaseReady) {
  mountApp();
} else {
  window.addEventListener("firebase-ready", mountApp, { once: true });
  // safety: if firebase never signals within 8s, show a clear message
  setTimeout(() => {
    if (!window._firebaseReady) {
      document.getElementById("root").innerHTML =
        '<div style="max-width:560px;margin:60px auto;padding:24px;border:1px solid #e6e4dc;border-radius:14px;font-family:-apple-system,sans-serif;color:#1c1c1a;background:#fff;">' +
        '<h2 style="margin:0 0 8px;font-size:18px;">Can\u2019t reach the database</h2>' +
        '<p style="margin:0;color:#6b6b66;line-height:1.5;">The Firebase config at the top of this file is missing or incorrect, so data can\u2019t load. Double-check that you pasted your own Firebase config values (no <code>PASTE_</code> placeholders left).</p></div>';
    }
  }, 8000);
}
