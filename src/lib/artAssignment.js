function normalizeArtText(value) {
  return String(value || '').trim();
}

export const DEFAULT_ART_ASSIGNMENT_TITLE = '미술 감상 과제';
export const DEFAULT_STUDENT_ART_TITLE = '미술 감상';
export const DEFAULT_ART_REFERENCE_LABEL = '작품 이미지';

export function buildArtAssignmentTitle(values = {}) {
  const title = normalizeArtText(values.title);
  if (title) {
    return title;
  }

  const paintingTitle = normalizeArtText(values.paintingTitle);
  const artist = normalizeArtText(values.artist);

  if (paintingTitle && artist) {
    return `${paintingTitle} - ${artist}`;
  }

  if (paintingTitle) {
    return paintingTitle;
  }

  if (artist) {
    return `${artist} 작품 감상`;
  }

  return DEFAULT_ART_ASSIGNMENT_TITLE;
}

export function buildArtAssignmentContent(values = {}) {
  const paintingTitle = normalizeArtText(values.paintingTitle);
  const artist = normalizeArtText(values.artist);
  const year = normalizeArtText(values.year);
  const details = [];

  if (paintingTitle) {
    details.push(paintingTitle);
  }

  const attribution = [artist, year].filter(Boolean).join(', ');
  if (attribution) {
    details.push(attribution);
  }

  if (details.length === 0) {
    return DEFAULT_ART_ASSIGNMENT_TITLE;
  }

  return `미술 감상 과제: ${details.join(' / ')}`;
}

export function getStudentFacingArtTitle(assignment) {
  return normalizeArtText(assignment?.paintingTitle) || DEFAULT_STUDENT_ART_TITLE;
}

export function getArtReferenceLabel(assignment) {
  return normalizeArtText(assignment?.paintingTitle) || DEFAULT_ART_REFERENCE_LABEL;
}

export function getStudentFacingArtAttribution(assignment) {
  const artist = normalizeArtText(assignment?.artist);
  const year = normalizeArtText(assignment?.year);

  return [artist, year].filter(Boolean).join(', ');
}

export function getArtPromptPaintingInfoLines(assignment) {
  const paintingTitle = normalizeArtText(assignment?.paintingTitle);
  const artist = normalizeArtText(assignment?.artist);
  const year = normalizeArtText(assignment?.year);

  return [
    paintingTitle ? `작품명: ${paintingTitle}` : null,
    artist ? `작가: ${artist}` : null,
    year ? `제작 연도: ${year}` : null,
  ].filter(Boolean);
}
