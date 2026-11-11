import { documentJobPipelineStep } from '../progress-step';

test.each([
  ['dispatch_authorized', 'info-inserted', 'info-inserted'],
  ['sent', 'client-started', 'sent'],
  ['unknown', 'creating', 'creating'],
  ['manual_in_progress:42:expiry', 'info-inserted', 'info-inserted'],
  ['dispatch_authorized', 'manual_in_progress', 'dispatch_authorized'],
  ['client-started', null, 'client-started'],
  ['creating', undefined, 'creating'],
  [null, 'unknown', undefined],
  [undefined, undefined, undefined],
])('ranks only known checkpoints for %s and %s', (progressStep, progressDetail, expected) => {
  expect(documentJobPipelineStep({ progressStep, progressDetail })).toBe(expected);
});
