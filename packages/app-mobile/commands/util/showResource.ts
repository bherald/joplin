import Resource from '@joplin/lib/models/Resource';
import { ResourceEntity } from '@joplin/lib/services/database/types';
import shim from '@joplin/lib/shim';
import Logger from '@joplin/utils/Logger';
import Setting from '@joplin/lib/models/Setting';
import { getOrCreateEncryptionKey } from '../../utils/localEncryption/keyManager';
import { decryptToDisplayFile } from '../../utils/localEncryption/resourceCrypto';
const FileViewer = require('react-native-file-viewer').default;


const logger = Logger.create('showResource');

const showResource = async (item: ResourceEntity) => {
	const resourcePath = Resource.fullPath(item);
	logger.info(`Opening resource: ${resourcePath}`);

	if (shim.mobilePlatform() === 'web') {
		const url = URL.createObjectURL(await shim.fsDriver().fileAtPath(resourcePath));
		const w = window.open(url, '_blank');
		w?.addEventListener('close', () => {
			URL.revokeObjectURL(url);
		}, { once: true });
	} else {
		let displayPath = resourcePath;
		if (shim.mobilePlatform() === 'android') {
			const localEncryptionKey = await getOrCreateEncryptionKey();
			displayPath = await decryptToDisplayFile(
				resourcePath,
				`${Setting.value('resourceDir')}/.webview_decrypted`,
				localEncryptionKey,
			);
		}
		await FileViewer.open(displayPath);
	}
};

export default showResource;
