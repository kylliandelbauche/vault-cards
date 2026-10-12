export const obsidianUrl = (sourcePath: string) =>
  `obsidian://open?vault=Workspace&file=${encodeURIComponent(sourcePath.replace(/\.md$/, ''))}`
