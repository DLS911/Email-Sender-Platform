// Experiment framework primitives — implementations land per spec 07.
// Type surface defined here so downstream callers can plan against it.

export type ExperimentType =
  | "framework"
  | "content"
  | "subject_line"
  | "send_time"
  | "cta"
  | "segment_variant";

export type Experiment = {
  id: string;
  brandId: string;
  name: string;
  experimentType: ExperimentType;
  hypothesis: string;
  successMetric: string;
  status: "proposed" | "approved" | "running" | "concluded" | "cancelled";
};

export type ExperimentVariant = {
  id: string;
  experimentId: string;
  variantName: string;
  variantDefinition: Record<string, unknown>;
  trafficAllocationPct: number;
};
