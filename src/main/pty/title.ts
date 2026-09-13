export function nextTitle(baseName: string, existingTitles: string[]): string {
  if (!existingTitles.includes(baseName)) return baseName
  let index = 2
  while (existingTitles.includes(`${baseName} (${index})`)) index += 1
  return `${baseName} (${index})`
}
