export type Cancellation = {
  cancelled: boolean;
  /** What remains of the message after the cancellation phrase. */
  remainder: string;
};

// Common ways to withdraw a pending question or edit (English and German).
const CANCELLATION =
  /^\s*(?:(?:ok(?:ay)?|no|oh|sorry|hmm+)\b[\s,.!;:-]*)*(?:never\s*mind|nevermind|forget\s+(?:it|that|about\s+(?:it|that))|scratch\s+that|cancel\s+(?:that|it)|disregard\s+(?:that|it)|ignore\s+(?:that|it)|vergiss\s+(?:es|das)|schon\s+gut|lass\s+(?:es|das)(?:\s+(?:sein|bleiben))?)\b[\s,.:;!\-\u2013\u2014]*([\s\S]*)$/i;

/** A cancellation may also carry the continuation of the process. */
export function parseCancellation(
  message: string
): Cancellation {
  const match = CANCELLATION.exec(message);

  if (!match) {
    return {
      cancelled: false,
      remainder: message
    };
  }

  return {
    cancelled: true,
    remainder: match[1].trim()
  };
}
