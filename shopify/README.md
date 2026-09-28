# Tennis Chain Shop with Size Finder (Shopify)

A marketplace-style category page for diamond tennis chains, with a built-in size finder:

- **Shop layout:** breadcrumb, page title with trust badges, a filter sidebar, result count, sort,
  3- or 4-across grid, removable filter chips, "Load more" with a progress bar, and a sticky
  Filter / Size bar and slide-in filter drawer on phones.
- **Filters with live counts:** your fit (within 2" of your size), length, width, metal, natural or
  lab-grown, price (ranges worked out from your prices), total carat weight, in stock, on sale.
- **Product cards:** photo with a second photo on hover, badges (Your size, −% sale, Best seller, New),
  "Your size · sits at your upper chest", length · width · carat · diamond type, price with
  compare-at and savings, metal swatches that switch the variant, Quick view and Add to cart.
- **Quick view:** photo gallery plus an **On you** view (the chain drawn on a model at its real
  length, width and metal), metal and length options, a specs table (length, width, carat, color,
  clarity, diamonds, metal, setting, weight), quantity and Add to cart.
- **Find my size:** a 4-step quiz (neck size, where it should sit, build, width) shown live on a
  model. The result ranks every chain by fit, adds "Your size" badges, and is remembered on the
  shopper's device for their next visit. Shoppers can try other lengths, widths, metals, skin tones,
  outfits and a layered stack.
- **Size guide tabs:** length chart (your size highlighted), width guide explaining "pointer" sizes
  (stones drawn to scale), and a sizing FAQ.

It uses plain Liquid, CSS and JavaScript, with no apps and no external scripts. The default look is
white with black buttons and gold accents; the three colors can be changed in the theme editor.

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
3. **Online Store → Pages → Add page**, title it (for example "Shop Tennis Chains by Size"), and pick
   the `tennis-chain-size-guide` template. Save.
4. Open the page in **Customize** to check the collection (it uses **Tennis Chains** by default),
   edit the heading, breadcrumb label, trust badges and contact link.
5. Preview, test the filters, quick view and Add to cart, then publish the theme.

## Product data it reads

For each product in the collection:

| Data | Source | Fallback |
| --- | --- | --- |
| Length | `custom.length` metafield ("22 inches") | number before "Inches" in the title |
| Width | `custom.width` ("3 mm") | number before "mm" in the title |
| Carat, color, clarity | `custom.diamond_weight_side`, `custom.diamond_color_side`, `custom.diamond_clarity_side` | hidden |
| Natural / lab-grown | `custom.diamond_origin_side`, or "Lab" in the title | hidden |
| Metal type, weight, setting | `custom.metal`, `custom.weight`, `custom.setting` | hidden |
| Metal color | variant title containing Yellow / White / Rose | |
| Length variants | variant titles like "Yellow / 20 Inches" | the closest length is picked |
| Badges | tags `Best Sellers` and `New Arrivals`; compare-at price for sales | |

Products tagged `Bracelets` are skipped. The page loads up to 120 products by default
("Products to load" in the theme editor, up to 248).

**Add to cart** posts to Shopify's cart (`/cart/add.js`), shows a "View cart / Checkout" message and
updates common cart-count badges. If your theme has a slide-out cart that doesn't refresh on its
own, the item still appears when the shopper opens the cart.

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
13.5" (women). "Best fit for me" ranks by length difference, then width difference, then the
collection's own order. The constants are at the top of `assets/tennis-chain-size-finder.js`.
