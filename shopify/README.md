# Tennis Chain Size Finder (Shopify)

An interactive, step-by-step page section that helps customers pick the right diamond tennis
chain length.

- **Live model:** a figure wearing a sparkling diamond tennis chain drawn link by link.
  The chain moves as the customer answers, and the figure's shoulders change with build.
- **4-step quiz:** neck size (a measurement in inches or cm, a shirt collar size,
  or "no idea"), where it should sit, build, and width. Picture cards move to the
  next question automatically.
- **Reveal:** the chain drops into place and shows the recommended length, cm, and
  roughly how many diamonds are in it.
- **Try-on:** a length slider (16"–30"), width, white/yellow/rose gold, 4 skin tones,
  a "Layer it" switch that adds chains 2" and 4" longer, and "Copy my size".
- **Length chart:** highlights the row that matches the length shown.

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
