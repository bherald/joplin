import Logger from '@joplin/utils/Logger';
import shim from '@joplin/lib/shim';

const logger = Logger.create('temporaryAttachmentSource');

export const isTemporaryAttachmentSource = (path: string | undefined | null): boolean => {
	if (!path) return false;
	return path.includes('/cache/Camera/');
};

export const cleanupTemporaryAttachmentSource = async (path: string | undefined | null): Promise<void> => {
	if (!isTemporaryAttachmentSource(path)) return;

	try {
		if (await shim.fsDriver().exists(path)) {
			await shim.fsDriver().remove(path);
		}
	} catch (error) {
		logger.warn('Could not remove temporary attachment source:', path, error);
	}
};
