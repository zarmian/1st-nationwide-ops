/** The detail page of a job, patrol visit or static / dog-handler shift —
 *  where clicking that activity anywhere in the app takes you. */
export function activityHref(kind: string, id: string): string {
  switch (kind.toLowerCase()) {
    case "visit":
    case "patrol_visit":
      return `/patrols/visits/${id}`;
    case "shift":
      return `/shifts/${id}`;
    default:
      return `/dispatch/${id}`;
  }
}
