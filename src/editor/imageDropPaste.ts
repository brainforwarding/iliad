import { EditorView } from "@codemirror/view";

type InsertImage = (file: File) => Promise<string>;

function imageFiles(fileList: FileList | null) {
  return Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
}

function insertionText(markdownImages: string[], currentText: string, position: number) {
  const prefix = position > 0 && currentText.slice(position - 1, position) !== "\n" ? "\n\n" : "";
  const suffix = position < currentText.length && currentText.slice(position, position + 1) !== "\n" ? "\n\n" : "\n";

  return `${prefix}${markdownImages.join("\n\n")}${suffix}`;
}

async function insertImages(view: EditorView, position: number, files: File[], insertImage: InsertImage) {
  const markdownImages = await Promise.all(files.map((file) => insertImage(file)));
  const currentText = view.state.doc.toString();
  const text = insertionText(markdownImages, currentText, position);

  view.dispatch({
    changes: { from: position, insert: text },
    selection: { anchor: position + text.length },
    scrollIntoView: true
  });
}

export function imageDropPasteExtension(insertImage: InsertImage) {
  return EditorView.domEventHandlers({
    drop(event, view) {
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
