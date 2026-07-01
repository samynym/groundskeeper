export const curves = [
  {
    slug: "hip-arthroscopy-fai", urlSlug: "hip-arthroscopy-recovery-timeline",
    displayName: "Hip arthroscopy (FAI)", timelineName: "Hip arthroscopy recovery timeline",
    bodyRegion: "hip", painGrade: "yellow", milestoneGrade: "yellow", confidence: "high", milestones: [],
    painBand: [
      { week: 0, low: 4, typical: 5, high: 7.4, basis: "measured", nativeScale: "0-10; Cunningham PMC5721367", converted: false, sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/" },
      { week: 12, low: 1, typical: 2, high: 3, basis: "interpolated", nativeScale: "interpolated", converted: false, sourceUrl: "" },
      { week: 6, low: 2, typical: 3, high: 4, basis: "interpolated", nativeScale: "interpolated wk2-wk12", converted: false, sourceUrl: "" },
    ],
    sources: [{ title: "Cunningham 2017 cohort", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/", tier: "cohort", reliabilityScore: 7.5 }],
    disclaimer: "Educational, not medical advice.", lastReviewed: "2026-06-01",
  },
];
export function getProcedureCurve(slug: string) { return curves.find((c) => c.slug === slug) ?? null; }
