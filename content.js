/*global browser */

const mediaElements = new Map();

/**
 * --- NEW ---
 * This function is called for new and existing media elements.
 * It asks the background script for a stored volume and applies it.
 * @param {HTMLMediaElement} element - The <video> or <audio> element.
 */
async function applyStoredVolume(element) {
    // Some sites create video elements before they are ready.
    // We'll wait for the 'loadedmetadata' event to ensure we can set the volume.
    if (element.readyState === 0) {
        element.addEventListener('loadedmetadata', () => applyStoredVolume(element), { once: true });
        return;
    }

    try {
        const hostname = window.location.hostname;
        // Ask the background script for the stored volume for this website.
        const storedVolume = await browser.runtime.sendMessage({ cmd: "getVolume", hostname: hostname });

        // If a volume is stored (is not null or undefined)
        if (storedVolume !== null && typeof storedVolume !== 'undefined') {
            // Check if the volume is already correct to avoid a flicker or unnecessary event firing.
            if (element.volume.toFixed(2) !== storedVolume.toFixed(2)) {
                console.log(`Media Controller: Applying stored volume ${storedVolume} to a media element for ${hostname}`);
                element.volume = storedVolume;
            }
        }
    } catch (e) {
        console.error("Media Controller: Could not apply stored volume.", e);
    }
}


function getThumbnail(video) {
    try {
        let canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 120;
        let ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, 200, 120);
        let bgcolor = ctx.getImageData(0, 0, 1, 1).data;
        let fgcolor = (0xffffff ^ ((1 << 24) | (bgcolor[0] << 16) | (bgcolor[1] << 8) | bgcolor[2])).toString(16).slice(1);
        return {thumbnail: canvas.toDataURL(), bgcolor: bgcolor, fgcolor: fgcolor};
    } catch (e) {
        return {thumbnail: "", bgcolor: [255, 255, 255], fgcolor: "000000"};
    }
}

// Check if element is visible in viewport
function isElementVisible(el) {
    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    
    return (
        rect.top < windowHeight + 100 &&
        rect.bottom > -100 &&
        rect.left < windowWidth + 100 &&
        rect.right > -100 &&
        el.offsetWidth > 0 &&
        el.offsetHeight > 0 &&
        window.getComputedStyle(el).visibility !== 'hidden' &&
        window.getComputedStyle(el).display !== 'none'
    );
}

// Instagram-specific filtering - only for non-playing video elements
function shouldIncludeInstagramMedia(el) {
    if (!window.location.hostname.includes('instagram.com')) {
        return true; // Not Instagram, include all
    }
    
    // ALWAYS include if it's playing - regardless of position/size
    if (!el.paused) {
        return true;
    }
    
    // For audio elements, always include
    if (el.tagName.toLowerCase() === 'audio') {
        return true;
    }
    
    // For paused videos, apply stricter filtering
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // Check if it's likely the main video (reasonable size and position)
    const isMainVideo = (
        rect.height > 200 && 
        rect.width > 200 &&
        rect.top > -50 && 
        rect.bottom < viewportHeight + 50
    );
    
    return isMainVideo;
}

