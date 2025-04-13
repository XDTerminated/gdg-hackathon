console.log("Content script loaded for:", window.location.href);

// Basic text extraction (can be improved)
// Avoid extracting from very large pages or specific non-content elements if needed
let pageContent = "";
if (document.body && document.body.innerText) {
    // Limit content length to avoid excessive storage/prompt size
    const MAX_CONTENT_LENGTH = 5000; // Adjust as needed
    pageContent = document.body.innerText.trim().substring(0, MAX_CONTENT_LENGTH);
}

if (pageContent) {
    console.log("Content script extracted content (first 100 chars):", pageContent.substring(0, 100));
    try {
        chrome.runtime.sendMessage({
            action: "storePageContent",
            url: window.location.href,
            content: pageContent,
        });
        console.log("Content script sent content to background for:", window.location.href);
    } catch (error) {
        // This might happen if the extension context is invalidated (e.g., during reload)
        console.warn("Content script failed to send message:", error.message);
    }
} else {
    console.log("Content script: No significant text content found or body not ready.");
}
