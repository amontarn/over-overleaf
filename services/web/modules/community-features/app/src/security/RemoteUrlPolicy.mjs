import dns from "node:dns/promises";
import net from "node:net";

const blockedAddresses = new net.BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.0.0.0", 24, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4");
blockedAddresses.addSubnet("224.0.0.0", 4, "ipv4");
blockedAddresses.addSubnet("240.0.0.0", 4, "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");

async function resolvesOnlyToPrivateAddresses(hostname) {
  const normalisedHostname = hostname.toLowerCase();
  if (
    normalisedHostname === "localhost" ||
    normalisedHostname.endsWith(".localhost") ||
    normalisedHostname.endsWith(".local")
  ) {
    return true;
  }

  const addresses = await dns.lookup(normalisedHostname, {
    all: true,
    verbatim: true,
  });
  if (addresses.length === 0) return false;
  return addresses.every(({ address, family }) =>
    blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4"),
  );
}

async function validate(
  rawUrl,
  { allowPrivateHosts = false, allowInsecureHttp = false } = {},
) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid remote URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("only HTTPS remote URLs are allowed");
  }
  if (url.protocol === "http:") {
    if (!allowInsecureHttp) {
      throw new Error("only HTTPS remote URLs are allowed");
    }
    if (!allowPrivateHosts) {
      throw new Error("HTTP remote URLs require private hosts to be allowed");
    }
    if (!(await resolvesOnlyToPrivateAddresses(url.hostname))) {
      throw new Error("insecure HTTP is only allowed for private hosts");
    }
  }
  if (url.username || url.password) {
    throw new Error("credentials must not be embedded in the remote URL");
  }
  if (url.hash) {
    throw new Error("remote URL fragments are not allowed");
  }

  if (!allowPrivateHosts) {
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    ) {
      throw new Error("private remote hosts are not allowed");
    }
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) {
      throw new Error("remote host did not resolve");
    }
    for (const { address, family } of addresses) {
      if (blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4")) {
        throw new Error(
          "remote host resolves to a private or reserved address",
        );
      }
    }
  }
  return url;
}

export default { validate };
