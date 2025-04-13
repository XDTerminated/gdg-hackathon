const settings = {
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

const maxResultsSlider = document.getElementById("maxResults");
const searchDelaySlider = document.getElementById("searchDelay");
const cacheTimeSlider = document.getElementById("cacheTime");

const maxResultsValue = document.getElementById("maxResultsValue");
const searchDelayValue = document.getElementById("searchDelayValue");
const cacheTimeValue = document.getElementById("cacheTimeValue");

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

searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
        console.log("Popup: Sending search query to background:", query);
        linksList.innerHTML = '<p class="loading-message">Searching history with AI...</p>';

        chrome.runtime.sendMessage({ action: "searchHistory", query: query }, (response) => {
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
        });
    } else {
        linksList.innerHTML = '<p class="info-message">Enter a query to search your history.</p>';
    }
});

function showInitialState() {
    linksList.innerHTML = '<p class="info-message">Enter a query like "stackoverflow post about cors" to search.</p>';
}
showInitialState();

maxResultsSlider.addEventListener("input", (e) => {
    settings.maxResults = parseInt(e.target.value);
    maxResultsValue.textContent = settings.maxResults;
});

searchDelaySlider.addEventListener("input", (e) => {
    settings.searchDelay = parseInt(e.target.value);
    searchDelayValue.textContent = settings.searchDelay;
});

cacheTimeSlider.addEventListener("input", (e) => {
    settings.cacheTime = parseInt(e.target.value);
    cacheTimeValue.textContent = settings.cacheTime;
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
