export const MIB = 1024 * 1024;
export const MAX_IMAGE_PLAINTEXT_BYTES = 5 * MIB;
export const AES_GCM_TAG_BYTES = 16;
export const MAX_ENCRYPTED_IMAGE_BYTES = MAX_IMAGE_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES;
export const MAX_ATTACHMENT_PLAINTEXT_BYTES = 25 * MIB;
export const MAX_ENCRYPTED_ATTACHMENT_BYTES = MAX_ATTACHMENT_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES;

export type MessageUploadIntent = {
  roomId: number | null;
  encryptedImage: boolean;
};

export class MessageUploadPolicyError extends Error {
  constructor(
    public readonly status: 400 | 403,
    message: string,
  ) {
    super(message);
    this.name = "MessageUploadPolicyError";
  }
}

type UploadQuery = {
  roomId?: unknown;
  kind?: unknown;
};

/**
 * Authorize all query-scoped uploads before multer starts reading multipart
 * bytes. `kind=image` identifies opaque E2EE image ciphertext; it is only a
 * routing/limit hint and deliberately causes no content inspection.
 */
export async function authorizeMessageUpload(
  query: UploadQuery,
  userId: number,
  getMembership: (roomId: number, userId: number) => Promise<unknown>,
): Promise<MessageUploadIntent> {
  const encryptedImage = query.kind === "image";
  const hasRoomId = query.roomId !== undefined;

  if (encryptedImage && !hasRoomId) {
    throw new MessageUploadPolicyError(400, "roomId is required for encrypted image uploads");
  }

  let roomId: number | null = null;
  if (hasRoomId) {
    if (typeof query.roomId !== "string" || !/^[1-9]\d*$/.test(query.roomId)) {
      throw new MessageUploadPolicyError(400, "Invalid room ID");
    }
    roomId = Number(query.roomId);
    if (!Number.isSafeInteger(roomId)) {
      throw new MessageUploadPolicyError(400, "Invalid room ID");
    }
    if (!await getMembership(roomId, userId)) {
      throw new MessageUploadPolicyError(403, "Access denied — not a member of this room");
    }
  }

  return { roomId, encryptedImage };
}

export function messageUploadByteLimit(intent: MessageUploadIntent, mimetype: string): number {
  if (mimetype.startsWith("image/")) return MAX_IMAGE_PLAINTEXT_BYTES;
  if (intent.encryptedImage) return MAX_ENCRYPTED_IMAGE_BYTES;
  return mimetype === "application/octet-stream"
    ? MAX_ENCRYPTED_ATTACHMENT_BYTES
    : MAX_ATTACHMENT_PLAINTEXT_BYTES;
}