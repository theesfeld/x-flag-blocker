# Flag Filter for X

This Chrome extension hides posts on X.com/Twitter from accounts whose display names include specific country flag emojis that you select.

## Features

- Choose one or more flag emojis to target using the popup UI.
- Optional handling mode toggle: hide posts (default) or attempt to block matching users (placeholder for future logic).
- Live filtering with MutationObserver ensures newly loaded tweets are checked automatically.
- Running tally in the popup shows how many posts have been hidden for each flag emoji.
- Includes a supplemental list of “meme flags” (Pride, Trans, Bisexual, Pan, Nonbinary, Asexual, Straight Ally, Swastika variants, Kekistan, Star of David, Star-and-Crescent, Cross, etc.) in addition to country flags.
- Blocked tweets stay in-place but dim: avatar is replaced with the blocked flag (overlaid with a 🚫), the display name becomes “Blocked By Flag Blocker”, and the tweet body collapses to a blank space so the like/retweet/etc. controls remain usable. Use the per-tweet “Show post” control if you need to temporarily reveal the original content.
- Each tweet receives a quick-access menu for scoring and manually blocking users. The menu shows their flag-match history and lets you add them to a persistent blocked-user list.
- Capture per-user notes and nicknames directly from the tweet dropdown. Nicknames appear inline next to the author across all of their posts.
- Popup UI now uses tabs: Overview (stats + handling mode), Flags (search and selection), and Users (blocked user list with scores and unblock controls).

## Getting Started

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this project folder.
4. Visit X.com — the extension will begin filtering once the page loads.

## Selecting Flags

1. Click the extension icon to open the popup.
2. Switch to the **Flags** tab.
3. Search or scroll to find flag emojis, then check each flag you want to filter.
4. Use the **Selected Flags** section to review your choices and remove any you no longer need.

When a match is found, the extension masks the tweet in place—switching the avatar/name as described above and blanking the tweet text with a single ASCII space while leaving the action bar intact. The “block” mode toggle is included for future development and currently behaves the same as hide.

The **Overview** tab shows the current handling mode plus the running tally of blocked flags. Use **Reset counts** to clear the tally.

### Blocking Users Directly

- Open the dropdown (>) that appears near the author name of any tweet to see that user’s score, flag history, and a block/unblock button.
- Add nicknames or notes in the same dropdown—saved nicknames render inline next to the author everywhere they appear.
- Blocked users are tracked in the **Users** tab of the popup. You can review their metrics, stored notes, or unblock them from there. (Unblocking stops future masking; refresh the X page to restore any tweets already masked.)

> **Note:** Meme flag entries use their commonly shared emoji or symbol strings. If you notice a community using a different variant, you can add it by editing `src/flags.js`.

## Development Notes

- The list of country flags is generated from ISO 3166-1 alpha-2 codes and converted to emojis at runtime.
- State is stored in `chrome.storage.sync`, so your selections sync across Chrome installations when signed in.
