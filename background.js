/* global browser */

// This is the background script. It runs persistently and holds the extension's state.

let siteVolumes = new Map();

/**
 * Loads the saved volume settings from browser storage into memory.
 */
async function loadVolumesFromStorage() {
  try {
    const data = await browser.storage.local.get('siteVolumes');
    if (data.siteVolumes) {
      // Convert the stored plain object back into a Map
      siteVolumes = new Map(Object.entries(data.siteVolumes));
      console.log('Media Controller: Volumes loaded from storage.', siteVolumes);
    }
  } catch (e) {
    console.error('Media Controller: Error loading volumes from storage.', e);
  }
}

/**
 * Saves the current volume settings from memory to browser storage.
 */
async function saveVolumesToStorage() {
  try {
    // Convert the Map to a plain object for JSON serialization
    await browser.storage.local.set({ siteVolumes: Object.fromEntries(siteVolumes) });
  } catch (e) {
    console.error('Media Controller: Error saving volumes to storage.', e);
  }
}

// Load volumes when the background script starts up.
loadVolumesFromStorage();


// Listen for messages from other parts of the extension (popup and content scripts).
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background script received message:', request);
  switch (request.cmd) {
    // Called by content script to get the volume for its specific site
    case 'getVolume':
      sendResponse(siteVolumes.get(request.hostname));
      break;

    // Called by the popup to get all stored volumes to display in the UI
    case 'getAllVolumes':
      // Convert Map to a plain object to send it over the message bridge
      sendResponse(Object.fromEntries(siteVolumes));
      break;
    
    // Called by the popup when a user changes a volume slider
    case 'setVolume':
      siteVolumes.set(request.hostname, request.volume);
      // Persist the change immediately.
      saveVolumesToStorage();
      // No response needed, this is a one-way command.
      break;
  }
  
  // Return true to indicate that we will respond asynchronously (for getVolume/getAllVolumes).
  return true;
});
