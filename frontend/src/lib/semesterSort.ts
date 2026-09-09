const seasonOrder: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  fall: 3,
  autumn: 3,
};

function semesterRank(semester: string): number | undefined {
  const year = semester.match(/\b(?:19|20)\d{2}\b/);
  const season = semester.match(/\b(winter|spring|summer|fall|autumn)\b/i);

  if (!year || !season) {
    return undefined;
  }

  return Number(year[0]) * 4 + seasonOrder[season[0].toLowerCase()];
}

/** Newest semesters first; preserve source order for undated terms at the end. */
export function compareSemestersNewestFirst(first: string, second: string): number {
  const firstRank = semesterRank(first);
  const secondRank = semesterRank(second);

  if (firstRank === undefined) return secondRank === undefined ? 0 : 1;
  if (secondRank === undefined) return -1;
  return secondRank - firstRank;
}
