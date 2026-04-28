import type { SynthesizedSkill } from "../mine/synthesize.js";

export const DEFAULT_ORTHOGONAL_BASE_URL = "https://api.orthogonal.com";

export interface DiscoverCandidate {
  provider: "orthogonal";
  apiSlug: string;
  apiName: string;
  endpointPath: string;
  endpointMethod: string;
  description: string;
  price?: string;
  verified?: boolean;
  score?: number;
  sourceUrl: string;
  skillName: string;
}

export interface NormalizeOptions {
  query: string;
  max: number;
  minScore: number;
  includeUnverified: boolean;
}

export interface OrthogonalSearchOptions extends NormalizeOptions {
  apiKey: string;
  baseUrl?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function booleanField(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === "boolean" ? v : undefined;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, "")
    .replace(/\//g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function candidateName(apiSlug: string, method: string, path: string): string {
  const pathSlug = slugify(path) || "endpoint";
  return slugify(`orthogonal ${apiSlug} ${method} ${pathSlug}`) || "orthogonal-api";
}

function priceString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function sourceUrl(apiSlug: string): string {
  return `https://orthogonal.com/catalog/${encodeURIComponent(apiSlug)}`;
}

export function normalizeOrthogonalSearch(
  raw: unknown,
  options: NormalizeOptions
): DiscoverCandidate[] {
  if (!isRecord(raw) || !Array.isArray(raw.results)) return [];

  const out: DiscoverCandidate[] = [];
  for (const api of raw.results) {
    if (!isRecord(api)) continue;
    const apiSlug = stringField(api, "slug");
    const apiName = stringField(api, "name") ?? apiSlug;
    if (!apiSlug || !apiName || !Array.isArray(api.endpoints)) continue;

    for (const endpoint of api.endpoints) {
      if (!isRecord(endpoint)) continue;
      const endpointPath = stringField(endpoint, "path");
      const endpointMethod = stringField(endpoint, "method")?.toUpperCase();
      const description = stringField(endpoint, "description");
      if (!endpointPath || !endpointMethod || !description) continue;

      const verified = booleanField(endpoint, "verified");
      if (!options.includeUnverified && verified === false) continue;

      const score = numberField(endpoint, "score");
      if (score !== undefined && score < options.minScore) continue;

      out.push({
        provider: "orthogonal",
        apiSlug,
        apiName,
        endpointPath,
        endpointMethod,
        description,
        price: priceString(endpoint.price),
        verified,
        score,
        sourceUrl: sourceUrl(apiSlug),
        skillName: candidateName(apiSlug, endpointMethod, endpointPath),
      });
    }
  }

  return out
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, Math.max(0, Math.min(options.max, 20)));
}

function displayPrice(candidate: DiscoverCandidate): string {
  return candidate.price ? `Price: ${candidate.price} per call.` : "Price: not provided by search.";
}

export function renderDiscoverSkill(
  candidate: DiscoverCandidate,
  query: string
): SynthesizedSkill {
  const verified = candidate.verified === undefined ? "unknown" : String(candidate.verified);
  const score = candidate.score === undefined ? "unknown" : candidate.score.toFixed(2);
  const body = [
    "# Orthogonal API Discovery",
    "",
    `Use Orthogonal when the user asks for live/current/external data that matches: ${candidate.description}.`,
    "",
    "## API",
    "",
    `- Provider: Orthogonal`,
    `- API: ${candidate.apiName} (${candidate.apiSlug})`,
    `- Endpoint: ${candidate.endpointMethod} ${candidate.endpointPath}`,
    `- ${displayPrice(candidate)}`,
    `- Verified: ${verified}`,
    `- Search score: ${score}`,
    `- Source: ${candidate.sourceUrl}`,
    "",
    "## Rules",
    "",
    "- Require `ORTHOGONAL_API_KEY` before using Orthogonal.",
    "- Use the Orthogonal Run API with the API slug and endpoint path above.",
    "- Do not call paid APIs unless the user asked for live/current/external data or explicitly approved cost-bearing work.",
    "- Prefer cached, local, or already-provided data when it satisfies the request.",
    "- If the endpoint needs sensitive input, ask for only the minimum fields required.",
  ].join("\n");

  return {
    name: candidate.skillName,
    description: `Use Orthogonal ${candidate.apiName} ${candidate.endpointMethod} ${candidate.endpointPath} for ${candidate.description}.`,
    body,
    tier: "low",
    origin: "auto-created",
    sourceClusterIds: [],
    score: candidate.score ?? 0,
    memberCount: 1,
    provenance: {
      source: "orthogonal",
      query,
      apiSlug: candidate.apiSlug,
      endpointPath: candidate.endpointPath,
      endpointMethod: candidate.endpointMethod,
      price: candidate.price,
      verified: candidate.verified,
      score: candidate.score,
      discoveredAt: new Date().toISOString(),
    },
  };
}

export async function searchOrthogonal(
  options: OrthogonalSearchOptions
): Promise<DiscoverCandidate[]> {
  const baseUrl = (options.baseUrl ?? DEFAULT_ORTHOGONAL_BASE_URL).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/v1/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: options.query,
      limit: Math.max(1, Math.min(options.max, 20)),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Orthogonal search failed (${response.status}): ${text || response.statusText}`);
  }

  return normalizeOrthogonalSearch(await response.json(), options);
}
