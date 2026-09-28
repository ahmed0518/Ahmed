# Tennis Chain Size Finder + Shop (Shopify)

A shoppable size guide page for diamond tennis chains:

1. **Find your size:** a 4-step quiz (neck size, where it should sit, build, width) shown live on a
   model wearing a link-by-link diamond chain with prongs, shading and a shadow on the skin.
2. **Try it on:** a length slider, width, white/yellow/rose gold, skin tone, outfit (no shirt / white tee /
   black tee) and a "Layer it" stack.
3. **Shop your size:** real products from your Tennis Chains collection, ranked by how they'll fit this
   customer. Each card shows "Your size" or "2" longer/shorter", where it will sit on them
   ("On you: upper chest"), specs (length, width, carat, color, clarity, natural or lab-grown),
   sale savings, metal swatches, **Try it on** (puts that chain on the model) and **Add to cart**.
4. A width guide ("pointer" sizes drawn to scale), a length chart, a sizing FAQ, and a sticky
   "Shop my size" bar on mobile.

It uses plain Liquid, CSS and JavaScript, with no apps and no external scripts.

## Files

| File | Goes in your theme at |
| --- | --- |
| `sections/tennis-chain-size-finder.liquid` | `sections/` |
| `snippets/tcsf-products-json.liquid` | `snippets/` |
| `assets/tennis-chain-size-finder.css` | `assets/` |
| `assets/tennis-chain-size-finder.js` | `assets/` |
| `templates/page.tennis-chain-size-guide.json` | `templates/` |

## Install

1. **Online Store → Themes → … → Duplicate** your live theme, then **Edit code** on the copy.
2. Add each file above in its folder (same file names).
3. **Online Store → Pages → Add page**, title it "Tennis Chain Size Guide", and pick the
   `tennis-chain-size-guide` template. Save.
4. Open the page in **Customize** to check the collection (it uses **Tennis Chains** by default),
   edit the text and trust badges, and set the contact link.
5. Preview, test Add to cart, then publish the theme.

## Product data it reads

For each product in the collection:

| Data | Source | Fallback |
| --- | --- | --- |
| Length | `custom.length` metafield ("22 inches") | number before "Inches" in the title |
| Width | `custom.width` ("3 mm") | number before "mm" in the title |
| Carat, color, clarity | `custom.diamond_weight_side`, `custom.diamond_color_side`, `custom.diamond_clarity_side` | hidden |
| Natural / lab-grown | `custom.diamond_origin_side`, or "Lab" in the title | hidden |
| Metal | variant title containing Yellow / White / Rose | |
| Length variants | variant titles like "Yellow / 20 Inches" | the closest length is picked |

Products tagged `Bracelets` are skipped. Products with no length still show, after the matches,
with "See length options".

**Add to cart** posts to Shopify's cart (`/cart/add.js`), shows a "View cart / Checkout" popup,
and updates common cart-count badges. If your theme has a cart drawer that doesn't refresh on
its own, the customer still sees the item when they open the cart page.

## How the recommendation works

```
size = neck + fit allowance + build adjustment + width adjustment   (rounded up to 16, 18 … 30")
```

| Fit | Allowance | | Build | Adj. | | Width | Adj. |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tight | +2" | | Slim | −0.5" | | under 4.75mm | 0 |
| Collarbone | +4" | | Average | 0 | | 4.75–5.5mm | +0.5" |
| Upper chest | +6" | | Athletic | +1" | | 5.5mm+ | +1" |
| Mid chest | +9" | | Broad / Big | +2" | | | |
| Low | +12" | | | | | | |

Collar sizes are reduced by 0.5" to estimate neck size. "No idea / gift" assumes 15.5" (men) or
13.5" (women). Products are ranked by length difference, then width difference, then the
collection's own order (best sellers first). The constants are at the top of
`assets/tennis-chain-size-finder.js`.
