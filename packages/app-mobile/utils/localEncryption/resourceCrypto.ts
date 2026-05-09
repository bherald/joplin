// AES-256-GCM encryption helpers for resource files.
// Binary format on disk: [4-byte magic 'JENC'][1-byte version 0x01][12-byte IV][16-byte auth tag][ciphertext]

import QuickCrypto from 'react-native-quick-crypto';
import type { CipherGCM, DecipherGCM } from 'crypto';
import type { CipherGCMOptions } from 'crypto';
import shim from '@joplin/lib/shim';

const MAGIC = 'JENC';
const VERSION = 0x01;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
// 4 (magic) + 1 (version) + 12 (IV) + 16 (tag) = 33
const HEADER_LENGTH = 4 + 1 + IV_LENGTH + TAG_LENGTH;

export const isEncryptedBuffer = (buf: Buffer): boolean => {
	if (buf.length < HEADER_LENGTH) return false;
	return (
		buf[0] === 0x4a && // J
		buf[1] === 0x45 && // E
		buf[2] === 0x4e && // N
		buf[3] === 0x43 && // C
		buf[4] === VERSION
	);
};

export const encryptBuffer = (plaintext: Buffer, keyHex: string): Buffer => {
	const key = Buffer.from(keyHex, 'hex');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Buffer type mismatch between rnqc and node
	const iv = QuickCrypto.randomBytes(IV_LENGTH) as any as Buffer;

	const cipher = QuickCrypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH } as CipherGCMOptions) as unknown as CipherGCM;
	const encrypted = Buffer.concat([cipher.update(plaintext) as Buffer, cipher.final() as Buffer]);
	const tag = cipher.getAuthTag();

	const magic = Buffer.from(MAGIC, 'ascii');
	const versionBuf = Buffer.from([VERSION]);
	return Buffer.concat([magic, versionBuf, iv, tag, encrypted]);
};

export const decryptBuffer = (data: Buffer, keyHex: string): Buffer => {
	if (!isEncryptedBuffer(data)) return data; // Not encrypted, passthrough
	const key = Buffer.from(keyHex, 'hex');

	const iv = data.slice(5, 5 + IV_LENGTH);
	const tag = data.slice(5 + IV_LENGTH, HEADER_LENGTH);
	const ciphertext = data.slice(HEADER_LENGTH);

	const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH } as CipherGCMOptions) as unknown as DecipherGCM;
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext) as Buffer, decipher.final() as Buffer]);
};

// Encrypt a file at `path` in-place. Idempotent — already-encrypted files are skipped.
export const encryptFileInPlace = async (path: string, keyHex: string): Promise<void> => {
	const rawBase64 = await shim.fsDriver().readFile(path, 'base64') as string;
	const rawBytes = Buffer.from(rawBase64, 'base64');
	if (isEncryptedBuffer(rawBytes)) return; // Already encrypted

	const encrypted = encryptBuffer(rawBytes, keyHex);
	await shim.fsDriver().writeFile(path, encrypted.toString('base64'), 'base64');
};

export const encryptDirectoryInPlace = async (dirPath: string, keyHex: string): Promise<void> => {
	const stats = await shim.fsDriver().readDirStats(dirPath);
	for (const stat of stats) {
		if (stat.isDirectory()) continue;
		if (stat.path.endsWith('.tmp_decrypt')) continue;
		await encryptFileInPlace(`${dirPath}/${stat.path}`, keyHex);
	}
};

// Decrypt a file at `path` in-place. Idempotent — already-plaintext files are skipped.
export const decryptFileInPlace = async (path: string, keyHex: string): Promise<void> => {
	const rawBase64 = await shim.fsDriver().readFile(path, 'base64') as string;
	const rawBytes = Buffer.from(rawBase64, 'base64');
	if (!isEncryptedBuffer(rawBytes)) return; // Not encrypted

	const decrypted = decryptBuffer(rawBytes, keyHex);
	await shim.fsDriver().writeFile(path, decrypted.toString('base64'), 'base64');
};

