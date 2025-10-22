# Flag Filter for X

This Chrome extension hides posts on X.com/Twitter from accounts whose display names include specific country flag emojis that you select.

## Features

- Choose one or more flag emojis to target using the popup UI.
- Optional handling mode toggle: hide posts (default) or attempt to block matching users (placeholder for future logic).
- Live filtering with MutationObserver ensures newly loaded tweets are checked automatically.
- Running tally in the popup shows how many posts have been hidden for each flag emoji.
- Includes a supplemental list of “meme flags” (Pride, Trans, Bisexual, Pan, Nonbinary, Asexual, Straight Ally, Swastika variants, Kekistan, Star of David, Star-and-Crescent, Cross, etc.) in addition to country flags.

## Getting Started

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this project folder.
4. Visit X.com — the extension will begin filtering once the page loads.

## Selecting Flags

1. Click the extension icon to open the popup.
2. Search or scroll to find flag emojis. Check each flag you want to filter.
3. Use the **Selected Flags** section to review your choices and remove any you no longer need.

The current version removes matching posts from the timeline. The “block” mode toggle is included for future development and currently behaves the same as hide.

The **Blocked Counts** section updates in real time whenever a tweet is removed, so you can see which flags triggered filters the most.

> **Note:** Meme flag entries use their commonly shared emoji or symbol strings. If you notice a community using a different variant, you can add it by editing `src/flags.js`.

## Development Notes

- The list of country flags is generated from ISO 3166-1 alpha-2 codes and converted to emojis at runtime.
- State is stored in `chrome.storage.sync`, so your selections sync across Chrome installations when signed in.
