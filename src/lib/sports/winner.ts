export function deriveWinner(
  homeScore: number,
  awayScore: number
): "HOME" | "AWAY" | "PUSH" {
  if (homeScore > awayScore) return "HOME";
  if (awayScore > homeScore) return "AWAY";
  return "PUSH";
}
