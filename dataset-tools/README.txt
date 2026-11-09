TraceMate Dataset Preparation

Source:
- LostNet-derived image archive supplied by the user (test.zip)

What this package did:
- Verified 4,594 image files
- Found 0 corrupted images
- Removed 45 exact duplicate files using MD5
- Kept 4,549 unique images
- Created a stratified 70/15/15 split with seed 42
- No augmentation and no model training were performed

Folders:
- raw/          source metadata
- processed/    unique cleaned image pool
- train/        training split
- validation/   validation split
- test/         final evaluation split
- reports/      manifest, duplicate list, and dataset report

Important:
The source paper describes a 10,499-image dataset and a 70% training / 30% validation split. Our 70/15/15 split is a TraceMate experimental split created from the uploaded archive; it must not be presented as the paper's original split.
