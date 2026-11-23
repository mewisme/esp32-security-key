import SparkMD5 from "spark-md5";

/** Lowercase hex MD5, the format esptool's flash MD5 command returns. */
export function md5Hex(data: Uint8Array): string {
  return SparkMD5.ArrayBuffer.hash(data.slice().buffer as ArrayBuffer);
}
