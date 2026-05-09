# Mobile local encryption

Android can store local profile data encrypted at rest independently of Joplin sync E2EE.

## Scope

- The SQLite profile and log databases are opened through SQLCipher with a 256-bit random key.
- Resource blobs in the profile resource directory are wrapped with AES-256-GCM.
- The feature is Android-only. Other platforms keep the existing plaintext local storage behaviour.
- This does not replace sync E2EE. Sync E2EE still controls what is uploaded to the sync target.

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

## Verification checklist

- Fresh Android install creates and opens encrypted SQLCipher profile and log databases.
- Upgrade from a plaintext profile migrates the database and preserves a plaintext backup.
- Notes with image/file resources render in the viewer after restart.
- Sync upload sends normal resource bytes, not `JENC` resource bytes.
- Downloaded resources and newly-created local resources are encrypted on disk.
- Joplin sync E2EE still produces encrypted sync-target resource blobs when enabled.
