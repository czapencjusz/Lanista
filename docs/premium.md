# Selling Premium

Lanista has two tiers (see `src/shared/tier.js`):

* **Free:** every feature, for `FREE_MINUTES_PER_DAY` minutes (2 hours) of bot time a day.
* **Premium:** no time limit, unlocked with a Premium key.

A Premium key is a short text signed with your private key. The extension checks the signature
with the matching public key, which is built into it. Nobody can make a working key without your
private key, and the check works offline: there is no server to run.

## Once: make your key pair

You need [Node.js](https://nodejs.org) 20 or newer and a copy of this repository.

```sh
npm run license -- init
```

This makes:

* **the private key**, in `~/.lanista/private-key.json` (set `LANISTA_PRIVATE_KEY` to keep it
  elsewhere). It never goes into the repository. **Back it up.** If you lose it you can't make new
  keys for this build. If someone else gets it, they can make keys too.
* **the public key**, written into `PUBLIC_KEY` in `src/shared/tier.js`. Commit it, then build and
  publish the extension (`npm run site`). Until then, the published version accepts no key.

Running `init` again would make a new pair and every key sold so far would stop working, so it
refuses unless you add `--force`.

Also set `PREMIUM_URL` in `src/shared/tier.js` to where people buy Premium: a shop page, a
Ko-fi or Patreon page, a Discord invite. The extension's Premium tab and the download page then
show a **Get Premium** button. While it is empty, the page says Premium is coming soon.

## For each buyer: issue a key

```sh
npm run license -- issue "Buyer's name or e-mail"          # never expires
npm run license -- issue "Buyer's name or e-mail" 30       # valid for 30 days
```

It prints the key (one line starting with `LANISTA-`); send it to the buyer. The name is shown
in the buyer's Premium tab ("Licensed to ..."), which discourages sharing the key. Every key issued
is listed in `~/.lanista/issued-keys.csv` (date, id, name, expiry).

For a monthly subscription, issue a 31-day key each month; when it expires, the buyer is back on the
free tier and the Premium tab says so.

To see what a key contains, for example when someone asks for help:

```sh
npm run license -- check "LANISTA-..."
```

## Limits of this approach

* A key can't be revoked, and nothing stops one key being used in several browsers. Short-lived
  keys (monthly) limit the damage, and the name inside the key makes sharing it personal.
* The extension is plain JavaScript and licensed under the GPL-3.0: anyone can read it, and
  someone determined can remove the time limit from their copy. The limit keeps honest people
  honest; it is not copy protection.
* Bot time is counted in the browser's extension storage. Removing the extension resets it.

Stronger control (revoking keys, one browser per key) needs a server that checks keys online, and
a change of licence if you don't want people to be able to share modified copies.
