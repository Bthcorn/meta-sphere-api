export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const MAX_FILE_SIZE = parseInt(
  process.env.MAX_FILE_SIZE_BYTES ?? '10485760',
  10,
);
