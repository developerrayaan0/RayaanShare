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

        // serialization: "none" sends raw ArrayBuffers straight to the
        // WebRTC data channel, skipping PeerJS's default msgpack-style
        // encoder (BinaryPack). That encoder re-chunks and copies binary
        // payloads internally and is the main reason throughput was
        // capped well below actual bandwidth.
        conn = peer.connect(id, { reliable: true, serialization: "none" });

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

        // Control messages (meta / done) are sent as JSON strings.
        // Everything else is a raw binary chunk (ArrayBuffer).
        if (typeof data === "string") {

            const msg = JSON.parse(data);

            if (msg.type === "meta") {

                fileInfo = msg;

                receivedChunks = [];
                receivedSize = 0;

                receiving = true;

                totalChunks = Math.ceil(msg.size / CHUNK_SIZE);

                progress.value = 0;

                lastUpdateTime = Date.now();
                lastBytes = 0;

                updateStatus(
                    "Receiving: " +
                    msg.name +
                    " (" +
                    msg.sizeText +
                    ")"
                );

            } else if (msg.type === "done") {

                receiving = false;

                progress.value = 100;

                updateStatus("Saving File...");

                transferFinished = true;

                saveReceivedFile();

            }

            return;
        }

        // Binary chunk. Depending on browser this may arrive as
        // ArrayBuffer or a typed array/Blob-like wrapper — normalize it.
        if (!receiving || !fileInfo) {
            return;
        }

        const chunk = data instanceof ArrayBuffer ? data : data.buffer || data;

        receivedChunks.push(chunk);

        receivedSize += chunk.byteLength;

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

    });

}

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
// File Transfer Variables
// ---------------------------

// Larger chunks = less per-chunk overhead. Now that we send raw
// ArrayBuffers (no msgpack re-encoding), 512KB is safe in current
// Chrome/Firefox/Edge. If you see send errors on older browsers,
// drop this back to 256 * 1024.
const CHUNK_SIZE = 512 * 1024; // 512 KB

// Flow-control high-water mark. If the underlying WebRTC send buffer
// grows past this, we pause reading/sending until it drains. This
// replaces the old "wait for ack after every chunk" approach, which
// capped throughput at roughly 1 chunk per network round-trip.
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // 16 MB
const BUFFER_CHECK_INTERVAL_MS = 10;

let sending = false;
let receiving = false;

let receivedChunks = [];
let receivedSize = 0;

let fileInfo = null;

// ---------------------------
// Send File Metadata
// ---------------------------

function sendMetadata(file) {

    conn.send(JSON.stringify({
        type: "meta",
        name: file.name,
        size: file.size,
        sizeText: formatFileSize(file.size)
    }));

}

// ---------------------------
// Start Sending Chunks (streamed, buffer-aware)
// ---------------------------

function sendFile(file) {

    lastUpdateTime = Date.now();
    lastBytes = 0;

    totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    averageChunkSize = CHUNK_SIZE;

    bytesSent = 0;
    chunksSent = 0;

    transferCancelled = false;
    transferFinished = false;

    sending = true;

    transferStartTime = Date.now();
    lastProgress = 0;

    let offset = 0;

    const reader = new FileReader();

    function getBufferedAmount() {
        return (conn.dataChannel && conn.dataChannel.bufferedAmount) || 0;
    }

    function readNext() {

        if (transferCancelled) {
            return;
        }

        // Backpressure: don't read/send more until the channel's
        // internal buffer has drained below the threshold.
        if (getBufferedAmount() > MAX_BUFFERED_AMOUNT) {
            setTimeout(readNext, BUFFER_CHECK_INTERVAL_MS);
            return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);

        reader.readAsArrayBuffer(slice);

    }

    reader.onload = (e) => {

        if (transferCancelled) {
            return;
        }

        const chunk = e.target.result;

        // Raw send — no wrapping object, no JSON/msgpack encoding.
        conn.send(chunk);

        bytesSent += chunk.byteLength;
        chunksSent++;

        offset += chunk.byteLength;

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

            readNext();

        } else {

            sending = false;

            conn.send(JSON.stringify({ type: "done" }));

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

    readNext();

}

// ---------------------------
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

function resetTransfer() {

    sending = false;
    receiving = false;

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
