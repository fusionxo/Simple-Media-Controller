/*global browser */

const mediaElements = new Map();

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
    console.debug("handleQuery - scanning for media");
    
    const playingElements = [];
    const visibleElements = [];
    const otherElements = [];
    
    const els = document.querySelectorAll("video,audio");
    let count = 1;
    
    for (const el of els) {
        mediaElements.set(count, el);
        
        if (
            el.readyState > 0 && 
            !isNaN(el.duration) &&
            el.duration > 0 // Ensure valid duration
        ) {
            // Apply Instagram filtering only for videos, not audio
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
                visible: isVisible || isAudio // Audio is considered "visible" for UI purposes
            };
            
            // Prioritize by playing status
            if (isPlaying) {
                playingElements.push(mediaInfo);
                console.debug(`Found playing ${mediaInfo.type}: ID ${count}`);
            } else if (isVisible || isAudio) {
                visibleElements.push(mediaInfo);
            } else {
                otherElements.push(mediaInfo);
            }
        }
        
        count++;
    }
    
    // Return prioritized media
    const result = [
        ...playingElements,
        ...visibleElements.slice(0, 3), // Allow more visible elements
        ...otherElements.slice(0, 1)
    ];
    
    console.debug(`Media scan complete: ${result.length} total (${playingElements.length} playing)`);
    return result;
}

// Rest of the functions remain the same
function handlePause(ids) {
    console.debug("handlePause", ids);
    for (const id of ids) {
        if (mediaElements.has(id)) {
            mediaElements.get(id).pause();
        }
    }
    return "play";
}

function handlePauseAll() {
    console.debug("handlePauseAll");
    for (const [, el] of mediaElements) {
        if (!el.paused) {
            el.pause();
        }
    }
    return "ok";
}

function handlePlay(ids) {
    console.debug("handlePlay", ids);
    for (const id of ids) {
        if (mediaElements.has(id)) {
            mediaElements.get(id).play();
        }
    }
    return "pause";
}

function handleMute(ids) {
    console.debug("handleMute", ids);
    for (const id of ids) {
        if (mediaElements.has(id)) {
            mediaElements.get(id).muted = true;
        }
    }
    return "unmute";
}

function handleUnMute(ids) {
    console.debug("handleUnMute", ids);
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
            console.error("Volume control error:", e);
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
            console.error("Current time control error:", e);
            return false;
        }
    }
    return false;
}

async function handleFocus(id) {
    console.debug("handleFocus", id);
    if (mediaElements.has(id)) {
        try {
            mediaElements.get(id).scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'center'
            });
            return true;
        } catch (e) {
            console.error("Focus error:", e);
            return false;
        }
    }
    return false;
}

browser.runtime.onMessage.addListener((request) => {
    console.debug("onMessage", JSON.stringify(request));
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
            console.error("unknown request", request);
            return Promise.resolve(false);
    }
});

console.debug("content.js loaded - media controller ready");

// Inject attach.js for unattached audio elements
setTimeout(() => {
    console.debug("injecting attach.js");
    var s = document.createElement("script");
    s.src = browser.runtime.getURL("attach.js");
    s.onload = () => s.remove();
    document.head.appendChild(s);
}, 2000);
