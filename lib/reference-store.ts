import { isRemoteVideoPath } from "./blob-path";

export type ReferenceStorageAction = "blob" | "disk" | "refuse";
export type StoredReferenceState = "ready" | "missing" | "absent";

// Online audio has to live in Blob. An empty BLOB_READ_WRITE_TOKEN is fine when OIDC is connected.
export function referenceStorageAction(input: { blobEnabled: boolean; vercel: boolean }): ReferenceStorageAction {
  if (input.blobEnabled) return "blob";
  if (input.vercel) return "refuse";
  return "disk";
}

export function referencePlaybackKind(path: string): "redirect" | "file" {
  return isRemoteVideoPath(path) ? "redirect" : "file";
}

export function canReplaceReference(status: string): boolean {
  return status === "draft" || status === "published" || status === "closed";
}

export function storedReferenceState(path: string | null, localExists: boolean): StoredReferenceState {
  if (!path) return "absent";
  if (isRemoteVideoPath(path)) return "ready";
  return localExists ? "ready" : "missing";
}
