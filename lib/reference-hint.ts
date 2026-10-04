export function referenceHint(input: {
  sentenceCount: number;
  missingReference: number;
  hasDemoVideo: boolean;
}): string {
  if (input.sentenceCount > 0 && input.missingReference <= 0) return "每句都有标准音";
  if (input.hasDemoVideo && input.sentenceCount > 0 && input.missingReference >= input.sentenceCount) {
    return "只有整段视频参照";
  }
  return "无节奏参照";
}
