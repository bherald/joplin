# Mobile local encryption

Android can store local profile data encrypted at rest independently of Joplin sync E2EE.

## Scope

- The SQLite profile and log databases are opened through SQLCipher with a 256-bit random key.
- Resource blobs in the profile resource directory are wrapped with AES-256-GCM.
- The feature is Android-only. Other platforms keep the existing plaintext local storage behaviour.
- This does not replace sync E2EE. Sync E2EE still controls what is uploaded to the sync target.

## Current status

This work is tracked on the `feature/mobile-local-encryption` branch of the `bherald/joplin` fork.

Validated on a Samsung Galaxy tablet attached over USB:

- Profileable Android APK builds and installs with `./gradlew :app:createBundleProfileableJsAndAssets :app:installProfileable --rerun-tasks`.
- Existing synced Joplin data opens after local unlock.
- The profile database and log database are opened with SQLCipher.
- Local resource files are encrypted at rest with the `JENC` resource wrapper.
- Sync upload decrypts local encrypted resource files before reading them for upload.
- WebView note rendering can display encrypted-at-rest resources through the decrypted display cache.
- Markdown editor image rendering handles Joplin resource images written as Markdown resource links, `:/<resource-id>` HTML image sources, and imported relative `./<resource-id>` HTML image sources.
- Joplin sync E2EE remains separate from this local-at-rest encryption work and was not enabled for this validation pass.

The final tablet test confirmed that notes with embedded imported HTML image tags render images instead of showing raw `<img>` tags after rebuilding the mobile injected editor bundle and reinstalling the APK.

## Key storage

The local encryption key is generated on first Android startup and stored with `react-native-keychain` under the `net.cozic.joplin.localEncryption` service. The in-memory copy is cached only for the current process.

If an existing plaintext SQLite database is found, the app:

1. Opens the database without a key.
2. Uses `sqlcipher_export` to copy it to an encrypted database.
3. Keeps the original database as `<name>.plaintext-backup-<timestamp>`.
4. Reopens the database with the SQLCipher key.

## Resource files

Resource files use this binary format:

```text
JENC | version byte | 12-byte IV | 16-byte auth tag | ciphertext
```

Startup schedules a background scan of resource records in the database and encrypts any downloaded plaintext blobs. It does not block initial rendering, and it does not encrypt every file in the resource directory because the default mobile profile stores non-resource files there too. The operation is idempotent because encrypted files start with the `JENC` header.

Newly-created local attachments and downloaded resources are encrypted after their blob is written. Before note HTML is written to a mobile WebView, referenced resource files are decrypted to a hidden display cache under the resource directory and the HTML file URLs are rewritten to those temp files. Before sync upload, encrypted-at-rest resources are decrypted to a temporary `.tmp_decrypt` file; sync cleanup removes that file after upload.

## Build and install notes

The Android build currently relies on package patches that add Gradle namespaces for older native dependencies and SQLCipher support for `react-native-sqlite-storage`.

The profileable APK used for device testing was installed with:

```sh
cd packages/app-mobile/android
./gradlew :app:createBundleProfileableJsAndAssets :app:installProfileable --rerun-tasks
```

The Markdown editor runs inside a mobile WebView injected bundle. After changing editor rendering code, rebuild the injected JavaScript bundle before rebuilding the Android APK; otherwise the installed app can still contain stale editor behavior.

## Known limitations and next steps

This branch should be treated as a working Android fork, not an upstream-ready patch set.

- The implementation has only been validated on Android. iOS still uses the existing local storage behavior.
- The local encryption key is managed by the Android keychain through `react-native-keychain`; losing or resetting device keychain data can make locally encrypted profile data unrecoverable without a fresh sync.
- Plaintext database backups created during migration remain on disk as `<name>.plaintext-backup-<timestamp>` and should be handled by a future migration-cleanup policy.
- Decrypted WebView display files are temporary cache files under the resource directory and are cleared on startup, but they exist while rendered content is being displayed.
- The injected Markdown editor bundle needs a reliable documented rebuild path. The manual rebuild workaround used during validation should be replaced with a normal workspace build command before this is proposed upstream.
- More testing is needed for large syncs, attachment add/remove flows, export/import flows, share flows, and E2EE-enabled sync targets.
- A release APK should be tagged only after additional day-to-day testing confirms startup, sync, rendering, and attachment handling remain stable.

## Verification checklist

- Fresh Android install creates and opens encrypted SQLCipher profile and log databases.
- Upgrade from a plaintext profile migrates the database and preserves a plaintext backup.
- Notes with image/file resources render in the viewer after restart.
- Sync upload sends normal resource bytes, not `JENC` resource bytes.
- Downloaded resources and newly-created local resources are encrypted on disk.
- Joplin sync E2EE still produces encrypted sync-target resource blobs when enabled.
