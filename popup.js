/* global browser */

// --- STATE & CONFIG ---
const appContainer = document.getElementById("app-container");
let refreshInterval;
let isUserInteracting = false; // Flag to pause updates when user is using a slider
let interactionTimeout;
const REFRESH_RATE_MS = 1500; // How often to check for media updates
const INTERACTION_PAUSE_MS = 500; // How long to wait after slider use before resuming updates
let siteVolumes = new Map(); // Stores the "locked" volume for each hostname, synced from background

// --- CORE LOGIC ---

/**
 * Loads all volume settings from the persistent background script.
 */
async function syncVolumesFromBackground() {
    if (isUserInteracting) return; // Don't sync while user is sliding
    try {
        const volumesObject = await browser.runtime.sendMessage({ cmd: "getAllVolumes" });
        if (volumesObject) {
            siteVolumes = new Map(Object.entries(volumesObject));
        }
    } catch (e) {
        console.error("Could not sync volumes from background script:", e);
    }
}


/**
 * Main function to refresh the media list displayed in the popup.
 * This is the entry point for all UI updates.
 */
async function refreshMediaList() {
    if (isUserInteracting) {
        return;
    }

    try {
        // Sync volumes first to ensure we have the latest settings
        await syncVolumesFromBackground();

        const allTabs = await browser.tabs.query({ url: ["<all_urls>"], discarded: false });
        const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
        const activeTab = activeTabs[0];

        const mediaTabs = [];
        const promises = allTabs.map(async (tab) => {
            try {
                const mediaElements = await browser.tabs.sendMessage(tab.id, { cmd: "query" });
                if (mediaElements && mediaElements.length > 0) {
                    const hostname = new URL(tab.url).hostname;
                    // This logic remains useful to enforce the volume if the page somehow changed it.
                    if (siteVolumes.has(hostname)) {
                        const lockedVolume = siteVolumes.get(hostname);
                        mediaElements.forEach(media => {
                            if (media.volume !== lockedVolume) {
                                browser.tabs.sendMessage(tab.id, { cmd: "volume", id: media.id, volume: lockedVolume });
                            }
                        });
                    }
                    mediaTabs.push({ tab, mediaElements });
                }
            } catch (e) {
                // Silently ignore tabs that can't be accessed.
            }
        });
        
        await Promise.all(promises);

        const activeTabWithMedia = mediaTabs.find(mt => mt.tab.id === activeTab.id);

        let sites = new Map();
        if (activeTabWithMedia) {
            const hostname = new URL(activeTabWithMedia.tab.url).hostname;
            sites.set(hostname, [activeTabWithMedia]);
        } else {
            mediaTabs.forEach(({ tab, mediaElements }) => {
                const hostname = new URL(tab.url).hostname;
                if (!sites.has(hostname)) {
                    sites.set(hostname, []);
                }
                sites.get(hostname).push({ tab, mediaElements });
            });
        }

        updateUI(sites);

    } catch (error) {
        console.error("Error refreshing media list:", error);
        renderErrorState();
    }
}

/**
 * Intelligently updates the DOM to reflect the current state of media, grouped by site.
 * @param {Map<string, Array>} sites - A map where keys are hostnames and values are arrays of tab data.
 */
function updateUI(sites) {
    document.getElementById('initial-loader')?.remove();

    if (sites.size === 0) {
        appContainer.innerHTML = '';
        renderEmptyState();
        return;
    }

    const existingSiteHostnames = new Set([...appContainer.querySelectorAll('.site-section')].map(el => el.dataset.hostname));
    const currentSiteHostnames = new Set(sites.keys());

    for (const hostname of existingSiteHostnames) {
        if (!currentSiteHostnames.has(hostname)) {
            appContainer.querySelector(`[data-hostname='${hostname}']`)?.remove();
        }
    }

    for (const [hostname, tabs] of sites.entries()) {
        const existingSection = appContainer.querySelector(`[data-hostname='${hostname}']`);
        if (existingSection) {
            updateSiteSection(existingSection, hostname, tabs);
        } else {
            if (appContainer.querySelector('.empty-state')) {
                appContainer.innerHTML = '';
            }
            const newSection = createSiteSection(hostname, tabs);
            appContainer.appendChild(newSection);
        }
    }
}

// --- UI RENDERING ---

