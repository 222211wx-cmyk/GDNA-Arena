# Clip playback physical-phone verification

No emulator or physical-device checks were run for this implementation. Type
checking and focused logic tests do not verify native media-session behavior.

On both a physical iPhone and Android phone using a native build:

- Open `HELX-123456` from the in-app code field, an HTTPS share link pasted into
  that field, and `gdna-arena-mobile://clip/HELX-123456`.
- Cold-launch from the custom-scheme link. Confirm Back opens the Clips code
  screen instead of closing or navigating to an unrelated screen.
- Play one audio clip and one video clip. Background the app and lock the phone;
  verify title, play/pause, seek, elapsed time, and resumed foreground playback.
- While a URL refresh is shown, seek and then pause. Confirm the refreshed source
  restores the new position and remains paused. Repeat without pausing and
  confirm playback resumes.
- Leave a clip open through URL expiry, or use a test URL with a short expiry.
  Confirm refresh preserves position and intent, bounded failures show Retry,
  and Retry can recover.
- Open clip A, then immediately open clip B while A is still loading. Confirm no
  frame, title, position, or playback from A is applied to B.
- Verify queued/processing clips poll, temporary 503 responses respect the
  server retry interval, invalid codes show an error, and browser builds state
  that background behavior depends on browser policies.