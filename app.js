const { useState, useEffect, useCallback, useRef } = React;
const OWNER_UIDS = ["plexusOwnerNeil"];
const isOwnerUser = (u) => !!u && OWNER_UIDS.includes(String(u.uid || ""));
const PTO_ADMIN_UIDS = [];
const isPtoAdminUid = (uid) => !!uid && PTO_ADMIN_UIDS.includes(uid);
const FIXED = [
  { key: "consults", label: "Consults", rate: 60, unit: "ea" },
  { key: "followups", label: "Follow-ups", rate: 30, unit: "ea" }
];
const VARIABLE = [
  { key: "clinic_pts", label: "Clinic Patients", unit: "patient", decimal: false },
  { key: "perdiem", label: "Per diem", unit: "days", decimal: false },
  { key: "clinic_hr", label: "Clinic hourly", unit: "hrs", decimal: true },
  { key: "virtual_hr", label: "Virtual hourly", unit: "hrs", decimal: true },
  { key: "hosp_hr", label: "In-hospital hourly", unit: "hrs", decimal: true }
];
const ALL_TYPES = [...FIXED, ...VARIABLE];
const OTHER_ENABLED = false;
const PTO_ENABLED = true;
const ptoVisibleFor = () => PTO_ENABLED;
const ptoEligible = (emp) => !!emp && ptoVisibleFor(emp.username) && Number(emp.ptoDays) > 0;
const ROLE_CANON = ["MD", "NP", "Staff", "Scribe"];
const ROLE_RANK = { md: 0, np: 1, staff: 2, scribe: 3 };
const ROLE_LABEL = { md: "MD", np: "NP", staff: "Staff", scribe: "Scribe" };
function ptoYearStartDate(startDate) {
  return null;
  if (!startDate) return null;
  const s = parseDate(startDate);
  if (isNaN(s)) return null;
  const t = parseDate(todayISO());
  let y = t.getFullYear();
  if (t < new Date(y, s.getMonth(), s.getDate())) y -= 1;
  return new Date(y, s.getMonth(), s.getDate());
}
const localISO = (dt) => dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
const ptoDayValue = (r) => r && r.half ? 0.5 : 1;
const isFixed = (key) => FIXED.some((f) => f.key === key);
const isDecimal = (key) => VARIABLE.some((v) => v.key === key && v.decimal);
const payForCounts = (counts, emp) => ALL_TYPES.reduce((s, t) => {
  const qty = Number((counts || {})[t.key] || 0);
  const rate = isFixed(t.key) ? t.rate : Number(emp && emp.rates ? emp.rates[t.key] : 0) || 0;
  return s + qty * rate;
}, 0);
const qtyRound = (key, v) => isDecimal(key) ? Math.round(v * 100) / 100 : Math.round(v);
const QTY_MAX = { perdiem: 1, clinic_hr: 9, virtual_hr: 8, hosp_hr: 12 };
const capQty = (key, v) => QTY_MAX[key] != null ? Math.min(QTY_MAX[key], v) : v;
const mergeSalaryDraft = (emps, sal) => emps.map((e) => ({ ...e, annualSalary: sal && sal[e.id] != null ? String(sal[e.id]) : "" }));
const normU = (s) => String(s || "").trim().toLowerCase();
const CRED_SUFFIX = /* @__PURE__ */ new Set(["np", "md", "do", "pa", "rn", "aprn", "fnp", "dnp", "crna", "pac", "pa-c", "msn", "apn", "facp"]);
const lastNameKey = (name) => {
  const w = String(name || "").trim().toLowerCase().replace(/[.,]/g, "").split(/\s+/).filter((x) => x && !CRED_SUFFIX.has(x));
  return (w[w.length - 1] || "") + " " + (w[0] || "");
};
const lastFirst = (name) => {
  const raw = String(name || "").trim();
  if (!raw || /\(removed\)/i.test(raw)) return raw;
  const words = raw.split(/\s+/);
  const creds = [];
  while (words.length > 2 && CRED_SUFFIX.has(words[words.length - 1].toLowerCase().replace(/[.,]/g, ""))) creds.unshift(words.pop());
  if (words.length < 2) return raw;
  const last = words.pop();
  return last + ", " + words.join(" ") + (creds.length ? " " + creds.join(" ") : "");
};
const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString(void 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CT_TZ = "America/Chicago";
const todayISO = () => (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: CT_TZ });
const nowCT = () => new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: CT_TZ }));
function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtISO(dt) {
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}
function addDays(dt, n) {
  const x = new Date(dt);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtShort(iso) {
  const d = parseDate(iso);
  return d.toLocaleDateString(void 0, { month: "short", day: "numeric" });
}
function fmtShortYr(iso) {
  const d = parseDate(iso);
  return d.toLocaleDateString(void 0, { month: "short", day: "numeric", year: "numeric" });
}
function proratedBase(annual, period, emp) {
  const full = Number(annual) > 0 ? Number(annual) / periodsPerYear() : 0;
  if (!full || !period) return { base: 0, days: 0, of: 0 };
  const isISO = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const sd = emp && emp.startDate, ed = emp && emp.endDate;
  const from = isISO(sd) && sd > period.start ? sd : period.start;
  const to = isISO(ed) && ed < period.end ? ed : period.end;
  const countDays = (a, b) => {
    let n = 0;
    for (let d = parseDate(a); fmtISO(d) <= b; d = addDays(d, 1)) if (d.getDay() >= 1 && d.getDay() <= 5) n++;
    return n;
  };
  const of = countDays(period.start, period.end);
  if (from > to) return { base: 0, days: 0, of };
  const days = countDays(from, to);
  if (days >= of) return { base: full, days: of, of };
  return { base: full * days / of, days, of };
}
const DEFAULT_PAY_CFG = { cycle: "monthly", payday: 10, lockHours: 48 };
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function periodModel(cfgIn) {
  const cfg = { ...DEFAULT_PAY_CFG, ...cfgIn || {} };
  const lockHours = Number(cfg.lockHours) > 0 ? Number(cfg.lockHours) : DEFAULT_PAY_CFG.lockHours;
  const lockFor = (payday) => {
    const l = new Date(payday);
    l.setHours(0, 0, 0, 0);
    l.setHours(l.getHours() - lockHours);
    return l;
  };
  const mk = (i, start, end, payday) => ({
    index: i,
    start: fmtISO(start),
    end: fmtISO(end),
    payday: fmtISO(payday),
    lockAt: lockFor(payday),
    label: fmtShort(fmtISO(start)) + " \u2013 " + fmtShort(fmtISO(end)),
    paydayLabel: fmtShort(fmtISO(payday))
  });
  if (cfg.cycle === "biweekly") {
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.anchor || "")) ? cfg.anchor : "2026-06-14";
    const LEN = 14, off = Number(cfg.paydayOffset) >= 0 ? Number(cfg.paydayOffset) : 6;
    return {
      cfg,
      perYear: 26,
      periodIndexFor: (iso) => Math.floor(Math.floor((parseDate(iso) - parseDate(anchor)) / 864e5) / LEN),
      periodByIndex: (i) => {
        const start = addDays(parseDate(anchor), i * LEN), end = addDays(start, LEN - 1);
        return mk(i, start, end, addDays(end, off));
      },
      describe: "Pay periods run Sunday\u2013Saturday (14 days), paid " + off + " days after close; a period locks " + lockHours + " hours before payday."
    };
  }
  const EPOCH_YEAR = 2026;
  const payDay = Math.min(28, Math.max(1, Math.round(Number(cfg.payday)) || DEFAULT_PAY_CFG.payday));
  return {
    cfg,
    perYear: 12,
    periodIndexFor: (iso) => {
      const [y, m] = String(iso).split("-").map(Number);
      return (y - EPOCH_YEAR) * 12 + (m - 1);
    },
    periodByIndex: (i) => {
      const y = EPOCH_YEAR + Math.floor(i / 12), m = (i % 12 + 12) % 12;
      return mk(i, new Date(y, m, 1), new Date(y, m + 1, 0), new Date(y, m + 1, payDay));
    },
    describe: "Pay periods are calendar months, paid on the " + ordinal(payDay) + " of the following month; a period locks " + lockHours + " hours before payday."
  };
}
let PM = periodModel(DEFAULT_PAY_CFG);
function setPeriodModel(cfg) {
  PM = periodModel(cfg);
  return PM;
}
function periodsPerYear() {
  return PM.perYear;
}
function periodDescription() {
  return PM.describe;
}
function periodIndexFor(iso) {
  return PM.periodIndexFor(iso);
}
function periodByIndex(i) {
  return PM.periodByIndex(i);
}
function periodDayList(p) {
  const out = [];
  for (let d = parseDate(p.start); fmtISO(d) <= p.end; d = addDays(d, 1)) out.push(fmtISO(d));
  return out;
}
function isPeriodLocked(p, now = nowCT()) {
  return now >= p.lockAt;
}
function isPeriodLockedCombined(periodIndex, manualLocks, manualUnlocks = [], now = nowCT()) {
  if (Array.isArray(manualUnlocks) && manualUnlocks.includes(periodIndex)) return false;
  if (Array.isArray(manualLocks) && manualLocks.includes(periodIndex)) return true;
  return isPeriodLocked(periodByIndex(periodIndex), now);
}
function dateInLockedPeriod(iso, manualLocks, manualUnlocks = [], now = nowCT()) {
  return isPeriodLockedCombined(periodIndexFor(iso), manualLocks, manualUnlocks, now);
}
function currentPeriodIndex() {
  return periodIndexFor(todayISO());
}
function periodList(back = 8, fwd = 2) {
  const c = currentPeriodIndex();
  const out = [];
  for (let i = c + fwd; i >= c - back; i--) out.push(periodByIndex(i));
  return out;
}
const stipendFor = (emp, period) => {
  const amt = Number(emp && emp.stipend) || 0;
  if (amt <= 0 || !period) return 0;
  const s = emp.stipendStart;
  return !s || s <= period.end ? amt : 0;
};
async function sGet(eid, key, fallback) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "meta", key);
    const snap = await window._fs.getDoc(ref);
    if (snap.exists() && snap.data() && "value" in snap.data()) return snap.data().value;
    return fallback;
  } catch (e) {
    console.error("read failed", e);
    return fallback;
  }
}
async function sSet(eid, key, val) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "meta", key);
    await window._fs.setDoc(ref, { value: val });
    return true;
  } catch (e) {
    console.error("write failed", e);
    return false;
  }
}
async function loadEntriesForUid(eid, uid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    const snap = await window._fs.getDoc(ref);
    if (snap.exists() && snap.data() && "value" in snap.data()) return snap.data().value || [];
    return [];
  } catch (e) {
    console.error("entries read failed", e);
    return [];
  }
}
async function saveEntriesForUid(eid, uid, val) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { value: val }, { merge: true });
    return true;
  } catch (e) {
    console.error("entries write failed", e);
    return false;
  }
}
async function loadCertsForUid(eid, uid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    const snap = await window._fs.getDoc(ref);
    if (snap.exists() && snap.data() && snap.data().certs) return snap.data().certs;
    return {};
  } catch (e) {
    return {};
  }
}
async function saveCertForUid(eid, uid, periodIdx, cap, atISO) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { certs: { [String(periodIdx)]: { cap, at: atISO } } }, { merge: true });
    return true;
  } catch (e) {
    console.error("cert write failed", e);
    return false;
  }
}
let UID_BY_EMP = {};
const resolveUidForEmp = (eid, empId, entries) => (UID_BY_EMP[eid] || {})[empId] || ((entries || []).find((e) => e.empId === empId) || {})._uid || null;
async function loadAllEntries(eid) {
  try {
    const snap = await window._fs.getDocs(window._fs.collection(window._db, "pay", eid, "entries"));
    const all = [], byEntries = {}, byMarker = {};
    snap.forEach((d) => {
      if (d.id === SALARY_DOC || d.id === ADJ_DOC) return;
      const data = d.data() || {};
      const isEmpDoc = String(d.id).startsWith("emp_");
      if (data.empId && !isEmpDoc) byMarker[data.empId] = d.id;
      const v = data.value;
      if (!Array.isArray(v)) return;
      if (!isEmpDoc) v.forEach((e) => {
        if (e && e.empId) byEntries[e.empId] = d.id;
      });
      v.forEach((e) => all.push({ ...e, _uid: d.id }));
    });
    UID_BY_EMP[eid] = { ...byEntries, ...byMarker };
    return all;
  } catch (e) {
    console.error("all-entries read failed", e);
    return [];
  }
}
async function loadPto(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "pto", uid));
    return snap.exists() && Array.isArray(snap.data()?.value) ? snap.data().value : [];
  } catch (e) {
    return [];
  }
}
async function savePto(eid, uid, list) {
  try {
    await window._fs.setDoc(window._fs.doc(window._db, "pay", eid, "pto", uid), { value: list });
    return true;
  } catch (e) {
    console.error("pto write failed", e);
    return false;
  }
}
async function loadAllPto(eid) {
  try {
    const snap = await window._fs.getDocs(window._fs.collection(window._db, "pay", eid, "pto"));
    const all = [];
    snap.forEach((d) => {
      const v = d.data()?.value;
      if (Array.isArray(v)) v.forEach((r) => all.push({ ...r, _uid: d.id }));
    });
    return all;
  } catch (e) {
    console.error("all-pto read failed", e);
    return [];
  }
}
async function loadPtoAdmin(eid) {
  const v = await sGet(eid, "ptoAdmin", {});
  return v && typeof v === "object" ? v : {};
}
async function savePtoAdmin(eid, map) {
  return await sSet(eid, "ptoAdmin", map);
}
const SALARY_DOC = "salaries";
async function loadSalaries(eid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", SALARY_DOC);
    const snap = await window._fs.getDoc(ref);
    if (snap.exists() && snap.data() && snap.data().value) return snap.data().value;
    return {};
  } catch (e) {
    return {};
  }
}
async function saveSalaries(eid, map) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", SALARY_DOC);
    await window._fs.setDoc(ref, { value: map });
    return true;
  } catch (e) {
    console.error("salaries write failed", e);
    return false;
  }
}
async function loadMySalary(eid, uid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    const snap = await window._fs.getDoc(ref);
    return snap.exists() && snap.data() && Number(snap.data().salary) || 0;
  } catch (e) {
    return 0;
  }
}
async function saveMySalary(eid, uid, annual) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { salary: Number(annual) || 0 }, { merge: true });
    return true;
  } catch (e) {
    console.error("my-salary write failed", e);
    return false;
  }
}
const ADJ_DOC = "adjustments";
async function loadAdjustments(eid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", ADJ_DOC);
    const snap = await window._fs.getDoc(ref);
    return snap.exists() && snap.data() && snap.data().value || {};
  } catch (e) {
    return {};
  }
}
async function saveAdjustments(eid, map) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", ADJ_DOC);
    await window._fs.setDoc(ref, { value: map });
    return true;
  } catch (e) {
    console.error("adjustments write failed", e);
    return false;
  }
}
async function loadMyAdj(eid, uid) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    const snap = await window._fs.getDoc(ref);
    return snap.exists() && snap.data() && snap.data().adj || {};
  } catch (e) {
    return {};
  }
}
async function saveMyAdj(eid, uid, map) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { adj: map }, { merge: true });
    return true;
  } catch (e) {
    console.error("my-adj write failed", e);
    return false;
  }
}
async function loadMyRoster(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "entries", uid));
    const r = snap.exists() && snap.data() && snap.data().roster;
    return Array.isArray(r) ? r : null;
  } catch (e) {
    return null;
  }
}
async function loadMyAdminPto(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "entries", uid));
    return snap.exists() && snap.data() && snap.data().adminPto || {};
  } catch (e) {
    return {};
  }
}
async function saveMyMirror(eid, uid, roster, adminPto, isManager) {
  try {
    const ref = window._fs.doc(window._db, "pay", eid, "entries", uid);
    await window._fs.setDoc(ref, { roster, adminPto, isManager: !!isManager }, { merge: true });
    return true;
  } catch (e) {
    console.error("mirror write failed", e);
    return false;
  }
}
async function loadVisibleRoster(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "meta", "employees"));
    const v = snap.exists() && snap.data() && snap.data().value;
    if (Array.isArray(v) && v.length) return v;
  } catch (e) {
  }
  return await loadMyRoster(eid, uid) || [];
}
async function loadVisibleAdminPto(eid, uid) {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "pay", eid, "meta", "ptoAdmin"));
    const v = snap.exists() && snap.data() && snap.data().value;
    if (v && typeof v === "object" && Object.keys(v).length) return v;
  } catch (e) {
  }
  return await loadMyAdminPto(eid, uid);
}
const ptoRosterRow = (s) => {
  const o = { id: s.id, name: s.name, salaryOnly: !!s.salaryOnly };
  if (s.ptoDays != null) o.ptoDays = s.ptoDays;
  if (s.startDate) o.startDate = s.startDate;
  return o;
};
function scopedRosterFor(emp, all, ptoApprover) {
  if (!emp) return [];
  const out = [emp];
  if (emp.isManager) {
    for (const s of all || []) if (s && s.managedBy === emp.id) out.push(s);
  }
  if (ptoApprover) {
    for (const s of all || []) if (s && !out.some((x) => x.id === s.id)) out.push(ptoRosterRow(s));
  }
  return out;
}
function scopedAdminPtoFor(emp, all, ptoAdmin, ptoApprover) {
  if (!emp) return {};
  if (ptoApprover) return { ...ptoAdmin || {} };
  const ids = /* @__PURE__ */ new Set([emp.id]);
  if (emp.isManager) {
    for (const s of all || []) if (s && s.managedBy === emp.id) ids.add(s.id);
  }
  const out = {};
  for (const id of ids) if ((ptoAdmin || {})[id]) out[id] = ptoAdmin[id];
  return out;
}
function ManagerView({ manager, employees, entries, upsertEntry, manualLocks, manualUnlocks, showToast }) {
  const managed = employees.filter((e) => e.managedBy === manager.id);
  const [selId, setSelId] = useState(() => managed[0] ? managed[0].id : null);
  const sel = managed.find((e) => e.id === selId) || managed[0] || null;
  if (!managed.length) {
    return /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("div", { className: "empty" }, `No staff are assigned to you yet. Ask the owner to set someone's "Entered by" to your name in Employees & rates.`));
  }
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("h2", { style: { marginTop: 0 } }, "Enter hours for staff"), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Pick whose hours you're entering, then fill their days below. Switching keeps each person separate."), /* @__PURE__ */ React.createElement("div", { className: "manager-picker" }, managed.map((e) => /* @__PURE__ */ React.createElement("button", { key: e.id, className: "btn " + (sel && e.id === sel.id ? "btn-primary" : "btn-ghost"), onClick: () => setSelId(e.id) }, e.name)))), sel && /* @__PURE__ */ React.createElement(EntryView, { key: sel.id, emp: sel, entries, upsertEntry, certs: {}, certifyPeriod: () => {
  }, manualLocks, manualUnlocks, showToast }));
}
function PtoCalendar({ pto, allowance, startDate, onSubmit, onClose, onCancel, allowPast }) {
  const todayStr = todayISO();
  const t0 = parseDate(todayStr);
  const [calY, setCalY] = useState(t0.getFullYear());
  const [calM, setCalM] = useState(t0.getMonth());
  const [sel, setSel] = useState({});
  const byDate = {};
  for (const r of pto || []) byDate[r.date] = r;
  const yStart = ptoYearStartDate(startDate);
  const wStart = yStart ? localISO(yStart) : null;
  const wEnd = yStart ? localISO(new Date(yStart.getFullYear() + 1, yStart.getMonth(), yStart.getDate())) : null;
  const inThisYear = (date) => wStart ? date >= wStart && date < wEnd : String(date || "").slice(0, 4) === String(t0.getFullYear());
  const usedApproved = (pto || []).filter((r) => r.status === "approved" && inThisYear(r.date)).reduce((s, r) => s + ptoDayValue(r), 0);
  const requestedDays = (pto || []).filter((r) => r.status === "requested").reduce((s, r) => s + ptoDayValue(r), 0);
  const selDays = Object.values(sel).reduce((s, v) => s + (v.half ? 0.5 : 1), 0);
  const allow = Number(allowance) || 0;
  const remaining = Math.max(0, allow - usedApproved);
  const first = new Date(calY, calM, 1);
  const monthName = first.toLocaleDateString(void 0, { month: "long", year: "numeric" });
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  const dim = new Date(calY, calM + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) cells.push(new Date(calY, calM, d));
  const cycle = (ds) => setSel((s) => {
    const cur = s[ds];
    const next = { ...s };
    if (!cur) next[ds] = { half: false };
    else if (!cur.half) next[ds] = { half: true };
    else delete next[ds];
    return next;
  });
  const prevM = () => {
    if (calM === 0) {
      setCalM(11);
      setCalY(calY - 1);
    } else setCalM(calM - 1);
  };
  const nextM = () => {
    if (calM === 11) {
      setCalM(0);
      setCalY(calY + 1);
    } else setCalM(calM + 1);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "modal-backdrop", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal pto-modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "pto-head" }, /* @__PURE__ */ React.createElement("h3", null, allowPast ? "Enter PTO" : "Request PTO"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", style: { padding: "4px 10px" }, onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "pto-counter" }, /* @__PURE__ */ React.createElement("strong", null, remaining), " of ", allow, " day", allow === 1 ? "" : "s", " left", requestedDays > 0 ? /* @__PURE__ */ React.createElement("span", null, " \xB7 ", requestedDays, " requested") : null, selDays > 0 ? /* @__PURE__ */ React.createElement("span", null, " \xB7 selecting ", selDays) : null), /* @__PURE__ */ React.createElement("div", { className: "pto-monthnav" }, /* @__PURE__ */ React.createElement("button", { onClick: prevM, "aria-label": "Previous month" }, "\u2039"), /* @__PURE__ */ React.createElement("span", null, monthName), /* @__PURE__ */ React.createElement("button", { onClick: nextM, "aria-label": "Next month" }, "\u203A")), /* @__PURE__ */ React.createElement("div", { className: "pto-grid" }, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => /* @__PURE__ */ React.createElement("div", { key: "dow" + i, className: "pto-dow" }, d[0])), cells.map((dt, i) => {
    if (!dt) return /* @__PURE__ */ React.createElement("div", { key: "b" + i, className: "pto-cell blank" });
    const ds = localISO(dt);
    const past = ds < todayStr;
    const ex = byDate[ds];
    const ss = sel[ds];
    const hardLocked = past && !allowPast || ex && ex.status === "approved";
    let cls = "pto-cell";
    if (ex && ex.status === "approved") cls += " approved";
    else if (ex && ex.status === "requested") cls += " requested";
    else if (ss) cls += ss.half ? " sel half" : " sel";
    else if (past && !allowPast) cls += " muted";
    return /* @__PURE__ */ React.createElement("div", { key: ds, className: cls, onClick: () => {
      if (hardLocked) return;
      if (ex && ex.status === "requested") {
        onCancel && onCancel(ds);
        return;
      }
      cycle(ds);
    } }, dt.getDate(), ss && ss.half || ex && ex.half ? /* @__PURE__ */ React.createElement("span", { className: "half-mark" }, "\xBD") : null);
  })), /* @__PURE__ */ React.createElement("div", { className: "pto-legend" }, /* @__PURE__ */ React.createElement("span", { className: "lg sel" }), " requested\xA0\xA0\xA0", /* @__PURE__ */ React.createElement("span", { className: "lg approved" }), " approved"), /* @__PURE__ */ React.createElement("div", { className: "pto-actions" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancel"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", disabled: selDays === 0, onClick: () => onSubmit(sel) }, "Submit", selDays > 0 ? " (" + selDays + "d)" : ""))));
}
function PtoAdmin({ employees, allPto, onSetStatus, onAddPto, showToast }) {
  const [addFor, setAddFor] = useState(null);
  const nameOf = (empId) => {
    const e = employees.find((x) => x.id === empId);
    return e ? lastFirst(e.name) : empId;
  };
  const sortedEmps = employees.filter((e) => !e.salaryOnly || Number(e.ptoDays) > 0).slice().sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
  const sm = { padding: "5px 11px", fontSize: 13 };
  const byDate = {};
  for (const r of allPto || []) if (r.status === "requested" || r.status === "approved") (byDate[r.date] = byDate[r.date] || []).push(r);
  const overlapsFor = (rec) => (byDate[rec.date] || []).filter((o) => o.empId !== rec.empId);
  return /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("h2", null, "Time off"), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Approve or deny requested PTO \u2014 one at a time or all of a person's at once. \u26A0 marks days when someone else is also off."), /* @__PURE__ */ React.createElement("div", { className: "emp-section" }, /* @__PURE__ */ React.createElement("label", null, "Enter PTO for someone (added as approved)"), /* @__PURE__ */ React.createElement("select", { value: "", onChange: (e) => {
    const emp = employees.find((x) => x.id === e.target.value);
    if (emp) setAddFor(emp);
  }, style: { maxWidth: 340 } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Choose an employee\u2026"), sortedEmps.map((e) => /* @__PURE__ */ React.createElement("option", { key: e.id, value: e.id }, lastFirst(e.name))))), addFor && /* @__PURE__ */ React.createElement(
    PtoCalendar,
    {
      pto: allPto.filter((r) => r.empId === addFor.id),
      allowance: addFor.ptoDays,
      startDate: addFor.startDate,
      allowPast: true,
      onClose: () => setAddFor(null),
      onSubmit: (sel) => {
        onAddPto(addFor, sel);
        setAddFor(null);
        showToast && showToast("PTO added for " + addFor.name);
      }
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "emp-section" }, /* @__PURE__ */ React.createElement("label", null, "PTO by employee"), (() => {
    const withPto = employees.filter((e) => Number(e.ptoDays) > 0 || (allPto || []).some((r) => r.empId === e.id)).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
    if (!withPto.length) return /* @__PURE__ */ React.createElement("div", { className: "empty" }, "No PTO allowances or records yet.");
    return withPto.map((e) => {
      const recs = (allPto || []).filter((r) => r.empId === e.id).slice().sort((a, b) => a.date.localeCompare(b.date));
      const yStart = ptoYearStartDate(e.startDate);
      const wStart = yStart ? localISO(yStart) : null;
      const wEnd = yStart ? localISO(new Date(yStart.getFullYear() + 1, yStart.getMonth(), yStart.getDate())) : null;
      const inYear = (d) => wStart ? d >= wStart && d < wEnd : String(d || "").slice(0, 4) === todayISO().slice(0, 4);
      const used = recs.filter((r) => r.status === "approved" && inYear(r.date)).reduce((s, r) => s + ptoDayValue(r), 0);
      const pend = recs.filter((r) => r.status === "requested");
      const pendDays = pend.reduce((s, r) => s + ptoDayValue(r), 0);
      const allow = Number(e.ptoDays) || 0;
      const left = Math.max(0, allow - used);
      const pendItems = pend.map((r) => ({ _uid: r._uid, id: r.id }));
      return /* @__PURE__ */ React.createElement("div", { className: "pto-group", key: "sum" + e.id }, /* @__PURE__ */ React.createElement("div", { className: "pto-group-head" }, /* @__PURE__ */ React.createElement("strong", null, lastFirst(e.name)), /* @__PURE__ */ React.createElement("span", { className: "pto-group-count" }, allow > 0 ? `${used} used of ${allow} \xB7 ${left} left` : `${used} used (no allowance set)`, pendDays > 0 ? ` \xB7 ${pendDays} pending` : ""), pend.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", style: sm, onClick: () => onSetStatus(pendItems, "approved") }, "Approve all"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", style: { ...sm, marginLeft: 8 }, onClick: () => onSetStatus(pendItems, null) }, "Deny all"))), recs.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "pto-req" }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--muted)" } }, "No days recorded.")), recs.map((r) => {
        const ov = r.status === "requested" ? overlapsFor(r) : [];
        const item = r._admin ? { _admin: true, empId: r.empId, id: r.id } : { _uid: r._uid, id: r.id };
        return /* @__PURE__ */ React.createElement("div", { className: "pto-req", key: r.id }, /* @__PURE__ */ React.createElement("span", null, fmtShortYr(r.date), r.half ? " \xB7 \xBD day" : "", /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 8, fontSize: 12, color: r.status === "requested" ? "var(--amber)" : "var(--muted)" } }, r.status === "requested" ? "requested" : r._admin ? "approved \xB7 admin-entered" : "approved"), !inYear(r.date) && r.status === "approved" ? /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 8, fontSize: 12, color: "var(--faint)" } }, "(outside current PTO year)") : null, ov.length ? /* @__PURE__ */ React.createElement("span", { className: "pto-overlap" }, " \u26A0 also off: ", ov.map((o) => nameOf(o.empId)).join(", ")) : null), /* @__PURE__ */ React.createElement("span", { style: { whiteSpace: "nowrap" } }, r.status === "requested" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", style: sm, onClick: () => onSetStatus([item], "approved") }, "Approve"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", style: { ...sm, marginLeft: 8 }, onClick: () => onSetStatus([item], null) }, "Deny")) : /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", style: sm, onClick: () => onSetStatus([item], null) }, "Remove")));
      }));
    });
  })()));
}
function EntityApp({ eid, payCfg, authUser, header }) {
  setPeriodModel(payCfg);
  const [loaded, setLoaded] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const [tab, setTab] = useState("entry");
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [certs, setCerts] = useState({});
  const [salaries, setSalaries] = useState({});
  const [mySalary, setMySalary] = useState(0);
  const [adjustments, setAdjustments] = useState({});
  const [myAdj, setMyAdj] = useState({});
  const [pto, setPto] = useState([]);
  const [allPto, setAllPto] = useState([]);
  const [ptoAdmin, setPtoAdmin] = useState({});
  const [impersonate, setImpersonate] = useState(null);
  const [impersonateDoc, setImpersonateDoc] = useState(null);
  const [impersonateCerts, setImpersonateCerts] = useState({});
  const [manualLocks, setManualLocks] = useState([]);
  const [manualUnlocks, setManualUnlocks] = useState([]);
  const [toast, setToast] = useState("");
  const isOwner = isOwnerUser(authUser);
  const uid = authUser ? authUser.uid : null;
  const myEmp = authUser && !isOwner ? employees.find((e) => {
    const ae = String(authUser.email || "").toLowerCase();
    return !!ae && String(e.email || "").trim().toLowerCase() === ae;
  }) : null;
  const adminPtoFlat = Object.entries(ptoAdmin || {}).flatMap(([empId, list]) => (Array.isArray(list) ? list : []).map((r) => ({ ...r, empId, _admin: true })));
  const allPtoMerged = [...allPto, ...adminPtoFlat];
  const myPtoMerged = [...pto, ...myEmp ? adminPtoFlat.filter((r) => r.empId === myEmp.id) : []];
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }, []);
  const refreshBusy = useRef(false);
  const refresh = useCallback(async (user) => {
    const u = user || window._auth && window._auth.currentUser;
    if (!u) {
      setEmployees([]);
      setEntries([]);
      setManualLocks([]);
      setManualUnlocks([]);
      return;
    }
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    try {
      const owner = isOwnerUser(u);
      const [emps, locks, unlocks, entries2, certs2, salaries2, mySalary2, adjustments2, myAdj2, myPto, everyPto, adminPto] = await Promise.all([
        loadVisibleRoster(eid, u.uid),
        // owner: full roster; everyone else (incl. managers): own mirror
        sGet(eid, "manualLocks", []),
        sGet(eid, "manualUnlocks", []),
        owner ? loadAllEntries(eid) : loadEntriesForUid(eid, u.uid),
        owner ? Promise.resolve({}) : loadCertsForUid(eid, u.uid),
        owner ? loadSalaries(eid) : Promise.resolve({}),
        owner ? Promise.resolve(0) : loadMySalary(u.uid),
        owner ? loadAdjustments(eid) : Promise.resolve({}),
        owner ? Promise.resolve({}) : loadMyAdj(u.uid),
        loadPto(eid, u.uid),
        // the user's own PTO (owner has one too)
        owner || isPtoAdminUid(u.uid) ? loadAllPto(eid) : Promise.resolve([]),
        // owner + PTO approver: everyone's PTO
        loadVisibleAdminPto(eid, u.uid)
        // owner: all admin PTO; NP: own scoped mirror
      ]);
      const setIfChanged = (setter, next) => setter((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
      setIfChanged(setEmployees, emps && emps.length ? emps : []);
      setIfChanged(setManualLocks, Array.isArray(locks) ? locks : []);
      setIfChanged(setManualUnlocks, Array.isArray(unlocks) ? unlocks : []);
      setIfChanged(setEntries, entries2);
      setIfChanged(setCerts, certs2);
      setIfChanged(setSalaries, salaries2);
      setMySalary(mySalary2);
      setIfChanged(setAdjustments, adjustments2);
      setIfChanged(setMyAdj, myAdj2);
      setIfChanged(setPto, Array.isArray(myPto) ? myPto : []);
      setIfChanged(setAllPto, Array.isArray(everyPto) ? everyPto : []);
      setIfChanged(setPtoAdmin, adminPto && typeof adminPto === "object" ? adminPto : {});
      setSyncedAt(/* @__PURE__ */ new Date());
    } finally {
      refreshBusy.current = false;
    }
  }, [eid]);
  useEffect(() => {
    let dead = false;
    refresh(authUser).then(() => {
      if (!dead) setLoaded(true);
    });
    return () => {
      dead = true;
    };
  }, [refresh, authUser]);
  useEffect(() => {
    const pull = () => {
      if (window._auth && window._auth.currentUser && !document.hidden) refresh();
    };
    const onVis = () => {
      if (!document.hidden) pull();
    };
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(pull, 6e4);
    return () => {
      window.removeEventListener("focus", pull);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(id);
    };
  }, [refresh]);
  useEffect(() => {
    if (!uid || !isOwner || !window._fs || !window._fs.onSnapshot) return;
    const ref = window._fs.doc(window._db, "pay", eid, "meta", "employees");
    const unsub = window._fs.onSnapshot(ref, (snap) => {
      const v = snap.exists() && snap.data() ? snap.data().value : [];
      const next = Array.isArray(v) ? v : [];
      setEmployees((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    }, () => {
    });
    return () => {
      try {
        unsub && unsub();
      } catch (e) {
      }
    };
  }, [uid]);
  const stampedRef = useRef(false);
  useEffect(() => {
    if (!uid || isOwner || !myEmp || stampedRef.current) return;
    stampedRef.current = true;
    try {
      window._fs.setDoc(
        window._fs.doc(window._db, "pay", eid, "entries", uid),
        { empId: myEmp.id, username: normU(myEmp.username) },
        { merge: true }
      ).catch(() => {
      });
    } catch (e) {
    }
  }, [uid, isOwner, myEmp && myEmp.id]);
  const healedRef = useRef(false);
  useEffect(() => {
    if (!isOwner || healedRef.current) return;
    if (!entries.length && !Object.keys(salaries || {}).length) return;
    healedRef.current = true;
    const uidOf = (empId) => {
      const viaReg = resolveUidForEmp(eid, empId, entries);
      if (viaReg && !String(viaReg).startsWith("emp_")) return viaReg;
      const viaPto = (allPto.find((r) => r.empId === empId && r._uid && !String(r._uid).startsWith("emp_")) || {})._uid;
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
          const m = { bonus: Number(a.bonus) || 0, reimbursement: Number(a.reimbursement) || 0 };
          if (a.stipend != null && a.stipend !== "") m.stipend = Number(a.stipend) || 0;
          (byEmp[empId] = byEmp[empId] || {})[pIdx] = m;
        }
      for (const [empId, perPeriod] of Object.entries(byEmp)) {
        const docId = uidOf(empId);
        if (docId) await saveMyAdj(eid, docId, perPeriod);
      }
      for (const e of employees || []) {
        const docId = uidOf(e.id);
        if (docId) await saveMyMirror(eid, docId, scopedRosterFor(e, employees, isPtoAdminUid(docId)), scopedAdminPtoFor(e, employees, ptoAdmin, isPtoAdminUid(docId)), !!e.isManager);
      }
    })().catch(() => {
    });
  }, [isOwner, entries, salaries, adjustments, allPto, employees, ptoAdmin]);
  const persistEmployees = useCallback(async (next) => {
    setEmployees(next);
    await sSet(eid, "employees", next);
    for (const e of next) {
      const docId = resolveUidForEmp(eid, e.id, entries);
      if (docId && !String(docId).startsWith("emp_"))
        await saveMyMirror(eid, docId, scopedRosterFor(e, next, isPtoAdminUid(docId)), scopedAdminPtoFor(e, next, ptoAdmin, isPtoAdminUid(docId)), !!e.isManager);
    }
  }, [entries, ptoAdmin]);
  const mirrorTarget = useCallback((empId) => {
    const docId = resolveUidForEmp(eid, empId, entries);
    return docId && !String(docId).startsWith("emp_") ? docId : null;
  }, [entries]);
  const persistSalaries = useCallback(async (map) => {
    setSalaries(map);
    await saveSalaries(eid, map);
    for (const [empId, annual] of Object.entries(map)) {
      const docId = mirrorTarget(empId);
      if (docId) await saveMySalary(eid, docId, annual);
    }
  }, [mirrorTarget]);
  const persistAdjustments = useCallback(async (map) => {
    setAdjustments(map);
    await saveAdjustments(eid, map);
    const byEmp = {};
    for (const [pIdx, perEmp] of Object.entries(map || {}))
      for (const [empId, a] of Object.entries(perEmp || {})) {
        const m = { bonus: Number(a.bonus) || 0, reimbursement: Number(a.reimbursement) || 0 };
        if (a.stipend != null && a.stipend !== "") m.stipend = Number(a.stipend) || 0;
        (byEmp[empId] = byEmp[empId] || {})[pIdx] = m;
      }
    for (const [empId, perPeriod] of Object.entries(byEmp)) {
      const docId = mirrorTarget(empId);
      if (docId) await saveMyAdj(eid, docId, perPeriod);
    }
  }, [mirrorTarget]);
  const setPtoStatus = useCallback(async (items, newStatus) => {
    const adminItems = items.filter((it) => it._admin);
    const regItems = items.filter((it) => !it._admin);
    const byUid = {};
    for (const it of regItems) (byUid[it._uid] = byUid[it._uid] || []).push(it.id);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const whoBy = String(window._auth && window._auth.currentUser && window._auth.currentUser.email || "admin").toLowerCase();
    const approvedRecs = [];
    for (const [docId, ids] of Object.entries(byUid)) {
      const latest = await loadPto(eid, docId);
      const next = newStatus === null ? latest.filter((r) => !ids.includes(r.id)) : latest.map((r) => ids.includes(r.id) ? { ...r, status: newStatus, approvedAt: now, approvedBy: whoBy } : r);
      if (newStatus === "approved") approvedRecs.push(...latest.filter((r) => ids.includes(r.id)));
      await savePto(eid, docId, next);
    }
    if (adminItems.length || approvedRecs.length) {
      const map = await loadPtoAdmin(eid);
      for (const it of adminItems)
        map[it.empId] = (map[it.empId] || []).filter((r) => r.id !== it.id);
      for (const r of approvedRecs)
        if (map[r.empId]) map[r.empId] = map[r.empId].filter((a) => a.date !== r.date);
      for (const k of Object.keys(map)) if (!map[k] || !map[k].length) delete map[k];
      await savePtoAdmin(eid, map);
      setPtoAdmin(await loadPtoAdmin(eid));
    }
    setAllPto(await loadAllPto(eid));
  }, []);
  const addPtoForEmployee = useCallback(async (emp, sel) => {
    if (!emp) return;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const map = await loadPtoAdmin(eid);
    const list = Array.isArray(map[emp.id]) ? map[emp.id] : [];
    const taken = /* @__PURE__ */ new Set([
      ...list.map((r) => r.date),
      ...allPto.filter((r) => r.empId === emp.id).map((r) => r.date)
    ]);
    const fresh = Object.entries(sel || {}).filter(([date]) => !taken.has(date)).map(([date, v]) => ({
      id: "pto_" + date + "_" + Math.random().toString(36).slice(2, 6),
      empId: emp.id,
      date,
      half: !!(v && v.half),
      status: "approved",
      approvedAt: now,
      by: String(window._auth && window._auth.currentUser && window._auth.currentUser.email || "admin").toLowerCase()
    }));
    if (!fresh.length) return;
    map[emp.id] = [...list, ...fresh];
    await savePtoAdmin(eid, map);
    setPtoAdmin(await loadPtoAdmin(eid));
  }, [allPto]);
  const setPeriodLock = useCallback(async (periodIndex, shouldLock) => {
    const curLocks = new Set(await sGet(eid, "manualLocks", []) || []);
    const curUnlocks = new Set(await sGet(eid, "manualUnlocks", []) || []);
    if (shouldLock) {
      curLocks.add(periodIndex);
      curUnlocks.delete(periodIndex);
    } else {
      curUnlocks.add(periodIndex);
      curLocks.delete(periodIndex);
    }
    const nextLocks = [...curLocks], nextUnlocks = [...curUnlocks];
    setManualLocks(nextLocks);
    setManualUnlocks(nextUnlocks);
    await sSet(eid, "manualLocks", nextLocks);
    await sSet(eid, "manualUnlocks", nextUnlocks);
  }, []);
  const upsertEntry = useCallback(async (entry) => {
    if (!uid) return { saved: false };
    const latest = await loadEntriesForUid(eid, uid);
    const rest = latest.filter((e) => !(e.empId === entry.empId && e.date === entry.date));
    const hasCounts = entry.counts && Object.values(entry.counts).some((v) => Number(v) > 0);
    const hasOther = entry.other && Number(entry.other.amount) > 0;
    const hasAny = hasCounts || hasOther;
    const next = hasAny ? [...rest, entry] : rest;
    const ok = await saveEntriesForUid(eid, uid, next);
    if (ok) setEntries(next);
    return { saved: ok, hasAny };
  }, [uid]);
  const certifyPeriod = useCallback(async (periodIdx, cap) => {
    if (!uid) return;
    const at = (/* @__PURE__ */ new Date()).toISOString();
    setCerts((c) => ({ ...c, [String(periodIdx)]: { cap, at } }));
    await saveCertForUid(eid, uid, periodIdx, cap, at);
  }, [uid]);
  const requestPto = useCallback(async (sel) => {
    if (!uid) return;
    const empId = myEmp && myEmp.id || null;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const latest = await loadPto(eid, uid);
    const taken = new Set(latest.map((r) => r.date));
    const fresh = Object.entries(sel || {}).filter(([date]) => !taken.has(date)).map(([date, v]) => ({ id: "pto_" + date + "_" + Math.random().toString(36).slice(2, 6), empId, date, half: !!(v && v.half), status: "requested", requestedAt: now }));
    if (!fresh.length) return true;
    const merged = [...latest, ...fresh];
    const ok = await savePto(eid, uid, merged);
    if (ok) setPto(merged);
    return ok;
  }, [uid, myEmp]);
  const cancelPto = useCallback(async (date) => {
    if (!uid) return;
    const latest = await loadPto(eid, uid);
    const next = latest.filter((r) => !(r.date === date && r.status === "requested"));
    if (next.length === latest.length) return;
    setPto(next);
    await savePto(eid, uid, next);
  }, [uid]);
  const startImpersonate = useCallback(async (emp) => {
    if (!emp) return;
    let docId;
    if (emp.isManager) {
      const managedIds = new Set(employees.filter((e) => e.managedBy === emp.id).map((e) => e.id));
      docId = (entries.find((e) => managedIds.has(e.empId)) || {})._uid || resolveUidForEmp(eid, emp.id, entries) || emp.id;
    } else {
      docId = resolveUidForEmp(eid, emp.id, entries) || emp.id;
    }
    setImpersonateDoc(docId);
    setImpersonateCerts({});
    setImpersonate(emp);
    try {
      window.scrollTo(0, 0);
    } catch (e) {
    }
    loadCertsForUid(eid, docId).then(setImpersonateCerts).catch(() => {
    });
  }, [entries, employees]);
  const exitImpersonate = useCallback(() => {
    setImpersonate(null);
    setImpersonateDoc(null);
    setImpersonateCerts({});
  }, []);
  const upsertForImpersonated = useCallback(async (entry) => {
    const docId = impersonateDoc || impersonate && impersonate.id;
    if (!docId) return { saved: false };
    const latest = await loadEntriesForUid(eid, docId);
    const rest = latest.filter((e) => !(e.empId === entry.empId && e.date === entry.date));
    const hasCounts = entry.counts && Object.values(entry.counts).some((v) => Number(v) > 0);
    const hasOther = entry.other && Number(entry.other.amount) > 0;
    const hasAny = hasCounts || hasOther;
    const next = hasAny ? [...rest, entry] : rest;
    const ok = await saveEntriesForUid(eid, docId, next);
    if (ok) setEntries(await loadAllEntries(eid));
    return { saved: ok, hasAny };
  }, [impersonate, impersonateDoc]);
  const certifyForImpersonated = useCallback(async (periodIdx, cap) => {
    const docId = impersonateDoc || impersonate && impersonate.id;
    if (!docId) return;
    const at = (/* @__PURE__ */ new Date()).toISOString();
    setImpersonateCerts((c) => ({ ...c, [String(periodIdx)]: { cap, at } }));
    await saveCertForUid(eid, docId, periodIdx, cap, at);
  }, [impersonate, impersonateDoc]);
  const requestPtoForImpersonated = useCallback(async (sel) => {
    const docId = impersonateDoc;
    if (!docId || !impersonate) return;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const latest = await loadPto(eid, docId);
    const taken = new Set(latest.map((r) => r.date));
    const fresh = Object.entries(sel || {}).filter(([date]) => !taken.has(date)).map(([date, v]) => ({ id: "pto_" + date + "_" + Math.random().toString(36).slice(2, 6), empId: impersonate.id, date, half: !!(v && v.half), status: "requested", requestedAt: now, by: "admin" }));
    if (!fresh.length) return;
    await savePto(eid, docId, [...latest, ...fresh]);
    setAllPto(await loadAllPto(eid));
  }, [impersonate, impersonateDoc]);
  const cancelPtoForImpersonated = useCallback(async (date) => {
    const docId = impersonateDoc;
    if (!docId) return;
    const latest = await loadPto(eid, docId);
    const next = latest.filter((r) => !(r.date === date && r.status === "requested"));
    if (next.length === latest.length) return;
    await savePto(eid, docId, next);
    setAllPto(await loadAllPto(eid));
  }, [impersonate, impersonateDoc]);
  const deleteOwnerEntry = useCallback(async (entry) => {
    if (!entry || !entry._uid) return;
    const latest = await loadEntriesForUid(eid, entry._uid);
    await saveEntriesForUid(eid, entry._uid, latest.filter((e) => e.id !== entry.id));
    setEntries(await loadAllEntries(eid));
  }, []);
  if (!loaded) return /* @__PURE__ */ React.createElement("div", { className: "wrap" }, header, /* @__PURE__ */ React.createElement("div", { className: "empty" }, "Loading\u2026"));
  return /* @__PURE__ */ React.createElement("div", { className: "wrap" + (isOwner && !impersonate ? " wide" : "") }, header, isOwner && impersonate && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "impersonate-bar" }, /* @__PURE__ */ React.createElement("span", null, "\u{1F441} Viewing as ", /* @__PURE__ */ React.createElement("strong", null, lastFirst(impersonate.name)), impersonate.isManager ? " (office manager) \u2014 their staff page" : " \u2014 edits save to their record (audit)."), /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: exitImpersonate }, "Exit view")), impersonate.isManager ? /* @__PURE__ */ React.createElement(
    ManagerView,
    {
      key: impersonate.id,
      manager: impersonate,
      employees,
      entries,
      upsertEntry: upsertForImpersonated,
      manualLocks,
      manualUnlocks,
      showToast
    }
  ) : /* @__PURE__ */ React.createElement(
    EntryView,
    {
      key: impersonate.id,
      emp: impersonate,
      entries,
      upsertEntry: upsertForImpersonated,
      certs: impersonateCerts,
      certifyPeriod: certifyForImpersonated,
      manualLocks,
      manualUnlocks,
      audit: true,
      baseSalary: salaries[impersonate.id],
      empAdj: (() => {
        const o = {};
        for (const [p, byEmp] of Object.entries(adjustments || {})) if (byEmp && byEmp[impersonate.id]) o[p] = byEmp[impersonate.id];
        return o;
      })(),
      pto: allPtoMerged.filter((r) => r.empId === impersonate.id),
      ptoAllowance: impersonate.ptoDays,
      ptoStartDate: impersonate.startDate,
      onRequestPto: ptoEligible(impersonate) ? requestPtoForImpersonated : void 0,
      onCancelPto: ptoEligible(impersonate) ? cancelPtoForImpersonated : void 0,
      showToast
    }
  )), isOwner && !impersonate && /* @__PURE__ */ React.createElement(
    OwnerView,
    {
      employees,
      entries,
      salaries,
      adjustments,
      manualLocks,
      manualUnlocks,
      setPeriodLock,
      persistEmployees,
      persistSalaries,
      persistAdjustments,
      deleteEntry: deleteOwnerEntry,
      allPto: allPtoMerged,
      onSetPtoStatus: setPtoStatus,
      onAddPto: addPtoForEmployee,
      onViewAs: startImpersonate,
      syncedAt,
      onRefresh: refresh,
      showToast
    }
  ), authUser && !isOwner && (!myEmp ? /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("div", { className: "empty" }, "You're signed in, but your account isn't in the roster yet. Ask the owner to add your email in Employees & rates, then sign out and back in.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, isPtoAdminUid(uid) && /* @__PURE__ */ React.createElement("div", { className: "tabs" }, /* @__PURE__ */ React.createElement("button", { className: "tab" + (tab !== "pto" ? " active" : ""), onClick: () => setTab("entry") }, "My pay"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (tab === "pto" ? " active" : ""), onClick: () => setTab("pto") }, "Time off", (() => {
    const n = allPtoMerged.filter((r) => r.status === "requested").length;
    return n ? " (" + n + ")" : "";
  })())), isPtoAdminUid(uid) && tab === "pto" ? /* @__PURE__ */ React.createElement(PtoAdmin, { employees, allPto: allPtoMerged, onSetStatus: setPtoStatus, onAddPto: addPtoForEmployee, showToast }) : myEmp.isManager ? /* @__PURE__ */ React.createElement(ManagerView, { manager: myEmp, employees, entries, upsertEntry, manualLocks, manualUnlocks, showToast }) : myEmp.managedBy ? /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("div", { className: "empty" }, "Your hours are entered for you \u2014 there's nothing to log here. Reach out to the office if something looks off.")) : /* @__PURE__ */ React.createElement(
    EntryView,
    {
      emp: myEmp,
      entries,
      upsertEntry,
      certs,
      certifyPeriod,
      manualLocks,
      manualUnlocks,
      baseSalary: mySalary,
      empAdj: myAdj,
      pto: myPtoMerged,
      ptoAllowance: myEmp && myEmp.ptoDays,
      ptoStartDate: myEmp && myEmp.startDate,
      onRequestPto: ptoEligible(myEmp) ? requestPto : void 0,
      onCancelPto: ptoEligible(myEmp) ? cancelPto : void 0,
      showToast
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "toast" + (toast ? " show" : "") }, toast));
}
async function loadEntities() {
  try {
    const snap = await window._fs.getDoc(window._fs.doc(window._db, "plexus", "entities"));
    const v = snap.exists() && snap.data() && snap.data().value;
    return v && typeof v === "object" ? v : {};
  } catch (e) {
    console.error("entities read failed", e);
    return {};
  }
}
async function loadPayConfig(eid) {
  const v = await sGet(eid, "config", null);
  return v && typeof v === "object" ? v : DEFAULT_PAY_CFG;
}
async function probeMyEntities(uid, eids) {
  const hits = await Promise.all(eids.map(async (eid) => {
    const r = await loadMyRoster(eid, uid);
    return Array.isArray(r) && r.length ? eid : null;
  }));
  return hits.filter(Boolean);
}
function BrandMark() {
  return /* @__PURE__ */ React.createElement("svg", { className: "brand-mark", viewBox: "0 0 120 120", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("g", { fill: "none", stroke: "currentColor", strokeWidth: "9", strokeLinecap: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M32 32 60 60M88 32 60 60M32 88 60 60M88 88 60 60" })), /* @__PURE__ */ React.createElement("g", { fill: "currentColor" }, /* @__PURE__ */ React.createElement("circle", { cx: "32", cy: "32", r: "8.5" }), /* @__PURE__ */ React.createElement("circle", { cx: "88", cy: "32", r: "8.5" }), /* @__PURE__ */ React.createElement("circle", { cx: "32", cy: "88", r: "8.5" }), /* @__PURE__ */ React.createElement("circle", { cx: "88", cy: "88", r: "8.5" })), /* @__PURE__ */ React.createElement("circle", { cx: "60", cy: "60", r: "12", fill: "var(--fx, currentColor)" }));
}
function App() {
  const [authUser, setAuthUser] = useState(void 0);
  const [entities, setEntities] = useState(null);
  const [payCfgs, setPayCfgs] = useState({});
  const [eids, setEids] = useState(null);
  const [eid, setEid] = useState(null);
  const [toast, setToast] = useState("");
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }, []);
  useEffect(() => {
    if (!window._auth || !window._authfns) {
      setAuthUser(null);
      return;
    }
    return window._authfns.onAuthStateChanged(window._auth, (u) => setAuthUser(u || null));
  }, []);
  useEffect(() => {
    if (!authUser) {
      setEntities(null);
      setEids(null);
      setEid(null);
      return;
    }
    let dead = false;
    (async () => {
      const ents = await loadEntities();
      const active = Object.entries(ents).filter(([, e]) => e && e.active !== false).map(([id]) => id).sort();
      const mine = isOwnerUser(authUser) ? active : await probeMyEntities(authUser.uid, active);
      const cfgs = {};
      await Promise.all(mine.map(async (id) => {
        cfgs[id] = await loadPayConfig(id);
      }));
      if (dead) return;
      setEntities(ents);
      setPayCfgs(cfgs);
      setEids(mine);
      setEid((prev) => prev && mine.includes(prev) ? prev : mine[0] || null);
    })();
    return () => {
      dead = true;
    };
  }, [authUser]);
  const signOutNow = useCallback(async () => {
    try {
      await window._authfns.signOut(window._auth);
    } catch (e) {
    }
    try {
      window.location.replace(window.location.pathname + "?v=" + Date.now());
    } catch (e) {
      try {
        window.location.reload();
      } catch (e2) {
        showToast("Signed out");
      }
    }
  }, [showToast]);
  const entityName = (id) => entities && entities[id] && entities[id].name || id;
  const header = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "brand-header" }, /* @__PURE__ */ React.createElement(BrandMark, null), /* @__PURE__ */ React.createElement("div", { className: "brand-word" }, /* @__PURE__ */ React.createElement("span", { className: "brand-name" }, "PLEXUS"), /* @__PURE__ */ React.createElement("span", { className: "brand-sub" }, "MANAGEMENT GROUP"))), authUser && /* @__PURE__ */ React.createElement("div", { className: "topbar" }, /* @__PURE__ */ React.createElement("h1", null, "Pay Tracker", eid && eids && eids.length === 1 ? /* @__PURE__ */ React.createElement("span", { className: "topbar-entity" }, " \xB7 ", entityName(eid)) : null), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", style: { fontSize: 13, padding: "6px 12px" }, onClick: signOutNow }, "Sign out")), authUser && eids && eids.length > 1 && /* @__PURE__ */ React.createElement("div", { className: "tabs entity-tabs", role: "tablist", "aria-label": "Entity" }, eids.map((id) => /* @__PURE__ */ React.createElement("button", { key: id, role: "tab", "aria-selected": id === eid, className: "tab" + (id === eid ? " active" : ""), onClick: () => setEid(id) }, entityName(id)))));
  const toastEl = /* @__PURE__ */ React.createElement("div", { className: "toast" + (toast ? " show" : "") }, toast);
  if (authUser === void 0) return /* @__PURE__ */ React.createElement("div", { className: "wrap" }, header, /* @__PURE__ */ React.createElement("div", { className: "empty" }, "Loading\u2026"));
  if (!authUser) return /* @__PURE__ */ React.createElement("div", { className: "wrap" }, header, /* @__PURE__ */ React.createElement(LoginScreen, { showToast }), toastEl);
  if (!eids) return /* @__PURE__ */ React.createElement("div", { className: "wrap" }, header, /* @__PURE__ */ React.createElement("div", { className: "empty" }, "Loading\u2026"));
  if (!eids.length) return /* @__PURE__ */ React.createElement("div", { className: "wrap" }, header, /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("div", { className: "empty" }, "You're signed in, but your account isn't on any roster yet. Ask the owner to add your email in Employees & rates, then sign out and back in.")), toastEl);
  return /* @__PURE__ */ React.createElement(EntityApp, { key: eid, eid, payCfg: payCfgs[eid], authUser, header });
}
function LoginScreen({ showToast }) {
  return /* @__PURE__ */ React.createElement("div", { className: "card lock-screen" }, /* @__PURE__ */ React.createElement(EmailLogin, { showToast }));
}
function EmailLogin({ showToast }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    if (e) e.preventDefault();
    setErr("");
    const em = String(email || "").trim().toLowerCase();
    if (!em || !em.includes("@")) {
      setErr("Enter the email your account is set up with.");
      return;
    }
    setBusy(true);
    try {
      await window._authfns.signInWithEmailAndPassword(window._auth, em, pw);
    } catch (ex) {
      setErr("Wrong email or password. New here? Use \u201CForgot password\u201D or ask the admin.");
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setErr("");
    const em = String(email || "").trim().toLowerCase();
    if (!em || !em.includes("@")) {
      setErr("Enter your email first, then tap \u201CForgot password\u201D.");
      return;
    }
    setBusy(true);
    try {
      await window._authfns.sendPasswordResetEmail(window._auth, em);
      showToast("If that email has an account, a reset link is on its way.");
    } catch (ex) {
      setErr("Couldn\u2019t send a reset link. Check the email or ask the admin.");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ React.createElement("form", { onSubmit: submit }, /* @__PURE__ */ React.createElement("h2", null, "Sign in"), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Enter your email and password. Your browser can save these."), /* @__PURE__ */ React.createElement("label", null, "Email"), /* @__PURE__ */ React.createElement("input", { type: "email", autoComplete: "username", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com", autoFocus: true }), /* @__PURE__ */ React.createElement("div", { style: { height: 12 } }), /* @__PURE__ */ React.createElement("label", null, "Password"), /* @__PURE__ */ React.createElement("input", { type: "password", autoComplete: "current-password", value: pw, onChange: (e) => setPw(e.target.value) }), err && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { color: "var(--danger)", marginTop: 8 } }, err), /* @__PURE__ */ React.createElement("div", { style: { height: 14 } }), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary", style: { width: "100%" }, disabled: busy }, busy ? "Signing in\u2026" : "Sign in"), /* @__PURE__ */ React.createElement("div", { style: { height: 8 } }), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", style: { width: "100%", fontSize: 13 }, onClick: reset, disabled: busy }, "Forgot password?"));
}
function EntryView({ emp, entries, upsertEntry, certs, certifyPeriod, manualLocks, manualUnlocks, showToast, audit, baseSalary, empAdj, pto, ptoAllowance, ptoStartDate, onRequestPto, onCancelPto }) {
  const [ptoOpen, setPtoOpen] = useState(false);
  const ptoEnabled = !!onRequestPto;
  const approvedPto = (pto || []).filter((r) => r.status === "approved" && r.date >= todayISO()).sort((a, b) => a.date.localeCompare(b.date));
  const requestedPto = (pto || []).filter((r) => r.status === "requested" && r.date >= todayISO()).sort((a, b) => a.date.localeCompare(b.date));
  const ptoFmt = (list) => list.map((r) => fmtShort(r.date) + (r.half ? " \xBD" : "")).join(", ");
  const [date, setDate] = useState(todayISO());
  const [counts, setCounts] = useState({});
  const [shift, setShift] = useState("regular");
  const [periodIdx, setPeriodIdx] = useState(currentPeriodIndex());
  const [otherOn, setOtherOn] = useState(false);
  const [otherAmt, setOtherAmt] = useState("");
  const [otherNote, setOtherNote] = useState("");
  const [entryDirty, setEntryDirty] = useState(false);
  const [entrySaving, setEntrySaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const entryDirtyRef = useRef(false);
  const markEntryDirty = () => {
    entryDirtyRef.current = true;
    setEntryDirty(true);
  };
  const clearEntryDirty = () => {
    entryDirtyRef.current = false;
    setEntryDirty(false);
  };
  const dateLocked = date ? dateInLockedPeriod(date, manualLocks, manualUnlocks) : false;
  const maxPeriodIdx = currentPeriodIndex();
  const period = periodByIndex(periodIdx);
  const periodDays = periodDayList(period);
  const leadBlanks = parseDate(period.start).getDay();
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayEntries = (iso) => emp ? entries.filter((e) => e.empId === emp.id && e.date === iso) : [];
  const dayDollars = (iso) => dayEntries(iso).reduce((s, e) => s + payForEntry(emp, e), 0);
  const periodDollars = periodDays.reduce((s, iso) => s + dayDollars(iso), 0);
  const cap = Number(emp && emp.patientCap) || 0;
  const capped = cap > 0;
  const cert = certs && certs[String(periodIdx)];
  const certifiedForPeriod = !capped || cert && Number(cert.cap) === cap;
  const onExtraShift = capped && shift === "extra";
  const gateOpen = certifiedForPeriod || onExtraShift || !!audit;
  const basePr = proratedBase(baseSalary, period, emp);
  const basePeriod = basePr.base;
  const baseProrated = basePr.days > 0 && basePr.days < basePr.of;
  const periodAdj = empAdj && empAdj[String(periodIdx)] || {};
  const periodBonus = Number(periodAdj.bonus) || 0;
  const periodReimb = Number(periodAdj.reimbursement) || 0;
  const periodStipend = periodAdj.stipend != null && periodAdj.stipend !== "" ? Number(periodAdj.stipend) || 0 : emp ? stipendFor(emp, period) : 0;
  const periodLabel = fmtShortYr(period.start) + " \u2013 " + fmtShortYr(period.end);
  useEffect(() => {
    if (periodIndexFor(date) !== periodIdx) setDate(period.start);
  }, [periodIdx]);
  useEffect(() => {
    if (!emp) return;
    const es = dayEntries(date);
    const merged = {};
    es.forEach((e) => Object.entries(e.counts || {}).forEach(([k, v]) => {
      merged[k] = (merged[k] || 0) + Number(v || 0);
    }));
    setCounts(merged);
    const withShift = es.find((e) => e.shift);
    setShift(withShift && withShift.shift === "extra" ? "extra" : "regular");
    const withOther = es.find((e) => e.other && Number(e.other.amount) > 0);
    if (withOther) {
      setOtherOn(true);
      setOtherAmt(String(withOther.other.amount));
      setOtherNote(withOther.other.note || "");
    } else {
      setOtherOn(false);
      setOtherAmt("");
      setOtherNote("");
    }
    clearEntryDirty();
  }, [date, emp && emp.id]);
  const visibleTypes = emp ? ALL_TYPES.filter((t) => {
    if (isFixed(t.key)) return !!emp.fixedEligible;
    const r = emp.rates?.[t.key];
    return r != null && Number(r) > 0;
  }) : [];
  const noPayTypes = !!emp && visibleTypes.length === 0 && !OTHER_ENABLED;
  const typeCount = (key, raw) => {
    if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
    if (raw !== "" && QTY_MAX[key] != null && Number(raw) > QTY_MAX[key]) raw = String(QTY_MAX[key]);
    setCounts((c) => ({ ...c, [key]: raw }));
    markEntryDirty();
  };
  const bump = (key, delta) => {
    setCounts((c) => {
      const n = capQty(key, Math.max(0, qtyRound(key, Number(c[key] || 0) + delta)));
      return { ...c, [key]: n };
    });
    markEntryDirty();
  };
  const liveTotal = (emp ? visibleTypes.reduce((sum, t) => {
    const qty = Number(counts[t.key] || 0);
    const rate = isFixed(t.key) ? t.rate : Number(emp.rates?.[t.key] || 0);
    return sum + qty * rate;
  }, 0) : 0) + (otherOn && Number(otherAmt) > 0 ? Number(otherAmt) : 0);
  const buildEntry = () => {
    if (!emp) return { skip: true };
    let other = null;
    if (otherOn) {
      if (!(Number(otherAmt) > 0) || !otherNote.trim()) return { incomplete: true };
      other = { amount: Math.round(Number(otherAmt) * 100) / 100, note: otherNote.trim() };
    }
    const cleanCounts = {};
    Object.keys(counts).forEach((k) => {
      const n = capQty(k, qtyRound(k, Number(counts[k] || 0)));
      if (n > 0) cleanCounts[k] = n;
    });
    const existing = dayEntries(date);
    if (!Object.keys(cleanCounts).length && !other && existing.length === 0) return { skip: true };
    const id = existing[0] && existing[0].id || "e_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const entry = { id, empId: emp.id, username: normU(emp.username), date, counts: cleanCounts };
    if (other) entry.other = other;
    if (capped) entry.shift = shift;
    return { entry };
  };
  const saveEntry = async () => {
    if (date > todayISO()) {
      clearEntryDirty();
      return;
    }
    const r = buildEntry();
    if (r.incomplete) return;
    if (r.skip) {
      clearEntryDirty();
      return;
    }
    setEntrySaving(true);
    const res = await upsertEntry(r.entry);
    setEntrySaving(false);
    if (!res || res.saved === false) {
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    clearEntryDirty();
  };
  const flushEntry = () => {
    if (entryDirtyRef.current) saveEntry();
  };
  useEffect(() => {
    if (!entryDirty) return;
    const id = setTimeout(() => saveEntry(), 700);
    return () => clearTimeout(id);
  }, [entryDirty, counts, otherOn, otherAmt, otherNote]);
  return /* @__PURE__ */ React.createElement("div", { className: "card" }, ptoOpen && /* @__PURE__ */ React.createElement(
    PtoCalendar,
    {
      pto,
      allowance: ptoAllowance,
      startDate: ptoStartDate,
      onClose: () => setPtoOpen(false),
      onCancel: (date2) => {
        onCancelPto && onCancelPto(date2);
        showToast && showToast("PTO request canceled");
      },
      onSubmit: async (sel) => {
        const ok = await onRequestPto(sel);
        setPtoOpen(false);
        showToast && showToast(ok === false ? "\u26A0 Couldn't submit your PTO request \u2014 try again" : "PTO request submitted");
      }
    }
  ), /* @__PURE__ */ React.createElement("h2", null, noPayTypes ? "Your pay" : "Log your work"), /* @__PURE__ */ React.createElement("p", { className: "hint" }, noPayTypes ? /* @__PURE__ */ React.createElement(React.Fragment, null, "Signed in as ", /* @__PURE__ */ React.createElement("strong", null, emp.name), ". You're salaried \u2014 there's nothing to log day-to-day.") : /* @__PURE__ */ React.createElement(React.Fragment, null, "Logging as ", /* @__PURE__ */ React.createElement("strong", null, emp.name), ". Tap a day below to add or edit it.")), ptoEnabled && /* @__PURE__ */ React.createElement("div", { className: "pto-line" }, approvedPto.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "pto-status" }, "Approved PTO: ", ptoFmt(approvedPto)), requestedPto.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "pto-status pending" }, "Requested PTO: ", ptoFmt(requestedPto), " \xB7 pending"), /* @__PURE__ */ React.createElement("a", { className: "pto-link", onClick: () => setPtoOpen(true) }, "Request PTO")), emp && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { height: 22 } }), /* @__PURE__ */ React.createElement("div", { className: "period-nav" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => {
    flushEntry();
    setPeriodIdx((i) => i - 1);
  }, "aria-label": "Previous pay period" }, "\u2039"), /* @__PURE__ */ React.createElement("div", { className: "pn-label" }, fmtShortYr(period.start), " \u2013 ", fmtShortYr(period.end)), /* @__PURE__ */ React.createElement("button", { onClick: () => {
    flushEntry();
    setPeriodIdx((i) => Math.min(maxPeriodIdx, i + 1));
  }, disabled: periodIdx >= maxPeriodIdx, "aria-label": "Next pay period" }, "\u203A")), /* @__PURE__ */ React.createElement("div", { className: "period-total" }, basePeriod > 0 || periodBonus > 0 || periodReimb > 0 || periodStipend > 0 ? /* @__PURE__ */ React.createElement("div", { className: "pay-breakdown" }, basePeriod > 0 && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Base", baseProrated ? " (prorated " + basePr.days + "/" + basePr.of + " weekdays)" : ""), /* @__PURE__ */ React.createElement("span", { className: "pay" }, money(basePeriod))), (!noPayTypes || periodDollars > 0) && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Variable"), /* @__PURE__ */ React.createElement("span", { className: "pay" }, money(periodDollars))), periodBonus > 0 && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Bonus"), /* @__PURE__ */ React.createElement("span", { className: "pay" }, money(periodBonus))), periodReimb > 0 && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Reimbursement"), /* @__PURE__ */ React.createElement("span", { className: "pay" }, money(periodReimb))), periodStipend > 0 && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, emp && String(emp.stipendNote || "").trim() || "Stipend"), /* @__PURE__ */ React.createElement("span", { className: "pay" }, money(periodStipend))), /* @__PURE__ */ React.createElement("div", { className: "pay-total" }, /* @__PURE__ */ React.createElement("span", null, "Total"), /* @__PURE__ */ React.createElement("span", { className: "pay" }, money(basePeriod + periodDollars + periodBonus + periodReimb + periodStipend)))) : /* @__PURE__ */ React.createElement("span", null, "This period:", /* @__PURE__ */ React.createElement("span", { className: "pay", style: { marginLeft: 6 } }, money(periodDollars))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", marginTop: 4 } }, "Payday ", period.paydayLabel))), !noPayTypes && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { height: 12 } }), /* @__PURE__ */ React.createElement("div", { className: "week-grid" }, DOW.map((d) => /* @__PURE__ */ React.createElement("div", { className: "dow", key: "dow-" + d }, d)), Array.from({ length: leadBlanks }, (_, i) => /* @__PURE__ */ React.createElement("div", { className: "day-cell pad", key: "pad-" + i, "aria-hidden": "true" })), periodDays.map((iso) => {
    const logged = dayEntries(iso).length > 0;
    const locked = dateInLockedPeriod(iso, manualLocks, manualUnlocks);
    const future = iso > todayISO();
    const cls = "day-cell" + (iso === date ? " selected" : "") + (logged ? " logged" : "") + (iso === todayISO() ? " today" : "") + (locked ? " locked" : "") + (future ? " future" : "");
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cls,
        key: iso,
        title: future ? "Can't log a future date" : void 0,
        onClick: () => {
          if (future) return;
          flushEntry();
          setDate(iso);
        }
      },
      /* @__PURE__ */ React.createElement("div", { className: "dnum" }, parseDate(iso).getDate(), locked ? " \u{1F512}" : ""),
      logged ? /* @__PURE__ */ React.createElement("div", { className: "damt" }, money(dayDollars(iso))) : /* @__PURE__ */ React.createElement("div", { className: "dempty" }, "\u2014")
    );
  })), dateLocked && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { color: "var(--amber)", marginTop: 12 } }, "Heads up: ", fmtShortYr(date), " is in a pay period that's already locked for payroll. You can still save, but the owner will be notified it came in late."))), emp && capped && !dateLocked && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("label", { style: { marginBottom: 6 } }, "Shift type for ", fmtShort(date)), /* @__PURE__ */ React.createElement("div", { className: "tabs", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("button", { className: "tab" + (shift === "regular" ? " active" : ""), onClick: () => {
    if (shift !== "regular") {
      setShift("regular");
      markEntryDirty();
    }
  } }, "Regular shift"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (shift === "extra" ? " active" : ""), onClick: () => {
    if (shift !== "extra") {
      setShift("extra");
      markEntryDirty();
    }
  } }, "Extra shift")), onExtraShift && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { marginTop: 8, color: "var(--accent-ink)" } }, "Extra shift \u2014 not covered by your salary cap. Log ", /* @__PURE__ */ React.createElement("strong", null, "every"), " patient you saw; no certification needed.")), emp && capped && shift === "regular" && !certifiedForPeriod && !audit && /* @__PURE__ */ React.createElement("div", { className: "cap-gate" }, /* @__PURE__ */ React.createElement("div", { className: "cap-gate-title" }, "\u26A0 Salary cap"), /* @__PURE__ */ React.createElement("div", { className: "cap-gate-body" }, "Your salary covers your first ", /* @__PURE__ */ React.createElement("strong", null, cap), " patients this pay period (", periodLabel, "). Only log ", /* @__PURE__ */ React.createElement("strong", null, "additional"), " consults / follow-ups here."), /* @__PURE__ */ React.createElement("label", { className: "cap-gate-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: false, onChange: () => certifyPeriod(periodIdx, cap) }), /* @__PURE__ */ React.createElement("span", null, "I certify I've met my ", cap, "-patient cap this period and these are additional patients."))), emp && capped && shift === "regular" && !certifiedForPeriod && audit && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { marginTop: 14, color: "var(--amber)" } }, "\u26A0 Hasn't certified the ", cap, "-patient cap this period \u2014 you're editing as owner (audit)."), emp && capped && shift === "regular" && certifiedForPeriod && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { marginTop: 14, color: "var(--accent-ink)" } }, "\u2713 Certified for ", periodLabel, " \u2014 logging additional patients."), emp && gateOpen && visibleTypes.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { height: 18 } }), /* @__PURE__ */ React.createElement("label", { style: { marginBottom: 10 } }, "Counts for ", fmtShortYr(date), dayEntries(date).length ? " \u2014 editing your saved day" : ""), /* @__PURE__ */ React.createElement("div", { className: "counter-grid" }, visibleTypes.map((t) => {
    const rate = isFixed(t.key) ? t.rate : Number(emp.rates?.[t.key] || 0);
    const dec = isDecimal(t.key);
    return /* @__PURE__ */ React.createElement("div", { className: "counter", key: t.key }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "clabel" }, t.label), /* @__PURE__ */ React.createElement("div", { className: "crate" }, money(rate), " / ", t.unit, QTY_MAX[t.key] != null ? " \xB7 max " + QTY_MAX[t.key] : "")), /* @__PURE__ */ React.createElement("div", { className: "stepper" }, /* @__PURE__ */ React.createElement("button", { onClick: () => bump(t.key, -1) }, "\u2212"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        inputMode: dec ? "decimal" : "numeric",
        value: counts[t.key] ? counts[t.key] : "",
        placeholder: "0",
        onChange: (e) => typeCount(t.key, e.target.value),
        onKeyDown: (e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            bump(t.key, 1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            bump(t.key, -1);
          }
        }
      }
    ), /* @__PURE__ */ React.createElement("button", { onClick: () => bump(t.key, 1) }, "+")));
  }))), emp && gateOpen && !noPayTypes && /* @__PURE__ */ React.createElement(React.Fragment, null, OTHER_ENABLED && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { height: 18 } }), /* @__PURE__ */ React.createElement("div", { className: "other-box" }, /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 0 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "checkbox",
      style: { width: "auto", margin: 0 },
      checked: otherOn,
      onChange: (e) => {
        setOtherOn(e.target.checked);
        markEntryDirty();
      }
    }
  ), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--ink)", fontWeight: 500 } }, "Other \u2014 a one-off amount not covered above")), otherOn && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "other-fields" }, /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 200 } }, /* @__PURE__ */ React.createElement("label", null, "Amount ($)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "0",
      step: "0.01",
      placeholder: "0.00",
      value: otherAmt,
      onChange: (e) => {
        setOtherAmt(e.target.value);
        markEntryDirty();
      },
      style: !(Number(otherAmt) > 0) ? { borderColor: "var(--danger)" } : null
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 220px", minWidth: 0 } }, /* @__PURE__ */ React.createElement("label", null, "Explanation (required)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "What is this for?",
      value: otherNote,
      onChange: (e) => {
        setOtherNote(e.target.value);
        markEntryDirty();
      },
      style: !otherNote.trim() ? { borderColor: "var(--danger)" } : null
    }
  ))), (!(Number(otherAmt) > 0) || !otherNote.trim()) && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { color: "var(--danger)", marginTop: 8 } }, "An Other line needs both a dollar amount and an explanation before it can be saved.")))), /* @__PURE__ */ React.createElement("div", { className: "savebar" }, /* @__PURE__ */ React.createElement("div", { style: { alignSelf: "center", marginRight: "auto", fontSize: 14, color: "var(--muted)" } }, "This entry: ", /* @__PURE__ */ React.createElement("span", { className: "pay" }, money(liveTotal))), saveFailed ? /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", style: { alignSelf: "center", fontSize: 13 }, onClick: saveEntry }, "\u26A0 Not saved \u2014 tap to retry") : /* @__PURE__ */ React.createElement("span", { style: { alignSelf: "center", fontSize: 13, fontWeight: 500, color: "var(--accent-ink)" } }, entrySaving || entryDirty ? "Saving\u2026" : dayEntries(date).length ? "\u2713 Saved" : ""), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: () => {
    setCounts({});
    setOtherOn(false);
    setOtherAmt("");
    setOtherNote("");
    markEntryDirty();
  } }, "Clear"))));
}
function OwnerView({ employees, entries, salaries, adjustments, manualLocks, manualUnlocks, setPeriodLock, persistEmployees, persistSalaries, persistAdjustments, deleteEntry, allPto, onSetPtoStatus, onAddPto, onViewAs, syncedAt, onRefresh, showToast }) {
  const [sub, setSub] = useState("rollup");
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const syncLabel = syncedAt ? syncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "\u2014";
  const viewable = employees.filter((e) => !e.salaryOnly).slice().sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", marginTop: "-6px", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "tabs", style: { margin: 0 } }, /* @__PURE__ */ React.createElement("button", { className: "tab" + (sub === "rollup" ? " active" : ""), onClick: () => setSub("rollup") }, "Roll-up"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (sub === "rates" ? " active" : ""), onClick: () => setSub("rates") }, "Employees & rates"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (sub === "entries" ? " active" : ""), onClick: () => setSub("entries") }, "All entries"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (sub === "pto" ? " active" : ""), onClick: () => setSub("pto") }, "PTO", (() => {
    const n = (allPto || []).filter((r) => r.status === "requested").length;
    return n ? " (" + n + ")" : "";
  })())), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" } }, /* @__PURE__ */ React.createElement("span", { title: "Data is pulled live from the server on every load, on a 60s heartbeat, and whenever you return to the tab." }, "Synced ", syncLabel), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", title: "Refresh", "aria-label": "Refresh", style: { padding: "4px 10px", fontSize: 16, lineHeight: 1 }, onClick: doRefresh, disabled: refreshing }, "\u21BB")), onViewAs && /* @__PURE__ */ React.createElement("select", { value: "", onChange: (e) => {
    const emp = viewable.find((x) => x.id === e.target.value);
    if (emp) onViewAs(emp);
  }, style: { maxWidth: 240 } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u{1F441} View as employee\u2026"), viewable.map((e) => /* @__PURE__ */ React.createElement("option", { key: e.id, value: e.id }, lastFirst(e.name)))))), sub === "rollup" && /* @__PURE__ */ React.createElement(Rollup, { employees, entries, salaries, adjustments, persistAdjustments, manualLocks, manualUnlocks, setPeriodLock, showToast }), sub === "rates" && /* @__PURE__ */ React.createElement(Rates, { employees, salaries, persistEmployees, persistSalaries, showToast }), sub === "entries" && /* @__PURE__ */ React.createElement(AllEntries, { employees, entries, deleteEntry, showToast }), sub === "pto" && /* @__PURE__ */ React.createElement(PtoAdmin, { employees, allPto, onSetStatus: onSetPtoStatus, onAddPto, showToast }));
}
function payForEntry(emp, entry) {
  let total = 0;
  for (const t of ALL_TYPES) {
    const qty = Number(entry.counts?.[t.key] || 0);
    if (!qty) continue;
    const rate = isFixed(t.key) ? t.rate : Number(emp?.rates?.[t.key] || 0);
    total += qty * rate;
  }
  const ov = Number(entry.other?.amount);
  if (ov > 0) total += ov;
  return total;
}
function Rollup({ employees, entries, salaries, adjustments, persistAdjustments, manualLocks, manualUnlocks, setPeriodLock, showToast }) {
  const periods = periodList(10, 0);
  const [mode, setMode] = useState("period");
  const [periodIdx, setPeriodIdx] = useState(currentPeriodIndex());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dayDate, setDayDate] = useState(todayISO());
  const [sortKey, setSortKey] = useState(() => {
    try {
      return localStorage.getItem("plexusRollupSortKey") || window._rollupSortKey || null;
    } catch (e) {
      return window._rollupSortKey || null;
    }
  });
  const [sortDir, setSortDir] = useState(() => {
    try {
      return localStorage.getItem("plexusRollupSortDir") || window._rollupSortDir || "desc";
    } catch (e) {
      return window._rollupSortDir || "desc";
    }
  });
  useEffect(() => {
    window._rollupSortKey = sortKey;
    window._rollupSortDir = sortDir;
    try {
      if (sortKey) {
        localStorage.setItem("plexusRollupSortKey", sortKey);
        localStorage.setItem("plexusRollupSortDir", sortDir);
      } else {
        localStorage.removeItem("plexusRollupSortKey");
        localStorage.removeItem("plexusRollupSortDir");
      }
    } catch (e) {
    }
  }, [sortKey, sortDir]);
  const [calY, setCalY] = useState(parseDate(todayISO()).getFullYear());
  const [calM, setCalM] = useState(parseDate(todayISO()).getMonth());
  const selPeriod = periodByIndex(periodIdx);
  const locked = isPeriodLockedCombined(periodIdx, manualLocks, manualUnlocks);
  const [adjDraft, setAdjDraft] = useState(adjustments || {});
  const adjDirty = useRef(false);
  useEffect(() => {
    if (!adjDirty.current) setAdjDraft(adjustments || {});
  }, [adjustments]);
  useEffect(() => {
    if (!adjDirty.current) return;
    const id = setTimeout(() => {
      adjDirty.current = false;
      persistAdjustments && persistAdjustments(adjDraft);
    }, 700);
    return () => clearTimeout(id);
  }, [adjDraft]);
  const editable = mode === "period";
  const periodAdj = editable && adjDraft[periodIdx] || {};
  const setAdj = (empId, field, value) => {
    adjDirty.current = true;
    setAdjDraft((d) => {
      const next = { ...d };
      const p = { ...next[periodIdx] || {} };
      const cur = { ...p[empId] || {} };
      if (field.indexOf("count.") === 0) {
        const t = field.slice(6);
        cur.counts = { ...cur.counts || {} };
        if (value === "") delete cur.counts[t];
        else cur.counts[t] = value;
        if (!Object.keys(cur.counts).length) delete cur.counts;
      } else {
        if (value === "" || value == null) delete cur[field];
        else cur[field] = value;
      }
      if (!Object.keys(cur).length) delete p[empId];
      else p[empId] = cur;
      next[periodIdx] = p;
      return next;
    });
  };
  const winFrom = mode === "period" ? selPeriod.start : mode === "day" ? dayDate : from;
  const winTo = mode === "period" ? selPeriod.end : mode === "day" ? dayDate : to;
  const filtered = entries.filter((e) => {
    if (winFrom && e.date < winFrom) return false;
    if (winTo && e.date > winTo) return false;
    return true;
  });
  const has = (v) => v != null && v !== "";
  const buildRow = (emp, empEntries, removed) => {
    const computedCounts = {};
    let computedOther = 0;
    const otherNotes = [];
    for (const t of ALL_TYPES) computedCounts[t.key] = 0;
    for (const e of empEntries) {
      for (const t of ALL_TYPES) computedCounts[t.key] += Number(e.counts?.[t.key] || 0);
      const ov = Number(e.other?.amount);
      if (ov > 0) {
        computedOther += ov;
        otherNotes.push({ date: e.date, amount: ov, note: (e.other.note || "").trim() });
      }
    }
    const adj = periodAdj[emp.id] || {};
    const counts = {};
    for (const t of ALL_TYPES) counts[t.key] = adj.counts && has(adj.counts[t.key]) ? Number(adj.counts[t.key]) : computedCounts[t.key];
    const other = has(adj.other) ? Number(adj.other) : computedOther;
    let variable;
    if (has(adj.variable)) variable = Number(adj.variable);
    else {
      variable = other;
      for (const t of ALL_TYPES) variable += counts[t.key] * (isFixed(t.key) ? t.rate : Number((removed ? null : emp)?.rates?.[t.key] || 0));
    }
    const annual = Number(salaries && salaries[emp.id] || 0);
    const pr = mode === "period" && annual > 0 && !removed ? proratedBase(annual, selPeriod, emp) : { base: 0, days: 0, of: 0 };
    const computedBase = pr.base;
    const base = computedBase;
    const bonus = Number(adj.bonus) || 0;
    const reimb = Number(adj.reimbursement) || 0;
    const computedStip = mode === "period" && !removed ? stipendFor(emp, selPeriod) : 0;
    const stip = has(adj.stipend) ? Number(adj.stipend) : computedStip;
    const notes = adj.notes || "";
    return {
      emp,
      adj,
      computedCounts,
      computedOther,
      counts,
      base,
      baseDays: pr.days,
      baseOf: pr.of,
      variable,
      bonus,
      reimb,
      stip,
      notes,
      other,
      otherAmt: other,
      pay: base + variable + bonus + reimb + stip,
      n: empEntries.length,
      otherNotes,
      removed
    };
  };
  const rows = employees.map((emp) => buildRow(emp, filtered.filter((e) => e.empId === emp.id), false));
  const currentIds = new Set(employees.map((e) => e.id));
  const orphanGroups = {};
  filtered.forEach((e) => {
    if (!currentIds.has(e.empId)) (orphanGroups[e.empId] = orphanGroups[e.empId] || []).push(e);
  });
  Object.entries(orphanGroups).forEach(([id, es]) => {
    rows.push(buildRow({ id, name: (es[0] && es[0].username || id) + " (removed)" }, es, true));
  });
  const grand = rows.reduce((s, r) => s + r.pay, 0);
  const totalBase = rows.reduce((s, r) => s + r.base, 0);
  const totalVariable = rows.reduce((s, r) => s + r.variable, 0);
  const totalBonus = rows.reduce((s, r) => s + r.bonus, 0);
  const totalReimb = rows.reduce((s, r) => s + r.reimb, 0);
  const totalStipend = rows.reduce((s, r) => s + r.stip, 0);
  const totalConsults = rows.reduce((s, r) => s + r.counts.consults, 0);
  const totalFollow = rows.reduce((s, r) => s + r.counts.followups, 0);
  const totalOther = rows.reduce((s, r) => s + r.otherAmt, 0);
  const sortVal = (r, k) => k === "name" ? lastNameKey(r.emp.name) : k === "pay" ? r.pay : k === "base" ? r.base : k === "variable" ? r.variable : k === "bonus" ? r.bonus : k === "reimb" ? r.reimb : k === "stipend" ? r.stip : k === "other" ? r.otherAmt : r.counts[k] || 0;
  const sortedRows = sortKey ? [...rows].sort((a, b) => {
    const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return sortDir === "asc" ? cmp : -cmp;
  }) : rows;
  const sortBy = (k) => {
    const firstDir = k === "name" ? "asc" : "desc";
    if (sortKey !== k) {
      setSortKey(k);
      setSortDir(firstDir);
    } else if (sortDir === firstDir) setSortDir(firstDir === "asc" ? "desc" : "asc");
    else setSortKey(null);
  };
  const sortTh = (k, label, num) => /* @__PURE__ */ React.createElement("th", { className: num ? "num" : "", onClick: () => sortBy(k), style: { cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" } }, label, sortKey === k ? sortDir === "asc" ? " \u25B2" : " \u25BC" : "");
  const [pendingCell, setPendingCell] = useState(null);
  const [overrideOk, setOverrideOk] = useState(false);
  const confirmedRef = useRef(/* @__PURE__ */ new Set());
  const pendingElRef = useRef(null);
  const guardEdit = (e, key, label, cur) => {
    if (confirmedRef.current.has(key) || cur === "" || cur == null) {
      confirmedRef.current.add(key);
      return;
    }
    pendingElRef.current = e.target;
    e.target.blur();
    setPendingCell({ key, label, cur });
  };
  const ovCell = (r, field, eff, label) => {
    const cur = has(r.adj[field]) ? r.adj[field] : eff ? Math.round(eff * 100) / 100 : "";
    const key = periodIdx + ":" + r.emp.id + ":" + field;
    return /* @__PURE__ */ React.createElement("td", { className: "num" }, editable ? /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "cell-in",
        type: "text",
        inputMode: "decimal",
        value: cur,
        onFocus: (e) => guardEdit(e, key, (lastFirst(r.emp.name) || "This person") + " \xB7 " + label, cur),
        onChange: (e) => setAdj(r.emp.id, field, e.target.value)
      }
    ) : eff ? money(eff) : "");
  };
  const cntCell = (r, t, label) => {
    const cur = r.adj.counts && has(r.adj.counts[t]) ? r.adj.counts[t] : r.counts[t] || "";
    const key = periodIdx + ":" + r.emp.id + ":count." + t;
    return /* @__PURE__ */ React.createElement("td", { className: "num cnt" }, editable ? /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "cell-in cnt-in",
        type: "text",
        inputMode: "numeric",
        value: cur,
        onFocus: (e) => guardEdit(e, key, (lastFirst(r.emp.name) || "This person") + " \xB7 " + label, cur),
        onChange: (e) => setAdj(r.emp.id, "count." + t, e.target.value)
      }
    ) : r.counts[t] || "");
  };
  const empById = (id) => employees.find((x) => x.id === id);
  const dayTotal = (iso) => entries.filter((e) => e.date === iso).reduce((s, e) => s + payForEntry(empById(e.empId), e), 0);
  const calFirst = new Date(calY, calM, 1);
  const calCells = [];
  for (let i = 0; i < calFirst.getDay(); i++) calCells.push(null);
  for (let d = 1; d <= new Date(calY, calM + 1, 0).getDate(); d++) calCells.push(d);
  const calLabel = calFirst.toLocaleDateString(void 0, { month: "long", year: "numeric" });
  const prevMonth = () => calM <= 0 ? (setCalM(11), setCalY(calY - 1)) : setCalM(calM - 1);
  const nextMonth = () => calM >= 11 ? (setCalM(0), setCalY(calY + 1)) : setCalM(calM + 1);
  const lateEntries = mode === "period" ? filtered.filter((e) => {
    const created = e.id && e.id.startsWith("e_") ? Number(e.id.split("_")[1]) : null;
    return locked && created && created > selPeriod.lockAt.getTime();
  }) : [];
  const [showLate, setShowLate] = useState(true);
  const lateAfter = (h) => h < 1 ? Math.max(1, Math.round(h * 60)) + " min" : h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " d";
  const lateRows = lateEntries.map((e) => {
    const emp = employees.find((x) => x.id === e.empId);
    const created = Number(e.id.split("_")[1]);
    const parts = ALL_TYPES.filter((t) => Number(e.counts?.[t.key] || 0) > 0).map((t) => `${e.counts[t.key]} ${t.label.toLowerCase()}`);
    let amt = 0;
    for (const t of ALL_TYPES) amt += Number(e.counts?.[t.key] || 0) * (isFixed(t.key) ? t.rate : Number(emp?.rates?.[t.key] || 0));
    if (e.other && Number(e.other.amount) > 0) {
      amt += Number(e.other.amount);
      parts.push("Other " + money(Number(e.other.amount)) + (e.other.note ? " (" + e.other.note + ")" : ""));
    }
    return {
      id: e.id,
      name: emp ? lastFirst(emp.name) : e.username ? e.username + " (removed)" : e.empId,
      date: e.date,
      created,
      after: lateAfter((created - selPeriod.lockAt.getTime()) / 36e5),
      parts,
      amt
    };
  }).sort((a, b) => b.created - a.created);
  const exportADP = () => {
    const DASH = "\u2014";
    const cents = (n) => Math.round(n * 100);
    const header = ["EMPLOYEE (ADP NAME)", "TYPE", "1099COMP AMOUNT", "BONUS AMOUNT", "EXCLUDED SALARY", "TOTAL PAY"];
    const out = [header];
    let t1099 = 0, tBonus = 0, tExcl = 0;
    const srows = [...rows].sort((a2, b) => lastFirst(a2.emp.name).localeCompare(lastFirst(b.emp.name)));
    for (const r of srows) {
      const taxType = r.removed ? "1099" : r.emp.taxType || (r.base > 0 ? "w2" : "1099");
      if (r.pay === 0) {
        out.push([lastFirst(r.emp.name), "no pay", DASH, DASH, DASH, DASH]);
        continue;
      }
      if (taxType === "w2") {
        const bonus = r.pay - r.base;
        tBonus += cents(bonus);
        tExcl += cents(r.base);
        out.push([lastFirst(r.emp.name), "W2", DASH, bonus ? money(bonus) : DASH, r.base ? money(r.base) : DASH, money(r.pay)]);
      } else {
        t1099 += cents(r.pay);
        out.push([lastFirst(r.emp.name), "1099", money(r.pay), DASH, DASH, money(r.pay)]);
      }
    }
    out.push(["Total payroll", "", money(t1099 / 100), money(tBonus / 100), money(tExcl / 100), money(grand)]);
    const cell = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = "\uFEFF" + out.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const tag = mode === "period" ? `${selPeriod.start}_to_${selPeriod.end}` : `${winFrom || "all"}_${winTo || "all"}`;
    a.href = url;
    a.download = `payroll_${tag}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const autoLocked = isPeriodLocked(selPeriod);
  const manualLocked = Array.isArray(manualLocks) && manualLocks.includes(periodIdx);
  const forceUnlocked = Array.isArray(manualUnlocks) && manualUnlocks.includes(periodIdx);
  return /* @__PURE__ */ React.createElement("div", { className: "card" }, pendingCell && /* @__PURE__ */ React.createElement("div", { className: "modal-backdrop", onClick: () => {
    setPendingCell(null);
    setOverrideOk(false);
  } }, /* @__PURE__ */ React.createElement("div", { className: "modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("h3", null, "Override an existing value?"), /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, pendingCell.label), " already has the value ", /* @__PURE__ */ React.createElement("strong", null, pendingCell.cur), ". Editing it replaces that value for payroll."), /* @__PURE__ */ React.createElement("label", { className: "modal-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: overrideOk, onChange: (e) => setOverrideOk(e.target.checked) }), " Yes, I want to override it"), /* @__PURE__ */ React.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: () => {
    setPendingCell(null);
    setOverrideOk(false);
  } }, "Cancel"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", disabled: !overrideOk, onClick: () => {
    confirmedRef.current.add(pendingCell.key);
    setPendingCell(null);
    setOverrideOk(false);
    const el = pendingElRef.current;
    setTimeout(() => {
      try {
        el && el.focus();
      } catch (ex) {
      }
    }, 0);
  } }, "Continue")))), /* @__PURE__ */ React.createElement("h2", null, "Roll-up"), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Review by pay period, a single day, or a custom range. ", periodDescription()), /* @__PURE__ */ React.createElement("div", { className: "tabs", style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("button", { className: "tab" + (mode === "period" ? " active" : ""), onClick: () => setMode("period") }, "Pay period"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (mode === "day" ? " active" : ""), onClick: () => setMode("day") }, "Day"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (mode === "custom" ? " active" : ""), onClick: () => setMode("custom") }, "Custom range")), mode === "period" && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("label", null, "Pay period"), /* @__PURE__ */ React.createElement("select", { value: periodIdx, onChange: (e) => setPeriodIdx(Number(e.target.value)) }, periods.map((p) => /* @__PURE__ */ React.createElement("option", { key: p.index, value: p.index }, fmtShortYr(p.start), " \u2013 ", fmtShortYr(p.end), "  \xB7  paid ", fmtShortYr(p.payday), p.index === currentPeriodIndex() ? "  (current)" : ""))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--muted)" } }, "Payday ", /* @__PURE__ */ React.createElement("strong", null, fmtShortYr(selPeriod.payday))), locked ? /* @__PURE__ */ React.createElement("span", { className: "pill", style: { background: "var(--danger-soft)", color: "var(--danger)" } }, "\u{1F512} Locked", manualLocked ? " (manual)" : autoLocked ? " (72h pre-payday)" : "") : /* @__PURE__ */ React.createElement("span", { className: "pill", style: { background: "var(--accent-soft)", color: "var(--accent-ink)" } }, "Open", forceUnlocked && autoLocked ? " (admin override)" : ""), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "btn btn-ghost",
      style: { padding: "5px 12px", fontSize: 13 },
      onClick: () => {
        setPeriodLock(periodIdx, !locked);
        showToast(locked ? "Period unlocked" : "Period locked");
      }
    },
    locked ? "Unlock period" : "Lock period now"
  )), autoLocked && !manualLocked && !forceUnlocked && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { marginTop: 6 } }, "Auto-locked because it's within 72 hours of payday. New entries dated in this period will be flagged below. Use \u201CUnlock period\u201D to override."), forceUnlocked && autoLocked && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { marginTop: 6, color: "var(--amber)" } }, "\u26A0 You've manually unlocked this period even though it's within 72 hours of payday \u2014 entries can be edited again.")), mode === "custom" && /* @__PURE__ */ React.createElement("div", { className: "row", style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "From date"), /* @__PURE__ */ React.createElement("input", { type: "date", value: from, onChange: (e) => setFrom(e.target.value) })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "To date"), /* @__PURE__ */ React.createElement("input", { type: "date", value: to, onChange: (e) => setTo(e.target.value) }))), mode === "day" && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { className: "period-nav" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("button", { onClick: prevMonth, "aria-label": "Previous month" }, "\u2039"), /* @__PURE__ */ React.createElement("div", { className: "pn-label" }, calLabel), /* @__PURE__ */ React.createElement("button", { onClick: nextMonth, "aria-label": "Next month" }, "\u203A")), /* @__PURE__ */ React.createElement("div", { className: "period-total" }, "Showing ", /* @__PURE__ */ React.createElement("span", { className: "pay", style: { marginLeft: 6 } }, fmtShortYr(dayDate)))), /* @__PURE__ */ React.createElement("p", { className: "hint", style: { marginTop: 0, marginBottom: 10 } }, "Tap a date to see that day's per-NP breakdown below. Each cell shows the total logged that day."), /* @__PURE__ */ React.createElement("div", { className: "week-grid" }, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => /* @__PURE__ */ React.createElement("div", { className: "dow", key: "cd" + d }, d)), calCells.map((d, i) => {
    if (d === null) return /* @__PURE__ */ React.createElement("div", { key: "blank" + i });
    const iso = fmtISO(new Date(calY, calM, d));
    const tot = dayTotal(iso);
    const cls = "day-cell" + (iso === dayDate ? " selected" : "") + (tot > 0 ? " logged" : "") + (iso === todayISO() ? " today" : "");
    return /* @__PURE__ */ React.createElement("div", { className: cls, key: iso, onClick: () => setDayDate(iso) }, /* @__PURE__ */ React.createElement("div", { className: "dnum" }, d), tot > 0 ? /* @__PURE__ */ React.createElement("div", { className: "damt" }, money(tot)) : /* @__PURE__ */ React.createElement("div", { className: "dempty" }, "\u2014"));
  }))), lateEntries.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "card late-card" }, /* @__PURE__ */ React.createElement("div", { className: "late-head" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--danger)", fontWeight: 600, fontSize: 14 } }, "\u26A0 ", lateEntries.length, " late ", lateEntries.length === 1 ? "entry" : "entries", " added after this period locked \xB7 ", money(lateRows.reduce((s, r) => s + r.amt, 0))), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", style: { padding: "4px 10px", fontSize: 13 }, onClick: () => setShowLate((v) => !v) }, showLate ? "Hide" : "Show")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--danger)", marginTop: 4 } }, "Logged after the lock cutoff and included in the totals below. Review before paying \u2014 this period may already have been processed."), showLate && /* @__PURE__ */ React.createElement("div", { className: "late-list" }, lateRows.map((r) => /* @__PURE__ */ React.createElement("div", { className: "late-item", key: r.id }, /* @__PURE__ */ React.createElement("div", { className: "late-who" }, r.name), /* @__PURE__ */ React.createElement("div", { className: "late-amt" }, money(r.amt)), /* @__PURE__ */ React.createElement("div", { className: "late-meta" }, "Work dated ", /* @__PURE__ */ React.createElement("strong", null, fmtShortYr(r.date)), " \xB7 logged ", new Date(r.created).toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), " \xB7 ", r.after, " after lock"), /* @__PURE__ */ React.createElement("div", { className: "late-what" }, r.parts.length ? r.parts.join(", ") : "no counts"))))), /* @__PURE__ */ React.createElement("div", { className: "metric-grid" }, /* @__PURE__ */ React.createElement("div", { className: "metric" }, /* @__PURE__ */ React.createElement("div", { className: "m-label" }, "Total payout"), /* @__PURE__ */ React.createElement("div", { className: "m-val" }, money(grand))), /* @__PURE__ */ React.createElement("div", { className: "metric" }, /* @__PURE__ */ React.createElement("div", { className: "m-label" }, "Consults"), /* @__PURE__ */ React.createElement("div", { className: "m-val" }, totalConsults)), /* @__PURE__ */ React.createElement("div", { className: "metric" }, /* @__PURE__ */ React.createElement("div", { className: "m-label" }, "Follow-ups"), /* @__PURE__ */ React.createElement("div", { className: "m-val" }, totalFollow)), /* @__PURE__ */ React.createElement("div", { className: "metric" }, /* @__PURE__ */ React.createElement("div", { className: "m-label" }, "Entries"), /* @__PURE__ */ React.createElement("div", { className: "m-val" }, filtered.length))), /* @__PURE__ */ React.createElement("div", { className: "scroll-x" }, /* @__PURE__ */ React.createElement("table", { className: "rollup-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, sortTh("name", "Employee"), sortTh("pay", "Pay", true), sortTh("base", "Base", true), sortTh("variable", "Variable", true), sortTh("bonus", "Bonus", true), sortTh("reimb", "Reimburse", true), sortTh("stipend", "Stipend", true), sortTh("consults", "Cons", true), sortTh("followups", "F/U", true), sortTh("clinic_pts", "Clinic pts", true), sortTh("perdiem", "Per diem", true), sortTh("clinic_hr", "Clinic hr", true), sortTh("virtual_hr", "Virtual hr", true), sortTh("hosp_hr", "Hosp hr", true), sortTh("other", "Other", true), /* @__PURE__ */ React.createElement("th", { style: { whiteSpace: "nowrap" } }, "Notes"))), /* @__PURE__ */ React.createElement("tbody", null, sortedRows.map((r) => /* @__PURE__ */ React.createElement("tr", { key: r.emp.id }, /* @__PURE__ */ React.createElement("td", { style: { whiteSpace: "nowrap" } }, lastFirst(r.emp.name)), /* @__PURE__ */ React.createElement("td", { className: "num pay" }, money(r.pay)), /* @__PURE__ */ React.createElement("td", { className: "num", title: r.baseDays > 0 && r.baseDays < r.baseOf ? "Prorated: " + r.baseDays + " of " + r.baseOf + " weekdays in this period (start / last day)" : void 0 }, r.base ? money(r.base) : "", r.baseDays > 0 && r.baseDays < r.baseOf ? /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, " \xB7 ", r.baseDays, "/", r.baseOf, "wd") : null), ovCell(r, "variable", r.variable, "Variable"), ovCell(r, "bonus", r.bonus, "Bonus"), ovCell(r, "reimbursement", r.reimb, "Reimbursement"), ovCell(r, "stipend", r.stip, "Stipend"), cntCell(r, "consults", "Consults"), cntCell(r, "followups", "Follow-ups"), cntCell(r, "clinic_pts", "Clinic pts"), cntCell(r, "perdiem", "Per diem"), cntCell(r, "clinic_hr", "Clinic hr"), cntCell(r, "virtual_hr", "Virtual hr"), cntCell(r, "hosp_hr", "Hosp hr"), ovCell(r, "other", r.otherAmt, "Other"), /* @__PURE__ */ React.createElement("td", null, editable ? /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cell-in notes-in",
      type: "text",
      placeholder: "\u2014",
      value: r.adj.notes || "",
      onChange: (e) => setAdj(r.emp.id, "notes", e.target.value)
    }
  ) : r.notes || ""))), /* @__PURE__ */ React.createElement("tr", { className: "total-row" }, /* @__PURE__ */ React.createElement("td", null, "Total"), /* @__PURE__ */ React.createElement("td", { className: "num pay" }, money(grand)), /* @__PURE__ */ React.createElement("td", { className: "num" }, totalBase ? money(totalBase) : ""), /* @__PURE__ */ React.createElement("td", { className: "num" }, totalVariable ? money(totalVariable) : ""), /* @__PURE__ */ React.createElement("td", { className: "num" }, totalBonus ? money(totalBonus) : ""), /* @__PURE__ */ React.createElement("td", { className: "num" }, totalReimb ? money(totalReimb) : ""), /* @__PURE__ */ React.createElement("td", { className: "num" }, totalStipend ? money(totalStipend) : ""), /* @__PURE__ */ React.createElement("td", { className: "num" }, rows.reduce((s, r) => s + r.counts.consults, 0)), /* @__PURE__ */ React.createElement("td", { className: "num" }, rows.reduce((s, r) => s + r.counts.followups, 0)), /* @__PURE__ */ React.createElement("td", { className: "num" }, rows.reduce((s, r) => s + r.counts.clinic_pts, 0)), /* @__PURE__ */ React.createElement("td", { className: "num" }, rows.reduce((s, r) => s + r.counts.perdiem, 0)), /* @__PURE__ */ React.createElement("td", { className: "num" }, rows.reduce((s, r) => s + r.counts.clinic_hr, 0)), /* @__PURE__ */ React.createElement("td", { className: "num" }, rows.reduce((s, r) => s + r.counts.virtual_hr, 0)), /* @__PURE__ */ React.createElement("td", { className: "num" }, rows.reduce((s, r) => s + r.counts.hosp_hr, 0)), /* @__PURE__ */ React.createElement("td", { className: "num" }, totalOther ? money(totalOther) : ""), /* @__PURE__ */ React.createElement("td", null))))), rows.some((r) => r.otherNotes.length > 0) && /* @__PURE__ */ React.createElement("div", { className: "scroll-x", style: { marginTop: 18 } }, /* @__PURE__ */ React.createElement("label", { style: { marginBottom: 8 } }, "Other adjustments \u2014 explanations"), /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Date"), /* @__PURE__ */ React.createElement("th", null, "Employee"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Amount"), /* @__PURE__ */ React.createElement("th", null, "Explanation"))), /* @__PURE__ */ React.createElement("tbody", null, rows.flatMap((r) => r.otherNotes.map((o, i) => /* @__PURE__ */ React.createElement("tr", { key: r.emp.id + "-o" + i }, /* @__PURE__ */ React.createElement("td", { style: { whiteSpace: "nowrap" } }, fmtShortYr(o.date)), /* @__PURE__ */ React.createElement("td", { style: { whiteSpace: "nowrap" } }, lastFirst(r.emp.name)), /* @__PURE__ */ React.createElement("td", { className: "num pay" }, money(o.amount)), /* @__PURE__ */ React.createElement("td", null, o.note || "\u2014"))))))), /* @__PURE__ */ React.createElement("div", { className: "actions", style: { marginTop: 18 } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: exportADP }, "Export ADP CSV"), mode === "period" && /* @__PURE__ */ React.createElement("span", { style: { alignSelf: "center", fontSize: 13, color: "var(--muted)" } }, "Period & payday auto-filled in the export.")));
}
function Rates({ employees, salaries, persistEmployees, persistSalaries, showToast }) {
  const [draft, setDraft] = useState(() => mergeSalaryDraft(JSON.parse(JSON.stringify(employees)), salaries));
  const salariesRef = useRef(salaries);
  useEffect(() => {
    salariesRef.current = salaries;
  }, [salaries]);
  const [newName, setNewName] = useState("");
  const [openIds, setOpenIds] = useState(() => /* @__PURE__ */ new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [modalId, setModalId] = useState(null);
  const listRef = useRef(null);
  const draftRef = useRef(draft);
  const dirtyR = useRef(false);
  const markDirty = () => {
    dirtyR.current = true;
    setDirty(true);
  };
  const markClean = () => {
    dirtyR.current = false;
    setDirty(false);
  };
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    if (!dirtyR.current && !savingRef.current) setDraft(mergeSalaryDraft(JSON.parse(JSON.stringify(employees)), salariesRef.current));
  }, [employees, salaries]);
  const addEmp = () => {
    const name = newName.trim();
    const id = "emp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const next = [...draft, { id, name, rates: {}, fixedEligible: false }];
    setDraft(next);
    setNewName("");
    if (name) markDirty();
    setModalId(id);
  };
  const cancelNewEmp = () => {
    if (modalId) {
      setDraft(draft.filter((e) => e.id !== modalId));
      markDirty();
    }
    setModalId(null);
  };
  const removeEmp = (id) => {
    const emp = draft.find((e) => e.id === id);
    const who = emp && emp.name && emp.name.trim() || "this person";
    if (!window.confirm("Remove " + who + " from the roster?\n\nThey'll be taken off the staff list and can no longer log in. Their past entries stay in the roll-up. You can re-add them later.")) return;
    setDraft(draft.filter((e) => e.id !== id));
    markDirty();
  };
  const setRate = (id, key, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, rates: { ...e.rates, [key]: val } } : e));
    markDirty();
  };
  const setName = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, name: val } : e));
    markDirty();
  };
  const setRole = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, role: val } : e));
    markDirty();
  };
  const inUseRoles = [...new Set(draft.map((e) => String(e.role || "").trim()).filter(Boolean))];
  const roleOptions = [...ROLE_CANON, ...inUseRoles.filter((r) => !ROLE_CANON.some((c) => c.toLowerCase() === r.toLowerCase())).sort()];
  const roleGroups = (() => {
    const by = {};
    for (const e of draft) {
      const k = String(e.role || "").trim().toLowerCase();
      (by[k] = by[k] || []).push(e);
    }
    const keys = Object.keys(by).sort((a, b) => {
      const ra = a in ROLE_RANK ? ROLE_RANK[a] : a === "" ? 99 : 50;
      const rb = b in ROLE_RANK ? ROLE_RANK[b] : b === "" ? 99 : 50;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
    return keys.map((k) => ({
      key: k || "_unassigned",
      label: k === "" ? "Unassigned" : ROLE_LABEL[k] || k.charAt(0).toUpperCase() + k.slice(1),
      emps: by[k].slice().sort((a, b) => lastFirst(a.name || "").localeCompare(lastFirst(b.name || "")))
    }));
  })();
  const setUsername = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, username: val } : e));
    markDirty();
  };
  const setFixedElig = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, fixedEligible: val } : e));
    markDirty();
  };
  const setEmail = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, email: val } : e));
    markDirty();
  };
  const setCap = (id, val) => {
    if (val !== "" && !/^\d*$/.test(val)) return;
    setDraft(draft.map((e) => e.id === id ? { ...e, patientCap: val } : e));
    markDirty();
  };
  const setIsManager = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, isManager: val, managedBy: "", fixedEligible: val ? false : e.fixedEligible, patientCap: val ? "" : e.patientCap } : e));
    markDirty();
  };
  const setManagedBy = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, managedBy: val } : e));
    markDirty();
  };
  const setSalary = (id, val) => {
    if (val !== "" && !/^\d*$/.test(val)) return;
    setDraft(draft.map((e) => e.id === id ? { ...e, annualSalary: val } : e));
    markDirty();
  };
  const setTaxType = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, taxType: val } : e));
    markDirty();
  };
  const setPtoDays = (id, val) => {
    if (val !== "" && !/^\d*\.?\d*$/.test(val)) return;
    setDraft(draft.map((e) => e.id === id ? { ...e, ptoDays: val } : e));
    markDirty();
  };
  const setShifts = (id, val) => {
    if (val !== "" && !/^\d*\.?\d*$/.test(val)) return;
    setDraft(draft.map((e) => e.id === id ? { ...e, shiftsPerMonth: val } : e));
    markDirty();
  };
  const setStartDate = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, startDate: val } : e));
    markDirty();
  };
  const setEndDate = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, endDate: val } : e));
    markDirty();
  };
  const setStipend = (id, val) => {
    if (val !== "" && !/^\d*\.?\d*$/.test(val)) return;
    setDraft(draft.map((e) => e.id === id ? { ...e, stipend: val } : e));
    markDirty();
  };
  const setStipendNote = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, stipendNote: val } : e));
    markDirty();
  };
  const setStipendStart = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, stipendStart: val } : e));
    markDirty();
  };
  const setSalaryOnly = (id, val) => {
    setDraft(draft.map((e) => e.id === id ? { ...e, salaryOnly: val, isManager: val ? false : e.isManager, managedBy: "", fixedEligible: val ? false : e.fixedEligible } : e));
    markDirty();
  };
  const toggleOpen = (id) => setOpenIds((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const expandAll = () => setOpenIds(new Set(draft.map((e) => e.id)));
  const collapseAll = () => setOpenIds(/* @__PURE__ */ new Set());
  const empMeta = (emp) => {
    const u = normU(emp.username);
    const nRates = VARIABLE.filter((t) => Number(emp.rates?.[t.key]) > 0).length;
    const bits = [];
    if (emp.salaryOnly) {
      bits.push("salary only");
    } else if (emp.isManager) {
      bits.push("office manager");
    } else {
      if (emp.fixedEligible) bits.push("consults+FU");
      if (nRates) bits.push(nRates + " rate" + (nRates === 1 ? "" : "s"));
      if (Number(emp.patientCap) > 0) bits.push("cap " + Math.round(Number(emp.patientCap)));
      if (emp.managedBy) bits.push(emp.managedBy === "ADMIN" ? "admin-entered" : "manager-entered");
    }
    if (Number(emp.annualSalary) > 0) bits.push("$" + Math.round(Number(emp.annualSalary) / 1e3) + "k");
    if (emp.taxType === "w2" || emp.taxType === "1099") bits.push(emp.taxType === "w2" ? "W-2" : "1099");
    if (Number(emp.shiftsPerMonth) > 0) bits.push(Number(emp.shiftsPerMonth) + " shifts/mo");
    if (emp.endDate) bits.push("last day " + fmtShort(emp.endDate));
    if (Number(emp.stipend) > 0) bits.push("$" + Number(emp.stipend) + "/period " + String(emp.stipendNote || "stipend").toLowerCase());
    if (emp.role && String(emp.role).trim()) bits.unshift(String(emp.role).trim());
    const noLogin = emp.salaryOnly;
    const em = String(emp.email || "").trim();
    return { user: noLogin ? "no login" : em || "needs email", right: bits.length ? bits.join(" \xB7 ") : "no pay set", warn: !noLogin && !em };
  };
  const buildClean = (source) => {
    const hasContent = (e) => e.name.trim() || normU(e.username) || String(e.email || "").trim() || e.salaryOnly || e.isManager || e.managedBy || Number(e.annualSalary) > 0 || Number(e.stipend) > 0 || e.rates && Object.values(e.rates).some((v) => Number(v) > 0);
    const kept = source.filter(hasContent);
    const noName = kept.find((e) => !e.name.trim());
    if (noName) return { error: "Every person needs a name \u2014 finish typing and it'll save." };
    const missing = kept.find((e) => !e.salaryOnly && !e.managedBy && !String(e.email || "").trim());
    if (missing) return { error: "Add an email for " + missing.name.trim() + " \u2014 that's their login (or mark them salary-only)" };
    const seenE = {};
    for (const e of kept) {
      const em = String(e.email || "").trim().toLowerCase();
      if (!em) continue;
      if (seenE[em]) return { error: 'Email "' + em + '" is used by two people \u2014 make it unique' };
      seenE[em] = true;
    }
    const salariesMap = {};
    const clean = kept.map((e) => {
      const rates = {};
      for (const t of VARIABLE) {
        const v = e.rates?.[t.key];
        if (v !== "" && v != null && !isNaN(Number(v)) && Number(v) > 0) rates[t.key] = Number(v);
      }
      const out = { ...e, name: e.name.trim(), username: normU(e.username), email: String(e.email || "").trim().toLowerCase(), rates, fixedEligible: !!e.fixedEligible };
      if (e.role && String(e.role).trim()) out.role = String(e.role).trim();
      else delete out.role;
      const annual = Number(e.annualSalary);
      if (annual > 0) salariesMap[e.id] = Math.round(annual);
      delete out.annualSalary;
      const tt = String(e.taxType || "").toLowerCase();
      if (tt === "w2" || tt === "1099") out.taxType = tt;
      else delete out.taxType;
      if (e.salaryOnly) {
        out.salaryOnly = true;
        out.username = "";
        out.email = "";
        out.fixedEligible = false;
        out.rates = {};
        delete out.managedBy;
        delete out.isManager;
      } else delete out.salaryOnly;
      const cap = Number(e.patientCap);
      if (cap > 0 && !e.isManager && !e.salaryOnly) out.patientCap = Math.round(cap);
      else delete out.patientCap;
      const pto = Number(e.ptoDays);
      if (pto > 0) out.ptoDays = pto;
      else delete out.ptoDays;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(e.startDate || ""))) out.startDate = e.startDate;
      else delete out.startDate;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(e.endDate || ""))) out.endDate = e.endDate;
      else delete out.endDate;
      const spm = Number(e.shiftsPerMonth);
      if (spm > 0) out.shiftsPerMonth = spm;
      else delete out.shiftsPerMonth;
      const st = Number(e.stipend);
      if (st > 0) {
        out.stipend = Math.round(st * 100) / 100;
        out.stipendStart = /^\d{4}-\d{2}-\d{2}$/.test(String(e.stipendStart || "")) ? e.stipendStart : todayISO();
        const sn = String(e.stipendNote || "").trim();
        if (sn) out.stipendNote = sn;
        else delete out.stipendNote;
      } else {
        delete out.stipend;
        delete out.stipendStart;
        delete out.stipendNote;
      }
      if (out.isManager) {
        delete out.managedBy;
      } else if (!e.salaryOnly) {
        if (e.managedBy) out.managedBy = String(e.managedBy);
        else delete out.managedBy;
      }
      return out;
    });
    return { clean, salaries: salariesMap };
  };
  const persistClean = async (clean, salariesMap) => {
    setSaving(true);
    savingRef.current = true;
    markClean();
    salariesRef.current = salariesMap;
    try {
      await persistEmployees(clean);
      await persistSalaries(salariesMap);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const save = async (sourceArr) => {
    const r = buildClean(sourceArr || draftRef.current);
    if (r.error) {
      showToast(r.error);
      return;
    }
    await persistClean(r.clean, r.salaries);
  };
  const autoSave = async () => {
    const r = buildClean(draftRef.current);
    if (!r.error) await persistClean(r.clean, r.salaries);
  };
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => autoSave(), 800);
    return () => clearTimeout(id);
  }, [dirty, draft]);
  const blockReason = dirty ? buildClean(draft).error || null : null;
  const editorFor = (emp) => /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "emp-section", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "field-row" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Name"), /* @__PURE__ */ React.createElement("input", { type: "text", value: emp.name, onChange: (e) => setName(emp.id, e.target.value), style: { fontWeight: 600 } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Role"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      list: "role-options",
      value: emp.role ?? "",
      placeholder: "e.g. NP, Scribe, MA",
      autoComplete: "off",
      onChange: (e) => setRole(emp.id, e.target.value)
    }
  ))), !emp.salaryOnly && /* @__PURE__ */ React.createElement("div", { className: "field-row", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Email (their sign-in)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "email",
      value: emp.email ?? "",
      autoComplete: "off",
      placeholder: "name@plexusmedicalgroup.com",
      onChange: (e) => setEmail(emp.id, e.target.value)
    }
  )))), /* @__PURE__ */ React.createElement("div", { className: "emp-section" }, /* @__PURE__ */ React.createElement("div", { className: "check-cluster" }, emp.managedBy !== "ADMIN" && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !!emp.salaryOnly, onChange: (e) => setSalaryOnly(emp.id, e.target.checked) }), " Salary only ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "no login \xB7 Base only")), !emp.salaryOnly && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !!emp.isManager, onChange: (e) => setIsManager(emp.id, e.target.checked) }), " Office manager ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "enters for others")), !emp.salaryOnly && !emp.isManager && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !!emp.fixedEligible, onChange: (e) => setFixedElig(emp.id, e.target.checked) }), " Consults + follow-ups ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "$60 / $30")))), /* @__PURE__ */ React.createElement("div", { className: "emp-section" }, /* @__PURE__ */ React.createElement("div", { className: "field-row" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Pay type ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "ADP: W-2 or 1099")), /* @__PURE__ */ React.createElement("select", { value: emp.taxType || "", onChange: (e) => setTaxType(emp.id, e.target.value), style: { maxWidth: 340 } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Auto \u2014 W-2 if salaried, otherwise 1099"), /* @__PURE__ */ React.createElement("option", { value: "w2" }, "W-2 employee"), /* @__PURE__ */ React.createElement("option", { value: "1099" }, "1099 contractor"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Annual salary ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "base \xB7 paid by ADP")), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "numeric",
      value: emp.annualSalary ?? "",
      placeholder: "none",
      onChange: (e) => setSalary(emp.id, e.target.value)
    }
  ), Number(emp.annualSalary) > 0 && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { marginTop: 4 } }, money(Number(emp.annualSalary) / periodsPerYear()), " per full period \xB7 prorated by weekdays around a start / last day"))), /* @__PURE__ */ React.createElement("div", { className: "field-row" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "PTO days ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "per calendar year \xB7 resets Jan 1 \xB7 blank = none")), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "decimal",
      value: emp.ptoDays ?? "",
      placeholder: "none",
      onChange: (e) => setPtoDays(emp.id, e.target.value)
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Shifts / month ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "required \xB7 1099 \xB7 blank = none")), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "decimal",
      value: emp.shiftsPerMonth ?? "",
      placeholder: "none",
      onChange: (e) => setShifts(emp.id, e.target.value)
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "field-row" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Start date ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "employment start \xB7 first period prorated")), /* @__PURE__ */ React.createElement("input", { type: "date", value: emp.startDate || "", onChange: (e) => setStartDate(emp.id, e.target.value) })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Last day ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "final period prorated \xB7 blank = active")), /* @__PURE__ */ React.createElement("input", { type: "date", value: emp.endDate || "", onChange: (e) => setEndDate(emp.id, e.target.value) }))), /* @__PURE__ */ React.createElement("div", { className: "field-row" }, !emp.salaryOnly && !emp.isManager && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Patient cap ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "salary-covered")), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "numeric",
      value: emp.patientCap ?? "",
      placeholder: "none",
      onChange: (e) => setCap(emp.id, e.target.value)
    }
  ), Number(emp.patientCap) > 0 && /* @__PURE__ */ React.createElement("div", { className: "fixed-note", style: { marginTop: 4 } }, "Certifies once/period; changing it re-prompts."))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("label", null, "Stipend ", /* @__PURE__ */ React.createElement("span", { className: "hint-sm" }, "$ / pay period \xB7 paid automatically")), /* @__PURE__ */ React.createElement("div", { className: "stipend-row", style: { gridTemplateColumns: Number(emp.stipend) > 0 ? void 0 : "84px minmax(0,1fr)" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "decimal",
      value: emp.stipend ?? "",
      placeholder: "$",
      onChange: (e) => setStipend(emp.id, e.target.value)
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: emp.stipendNote ?? "",
      placeholder: "note \u2014 e.g. Parking",
      onChange: (e) => setStipendNote(emp.id, e.target.value)
    }
  ), Number(emp.stipend) > 0 && /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      title: "Start \u2014 first period containing this date",
      value: emp.stipendStart || "",
      onChange: (e) => setStipendStart(emp.id, e.target.value)
    }
  ))), !emp.salaryOnly && !emp.isManager && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "rate-grid", style: { marginTop: 12 } }, VARIABLE.map((t) => /* @__PURE__ */ React.createElement("div", { className: "rate-field", key: t.key }, /* @__PURE__ */ React.createElement("label", null, t.label, " ($/", t.unit, ")"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "0",
      step: "0.01",
      placeholder: "0",
      value: emp.rates?.[t.key] ?? "",
      onChange: (e) => setRate(emp.id, t.key, e.target.value)
    }
  )))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("label", null, "Entered by"), /* @__PURE__ */ React.createElement("select", { value: emp.managedBy || "", onChange: (e) => setManagedBy(emp.id, e.target.value), style: { maxWidth: 340 } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Self \u2014 logs in & enters their own"), /* @__PURE__ */ React.createElement("option", { value: "ADMIN" }, "Administrator \u2014 you enter their hours"), draft.filter((m) => m.isManager && m.id !== emp.id).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, "Entered by ", lastFirst(m.name) || "(unnamed manager)"))))), !emp.salaryOnly && emp.isManager && /* @__PURE__ */ React.createElement("div", { className: "hint-sm", style: { marginTop: 6 } }, "Assign staff to this manager via each person's ", /* @__PURE__ */ React.createElement("strong", null, "Entered by"), " field.")));
  return /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("h2", null, "Employees & pay rates"), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Each person signs in with their email. Consults ($60) and follow-ups ($30) are fixed; toggle eligibility per person. Set variable rates below \u2014 leave a field blank or 0 and that pay type won't appear in their entry screen."), /* @__PURE__ */ React.createElement("div", { className: "add-emp" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "Add employee name\u2026",
      value: newName,
      onChange: (e) => setNewName(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && addEmp()
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: addEmp }, "Add")), draft.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "empty" }, "No employees yet. Add your first staff member above."), draft.length > 1 && /* @__PURE__ */ React.createElement("div", { className: "rates-toolbar" }, /* @__PURE__ */ React.createElement("button", { onClick: expandAll }, "Expand all"), /* @__PURE__ */ React.createElement("button", { onClick: collapseAll }, "Collapse all")), /* @__PURE__ */ React.createElement("datalist", { id: "role-options" }, roleOptions.map((r) => /* @__PURE__ */ React.createElement("option", { key: r, value: r }))), /* @__PURE__ */ React.createElement("div", null, roleGroups.map((g) => /* @__PURE__ */ React.createElement("div", { className: "role-group", key: g.key }, /* @__PURE__ */ React.createElement("div", { className: "role-header" }, g.label, " ", /* @__PURE__ */ React.createElement("span", { className: "role-count" }, g.emps.length)), g.emps.map((emp) => {
    const open = openIds.has(emp.id);
    const meta = empMeta(emp);
    return /* @__PURE__ */ React.createElement("div", { className: "emp-rate-block" + (open ? " open" : " collapsed"), key: emp.id }, /* @__PURE__ */ React.createElement("div", { className: "ename" }, /* @__PURE__ */ React.createElement("div", { className: "emp-head", onClick: () => toggleOpen(emp.id) }, /* @__PURE__ */ React.createElement("span", { className: "emp-chev" }, open ? "\u25BE" : "\u25B8"), /* @__PURE__ */ React.createElement("span", { className: "emp-name-txt" }, lastFirst(emp.name) || "Unnamed employee"), !open && /* @__PURE__ */ React.createElement("span", { className: "emp-meta" + (meta.warn ? " warn" : "") }, meta.user, " \xB7 ", meta.right)), open && /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", onClick: () => removeEmp(emp.id) }, "Remove")), open && editorFor(emp));
  })))), modalId && (() => {
    const emp = draft.find((e) => e.id === modalId);
    if (!emp) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "modal-backdrop", onClick: () => setModalId(null) }, /* @__PURE__ */ React.createElement("div", { className: "modal emp-modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "pto-head" }, /* @__PURE__ */ React.createElement("h3", null, "Add employee"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: cancelNewEmp }, "Cancel")), editorFor(emp), /* @__PURE__ */ React.createElement("div", { className: "modal-actions", style: { marginTop: 14, alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: blockReason ? "var(--amber)" : "var(--accent-ink)" } }, saving ? "Saving\u2026" : blockReason ? blockReason : dirty ? "Saving\u2026" : "\u2713 Saved"), /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => setModalId(null) }, "Done"))));
  })(), draft.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "actions", style: { justifyContent: "flex-end", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: blockReason ? "var(--amber)" : "var(--accent-ink)" } }, saving ? "Saving\u2026" : blockReason ? blockReason : dirty ? "Saving\u2026" : "\u2713 All changes saved")));
}
function AllEntries({ employees, entries, deleteEntry, showToast }) {
  const nameOf = (e) => {
    const m = employees.find((x) => x.id === e.empId);
    return m ? m.name : e.username ? e.username + " (removed)" : "\u2014";
  };
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const del = async (entry) => {
    await deleteEntry(entry);
    showToast("Entry deleted");
  };
  const summarize = (entry) => {
    const parts = ALL_TYPES.filter((t) => Number(entry.counts?.[t.key] || 0) > 0).map((t) => `${entry.counts[t.key]} ${t.label.toLowerCase()}`);
    if (entry.other && Number(entry.other.amount) > 0)
      parts.push(`Other ${money(entry.other.amount)}${entry.other.note ? " (" + entry.other.note + ")" : ""}`);
    return parts.join(", ") || "\u2014";
  };
  if (!entries.length) return /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("div", { className: "empty" }, "No entries logged yet."));
  return /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("h2", null, "All entries"), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Every logged entry. Delete any mistakes here."), /* @__PURE__ */ React.createElement("div", { className: "scroll-x" }, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Date"), /* @__PURE__ */ React.createElement("th", null, "Employee"), /* @__PURE__ */ React.createElement("th", null, "Logged"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Pay"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, sorted.map((e) => {
    const emp = employees.find((x) => x.id === e.empId);
    return /* @__PURE__ */ React.createElement("tr", { key: (e._uid || "") + e.id }, /* @__PURE__ */ React.createElement("td", { style: { whiteSpace: "nowrap" } }, e.date), /* @__PURE__ */ React.createElement("td", null, lastFirst(nameOf(e))), /* @__PURE__ */ React.createElement("td", { style: { color: "var(--muted)" } }, summarize(e)), /* @__PURE__ */ React.createElement("td", { className: "num pay" }, money(payForEntry(emp, e))), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right" } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", style: { padding: "5px 12px" }, onClick: () => del(e) }, "Delete")));
  })))));
}
function mountApp() {
  ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
}
if (window._firebaseReady) {
  mountApp();
} else {
  window.addEventListener("firebase-ready", mountApp, { once: true });
  setTimeout(() => {
    if (!window._firebaseReady) {
      document.getElementById("root").innerHTML = '<div style="max-width:560px;margin:60px auto;padding:24px;border:1px solid #e6e4dc;border-radius:14px;font-family:-apple-system,sans-serif;color:#1c1c1a;background:#fff;"><h2 style="margin:0 0 8px;font-size:18px;">Can\u2019t reach the database</h2><p style="margin:0;color:#6b6b66;line-height:1.5;">The Firebase config at the top of this file is missing or incorrect, so data can\u2019t load. Double-check that you pasted your own Firebase config values (no <code>PASTE_</code> placeholders left).</p></div>';
    }
  }, 8e3);
}
