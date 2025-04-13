// --- Constants ---
// IMPORTANT: Use your actual Gemini API Key. Consider securing this.
const GEMINI_API_KEY = "AIzaSyDG1EvYmYgTjtEnS1hhpTqNTSCHgzGdoBw"; // Use the key from the file
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
// Assuming 'terminxted-gdg' is the correct Hugging Face Space name
const FETCH_TEXT_API_URL = "https://terminxted-gdg.hf.space/fetch_text";
const FETCH_CONTENT_TIMEOUT_MS = 15000; // Timeout for fetching content from API (15 seconds)
const MAX_ITEMS_TO_FETCH_CONTENT = 50; // Limit how many pages we fetch content for
const MAX_HISTORY_RESULTS = 5000; // Max history items to request initially

// --- Helper Functions ---

/**
 * Calculates the start time based on the selected time range.
 * @param {string} timeRange - 'all_time', 'last_day', 'last_week', 'last_month'.
 * @returns {number} Start time in milliseconds since the epoch, or 0 for all_time.
 */
function getStartTime(timeRange) {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    switch (timeRange) {
        case "last_day":
            return now - oneDay;
        case "last_week":
            return now - 7 * oneDay;
        case "last_month":
            return now - 30 * oneDay; // Approximation
        case "all_time":
        default:
            if (!["all_time", "last_day", "last_week", "last_month"].includes(timeRange)) {
                console.warn(`Invalid timeRange "${timeRange}" received, defaulting to all_time.`);
            }
            return 0;
    }
}

/**
 * Fetches text content from a given URL using the FastAPI endpoint.
 * (Renamed from fetchDescription for clarity in this context, but using original code)
 * @param {string} url - The URL to fetch content from.
 * @returns {Promise<string|null>} The text content or null if fetching fails.
 */
async function fetchContentFromApi(url) {
    // Renamed for clarity, uses original logic
    // Basic check for valid URL format
    if (!url || (!url.startsWith("http:") && !url.startsWith("https:"))) {
        // console.log(`Skipping fetch for invalid or non-HTTP(S) URL: ${url}`); // Less verbose logging
        return null;
    }
    const apiUrl = `${FETCH_TEXT_API_URL}?url=${encodeURIComponent(url)}`;
    try {
        // console.log(`Attempting to fetch: ${apiUrl}`); // Log the exact URL if needed for debugging
        const response = await fetch(apiUrl, {
            method: "GET",
            signal: AbortSignal.timeout(FETCH_CONTENT_TIMEOUT_MS), // Add timeout
        });
        if (!response.ok) {
            // Log less verbosely for common errors like 404 or timeouts on the target site
            // console.warn(`Fetch API HTTP error for ${url}: Status ${response.status}`);
            return null; // Treat non-ok responses as fetch failure
        }
        const description = await response.text();
        // Check if the API returned its own error message or empty content
        if (!description || description.startsWith("Error fetching URL:")) {
            // console.warn(`API returned an error or no content for ${url}`);
            return null;
        }
        // Limit content length AFTER fetching
        return description.substring(0, 8000);
    } catch (error) {
        if (error.name === "TimeoutError") {
            console.warn(`Timeout fetching content for ${url}`);
        } else {
            // Log other network errors, but maybe less verbosely unless debugging
            // console.error(`Network/fetch error for ${url}:`, error.message);
        }
        return null; // Indicate failure
    }
}

/**
 * Calls the Gemini API to find the most relevant history item based on fetched content.
 * (Adapts the original callGemini function)
 * @param {string} userQuery - The user's natural language query.
 * @param {Array<object>} historyItemsWithContent - Array of { url, title, content } objects.
 * @returns {Promise<object|null>} The most relevant history item {url, title} or null.
 */
