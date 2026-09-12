# Maracaibo Members Timeline — data export

655 timeline entries spanning **1969–2023**, plus the 612 images they reference.
Extracted from the existing timeline page (`index.html`) on 2026-08-08.

## Files

| File | What it is |
|---|---|
| `timeline.json` | **Recommended.** All 655 entries, with each entry's images as a proper list. |
| `timeline.csv` | Same data, flat. Images pipe-delimited in one column. |
| `timeline-images.csv` | Optional join table — one row per image, if you'd rather not parse a delimited column. |
| `timeline-images.zip` | All 612 image files, inside an `images/` folder. ~76 MB. |

`timeline.json` and `timeline.csv` contain identical data — pick whichever suits your
importer. The JSON is the more faithful representation because an entry can have anywhere
from 0 to 12 images; the CSV has to flatten that into a delimited string.

## Fields

| Field | Notes |
|---|---|
| `id` | 1–655, assigned by this export. Entries are in chronological order, oldest first. Referenced by `timeline-images.csv`. |
| `year` | Integer, 1969–2023. |
| `date` | Month and day as shown on the page, e.g. `November 9`. **Does not include the year** — combine with `year`. A few entries give only a month (e.g. `August`). |
| `title` | Short headline. Always present. |
| `description` | Plain text, no HTML. Blank lines (`\n\n`) separate paragraphs. Empty for 36 entries that are title + photos only. |
| `images` | JSON: array of filenames. CSV: pipe-delimited (`a.jpg|b.jpg`), empty when none. Order is the display order from the original page. |
| `image_count` | CSV only, convenience column. |
| `notes` | Editorial notes from the source page. Only 2 entries have one — both flagging an image that was never captured. |


