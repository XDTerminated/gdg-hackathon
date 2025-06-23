// Chat interface and history analysis

class SiteSleuth {
    constructor() {
        this.messageInput = document.getElementById("messageInput");
        this.chatMessages = document.getElementById("chatMessages");
        this.isProcessing = false;
        this.apiKey = null;

        this.init();
    }
    async init() {
        this.setupEventListeners();
        this.displayWelcomeMessage();

        // Initialize Gemini API key
        await this.initializeGemini();
    }
    async getGeminiApiKey() {
        // Try to get API key from Chrome storage first
        try {
            const result = await chrome.storage.sync.get(["geminiApiKey"]);
            if (result.geminiApiKey) {
                return result.geminiApiKey;
            }
        } catch (error) {
            console.log("Could not retrieve API key from storage:", error);
        }

        // Fallback: prompt user for API key
        const apiKey = prompt("Please enter your Gemini API key:\n\n" + "1. Go to https://makersuite.google.com/app/apikey\n" + "2. Create a new API key\n" + "3. Paste it below\n\n" + "This will be stored securely in your browser.");

        if (apiKey) {
            // Store the API key securely
            try {
                await chrome.storage.sync.set({ geminiApiKey: apiKey });
                return apiKey;
            } catch (error) {
                console.error("Could not store API key:", error);
                return apiKey; // Still return it for this session
            }
        }

        throw new Error("Gemini API key is required");
    }
    async initializeGemini() {
        try {
            this.apiKey = await this.getGeminiApiKey();
            return true;
        } catch (error) {
            console.error("Failed to initialize Gemini:", error);
            this.addMessage("Failed to initialize Gemini AI. Please check your API key.", "bot");
            return false;
        }
    }

