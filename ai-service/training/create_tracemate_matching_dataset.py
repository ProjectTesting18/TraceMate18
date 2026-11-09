"""
TraceMate - Manual Lost/Found Pair Annotation Tool

Purpose:
    Create a manually labeled TraceMate matching dataset.

Labels:
    1 = SAME PHYSICAL ITEM
    0 = DIFFERENT ITEM

Controls:
    M = Match
    N = Not Match
    S = Skip
    Q = Quit

Output:
    dataset-tools/matching-data/tracemate_labeled_pairs.csv

IMPORTANT:
    Only label MATCH when you have evidence that the two
    images represent the same physical item.

    Same category does NOT automatically mean MATCH.
"""

from pathlib import Path
import csv
import random
import sys

from PIL import Image
import tkinter as tk
from tkinter import ttk
from PIL import ImageTk


# ============================================================
# CONFIGURATION
# ============================================================

SEED = 42

# Number of candidate pairs to prepare.
# You can increase this later.
MAX_PAIRS = 500

# ============================================================
# PROJECT PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[2]

DATASET_ROOT = (
    PROJECT_ROOT
    / "dataset-tools"
    / "training-data"
)

OUTPUT_FILE = (
    PROJECT_ROOT
    / "dataset-tools"
    / "matching-data"
    / "tracemate_labeled_pairs.csv"
)


# ============================================================
# IMAGE EXTENSIONS
# ============================================================

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
}


# ============================================================
# FIND IMAGES
# ============================================================

def find_images():

    if not DATASET_ROOT.exists():

        print()
        print(
            "ERROR: Training dataset folder not found:"
        )

        print(
            DATASET_ROOT
        )

        sys.exit(1)

    images = []

    for path in DATASET_ROOT.rglob("*"):

        if not path.is_file():
            continue

        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        images.append(path)

    return images


# ============================================================
# CATEGORY
# ============================================================

def get_category(image_path):

    try:
        relative = image_path.relative_to(
            DATASET_ROOT
        )

        parts = relative.parts

        if len(parts) >= 2:
            return parts[0]

    except Exception:
        pass

    return image_path.parent.name


# ============================================================
# LOAD EXISTING ANNOTATIONS
# ============================================================

def load_existing_pairs():

    existing = {}

    if not OUTPUT_FILE.exists():
        return existing

    try:

        with open(
            OUTPUT_FILE,
            "r",
            encoding="utf-8",
            newline="",
        ) as file:

            reader = csv.DictReader(file)

            for row in reader:

                key = (
                    row["image_a"],
                    row["image_b"],
                )

                existing[key] = row["label"]

                reverse_key = (
                    row["image_b"],
                    row["image_a"],
                )

                existing[reverse_key] = row["label"]

    except Exception as exc:

        print(
            f"Warning: Could not read existing "
            f"annotations: {exc}"
        )

    return existing


# ============================================================
# SAVE ANNOTATION
# ============================================================

def save_annotation(
    image_a,
    image_b,
    category_a,
    category_b,
    label,
):

    OUTPUT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    file_exists = OUTPUT_FILE.exists()

    with open(
        OUTPUT_FILE,
        "a",
        encoding="utf-8",
        newline="",
    ) as file:

        fieldnames = [
            "image_a",
            "image_b",
            "category_a",
            "category_b",
            "label",
        ]

        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )

        if not file_exists:
            writer.writeheader()

        writer.writerow(
            {
                "image_a": str(
                    image_a.relative_to(
                        PROJECT_ROOT
                    )
                ),
                "image_b": str(
                    image_b.relative_to(
                        PROJECT_ROOT
                    )
                ),
                "category_a": category_a,
                "category_b": category_b,
                "label": label,
            }
        )


# ============================================================
# ANNOTATION APP
# ============================================================

