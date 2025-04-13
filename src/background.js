// --- Constants ---
const GEMINI_API_KEY = "AIzaSyDG1EvYmYgTjtEnS1hhpTqNTSCHgzGdoBw"; // IMPORTANT: Consider securing this key
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
const CONTENT_FETCH_API_BASE = "https://hackez-gdg.hf.space/"; // API to fetch webpage text

// --- Default Settings ---
const DEFAULT_MAX_HISTORY_ITEMS = 1000;
const DEFAULT_TIME_RANGE = "all_time";
const MAX_FILTERED_LINKS = 75; // Target number of links after initial URL/Title filtering
const MAX_CONTENT_LENGTH_PER_URL = 2000; // Limit text length sent to Gemini per URL to manage prompt size

// --- Chrome Runtime Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "searchHistory") {
        // Use settings from the request, providing defaults if missing
        const maxHistoryItems = request.maxHistoryItems || DEFAULT_MAX_HISTORY_ITEMS;
        const timeRange = request.timeRange || DEFAULT_TIME_RANGE;
        const query = request.query;

        if (!query) {
            console.error("Background: Received search request without a query.");
            sendResponse({ success: false, error: "No search query provided." });
            return false; // No async response needed
        }

        console.log(`Background: Received search query: "${query}", Max History Items: ${maxHistoryItems}, Time Range: ${timeRange}`);

        searchHistoryAndProcess(query, maxHistoryItems, timeRange)
            .then((results) => {
                console.log("Background: Sending results to popup:", results);
                sendResponse({ success: true, results: results });
            })
            .catch((error) => {
                console.error("Background: Error processing search:", error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                sendResponse({ success: false, error: errorMessage || "Unknown error during search" });
            });

        return true; // Indicates that the response is sent asynchronously
    }
    // Handle other potential actions if needed
    return false; // No async response for other actions
});

// --- Helper Functions ---

/**
 * Calculates the start time in milliseconds since the epoch based on a time range string.
 * @param {string} timeRange - The time range identifier (e.g., "last_day", "last_week", "all_time").
 * @returns {number} The timestamp in milliseconds for the start of the search period.
 */
function calculateStartTime(timeRange) {
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
            return 0; // Search all history
    }
}

/**
 * Calls the Gemini API with the provided prompt text.
 * @param {string} promptText - The complete prompt to send to the Gemini API.
 * @returns {Promise<string|null>} The text content of the Gemini response, or null if no text is found.
 * @throws {Error} If the API call fails or returns an error status.
 */
