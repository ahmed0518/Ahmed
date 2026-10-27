# Reference: the existing "Production Status by Product" block

This app mirrors a block that today lives inside a private Shopify admin app (Production
Tag). Two screenshots were captured from it.

## Screenshot 1 — `production-status-block.png`

A white card with a light border. Section title **Production Status by Product**. One black
pill per product on the order (here: "Custom Silver 2.5-Inches Pendant - LAB Diamonds"),
white text, fully rounded. Under the pill a full-width select showing the current status
("CAD") with an up/down chevron at the right edge, 1 px grey border, ~12 px radius.

## Screenshot 2 — the open dropdown (native select list)

Options in this exact order; the first entry is the placeholder:

1. Select production status...   ← placeholder, no value
2. CAD   ← was selected (check mark)
3. Assembling
4. Mold
5. Polishing
6. Polishing Erik
7. Polishing Maria
8. Casting
9. Engraving
10. Final Polishing
11. Cleaning Casting
12. Resizing
13. Setting
14. Setting Azavedo
15. Setting Igor
16. Setting Jorje
17. Waiting for DIA
18. Sent to Store
19. Sent to Shipping Dept
20. Waiting for Chain

Notes

- "DIA" = diamonds. The names after a status (Erik, Maria, Azavedo, Igor, Jorje) are bench
  workers; those statuses mean "at that person's bench".
- "Sent to Store" and "Sent to Shipping Dept" are the finishing statuses (`done: true`).
- The list will grow. It is data (shop metafield), never hardcoded in the UI.
- What the old block does **not** show, and this app must: who made the last change and when,
  per item and per order.