class AnnotationApp:

    def __init__(
        self,
        root,
        pairs,
        existing,
    ):

        self.root = root
        self.pairs = pairs
        self.existing = existing

        self.index = 0
        self.labeled = 0
        self.skipped = 0

        self.photo_a = None
        self.photo_b = None

        self.setup_window()

        self.show_pair()

    # --------------------------------------------------------
    # WINDOW
    # --------------------------------------------------------

    def setup_window(self):

        self.root.title(
            "TraceMate - Matching Pair Annotation"
        )

        self.root.geometry(
            "1200x850"
        )

        self.root.minsize(
            1000,
            700,
        )

        # ----------------------------------------------------
        # Header
        # ----------------------------------------------------

        header = ttk.Frame(
            self.root,
            padding=15,
        )

        header.pack(
            fill="x"
        )

        self.title_label = ttk.Label(
            header,
            text="TraceMate Matching Dataset Annotation",
            font=(
                "Arial",
                20,
                "bold",
            ),
        )

        self.title_label.pack()

        self.progress_label = ttk.Label(
            header,
            text="",
            font=(
                "Arial",
                12,
            ),
        )

        self.progress_label.pack(
            pady=(8, 0)
        )

        # ----------------------------------------------------
        # Category information
        # ----------------------------------------------------

        self.category_label = ttk.Label(
            self.root,
            text="",
            font=(
                "Arial",
                13,
                "bold",
            ),
        )

        self.category_label.pack(
            pady=8
        )

        # ----------------------------------------------------
        # Image area
        # ----------------------------------------------------

        image_frame = ttk.Frame(
            self.root,
            padding=10,
        )

        image_frame.pack(
            fill="both",
            expand=True,
        )

        # Left
        left_frame = ttk.LabelFrame(
            image_frame,
            text="IMAGE A",
            padding=10,
        )

        left_frame.pack(
            side="left",
            fill="both",
            expand=True,
            padx=10,
        )

        self.image_a_label = ttk.Label(
            left_frame
        )

        self.image_a_label.pack(
            fill="both",
            expand=True,
        )

        # Right
        right_frame = ttk.LabelFrame(
            image_frame,
            text="IMAGE B",
            padding=10,
        )

        right_frame.pack(
            side="right",
            fill="both",
            expand=True,
            padx=10,
        )

        self.image_b_label = ttk.Label(
            right_frame
        )

        self.image_b_label.pack(
            fill="both",
            expand=True,
        )

        # ----------------------------------------------------
        # Instructions
        # ----------------------------------------------------

        instructions = ttk.Label(
            self.root,
            text=(
                "MATCH = same physical item    "
                "NOT MATCH = different item    "
                "SKIP = uncertain    "
                "QUIT = stop annotation"
            ),
            font=(
                "Arial",
                12,
            ),
        )

        instructions.pack(
            pady=8
        )

        # ----------------------------------------------------
        # Buttons
        # ----------------------------------------------------

        button_frame = ttk.Frame(
            self.root,
            padding=10,
        )

        button_frame.pack(
            fill="x"
        )

        match_button = ttk.Button(
            button_frame,
            text="✓ MATCH",
            command=lambda: self.label_pair(1),
        )

        match_button.pack(
            side="left",
            expand=True,
            padx=10,
            ipadx=20,
            ipady=10,
        )

        not_match_button = ttk.Button(
            button_frame,
            text="✗ NOT MATCH",
            command=lambda: self.label_pair(0),
        )

        not_match_button.pack(
            side="left",
            expand=True,
            padx=10,
            ipadx=20,
            ipady=10,
        )

        skip_button = ttk.Button(
            button_frame,
            text="SKIP",
            command=self.skip_pair,
        )

        skip_button.pack(
            side="left",
            expand=True,
            padx=10,
            ipadx=20,
            ipady=10,
        )

        quit_button = ttk.Button(
            button_frame,
            text="QUIT",
            command=self.quit_app,
        )

        quit_button.pack(
            side="left",
            expand=True,
            padx=10,
            ipadx=20,
            ipady=10,
        )

        # ----------------------------------------------------
        # Keyboard shortcuts
        # ----------------------------------------------------

        self.root.bind(
            "<m>",
            lambda event: self.label_pair(1),
        )

        self.root.bind(
            "<M>",
            lambda event: self.label_pair(1),
        )

        self.root.bind(
            "<n>",
            lambda event: self.label_pair(0),
        )

        self.root.bind(
            "<N>",
            lambda event: self.label_pair(0),
        )

        self.root.bind(
            "<s>",
            lambda event: self.skip_pair(),
        )

        self.root.bind(
            "<S>",
            lambda event: self.skip_pair(),
        )

        self.root.bind(
            "<q>",
            lambda event: self.quit_app(),
        )

        self.root.bind(
            "<Q>",
            lambda event: self.quit_app(),
        )

    # --------------------------------------------------------
    # LOAD IMAGE
    # --------------------------------------------------------

    def load_display_image(
        self,
        path,
    ):

        try:

            image = Image.open(
                path
            ).convert(
                "RGB"
            )

            image.thumbnail(
                (500, 500)
            )

            photo = ImageTk.PhotoImage(
                image
            )

            return photo

        except Exception as exc:

            print(
                f"Could not load image "
                f"{path}: {exc}"
            )

            return None

    # --------------------------------------------------------
    # SHOW PAIR
    # --------------------------------------------------------

    def show_pair(self):

        if self.index >= len(
            self.pairs
        ):

            self.finish()

            return

        image_a, image_b = (
            self.pairs[
                self.index
            ]
        )

        category_a = get_category(
            image_a
        )

        category_b = get_category(
            image_b
        )

        self.progress_label.config(
            text=(
                f"Pair "
                f"{self.index + 1} / "
                f"{len(self.pairs)}    "
                f"Labeled: {self.labeled}    "
                f"Skipped: {self.skipped}"
            )
        )

        self.category_label.config(
            text=(
                f"Category A: {category_a}     "
                f"Category B: {category_b}"
            )
        )

        self.photo_a = (
            self.load_display_image(
                image_a
            )
        )

        self.photo_b = (
            self.load_display_image(
                image_b
            )
        )

        if self.photo_a:

            self.image_a_label.config(
                image=self.photo_a
            )

        if self.photo_b:

            self.image_b_label.config(
                image=self.photo_b
            )

    # --------------------------------------------------------
    # LABEL
    # --------------------------------------------------------

    def label_pair(
        self,
        label,
    ):

        image_a, image_b = (
            self.pairs[
                self.index
            ]
        )

        key = (
            str(image_a),
            str(image_b),
        )

        if key in self.existing:

            self.index += 1

            self.show_pair()

            return

        save_annotation(
            image_a,
            image_b,
            get_category(image_a),
            get_category(image_b),
            label,
        )

        self.existing[key] = str(
            label
        )

        self.labeled += 1

        self.index += 1

        self.show_pair()

    # --------------------------------------------------------
    # SKIP
    # --------------------------------------------------------

    def skip_pair(self):

        self.skipped += 1

        self.index += 1

        self.show_pair()

    # --------------------------------------------------------
    # QUIT
    # --------------------------------------------------------

    def quit_app(self):

        self.root.destroy()

    # --------------------------------------------------------
    # FINISH
    # --------------------------------------------------------

    def finish(self):

        self.progress_label.config(
            text=(
                f"Annotation complete. "
                f"Labeled: {self.labeled}"
            )
        )

        self.category_label.config(
            text=(
                "Dataset annotation completed."
            )
        )

        self.image_a_label.config(
            image=""
        )

        self.image_b_label.config(
            image=""
        )