    setupEventListeners() {
        // Handle Enter key for sending messages
        this.messageInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && !this.isProcessing) {
                this.handleUserMessage();
            }
        });
    }

    displayWelcomeMessage() {
        this.addMessage("Hello! I can help you find websites from your browsing history. Just describe what you're looking for and I'll analyze your recent visits to find the most relevant links.", "bot");
    }

    addMessage(text, type, links = null) {
        const messageDiv = document.createElement("div");
        messageDiv.className = `message ${type}`;

        if (type === "bot" && links && links.length > 0) {
            // Format bot message with links
            let linksHTML = '<div style="margin-top: 12px;">';
            links.forEach((link, index) => {
                linksHTML += `
                    <div style="margin-bottom: 8px; padding: 8px; background: rgba(181, 116, 147, 0.1); border-radius: 8px;">
                        <a href="${link.url}" target="_blank" style="color: #e8c2d4; text-decoration: none; font-weight: 500;">
                            ${link.title || "Untitled"}
                        </a>
                        <div style="font-size: 0.8rem; color: rgba(181, 116, 147, 0.8); margin-top: 4px;">
                            ${link.url}
                        </div>
                        ${link.reason ? `<div style="font-size: 0.85rem; color: rgba(181, 116, 147, 0.9); margin-top: 4px; font-style: italic;">${link.reason}</div>` : ""}
                    </div>
                `;
            });
            linksHTML += "</div>";
            messageDiv.innerHTML = `<p>${text}</p>${linksHTML}`;
        } else {
            messageDiv.innerHTML = `<p>${text}</p>`;
        }

        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    async handleUserMessage() {
        const query = this.messageInput.value.trim();
        if (!query) return;

        this.isProcessing = true;
        this.messageInput.disabled = true;

        // Add user message
        this.addMessage(query, "user");
        this.messageInput.value = "";

        // Add loading message
        const loadingMessage = this.addMessage("Analyzing your browsing history...", "bot");

        try {
            // Get browser history
            const historyData = await this.getBrowserHistory();

            if (historyData.length === 0) {
                this.removeLoadingMessage();
                this.addMessage("I couldn't find any browsing history from the last 30 days. Please make sure you have some browsing activity.", "bot");
                return;
            }

            // Update loading message
            this.updateLastMessage("Found " + historyData.length + " recent visits. Analyzing with Gemini...");

            // Analyze with Gemini
            const results = await this.analyzeWithGemini(query, historyData);

            // Remove loading message and show results
            this.removeLoadingMessage();

            if (results && results.length > 0) {
                this.addMessage(`Here are the most relevant websites from your browsing history for "${query}":`, "bot", results);
            } else {
                this.addMessage("I couldn't find any relevant websites in your browsing history for that query. Try rephrasing your request or check if you've visited related sites recently.", "bot");
            }
        } catch (error) {
            console.error("Error processing request:", error);
            this.removeLoadingMessage();
            this.addMessage("Sorry, there was an error processing your request. Please try again.", "bot");
        } finally {
            this.isProcessing = false;
            this.messageInput.disabled = false;
            this.messageInput.focus();
        }
    }

    updateLastMessage(text) {
        const messages = this.chatMessages.querySelectorAll(".message.bot");
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            lastMessage.innerHTML = `<p>${text}</p>`;
        }
    }

    removeLoadingMessage() {
        const messages = this.chatMessages.querySelectorAll(".message.bot");
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            const text = lastMessage.textContent;
            if (text.includes("Analyzing") || text.includes("Found")) {
                lastMessage.remove();
            }
        }
    }
    async getBrowserHistory() {
        return new Promise((resolve, reject) => {
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

            chrome.history.search(
                {
                    text: "",
                    startTime: thirtyDaysAgo,
                    maxResults: 1000, // Increased to get more comprehensive history
                },
                (historyItems) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                        return;
                    }

                    // Filter and clean the history data
                    const filteredHistory = historyItems
                        .filter((item) => item.url && item.title && !item.url.startsWith("chrome://") && !item.url.startsWith("chrome-extension://") && item.visitCount > 0)
                        .map((item) => ({
                            url: item.url,
                            title: item.title,
                            visitCount: item.visitCount,
                            lastVisitTime: item.lastVisitTime,
                        }))
                        .sort((a, b) => b.lastVisitTime - a.lastVisitTime); // Keep all results for AI filtering

                    resolve(filteredHistory);
                }
            );
        });
    }
    async analyzeWithGemini(query, historyData) {
        try {
            this.updateLastMessage("Step 1/2: AI filtering most relevant pages from your history...");

            // Step 1: AI pre-filtering to get most promising candidates
            const candidates = await this.aiFilterCandidates(query, historyData);            if (candidates.length === 0) {
                return this.fallbackAnalysis(query, historyData);
            }

            this.updateLastMessage(`Step 2/2: Using Google Search grounding to enhance analysis with real-time web content...`);

            // Step 2: Use Google Search grounding for enhanced, real-time analysis
            const finalResults = await this.groundedAnalysis(query, candidates);

            return finalResults;
        } catch (error) {
            console.error("Error in advanced analysis:", error);
            // Fallback to simple analysis
            return this.fallbackAnalysis(query, historyData);
        }
    }
    async aiFilterCandidates(query, historyData) {
        try {
            console.log(`Filtering ${historyData.length} history items for query: "${query}"`);

            // Step 1: Smart keyword-based pre-filtering
            const keywordFiltered = this.smartKeywordFilter(query, historyData);
            console.log(`Keyword filtering found ${keywordFiltered.length} potential matches`);

            if (keywordFiltered.length === 0) {
                console.log("No keyword matches, falling back to recent popular sites");
                return historyData.slice(0, 20); // Return most recent/popular as fallback
            }

            // Step 2: If we have some matches, use AI to refine them
            if (keywordFiltered.length <= 50) {
                // Small enough list - use AI to rank these
                return await this.aiRankCandidates(query, keywordFiltered);
            } else {
                // Too many matches - take top candidates by score
                return keywordFiltered.slice(0, 35);
            }
        } catch (error) {
            console.error("Error in AI filtering:", error);
            // Emergency fallback: smart keyword filter only
            return this.smartKeywordFilter(query, historyData).slice(0, 20);
        }
    }
    smartKeywordFilter(query, historyData) {
        const queryWords = query
            .toLowerCase()
            .split(/\s+/)
            .filter((word) => word.length > 2);
        console.log("Query words:", queryWords);

        // Extract key concepts from the query
        const concepts = this.extractConcepts(query);
        console.log("Extracted concepts:", concepts);

        const scored = historyData.map((item) => {
            let score = 0;
            const titleLower = item.title.toLowerCase();
            const urlLower = item.url.toLowerCase();
            const combined = `${titleLower} ${urlLower}`;

            // Check if item matches ALL key concepts (more strict)
            let conceptMatches = 0;
            concepts.forEach((concept) => {
                let conceptFound = false;
                concept.keywords.forEach((keyword) => {
                    if (titleLower.includes(keyword) || urlLower.includes(keyword)) {
                        conceptFound = true;
                        console.log(`Found concept "${concept.name}" via keyword "${keyword}" in "${item.title}"`);
                    }
                });
                if (conceptFound) {
                    conceptMatches++;
                    score += concept.weight;
                }
            });

            // Require multiple concepts to match for complex queries
            if (concepts.length > 1 && conceptMatches < 2) {
                score *= 0.1; // Heavy penalty if not matching multiple concepts
                console.log(`Penalty applied to "${item.title}" - only ${conceptMatches}/${concepts.length} concepts matched`);
            }

            // Additional scoring for exact word matches
            queryWords.forEach((word) => {
                if (titleLower.includes(word)) {
                    score += 5;
                }
                if (urlLower.includes(word)) {
                    score += 3;
                }
            });

            // Bonus for visit frequency (but cap it)
            score += Math.min(item.visitCount * 0.05, 2);

            // Recency bonus
            const daysSince = Math.floor((Date.now() - item.lastVisitTime) / (1000 * 60 * 60 * 24));
            if (daysSince < 7) score += 1;

            // Domain-specific scoring
            score += this.getDomainScore(item.url, concepts);

            return { ...item, score };
        });        // Filter and sort by score (STRICT FILTERING)
        const filtered = scored.filter((item) => {
            if (item.score <= 0) {
                console.log(`❌ EXCLUDED (score: ${item.score}): ${item.title} - ${item.url}`);
                return false;
            }
            console.log(`✅ INCLUDED (score: ${item.score}): ${item.title} - ${item.url}`);
            return true;
        }).sort((a, b) => b.score - a.score);

        console.log(
            "Top scored items:",
            filtered.slice(0, 10).map((item) => ({
                title: item.title,
                url: item.url,
                score: item.score.toFixed(2),
            }))
        );

        return filtered;
    }    extractConcepts(query) {
        const lowerQuery = query.toLowerCase();
        const concepts = [];        // Platform-specific concepts (very important)
        if (lowerQuery.match(/reddit|r\/|subreddit/)) {
            concepts.push({
                name: "reddit",
                keywords: ["reddit", "r/", "subreddit", "reddit.com"],
                weight: 25, // Very high weight for platform-specific requests
                isPlatform: true, // Mark as platform-specific
            });
        }

        if (lowerQuery.match(/youtube|yt|video/)) {
            concepts.push({
                name: "youtube",
                keywords: ["youtube", "youtu.be", "yt", "video", "watch"],
                weight: 22,
                isPlatform: true,
            });
        }

        if (lowerQuery.match(/twitter|x\.com|tweet/)) {
            concepts.push({
                name: "twitter",
                keywords: ["twitter", "x.com", "tweet", "t.co"],
                weight: 22,
                isPlatform: true,
            });
        }

        // Technology concepts
        if (lowerQuery.match(/chatbot|bot|ai|assistant|ask|question/)) {
            concepts.push({
                name: "chatbot",
                keywords: ["chatbot", "bot", "ai", "assistant", "chat", "ask", "question", "answers", "perplexity"],
                weight: 16,
            });
        }

        // Media/content concepts
        if (lowerQuery.match(/wallpaper|background|desktop|screen|image|picture|photo/)) {
            concepts.push({
                name: "wallpaper",
                keywords: ["wallpaper", "wallpapers", "background", "backgrounds", "desktop", "screen", "image", "images", "picture", "pictures", "photo", "photos"],
                weight: 15,
            });
        }

        // Franchise/character concepts
        if (lowerQuery.match(/arcane|jinx|vi|caitlyn|ekko|jayce|viktor|piltover|zaun/)) {
            concepts.push({
                name: "arcane",
                keywords: ["arcane", "jinx", "vi", "caitlyn", "ekko", "jayce", "viktor", "piltover", "zaun", "league", "legends"],
                weight: 15,
            });
        }

        // Technology concepts
        if (lowerQuery.match(/code|programming|javascript|python|react|node|github|tutorial/)) {
            concepts.push({
                name: "programming",
                keywords: ["code", "coding", "programming", "javascript", "python", "react", "node", "github", "tutorial", "developer", "dev"],
                weight: 12,
            });
        }

        // Art/design concepts
        if (lowerQuery.match(/art|design|artwork|fanart|drawing|illustration/)) {
            concepts.push({
                name: "art",
                keywords: ["art", "artwork", "fanart", "drawing", "illustration", "design", "artist", "deviantart", "artstation"],
                weight: 12,
            });
        }

        // Gaming concepts
        if (lowerQuery.match(/game|gaming|steam|epic|riot|league/)) {
            concepts.push({
                name: "gaming",
                keywords: ["game", "gaming", "steam", "epic", "riot", "league", "pc", "console"],
                weight: 10,
            });
        }

        // If no specific concepts found, create generic ones from keywords
        if (concepts.length === 0) {
            const words = lowerQuery.split(/\s+/).filter((word) => word.length > 3);
            words.forEach((word) => {
                concepts.push({
                    name: word,
                    keywords: [word],
                    weight: 8,
                });
            });
        }

        return concepts;
    }    getDomainScore(url, concepts) {
        try {
            const domain = new URL(url).hostname.toLowerCase();
            let score = 0;

            // Platform-specific scoring (EXTREMELY strict)
            const platformMap = {
                reddit: ["reddit.com"],
                youtube: ["youtube.com", "youtu.be"],
                twitter: ["twitter.com", "x.com", "t.co"],
                github: ["github.com"],
                stackoverflow: ["stackoverflow.com"],
            };

            // Check if user specifically requested a platform
            const requestedPlatforms = concepts.filter(c => platformMap[c.name]);
            
            if (requestedPlatforms.length > 0) {
                let platformMatch = false;
                requestedPlatforms.forEach(platform => {
                    if (platformMap[platform.name] && platformMap[platform.name].some(d => domain.includes(d))) {
                        score += 100; // MASSIVE bonus for correct platform
                        platformMatch = true;
                        console.log(`✅ Platform MATCH for ${domain} - user requested ${platform.name}`);
                    }
                });
                
                // COMPLETE EXCLUSION if wrong platform when platform was specified
                if (!platformMatch) {
                    score = -1000; // Exclude completely
                    console.log(`❌ Platform MISMATCH - EXCLUDING ${domain} (user wanted ${requestedPlatforms.map(p => p.name).join(', ')})`);
                    return score;
                }
            }

            // HEAVY penalties for wrong platforms when they appear
            const allPlatformDomains = Object.values(platformMap).flat();
            const isWrongPlatform = allPlatformDomains.some(platformDomain => domain.includes(platformDomain));
            
            if (isWrongPlatform && requestedPlatforms.length > 0) {
                // This is a platform domain but not the requested one
                const matchesRequested = requestedPlatforms.some(platform => 
                    platformMap[platform.name] && platformMap[platform.name].some(d => domain.includes(d))
                );
                if (!matchesRequested) {
                    score = -1000; // Complete exclusion
                    console.log(`❌ WRONG PLATFORM - EXCLUDING ${domain}`);
                    return score;
                }
            }

            // Penalty for social media/general sites unless they're specifically relevant
            const socialDomains = ["facebook.com", "instagram.com", "tiktok.com"];
            const generalDomains = ["gmail.com", "linkedin.com", "google.com"];

            if (socialDomains.some((social) => domain.includes(social))) {
                score -= 15; // Penalty for other social media
            }

            if (generalDomains.some((general) => domain.includes(general))) {
                score -= 25; // Heavy penalty for general sites
            }

            // Bonus for relevant domains based on concepts
            const relevantDomains = {
                wallpaper: ["wallpaper", "background", "desktop", "image", "photo", "pic"],
                art: ["deviantart", "artstation", "pixiv", "behance", "art"],
                gaming: ["steam", "epic", "riot", "gaming", "game"],
                tech: ["dev", "tech", "code"],
                chatbot: ["perplexity", "openai", "claude", "gemini", "bard"],
            };

            concepts.forEach((concept) => {
                if (relevantDomains[concept.name]) {
                    relevantDomains[concept.name].forEach((keyword) => {
                        if (domain.includes(keyword)) {
                            score += 12;
                            console.log(`Domain bonus for ${domain} matching concept ${concept.name}`);
                        }
                    });
                }
            });

            return score;
        } catch (error) {
            return 0;
        }
    }

    async aiRankCandidates(query, candidates) {
        try {
            // Prepare a concise list for AI ranking
            const candidatesText = candidates
                .slice(0, 30)
                .map((item, index) => {
                    const daysSince = Math.floor((Date.now() - item.lastVisitTime) / (1000 * 60 * 60 * 24));
                    return `${index + 1}. "${item.title}" - ${item.url} (${item.visitCount} visits, ${daysSince}d ago)`;
                })
                .join("\n");

            const rankingPrompt = `
Query: "${query}"

These websites were pre-filtered as potentially relevant. Rank them by relevance to the query.

${candidatesText}

Return ONLY a JSON array of the numbers (1-${Math.min(30, candidates.length)}) of the MOST relevant pages, ordered by relevance.
Example: [3, 1, 7, 12, 5]

Focus on pages where the TITLE or URL clearly relates to the query. Ignore generic sites like email, social media unless they specifically match.
Return 10-20 numbers max.
`;

            // Use simple API call without grounding for ranking
            const response = await this.callSimpleGeminiAPI(rankingPrompt);

            try {
                const rankings = JSON.parse(response);
                if (Array.isArray(rankings)) {
                    return rankings
                        .filter((num) => num >= 1 && num <= candidates.length)
                        .map((num) => candidates[num - 1])
                        .slice(0, 20);
                }
            } catch (parseError) {
                console.error("Error parsing AI ranking:", parseError);
            }

            // Fallback: return candidates as-is
            return candidates.slice(0, 20);
        } catch (error) {
            console.error("Error in AI ranking:", error);
            return candidates.slice(0, 20);
        }
    }

    async callSimpleGeminiAPI(prompt) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: prompt,
                            },
                        ],
                    },
                ],
            }),
        });

        if (!response.ok) {
            throw new Error(`API call failed: ${response.status}`);
        }

        const responseData = await response.json();
        return responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
    async groundedAnalysis(query, candidates) {
        try {
            // Prepare candidate pages for analysis
            const candidatesText = candidates
                .slice(0, 20) // Limit to top 20 candidates to avoid token limits
                .map((page, index) => {
                    const daysSince = Math.floor((Date.now() - page.lastVisitTime) / (1000 * 60 * 60 * 24));
                    return `${index + 1}. "${page.title}" - ${page.url} (visited ${page.visitCount} times, ${daysSince} days ago)`;
                })
                .join("\n");            const groundedPrompt = `
I need to find the most relevant websites from a user's browsing history for this EXACT query: "${query}"

Here are the PRE-FILTERED candidate pages from their browsing history:
${candidatesText}

CRITICAL: These candidates have already been filtered to match the user's query. Your job is to:
1. ONLY analyze and rank the pages from the candidate list above
2. Do NOT suggest any pages that aren't in the candidate list
3. Focus on which of these candidates best match the query intent
4. If the query mentions a specific platform (like "reddit post"), ONLY return results from that platform

Important considerations:
- The user's query is: "${query}"
- Look specifically for content that matches ALL aspects of this query
- Consider the user's engagement level (visit count and recency) as a secondary factor
- Prioritize pages that have actual relevant content over popular but unrelated pages

Return your response as a JSON array with this exact format:
[
    {
        "url": "exact_url_from_the_candidate_list_above",
        "title": "exact_title_from_the_candidate_list_above", 
        "reason": "detailed explanation based on current content analysis of why this page perfectly matches the query"
    }
]

Only return the JSON array, no additional text.
`;

            const response = await this.callGeminiAPIWithGrounding(groundedPrompt);

            try {
                let cleanedResponse = response.text.trim();
                if (cleanedResponse.startsWith("```json")) {
                    cleanedResponse = cleanedResponse.slice(7, -3);
                } else if (cleanedResponse.startsWith("```")) {
                    cleanedResponse = cleanedResponse.slice(3, -3);
                }

                const relevantLinks = JSON.parse(cleanedResponse);

                if (Array.isArray(relevantLinks)) {
                    // Add citation information if available
                    const linksWithCitations = relevantLinks.map((link) => ({
                        ...link,
                        reason: this.addCitations(link.reason, response.groundingMetadata),
                    }));

                    return linksWithCitations.slice(0, 5);
                } else {
                    throw new Error("Invalid response format");
                }
            } catch (parseError) {
                console.error("Error parsing grounded analysis response:", parseError);
                console.log("Raw response:", response.text);

                // Fallback to simple candidate analysis
                return this.candidateBasedFallback(query, candidates);
            }
        } catch (error) {
            console.error("Error in grounded analysis:", error);
            return this.candidateBasedFallback(query, candidates);
        }
    }

    async callGeminiAPIWithGrounding(prompt) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: prompt,
                            },
                        ],
                    },
                ],
                tools: [
                    {
                        google_search: {},
                    },
                ],
            }),
        });

        if (!response.ok) {
            throw new Error(`API call failed: ${response.status}`);
        }

        const responseData = await response.json();
        const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const groundingMetadata = responseData.candidates?.[0]?.groundingMetadata;

        return {
            text: text,
            groundingMetadata: groundingMetadata,
        };
    }

    addCitations(text, groundingMetadata) {
        if (!groundingMetadata || !groundingMetadata.groundingSupports || !groundingMetadata.groundingChunks) {
            return text;
        }

        const supports = groundingMetadata.groundingSupports;
        const chunks = groundingMetadata.groundingChunks;

        // Sort supports by end_index in descending order to avoid shifting issues when inserting
        const sortedSupports = [...supports].sort((a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0));

        let result = text;
        for (const support of sortedSupports) {
            const endIndex = support.segment?.endIndex;
            if (endIndex === undefined || !support.groundingChunkIndices?.length) {
                continue;
            }

            const citationLinks = support.groundingChunkIndices
                .map((i) => {
                    const uri = chunks[i]?.web?.uri;
                    const title = chunks[i]?.web?.title;
                    if (uri) {
                        return `[${title || "Source"}](${uri})`;
                    }
                    return null;
                })
                .filter(Boolean);

            if (citationLinks.length > 0) {
                const citationString = ` ${citationLinks.join(", ")}`;
                result = result.slice(0, endIndex) + citationString + result.slice(endIndex);
            }
        }

        return result;
    }

    candidateBasedFallback(query, candidates) {
        const queryWords = query.toLowerCase().split(/\s+/);

        const scored = candidates.map((page) => {
            let score = 0;
            const titleLower = page.title.toLowerCase();
            const urlLower = page.url.toLowerCase();

            queryWords.forEach((word) => {
                if (titleLower.includes(word)) score += 3;
                if (urlLower.includes(word)) score += 2;
            });

            // Bonus for visit frequency and recency
            score += Math.min(page.visitCount * 0.2, 3);
            const daysSince = Math.floor((Date.now() - page.lastVisitTime) / (1000 * 60 * 60 * 24));
            if (daysSince < 7) score += 2;
            else if (daysSince < 30) score += 1;

            return { ...page, score };
        });

        return scored
            .filter((page) => page.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((page) => ({
                url: page.url,
                title: page.title,
                reason: `Relevant match with score: ${page.score.toFixed(1)} (visited ${page.visitCount} times)`,
            }));
    }
    prepareHistoryForFiltering(historyItems) {
        // Prepare a more comprehensive list for AI filtering
        const historyLines = [];
        historyItems.forEach((item, index) => {
            const daysSince = Math.floor((Date.now() - item.lastVisitTime) / (1000 * 60 * 60 * 24));
            const visitInfo = `(${item.visitCount} visits, ${daysSince} days ago)`;
            historyLines.push(`${index + 1}. ${item.title} - ${item.url} ${visitInfo}`);
        });
        return historyLines.join("\n");
    }
    fallbackAnalysis(query, historyData) {
        const queryWords = query.toLowerCase().split(/\s+/);
        const scored = historyData.map((item) => {
            let score = 0;
            const titleLower = item.title.toLowerCase();
            const urlLower = item.url.toLowerCase();

            // Score based on keyword matches
            queryWords.forEach((word) => {
                if (titleLower.includes(word)) score += 3;
                if (urlLower.includes(word)) score += 2;
            });

            // Bonus for visit frequency
            score += Math.min(item.visitCount * 0.1, 2);

            return { ...item, score };
        });

        return scored
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((item) => ({
                url: item.url,
                title: item.title,
                reason: `Matched "${query}" with score: ${item.score.toFixed(1)}`,
            }));
    }
}

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    new SiteSleuth();
});
