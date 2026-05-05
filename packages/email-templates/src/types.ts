export type RenderResult = {
  html: string;
  text: string;
  subject: string;
  preheader: string;
};

export type WeekdaySection = {
  name: string;
  body: string;
};

export type WeekdayInput = {
  brandName: string;
  brandSlug: string;
  episodeId: string;
  headline: string;
  preheader: string;
  contentType: string;
  formatStyle?: string | undefined;
  sections: WeekdaySection[];
  unsubscribeUrl: string;
  webArchiveUrl?: string | undefined;
  /** Optional tracking params appended to every link for section attribution. */
  trackingParams?: Record<string, string> | undefined;
};

export type WeekendSection =
  | { kind: "cover_story"; openingHook: string; body: string }
  | { kind: "tasting_menu"; items: Array<{ title: string; summary: string; url?: string }> }
  | { kind: "hosts_corner"; body: string }
  | { kind: "the_drive"; pick: string; rationale: string };

export type WeekendInput = {
  brandName: string;
  brandSlug: string;
  episodeId: string;
  headline: string;
  preheader: string;
  contentType: string;
  sections: WeekendSection[];
  unsubscribeUrl: string;
  webArchiveUrl?: string | undefined;
  trackingParams?: Record<string, string> | undefined;
};
