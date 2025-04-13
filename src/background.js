const GEMINI_API_KEY = "AIzaSyDG1EvYmYgTjtEnS1hhpTqNTSCHgzGdoBw";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const CONTENT_FETCH_API_BASE = "https://hackez-gdg.hf.space/fetch_text";

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
        return true;
    }
});

async function performHistorySearch(userQuery) {
    const maxHistoryItemsToFetch = 1000;
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

    console.log(`Background: Fetching content for ${historyItems.length} items via external API...`);
    const fetchPromises = historyItems.map(async (item) => {
        if (!item.url || (!item.url.startsWith("http://") && !item.url.startsWith("https://"))) {
            return { url: item.url, content: "Skipped (invalid URL for fetch)." };
        }
        const encodedUrl = encodeURIComponent(item.url);
        const apiUrl = `${CONTENT_FETCH_API_BASE}?url=${encodedUrl}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(apiUrl, {
                method: "GET",
                headers: { accept: "text/plain" },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                console.warn(`Background: API fetch failed for ${item.url}. Status: ${response.status}`);
                return { url: item.url, content: `Content fetch failed (Status: ${response.status}).` };
            }
            const textContent = await response.text();
            const MAX_FETCHED_CONTENT_LENGTH = 100000;
            return { url: item.url, content: textContent.substring(0, MAX_FETCHED_CONTENT_LENGTH) };
        } catch (error) {
            if (error.name === "AbortError") {
                console.warn(`Background: API fetch timed out for ${item.url}`);
                return { url: item.url, content: "Content fetch timed out." };
            }
            console.error(`Background: Error fetching content via API for ${item.url}:`, error);
            return { url: item.url, content: "Content fetch error." };
        }
    });

    const fetchedContents = await Promise.all(fetchPromises);
    const contentMap = new Map(fetchedContents.map((fc) => [fc.url, fc.content]));
    console.log("Background: Finished fetching content via API.");

    let historyContext = "";
    let totalContentLength = 0;
    const MAX_CONTEXT_LENGTH = 15000;

    for (const item of historyItems) {
        const content = contentMap.get(item.url) || "Content not fetched.";
        const contentSnippet = content.substring(0, 250);
        const itemText = `- Title: ${item.title || "No Title"}\n  URL: ${item.url}\n  Content Snippet: ${contentSnippet}...\n\n`;

        if (totalContentLength + itemText.length <= MAX_CONTEXT_LENGTH) {
            historyContext += itemText;
            totalContentLength += itemText.length;
        } else {
            console.log("Background: Reached max context length, stopping history inclusion.");
            break;
        }
    }

    const prompt = `
User Query: "${userQuery}"

History Context (List of visited pages with Title, URL, and Content Snippet):
--- History Start ---
${historyContext}
--- History End ---

Task:
1. Analyze the User Query and the History Context.
2. Identify **exactly 3** URLs from the History Context that are the most likely inferred matches for the User Query. Relevance can be based on title, URL, snippet, or related concepts. Guessing is required.
3. Order the 3 URLs by confidence (most likely match first, least likely third).
4. Respond with **ONLY** these 3 URLs, each on a new line.

**CRITICAL:** Your entire response MUST be only the 3 URLs. Do NOT include *any* other text, introductions, explanations, apologies, formatting (like numbers or bullets), or sentences.

Example REQUIRED Output:
https://example.com/best-guess
https://another-example.com/second-guess
https://example.org/third-guess

Provide the 3 ordered URL guesses now.
    `;

    console.log("Background: Sending simplified/direct prompt for 3 ordered URLs.");

    try {
        const response = await fetch(GEMINI_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.8,
                    maxOutputTokens: 500,
                },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Background: Gemini API Error Response:", errorBody);

            try {
                const errorJson = JSON.parse(errorBody);
                console.error("Background: Gemini API Error Details:", errorJson);

                if (errorJson.candidates?.[0]?.finishReason === "SAFETY") {
                    console.warn("Background: Gemini response blocked due to safety settings.");

                    return [];
                }
            } catch (parseError) {
            }
            throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log("Background: Received response from Gemini:", data);

        if (!data.candidates || data.candidates.length === 0 || data.candidates[0].finishReason === "SAFETY") {
            console.warn("Background: Gemini response missing candidates or blocked by safety filter. Finish Reason:", data.candidates?.[0]?.finishReason);
            return [];
        }

        const geminiResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!geminiResponseText) {
            console.warn("Background: Gemini response text was empty after successful API call.");
            return [];
        }

        const potentialUrls = geminiResponseText
            .split("\n")
            .map((url) => url.trim())
            .filter((url) => url);
        const results = [];
        const maxResultsToReturn = 3;

        console.log("Background: Potential URLs from Gemini:", potentialUrls);

        for (const url of potentialUrls) {
            if (results.length >= maxResultsToReturn) {
                break;
            }

            if (url.startsWith("http://") || url.startsWith("https://")) {
                const foundHistoryItem = historyItems.find((item) => item.url === url);
                if (foundHistoryItem) {
                    const title = foundHistoryItem.title || "Title not found in recent history";

                    if (!results.some((r) => r.url === url)) {
                        results.push({ title: title, url: url });
                        console.log("Background: Added verified match:", url);
                    }
                } else {
                    console.warn("Background: Gemini returned a URL not present in the provided history context:", url);
                }
            } else {
                console.warn("Background: Gemini returned a non-URL string, ignoring:", url);
            }
        }

        const finalResults = results.slice(0, maxResultsToReturn);

        if (finalResults.length === 0) {
            console.warn("Background: No valid URLs found in Gemini response after verification.");
        } else if (finalResults.length < maxResultsToReturn) {
            console.warn(`Background: Found only ${finalResults.length} valid URLs, expected ${maxResultsToReturn}.`);
        } else {
            console.log(`Background: Returning ${finalResults.length} verified potential matches.`);
        }

        return finalResults;
    } catch (error) {
        console.error("Background: Error calling Gemini API:", error);

        return [];
    }
}
