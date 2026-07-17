// ================================
// P2P File Share - Part 1
// PeerJS Connection
// ================================

// UI
const hostBtn = document.getElementById("hostBtn");
const connectBtn = document.getElementById("connectBtn");
const copyBtn = document.getElementById("copyBtn");
const sendBtn = document.getElementById("sendBtn");

const myId = document.getElementById("myId");
const friendId = document.getElementById("friendId");
const fileInput = document.getElementById("fileInput");

const progress = document.getElementById("progress");
const status = document.getElementById("status");

// PeerJS
let peer = null;
let conn = null;

// Selected File
let selectedFile = null;

let transferStartTime = 0;
let lastProgress = 0;

let waitingForAck = false;
let nextChunkFunction = null;

let transferCancelled = false;
let transferFinished = false;

let bytesSent = 0;
let bytesReceived = 0;

let chunksSent = 0;
let chunksReceived = 0;

let totalChunks = 0;
let averageChunkSize = 0;

let lastUpdateTime = 0;
let lastBytes = 0;

// -----------------------------

function updateStatus(text) {
    status.textContent = text;
}

// -----------------------------
// Host
// -----------------------------

hostBtn.onclick = () => {
    
    if (peer) {
        peer.destroy();
    }
    
    updateStatus("Creating Host...");
    
    peer = new Peer();
    
    peer.on("open", (id) => {
        
        myId.value = id;
        
        updateStatus("Waiting for Friend...");
        
    });
    
    peer.on("connection", (connection) => {
        
        conn = connection;
        
        setupConnection();
        
    });
    
};

// -----------------------------
// Connect
// -----------------------------

connectBtn.onclick = () => {
    
    const id = friendId.value.trim();
    
    if (id === "") {
        alert("Enter Friend ID");
        return;
    }
    
    if (peer) {
        peer.destroy();
    }
    
    updateStatus("Connecting...");
    
    peer = new Peer();
    
    peer.on("open", () => {
        
        conn = peer.connect(id);
        
        setupConnection();
        
    });
    
};

// -----------------------------
// Connection Events
// -----------------------------

