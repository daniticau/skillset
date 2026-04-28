import { describe, expect, it } from "vitest";
import {
  normalizeOrthogonalSearch,
  renderDiscoverSkill,
} from "../src/discover/orthogonal.js";

const RESPONSE = {
  success: true,
  results: [
    {
      name: "Apollo.io",
      slug: "apollo",
      endpoints: [
        {
          path: "/v1/people/match",
          method: "POST",
          description: "Enrich a person by email, name, or LinkedIn URL",
          price: "0.03",
          verified: true,
          score: 0.95,
        },
        {
          path: "/bad",
          method: "POST",
          verified: true,
          score: 0.99,
        },
      ],
    },
    {
      name: "Hunter.io",
      slug: "hunter",
      endpoints: [
        {
          path: "/domain-search",
          method: "POST",
          description: "Find email addresses for a company domain",
          price: "0.01",
          verified: false,
          score: 0.85,
        },
      ],
    },
  ],
};

describe("Orthogonal discovery", () => {
  it("flattens grouped API search results into verified endpoint candidates", () => {
    const candidates = normalizeOrthogonalSearch(RESPONSE, {
      query: "find lead emails",
      max: 10,
      minScore: 0.5,
      includeUnverified: false,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      provider: "orthogonal",
      apiSlug: "apollo",
      apiName: "Apollo.io",
      endpointPath: "/v1/people/match",
      endpointMethod: "POST",
      description: "Enrich a person by email, name, or LinkedIn URL",
      price: "0.03",
      verified: true,
      score: 0.95,
      skillName: "orthogonal-apollo-post-v1-people-match",
    });
  });

  it("filters by score, includes unverified when requested, and enforces max", () => {
    const candidates = normalizeOrthogonalSearch(RESPONSE, {
      query: "find lead emails",
      max: 1,
      minScore: 0.8,
      includeUnverified: true,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.apiSlug).toBe("apollo");
  });

  it("renders a conservative low-tier draft skill with cost guardrails", () => {
    const [candidate] = normalizeOrthogonalSearch(RESPONSE, {
      query: "find lead emails",
      max: 1,
      minScore: 0.5,
      includeUnverified: false,
    });

    const skill = renderDiscoverSkill(candidate!, "find lead emails");

    expect(skill.name).toBe("orthogonal-apollo-post-v1-people-match");
    expect(skill.tier).toBe("low");
    expect(skill.origin).toBe("auto-created");
    expect(skill.body).toContain("ORTHOGONAL_API_KEY");
    expect(skill.body).toContain("apollo");
    expect(skill.body).toContain("/v1/people/match");
    expect(skill.body).toContain("POST");
    expect(skill.body).toContain("Price: 0.03");
    expect(skill.body).toContain("Do not call paid APIs unless");
  });
});
