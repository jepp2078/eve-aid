# EVE: War for New Eden — table companion

A companion website for the physical board game *EVE: War for New Eden* (base game, 2–4 players). Every player uses their own phone; one laptop hosts the game on the local Wi-Fi. The app tracks ISK, VP, minerals, materials, action cubes, developments and upkeep, and does the combat maths: you roll the physical dice and tap in what you rolled. It also has a searchable rules reference. The board, the cards and the dice stay on the table. For less app, a [scorekeeper game](#scorekeeper-games) tracks only VP, systems, developments, turns, combat and upkeep.

## Host a game night

You need:

- a laptop with Node.js 24 or later;
- phones on the same Wi-Fi network as the laptop.

On the laptop:

```bash
npm install
npm run host
```

`npm run host` builds the site and starts the server. It prints the address to open on the phones, for example `http://192.168.1.20:5180`. Open that address on every phone, or scan the QR code on the laptop's lobby screen.

To use another port:

```bash
PORT=8080 npm run host
```

- **Saved games.** Games are saved in `.eve-data/` and survive a restart: stop the server, start it again, and the phones pick up where they left off. Each save is flushed to the disk, and the previous version stays next to it as `<CODE>.json.bak`, which the server loads if the main file was damaged (say, by a power cut). Set `EVE_DATA_DIR` to save them somewhere else.
- **Big screen.** For a shared view of the table, the log and the join QR code on the laptop or a TV, use "Open big-screen table" in the laptop's lobby, or open `<your-address>/#/table?big&code=<CODE>`, where `<your-address>` is the address the server printed (with its port). Without `&code=` it shows the game this browser last joined.
- **Phone screens.** Set each phone's auto-lock to a longer time for the evening. A plain `http://` page on the local network can't keep the screen awake. When a phone sleeps, the app reconnects and rejoins the game when it wakes.
- **Keep the host laptop awake.** The game lives on the laptop: if it sleeps, every phone loses the game until it wakes. Plug it in, keep the lid open, and set it not to sleep while plugged in (macOS: System Settings → Battery → Options → "Prevent automatic sleeping on power adapter when the display is off"; Windows: Settings → System → Power → "When plugged in, put my device to sleep after: Never"). On macOS you can also start the server with `caffeinate -i npm run host`, which keeps the Mac awake for as long as the server runs.

## Play

1. One player creates a game, picks a faction and chooses a full or a [scorekeeper](#scorekeeper-games) game. The lobby shows a join code and a QR code.
2. The others open the address, enter the code (or scan the QR code), type a name and pick a faction.
3. Sit in the clockwise order the lobby shows; anyone can swap two seats to match the real table. The player who created the game picks the first player and starts.
4. Each player does their setup on their own phone: the revealed home asteroid belt (not in a scorekeeper game) and four starting developments.
5. The game then has four tabs:
   - **Panel**: your faction. Resources, action cubes, the action buttons, developments, upkeep, and manual adjustments for missions, events and corrections. In a scorekeeper game it shows VP and systems in place of resources and cubes, and its buttons record VP, systems, research and cards (see [Scorekeeper games](#scorekeeper-games)).
   - **Table**: every player at a glance, whose turn it is, and the log.
   - **Combat**: always there; a badge marks it while a combat is running. Start a combat, set up the fleets, enter the dice you rolled, and read the results.
   - **Reference**: costs, rules, ships and developments, with search.

- **Undo.** After every change a bar offers Undo. The Table log can also undo the latest entry.
- **Stuck turn.** If the player whose turn it is has wandered off, anyone can use **Force next turn** on the Table tab. It is logged. A combat belongs to its turn: cancel it first (Combat → More → Cancel combat).
- **Rules.** The **?** buttons open the rules for what you are looking at, in a drawer.

### A phone died or someone left

The upkeep, the faction setup and every combat step wait for a particular player's phone, and **Force next turn** only skips a turn. When a phone is gone, move its seat to another device; the player's resources, developments and to-dos stay with the seat.

1. On a device that is not in the game, open the game's address. The host laptop works, unless its browser holds a seat itself: then open the address with `?as=spare` added (on the laptop with the default port: `http://localhost:5180/?as=spare`), which acts as a separate device.
2. Tap **Join with code** and enter the game's code.
3. Pick the faction whose phone is gone, tap **Take over …**, and confirm **Take over seat**.

That device now plays the seat. To hand it back (the phone is charged, or the player returns), do the same on the phone: it shows **Choose your seat**; pick the faction and take it over again. Takeovers are logged.

## Scorekeeper games

For a table that wants less app, a scorekeeper game leaves most of the record on the board. Players touch their phones when their VP, systems or cards change, to end their turn or pass, and once per upkeep.

- **Picking it.** The player who creates the game chooses **Scorekeeper** under **Game mode** (Full is the default). The mode is for the whole table and can't be changed once the game exists. The lobby and the big screen show a "Scorekeeper game" tag.
- **What the app tracks.**
  - VP, with the rules that change it on their own: Lobbyist, the Verge of Ascendancy, domination, combat VP, raids and VP cards such as Underdog.
  - How many systems each player controls, and who holds the central system (for domination and end-game ties).
  - Your private development area: research tokens, completing, using and tapping cards.
  - Whose turn it is, passing, the first player and the rounds. There are no actions or cubes in the app: play your action on the board, then tap **End turn**.
  - The combat calculator. Fleets aren't recorded, so you pick each side's ships from the faction's full list, up to the number of models in the box.
  - A walk-through of each upkeep: a checklist of the board steps, then the research you gained, the raids that succeeded at the table and, with Fleet Supremacy, whether you have a large ship.
- **What stays on the board.** ISK, minerals, planetary and moon materials, ships, structures, asteroid belts and action cubes. When a card or rule gives or costs ISK (Lobbyist, Civilian Resistance, Galactic Trust Fund, Dirty Politics and so on), the app puts a to-do on your checklist, for example "Lobbyist: take 2 ISK". Setup skips the home belt step and reminds you to reveal a belt at the table.
- **The end.** The final ranking goes by VP, then systems. Ship strength isn't known, so players still tied after that share the victory.

Reference → Victory → **Scorekeeper games** has the same summary in the app.

## Development

```bash
npm run dev        # dev server with the game API on http://localhost:5180 (also reachable from phones on the LAN)
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript, no emit
npm run build      # client into dist/, server into dist-server/
```

To hold several seats in one browser, add `?as=<name>` to the address, for example `http://localhost:5180/?as=a` and `http://localhost:5180/?as=b` in two tabs. Each name is a separate device with its own seat.

Project layout:

- `src/data/` — game data: factions, ships (from `ships.csv`), developments, costs, dice, reference text.
- `src/engine/` — the rules as pure functions: `apply(game, command)` returns the new state or a rule error.
- `src/sync/` — the store the UI talks to, the shared commit and undo logic, and the session kept on each device.
- `server/` — the laptop host: HTTP API, Server-Sent Events and JSON files, running the same engine.
- `worker/` — the cloud host ([Host it online](#host-it-online)): a Cloudflare Worker with one Durable Object per game.
- `src/ui/` — React screens and components.

### Card photos

The app can show a photo of each printed card next to its text. The photos are the publisher's art, so they are not in this repository. To use your own, put one `.webp` per card in `src/assets/cards/developments/<development id>.webp` and `src/assets/cards/ships/<ship id>.webp` (the ids are in `src/data/developments.json` and `src/data/ships.csv`). Cards without a file simply show no photo. The folder is gitignored.

## Troubleshooting

- **Phones can't open the address.** Guest and "isolated" Wi-Fi networks often block devices from reaching each other. Use a normal home network, or a phone hotspot that both the laptop and the phones join.
- **The laptop's firewall asks about incoming connections.** Allow them for Node, or the phones can't connect.
- **"Can't reach the host laptop".** The laptop is asleep or the server has stopped. Wake the laptop or start the server again; the phones reconnect on their own.

## Rule interpretations

Where the rulebook leaves room, the app makes a choice. Each one is listed in the app under Reference → Interpretations.

## Host it online

The same app also runs on Cloudflare's free Workers plan, so tables can play without a laptop host: anyone with the address creates a game, from any network. Each game lives in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) (named by its code, stored in that object's SQLite database), and phones follow it over a WebSocket that costs nothing while nobody moves.

You need a free Cloudflare account. Then:

```bash
npx wrangler login
npm run cloud:deploy
```

`cloud:deploy` builds the site for the cloud (`dist-cloud/`) and the Worker (`dist-worker/`) and publishes both. It prints the address, `https://eve-companion.<your-subdomain>.workers.dev`. To try it locally first, run `npm run cloud:dev` and open `http://localhost:8787`; local games are kept in `.wrangler/state/`.

- **HTTPS.** Phones can keep their screens awake (the Wake Lock API needs HTTPS), so the auto-lock advice above doesn't apply.
- **Old games.** A game nobody has touched for 30 days is deleted.
- **New games.** Each network address can open 10 games a minute.
- **Free plan limits.** 100,000 requests a day (each move and each reconnect is about one) and 5 GB of storage, far more than a few game nights need. Past a daily limit, requests fail until 00:00 UTC; nothing is billed. Details: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- **Deploying an update** disconnects every phone for a moment; they reconnect on their own.

The laptop host and the cloud share the engine and the rules for requests (`server/protocol.ts`); the cloud parts are in `worker/`, and `src/sync/hosting.ts` picks the wording ("the server" instead of "the host laptop").

## Contributing

Issues and pull requests are welcome. Run `npm test` and `npm run typecheck` before opening a pull request.

## License

The code is released under the [MIT License](LICENSE).

This is an unofficial fan project, not affiliated with or endorsed by CCP Games or the publishers of *EVE: War for New Eden*. EVE, EVE Online and all related names and marks are trademarks of CCP ehf. The game's rules, card names and card text belong to their respective owners and are included only so the companion can be used alongside a copy of the game you own.
