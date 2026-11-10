/**
 * SourceBuffer creation failures cannot be repaired by detaching and
 * re-attaching the same HLS media. Keep them separate from the recoverable
 * decode errors handled by `hls.recoverMediaError()`.
 */
export function isHlsSourceBufferCodecError(details: unknown): boolean {
  return (
    details === "bufferAddCodecError" ||
    details === "bufferIncompatibleCodecsError"
  );
}
