export const chatImageUploadKey = (id: string): string => `mocmaria.chat.upload.${id}`;
export const chatMessageImageKey = (id: string): string => `mocmaria.chat.image.${id}`;
export const imageIdFromUrl = (url: string): string | null =>
  /\/moc-maria\/chat-attachments\/[0-9a-f-]{36}\/([0-9a-f-]{36})\.webp$/.exec(url)?.[1] ?? null;
