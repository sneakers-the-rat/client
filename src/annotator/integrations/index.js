import { HTMLIntegration } from './html';
import { PDFIntegration, isPDF } from './pdf';
import {
  VitalSourceContentIntegration,
  VitalSourceContainerIntegration,
  vitalSourceFrameRole,
} from './vitalsource';

/**
 * @typedef {import('../../types/annotator').Annotator} Annotator
 * @typedef {import('../../types/annotator').Integration} Integration
 */

/**
 * Create the integration that handles document-type specific aspects of
 * guest functionality.
 *
 * @param {Annotator} annotator
 * @param {string|null} frameIdentifier
 * @return {[Integration, boolean]} - the second element in the tuple indicates
 *   if the frame holds the main annotatable content.
 */
export function createIntegration(annotator, frameIdentifier) {
  if (isPDF()) {
    return [new PDFIntegration(annotator), true];
  }

  const vsFrameRole = vitalSourceFrameRole();
  if (vsFrameRole === 'container') {
    return [new VitalSourceContainerIntegration(annotator), false];
  } else if (vsFrameRole === 'content') {
    return [new VitalSourceContentIntegration(), true];
  }

  return [new HTMLIntegration(), frameIdentifier === null];
}
