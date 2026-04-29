import { createAzure } from "@ai-sdk/azure";

const deployment = process.env.CDS_AZURE_DEPLOYMENT ?? "gpt-4.1-mini";
const apiVersion = process.env.CDS_AZURE_API_VERSION ?? "2025-01-01-preview";
const endpoint =
  process.env.CDS_AZURE_ENDPOINT ??
  "https://rua-nonprod-ai-innovation.cognitiveservices.azure.com/openai/deployments";
const apiKey = process.env.CDS_AZURE_KEY ?? "";

const azure = createAzure({
  baseURL: endpoint,
  apiKey,
  apiVersion,
  fetch: async (url, options) => {
    // @ai-sdk/azure v6 normalizes cognitiveservices URLs by inserting /v1/
    // Fix: replace /v1/ with the actual deployment name
    const fixed = String(url).replace(
      /\/deployments\/v1\//,
      `/deployments/${deployment}/`
    );
    return globalThis.fetch(fixed, options);
  },
});

export const model = azure.chat(deployment);
