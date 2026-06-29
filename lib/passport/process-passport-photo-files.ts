import { compressPassportImage } from "@/lib/passport/compress-passport-image";

export async function processPassportPhotoFiles(files: File[]): Promise<File[]> {
  if (files.length === 0) return [];
  return Promise.all(files.map((file, index) => compressPassportImage(file, index)));
}
