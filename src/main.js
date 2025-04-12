// Settings state
const settings = {
    maxResults: 50,
    searchDelay: 500,
    cacheTime: 60,
};

// DOM Elements
const settingsButton = document.getElementById("settingsButton");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const linksList = document.getElementById("linksList");

// Settings sliders
const maxResultsSlider = document.getElementById("maxResults");
const searchDelaySlider = document.getElementById("searchDelay");
const cacheTimeSlider = document.getElementById("cacheTime");

// Settings values display
const maxResultsValue = document.getElementById("maxResultsValue");
const searchDelayValue = document.getElementById("searchDelayValue");
const cacheTimeValue = document.getElementById("cacheTimeValue");

// Mock data generator (keep for fallback or initial state if desired)
const generateMockLinks = (count) => {
    return Array(count)
        .fill(null)
        .map((_, i) => ({
            title: `Example Link ${i + 1}`,
            url: `https://example.com/page-${i + 1}`,
        }));
};

// Event Listeners
settingsButton.addEventListener("click", () => {
    settingsModal.classList.remove("hidden");
    settingsModal.classList.add("animate-fadeIn");
});

closeSettings.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
    settingsModal.classList.remove("animate-fadeIn");
});

searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
        console.log("Popup: Sending search query to background:", query);
        // Display a loading state (optional)
        linksList.innerHTML = '<p class="loading-message">Searching history with AI...</p>';

        chrome.runtime.sendMessage({ action: "searchHistory", query: query }, (response) => {
            if (chrome.runtime.lastError) {
                // Handle errors like the background script not being ready
                console.error("Popup: Error sending message:", chrome.runtime.lastError.message);
                showResults([{ title: "Error communicating with background script", url: "#" }]);
                return;
            }

            console.log("Popup: Received response from background:", response);
            if (response && response.success) {
                if (response.results && response.results.length > 0) {
                    showResults(response.results);
                } else {
                    linksList.innerHTML = '<p class="no-results-message">No relevant history found for your query.</p>';
                }
            } else {
                console.error("Popup: Search failed:", response?.error || "Unknown error");
                linksList.innerHTML = `<p class="error-message">Error searching history: ${response?.error || "Unknown error"}</p>`;
            }
        });
    } else {
        // Optionally clear results or show initial state if query is empty
        linksList.innerHTML = '<p class="info-message">Enter a query to search your history.</p>';
        // showInitialState(); // Or call a function to show default view
    }
});

// Show initial state (optional)
function showInitialState() {
    linksList.innerHTML = '<p class="info-message">Enter a query like "stackoverflow post about cors" to search.</p>';
}
showInitialState(); // Call on load

// Settings sliders event listeners
maxResultsSlider.addEventListener("input", (e) => {
    settings.maxResults = parseInt(e.target.value);
    maxResultsValue.textContent = settings.maxResults;
    // Note: maxResults setting is currently used for mock data,
    // The background script uses its own limit for fetching history.
    // You might want to sync these or pass the setting to the background script.
});

searchDelaySlider.addEventListener("input", (e) => {
    settings.searchDelay = parseInt(e.target.value);
    searchDelayValue.textContent = settings.searchDelay;
    // Note: searchDelay is not currently used in the Gemini search flow.
});

cacheTimeSlider.addEventListener("input", (e) => {
    settings.cacheTime = parseInt(e.target.value);
    cacheTimeValue.textContent = settings.cacheTime;
    // Note: cacheTime is not currently used. Caching would need implementation.
});

// Show results function - updated to handle actual links and add hover previews
function showResults(links) {
    if (!links || links.length === 0) {
        linksList.innerHTML = '<p class="no-results-message">No results found.</p>';
        return;
    }

    linksList.innerHTML = links
        .map(
            (link, index) => `
    <a
      href="${link.url}"
      target="_blank"
      rel="noopener noreferrer"
      class="link-item animate-fadeIn"
      style="animation-delay: ${index * 50}ms"
      data-title="${link.title || "No Title"}" // Store title in data attribute
      data-url="${link.url}" // Store url in data attribute
    >
      <h3 class="link-title">${link.title || "No Title"}</h3>
      <p class="link-url">${link.url}</p>
    </a>
  `
        )
        .join("");

    // Add event listeners for hover previews after links are added
    addHoverPreviewListeners();
}

// Function to add hover listeners to link items
function addHoverPreviewListeners() {
    const linkItems = linksList.querySelectorAll(".link-item");
    let previewTooltip = null; // Variable to hold the tooltip element

    linkItems.forEach((item) => {
        item.addEventListener("mouseenter", (event) => {
            // Remove existing tooltip if any
            if (previewTooltip) {
                previewTooltip.remove();
            }

            const title = event.currentTarget.dataset.title;
            const url = event.currentTarget.dataset.url;

            // Create tooltip element
            previewTooltip = document.createElement("div");
            previewTooltip.className = "link-preview-tooltip";
            previewTooltip.innerHTML = `
                <strong class="tooltip-title">${title}</strong>
                <span class="tooltip-url">${url}</span>
            `;
            document.body.appendChild(previewTooltip); // Append to body to overlay everything

            // Position the tooltip
            const rect = event.currentTarget.getBoundingClientRect();
            const popupRect = document.body.getBoundingClientRect(); // Get popup bounds

            // Position below the link item, adjust if it goes off-screen
            let top = rect.bottom + 5;
            let left = rect.left;

            // Ensure tooltip stays within popup horizontally
            if (left + previewTooltip.offsetWidth > popupRect.right - 10) {
                // 10px buffer
                left = popupRect.right - previewTooltip.offsetWidth - 10;
            }
            if (left < popupRect.left + 10) {
                left = popupRect.left + 10;
            }

            // Basic check to flip above if not enough space below (might need refinement)
            if (top + previewTooltip.offsetHeight > popupRect.bottom - 10) {
                top = rect.top - previewTooltip.offsetHeight - 5;
            }

            previewTooltip.style.top = `${top}px`;
            previewTooltip.style.left = `${left}px`;
            previewTooltip.style.opacity = 1; // Fade in
        });

        item.addEventListener("mouseleave", () => {
            if (previewTooltip) {
                previewTooltip.remove();
                previewTooltip = null;
            }
        });
    });
}