/** Renders the view shown when no media is detected. */
function renderEmptyState() {
    appContainer.innerHTML = `
        <div class="empty-state flex flex-col items-center justify-center text-center text-slate-400 p-8 h-48">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-4 text-slate-400"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            <h2 class="text-lg font-semibold">No Media Found</h2>
            <p class="text-sm">Start playing audio or video on any tab to see controls here.</p>
        </div>
    `;
}

/** Renders an error message if something goes wrong. */
function renderErrorState() {
     appContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center text-center text-red-500 p-8 h-48">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-4"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <h2 class="text-lg font-semibold">An Error Occurred</h2>
            <p class="text-sm">Could not fetch media information.</p>
        </div>
    `;
}

/**
 * Creates a container for a specific site, including its header and all its media-playing tabs.
 * @param {string} hostname - The hostname of the site.
 * @param {Array} tabs - The array of tab data for this site.
 * @returns {HTMLElement} The created site section element.
 */
function createSiteSection(hostname, tabs) {
    const section = document.createElement('div');
    section.className = 'site-section bg-slate-700 rounded-lg shadow-sm mb-3 overflow-hidden';
    section.dataset.hostname = hostname;

    const siteHeader = createSiteHeader(hostname, tabs);
    const tabContainer = document.createElement('div');
    tabContainer.className = 'tab-container';

    tabs.forEach(({ tab, mediaElements }) => {
        const tabSection = createTabSection(tab, mediaElements);
        tabContainer.appendChild(tabSection);
    });

    section.appendChild(siteHeader);
    section.appendChild(tabContainer);
    return section;
}

/**
 * Creates the header for a site section, now including a master volume control.
 * @param {string} hostname - The hostname of the site.
 * @param {Array} tabs - The array of tab data for this site.
 * @returns {HTMLElement} The created site header element.
 */
function createSiteHeader(hostname, tabs) {
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between p-2 border-b border-slate-600 bg-slate-800';

    const title = document.createElement('h3');
    title.className = 'text-sm font-bold text-slate-200';
    title.textContent = hostname;

    const volumeControl = document.createElement('div');
    volumeControl.className = 'flex items-center w-1/2 max-w-[140px]';
    
    // Use the synced volume, or fallback to the media's current volume or 100%
    const initialVolume = siteVolumes.get(hostname) ?? tabs[0]?.mediaElements[0]?.volume ?? 1;
    
    volumeControl.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="text-slate-400 mr-2"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        <input type="range" class="site-volume-slider w-full" min="0" max="100" value="${initialVolume * 100}">
    `;

    const volumeSlider = volumeControl.querySelector('.site-volume-slider');
    volumeSlider.addEventListener('mousedown', startInteraction);
    volumeSlider.addEventListener('touchstart', startInteraction);
    volumeSlider.addEventListener('input', () => {
        const newVolume = volumeSlider.value / 100;
        
        // Update local state for immediate UI feedback
        siteVolumes.set(hostname, newVolume);

        // **MODIFIED**: Send the new volume to the background script for persistence
        browser.runtime.sendMessage({ cmd: "setVolume", hostname, volume: newVolume });

        // Update all media on the page for this site
        tabs.forEach(({ tab, mediaElements }) => {
            mediaElements.forEach(media => {
                browser.tabs.sendMessage(tab.id, { cmd: "volume", id: media.id, volume: newVolume });
            });
        });
    });

    header.appendChild(title);
    header.appendChild(volumeControl);
    return header;
}


/**
 * Updates an existing site section with new tab data.
 * @param {HTMLElement} section - The site section element to update.
 * @param {string} hostname - The hostname of the site.
 * @param {Array} tabs - The updated array of tab data for this site.
 */
function updateSiteSection(section, hostname, tabs) {
    const newHeader = createSiteHeader(hostname, tabs);
    section.replaceChild(newHeader, section.querySelector('.flex'));

    const tabContainer = section.querySelector('.tab-container');
    const existingTabIds = new Set([...tabContainer.querySelectorAll('.tab-section')].map(el => el.dataset.tabId));
    const currentTabIds = new Set(tabs.map(t => String(t.tab.id)));

    for (const tabId of existingTabIds) {
        if (!currentTabIds.has(tabId)) {
            tabContainer.querySelector(`[data-tab-id='${tabId}']`)?.remove();
        }
    }

    tabs.forEach(({ tab, mediaElements }) => {
        const existingTabSection = tabContainer.querySelector(`[data-tab-id='${tab.id}']`);
        if (existingTabSection) {
            updateTabSection(existingTabSection, tab, mediaElements);
        } else {
            const newTabSection = createTabSection(tab, mediaElements);
            tabContainer.appendChild(newTabSection);
        }
    });
}


