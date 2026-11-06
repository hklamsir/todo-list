/** 結構化 JSON 日誌：每行一個 JSON，帶 requestId；永不記錄 token / key / 標題內容。 */
export function logEvent(level, event, fields = {}) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
