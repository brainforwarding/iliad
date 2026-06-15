import { EditorView } from "@codemirror/view";
import {
  imageReferenceDragMimeType,
  readImageReferenceDragPayload
} from "../files/imageReferenceDrag";

type InsertImage = (file: File) => Promise<string | null | undefined>;
type InsertImageReference = (relativePath: string) => Promise<string | null | undefined>;

interface ImageDropPasteOptions {
  insertImage: InsertImage;
  insertImageReference?: InsertImageReference;
  workspaceSessionId?: string;
}

function imageFiles(fileList: FileList | null) {
  return Array.from(fileList ?? []).filter(
    (file) => file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)
  );
}

function insertionText(markdownImages: string[], currentText: string, position: number) {
  const prefix = position > 0 && currentText.slice(position - 1, position) !== "\n" ? "\n\n" : "";
  const suffix = position < currentText.length && currentText.slice(position, position + 1) !== "\n" ? "\n\n" : "\n";

  return `${prefix}${markdownImages.join("\n\n")}${suffix}`;
}

async function insertImages(view: EditorView, position: number, files: File[], insertImage: InsertImage) {
  const markdownImages: string[] = [];

  for (const file of files) {
    try {
      const markdownImage = await insertImage(file);

      if (markdownImage) {
        markdownImages.push(markdownImage);
      }
    } catch (error) {
      console.warn("[editor] Image insertion failed.", error);
    }
  }

  if (markdownImages.length === 0) {
    return;
  }

  const currentText = view.state.doc.toString();
  const text = insertionText(markdownImages, currentText, position);

  view.dispatch({
    changes: { from: position, insert: text },
    selection: { anchor: position + text.length },
    scrollIntoView: true
  });
}

async function insertImageReferences(
  view: EditorView,
  position: number,
  relativePaths: string[],
  insertImageReference: InsertImageReference
) {
  const markdownImages: string[] = [];

  for (const relativePath of relativePaths) {
    try {
      const markdownImage = await insertImageReference(relativePath);

      if (markdownImage) {
        markdownImages.push(markdownImage);
      }
    } catch (error) {
      console.warn("[editor] Image reference insertion failed.", error);
    }
  }

  if (markdownImages.length === 0) {
    return;
  }

  const currentText = view.state.doc.toString();
  const text = insertionText(markdownImages, currentText, position);

  view.dispatch({
    changes: { from: position, insert: text },
    selection: { anchor: position + text.length },
    scrollIntoView: true
  });
}

function imageReferenceFromDataTransfer(dataTransfer: DataTransfer | null, workspaceSessionId?: string) {
  if (!dataTransfer || !workspaceSessionId || !Array.from(dataTransfer.types).includes(imageReferenceDragMimeType)) {
    return null;
  }

  return readImageReferenceDragPayload(dataTransfer.getData(imageReferenceDragMimeType), workspaceSessionId);
}

export function imageDropPasteExtension({
  insertImage,
  insertImageReference,
  workspaceSessionId
}: ImageDropPasteOptions) {
  return EditorView.domEventHandlers({
    dragover(event) {
      if (
        insertImageReference &&
        workspaceSessionId &&
        Array.from(event.dataTransfer?.types ?? []).includes(imageReferenceDragMimeType)
      ) {
        event.preventDefault();

        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }

        return true;
      }

      return false;
    },
    drop(event, view) {
      const imageReferencePayload = imageReferenceFromDataTransfer(event.dataTransfer ?? null, workspaceSessionId);

      if (imageReferencePayload && insertImageReference) {
        event.preventDefault();

        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }

        const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        void insertImageReferences(view, position, [imageReferencePayload.relativePath], insertImageReference);

        return true;
      }

      const files = imageFiles(event.dataTransfer?.files ?? null);

      if (files.length === 0) {
        return false;
      }

      event.preventDefault();
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      void insertImages(view, position, files, insertImage);

      return true;
    },
    paste(event, view) {
      const files = imageFiles(event.clipboardData?.files ?? null);

      if (files.length === 0) {
        return false;
      }

      event.preventDefault();
      void insertImages(view, view.state.selection.main.head, files, insertImage);

      return true;
    }
  });
}