# ============================================================
# BUILD PAIR LIST
# ============================================================

def build_pairs(
    images,
):

    random.seed(
        SEED
    )

    # Group by category.
    categories = {}

    for image in images:

        category = get_category(
            image
        )

        categories.setdefault(
            category,
            []
        ).append(image)

    pairs = []

    # --------------------------------------------------------
    # Prefer same-category pairs.
    #
    # These are the most useful because they force the
    # annotator to distinguish same-category items.
    # --------------------------------------------------------

    same_category_pairs = []

    for category, category_images in (
        categories.items()
    ):

        if len(category_images) < 2:
            continue

        for i in range(
            len(category_images)
        ):

            for j in range(
                i + 1,
                len(category_images)
            ):

                same_category_pairs.append(
                    (
                        category_images[i],
                        category_images[j],
                    )
                )

    random.shuffle(
        same_category_pairs
    )

    # --------------------------------------------------------
    # Different-category pairs.
    # --------------------------------------------------------

    different_category_pairs = []

    category_names = list(
        categories.keys()
    )

    for i in range(
        len(category_names)
    ):

        for j in range(
            i + 1,
            len(category_names)
        ):

            category_a = (
                categories[
                    category_names[i]
                ]
            )

            category_b = (
                categories[
                    category_names[j]
                ]
            )

            sample_count = min(
                20,
                len(category_a),
                len(category_b),
            )

            for image_a in category_a[
                :sample_count
            ]:

                for image_b in category_b[
                    :sample_count
                ]:

                    different_category_pairs.append(
                        (
                            image_a,
                            image_b,
                        )
                    )

    random.shuffle(
        different_category_pairs
    )

    # --------------------------------------------------------
    # Combine.
    # --------------------------------------------------------

    # 70% same-category pairs
    # 30% different-category pairs

    same_count = int(
        MAX_PAIRS * 0.70
    )

    different_count = (
        MAX_PAIRS
        -
        same_count
    )

    pairs.extend(
        same_category_pairs[
            :same_count
        ]
    )

    pairs.extend(
        different_category_pairs[
            :different_count
        ]
    )

    random.shuffle(
        pairs
    )

    return pairs


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print(
        "TraceMate Manual Matching Dataset Creator"
    )
    print("=" * 70)

    print()
    print(
        "Dataset:"
    )

    print(
        DATASET_ROOT
    )

    print()
    print(
        "Finding images..."
    )

    images = find_images()

    print(
        f"Images found: {len(images)}"
    )

    if len(images) < 2:

        print(
            "ERROR: Not enough images."
        )

        sys.exit(1)

    existing = (
        load_existing_pairs()
    )

    print()
    print(
        f"Existing annotations: "
        f"{len(existing)}"
    )

    pairs = build_pairs(
        images
    )

    print()
    print(
        f"Candidate pairs: "
        f"{len(pairs)}"
    )

    print()
    print(
        "Controls:"
    )

    print(
        "  M = Same physical item"
    )

    print(
        "  N = Different physical item"
    )

    print(
        "  S = Skip / uncertain"
    )

    print(
        "  Q = Quit"
    )

    print()
    print(
        "IMPORTANT:"
    )

    print(
        "Only choose MATCH when you believe "
        "both images show the same physical item."
    )

    print()

    # --------------------------------------------------------
    # Start GUI
    # --------------------------------------------------------

    root = tk.Tk()

    app = AnnotationApp(
        root,
        pairs,
        existing,
    )

    root.mainloop()

    print()
    print("=" * 70)
    print(
        "ANNOTATION SESSION ENDED"
    )
    print("=" * 70)

    print()
    print(
        "Output:"
    )

    print(
        OUTPUT_FILE
    )


if __name__ == "__main__":
    main()