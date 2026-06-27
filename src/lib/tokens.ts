import { randomBytes } from "crypto";

/**
 * Unguessable URL-safe token for public per-record links (e.g. the officer
 * duty link at /duty/<token>). 32 bytes of CSPRNG entropy, base64url-encoded
 * (~43 chars). Far beyond brute-forceable; the link is the only credential
 * needed to open that one shift.
 */
export function newPublicToken(): string {
  return randomBytes(32).toString("base64url");
}
