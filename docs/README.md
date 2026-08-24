# HE Overlay

Analog key travel from a Wooting keyboard, live in OBS. Each key fills up as you
press it, so viewers see how far a key went down, not just that it was hit.

Nothing to install. Open the page, add your keys, and OBS shows them.

## What you need

- **Chrome or Edge**, on a desktop computer.
- **A Wooting keyboard.** Only Wooting is supported for now — other analog
  keyboards are planned.
- **OBS 30 or newer**, with its WebSocket server turned on.

## Open it

<https://he-overlay.wardensquad.fr>

That is the whole installation. Your keys, colours and profiles are saved in
your browser, on your machine.

## Setup

The page walks you through three steps.

### 1 · Connect your keyboard

Click **Allow keyboard** and pick your Wooting from the list Chrome shows.

If you later turn gamepad mode on in Wootility, Chrome sees a different device
and the page loses the keyboard. Chrome will not ask again on its own: click
**Allow keyboard** once more and pick the Wooting in the list it shows.

### 2 · Connect OBS

In OBS: **Tools → WebSocket Server Settings**. Tick *Enable WebSocket server*
and *Enable Authentication*, and keep the password it shows you.

Type the port and that password into the two fields, then click **Copy URL**.
In OBS, add a **Browser** source and paste it.

Two things to know here:

- The first time, **Chrome asks for permission to access your local network.**
  Say yes. If you refuse, the app looks exactly as if OBS were switched off —
  and Chrome does not ask twice. To undo a refusal, click the icon at the left
  of the address bar, open **Site settings**, set **Local network access** to
  **Allow**, then reload the page.
- **Keep that URL off stream.** Your OBS password is in it, and it is also
  visible in the browser source properties.

### 3 · Add your keys

Press a key and it appears on the overlay. Press the next one. You can move,
resize and recolour them afterwards.

Under **Keys at rest** you choose how much of the keyboard shows while your
hands are still: the whole thing, the outlines alone, or nothing at all until a
key goes down.

## Start it automatically

Optional. Put a shortcut in your Windows Startup folder — press `Win`+`R` and
type `shell:startup` to open it:

```
chrome.exe --app=https://he-overlay.wardensquad.fr/capture.html
```

`--app` opens it as a plain window, without tabs or an address bar.

## Does anything leave my machine?

**No.** Your keystrokes and your OBS password never reach us. The site sends you
a page and nothing else; everything after that happens between your browser and
your own OBS. Two people using the site at the same time cannot see each other's
keys.

The one thing worth repeating: your OBS password is saved in your browser and
appears in the OBS source properties, so don't show that URL on stream.

## If something goes wrong

**The overlay stays black in OBS.** Check the browser source URL is the one the
page gave you, password included. If it went black after an OBS update, see
[deploy.md](deploy.md) — there is a documented way around it.

**Travel stays at zero.** The keyboard is connected but sending nothing: unplug
it and plug it back in, then allow it again if Chrome asks.

**Nothing happens when you press a key in step 3.** The status bar at the top
says which of the three links is broken — keyboard, OBS, or overlay.

## Reporting a problem

Open the **Diagnostics** panel at the bottom of the page and click **Copy log**,
then paste that into your report. It carries everything needed to understand the
problem without asking you three more questions.

## Advanced

Running your own copy, offline use, hosting it yourself: see
[deploy.md](deploy.md) and the
[releases page](https://github.com/MaximeBier/he-overlay/releases).
