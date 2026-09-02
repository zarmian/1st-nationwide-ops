// The client portal and the internal dashboards share one KPI card so every
// headline metric reads identically. The implementation lives in
// @/components/StatCard; this re-export keeps the existing client imports.
export { StatCard, type StatTone } from "@/components/StatCard";
