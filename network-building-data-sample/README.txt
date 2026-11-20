ImgNetMaker sample data (synthetic, for testing only)

sample_1_csv_with_image_urls.csv
  Entry 1 "CSV with image URLs -> Images + Data URLs": choose the column image_url.
  Images are Lorem Picsum photos (picsum.photos, from Unsplash).
  Also works in entry 3 "CSV / JSON -> Network" using the web links directly.
  Connect images through: hashtags, account.

sample_2_image_folder/
  Entry 2 "Image folder -> Data URLs": upload the folder images/,
  then in Network building add metadata.csv (IDs are deliberately written
  in different ways: post_01, POST_00.JPG ... to show the matching).
  One metadata row (post_99) has no image on purpose.

sample_3_network.json
  Entry 3 "CSV / JSON -> Network": hashtags are lists, author is nested
  (becomes author.handle and author.type).

All accounts, hashtags and dates are invented.
