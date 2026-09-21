import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIntelligencePrompt,
  parseIntelligenceJson,
} from "./prompt";

describe("intelligence prompt", () => {
  it("grounds the prompt in issue body and repo metadata", () => {
    const prompt = buildIntelligencePrompt({
      repoFullName: "octo/hello",
      issueNumber: 12,
      issueTitle: "Fix the widget",
      issueBody: "Steps: reproduce, patch handleWidget.",
      repo: {
        description: "Tiny widget library",
        language: "TypeScript",
        languages: ["TypeScript", "CSS"],
        readmeBlurb: "# Hello\nA widget lib.",
      },
    });
    assert.match(prompt, /octo\/hello/);
    assert.match(prompt, /#12/);
    assert.match(prompt, /handleWidget/);
    assert.match(prompt, /Tiny widget library/);
    assert.match(prompt, /TypeScript, CSS/);
    assert.match(prompt, /widget lib/);
    assert.match(prompt, /exactly one of S, M, L/);
  });

  it("parses JSON and fenced JSON, rejecting bad complexity", () => {
    assert.deepEqual(
      parseIntelligenceJson(
        '{"repoAbout":"A lib","languageStack":"TypeScript","complexity":"m"}',
      ),
      { repoAbout: "A lib", languageStack: "TypeScript", complexity: "M" },
    );
    assert.deepEqual(
      parseIntelligenceJson(
        "```json\n{\"repoAbout\":\"A lib\",\"languageStack\":\"Go\",\"complexity\":\"L\"}\n```",
      ),
      { repoAbout: "A lib", languageStack: "Go", complexity: "L" },
    );
    assert.equal(
      parseIntelligenceJson(
        '{"repoAbout":"A lib","languageStack":"TS","complexity":"XL"}',
      ),
      null,
    );
    assert.equal(parseIntelligenceJson("not json"), null);
  });
});
