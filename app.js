/* Circle Chat — app.js
   - Firebase Auth (Email/Password) for login/register
   - Firebase Realtime Database for room chat + typing indicator
   - Single-page UI with two "views" (auth vs chat)

   IMPORTANT:
   1) Create a Firebase project
   2) Enable Authentication -> Email/Password
   3) Create a Realtime Database
   4) Add the DB rules (shown in index.html and below)
   5) Replace firebaseConfig with your project's config

   Realtime Database rules (required by prompt):
   {
     "rules": {
       "rooms": {
         "$room": {
           ".read": "auth != null",
           ".write": "auth != null"
         }
       }
     }
   }
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  onValue,
  onChildAdded,
  query,
  limitToLast,
  serverTimestamp,
  onDisconnect,
  remove
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* ----------------------------- Firebase Setup ----------------------------- */

const firebaseConfig = {
  // TODO: Replace with your Firebase project configuration:
  apiKey: "YOUR_API_KEY",
  authDomain: "circlechat1.firebaseapp.com",
  databaseURL: "https://circlechat1-default-rtdb.firebaseio.com",
  projectId: "circlechat1",
  storageBucket: "circlechat1.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

/* ------------------------------- DOM Helpers ------------------------------ */

const $ = (sel) => document.querySelector(sel);

function setText(el, value) {
  el.textContent = value ?? "";
}

function show(el) {
  el.classList.remove("hidden");
}

function hide(el) {
  el.classList.add("hidden");
}

function setStatus(text, isMuted = true) {
  const el = $("#statusLabel");
  setText(el, text);
  el.classList.toggle("muted", isMuted);
}

function normalizeRoomId(input) {
  // RTDB keys cannot include: . # $ [ ]
  // Keep it human-friendly: lowercase and turn disallowed chars into hyphens.
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[.#$\[\]]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function randomRoomCode() {
  const adjectives = ["blue", "quiet", "nova", "swift", "mint", "lunar", "ember", "neon", "polar", "orbit"];
  const animals = ["fox", "owl", "otter", "tiger", "koala", "eagle", "whale", "panda", "wolf", "lynx"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const ani = animals[Math.floor(Math.random() * animals.length)];
  const num = Math.floor(Math.random() * 900 + 100); // 100-999
  return `${adj}-${ani}-${num}`;
}

function formatTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

/* ------------------------------- UI Elements ------------------------------ */

// Views
const authView = $("#authView");
const chatView = $("#chatView");

// Tabs & Forms
const tabLogin = $("#tabLogin");
const tabRegister = $("#tabRegister");

const loginForm = $("#loginForm");
const registerForm = $("#registerForm");

const loginError = $("#loginError");
const registerError = $("#registerError");

// Auth inputs
const loginEmail = $("#loginEmail");
const loginPassword = $("#loginPassword");

const registerUsername = $("#registerUsername");
const registerEmail = $("#registerEmail");
const registerPassword = $("#registerPassword");

// Chat UI
const userBadge = $("#userBadge");
const userNameEl = $("#userName");
const userEmailEl = $("#userEmail");
const logoutBtn = $("#logoutBtn");

const roomInput = $("#roomInput");
const joinRoomBtn = $("#joinRoomBtn");
const createRoomBtn = $("#createRoomBtn");
const copyRoomBtn = $("#copyRoomBtn");

const currentRoomLabel = $("#currentRoomLabel");
const roomTitle = $("#roomTitle");
const typingIndicator = $("#typingIndicator");

const messagesEl = $("#messages");
const messageForm = $("#messageForm");
const messageInput = $("#messageInput");
const sendBtn = $("#sendBtn");

const scrollToBottomBtn = $("#scrollToBottomBtn");

/* --------------------------- App State / Listeners ------------------------- */

let currentRoomId = null;

// Unsubscribe functions for room listeners
let unsubscribeMessages = null;
let unsubscribeTyping = null;

// Typing presence refs/timers
let myTypingRef = null;
let typingIdleTimer = null;

const TYPING_TTL_MS = 7000; // consider "typing" recent if updated within this window
const TYPING_IDLE_CLEAR_MS = 1400; // stop typing after inactivity

/* --------------------------------- Tabs ---------------------------------- */

function setAuthTab(tab) {
  const isLogin = tab === "login";
  tabLogin.classList.toggle("active", isLogin);
  tabRegister.classList.toggle("active", !isLogin);

  tabLogin.setAttribute("aria-selected", String(isLogin));
  tabRegister.setAttribute("aria-selected", String(!isLogin));

  loginError.textContent = "";
  registerError.textContent = "";

  if (isLogin) {
    show(loginForm);
    hide(registerForm);
  } else {
    hide(loginForm);
    show(registerForm);
  }
}

tabLogin.addEventListener("click", () => setAuthTab("login"));
tabRegister.addEventListener("click", () => setAuthTab("register"));

/* ------------------------------ Auth Handlers ----------------------------- */

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";

  try {
    await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
  } catch (err) {
    loginError.textContent = humanizeAuthError(err);
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  registerError.textContent = "";

  const username = registerUsername.value.trim();
  const email = registerEmail.value.trim();
  const password = registerPassword.value;

  if (username.length < 2) {
    registerError.textContent = "Username must be at least 2 characters.";
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // Store username on the Auth profile so messages can display it reliably.
    await updateProfile(cred.user, { displayName: username });

    // Optional: auto-join the last room from localStorage (handled by auth observer).
  } catch (err) {
    registerError.textContent = humanizeAuthError(err);
  }
});

logoutBtn.addEventListener("click", async () => {
  await leaveRoom(); // clean up listeners + typing presence
  await signOut(auth);
});

/* ------------------------- Auth State / View Switch ------------------------ */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Signed out
    hide(chatView);
    show(authView);

    hide(userBadge);
    hide(logoutBtn);

    setStatus("Not connected");
    setText(currentRoomLabel, "—");
    setText(roomTitle, "—");

    // Reset message UI
    messagesEl.innerHTML = "";
    messageInput.value = "";
    messageInput.disabled = true;
    sendBtn.disabled = true;
    copyRoomBtn.disabled = true;

    currentRoomId = null;
    return;
  }

  // Signed in
  hide(authView);
  show(chatView);

  show(userBadge);
  show(logoutBtn);

  setText(userNameEl, user.displayName || "Anonymous");
  setText(userEmailEl, user.email || "");

  setStatus("Signed in", true);

  // Restore last room (if any)
  const lastRoom = normalizeRoomId(localStorage.getItem("circlechat:lastRoom") || "");
  if (lastRoom) {
    roomInput.value = lastRoom;
    await connectRoom(lastRoom);
  } else {
    setStatus("Join or create a room", true);
  }
});