/**
 * Creates the main container for a single tab's media controls.
 * @param {Object} tab - The browser tab object.
 * @param {Array} mediaElements - Array of media info objects for the tab.
 * @returns {HTMLElement} The created tab section element.
 */
function createTabSection(tab, mediaElements) {
    const section = document.createElement("div");
    section.className = "tab-section border-t first:border-t-0 border-slate-600";
    section.dataset.tabId = tab.id;

    const header = createTabHeader(tab, mediaElements);
    const mediaContainer = document.createElement("div");
    mediaContainer.className = "media-container p-2 space-y-2";

    const sortedMedia = [...mediaElements].sort((a, b) => {
        if (a.playing !== b.playing) return a.playing ? -1 : 1;
        if (a.type !== b.type) return a.type === 'audio' ? -1 : 1;
        return 0;
    });

    sortedMedia.forEach((mediaInfo) => {
        const mediaElement = createMediaElement(tab, mediaInfo);
        mediaContainer.appendChild(mediaElement);
    });

    section.appendChild(header);
    section.appendChild(mediaContainer);
    return section;
}

/**
 * Updates an existing tab section with new data.
 * @param {HTMLElement} section - The tab section element to update.
 * @param {Object} tab - The updated browser tab object.
 * @param {Array} mediaElements - The updated array of media info objects.
 */
function updateTabSection(section, tab, mediaElements) {
    const newHeader = createTabHeader(tab, mediaElements);
    section.replaceChild(newHeader, section.querySelector('.tab-header'));
    
    const mediaContainer = section.querySelector('.media-container');
    mediaContainer.innerHTML = ''; 
    
    const sortedMedia = [...mediaElements].sort((a, b) => {
        if (a.playing !== b.playing) return a.playing ? -1 : 1;
        if (a.type !== b.type) return a.type === 'audio' ? -1 : 1;
        return 0;
    });

    sortedMedia.forEach((mediaInfo) => {
        const mediaElement = createMediaElement(tab, mediaInfo);
        mediaContainer.appendChild(mediaElement);
    });
}

/**
 * Creates the header for a tab section.
 * @returns {HTMLElement} The created header element.
 */
function createTabHeader(tab, mediaElements) {
    const header = document.createElement("div");
    const url = new URL(tab.url);
    const playingCount = mediaElements.filter(e => e.playing).length;
    const headerBg = playingCount > 0 ? 'bg-green-600' : 'bg-slate-600';

    header.className = `tab-header flex items-center p-2 ${headerBg} text-white cursor-pointer hover:bg-opacity-90 transition`;
    header.onclick = () => browser.tabs.update(tab.id, { active: true });

    header.innerHTML = `
        <img src="${tab.favIconUrl || ''}" class="w-5 h-5 mr-2 rounded-sm" alt="" onerror="this.style.display='none'">
        <div class="flex-grow min-w-0">
            <div class="font-bold text-sm truncate" title="${tab.title || url.hostname}">${tab.title || url.hostname}</div>
        </div>
        <div class="flex items-center space-x-1 flex-shrink-0">
            <button data-action="pause-all" title="Pause All" class="pause-all-btn p-1.5 rounded-full hover:bg-black/20 transition">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button data-action="mute-tab" title="${tab.mutedInfo.muted ? "Unmute Tab" : "Mute Tab"}" class="mute-tab-btn p-1.5 rounded-full hover:bg-black/20 transition">
                ${tab.mutedInfo.muted ? 
                    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>` :
                    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`
                }
            </button>
        </div>
    `;
    
    header.querySelector('[data-action="pause-all"]').addEventListener('click', e => {
        e.stopPropagation();
        browser.tabs.sendMessage(tab.id, { cmd: "pauseAll" });
    });
    header.querySelector('[data-action="mute-tab"]').addEventListener('click', e => {
        e.stopPropagation();
        browser.tabs.update(tab.id, { muted: !tab.mutedInfo.muted });
    });

    return header;
}

/**
 * Creates the UI for a single media element.
 * @returns {HTMLElement} The created media card element.
 */
