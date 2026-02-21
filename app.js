var firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  databaseURL: "YOUR_DB_URL",
  projectId: "YOUR_PROJECT_ID",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();

let currentRoom = "";

// Register
function register(){
  auth.createUserWithEmailAndPassword(
    email.value, password.value
  ).then(()=> alert("Account Created"));
}

// Login
function login(){
  auth.signInWithEmailAndPassword(
    email.value, password.value
  ).then(()=>{
    authSection.classList.add("hidden");
    chatSection.classList.remove("hidden");
  });
}

// Logout
function logout(){
  auth.signOut();
  location.reload();
}

// Join Room
function joinRoom(){
  currentRoom = roomInput.value;
  chatBox.innerHTML = "";

  db.ref("rooms/"+currentRoom+"/messages")
  .limitToLast(100)
  .on("child_added", snap=>{
    const data = snap.val();
    addMessage(data.user, data.text, data.time);
  });
}

// Send Message
function sendMessage(){
  if(!currentRoom) return alert("Join a room first");

  const user = auth.currentUser.email;
  const msg = messageInput.value.trim();
  if(msg === "") return;

  db.ref("rooms/"+currentRoom+"/messages").push({
    user:user,
    text:msg,
    time:new Date().toLocaleTimeString()
  });

  messageInput.value="";
}

// Add Message UI
function addMessage(user,text,time){
  const div = document.createElement("div");
  div.className="message";
  div.innerHTML=`<b>${user}</b>: ${text}<div class="time">${time}</div>`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}