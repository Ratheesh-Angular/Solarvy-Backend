import OpenAI from "openai";

let client = null;

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Add it to the backend environment.",
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}

export function getOpenAiModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.5";
}

/**
 * Vision / document call that must return a JSON object string.
 * Images use chat.completions; PDFs use Responses API file input when available.
 */
export async function completeVisionJson({
  systemPrompt,
  userPrompt,
  mediaBase64,
  mimeType,
  fileName = "bill",
}) {
  const openai = getClient();
  const model = getOpenAiModel();
  const isPdf =
    mimeType === "application/pdf" ||
    String(fileName).toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return completePdfJson({
      openai,
      model,
      systemPrompt,
      userPrompt,
      mediaBase64,
      fileName,
    });
  }

  const response = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${mediaBase64}`,
            },
          },
        ],
      },
    ],
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI returned an empty vision response");
  }
  return content;
}

async function completePdfJson({
  openai,
  model,
  systemPrompt,
  userPrompt,
  mediaBase64,
  fileName,
}) {
  // Prefer Responses API file input for PDFs (document understanding, not OCR libs).
  if (typeof openai.responses?.create === "function") {
    const response = await openai.responses.create({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: userPrompt },
            {
              type: "input_file",
              filename: fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`,
              file_data: `data:application/pdf;base64,${mediaBase64}`,
            },
          ],
        },
      ],
      text: { format: { type: "json_object" } },
    });

    const text =
      response.output_text ||
      response.output
        ?.flatMap((item) => item.content || [])
        ?.filter((part) => part.type === "output_text")
        ?.map((part) => part.text)
        ?.join("") ||
      null;

    if (!text) {
      throw new Error("OpenAI returned an empty PDF analysis response");
    }
    return text;
  }

  throw new Error(
    "PDF bill analysis requires OpenAI Responses API support. Upload an image of the bill instead.",
  );
}
