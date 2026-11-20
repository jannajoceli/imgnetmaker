ImgNetMaker sample data (synthetic, for testing only)
All accounts, hashtags and dates are invented.

Entry 1 - "CSV with image URLs -> Images + Data URLs"
  sample_1_csv_with_image_urls.csv
  Choose the column image_url. ImgNetMaker downloads the 20 images
  (Lorem Picsum photos, picsum.photos, from Unsplash) and adds data URLs.
  Then, in Network building, connect the images through hashtags and/or account.

Entry 2 - "Image folder -> Data URLs"
  sample_2_image_folder/
  Upload the folder images/ (18 images), then in Network building add
  metadata.csv. The IDs are deliberately written in different ways
  (post_01, POST_00.JPG ...) to show the matching; one metadata row
  (post_99) has no image on purpose.

Entry 3 - "CSV / JSON -> Network"  (images already embedded as data URLs)
  sample_3_network.csv
    Same shape as an ImgNetMaker output: inm_filename, inm_imgdataurl,
    plus account, hashtags, date.
  sample_3_network.json
    The same 18 posts as JSON. The image column is called "image",
    hashtags are lists, and author is nested (becomes author.handle
    and author.type).
  Connect the images through hashtags and/or account (author.handle).

Opening the result
  Click "Download network file", then in Gephi Lite choose
  "Open a local file" (dragging the file onto the window does not work).
  The images are already on the nodes; run Layout -> ForceAtlas2.
