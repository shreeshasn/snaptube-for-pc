export function validateUrl(url) {
  if (!url) return false;
  const regex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/(watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  return regex.test(url);
}
