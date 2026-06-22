/**
 * Returns a sorted tuple [a, b] where a < b (lexicographic UUID comparison).
 * Use this when inserting into tables that enforce ordered-pair CHECK constraints
 * (matches, conversations, relationships).
 *
 * @example
 *   const [acA, acB] = orderedPair(aliceId, bobId)
 *   db.insert(matches).values({ accountAId: acA, accountBId: acB })
 */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}
