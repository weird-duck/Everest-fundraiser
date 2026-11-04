/*
  THE CLIMB TO EVEREST — frontend
  --------------------------------
  1) Add your Supabase project URL and anon/public key below.
  2) Create the tables described in the setup notes supplied with this project.
  3) For a safe public launch, enable Row Level Security and use the policies in the setup notes.
  Without Supabase credentials, this site runs in local demo mode. Demo entries are stored
  only in this browser and are NOT shared with other visitors.
*/

const SUPABASE_URL = "";       // e.g. https://your-project.supabase.co
const SUPABASE_ANON_KEY = "";  // Supabase anon / publishable key only — NEVER service_role

const SUMMIT_METRES = 8848.86;
const DEMO_SESSIONS = [
  { id: "d1", user_id: "demo-1", display_name: "Alex Morgan", metres: 486, location: "Warwick Sport", created_at: "2026-10-28T17:30:00Z" },
  { id: "d2", user_id: "demo-2", display_name: "Sarah Thompson", metres: 352, location: "The Wave", created_at: "2026-10-28T15:00:00Z" },
  { id: "d3", user_id: "demo-3", display_name: "Jamie Patel", metres: 291, location: "Warwick Sport", created_at: "2026-10-27T18:00:00Z" },
  { id: "d4", user_id: "demo-4", display_name: "Morgan Lee", metres: 178, location: "Coventry Climbing Centre", created_at: "2026-10-26T16:00:00Z" }
];

const $ = (id) => document.getElementById(id);
const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabaseClient = hasSupabaseConfig && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = null;
let realtimeChannel = null;
let sessions = [];
let toastTimer;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setMessage(id, message, success = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle("success", success);
}

function readDemoSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem("everest-demo-sessions") || "[]");
    return [...DEMO_SESSIONS, ...saved];
  } catch {
    return [...DEMO_SESSIONS];
  }
}

function aggregateClimbers(rows) {
  const byUser = new Map();
  rows.forEach((row) => {
    const key = row.user_id || row.display_name || "unknown";
    if (!byUser.has(key)) {
      byUser.set(key, {
        name: row.display_name || row.profiles?.display_name || "Expedition climber",
        metres: 0, sessions: 0
      });
    }
    const person = byUser.get(key);
    person.metres += Number(row.metres) || 0;
    person.sessions += 1;
  });
  return [...byUser.values()].sort((a, b) => b.metres - a.metres);
}

function render() {
  const total = sessions.reduce((sum, item) => sum + (Number(item.metres) || 0), 0);
  const percentage = Math.min(100, (total / SUMMIT_METRES) * 100);
  const remaining = Math.max(0, SUMMIT_METRES - total);
  $("totalMetres").textContent = Math.round(total).toLocaleString("en-GB");
  $("remainingMetres").textContent = Math.ceil(remaining).toLocaleString("en-GB");
  $("sessionCount").textContent = sessions.length.toLocaleString("en-GB");
  $("progressPercent").textContent = `${percentage.toFixed(2)}%`;
  $("progressFill").style.width = `${percentage}%`;
  $("climberCount").textContent = aggregateClimbers(sessions).length.toLocaleString("en-GB");
  renderMountain(percentage);
  renderLeaderboard();
  renderMilestones(total);
}

function renderMountain(percentage) {
  const route = $("progressRoute");
  const marker = $("climberMarker");
  const length = route.getTotalLength();
  route.style.strokeDasharray = `${length * percentage / 100} ${length}`;
  const point = route.getPointAtLength(length * percentage / 100);
  marker.setAttribute("transform", `translate(${point.x} ${point.y})`);
}

function renderLeaderboard() {
  const people = aggregateClimbers(sessions);
  const container = $("leaderboardRows");
  if (!people.length) {
    container.innerHTML = '<div class="empty-state">No climbs have been logged yet. Be the first to contribute!</div>';
    return;
  }
  container.innerHTML = people.slice(0, 10).map((person, index) => {
    const initials = person.name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
    return `<div class="leader-row">
      <div class="leader-person"><span class="rank">${String(index + 1).padStart(2, "0")}</span><span class="avatar">${escapeHTML(initials)}</span><span><span class="person-name">${escapeHTML(person.name)}</span><span class="person-sub">Expedition climber</span></span></div>
      <div class="leader-number">${person.sessions}</div>
      <div class="leader-number"><strong>${Math.round(person.metres).toLocaleString("en-GB")}</strong> m</div>
    </div>`;
  }).join("");
}

function renderMilestones(total) {
  const thresholds = [0, 2500, 4500, 6500, 8000, SUMMIT_METRES];
  document.querySelectorAll(".milestone").forEach((node, index) => {
    node.classList.toggle("unlocked", total >= thresholds[index]);
  });
}

async function loadSessions() {
  if (!supabaseClient) {
    sessions = readDemoSessions();
    $("connectionLabel").textContent = "DEMO TRACKER";
    $("demoWarning").hidden = false;
    render();
    return;
  }
  $("connectionLabel").textContent = "CONNECTING";
  const { data, error } = await supabaseClient
    .from("climb_sessions")
    .select("id,user_id,display_name,metres,location,notes,created_at")
    .eq("approved", true)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Could not load sessions:", error);
    $("connectionLabel").textContent = "CONNECTION ISSUE";
    showToast("Couldn't load live climb data. Check your Supabase setup.");
    sessions = [];
  } else {
    sessions = data || [];
    $("connectionLabel").textContent = "LIVE TRACKER";
    $("demoWarning").hidden = true;
  }
  render();
}