async function findRelevantHistoryWithGemini(userQuery, historyItemsWithContent) {
    const validItems = historyItemsWithContent.filter((item) => item.content);
    if (validItems.length === 0) {
        console.log("No history items with fetched content to send to Gemini.");
        return null;
    }

    // Construct the prompt for Gemini
    let promptText = `User Query: "${userQuery}"\n\n`;
    promptText += "Analyze the following browser history items (URL, Title, Content Snippet) and identify the single most relevant item that best answers or relates to the user query. Only return the URL of the most relevant item. If no item is sufficiently relevant, return 'NONE'.\n\n";

    validItems.forEach((item, index) => {
        promptText += `Item ${index + 1}:\n`;
        promptText += `URL: ${item.url}\n`;
        promptText += `Title: ${item.title}\n`;
        promptText += `Content Snippet: ${item.content.substring(0, 500)}...\n\n`; // Limit snippet in prompt
    });
    promptText += "Most relevant URL:";

    console.log(`Sending ${validItems.length} items to Gemini. Prompt length: ${promptText.length}`);

    const geminiRequest = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 256, // Generous buffer for a URL
        },
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        ],
    };

    try {
        // Using the fetch logic from the original callGemini
        const response = await fetch(GEMINI_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiRequest),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Gemini API error! status: ${response.status}, body: ${errorBody}`);
            throw new Error(`Gemini API request failed with status ${response.status}`);
        }

        const data = await response.json();
        // console.log("Gemini API Response:", JSON.stringify(data)); // Verbose logging

        // Using the parsing logic from the original callGemini, adapted slightly
        const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (resultText && resultText !== "NONE" && (resultText.startsWith("http:") || resultText.startsWith("https:"))) {
            const resultUrl = resultText;
            console.log("Gemini suggested URL:", resultUrl);
            const matchedItem = validItems.find((item) => item.url.toLowerCase() === resultUrl.toLowerCase());
            if (matchedItem) {
                return { url: matchedItem.url, title: matchedItem.title };
            } else {
                console.warn("Gemini returned a URL not found in the provided list:", resultUrl);
                return null;
            }
        } else if (resultText === "NONE") {
            console.log("Gemini indicated no relevant item found ('NONE').");
            return null;
        } else {
            console.warn("Gemini response format unexpected or empty:", resultText);
            return null;
        }
    } catch (error) {
        console.error("Error calling or processing Gemini API:", error);
        // Re-throw or handle as needed; here we let the caller handle it
        throw new Error(`Failed to communicate with Gemini API: ${error.message}`);
    }
}

// --- Event Listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background: Received message raw:", message);

    if (message && typeof message === "object" && message.action === "searchHistory") {
        console.log("Background: Processing searchHistory action", message);

        const query = message.query || "";
        let timeRange = message.timeRange || "all_time"; // Default timeRange
        // Ensure maxHistoryItems is a reasonable number, capping at our defined max
        const requestedMaxItems = parseInt(message.maxHistoryItems, 10) || MAX_HISTORY_RESULTS;
        const maxHistoryItems = Math.min(requestedMaxItems, MAX_HISTORY_RESULTS);

        if (!query) {
            console.error("Error: Empty query received.");
            sendResponse({ success: false, error: "Search query cannot be empty." });
            return false; // Synchronous response
        }

        // Validate timeRange before calling getStartTime
        if (!["all_time", "last_day", "last_week", "last_month"].includes(timeRange)) {
            console.warn(`Invalid timeRange "${timeRange}", defaulting to all_time.`);
            timeRange = "all_time";
        }
        console.log(`Searching history with query: "${query}", timeRange: ${timeRange}, maxItems: ${maxHistoryItems}`);

        const startTime = getStartTime(timeRange);

        // 1. Fetch History
        chrome.history.search(
            {
                text: "", // Fetch all history within the time range
                maxResults: maxHistoryItems,
                startTime: startTime,
            },
            async (historyItems) => {
                if (chrome.runtime.lastError) {
                    console.error("Error fetching history:", chrome.runtime.lastError);
                    sendResponse({ success: false, error: `Failed to fetch history: ${chrome.runtime.lastError.message}` });
                    return;
                }

                if (!historyItems || historyItems.length === 0) {
                    console.log("No history items found for the specified criteria.");
                    sendResponse({ success: true, results: [] });
                    return;
                }

                console.log(`Fetched ${historyItems.length} initial history items.`);
                const itemsToProcess = historyItems; // Using all fetched items for now

                // 2. Fetch Content (Limited Concurrency)
                console.log(`Starting content fetching for up to ${MAX_ITEMS_TO_FETCH_CONTENT} items...`);
                const historyItemsWithContent = [];
                const itemsToFetch = itemsToProcess.slice(0, MAX_ITEMS_TO_FETCH_CONTENT);
                let fetchedCount = 0;

                const promises = itemsToFetch.map((item) =>
                    fetchContentFromApi(item.url).then((content) => {
                        // Use the renamed fetch function
                        fetchedCount++;
                        // Log progress less aggressively
                        if (fetchedCount % 10 === 0 || fetchedCount === itemsToFetch.length) {
                            console.log(`Content fetch progress: ${fetchedCount}/${itemsToFetch.length}`);
                        }
                        return {
                            url: item.url,
                            title: item.title || "No Title",
                            content: content, // Will be null if fetch failed/skipped
                        };
                    })
                );

                const results = await Promise.allSettled(promises);
                results.forEach((result) => {
                    if (result.status === "fulfilled") {
                        historyItemsWithContent.push(result.value);
                    } // Silently ignore rejected fetch promises (errors logged in fetchContentFromApi)
                });

                const successfulFetches = historyItemsWithContent.filter((i) => i.content).length;
                console.log(`Finished fetching content. ${successfulFetches} items have content.`);

                // 3. Call Gemini API
                if (successfulFetches > 0) {
                    console.log("Asking Gemini to find the most relevant item...");
                    try {
                        const relevantItem = await findRelevantHistoryWithGemini(query, historyItemsWithContent);

                        if (relevantItem) {
                            console.log("Gemini found a relevant item:", relevantItem);
                            sendResponse({ success: true, results: [relevantItem] });
                        } else {
                            console.log("Gemini did not find a sufficiently relevant item or failed to parse response.");
                            sendResponse({ success: true, results: [] });
                        }
                    } catch (error) {
                        console.error("Error during Gemini processing:", error);
                        sendResponse({ success: false, error: `Failed to process with AI: ${error.message}` });
                    }
                } else {
                    console.log("No content successfully fetched, skipping Gemini call.");
                    sendResponse({ success: true, results: [] }); // No results as no content could be analyzed
                }
            }
        );

        return true; // Indicates asynchronous response
    } else if (message && typeof message === "object") {
        console.warn("Background: Received message with unknown action:", message.action);
        return false;
    } else {
        console.error("Background: Received invalid message format:", message);
        return false;
    }
});

// Remove the example history search block if it's still present
// chrome.history.search({ text: "", startTime: 0, maxResults: 10 }, ...); // DELETE THIS BLOCK

console.log("Background script loaded and listener attached.");