/* ------------------------------ Room Controls ----------------------------- */

joinRoomBtn.addEventListener("click", async () => {
  const id = normalizeRoomId(roomInput.value);
  if (!id) {
    setStatus("Enter a valid room code", true);
    return;
  }
  await connectRoom(id);
});

createRoomBtn.addEventListener("click", async () => {
  const id = normalizeRoomId(randomRoomCode());
  roomInput.value = id;
  await connectRoom(id);
});

copyRoomBtn.addEventListener("click", async () => {
  if (!currentRoomId) return;
  try {
    await navigator.clipboard.writeText(currentRoomId);
    setStatus("Room code copied", true);
    setTimeout(() => setStatus("Connected", true), 900);
  } catch {
    setStatus("Copy failed (clipboard blocked)", true);
  }
});

/* ------------------------------- Chat Logic -------------------------------- */

async function leaveRoom() {
  // Stop DB listeners
  if (typeof unsubscribeMessages === "function") unsubscribeMessages();
  if (typeof unsubscribeTyping === "function") unsubscribeTyping();
  unsubscribeMessages = null;
  unsubscribeTyping = null;

  // Clear typing timers
  if (typingIdleTimer) clearTimeout(typingIdleTimer);
  typingIdleTimer = null;

  // Remove our typing presence in the room
  if (myTypingRef) {
    try { await remove(myTypingRef); } catch { /* ignore */ }
    myTypingRef = null;
  }

  // Reset UI (keep signed-in state)
  typingIndicator.textContent = "";
  messageInput.disabled = true;
  sendBtn.disabled = true;
  copyRoomBtn.disabled = true;
  setText(currentRoomLabel, "—");
  setText(roomTitle, "—");
  setStatus("Join or create a room", true);

  currentRoomId = null;
}

async function connectRoom(roomId) {
  const user = auth.currentUser;
  if (!user) return;

  const normalized = normalizeRoomId(roomId);
  if (!normalized) return;

  if (currentRoomId === normalized) return;

  // Clean up previous room
  await leaveRoom();

  currentRoomId = normalized;
  localStorage.setItem("circlechat:lastRoom", currentRoomId);

  // Update UI
  setText(currentRoomLabel, currentRoomId);
  setText(roomTitle, currentRoomId);
  setStatus("Connecting…", true);

  messagesEl.innerHTML = "";
  messageInput.disabled = false;
  sendBtn.disabled = false;
  copyRoomBtn.disabled = false;

  // Listen for messages (last 200 for performance)
  const msgsRef = ref(db, `rooms/${currentRoomId}/messages`);
  const msgsQuery = query(msgsRef, limitToLast(200));

  // We use onChildAdded to append incrementally (smooth + efficient)
  unsubscribeMessages = onChildAdded(msgsQuery, (snap) => {
    const msg = snap.val();
    appendMessage({
      id: snap.key,
      uid: msg?.uid,
      name: msg?.name,
      text: msg?.text,
      createdAt: msg?.createdAt
    });
  }, (err) => {
    console.error("messages listener error:", err);
    setStatus("Message stream error (check rules/config)", false);
  });

  // Typing indicator: listen to room typing nodes
  const typingRef = ref(db, `rooms/${currentRoomId}/typing`);
  unsubscribeTyping = onValue(typingRef, (snap) => {
    const now = Date.now();
    const data = snap.val() || {};
    const others = Object.entries(data)
      .filter(([uid, v]) => uid !== user.uid && v && typeof v === "object")
      .filter(([, v]) => {
        // "ts" may be a number (resolved server timestamp) or sometimes null briefly
        const ts = typeof v.ts === "number" ? v.ts : 0;
        return ts && (now - ts) < TYPING_TTL_MS;
      })
      .map(([, v]) => v.name)
      .filter(Boolean);

    if (others.length === 0) {
      typingIndicator.textContent = "";
    } else if (others.length === 1) {
      typingIndicator.textContent = `${others[0]} is typing…`;
    } else {
      typingIndicator.textContent = `${others.slice(0, 2).join(", ")} are typing…`;
    }
  });

  // Set up our typing presence ref for this room
  myTypingRef = ref(db, `rooms/${currentRoomId}/typing/${user.uid}`);
  try {
    // Ensure presence is removed when the tab closes unexpectedly
    onDisconnect(myTypingRef).remove();
  } catch {
    // onDisconnect can fail if offline; safe to ignore
  }

  setStatus("Connected", true);
}