async function callGemini(promptText) {
    console.log("Background: Calling Gemini API...");
    const geminiRequest = {
        contents: [{ parts: [{ text: promptText }] }],
        // Consider adding safetySettings and generationConfig if needed for finer control
        // safetySettings: [ ... ],
        // generationConfig: { temperature: 0.7, maxOutputTokens: 1024, ... }
    };

    try {
        const response = await fetch(GEMINI_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiRequest),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Gemini API error! status: ${response.status}, body: ${errorBody}`);
            // Provide a more specific error based on status if possible
            throw new Error(`Gemini API request failed with status ${response.status}`);
        }

        const data = await response.json();
        console.log("Background: Received response from Gemini.");

        // Safely access the response text using optional chaining
        const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!resultText) {
            console.warn("Background: Gemini response did not contain the expected text structure.");
            return null; // Indicate no valid text found
        }
        return resultText;
    } catch (error) {
        console.error("Background: Network or fetch error calling Gemini API:", error);
        throw new Error(`Failed to communicate with Gemini API: ${error.message}`); // Re-throw for upstream handling
    }
}

/**
 * Fetches text content for a given URL using the content fetch API.
 * @param {string} url - The URL to fetch content from.
 * @returns {Promise<{text: string|null, error: string|null}>} An object containing the fetched text or an error message.
 */
async function fetchContentForUrl(url) {
    try {
        const fetchUrl = `${CONTENT_FETCH_API_BASE}?url=${encodeURIComponent(url)}`;
        const response = await fetch(fetchUrl, {
            method: "POST", // Assuming POST is required by the API
            headers: { Accept: "application/json" }, // Assuming JSON response
            // Add a timeout? Consider signal: AbortSignal.timeout(10000) // 10 seconds
        });

        if (!response.ok) {
            // Log specific HTTP error status
            console.warn(`Background: Content fetch API returned status ${response.status} for ${url}`);
            throw new Error(`HTTP error ${response.status}`);
        }

        const data = await response.json(); // Assuming response is JSON: { "text": "..." }
        const text = data.text || ""; // Handle cases where 'text' property might be missing
        console.log(`Background: Fetched content for ${url} (Length: ${text.length})`);
        return { text: text.substring(0, MAX_CONTENT_LENGTH_PER_URL), error: null }; // Truncate content
    } catch (error) {
        console.error(`Background: Failed to fetch content for ${url}:`, error);
        return { text: null, error: error.message };
    }
}

// --- Main Search Logic ---

/**
 * Searches browser history, filters results using Gemini (URL/Title), fetches content for filtered items,
 * analyzes content with Gemini, and returns the final relevant history items.
 * @param {string} query - The user's search query.
 * @param {number} maxHistoryItems - The maximum number of history items to initially retrieve.
 * @param {string} timeRange - The time range identifier for the history search.
 * @returns {Promise<Array<{url: string, title: string}>>} A list of relevant history items.
 */
async function searchHistoryAndProcess(query, maxHistoryItems, timeRange) {
    // 1. Get History Items based on Time Range and Limit
    const startTime = calculateStartTime(timeRange);
    console.log(`Background: Searching history from timestamp ${startTime} with max results ${maxHistoryItems}.`);

    const allHistoryItems = await chrome.history.search({
        text: "", // Search all items within the time range
        maxResults: maxHistoryItems,
        startTime: startTime,
    });

    console.log(`Background: Fetched ${allHistoryItems.length} initial history items.`);
    if (!allHistoryItems || allHistoryItems.length === 0) {
        return []; // No history found for the period
    }

    // Filter out invalid/unusable URLs early
    const validHistoryItems = allHistoryItems.filter((item) => item.url && (item.url.startsWith("http:") || item.url.startsWith("https:")));
    if (validHistoryItems.length === 0) {
        console.log("Background: No valid http(s) URLs found in the fetched history.");
        return [];
    }
    console.log(`Background: Found ${validHistoryItems.length} valid history items.`);

    // 2. Initial Filtering via Gemini (URL/Title)
    console.log("Background: Starting initial URL/Title filtering with Gemini...");
    const filterPrompt = `Based on the user query "${query}", identify up to ${MAX_FILTERED_LINKS} potentially relevant URLs from the following list. Consider only the URL and the page Title. List *only* the relevant URLs, one per line, without any extra text or numbering. If none seem relevant, respond with "NONE".

User Query: ${query}

History Items (URL and Title only):
${validHistoryItems.map((item) => `URL: ${item.url}\nTitle: ${item.title || "No Title Available"}\n---`).join("\n\n")}`;

    const filteredUrlsText = await callGemini(filterPrompt);

    if (!filteredUrlsText || filteredUrlsText.trim().toUpperCase() === "NONE") {
        console.log("Background: Gemini filtering (URL/Title) found no potentially relevant URLs.");
        return [];
    }

    // Parse the list of URLs returned by Gemini
    const filteredUrls = filteredUrlsText
        .split("\n")
        .map((url) => url.trim())
        .filter((url) => url.startsWith("http")); // Ensure they are valid URLs

    if (filteredUrls.length === 0) {
        console.log("Background: No valid URLs extracted from Gemini's filtering response.");
        return [];
    }
    console.log(`Background: Gemini filtering identified ${filteredUrls.length} potential URLs.`);

    // Map filtered URLs back to the original history items to retain all info
    // Use a Set for efficient lookup of filtered URLs
    const filteredUrlSet = new Set(filteredUrls);
    const filteredHistoryItems = validHistoryItems.filter((item) => filteredUrlSet.has(item.url));

    if (filteredHistoryItems.length === 0) {
        console.log("Background: Could not map filtered URLs back to history items (this shouldn't normally happen).");
        return [];
    }
    console.log(`Background: Mapped ${filteredHistoryItems.length} items for content fetching.`);

    // 3. Fetch Content for Filtered Items
    console.log(`Background: Fetching content for ${filteredHistoryItems.length} filtered items...`);
    const contentFetchPromises = filteredHistoryItems.map(async (item) => {
        const contentResult = await fetchContentForUrl(item.url);
        return {
            url: item.url,
            title: item.title || "No Title Available",
            text: contentResult.text, // Will be null if fetch failed
            fetchError: contentResult.error,
        };
    });

    const fetchedContents = await Promise.all(contentFetchPromises);

    // Filter out items where fetching failed or resulted in no text
    const validContents = fetchedContents.filter((item) => item.text && item.text.trim().length > 0);

    if (validContents.length === 0) {
        console.log("Background: No valid content could be fetched from the filtered history items.");
        return []; // No content to analyze
    }
    console.log(`Background: Successfully fetched and validated content for ${validContents.length} items.`);

    // 4. Final Analysis via Gemini (Content)
    console.log("Background: Starting final content analysis with Gemini...");
    const analysisPrompt = `Analyze the following browser history items (pre-filtered for relevance) based on the user query: "${query}". Each item includes a URL, Title, and fetched text content. Identify the URLs that are most relevant *based specifically on the provided content*. List *only* the relevant URLs, one per line, without any extra text or numbering. If none are relevant based on the content, respond with "NONE".

User Query: ${query}

History Items with Content:
${validContents.map((item) => `URL: ${item.url}\nTitle: ${item.title}\nContent: ${item.text}\n---`).join("\n\n")}`;

    const finalUrlsText = await callGemini(analysisPrompt);

    if (!finalUrlsText || finalUrlsText.trim().toUpperCase() === "NONE") {
        console.log("Background: Gemini final analysis (content) found no relevant URLs.");
        return [];
    }

    // Parse the final list of URLs
    const finalRelevantUrls = finalUrlsText
        .split("\n")
        .map((url) => url.trim())
        .filter((url) => url.startsWith("http"));

    if (finalRelevantUrls.length === 0) {
        console.log("Background: No valid URLs extracted from Gemini's final analysis response.");
        return [];
    }
    console.log("Background: Final relevant URLs identified by Gemini:", finalRelevantUrls);

    // 5. Map Final URLs to History Items (for Title)
    // Use a Set for efficient lookup and preserve order from Gemini's response
    const finalUrlSet = new Set(finalRelevantUrls);
    const finalResults = [];
    // Iterate through the order Gemini provided
    for (const url of finalRelevantUrls) {
        // Find the original item (could be from allHistoryItems or validContents)
        const originalItem = allHistoryItems.find((item) => item.url === url);
        if (originalItem) {
            finalResults.push({
                url: originalItem.url,
                title: originalItem.title || "No Title Available",
            });
        } else {
            console.warn(`Background: Could not find original history item for final URL: ${url}`);
        }
    }

    // Optional: Limit results based on maxResults setting from popup if needed
    // const maxResultsSetting = request.maxResults || 50; // Get from original request if passed
    // finalResults = finalResults.slice(0, maxResultsSetting);

    console.log("Background: Final matched results:", finalResults);
    return finalResults;
}

// --- Initialization ---
console.log("Background script loaded and listener attached.");
