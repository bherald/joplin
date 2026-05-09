import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import QuickCrypto from 'react-native-quick-crypto';

const KEY_SERVICE = 'net.cozic.joplin.localEncryption';
const KEY_USERNAME = 'localEncryptionKey';

let cachedKey: string | null = null;

// Returns the 64-char hex string of the 32-byte AES-256 key.
// Only meaningful on Android; returns empty string on other platforms.
export const getOrCreateEncryptionKey = async (): Promise<string> => {
	if (Platform.OS !== 'android') return '';
	if (cachedKey) return cachedKey;

	const existing = await Keychain.getGenericPassword({ service: KEY_SERVICE });
	if (existing) {
		cachedKey = existing.password;
		return cachedKey;
	}

	// Generate a new 256-bit key backed by Android Keystore
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Buffer type mismatch between rnqc and node
	const keyBytes = QuickCrypto.randomBytes(32) as any as Buffer;
	const keyHex = keyBytes.toString('hex');

	await Keychain.setGenericPassword(KEY_USERNAME, keyHex, {
		service: KEY_SERVICE,
		accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
	});

	cachedKey = keyHex;
	return cachedKey;
};

// Call this to clear the in-memory cache (e.g., after profile switch)
export const clearCachedKey = () => {
	cachedKey = null;
};