export const decryptToDisplayFile = async (srcPath: string, tempDecryptDir: string, keyHex: string): Promise<string> => {
	await shim.fsDriver().mkdir(tempDecryptDir);

	const filename = srcPath.split('/').pop();
	const dstPath = `${tempDecryptDir}/${filename}`;

	const srcStat = await shim.fsDriver().stat(srcPath);
	let needsDecrypt = true;
	if (await shim.fsDriver().exists(dstPath)) {
		const dstStat = await shim.fsDriver().stat(dstPath);
		needsDecrypt = srcStat.mtime > dstStat.mtime;
	}

	if (needsDecrypt) {
		const rawBase64 = await shim.fsDriver().readFile(srcPath, 'base64') as string;
		const rawBytes = Buffer.from(rawBase64, 'base64');
		if (isEncryptedBuffer(rawBytes)) {
			const decrypted = decryptBuffer(rawBytes, keyHex);
			await shim.fsDriver().writeFile(dstPath, decrypted.toString('base64'), 'base64');
		} else {
			await shim.fsDriver().writeFile(dstPath, rawBase64, 'base64');
		}
	}

	return dstPath;
};

// Decrypt resource files referenced in HTML (as file:// URLs under resourceDir) to
// tempDecryptDir and return the HTML with URLs rewritten to point to the temp files.
// On-disk encrypted files (JENC header) are decrypted; plaintext files are copied as-is.
// Results are cached: a file is only re-decrypted when its source is newer than the temp copy.
const relativeResourceRegex = /(["'])\.\/([0-9a-f]{32})([?#][^"']*)?\1/g;

export const prepareResourcesForDisplay = async (
	html: string,
	resourceDir: string,
	tempDecryptDir: string,
	keyHex: string,
): Promise<string> => {
	await shim.fsDriver().mkdir(tempDecryptDir);

	// Match file:// URLs that begin with resourceDir (handles file:// and file:///)
	const resourceDirEscaped = resourceDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const tempDirName = tempDecryptDir.split('/').pop();
	const fileUrlRegex = new RegExp(`file:\\/\\/\\/?${resourceDirEscaped}\\/([^"'\\s>]+)`, 'g');

	const seenFiles = new Set<string>();
	let match: RegExpExecArray | null = null;

	while ((match = fileUrlRegex.exec(html)) !== null) {
		const filename = match[1];
		seenFiles.add(filename);
	}

	while ((match = relativeResourceRegex.exec(html)) !== null) {
		seenFiles.add(match[2]);
	}

	if (seenFiles.size === 0) return html;

	for (const filename of seenFiles) {
		const srcPath = `${resourceDir}/${filename}`;

		try {
			await decryptToDisplayFile(srcPath, tempDecryptDir, keyHex);
		} catch (_err) {
			// File missing or IO error — leave original URL so WebView shows broken image
		}
	}

	// Replace all matching URLs with temp dir paths
	return html
		.replace(new RegExp(`file:\\/\\/\\/?${resourceDirEscaped}\\/`, 'g'), `file://${tempDecryptDir}/`)
		.replace(relativeResourceRegex, `$1./${tempDirName}/$2$3$1`);
};

// Decrypt a resource file to a temp file for sync upload. Returns the temp path.
// Caller is responsible for deleting the temp file when done.
export const decryptToTempFile = async (srcPath: string, keyHex: string): Promise<string> => {
	const rawBase64 = await shim.fsDriver().readFile(srcPath, 'base64') as string;
	const rawBytes = Buffer.from(rawBase64, 'base64');

	if (!isEncryptedBuffer(rawBytes)) return srcPath; // Not encrypted, use original

	const decrypted = decryptBuffer(rawBytes, keyHex);
	const tempPath = `${srcPath}.tmp_decrypt`;
	await shim.fsDriver().writeFile(tempPath, decrypted.toString('base64'), 'base64');
	return tempPath;
};
