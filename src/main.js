const settings = {
    maxHistoryItems: 1000, // Default value
    timeRange: "all_time", // Default value for time range
    maxResults: 50,
    searchDelay: 500,
    cacheTime: 60,
};

const settingsButton = document.getElementById("settingsButton");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const linksList = document.getElementById("linksList");

const maxHistoryItemsSlider = document.getElementById("maxHistoryItemsSlider");
const maxHistoryItemsValue = document.getElementById("maxHistoryItemsValue");

const maxResultsSlider = document.getElementById("maxResults");
const searchDelaySlider = document.getElementById("searchDelay");
const cacheTimeSlider = document.getElementById("cacheTime");

const maxResultsValue = document.getElementById("maxResultsValue");
const searchDelayValue = document.getElementById("searchDelayValue");
const cacheTimeValue = document.getElementById("cacheTimeValue");

const timeRangeSelect = document.getElementById("timeRangeSelect"); // Add reference for the dropdown

const generateMockLinks = (count) => {
    return Array(count)
        .fill(null)
        .map((_, i) => ({
            title: `Example Link ${i + 1}`,
            url: `https://example.com/page-${i + 1}`,
        }));
};

settingsButton.addEventListener("click", () => {
    settingsModal.classList.remove("hidden");
    settingsModal.classList.add("animate-fadeIn");
});

closeSettings.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
    settingsModal.classList.remove("animate-fadeIn");
});

// Initialize display values (consider loading from storage later)
maxHistoryItemsValue.textContent = settings.maxHistoryItems;
timeRangeSelect.value = settings.timeRange; // Set initial dropdown value
maxResultsValue.textContent = settings.maxResults;
searchDelayValue.textContent = settings.searchDelay;
cacheTimeValue.textContent = settings.cacheTime;

// Set initial slider/select positions
maxHistoryItemsSlider.value = settings.maxHistoryItems;
timeRangeSelect.value = settings.timeRange; // Ensure dropdown reflects settings
maxResultsSlider.value = settings.maxResults;
searchDelaySlider.value = settings.searchDelay;
cacheTimeSlider.value = settings.cacheTime;

searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
        console.log("Popup: Sending search query to background:", query, "Max History:", settings.maxHistoryItems, "Time Range:", settings.timeRange);
        linksList.innerHTML = '<p class="loading-message">Searching history with AI...</p>';

        // Send the current settings along with the query
        chrome.runtime.sendMessage(
            {
                action: "searchHistory",
                query: query,
                maxHistoryItems: settings.maxHistoryItems,
                timeRange: settings.timeRange, // Include the time range setting
            },
            (response) => {
                if (chrome.runtime.lastError) {
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
            }
        );
    } else {
        linksList.innerHTML = '<p class="info-message">Enter a query to search your history.</p>';
    }
});

function showInitialState() {
    linksList.innerHTML = '<p class="info-message">Enter a query like "stackoverflow post about cors" to search.</p>';
}
showInitialState();

maxHistoryItemsSlider.addEventListener("input", (e) => {
    settings.maxHistoryItems = parseInt(e.target.value);
    maxHistoryItemsValue.textContent = settings.maxHistoryItems;
    // Consider saving settings to chrome.storage here
});

maxResultsSlider.addEventListener("input", (e) => {
    settings.maxResults = parseInt(e.target.value);
    maxResultsValue.textContent = settings.maxResults;
    // Consider saving settings to chrome.storage here
});

searchDelaySlider.addEventListener("input", (e) => {
    settings.searchDelay = parseInt(e.target.value);
    searchDelayValue.textContent = settings.searchDelay;
});

cacheTimeSlider.addEventListener("input", (e) => {
    settings.cacheTime = parseInt(e.target.value);
    cacheTimeValue.textContent = settings.cacheTime;
});

timeRangeSelect.addEventListener("change", (e) => {
    settings.timeRange = e.target.value;
    console.log("Popup: Time range setting changed to:", settings.timeRange);
    // Consider saving settings to chrome.storage here
});

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
      data-title="${link.title || "No Title"}"
      data-url="${link.url}"
    >
      <h3 class="link-title">${link.title || "No Title"}</h3>
      <p class="link-url">${link.url}</p>
    </a>
  `
        )
        .join("");

    addHoverPreviewListeners();
}

function addHoverPreviewListeners() {
    const linkItems = linksList.querySelectorAll(".link-item");
    let previewTooltip = null;

    linkItems.forEach((item) => {
        item.addEventListener("mouseenter", (event) => {
            if (previewTooltip) {
                previewTooltip.remove();
            }

            const title = event.currentTarget.dataset.title;
            const url = event.currentTarget.dataset.url;

            previewTooltip = document.createElement("div");
            previewTooltip.className = "link-preview-tooltip";
            previewTooltip.innerHTML = `
                <strong class="tooltip-title">${title}</strong>
                <span class="tooltip-url">${url}</span>
            `;
            document.body.appendChild(previewTooltip);

            const rect = event.currentTarget.getBoundingClientRect();
            const popupRect = document.body.getBoundingClientRect();

            let top = rect.bottom + 5;
            let left = rect.left;

            if (left + previewTooltip.offsetWidth > popupRect.right - 10) {
                left = popupRect.right - previewTooltip.offsetWidth - 10;
            }
            if (left < popupRect.left + 10) {
                left = popupRect.left + 10;
            }

            if (top + previewTooltip.offsetHeight > popupRect.bottom - 10) {
                top = rect.top - previewTooltip.offsetHeight - 5;
            }

            previewTooltip.style.top = `${top}px`;
            previewTooltip.style.left = `${left}px`;
            previewTooltip.style.opacity = 1;
        });

        item.addEventListener("mouseleave", () => {
            if (previewTooltip) {
                previewTooltip.remove();
                previewTooltip = null;
            }
        });
    });
}
