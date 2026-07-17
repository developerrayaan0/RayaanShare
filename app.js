const hostBtn = document.getElementById("hostBtn");
const connectBtn = document.getElementById("connectBtn");
const copyBtn = document.getElementById("copyBtn");
const sendBtn = document.getElementById("sendBtn");

const myId = document.getElementById("myId");
const friendId = document.getElementById("friendId");
const status = document.getElementById("status");

let peer = null;
let conn = null;

function updateStatus(text) {
    status.textContent = text;
}

hostBtn.onclick = () => {
    
    if (peer) peer.destroy();
    
    updateStatus("Creating Host...");
    
    peer = new Peer();
    
    peer.on("open", (id) => {
        
        myId.value = id;
        
        updateStatus("Waiting for friend...");
        
    });
    
    peer.on("connection", (connection) => {
        
        conn = connection;
        
        setupConnection();
        
    });
    
};

connectBtn.onclick = () => {
    
    if (friendId.value.trim() == "") {
        alert("Enter Friend ID");
        return;
    }
    
    if (peer) peer.destroy();
    
    updateStatus("Connecting...");
    
    peer = new Peer();
    
    peer.on("open", () => {
        
        conn = peer.connect(friendId.value.trim());
        
        setupConnection();
        
    });
    
};

function setupConnection() {
    
    conn.on("open", () => {
        
        updateStatus("Connected");
        
        sendBtn.disabled = false;
        
    });
    
    conn.on("close", () => {
        
        updateStatus("Disconnected");
        
        sendBtn.disabled = true;
        
    });
    
    conn.on("error", (err) => {
        
        console.log(err);
        
        updateStatus("Connection Error");
        
    });
    
}

copyBtn.onclick = () => {
    
    if (myId.value == "") return;
    
    navigator.clipboard.writeText(myId.value);
    
    alert("Copied");
    
};