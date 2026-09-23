# TraceMate CNN Integration

The CNN layer now supports both pairwise comparison and reusable image embeddings.

## New endpoint

`POST /cv/image-embedding`

Returns a normalized 1280-dimensional MobileNetV2 embedding.

## Node integration

`src/services/cnnMatchingService.js` provides:

- `requestEmbedding(imagePath)`
- `compareImages(imagePath1, imagePath2)`
- `searchByEmbedding(queryEmbedding, candidates, topK)`

## Database field

For each lost/found image, store:

```json
{
  "imageEmbedding": [1280 normalized values],
  "imageEmbeddingModel": "MobileNetV2"
}
```

The embedding can be compared with candidate lost reports using cosine similarity.

## Research note

Similarity is not model accuracy. A production threshold must be selected from labeled TraceMate image pairs during evaluation.

Next layers: CLIP -> SBERT -> hybrid text/image/location/time/category ranking.