function subscribeToUpdates() {
  if (!supabaseClient || realtimeChannel) return;
  realtimeChannel = supabaseClient
    .channel("public-climb-sessions")
    .on("postgres_changes", { event: "*", schema: "public", table: "climb_sessions" }, () => loadSessions())
    .subscribe();
}

function openModal() {
  $("loginModal").classList.add("open");
  $("loginModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  $("loginModal").classList.remove("open");
  $("loginModal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

async function refreshAuthState() {
  if (!supabaseClient) {
    $("authPanel").hidden = false;
    $("sessionPanel").hidden = true;
    $("demoWarning").hidden = false;
    return;
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;
  $("authPanel").hidden = Boolean(currentUser);
  $("sessionPanel").hidden = !currentUser;
  $("demoWarning").hidden = true;
  if (currentUser) {
    $("signedInEmail").textContent = currentUser.email || "";
    $("climbDate").value = new Date().toISOString().slice(0, 10);
  }
}

async function signIn() {
  if (!supabaseClient) {
    setMessage("authMessage", "Connect Supabase to enable real sign-in. Demo mode does not create accounts.");
    return;
  }
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;
  if (!email || !password) return setMessage("authMessage", "Enter your email and password.");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setMessage("authMessage", error.message);
  setMessage("authMessage", "Signed in successfully.", true);
  await refreshAuthState();
}

async function signUp() {
  if (!supabaseClient) {
    setMessage("authMessage", "Connect Supabase to enable account creation.");
    return;
  }
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;
  if (!email || !password) return setMessage("authMessage", "Enter your email and choose a password.");
  if (password.length < 8) return setMessage("authMessage", "Use a password with at least 8 characters.");
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) return setMessage("authMessage", error.message);
  setMessage("authMessage", "Account created. Check your email if confirmation is enabled.", true);
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  await refreshAuthState();
  setMessage("authMessage", "");
  showToast("You've signed out.");
}

async function submitClimb(event) {
  event.preventDefault();
  const metres = Number($("climbMetres").value);
  const date = $("climbDate").value;
  const location = $("climbLocation").value.trim();
  const notes = $("climbNotes").value.trim();
  if (!Number.isFinite(metres) || metres < 1 || metres > 5000) {
    return setMessage("logMessage", "Enter a distance between 1 and 5,000 metres.");
  }
  if (!date) return setMessage("logMessage", "Choose the date of your session.");

  if (!supabaseClient) {
    return setMessage("logMessage", "Demo mode cannot submit shared climbs. Connect Supabase first.");
  }
  if (!currentUser) return setMessage("logMessage", "Please sign in again before submitting.");

  const { data: profile } = await supabaseClient
    .from("profiles").select("display_name").eq("id", currentUser.id).maybeSingle();

  const { error } = await supabaseClient.from("climb_sessions").insert({
    user_id: currentUser.id,
    display_name: profile?.display_name || currentUser.email?.split("@")[0] || "Climber",
    metres,
    session_date: date,
    location: location || null,
    notes: notes || null,
    approved: false
  });
  if (error) {
    console.error(error);
    return setMessage("logMessage", `Couldn't submit your climb: ${error.message}`);
  }
  $("climbForm").reset();
  $("climbDate").value = new Date().toISOString().slice(0, 10);
  setMessage("logMessage", "Your climb has been submitted for approval. Thanks for contributing!", true);
  showToast("Climb submitted for approval.");
}

function setUpNavigation() {
  $("menuToggle").addEventListener("click", () => {
    const open = $("mainNav").classList.toggle("open");
    $("menuToggle").setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll("#mainNav a").forEach((link) => link.addEventListener("click", () => {
    $("mainNav").classList.remove("open");
    $("menuToggle").setAttribute("aria-expanded", "false");
  }));
  ["openLogin", "openLoginBottom"].forEach((id) => $(id).addEventListener("click", openModal));
  $("closeModal").addEventListener("click", closeModal);
  $("loginModal").addEventListener("click", (event) => {
    if (event.target === $("loginModal")) closeModal();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
  $("signInButton").addEventListener("click", signIn);
  $("signUpButton").addEventListener("click", signUp);
  $("signOutButton").addEventListener("click", signOut);
  $("climbForm").addEventListener("submit", submitClimb);
  $("leaderboardLink").addEventListener("click", (event) => {
    event.preventDefault();
    $("climbers").scrollIntoView({ behavior: "smooth" });
  });
}

async function init() {
  $("year").textContent = new Date().getFullYear();
  $("climbDate").value = new Date().toISOString().slice(0, 10);
  setUpNavigation();
  await loadSessions();
  await refreshAuthState();
  subscribeToUpdates();
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange(() => refreshAuthState());
  }
  $("donateLink").addEventListener("click", (event) => {
    if ($("donateLink").getAttribute("href") === "#") {
      event.preventDefault();
      showToast("Add your official fundraising URL in index.html.");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
