    train_pairs = create_pairs(
        train_groups, embeddings, descriptors, SEED, MAX_PAIRS_PER_TYPE_PER_SPLIT
    )
    test_pairs = create_pairs(
        test_groups, embeddings, descriptors, SEED + 1, MAX_PAIRS_PER_TYPE_PER_SPLIT
    )

    # Verify no image from the training pool occurs in the test pool.
    train_paths = {str(p) for paths in train_groups.values() for p in paths}
    test_paths = {str(p) for paths in test_groups.values() for p in paths}
    overlap = train_paths & test_paths
    if overlap:
        stop(f"Leakage guard failed: {len(overlap)} shared images.")

    train_csv = OUT_DIR / "train_pairs_features.csv"
    test_csv = OUT_DIR / "test_pairs_features.csv"
    train_pairs.to_csv(train_csv, index=False)
    test_pairs.to_csv(test_csv, index=False)

    X_train = train_pairs[FEATURES].astype(float)
    y_train = train_pairs["match"].astype(int)
    X_test = test_pairs[FEATURES].astype(float)
    y_test = test_pairs["match"].astype(int)

    classifier = RandomForestClassifier(
        n_estimators=300,
        max_depth=10,
        min_samples_leaf=4,
        class_weight="balanced",
        random_state=SEED,
        n_jobs=-1,
    )
    classifier.fit(X_train, y_train)
    pred = classifier.predict(X_test)
    prob = classifier.predict_proba(X_test)[:, 1]

    cm = confusion_matrix(y_test, pred, labels=[0, 1])
    metrics = {
        "evaluation_type": "image-disjoint synthetic same-image control benchmark",
        "warning": (
            "Positive pairs are identical-image pairs. This is not a verified "
            "different-photo/same-physical-item lost-found benchmark."
        ),
        "seed": SEED,
        "train_image_count": len(train_paths),
        "test_image_count": len(test_paths),
        "shared_images_between_splits": len(overlap),
        "train_pair_count": len(train_pairs),
        "test_pair_count": len(test_pairs),
        "train_label_counts": {str(k): int(v) for k, v in y_train.value_counts().sort_index().items()},
        "test_label_counts": {str(k): int(v) for k, v in y_test.value_counts().sort_index().items()},
        "accuracy": float(accuracy_score(y_test, pred)),
        "precision": float(precision_score(y_test, pred, zero_division=0)),
        "recall": float(recall_score(y_test, pred, zero_division=0)),
        "f1": float(f1_score(y_test, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, prob)) if y_test.nunique() == 2 else None,
        "confusion_matrix_labels_order": ["true_negative", "false_positive", "false_negative", "true_positive"],
        "confusion_matrix": cm.tolist(),
        "classification_report": classification_report(
            y_test, pred, labels=[0, 1], target_names=["not_match", "match"],
            zero_division=0, output_dict=True
        ),
        "feature_importance": {
            name: float(value) for name, value in zip(FEATURES, classifier.feature_importances_)
        },
    }

    predictions = test_pairs.copy()
    predictions["predicted_match"] = pred
    predictions["match_probability"] = prob
    predictions.to_csv(OUT_DIR / "test_predictions.csv", index=False)
    pd.DataFrame([
        {"feature": k, "importance": v}
        for k, v in metrics["feature_importance"].items()
    ]).sort_values("importance", ascending=False).to_csv(
        OUT_DIR / "feature_importance.csv", index=False
    )

    # Save to a new location only.
    joblib.dump(
        {"model": classifier, "features": FEATURES, "version": 1,
         "benchmark": "image-disjoint synthetic visual control"},
        OUT_DIR / "experimental_visual_matcher.joblib"
    )
    with (OUT_DIR / "evaluation_report.json").open("w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print("\n" + "=" * 72)
    print("PIPELINE COMPLETE")
    print("=" * 72)
    print("Shared images between train/test:", metrics["shared_images_between_splits"])
    print("Train pairs:", metrics["train_pair_count"])
    print("Test pairs:", metrics["test_pair_count"])
    print("Accuracy:  {:.2f}%".format(metrics["accuracy"] * 100))
    print("Precision: {:.2f}%".format(metrics["precision"] * 100))
    print("Recall:    {:.2f}%".format(metrics["recall"] * 100))
    print("F1:        {:.2f}%".format(metrics["f1"] * 100))
    print("ROC-AUC:   {}".format(
        "N/A" if metrics["roc_auc"] is None else f"{metrics['roc_auc'] * 100:.2f}%"
    ))
    print("\nConfusion matrix [ [TN, FP], [FN, TP] ]:")
    print(cm)
    print("\nOutput files:")
    for p in sorted(OUT_DIR.iterdir()):
        if p.is_file():
            print(" -", p)
    print("\nIMPORTANT: These scores measure the synthetic same-image control task,")
    print("not real-world identity matching between different photos.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted by user.")
        sys.exit(130)
