import AccessTokenEncryptor from "@overleaf/access-token-encryptor";
import Settings from "@overleaf/settings";

let encryptor;

function getEncryptor() {
  if (encryptor) {
    return encryptor;
  }
  const secret = Settings.communityFeatures?.encryptionSecret;
  if (!secret || secret.length < 16) {
    throw new Error(
      "OVERLEAF_EXTENSIONS_SECRET must contain at least 16 characters",
    );
  }
  encryptor = new AccessTokenEncryptor({
    cipherLabel: "2026.1-v3",
    cipherPasswords: { "2026.1-v3": secret },
  });
  return encryptor;
}

async function encrypt(value) {
  return await getEncryptor().promises.encryptJson({ value });
}

async function decrypt(encryptedValue) {
  const result = await getEncryptor().promises.decryptToJson(encryptedValue);
  return result.value;
}

export default { encrypt, decrypt };
