export function validateProjectName(value) {
  const projectName = typeof value === "string" ? value.trim() : "";
  if (!projectName || projectName.length > 150 || /[\r\n\0]/.test(projectName)) {
    throw new Error("invalid project name");
  }
  return projectName;
}
