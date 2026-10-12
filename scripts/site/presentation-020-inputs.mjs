// A separate synthetic pilot; the cloud story and its adapter remain unchanged.
export const brief = {
  version: "1.0", topic: "From draft to human approval",
  audience: { role: "Engineering leads testing a presentation review workflow", knowledge: "informed",
    priorities: ["Clear ownership", "Evidence before approval", "Reversible changes"] },
  outcome: "Choose a small, human-reviewed pilot rather than treating a generated draft as approved.",
  language: "en", tone: "executive", context: "live", desiredSlides: 3,
  ideas: ["Inspect the draft", "Keep input, draft and approval distinct", "A process check is not real consent"],
  allowRestructure: false,
  outline: [
    { slideId: "inspect", instruction: "Explain why the draft needs inspection" },
    { slideId: "handoff", instruction: "Explain the input-to-draft-to-approval handoff" },
    { slideId: "decision", instruction: "Ask for one reversible pilot with explicit human approval" }
  ],
  sources: [{ id: "synthetic-workflow", title: "Synthetic review workflow",
    kind: "synthetic", note: "An authored process proposal, not customer data or evidence of actual approval." }],
  facts: []
};

const scene = (id, description, semantic) => ({
  provider: "stickman-020", staticDescription: description,
  cues: [{ id, semantic, effect: "perform", fromBeat: 0, untilBeat: 1, propIds: ["review-artifact"] }]
});
const leaf = ref => ({ kind: "element", ref });
export const storyboard = {
  version: "1.0", deckId: "review-handoff-020", title: "From draft to human approval",
  pilotIds: ["inspect", "handoff", "decision"],
  slides: [
    {
      id: "inspect", purpose: "Separate a useful first draft from approval.", layout: "framing",
      eyebrow: "01 · Inspect", takeaway: "A useful draft still needs a human review.", headlineKind: "proposal",
      composition: { kind: "row", weights: [3, 2], gap: 32, children: [
        { kind: "column", gap: 24, children: [leaf("claims"), leaf("visuals")] }, leaf("scene")
      ] },
      blocks: [
        { id: "claims", label: "Check the argument", body: "Verify claims, sources and what remains unknown.", claim: "proposal" },
        { id: "visuals", label: "Check the experience", body: "Watch motion. Read the static version. Look for collisions.", claim: "proposal" }
      ], beats: [],
      scene: scene("inspect-draft", "The reviewer inspects a draft sheet. Generated content is not yet approved.",
        "Inspect the draft before trusting it."),
      notes: "Synthetic demonstration. The actor inspects a tablet; this does not establish factual accuracy."
    },
    {
      id: "handoff", purpose: "Show an ordered proposal with an explicit human approval boundary.", layout: "process",
      eyebrow: "02 · Handoff", takeaway: "Move the draft forward, not the approval boundary.", headlineKind: "proposal",
      composition: { kind: "column", weights: [3, 1], gap: 24, children: [
        leaf("scene"), { kind: "row", gap: 24, children: [leaf("input"), leaf("draft"), leaf("approval")] }
      ] },
      blocks: [
        { id: "input", label: "Input", body: "Supply scope and evidence.", claim: "proposal" },
        { id: "draft", label: "Draft", body: "Generate, inspect and repair.", claim: "proposal" },
        { id: "approval", label: "Approval", body: "A person reviews this revision.", claim: "proposal" }
      ], beats: [],
      scene: {
        ...scene("compare-revisions", "Proposed sequence: input, draft, then human approval. A process check is not real consent.",
          "Compare the supplied input with the generated draft."),
        flow: { stages: ["Input", "Draft", "Human approval"], choreography: "handoff" },
        cues: [
          { id: "native-handoff", semantic: "A proposed handoff turns input into a draft for human review.",
            effect: "flow", fromBeat: 0, untilBeat: 1, propIds: [] },
          ...scene("compare-revisions", "", "Compare input and draft.").cues
        ]
      },
      notes: "The graphical check describes a proposed workflow only. No user consent, factual verification or quality score is implied."
    },
    {
      id: "decision", purpose: "Finish with a reversible action and an unresolved human decision.", layout: "recommendation",
      eyebrow: "03 · Decide", takeaway: "Pilot one small change before expanding.", headlineKind: "proposal",
      composition: { kind: "row", weights: [2, 3], gap: 32, children: [
        leaf("scene"), { kind: "column", gap: 24, children: [leaf("pilot"), leaf("stop")] }
      ] },
      blocks: [
        { id: "pilot", label: "The next action", body: "Choose the scope, review this revision and keep rollback.", claim: "proposal", emphasis: true },
        { id: "stop", label: "The stop condition", body: "If evidence is missing, repair the draft. Do not infer approval.", claim: "proposal" }
      ], beats: [],
      scene: scene("review-decision", "The reviewer considers an evidence sheet. Human approval is still pending.",
        "Review the evidence before authorizing the next step."),
      notes: "Owner, deadline and approval remain open. This is a private test, not a publication or customer deployment."
    }
  ]
};
