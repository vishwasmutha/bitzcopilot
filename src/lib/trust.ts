export type Receipt = {
  title: string;
  status: "computed" | "insufficient";
  headline: string;
  steps: { label: string; detail: string }[];
  caveat?: string;
};

export function insufficient(title: string, why: string): Receipt {
  return {
    title,
    status: "insufficient",
    headline: "Not enough history",
    steps: [{ label: "Why this is withheld", detail: why }],
    caveat: "No number was guessed to fill the gap.",
  };
}
