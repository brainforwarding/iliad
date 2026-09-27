# Release 0.5.0 — steps for the signing Mac

For the Claude on the signing Mac, the one with the Developer ID certificate
and the `iliad-notary` profile. Do only what is written here. The other Mac
takes care of the website and everything after the release. This file holds
no secrets. Never print, write down or commit a password, key or token.

## 1. Get the code

```sh
git checkout master && git pull
```

`master` must be clean and up to date with `origin` (the release script
checks this). `docs/release-notes/0.5.0.md` must exist.

## 2. Check the tools

Each of these must succeed:

```sh
security find-identity -v -p codesigning          # lists "Developer ID Application: ED4.ONE SpA (K542ZFQH6B)"
xcrun notarytool history --keychain-profile iliad-notary
gh auth status                                     # can push to brainforwarding/iliad and brainforwarding/homebrew-tap
```

If one fails, stop and tell the owner which one.

## 3. Deploy the AI proxy first (this blocks the release)

The 0.5.0 app sends prompt v2 on the free AI route. The Worker must serve v2
**before** the app ships. Otherwise free AI answers "update Iliad" for
everyone on 0.5.0.

- Ask the owner: "Is the AI proxy with v2 already deployed?" If yes, go on to
  step 4.
- If not, and `cd relay/ai-proxy && npx wrangler whoami` shows the account
  `28887344eeefadc54750f68e4efcd22a`, deploy from here with the owner's
  go-ahead:

  ```sh
  cd relay/ai-proxy
  grep SUPPORTED_PROMPT_VERSIONS wrangler.toml   # must be "1,2"
  npx wrangler deploy
  curl -s https://iliad-ai.quiet-bush-25b1.workers.dev/healthz   # {"ok":true}
  ```

  Then tell the owner to open Cloudflare → Workers & Pages → `iliad-ai` →
  Settings → Observability and check that logs are **off**, with no Logpush
  and no Tail Worker.
- If wrangler isn't logged in to that account, stop and tell the owner. The
  proxy must be deployed from the other Mac first.

## 4. Release

```sh
scripts/release-mac.sh --bump 0.5.0
```

This bumps the version, validates, builds, signs, notarizes, publishes the
GitHub release and updates the Homebrew cask. It takes a while, because
notarization waits on Apple. If a step fails, fix the cause and resume with
`scripts/release-mac.sh --from <step> 0.5.0`. The log is at
`release/release-0.5.0.log`. `docs/release.md` is the full reference.

The keychain may ask once to allow `codesign`. The owner clicks
"Always Allow".

## 5. Report back

Tell the owner:

- the release URL (`https://github.com/brainforwarding/iliad/releases/tag/v0.5.0`);
- whether `verify` and `homebrew` passed;
- anything that failed or was skipped.

Don't deploy the website. The other Mac does that after the release.
