// Background service worker for Site Sleuth extension

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
    console.log("Site Sleuth extension installed");
});

// Handle any background tasks if needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "getHistory") {
        // Handle history requests if needed from content scripts
        getHistoryData(message.days || 30).then(sendResponse);
        return true; // Will respond asynchronously
    }
});

async function getHistoryData(days = 30) {
    return new Promise((resolve) => {
        const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

        chrome.history.search(
            {
                text: "",
                startTime: startTime,
                maxResults: 500,
            },
            (historyItems) => {
                const filteredHistory = historyItems
                    .filter((item) => item.url && item.title && !item.url.startsWith("chrome://") && !item.url.startsWith("chrome-extension://") && item.visitCount > 0)
                    .map((item) => ({
                        url: item.url,
                        title: item.title,
                        visitCount: item.visitCount,
                        lastVisitTime: item.lastVisitTime,
                    }))
                    .sort((a, b) => b.lastVisitTime - a.lastVisitTime);

                resolve(filteredHistory);
            }
        );
    });
}
