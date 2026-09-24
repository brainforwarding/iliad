import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const skillRelativePath = path.join("iliad", "SKILL.md");

/**
 * The bundled skill sits next to the CLI: `../resources/skill` in a checkout,
 * `../skill` inside the packaged app's Resources folder.
 */
export function resolveSkillPath(scriptDirectory, exists = existsSync) {
  const candidates = [
    path.resolve(scriptDirectory, "..", "skill", skillRelativePath),
    path.resolve(scriptDirectory, "..", "resources", "skill", skillRelativePath)
  ];

  const found = candidates.find((candidate) => exists(candidate));

  if (!found) {
    throw new Error("Could not find the bundled Iliad skill (SKILL.md).");
  }

  return found;
}

export function claudeSkillTarget(home) {
  return path.join(home, ".claude", "skills", "iliad", "SKILL.md");
}

export async function installSkill({ scriptDirectory, home }) {
  const source = resolveSkillPath(scriptDirectory);
  const target = claudeSkillTarget(home);

  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return target;
}

export async function readSkill({ scriptDirectory }) {
  return readFile(resolveSkillPath(scriptDirectory), "utf8");
}
