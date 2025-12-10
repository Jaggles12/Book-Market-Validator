// server/audience.ts

import { AudienceProfile } from "./types";

/**
 * Heuristic audience profiler.
 *
 * Goal: give us a reasonably accurate AudienceProfile
 * WITHOUT needing an extra OpenAI call (cheap & fast).
 *
 * Inputs:
 *  - idea: the raw user idea text
 *  - projectType: "fiction" | "nonfiction" (from UI)
 */
export function getAudienceProfile(
  idea: string,
  projectType: "fiction" | "nonfiction"
): AudienceProfile {
  const text = idea.toLowerCase();

  // -----------------------
  // 1) Age group
  // -----------------------
  let ageGroup: AudienceProfile["ageGroup"] = "adult";

  if (
    /toddler|preschool|ages?\s*0-3|ages?\s*3-5|board book|picture book|bedtime story/.test(
      text
    )
  ) {
    ageGroup = "kids";
  } else if (
    /kids|children|childhood|middle grade|ages?\s*6-8|ages?\s*8-12/.test(text)
  ) {
    ageGroup = "kids";
  } else if (
    /teen|teenager|high school|young adult|ya\b/.test(text)
  ) {
    // We distinguish "teens" vs "young_adult" a bit,
    // but treat them similarly for now.
    if (/young adult|ya\b/.test(text)) {
      ageGroup = "young_adult";
    } else {
      ageGroup = "teens";
    }
  } else {
    // Default to adult
    ageGroup = "adult";
  }

  // -----------------------
  // 2) Life stage
  // -----------------------
  let lifeStage: AudienceProfile["lifeStage"] = "unspecified";

  if (/parent|parents|moms|dads|mother|father|families|family/.test(text)) {
    lifeStage = "parents";
  } else if (/college|university|students?\b|campus/.test(text)) {
    lifeStage = "students";
  } else if (/retiree|retirement|seniors?|older adults?|over 60|over sixty/.test(text)) {
    lifeStage = "retirees";
  } else if (
    projectType === "nonfiction" &&
    /career|business|workplace|professionals?|managers?|leaders?/.test(text)
  ) {
    lifeStage = "professionals";
  }

  // -----------------------
  // 3) Experience level
  // -----------------------
  let experienceLevel: AudienceProfile["experienceLevel"] = "unspecified";

  if (
    /for beginners|beginner(?!'s)|newbie|no experience|from scratch|for dummies|intro(duction)? to\b/.test(
      text
    )
  ) {
    experienceLevel = "beginner";
  } else if (/advanced|expert|masterclass|for pros|seasoned/.test(text)) {
    experienceLevel = "advanced";
  } else if (/intermediate|some experience|already.*know/.test(text)) {
    experienceLevel = "intermediate";
  }

  // -----------------------
  // 4) Primary gender focus
  // -----------------------
  let primaryGenderFocus: AudienceProfile["primaryGenderFocus"] = "unspecified";

  if (/for women|for moms|for wives|busy moms|christian women/.test(text)) {
    primaryGenderFocus = "women";
  } else if (/for men|for dads|for husbands|christian men/.test(text)) {
    primaryGenderFocus = "men";
  } else if (/couples|families|parents/.test(text)) {
    // Mixed by implication
    primaryGenderFocus = "mixed";
  }

  const profile: AudienceProfile = {
    ageGroup,
    lifeStage,
    experienceLevel,
    primaryGenderFocus,
  };

  return profile;
}

/**
 * Infer a rough audience hint from Amazon category names.
 *
 * This is meant to be used when normalizing Rainforest results,
 * so you can set book.audienceHint = inferAudienceHintFromCategories(...)
 * and then compare that to the overall AudienceProfile.
 */
export function inferAudienceHintFromCategories(
  rawCategories?: string[]
): AudienceProfile["ageGroup"] {
  if (!rawCategories || rawCategories.length === 0) {
    return "unsure";
  }

  const joined = rawCategories.join(" | ").toLowerCase();

  if (/teen|young adult|ya\b/.test(joined)) {
    return "teens";
  }

  if (/children|kids|juvenile|middle grade/.test(joined)) {
    return "kids";
  }

  // Some categories explicitly say "Adult" in certain verticals
  if (/adult/.test(joined)) {
    return "adult";
  }

  // If it's clearly professional / business / self-help / serious nonfiction,
  // we bias toward adult.
  if (
    /business & money|self-help|personal finance|leadership|management|productivity|parenting/.test(
      joined
    )
  ) {
    return "adult";
  }

  // For most remaining general "Books" / "Literature & Fiction" categories,
  // assume adult unless forced otherwise.
  if (/literature & fiction|mystery|thriller|romance|science fiction|fantasy/.test(joined)) {
    return "adult";
  }

  return "unsure";
}