function handleQuery() {
    const playingElements = [];
    const visibleElements = [];
    const otherElements = [];
    
    const els = document.querySelectorAll("video,audio");
    let count = 1;
    mediaElements.clear(); // Clear the map to only include current elements
    
    for (const el of els) {
        mediaElements.set(count, el);
        
        if (
            el.readyState > 0 && 
            !isNaN(el.duration) &&
            el.duration > 0 // Ensure valid duration
        ) {
            if (!shouldIncludeInstagramMedia(el)) {
                count++;
                continue;
            }
            
            const isVisible = isElementVisible(el);
            const isPlaying = !el.paused;
            const isAudio = el.tagName.toLowerCase() === 'audio';
            
            let thumbnailData = {thumbnail: "", bgcolor: [240, 240, 240], fgcolor: "333333"};
            if (!isAudio) {
                thumbnailData = getThumbnail(el);
            }
            
            const mediaInfo = {
                poster: thumbnailData.thumbnail,
                type: el.tagName.toLowerCase(),
                duration: el.duration,
                currentTime: el.currentTime,
                playing: isPlaying,
                volume: el.volume,
                muted: el.muted,
                id: count,
                bgcolor: thumbnailData.bgcolor,
                fgcolor: thumbnailData.fgcolor,
                visible: isVisible || isAudio
            };
            
            if (isPlaying) {
                playingElements.push(mediaInfo);
            } else if (isVisible || isAudio) {
                visibleElements.push(mediaInfo);
            } else {
                otherElements.push(mediaInfo);
            }
        }
        
        count++;
    }
    
    const result = [
        ...playingElements,
        ...visibleElements.slice(0, 3),
        ...otherElements.slice(0, 1)
    ];
    
    return result;
}

function handlePause(ids) {
    for (const id of ids) {
        if (mediaElements.has(id)) {
            mediaElements.get(id).pause();
        }
    }
    return "play";
}

function handlePauseAll() {
    for (const [, el] of mediaElements) {
        if (!el.paused) {
            el.pause();
        }
    }
    return "ok";
}

function handlePlay(ids) {
    for (const id of ids) {
        if (mediaElements.has(id)) {
            mediaElements.get(id).play();
        }
    }
    return "pause";
}

function handleMute(ids) {
    for (const id of ids) {
        if (mediaElements.has(id)) {
            mediaElements.get(id).muted = true;
        }
    }
    return "unmute";
}

function handleUnMute(ids) {
    for (const id of ids) {
        if (mediaElements.has(id)) {
            mediaElements.get(id).muted = false;
        }
    }
    return "mute";
}

async function handleVolume(id, volume) {
    if (mediaElements.has(id)) {
        try {
            mediaElements.get(id).volume = volume;
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

async function handleCurrentTime(id, currentTime) {
    if (mediaElements.has(id)) {
        try {
            mediaElements.get(id).currentTime = currentTime;
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

async function handleFocus(id) {
    if (mediaElements.has(id)) {
        try {
            mediaElements.get(id).scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'center'
            });
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

browser.runtime.onMessage.addListener((request) => {
    switch (request.cmd) {
        case "query":
            return Promise.resolve(handleQuery());
        case "play":
            return Promise.resolve(handlePlay(request.ids));
        case "pause":
            return Promise.resolve(handlePause(request.ids));
        case "pauseAll":
            return Promise.resolve(handlePauseAll());
        case "mute":
            return Promise.resolve(handleMute(request.ids));
        case "unmute":
            return Promise.resolve(handleUnMute(request.ids));
        case "volume":
            return Promise.resolve(handleVolume(request.id, request.volume));
        case "currentTime":
            return Promise.resolve(handleCurrentTime(request.id, request.currentTime));
        case "focus":
            return Promise.resolve(handleFocus(request.id));
        default:
            return Promise.resolve(false);
    }
});


/**
 * --- NEW ---
 * This MutationObserver watches the page for new videos or audio being added,
 * which is common on sites with infinite scrolling (like Instagram Reels or YouTube).
 * When a new element appears, it automatically applies the stored volume.
 */
const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Check if the added node is a media element itself
                if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                    applyStoredVolume(node);
                }
                // Also check if any media elements were added within this new node
                node.querySelectorAll('video, audio').forEach(applyStoredVolume);
            }
        }
    }
});

// Start observing the entire document body for changes.
observer.observe(document.body, { childList: true, subtree: true });

// --- NEW ---
// Apply stored volume to any media elements that are already on the page when it first loads.
document.querySelectorAll('video, audio').forEach(applyStoredVolume);


console.debug("content.js loaded - media controller ready");

// Inject attach.js for unattached audio elements
setTimeout(() => {
    var s = document.createElement("script");
    s.src = browser.runtime.getURL("attach.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
}, 2000);
