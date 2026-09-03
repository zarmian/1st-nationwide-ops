/**
 * User-facing label for a UserRole. The DB enum value stays DISPATCHER
 * (schema, auth, queries all use it), but the business calls that role
 * "Office" — control-room staff, not field officers — so that's what we
 * show people. Everything else maps to its natural title.
 */
export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "DISPATCHER":
      return "Office";
    case "OFFICER":
      return "Officer";
    case "PARTNER":
      return "Partner";
    case "PARTNER_OFFICER":
      return "Partner officer";
    case "CUSTOMER":
      return "Customer";
    default:
      return role ?? "—";
  }
}
