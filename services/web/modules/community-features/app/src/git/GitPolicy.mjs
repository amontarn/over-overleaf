import Path from "node:path";

export function validateBranch(branch) {
  branch = typeof branch === "string" ? branch.trim() : "";
  if (
    !branch ||
    branch.length > 200 ||
    branch.startsWith("-") ||
    branch.startsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    /[~^:?*[\]\\\s]/.test(branch) ||
    branch.endsWith(".") ||
    branch.endsWith("/") ||
    branch.includes("//")
  ) {
    throw new Error("invalid Git branch name");
  }
  return branch;
}

export function safeDestination(root, projectPath) {
  const normalisedPath = projectPath.replace(/^[/\\]+/, "");
  const destination = Path.resolve(root, normalisedPath);
  if (!destination.startsWith(`${Path.resolve(root)}${Path.sep}`)) {
    throw new Error("project path escaped Git working directory");
  }
  return destination;
}
