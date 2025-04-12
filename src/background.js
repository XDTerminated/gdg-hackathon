// IMPORTANT: Replace with your actual Gemini API Key.
// Storing API keys directly in code is insecure for published extensions.
// Consider using chrome.storage.sync or a backend server for better security.
const GEMINI_API_KEY = "AIzaSyDG1EvYmYgTjtEnS1hhpTqNTSCHgzGdoBw";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

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
    }
});

async function performHistorySearch(userQuery) {
    // 1. Fetch recent history
    const maxHistoryItemsToFetch = 200; // Limit how much history we process
    const oneWeekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;

    const historyItems = await chrome.history.search({
        text: "", // Get all history within the time frame
        startTime: oneWeekAgo,
        maxResults: maxHistoryItemsToFetch,
    });

    console.log(`Background: Fetched ${historyItems.length} history items.`);

    if (historyItems.length === 0) {
        return []; // No history found
    }

    // 2. Format history for Gemini
    const historyContext = historyItems.map((item) => `- Title: ${item.title || "No Title"}\n  URL: ${item.url}`).join("\n");

    // 3. Construct the prompt for Gemini
    const prompt = `
Context: Here is a list of recently visited web pages from the user's browser history:
--- History Start ---
${historyContext}
--- History End ---

User Query: "${userQuery}"

Task: Based ONLY on the provided browser history context and the user query, find the single most relevant URL that matches the user's query.
Respond with ONLY the URL itself (e.g., https://example.com/page).
If no relevant URL is found in the provided history context that directly answers the query, respond with the exact text "NOT_FOUND".
Do not add any explanation or introductory text.
    `;

    console.log("Background: Sending prompt to Gemini.");
    // console.log("Prompt:", prompt); // Uncomment for debugging the prompt

    // 4. Call Gemini API
    try {
        const response = await fetch(GEMINI_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                // Optional: Add safety settings if needed
                // safetySettings: [
                //   { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                //   // Add other categories as needed
                // ],
                generationConfig: {
                    // Optional: Configure generation parameters
                    // temperature: 0.7,
                    // maxOutputTokens: 100,
                },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Background: Gemini API Error Response:", errorBody);
            throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log("Background: Received response from Gemini:", data);

        // Extract the text content safely
        const geminiResult = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!geminiResult || geminiResult === "NOT_FOUND") {
            console.log("Background: Gemini did not find a relevant URL.");
            return []; // Not found or empty response
        }

        // Basic validation if it looks like a URL
        if (geminiResult.startsWith("http://") || geminiResult.startsWith("https://")) {
            // Find the original title from history (best effort)
            const foundHistoryItem = historyItems.find((item) => item.url === geminiResult);
            const title = foundHistoryItem?.title || "Title not found in recent history";
            console.log("Background: Gemini found URL:", geminiResult);
            return [{ title: title, url: geminiResult }]; // Return as an array matching showResults format
        } else {
            console.warn("Background: Gemini response doesn't look like a URL:", geminiResult);
            return []; // Response wasn't a URL
        }
    } catch (error) {
        console.error("Background: Error calling Gemini API:", error);
        throw error; // Re-throw the error to be caught by the caller
    }
}
