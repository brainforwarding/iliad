import { malformedProviderResponseError, providerStatusError } from "../errors.js";
import type { OpenAiResponse } from "./types.js";
import { isRecord } from "./utils.js";

export function responseText(response: OpenAiResponse) {
  if (response.output_text) {
    return response.output_text;
  }

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

export function parseOpenAiResponse(payload: unknown): OpenAiResponse {
  if (!isRecord(payload)) {
    throw malformedProviderResponseError();
  }

  return payload as OpenAiResponse;
}

export async function readOpenAiResponse(response: Response) {
  try {
    return parseOpenAiResponse(await response.json());
  } catch (error) {
    if (!response.ok) {
      throw providerStatusError(response.status);
    }

    throw error;
  }
}