function createMediaElement(tab, mediaInfo) {
    const card = document.createElement("div");
    card.className = `media-card p-2 rounded-md ${mediaInfo.playing ? 'bg-green-900/50' : 'bg-slate-600'}`;
    
    card.innerHTML = `
        <div class="flex items-center mb-2">
            <div class="media-type-icon text-2xl mr-3">${mediaInfo.type === 'audio' ? '🎵' : '📹'}</div>
            <div class="flex-grow min-w-0">
                <div class="media-status text-sm font-semibold ${mediaInfo.playing ? 'text-green-400' : 'text-slate-200'}">
                    ${mediaInfo.type.charAt(0).toUpperCase() + mediaInfo.type.slice(1)} ${mediaInfo.playing ? '(Playing)' : ''}
                </div>
                <div class="time-info text-xs text-slate-400">
                    <span class="current-time">${formatTime(mediaInfo.currentTime)}</span> / <span class="duration">${formatTime(mediaInfo.duration)}</span>
                </div>
            </div>
            <button data-action="focus" title="Scroll to media" class="focus-btn p-1.5 rounded-full hover:bg-slate-500 transition flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
        </div>
        
        <div class="time-slider-container mb-2">
            <input type="range" class="time-slider w-full" min="0" max="${mediaInfo.duration}" value="${mediaInfo.currentTime}" ${mediaInfo.duration === Infinity ? 'disabled' : ''}>
        </div>
        
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
                <button data-action="play-pause" title="${mediaInfo.playing ? 'Pause' : 'Play'}" class="play-pause-btn w-10 h-10 flex items-center justify-center rounded-full text-white font-bold ${mediaInfo.playing ? 'bg-orange-500 hover:bg-orange-600' : 'bg-green-500 hover:bg-green-600'} transition">
                    ${mediaInfo.playing ? 
                        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>` : 
                        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
                    }
                </button>
                <button data-action="mute" title="${mediaInfo.muted ? 'Unmute' : 'Mute'}" class="mute-btn p-2 rounded-full hover:bg-slate-500 transition">
                     ${mediaInfo.muted ? 
                        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>` : 
                        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`
                    }
                </button>
            </div>
        </div>
    `;

    const timeSlider = card.querySelector('.time-slider');
    timeSlider.addEventListener('mousedown', startInteraction);
    timeSlider.addEventListener('touchstart', startInteraction);
    timeSlider.addEventListener('input', () => {
        browser.tabs.sendMessage(tab.id, { cmd: "currentTime", id: mediaInfo.id, currentTime: parseFloat(timeSlider.value) });
        card.querySelector('.current-time').textContent = formatTime(timeSlider.value);
    });
    
    card.querySelector('[data-action="play-pause"]').addEventListener('click', () => {
        const cmd = mediaInfo.playing ? "pause" : "play";
        browser.tabs.sendMessage(tab.id, { cmd, ids: [mediaInfo.id] });
    });

    card.querySelector('[data-action="mute"]').addEventListener('click', () => {
        const cmd = mediaInfo.muted ? "unmute" : "mute";
        browser.tabs.sendMessage(tab.id, { cmd, ids: [mediaInfo.id] });
    });
    
    card.querySelector('[data-action="focus"]').addEventListener('click', async () => {
        await browser.tabs.update(tab.id, { active: true });
        await browser.windows.update(tab.windowId, { focused: true });
        await browser.tabs.sendMessage(tab.id, { cmd: "focus", id: mediaInfo.id });
    });

    return card;
}

// --- HELPERS & EVENT HANDLERS ---

function startInteraction() {
    isUserInteracting = true;
    clearTimeout(interactionTimeout);
}

function endInteraction() {
    clearTimeout(interactionTimeout);
    interactionTimeout = setTimeout(() => {
        isUserInteracting = false;
        refreshMediaList(); 
    }, INTERACTION_PAUSE_MS);
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity) return "Live";
    const totalSeconds = Math.floor(seconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function initialize() {
    refreshMediaList(); // Initial refresh
    refreshInterval = setInterval(refreshMediaList, REFRESH_RATE_MS);

    window.addEventListener('beforeunload', () => {
        clearInterval(refreshInterval);
        clearTimeout(interactionTimeout);
    });

    document.addEventListener('mouseup', () => {
        if (isUserInteracting) endInteraction();
    });
    document.addEventListener('touchend', () => {
        if (isUserInteracting) endInteraction();
    });
}

// --- START ---
initialize();
