let selectedFile = null;

let receivedChunks = [];
let receivedFileName = "";
let receivedFileSize = 0;

const CHUNK_SIZE = 64 * 1024;

let fileReader;
let offset = 0;

const fileInput = document.getElementById("fileInput");
const progress = document.getElementById("progress");

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

function setupConnection() {
    
    conn.on("open", () => {
        
        updateStatus("Connected");
        
        sendBtn.disabled = false;
        
    });
    
    conn.on("data", (data) => {
    
    if (data.type === "info") {
        
        receivedChunks = [];
        receivedFileName = data.name;
        receivedFileSize = data.size;
        
        progress.value = 0;
        
        updateStatus("Receiving: " + receivedFileName);
        return;
    }
    
    if (data.type === "done") {
        
        const blob = new Blob(receivedChunks);
        
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement("a");
        
        a.href = url;
        a.download = receivedFileName;
        
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        URL.revokeObjectURL(url);
        
        updateStatus("Download Complete");
        progress.value = 100;
        
        return;
    }
    
    if (data instanceof ArrayBuffer) {
        
        receivedChunks.push(data);
        
        let receivedSize = 0;
        
        for (const chunk of receivedChunks) {
            receivedSize += chunk.byteLength;
        }
        
        progress.value =
            (receivedSize / receivedFileSize) * 100;
        
    }
    
});
    
    conn.on("close", () => {
        
        updateStatus("Disconnected");
        
        sendBtn.disabled = true;
        
    });
    
}

sendBtn.onclick = () => {
    
    if (!selectedFile) {
        alert("Choose a file first");
        return;
    }
    
    conn.send({
        type: "info",
        name: selectedFile.name,
        size: selectedFile.size
    });
    
    offset = 0;

updateStatus("Sending...");

sendNextChunk();
};

function sendNextChunk() {
    
    if (offset >= selectedFile.size) {
        
        conn.send({
            type: "done"
        });
        
        updateStatus("Transfer Complete");
        progress.value = 100;
        
        offset = 0;
        
        return;
    }
    
    const slice = selectedFile.slice(
        offset,
        offset + CHUNK_SIZE
    );
    
    fileReader = new FileReader();
    
    fileReader.onload = (e) => {
        
        conn.send(e.target.result);
        
        offset += CHUNK_SIZE;
        
        progress.value =
            (offset / selectedFile.size) * 100;
        
        sendNextChunk();
        
    };
    
    fileReader.readAsArrayBuffer(slice);
    
}
