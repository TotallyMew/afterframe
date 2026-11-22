export async function withGuestLibraryLock(write) {
  return globalThis.navigator?.locks ? navigator.locks.request('afterframe.guest-library', write) : write();
}

export function writeGuestRecords(records) {
  // Prepare the complete write before touching local storage. If a write runs
  // out of quota, restore the original values while the lock is still held.
  const changes = Array.from(records, ([kind, value]) => {
    const key = `afterframe.${kind}`;
    return { key, previous: localStorage.getItem(key), next: JSON.stringify(value) };
  });
  let written = 0;
  try {
    for (const { key, next } of changes) {
      localStorage.setItem(key, next);
      written++;
    }
  } catch (error) {
    for (const { key } of changes.slice(0, written)) localStorage.removeItem(key);
    for (const { key, previous } of changes.slice(0, written)) {
      if (previous !== null) localStorage.setItem(key, previous);
    }
    throw error;
  }
}
