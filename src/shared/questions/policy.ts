/**
 * Every threshold the routing reads.
 *
 * Kept in its own module so the platform question files and the scorer can both import it
 * without a cycle.
 *
 * A threshold is only meaningful against the scale it was fitted to. If the scorer
 * changes, every number here has to be re-derived from a measurement run — carrying them
 * across is meaningless, not conservative.
 */
export interface Policy {
  /** Composite at or above which a post is hidden. */
  hideAt: number;
  /** Composite at or above which a post is blurred but recoverable in one click. */
  collapseAt: number;
  /** A single signal this strong hides the post on its own. */
  hardSignalAt: number;
  /** Which signals are allowed to trigger the hard rule. */
  hardSignals: string[];
  /** An interest noul at or above this highlights the post. */
  interestAt: number;
  /** An excluded-topic noul at or above this hides the post regardless of quality. */
  excludeAt: number;
}
