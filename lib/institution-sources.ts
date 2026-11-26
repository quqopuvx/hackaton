export function isDirectorySource(url: string, title = ""): boolean {
  const path = new URL(url).pathname;
  return /\/(?:reestr|perechen|spisok)[-_](?:akkreditovannyh|akkreditovannyih|akkreditovannykh|obrazovatelnyh|obrazovatelnyih|obrazovatelnykh)(?:[-_]|\/|$)/i.test(path) ||
    /^(?:(?:государственный|единый)\s+)?(?:реестр|перечень|список)\s+(?:аккредитованных\s+)?образовательных\s+(?:организаций|учреждений)/iu.test(title.trim());
}
