import { createCipheriv, createECDH, createHmac, randomBytes } from "node:crypto";

/**
 * Web Pushのペイロード暗号化（RFC 8291 / RFC 8188 の aes128gcm）。
 *
 * 送信先のプッシュサーバー（AppleやGoogle）は中身を読めない。鍵は購読のときにブラウザが
 * 発行した2つ（p256dh・auth）と、こちらが毎回作る一時鍵とのECDHから導く。
 *
 * 1レコードに収める。通知の文面は数百バイトで、分割が要る大きさにならない。
 *
 * このファイルは他のモジュールを読み込まない。RFC 8291 §5 の値と突き合わせる検証
 * （scripts/check-web-push.mjs）が、Next.jsのパス別名を解決せずに直接読み込めるようにするため。
 */

/** 1レコードの大きさ（RFC 8188 の rs）。 */
const RECORD_SIZE = 4096;

/** ボディの先頭に付く固定部分（salt 16 + レコード長 4 + 鍵長 1 + 一時公開鍵 65）。 */
const HEADER_BYTES = 86;

/** 本文の上限。区切り1バイトと認証タグ16バイトを足した全体を4096バイトに収める。 */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - HEADER_BYTES - 17;

export type PushKeys = {
  /** 購読の p256dh（base64url・65バイトの非圧縮点） */
  p256dh: string;
  /** 購読の auth（base64url・16バイト） */
  auth: string;
};

export class PayloadTooLargeError extends Error {}

/**
 * 本文を暗号化し、そのままリクエストボディにできるバイト列を返す。
 *
 * 並びは `salt(16) | レコード長(4) | 鍵の長さ(1) | 一時公開鍵(65) | 暗号文`（RFC 8188 §2.1）。
 */
export function encryptPayload(payload: string, keys: PushKeys): Buffer {
  const plaintext = Buffer.from(payload, "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new PayloadTooLargeError(
      `通知の本文が長すぎます（${plaintext.length} > ${MAX_PAYLOAD_BYTES} バイト）。`,
    );
  }

  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();

  return encryptRecord(plaintext, {
    userPublicKey: Buffer.from(keys.p256dh, "base64url"),
    authSecret: Buffer.from(keys.auth, "base64url"),
    localPrivateKey: ecdh.getPrivateKey(),
    salt: randomBytes(16),
  });
}

/**
 * 一時鍵と salt を外から与えて暗号化する。
 *
 * 乱数のままでは結果が毎回変わり、RFC 8291 §5 の既知の値と突き合わせられない。
 * 検証（scripts/check-web-push.mjs）から呼ぶためにこの形で分けている。
 */
export function encryptRecord(
  payload: Buffer,
  params: {
    userPublicKey: Buffer;
    authSecret: Buffer;
    localPrivateKey: Buffer;
    salt: Buffer;
  },
): Buffer {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(params.localPrivateKey);
  const localPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(params.userPublicKey);

  // 共有鍵と auth から、この購読に固有の入力鍵（IKM）を作る（RFC 8291 §3.4）。
  // ここでだけ salt ではなく auth を鍵に使う。auth を知らない相手は同じ鍵を作れない。
  const authPrk = hmac(params.authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    params.userPublicKey,
    localPublicKey,
  ]);
  const ikm = hkdfExpand(authPrk, keyInfo, 32);

  const prk = hmac(params.salt, ikm);
  const contentEncryptionKey = hkdfExpand(prk, info("aes128gcm"), 16);
  const nonce = hkdfExpand(prk, info("nonce"), 12);

  // 最後のレコードの区切りは 0x02（RFC 8188 §2）。1レコードで送るため常にこれを付ける。
  const padded = Buffer.concat([payload, Buffer.from([0x02])]);

  const cipher = createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(5);
  header.writeUInt32BE(RECORD_SIZE, 0);
  header.writeUInt8(localPublicKey.length, 4);

  return Buffer.concat([params.salt, header, localPublicKey, ciphertext]);
}

function hmac(key: Buffer, value: Buffer): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

/** HKDF-Expand。要る長さが32バイト以下なので繰り返しは1回で足りる。 */
function hkdfExpand(prk: Buffer, infoBytes: Buffer, length: number): Buffer {
  const output = createHmac("sha256", prk)
    .update(Buffer.concat([infoBytes, Buffer.from([0x01])]))
    .digest();
  return output.subarray(0, length);
}

/** `Content-Encoding: <名前>\0`（RFC 8188 §2.2）。 */
function info(name: string): Buffer {
  return Buffer.from(`Content-Encoding: ${name}\0`, "utf8");
}
