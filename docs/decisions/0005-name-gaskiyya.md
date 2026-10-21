# 0005: The product name is spelled Gaskiyya

Status: accepted (requested by the product owner, 2026-10-05)

## Decision

Everything a person reads spells the name "Gaskiyya": the app's display name,
the customer copy in `packages/schemas/copy.json`, the logo labels, the landing
page, the console title and the docs.

Identifiers keep the old spelling so nothing deployed breaks:

- the token audience `gaskiya`, the Firestore collection prefix `gaskiya_`,
  package and folder names, class names such as `GaskiyaService`;
- the bundle and application IDs registered with Firebase;
- the brand file names (`brand/gaskiya-logo.svg`) and the hosted logo URL.

## Consequences

Two copy.json strings changed wording (`notEnrolled`, `neverAsks`); no verdict
wording changed. Email templates and server messages still say "Gaskiya" and
can follow in a later change.
