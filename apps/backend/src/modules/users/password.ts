import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(argon2);

// OWASP's argon2id baseline. Raising it affects new hashes only: each hash stores its own parameters.
const cost = { memory: 19_456, passes: 2, parallelism: 1 };
const costText = `m=${String(cost.memory)},t=${String(cost.passes)},p=${String(cost.parallelism)}`;
const saltLength = 16;
const tagLength = 32;

// PHC format, readable by any argon2 library: $argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>
const phc = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength);
  const hash = await derive("argon2id", { ...cost, message: normalize(password), nonce: salt, tagLength });
  return `$argon2id$v=19$${costText}$${unpadded(salt)}$${unpadded(hash)}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const { salt, hash, ...storedCost } = parse(stored);
  const actual = await derive("argon2id", {
    ...storedCost,
    message: normalize(password),
    nonce: salt,
    tagLength: hash.length,
  });
  return timingSafeEqual(actual, hash);
}

let unknownUserHash: Promise<string> | undefined;

/** Makes an unknown email take as long as a wrong password, so timing can't reveal accounts. */
export async function verifyUnknownUser(password: string): Promise<void> {
  unknownUserHash ??= hashPassword(randomBytes(16).toString("base64"));
  await verifyPassword(await unknownUserHash, password);
}

// Throws: a stored value that isn't an argon2id hash is corrupt data, not a wrong password.
function parse(stored: string) {
  const [, memory, passes, parallelism, salt, hash] = phc.exec(stored) ?? [];
  if (!memory || !passes || !parallelism || !salt || !hash) throw new Error("Stored password is not an argon2id hash");

  return {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    salt: Buffer.from(salt, "base64"),
    hash: Buffer.from(hash, "base64"),
  };
}

// The same password can arrive composed ("é") or decomposed ("e" + combining accent).
function normalize(password: string): string {
  return password.normalize("NFKC");
}

function unpadded(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "");
}
