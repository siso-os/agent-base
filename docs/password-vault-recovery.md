# Password vault setup and recovery — t-0318

The selected vault is **KeePassXC, KDBX4, Argon2id**, with a master passphrase held by Shaan. Apple Passwords was a stale reconciliation stopgap, not an approved replacement. The authoritative decision is Agent Zero’s `siso-firstmate/.agents/a0/specs/a0-011.md`, including its two review amendments: export once per Google account plus Apple, and prove restoration under a separate throwaway macOS user.

## Prepared on 6 October 2026

KeePassXC 2.7.12 ARM64 is installed at `/Applications/KeePassXC.app`. Its existing cached DMG matched SHA256 `65f4f63607180c0a15794b4a4068f85e99ed5391c87c1fb9312648f1b36fed40`; macOS verified Developer ID `Janek Bevendorff (G2S7P7J672)` and accepted its notarization. The app was copied from a read-only DMG and that mount was detached. The GUI, browser integration, Keychain, Touch ID, default password manager and personal data were not changed.

The local synthetic drill creates three invented entries, backs up encrypted KDBX bytes, restores them, and compares the entry count and a protected value in memory. It rejects a wrong vault passphrase, modified ciphertext and truncation. An additional age layer exercises a ciphertext-only archive with fresh synthetic age identities. This is a local recovery proof, not a production backup, remote delivery or fresh-user acceptance.

**Creation trap:** this installed CLI’s `db-create` produced KDBX3/AES-KDF. Do not use that command as proof of the required format. The automated drill instead starts from the hash-pinned public blank Argon2id fixture, replaces its public test passphrase, and verifies both the KDBX4 binary header and the CLI’s `KDF: Argon2id` result. Its one-round/64 MiB fixture parameters are test settings, not production tuning. The real vault must be created and checked by the human in KeePassXC’s database settings.

## Human setup: one private sitting

1. **Choose and retain the recovery secret.** Shaan chooses a fresh Diceware passphrase without an agent watching or receiving it. Print the recovery sheet and store it separately from the computer. The sheet records where to retrieve the ciphertext, the vault filename, and any additional recovery material required by the chosen backup plane. If an optional key file or hardware challenge is enabled, it also becomes required recovery material. None was enabled by this work.
2. **Create the real database.** In KeePassXC, create a database at `~/SISO_Workspace/personal/vault/siso.kdbx` only after checking that an existing vault will not be overwritten. Select KDBX4 and Argon2id in the database encryption settings; benchmark settings on the intended recovery hardware. Enter the master passphrase directly into KeePassXC. Close, reopen and unlock it with that passphrase before relying on optional Touch ID. Record the format, KDF and initial entry count; do not send a password or a screenshot of secrets to an agent.
3. **Import once per actual account.** Export from each Google account at `passwords.google.com`, plus the Apple export, during the private sitting. Use the approved temporary RAM-disk workflow for plaintext exports; do not place exports in git, ordinary scratch, Downloads, cloud sync or agent logs. Import into the real vault, review duplicates and entry counts, save, lock, and reopen. RAM-disk creation and real exports/imports remain human/ESTATE work; this lane performed none.
4. **Have ESTATE register and verify the data plane.** The intended plane is `personal-vault`, source `personal/vault/siso.kdbx`, private destination `sisodias/siso-data-personal-vault`. ESTATE owns registration, destination authorization, archive policy, backup scheduling and remote restore evidence. The central plane registry currently has no `personal-vault` entry. The KDBX file is already ciphertext. If ESTATE also uses its default outer age encryption, the age recovery identity must have an independently recoverable copy: a KDBX passphrase alone cannot decrypt an age-wrapped archive. The synthetic age identities are never used for production.
5. **Run the actual recovery drill below before acceptance.** Only afterward enable optional Touch ID, the reviewed agent-access boundary and the proposed Hub Vault panel. Touch ID is convenience, not a substitute for the master passphrase. The panel’s search, locked-state behavior and 20-second clipboard clearing are still separate implementation/acceptance gates. Running agents under the same macOS user does not by itself enforce “agents cannot read the vault”; no such isolation is claimed here.

