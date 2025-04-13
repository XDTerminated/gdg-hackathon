// IMPORTANT: Replace with your actual Gemini API Key.
// Storing API keys directly in code is insecure for published extensions.
// Consider using chrome.storage.sync or a backend server for better security.
const GEMINI_API_KEY = "AIzaSyDG1EvYmYgTjtEnS1hhpTqNTSCHgzGdoBw"; // Replace with your key
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// --- Storage Key Prefix ---
const CONTENT_STORAGE_PREFIX = "page_content_";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "searchHistory") {
        console.log("Background: Received search request:", request.query);
        performHistorySearch(request.query)
            .then((results) => {
                console.log("Background: Sending results:", results);
                sendResponse({ success: true, results });
            })
            .catch((error) => {
                console.error("Background: Error during search:", error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Indicates that the response is sent asynchronously
    } else if (request.action === "storePageContent") {
        // --- Handle message from content script ---
        if (request.url && request.content) {
            const storageKey = CONTENT_STORAGE_PREFIX + request.url;
            // Store content using URL as key. Overwrites previous content for the same URL.
            // Consider adding timestamps or more complex storage logic if needed.
            chrome.storage.local.set({ [storageKey]: request.content }, () => {
                if (chrome.runtime.lastError) {
                    console.error("Background: Error storing content for", request.url, chrome.runtime.lastError);
                } else {
                    console.log("Background: Stored content for:", request.url);
                    // Optional: Implement logic to prune old storage entries if needed
                }
            });
            // No need to sendResponse back to content script unless confirmation is required
        }
        return false; // No async response needed for this message
    }
});

async function performHistorySearch(userQuery) {
    // 1. Fetch recent history
    const maxHistoryItemsToFetch = 100; // Reduced limit to manage prompt size
    const oneWeekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;

    const historyItems = await chrome.history.search({
        text: "",
        startTime: oneWeekAgo,
        maxResults: maxHistoryItemsToFetch,
    });

    console.log(`Background: Fetched ${historyItems.length} history items.`);

    if (historyItems.length === 0) {
        return [];
    }

    // --- 2. Fetch stored content for history items ---
    const storageKeys = historyItems.map((item) => CONTENT_STORAGE_PREFIX + item.url);
    const storedContentData = await chrome.storage.local.get(storageKeys);

    // --- 3. Format history with content for Gemini ---
    let historyContext = "";
    let totalContentLength = 0;
    const MAX_CONTEXT_LENGTH = 15000; // Limit total context size for Gemini

    for (const item of historyItems) {
        const storageKey = CONTENT_STORAGE_PREFIX + item.url;
        const content = storedContentData[storageKey] || "No content captured."; // Get stored content or default text
        const itemText = `- Title: ${item.title || "No Title"}\n  URL: ${item.url}\n  Content Snippet: ${content.substring(0, 200)}...\n\n`; // Include a snippet

        if (totalContentLength + itemText.length <= MAX_CONTEXT_LENGTH) {
            historyContext += itemText;
            totalContentLength += itemText.length;
        } else {
            console.log("Background: Reached max context length, stopping history inclusion.");
            break; // Stop adding items if context gets too long
        }
    }

    // --- 4. Construct the prompt for Gemini (Updated) ---
    const prompt = `
Context: Here is a list of recently visited web pages from the user's browser history, including snippets of their text content:
--- History Start ---
${historyContext}
--- History End ---

User Query: "${userQuery}"

Task: Based ONLY on the provided browser history context (titles, URLs, and content snippets) and the user query, find the single most relevant URL that matches the user's query.
Prioritize matches within the page content if available.
Respond with ONLY the URL itself (e.g., https://example.com/page).
If no relevant URL is found in the provided history context that directly answers the query, respond with the exact text "NOT_FOUND".
Do not add any explanation or introductory text.
    `;

    console.log("Background: Sending prompt to Gemini.");
    // console.log("Prompt:", prompt); // Uncomment for debugging

    // --- 5. Call Gemini API (No changes needed here) ---
    try {
        const response = await fetch(GEMINI_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    // Optional: Configure generation parameters
                    // temperature: 0.7,
                    // maxOutputTokens: 100,
                },
                // Optional: Add safety settings if needed
                // safetySettings: [ ... ],
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Background: Gemini API Error Response:", errorBody);
            throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log("Background: Received response from Gemini:", data);

        const geminiResult = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!geminiResult || geminiResult === "NOT_FOUND") {
            console.log("Background: Gemini did not find a relevant URL.");
            return [];
        }

        if (geminiResult.startsWith("http://") || geminiResult.startsWith("https://")) {
            const foundHistoryItem = historyItems.find((item) => item.url === geminiResult);
            const title = foundHistoryItem?.title || "Title not found in recent history";
            console.log("Background: Gemini found URL:", geminiResult);
            return [{ title: title, url: geminiResult }];
        } else {
            console.warn("Background: Gemini response doesn't look like a URL:", geminiResult);
            return [];
        }
    } catch (error) {
        console.error("Background: Error calling Gemini API:", error);
        throw error;
    }
}

// Optional: Add logic to clean up old storage entries periodically
// chrome.alarms.create('cleanupStorage', { periodInMinutes: 1440 }); // Once a day
// chrome.alarms.onAlarm.addListener(alarm => {
//   if (alarm.name === 'cleanupStorage') {
//     // Implement cleanup logic here (e.g., remove entries older than X days)
//   }
// });
