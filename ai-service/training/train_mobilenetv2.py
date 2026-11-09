"""
TraceMate MobileNetV2 visual model training
-------------------------------------------
Trains a 10-class MobileNetV2 classifier on the prepared LostNet-derived
image dataset.

Expected dataset:
TraceMate-Merged-Original-CNN/
  dataset-tools/
    training-data/
      train/<class>/*.jpg
      validation/<class>/*.jpg
      test/<class>/*.jpg

Outputs:
  ai-service/models/mobilenetv2_tracemate.keras
  ai-service/models/mobilenetv2_tracemate_labels.json
  ai-service/models/mobilenetv2_training_history.json
  ai-service/models/mobilenetv2_test_metrics.json

This is a visual-category model. It is NOT yet the final Lost-vs-Found
matching classifier. That comes after feature extraction and pair creation.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import tensorflow as tf
from tensorflow.keras import layers, models
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATASET_ROOT = PROJECT_ROOT / "dataset-tools" / "training-data"
MODEL_DIR = PROJECT_ROOT / "ai-service" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

TRAIN_DIR = DATASET_ROOT / "train"
VAL_DIR = DATASET_ROOT / "validation"
TEST_DIR = DATASET_ROOT / "test"

IMG_SIZE = (224, 224)
BATCH_SIZE = 32
SEED = 42
EPOCHS = 10

print("TraceMate MobileNetV2 Training")
print("=" * 60)
print(f"Dataset: {DATASET_ROOT}")
print(f"Train:  {TRAIN_DIR}")
print(f"Val:    {VAL_DIR}")
print(f"Test:   {TEST_DIR}")
print()

for p in (TRAIN_DIR, VAL_DIR, TEST_DIR):
    if not p.exists():
        raise FileNotFoundError(f"Missing dataset folder: {p}")

train_ds = tf.keras.utils.image_dataset_from_directory(
    TRAIN_DIR,
    labels="inferred",
    label_mode="int",
    image_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    shuffle=True,
    seed=SEED,
)

val_ds = tf.keras.utils.image_dataset_from_directory(
    VAL_DIR,
    labels="inferred",
    label_mode="int",
    image_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    shuffle=False,
)

test_ds = tf.keras.utils.image_dataset_from_directory(
    TEST_DIR,
    labels="inferred",
    label_mode="int",
    image_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    shuffle=False,
)

class_names = train_ds.class_names
print("Classes:", class_names)

if val_ds.class_names != class_names or test_ds.class_names != class_names:
    raise RuntimeError("Class ordering differs between train/validation/test folders.")

with open(MODEL_DIR / "mobilenetv2_tracemate_labels.json", "w", encoding="utf-8") as f:
    json.dump(class_names, f, indent=2)

AUTOTUNE = tf.data.AUTOTUNE
train_ds = train_ds.prefetch(AUTOTUNE)
val_ds = val_ds.prefetch(AUTOTUNE)
test_ds = test_ds.prefetch(AUTOTUNE)

# Light augmentation for training only.
data_augmentation = tf.keras.Sequential(
    [
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.05),
        layers.RandomZoom(0.10),
    ],
    name="data_augmentation",
)

base_model = MobileNetV2(
    input_shape=IMG_SIZE + (3,),
    include_top=False,
    weights="imagenet",
)
base_model.trainable = False

inputs = layers.Input(shape=IMG_SIZE + (3,), name="image")
x = data_augmentation(inputs)
x = preprocess_input(x)
x = base_model(x, training=False)
x = layers.GlobalAveragePooling2D(name="embedding")(x)
x = layers.Dropout(0.25)(x)
outputs = layers.Dense(len(class_names), activation="softmax", name="class_output")(x)

model = models.Model(inputs, outputs, name="TraceMate_MobileNetV2")
model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)

print("\nModel:")
model.summary()

best_path = MODEL_DIR / "mobilenetv2_tracemate.keras"

callbacks = [
    tf.keras.callbacks.ModelCheckpoint(
        filepath=str(best_path),
        monitor="val_accuracy",
        save_best_only=True,
        verbose=1,
    ),
    tf.keras.callbacks.EarlyStopping(
        monitor="val_accuracy",
        patience=3,
        restore_best_weights=True,
        verbose=1,
    ),
    tf.keras.callbacks.ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.5,
        patience=2,
        min_lr=1e-6,
        verbose=1,
    ),
]

history = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=EPOCHS,
    callbacks=callbacks,
)

test_loss, test_accuracy = model.evaluate(test_ds, verbose=1)

history_out = {
    "epochs_requested": EPOCHS,
    "history": {k: [float(v) for v in vals] for k, vals in history.history.items()},
}
with open(MODEL_DIR / "mobilenetv2_training_history.json", "w", encoding="utf-8") as f:
    json.dump(history_out, f, indent=2)

metrics = {
    "test_loss": float(test_loss),
    "test_accuracy": float(test_accuracy),
    "class_count": len(class_names),
    "classes": class_names,
    "image_size": list(IMG_SIZE),
    "batch_size": BATCH_SIZE,
    "seed": SEED,
}
with open(MODEL_DIR / "mobilenetv2_test_metrics.json", "w", encoding="utf-8") as f:
    json.dump(metrics, f, indent=2)

print("\n" + "=" * 60)
print("TRAINING COMPLETE")
print(f"Test accuracy: {test_accuracy * 100:.2f}%")
print(f"Model: {best_path}")
print(f"Labels: {MODEL_DIR / 'mobilenetv2_tracemate_labels.json'}")
print(f"Metrics: {MODEL_DIR / 'mobilenetv2_test_metrics.json'}")
print("=" * 60)
