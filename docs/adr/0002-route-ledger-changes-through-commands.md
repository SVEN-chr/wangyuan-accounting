# Route ledger changes through one command interface

All changes to a ledger will pass through one pure domain command interface instead of pages coordinating `records`, `categories`, and `openingBalance` setters directly. The module will own validation, identifier collision handling, category deletion effects, imported-ledger replacement, and every other ledger invariant; React will submit intentions and render the returned ledger or error. This adds an explicit command vocabulary, but gives callers one small seam and makes complete ledger behaviour testable without React or storage.