## Exact recovery sequence after ESTATE enrollment

Run this on the agreed throwaway macOS user or replacement machine, with no agent connected to the private unlock/import UI. Do not create or switch OS users during an unrelated task.

1. Install and verify KeePassXC. Recover authorized access to the private backup destination and, when outer age encryption is enabled, the age identity through ESTATE’s recovery procedure. Obtain the approved **completed snapshot reference** and trusted ciphertext SHA256 from the backup receipt.
2. Use a new, empty recovery destination approved by ESTATE. The original spec’s `estate restore --only personal/vault` is repository restoration and is not the current data-plane restore command. After enrollment, use the current interface below, replacing both placeholders with the approved values:

   ```sh
   estate data --machine laptop \
     --ref 'refs/tags/snapshots/laptop/<approved-completed-snapshot>' \
     restore personal-vault '<new-empty-recovery-directory>'
   ```

   `estate data restore` performs restoration immediately; it has no `--run` flag. The source-machine name must match the snapshot, even when the destination is a new machine. Do not run it against the live vault directory. ESTATE must record the archive-relative vault path in the handoff; with a workspace-relative archive it will be `personal/vault/siso.kdbx` under the recovery directory.
3. Compare the restored ciphertext’s SHA256 with the trusted backup receipt before opening it. Open that recovered `.kdbx` directly in KeePassXC, enter the user-held passphrase privately, and confirm the recorded entry count. Verify a known entry and its history without sending the values to an agent. A missing age identity, missing master passphrase, changed hash, or KDBX integrity error is a failed recovery, not a reason to overwrite the existing vault.
4. Record only the snapshot reference, ciphertext hash, format/KDF, expected and observed entry counts, and success/failure. Keep the recovered copy separate until Shaan confirms it. The completed fresh-user drill and remote archive inventory are required evidence before claiming “a lost laptop costs no passwords.” Browser history/bookmarks belong to the separate ab-139 encrypted plane and are not included in this vault proof.

## Reproduce the local synthetic probe

The wrapper accepts a new git-ignored scratch output and only the exact public fixture hash `c087fd7660ddf95b4ec9355fe767c98145841abecb4f638631225225342697c9`. It rejects arbitrary input vaults and existing output paths. It uses the installed CLI’s absolute path and existing `age`/`age-keygen`; it opens no GUI and uses no clipboard. Generated vault passphrases stay in process memory. Synthetic age keys and encrypted evidence remain in ignored scratch.

The seed is the [pinned public PyKeePass test fixture](https://github.com/libkeepass/pykeepass/blob/aec256659e7b2b497a37891476241b720f60c84e/tests/test4_argon2id.kdbx); its public test credentials are documented in that revision’s tests. It is not a production vault template.

```sh
heavy -- python3 tools/ab-vault-recovery-probe.py \
  --seed .agents/scratchpads/landing-20261006/vault-argon2id-seed.kdbx \
  --output .agents/scratchpads/landing-20261006/<new-synthetic-run>
```

The receipt includes CLI/code/fixture hashes, observed KDBX/KDF information and each assertion. A saved checksum manifest detects changes relative to its trusted original; it is not independently authenticated merely because it sits next to a backup. KDBX and age rejection checks independently exercise their authenticated encrypted formats.

References: [original CLI manual for 2.7.12](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/docs/man/keepassxc-cli.1.adoc), [KeePassXC getting started](https://keepassxc.org/docs/KeePassXC_GettingStarted), [CLI database creation implementation](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/src/cli/DatabaseCreate.cpp). Current command syntax was also checked against local `estate data --help`, `estate restore --help` and their owning scripts; no central registry or personal path was modified.
