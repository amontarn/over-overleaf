const tails = new Map();

export async function withProjectLock(projectId, callback) {
  const previous = tails.get(projectId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  tails.set(projectId, current);
  await previous.catch(() => {});
  try {
    return await callback();
  } finally {
    release();
    if (tails.get(projectId) === current) tails.delete(projectId);
  }
}
