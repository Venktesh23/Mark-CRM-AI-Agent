export interface MockEmail {
  id: string;
  subject: string;
  htmlContent: string;
  summary: {
    targetGroup: string;
    regionalAdaptation: string;
    toneDecision: string;
    legalConsiderations: string;
  };
}

export type GeneratedEmail = MockEmail;

const BASE_EMAILS: MockEmail[] = [
  {
    id: "email-1",
    subject: "Spring launch offer for active customers",
    htmlContent:
      "<!DOCTYPE html><html><body style='font-family:Arial,sans-serif'><h1>Spring Launch Offer</h1><p>Use code SPRING30 to get 30 percent off selected items.</p></body></html>",
    summary: {
      targetGroup: "Loyal customers with recent purchases",
      regionalAdaptation: "EU-compliant footer and unsubscribe links included",
      toneDecision: "Direct and clear with a value-first call to action",
      legalConsiderations: "GDPR notice and unsubscribe requirement included",
    },
  },
  {
    id: "email-2",
    subject: "New collection preview for style-focused shoppers",
    htmlContent:
      "<!DOCTYPE html><html><body style='font-family:Arial,sans-serif'><h1>New Collection</h1><p>Explore the latest arrivals and featured products curated for this season.</p></body></html>",
    summary: {
      targetGroup: "New subscribers aged 25-40",
      regionalAdaptation: "North America shipping copy and pricing context",
      toneDecision: "Aspirational, product-forward messaging",
      legalConsiderations: "CAN-SPAM basics included",
    },
  },
];

export async function generateLocalCampaign(prompt: string): Promise<MockEmail[]> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const safePrompt = prompt.trim() || "Campaign";
  return BASE_EMAILS.map((email, index) => ({
    ...email,
    id: `email-${index + 1}`,
    subject: `${email.subject} - ${safePrompt.slice(0, 30)}`,
  }));
}

export async function editLocalEmail(currentHtml: string, instructions: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const safeInstruction = instructions.trim();
  if (!safeInstruction) return currentHtml;
  return currentHtml.replace(
    "</body>",
    `<p style='font-size:12px;color:#555'>Editor note: ${safeInstruction}</p></body>`
  );
}

export async function recommendLocalRecipients(
  emailIds: string[],
  contactsCsv: string
): Promise<Record<string, string[]>> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const lines = contactsCsv.split("\n").slice(1);
  const contacts = lines
    .map((line) => line.split(",")[2]?.trim())
    .filter((email): email is string => Boolean(email && email.includes("@")));
  const deduped = Array.from(new Set(contacts));
  const assignments: Record<string, string[]> = {};
  emailIds.forEach((id, idx) => {
    assignments[id] = deduped.filter((_, contactIdx) => contactIdx % emailIds.length === idx);
  });
  return assignments;
}
