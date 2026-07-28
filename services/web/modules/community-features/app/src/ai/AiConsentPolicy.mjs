export function providerOrigin(baseUrl) {
  return new URL(baseUrl).origin;
}

export function publicProviderOrigin(baseUrl) {
  try {
    return baseUrl ? providerOrigin(baseUrl) : null;
  } catch {
    return null;
  }
}

export function providerHasChanged(currentBaseUrl, nextBaseUrl) {
  return Boolean(
    currentBaseUrl &&
    nextBaseUrl &&
    providerOrigin(currentBaseUrl) !== providerOrigin(nextBaseUrl),
  );
}

export function nextConsentVersion(currentVersion) {
  const current = Number.parseInt(currentVersion, 10);
  return String(Number.isFinite(current) ? current + 1 : Date.now());
}
