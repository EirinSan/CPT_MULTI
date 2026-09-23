import { describe, expect, it } from "vitest";
import { eloUpdate, expectedScore, rankInfo, tierForRating } from "../src/rating";

describe("rating", () => {
  it("expected score is symmetric", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
    expect(expectedScore(1400, 1000) + expectedScore(1000, 1400)).toBeCloseTo(1);
  });

  it("maps ratings to tiers", () => {
    expect(tierForRating(0)).toBe("BRONZE");
    expect(tierForRating(1250)).toBe("GOLD");
    expect(tierForRating(2500)).toBe("CCIE");
  });

  it("computes divisions", () => {
    expect(rankInfo(1200).label).toBe("Gold III");
    expect(rankInfo(1399).label).toBe("Gold I");
    expect(rankInfo(1900).label).toBe("Master");
  });

  it("upset wins give more points", () => {
    const upset = eloUpdate({ rating: 1000, gamesPlayed: 50 }, { rating: 1400, gamesPlayed: 50 });
    const expected = eloUpdate({ rating: 1400, gamesPlayed: 50 }, { rating: 1000, gamesPlayed: 50 });
    expect(upset.winnerDelta).toBeGreaterThan(expected.winnerDelta);
    expect(upset.loserDelta).toBeLessThan(0);
  });
});
