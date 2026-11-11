/** Only provider pipeline checkpoints take part in ranking; manual claims are state. */
const PIPELINE_STEPS = ['dispatch_authorized', 'client-started', 'info-inserted', 'creating', 'sent'] as const;
export type DocumentJobPipelineStep = typeof PIPELINE_STEPS[number];

export function documentJobPipelineStep(job: { progressStep?: string | null; progressDetail?: string | null }): DocumentJobPipelineStep | undefined {
  const stepIndex = PIPELINE_STEPS.findIndex(step => step === job.progressStep);
  const detailIndex = PIPELINE_STEPS.findIndex(step => step === job.progressDetail);
  return PIPELINE_STEPS[Math.max(stepIndex, detailIndex)];
}
