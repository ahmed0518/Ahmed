# Tennis Chain Size Finder (Shopify)

An interactive page section that helps customers pick the right diamond tennis
chain length. Customers enter their neck size (tape measurement in inches or cm,
shirt collar size, or "I don't know"), choose where they want the chain to sit,
their build and the chain width. The tool then recommends a standard length
(16"–30"), a shorter and a longer option, and a width range. A drawing shows
where the chain will fall, and a length chart highlights the matching row.

It's self-contained: plain Liquid, CSS and JavaScript, with no apps or external scripts.

## Files

| File | Goes in your theme at |
| --- | --- |
| `sections/tennis-chain-size-finder.liquid` | `sections/` |
| `templates/page.tennis-chain-size-guide.json` | `templates/` |

## Install

1. **Online Store → Themes → … → Edit code** (work on a duplicate of the live theme first).
2. Under **Sections**, add a new section named `tennis-chain-size-finder` and paste in the section file.
3. Under **Templates**, add a new template: type `page`, name `tennis-chain-size-guide`,
   and paste in the JSON file.
   (If your theme's page section isn't called `main-page`, change `"type"` in the JSON to match
   your theme's `templates/page.json`, or remove the `main` section.)
4. **Online Store → Pages → Add page**, title it e.g. "Tennis Chain Size Guide", and under
   **Theme template** pick `tennis-chain-size-guide`. Save.
5. In **Customize**, open the page to edit the heading, text, shop button link
   (for example your tennis chains collection) and colors.

You can also add the section to any other page, such as a product template, from the
theme editor with **Add section → Tennis chain size finder**.

## How the recommendation works

```
target = neck + fit allowance + build adjustment + width adjustment
```

| Fit | Allowance | | Build | Adj. | | Width | Adj. |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tight | +2" | | Slim | −0.5" | | 2–4mm | 0 |
| Collarbone | +4" | | Average | 0 | | 5mm | +0.5" |
| Upper chest | +6" | | Athletic | +1" | | 6–7mm+ | +1" |
| Mid chest | +9" | | Broad / Big | +2" | | | |
| Low | +12" | | | | | | |

The target is rounded up to the next standard length (16, 18, 20 … 30"), within a
0.5" tolerance. Collar sizes are reduced by 0.5" to estimate neck size. If the
neck size is unknown, it assumes 15.5" (men) or 13.5" (women).
The numbers are constants at the top of the section's `<script>` if you want to tune them.
