const SQLite = require('react-native-sqlite-storage');
import RNFS from '@dr.pogodin/react-native-fs';
import DatabaseDriver, { DatabaseCloseOptions, DatabaseOpenOptions } from '@joplin/lib/database-driver';

export default class DatabaseDriverReactNative implements DatabaseDriver {
	private lastInsertId_: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
	private db_: any;
	public constructor() {
		this.lastInsertId_ = null;
	}

	private openDatabase_(options: DatabaseOpenOptions) {
		// SQLite.DEBUG(true);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
		return new Promise<any>((resolve, reject) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SQLCipher key option
			const dbOptions: any = { name: options.name };
			if (options.key) dbOptions.key = options.key;
			SQLite.openDatabase(
				dbOptions,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
				(db: any) => {
					resolve(db);
				},
				(error: Error) => {
					reject(error);
				},
			);
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
	private closeDatabase_(db: any) {
		return new Promise<void>((resolve, reject) => {
			db.close(resolve, (error: Error) => reject(error));
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
	private executeSql_(db: any, sql: string, params: unknown[] = []) {
		return new Promise<void>((resolve, reject) => {
			db.executeSql(sql, params, () => resolve(), (error: Error) => reject(error));
		});
	}

	private quoteSqlString_(value: string) {
		return `'${value.replace(/'/g, '\'\'')}'`;
	}

	private async migratePlaintextDatabase_(options: DatabaseOpenOptions) {
		const encryptedDatabasePath = `${options.name}.encrypted`;
		if (await RNFS.exists(encryptedDatabasePath)) await RNFS.unlink(encryptedDatabasePath);

		const plaintextDb = await this.openDatabase_({ name: options.name });
		try {
			await this.executeSql_(plaintextDb, 'PRAGMA wal_checkpoint(FULL)');
			await this.executeSql_(plaintextDb, 'PRAGMA journal_mode=DELETE');
			await this.executeSql_(
				plaintextDb,
				`ATTACH DATABASE ${this.quoteSqlString_(encryptedDatabasePath)} AS encrypted KEY ${this.quoteSqlString_(options.key)}`,
			);
			await this.executeSql_(plaintextDb, 'SELECT sqlcipher_export(\'encrypted\')');
			await this.executeSql_(plaintextDb, 'DETACH DATABASE encrypted');
		} finally {
			await this.closeDatabase_(plaintextDb);
		}

		const backupPath = `${options.name}.plaintext-backup-${Date.now()}`;
		await RNFS.moveFile(options.name, backupPath);
		for (const suffix of ['-wal', '-shm']) {
			const sidecarPath = `${options.name}${suffix}`;
			if (await RNFS.exists(sidecarPath)) await RNFS.moveFile(sidecarPath, `${backupPath}${suffix}`);
		}
		await RNFS.moveFile(encryptedDatabasePath, options.name);
	}

	public async open(options: DatabaseOpenOptions) {
		if (!options.key) {
			this.db_ = await this.openDatabase_(options);
			return;
		}

		try {
			this.db_ = await this.openDatabase_(options);
			return;
		} catch (encryptedOpenError) {
			try {
				await this.migratePlaintextDatabase_(options);
			} catch {
				throw encryptedOpenError;
			}
			this.db_ = await this.openDatabase_(options);
		}
	}

	public deleteDatabase(options: DatabaseCloseOptions) {
		return new Promise<void>((resolve, reject) => {
			SQLite.deleteDatabase(
				{ name: options.name },
				() => {
					resolve();
				},
				(error: Error) => {
					reject(error);
				},
			);
		});
	}

	public sqliteErrorToJsError(error: Error) {
		return error;
	}

	public selectOne(sql: string, params: unknown = null) {
		return new Promise<unknown>((resolve, reject) => {
			this.db_.executeSql(
				sql,
				params,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Old code before rule was applied
				(r: any) => {
					resolve(r.rows.length ? r.rows.item(0) : null);
				},
				(error: Error) => {
					reject(error);
				},
			);
		});
	}

	public selectAll(sql: string, params: unknown = null) {
		// eslint-disable-next-line promise/prefer-await-to-then -- Old code before rule was applied
		return this.exec(sql, params).then(r => {
			const output = [];
			for (let i = 0; i < r.rows.length; i++) {
				output.push(r.rows.item(i));
			}
			return output;
		});
	}

	public loadExtension(path: string) {
		throw new Error(`No extension support for ${path} in react-native-sqlite-storage`);
	}

	public exec(sql: string, params: unknown = null) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Partial refactor of old code from before rule was applied
		return new Promise<any>((resolve, reject) => {
			this.db_.executeSql(
				sql,
				params,
				(r: { insertId: string }) => {
					if ('insertId' in r) this.lastInsertId_ = r.insertId;
					resolve(r);
				},
				(error: Error) => {
					reject(error);
				},
			);
		});
	}

	public lastInsertId() {
		return this.lastInsertId_;
	}
}
