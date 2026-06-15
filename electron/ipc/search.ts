import { ipcMain } from "electron";
import {
  searchMarkdownContent,
  type MarkdownContentSearchRequest,
  type MarkdownContentSearchResponse
} from "../fs/contentSearch.js";

export function registerSearchIpc() {
  ipcMain.handle(
    "file:search-markdown-content",
    async (_event, request: MarkdownContentSearchRequest): Promise<MarkdownContentSearchResponse> => {
      return searchMarkdownContent(request);
    }
  );
}
