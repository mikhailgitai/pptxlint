import { isRelationshipType } from "../../relationships/relationships.js";

export type MediaKind = "audio" | "image" | "media" | "video";

export const MICROSOFT_MEDIA_RELATIONSHIP =
  "http://schemas.microsoft.com/office/2007/relationships/media";

const MEDIA_RELATIONSHIP_NAMES: Readonly<Record<MediaKind, readonly string[]>> =
  {
    audio: ["audio", "audioFile"],
    image: ["image"],
    media: ["media"],
    video: ["video", "videoFile"],
  };

export function mediaKindForRelationship(type: string): MediaKind | null {
  if (type === MICROSOFT_MEDIA_RELATIONSHIP) return "media";
  for (const kind of ["audio", "image", "media", "video"] as const) {
    if (
      MEDIA_RELATIONSHIP_NAMES[kind].some((name) =>
        isRelationshipType(type, name),
      )
    ) {
      return kind;
    }
  }
  return null;
}
