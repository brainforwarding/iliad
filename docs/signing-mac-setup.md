# Moving release signing to another Mac

Iliad releases must be signed with the Developer ID certificate and notarized
(see `docs/release.md`). This page moves that ability from the Mac that has it
(the "signing Mac") to a new one. It contains no secrets and must never gain
any: no passwords, keys or `.p12` files in this repo, in chat, email or cloud
drives.

What a release needs on the new Mac:

| Need | How to check | Moves how |
| --- | --- | --- |
| Developer ID Application: ED4.ONE SpA (K542ZFQH6B), **with its private key** | `security find-identity -v -p codesigning` | Exported as a password-protected `.p12`, sent by AirDrop |
| Notary profile `iliad-notary` | `xcrun notarytool history --keychain-profile iliad-notary` | Recreated on the new Mac (secrets in a keychain profile can't be exported) |
| `gh` logged in, AWS profile `iliad-site`, `wrangler` logged in, `.env.local` | see `docs/release.md` | Already done on the new Mac (2026-09-27) |

## Part 1 — on the signing Mac (the Claude there guides the owner)

1. Confirm the identity exists **with its private key**:
   `security find-identity -v -p codesigning` must list
   `Developer ID Application: ED4.ONE SpA (K542ZFQH6B)`.
2. Export it (the owner does this in Keychain Access; Claude explains the
   clicks and never sees the password):
   - Keychain Access → login keychain → **My Certificates** → select
     "Developer ID Application: ED4.ONE SpA (K542ZFQH6B)" (expand it: the
     private key must be underneath).
   - File → Export Items… → format **Personal Information Exchange (.p12)** →
     save as `iliad-developer-id.p12` → set a strong one-time password.
3. Send `iliad-developer-id.p12` to the new Mac with **AirDrop** (it lands in
   `~/Downloads`). Don't use email, chat, iCloud Drive or git. The owner
   types the password on the new Mac later; it is never written down in a
   file or message.
4. For the notary profile, find out (without revealing any secret) which
   Apple ID it uses, so it can be recreated:
   `security find-generic-password -l iliad-notary 2>/dev/null` prints only
   the item's attributes (look for `acct`); **never** add `-w`, which prints
   the secret. If nothing is found, ask the owner which Apple ID signs Iliad.
   Team ID is `K542ZFQH6B`.
5. Report back to the owner, in plain words: the Apple ID (not secret), that
   the `.p12` was sent, and anything else release-related that exists only on
   this Mac (for example a Homebrew tap checkout, extra env vars, a release
   worktree). List them; don't copy secrets.
6. After the new Mac confirms the import worked, delete the exported file on
   this Mac (`iliad-developer-id.p12`), and empty the Trash.

## Part 2 — on the new Mac (Claude here does this with the owner)

1. Import the identity (the owner types the `.p12` password at the prompt):
   `security import ~/Downloads/iliad-developer-id.p12 -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign -T /usr/bin/productbuild`
2. If `security find-identity -v -p codesigning` shows the identity as not
   valid, install Apple's intermediate "Developer ID Certification Authority
   (G2)" from https://www.apple.com/certificateauthority/ and check again.
3. Recreate the notary profile. The owner creates a new app-specific password
   at https://account.apple.com (Sign-In and Security → App-Specific
   Passwords, name it "iliad-notary") and runs, in Terminal:
   `xcrun notarytool store-credentials iliad-notary --apple-id <apple id> --team-id K542ZFQH6B`
   (it asks for the password; nothing is echoed or saved in files).
   Revoking the old app-specific password afterwards is optional.
4. Verify: `security find-identity -v -p codesigning` lists the identity;
   `xcrun notarytool history --keychain-profile iliad-notary` answers;
   `scripts/release-mac.sh --dry-run <version>` passes its checks.
5. Delete `~/Downloads/iliad-developer-id.p12` and empty the Trash.
