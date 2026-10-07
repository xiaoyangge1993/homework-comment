export type VideoStorageMode = { enabled: boolean; direct: boolean; presigned: boolean };

// A connected Private Blob store exposes BLOB_STORE_ID and BLOB_WEBHOOK_PUBLIC_KEY.
// Vercel injects VERCEL_OIDC_TOKEN at runtime, so browser uploads use presigned URLs.
// BLOB_READ_WRITE_TOKEN remains a fallback for the older client-token upload.
export function videoStorageFromEnv(env: {
  storeId?: string;
  token?: string;
  webhookKey?: string;
  vercel?: string;
}): VideoStorageMode {
  const hasStore = Boolean(env.storeId);
  const hasToken = Boolean(env.token);
  const presigned = Boolean(env.webhookKey) && (hasStore || hasToken);
  const enabled = presigned || hasToken;
  return { enabled, direct: !enabled && !env.vercel, presigned };
}