/* --------------------------- Message Composer UX --------------------------- */

function autosizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

messageInput.addEventListener("input", () => {
  autosizeTextarea(messageInput);
  bumpTyping();
});

messageInput.addEventListener("keydown", (e) => {
  // Enter to send; Shift+Enter for newline
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    messageForm.requestSubmit();
  }
});

messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user || !currentRoomId) return;

  const text = messageInput.value.trim();
  if (!text) return;

  const name = user.displayName || "Anonymous";

  try {
    const msgRef = push(ref(db, `rooms/${currentRoomId}/messages`));

    // Write message payload. Use serverTimestamp() for consistent time ordering.
    await set(msgRef, {
      uid: user.uid,
      name,
      text,
      createdAt: serverTimestamp()
    });

    messageInput.value = "";
    autosizeTextarea(messageInput);
    stopTypingSoon(true); // clear typing quickly after sending
  } catch (err) {
    console.error(err);
    setStatus("Failed to send (check rules/config)", false);
  }
});

/* ----------------------------- Typing Indicator ---------------------------- */

function bumpTyping() {
  const user = auth.currentUser;
  if (!user || !currentRoomId || !myTypingRef) return;

  const name = user.displayName || "Anonymous";

  // Update typing presence with server timestamp
  set(myTypingRef, { name, ts: serverTimestamp() }).catch(() => { /* ignore */ });

  // Clear after idle
  stopTypingSoon(false);
}

function stopTypingSoon(immediate) {
  if (!myTypingRef) return;

  if (typingIdleTimer) clearTimeout(typingIdleTimer);
  typingIdleTimer = setTimeout(async () => {
    try { await remove(myTypingRef); } catch { /* ignore */ }
  }, immediate ? 250 : TYPING_IDLE_CLEAR_MS);
}

/* ------------------------------ Messages UI -------------------------------- */

function isNearBottom(el, thresholdPx = 140) {
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance < thresholdPx;
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

messagesEl.addEventListener("scroll", () => {
  // Show "Newest" button if user scrolls away from bottom
  const near = isNearBottom(messagesEl, 220);
  scrollToBottomBtn.classList.toggle("hidden", near);
});

scrollToBottomBtn.addEventListener("click", () => {
  scrollToBottom(messagesEl);
  scrollToBottomBtn.classList.add("hidden");
});

function appendMessage({ uid, name, text, createdAt }) {
  const user = auth.currentUser;
  const mine = user && uid === user.uid;

  const shouldAutoScroll = isNearBottom(messagesEl);

  const wrap = document.createElement("div");
  wrap.className = "msg" + (mine ? " mine" : "");

  const header = document.createElement("div");
  header.className = "msgHeader";

  const nameEl = document.createElement("div");
  nameEl.className = "msgName";
  nameEl.textContent = name || "Anonymous";

  const timeEl = document.createElement("div");
  timeEl.className = "msgTime";
  timeEl.textContent = formatTime(createdAt);

  const body = document.createElement("div");
  body.className = "msgText";
  body.textContent = text || "";

  header.appendChild(nameEl);
  header.appendChild(timeEl);

  wrap.appendChild(header);
  wrap.appendChild(body);

  messagesEl.appendChild(wrap);

  if (shouldAutoScroll) {
    scrollToBottom(messagesEl);
    scrollToBottomBtn.classList.add("hidden");
  }
}

/* ------------------------------- Error Text -------------------------------- */

function humanizeAuthError(err) {
  const code = err?.code || "";
  // Friendly messages for common Firebase Auth errors
  switch (code) {
    case "auth/invalid-email":
      return "That email address is invalid.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account already exists for that email.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait and try again.";
    default:
      return err?.message || "Authentication error.";
  }
}

/* ------------------------------ Initial State ------------------------------ */

setAuthTab("login");
setStatus("Not connected", true);
