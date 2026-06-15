import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { referenceWorkspaceImageAsset, saveImageAsset } from "../../electron/fs/fileOps";

let workspaceRoot: string;
let outsideRoot: string;

const pngDataUrl = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
const avifDataUrl = `data:image/avif;base64,${Buffer.from("avif").toString("base64")}`;

async function write(relativePath: string, content = "content") {
  const filePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("image assets", () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-image-assets-"));
    outsideRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-image-assets-outside-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(outsideRoot, { force: true, recursive: true });
  });

  it("copies new image data into an assets folder beside the document", async () => {
    const documentPath = await write("visuals/flow and focus.md", "# Flow");

    const asset = await saveImageAsset({
      workspaceRoot,
      documentPath,
      dataUrl: pngDataUrl,
      originalName: "bottom of the sea.png"
    });

    expect(asset.filePath).toMatch(
      new RegExp(`${escapeRegExp(path.join(workspaceRoot, "visuals", "assets", "flow-and-focus-"))}\\d{8}-\\d{6}\\.png$`)
    );
    expect(asset.relativePath).toMatch(/^\.\/assets\/flow-and-focus-\d{8}-\d{6}\.png$/);
    expect(asset.markdown).toMatch(/^!\[bottom of the sea\]\(\.\/assets\/flow-and-focus-\d{8}-\d{6}\.png\)$/);
    await expect(readFile(asset.filePath, "utf8")).resolves.toBe("png");
  });

  it("rejects unsupported pathless image data", async () => {
    const documentPath = await write("visuals/flow.md", "# Flow");

    await expect(
      saveImageAsset({
        workspaceRoot,
        documentPath,
        dataUrl: avifDataUrl,
        originalName: "photo.avif"
      })
    ).rejects.toThrow(/not supported/i);
  });

  it("references existing workspace images with encoded document-relative paths", async () => {
    const documentPath = await write("drafts/chapter.md", "# Chapter");
    const imagePath = await write("visuals/assets/draft chart (1).png", "png");

    const asset = await referenceWorkspaceImageAsset({ workspaceRoot, documentPath, imagePath });

    expect(asset.filePath).toBe(imagePath);
    expect(asset.relativePath).toBe("../visuals/assets/draft%20chart%20%281%29.png");
    expect(asset.markdown).toBe("![draft chart (1)](../visuals/assets/draft%20chart%20%281%29.png)");
  });

  it("rejects outside, hidden, ignored, unsupported, and symlinked image paths", async () => {
    const documentPath = await write("drafts/chapter.md", "# Chapter");
    const outsideImage = path.join(outsideRoot, "outside.png");
    await writeFile(outsideImage, "png", "utf8");
    const hiddenImage = await write(".hidden/secret.png", "png");
    const ignoredImage = await write("node_modules/pkg/icon.png", "png");
    const unsupportedImage = await write("assets/photo.heic", "heic");
    const realImage = await write("assets/real.png", "png");
    const symlinkedImage = path.join(workspaceRoot, "assets", "link.png");
    await symlink(realImage, symlinkedImage);

    await expect(referenceWorkspaceImageAsset({ workspaceRoot, documentPath, imagePath: outsideImage })).rejects.toThrow(
      /outside/i
    );
    await expect(referenceWorkspaceImageAsset({ workspaceRoot, documentPath, imagePath: hiddenImage })).rejects.toThrow(
      /hidden/i
    );
    await expect(referenceWorkspaceImageAsset({ workspaceRoot, documentPath, imagePath: ignoredImage })).rejects.toThrow(
      /ignored/i
    );
    await expect(
      referenceWorkspaceImageAsset({ workspaceRoot, documentPath, imagePath: unsupportedImage })
    ).rejects.toThrow(/not supported/i);
    await expect(
      referenceWorkspaceImageAsset({ workspaceRoot, documentPath, imagePath: symlinkedImage })
    ).rejects.toThrow(/symlink/i);
  });
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
