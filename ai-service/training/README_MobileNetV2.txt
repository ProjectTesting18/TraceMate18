TraceMate MobileNetV2 training

1. Make sure the prepared dataset exists:
   dataset-tools/training-data/train
   dataset-tools/training-data/validation
   dataset-tools/training-data/test

2. Install TensorFlow in the Python environment used for AI training:
   pip install -r ai-service/training/requirements-mobilenet.txt

3. From the project root run:
   python ai-service/training/train_mobilenetv2.py

This trains a 10-class visual-category model. It is NOT yet the final
Lost-vs-Found matching model. The next stage will extract embeddings and
construct positive/negative item pairs, then combine visual features with
the existing SBERT/text features.