function setupConnection() {
    
    conn.on("open", () => {
        
        updateStatus("Connected");
        
        sendBtn.disabled = false;
        
    });
    
    conn.on("close", () => {
    
    resetTransfer();
    
    sendBtn.disabled = true;
    
    updateStatus("Disconnected");
    
});
    
    conn.on("error", (err) => {
    
    console.error(err);
    
    resetTransfer();
    
    updateStatus("Connection Error");
    
});
    
    conn.on("data", (data) => {
    
    if (data.type === "meta") {
    
    fileInfo = data;
    
    receivedChunks = [];
    receivedSize = 0;
    
    receiving = true;
    
    totalChunks = Math.ceil(data.size / CHUNK_SIZE);
    
    progress.value = 0;
    
    updateStatus(
        "Receiving: " +
        data.name +
        " (" +
        data.sizeText +
        ")"
    );
    
    return;
}
    
    if (data.type === "chunk") {
    
    if (!receiving || !fileInfo) {
        return;
    }
    
    receivedChunks.push(data.data);
    
    receivedSize += data.data.byteLength;
    
    bytesReceived = receivedSize;
    
    chunksReceived++;
    
    progress.value = Math.floor(
        (receivedSize / fileInfo.size) * 100
    );
    
    updateStatus(
        "Receiving... " +
        progress.value +
        "% | " +
        chunksReceived +
        "/" +
        totalChunks +
        " Chunks | " +
        getTransferSpeed(bytesReceived)
    );
    
    conn.send({
        type: "ack"
    });
    
    return;
}

if (data.type === "ack") {
    
    waitingForAck = false;
    
    sendNextChunk();
    
    return;
}
    
    if (data.type === "done") {
    
    receiving = false;
    
    progress.value = 100;
    
    updateStatus("Saving File...");
    
    transferFinished = true;
    
    saveReceivedFile();
    
    return;
}
    
});

// -----------------------------
// Copy ID
// -----------------------------

copyBtn.onclick = () => {
    
    if (myId.value === "") return;
    
    navigator.clipboard.writeText(myId.value);
    
    alert("ID Copied");
    
};

// -----------------------------
// File Selected
// -----------------------------

fileInput.onchange = () => {
    
    selectedFile = fileInput.files[0];
    
    if (selectedFile) {
        
        updateStatus(
            selectedFile.name +
            " (" +
            Math.round(selectedFile.size / 1024 / 1024) +
            " MB)"
        );
        
    }
    
};

// -----------------------------
// Send Button
// -----------------------------

sendBtn.onclick = () => {
    
    if (sending || receiving) {
    
    alert("A transfer is already in progress.");
    
    return;
    
}
    
    if (!selectedFile) {
        
        alert("Choose a file");
        return;
        
    }
    
    if (!conn || !conn.open) {
        
        alert("Not Connected");
        return;
        
    }
    
    sendMetadata(selectedFile);
    
    updateStatus("Sending...");
sendFile(selectedFile);
    
};

// ---------------------------
// Part 2A-1
// File Transfer Variables
// ---------------------------

const CHUNK_SIZE = 64 * 1024; // 64 KB

let sending = false;
let receiving = false;

let receivedChunks = [];
let receivedSize = 0;

let fileInfo = null;

// ---------------------------
// Part 2A-2
// Send File Metadata
// ---------------------------

function sendMetadata(file) {
    
    conn.send({
        type: "meta",
        name: file.name,
        size: file.size,
    sizeText: formatFileSize(file.size)
    });
    
}

// ---------------------------
// Part 2A-3
// Start Sending Chunks
// ---------------------------

function sendFile(file) {
    
    lastUpdateTime = Date.now();
lastBytes = 0;
    
    totalChunks = Math.ceil(file.size / CHUNK_SIZE);
averageChunkSize = CHUNK_SIZE;

    bytesSent = 0;
    
    transferCancelled = false;
    transferFinished = false;
    
    sending = true;
    
    transferStartTime = Date.now();
    lastProgress = 0;
    
    let offset = 0;
    
    const reader = new FileReader();
    
    reader.onload = (e) => {
        
        if (transferCancelled) {
             return;
}
        
        conn.send({
    type: "chunk",
    data: e.target.result
});

bytesSent += e.target.result.byteLength;
chunksSent++;
        
        offset += e.target.result.byteLength;
        
        const percent = Math.floor((offset / file.size) * 100);

if (percent !== lastProgress) {
    
    lastProgress = percent;
    progress.value = percent;
    
}
        
        updateStatus(
    "Sending... " +
    progress.value +
    "% | " +
    chunksSent +
    "/" +
    totalChunks +
    " Chunks | " +
    getTransferSpeed(bytesSent)
);
        
        if (offset < file.size) {
    
    waitingForAck = true;
    
    progress.value = Math.min(progress.value, 99);
    
    nextChunkFunction = readNext;
    
} else {
    
    sending = false;
    
    conn.send({
        type: "done"
    });
    
    const seconds = ((Date.now() - transferStartTime) / 1000).toFixed(1);
    
    updateStatus(
    "File Sent ✓ (" +
    formatFileSize(selectedFile.size) +
    ") in " +
    seconds +
    "s"
);
    
}
        
    };
    
    function readNext() {
        
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        
        reader.readAsArrayBuffer(slice);
        
    }
    
    readNext();
    
}

// ---------------------------
// Part 2B-2
// Download Received File
// ---------------------------

function saveReceivedFile() {
    
    const blob = new Blob(receivedChunks);
    
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    
    a.href = url;
    a.download = fileInfo.name;
    
    document.body.appendChild(a);
    
    a.click();
    
    a.remove();
    
    URL.revokeObjectURL(url);
    
    receivedChunks = [];
    receivedSize = 0;
    fileInfo = null;
    
    chunksSent = 0;
chunksReceived = 0;

bytesSent = 0;
bytesReceived = 0;

totalChunks = 0;
averageChunkSize = 0;

selectedFile = null;

fileInput.value = "";

resetTransfer();

updateStatus("Download Complete. Ready for next transfer");
}

function getTransferSpeed(bytesTransferred) {
    
    const now = Date.now();
    
    const seconds = (now - lastUpdateTime) / 1000;
    
    if (seconds <= 0) return "0 MB/s";
    
    const speed = ((bytesTransferred - lastBytes) / 1024 / 1024) / seconds;
    
    lastBytes = bytesTransferred;
    lastUpdateTime = now;
    
    return speed.toFixed(2) + " MB/s";
    
}

// ---------------------------
// Part 3A-2
// Send Next Chunk
// ---------------------------

function sendNextChunk() {
    
    if (!waitingForAck && nextChunkFunction) {
        
        nextChunkFunction();
        
        nextChunkFunction = null;
        
    }
    
}

function resetTransfer() {
    
    sending = false;
    receiving = false;
    
    waitingForAck = false;
    nextChunkFunction = null;
    
    transferCancelled = false;
    transferFinished = false;
    
    bytesSent = 0;
    bytesReceived = 0;
    
    chunksSent = 0;
    chunksReceived = 0;
    
    totalChunks = 0;
    
    progress.value = 0;
    
}

function formatFileSize(bytes) {
    
    if (bytes < 1024)
        return bytes + " B";
    
    if (bytes < 1024 * 1024)
        return (bytes / 1024).toFixed(1) + " KB";
    
    if (bytes < 1024 * 1024 * 1024)
        return (bytes / 1024 / 1024).toFixed(2) + " MB";
    
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
    
}
}
