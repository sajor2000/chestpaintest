import { createAzure } from "@ai-sdk/azure";

const deployment = process.env.CDS_AZURE_DEPLOYMENT;
const apiVersion = process.env.CDS_AZURE_API_VERSION;
const endpoint = process.env.CDS_AZURE_ENDPOINT;
const apiKey = process.env.CDS_AZURE_KEY;

if (!deployment || !apiVersion || !endpoint || !apiKey) {
  throw new Error(
    "Missing required env vars: CDS_AZURE_KEY, CDS_AZURE_ENDPOINT, CDS_AZURE_DEPLOYMENT, CDS_AZURE_API_VERSION"
  );
}

if (!/^[a-zA-Z0-9._-]{1,64}$/.test(deployment)) {
  throw new Error(`Invalid CDS_AZURE_DEPLOYMENT: ${deployment}`);
}

const azure = createAzure({
  baseURL: endpoint,
  apiKey,
  apiVersion,
  fetch: async (url, options) => {
    const raw = String(url);
    const fixed = raw.replace(
      /\/deployments\/v1\//,
      `/deployments/${deployment}/`
    );
    if (fixed !== raw) {
      console.warn("[azure] Applied /v1/ URL fix →", fixed.split("?")[0]);
    }
    return globalThis.fetch(fixed, options);
  },
});

export const model = azure.chat(deployment);
