export function withGuestLibraryLock<T>(write: () => T): Promise<T>;
export function writeGuestRecords(records: Iterable<readonly [string, unknown]>): void;
