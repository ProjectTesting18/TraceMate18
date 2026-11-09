"""Train TraceMate's multimodal pair scorer from Kaggle Shopee Product Matching.

This freezes pretrained SBERT, CLIP and MobileNetV2 encoders and trains a
supervised pair-classification head on labeled same-product/different-product
pairs. It does NOT fine-tune the foundation encoders. Shopee is e-commerce data,
not a lost-and-found dataset; validate later on consented TraceMate cases.

Requires Kaggle CLI credentials and accepted competition rules:
  kaggle competitions download -c shopee-product-matching -p data/kaggle
"""
from __future__ import annotations
import argparse, json, random, subprocess, zipfile
from pathlib import Path
from collections import defaultdict

import numpy as np
import pandas as pd
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, classification_report
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
import joblib

FEATURES = ["sbert_cosine", "clip_cosine", "mobilenet_cosine", "token_jaccard", "color_hist_similarity"]
SEED = 42

def cosine(a, b):
    a = np.asarray(a, dtype=np.float32); b = np.asarray(b, dtype=np.float32)
    den = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / den) if den else 0.0

def token_jaccard(a, b):
    import re
    ta = set(re.findall(r"[a-z0-9]+", str(a).lower()))
    tb = set(re.findall(r"[a-z0-9]+", str(b).lower()))
    return len(ta & tb) / len(ta | tb) if ta | tb else 0.0

def color_hist(path):
    with Image.open(path) as im:
        im = im.convert("RGB").resize((96, 96))
        arr = np.asarray(im)
    hist = []
    for c in range(3):
        h, _ = np.histogram(arr[:, :, c], bins=16, range=(0, 256), density=True)
        hist.extend(h.tolist())
    v = np.asarray(hist, dtype=np.float32)
    n = np.linalg.norm(v)
    return v / n if n else v

def cosine_features(vectors, i, j):
    return cosine(vectors[i], vectors[j])

def load_encoders(device):
    import torch
    from sentence_transformers import SentenceTransformer
    from transformers import CLIPModel, CLIPProcessor
    from torchvision.models import mobilenet_v2, MobileNet_V2_Weights
    sbert = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device=device)
    clip_id = "openai/clip-vit-base-patch32"
    clip_model = CLIPModel.from_pretrained(clip_id).to(device).eval()
    clip_processor = CLIPProcessor.from_pretrained(clip_id)
    weights = MobileNet_V2_Weights.DEFAULT
    mobile = mobilenet_v2(weights=weights).to(device).eval()
    mobile.classifier = torch.nn.Identity()
    mobile_transform = weights.transforms()
    return torch, sbert, clip_model, clip_processor, mobile, mobile_transform

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data-dir", default="data/kaggle/shopee-product-matching")
    p.add_argument("--download", action="store_true", help="download competition files with configured Kaggle API")
    p.add_argument("--max-images", type=int, default=4000, help="CPU/GPU budget; 0 means all rows")
    p.add_argument("--pairs-per-group", type=int, default=4)
    p.add_argument("--negative-pairs", type=int, default=20000)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    p.add_argument("--output-dir", default="ai-service/models/kaggle_shopee")
    args = p.parse_args()
    random.seed(SEED); np.random.seed(SEED)
    root = Path(args.data_dir).resolve(); root.mkdir(parents=True, exist_ok=True)
    if args.download:
        subprocess.run(["kaggle", "competitions", "download", "-c", "shopee-product-matching", "-p", str(root)], check=True)
        for zp in root.glob("*.zip"):
            with zipfile.ZipFile(zp) as z: z.extractall(root)
    csv = root / "train.csv"
    if not csv.exists(): raise FileNotFoundError(f"Missing {csv}. Use --download after configuring Kaggle API and accepting competition rules.")
    images_dir = root / "train_images"
    if not images_dir.exists(): raise FileNotFoundError(f"Missing image directory {images_dir}; extract Kaggle train_images.zip there.")
    df = pd.read_csv(csv)
    required = {"posting_id", "image", "title", "label_group"}
    if not required.issubset(df.columns): raise ValueError(f"train.csv must contain {sorted(required)}")
    df["image_path"] = df["image"].map(lambda x: str(images_dir / str(x)))
    df = df[df.image_path.map(lambda x: Path(x).is_file())].copy()
    if args.max_images and len(df) > args.max_images:
        # Keep complete label groups where possible, not an arbitrary image-only sample.
        group_sizes = df.groupby("label_group").size().sort_values(ascending=False)
        chosen=[]; count=0
        for g in group_sizes.index:
            ids=df.index[df.label_group == g].tolist()
            if count and count + len(ids) > args.max_images: continue
            chosen.extend(ids); count += len(ids)
            if count >= args.max_images: break
        df=df.loc[chosen].copy()
    df = df.reset_index(drop=True)
    if df.label_group.nunique() < 3: raise ValueError("Need at least 3 distinct label groups after sampling.")
    try:
        import torch
        device = ("cuda" if torch.cuda.is_available() else "cpu") if args.device == "auto" else args.device
        if device == "cuda" and not torch.cuda.is_available(): raise RuntimeError("--device cuda requested but CUDA is unavailable")
    except ImportError as e: raise RuntimeError("Install torch/torchvision before running this training pipeline") from e
    torch, sbert, clip_model, clip_proc, mobile, mobile_tf = load_encoders(device)
    print(f"Rows/images: {len(df)}; groups: {df.label_group.nunique()}; device: {device}")

    texts=df.title.fillna("").astype(str).tolist()
    print("Encoding SBERT titles...")
    sbert_vec=sbert.encode(texts, batch_size=args.batch_size, convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=True)
    clip_vec=[]; mobile_vec=[]; colors=[]
    from torch.utils.data import Dataset, DataLoader
    class ImgDataset(Dataset):
        def __init__(self, rows): self.rows=rows
        def __len__(self): return len(self.rows)
        def __getitem__(self, idx):
            r=self.rows[idx]
            with Image.open(r.image_path) as im: im=im.convert("RGB")
            return im, mobile_tf(im), idx
    # Batch CLIP and MobileNet in one pass, storing features in row order.
    for start in range(0, len(df), args.batch_size):
        batch=df.iloc[start:start+args.batch_size]
        imgs=[]; mimgs=[]
        for _, r in batch.iterrows():
            with Image.open(r.image_path) as im: im=im.convert("RGB")
            imgs.append(im.copy()); mimgs.append(mobile_tf(im))
            colors.append(color_hist(r.image_path))
        clip_inputs=clip_proc(images=imgs, return_tensors="pt", padding=True).to(device)
        with torch.no_grad():
            cv=clip_model.get_image_features(**clip_inputs)
            cv=torch.nn.functional.normalize(cv, dim=-1).cpu().numpy()
            mv=mobile(torch.stack(mimgs).to(device))
            mv=torch.nn.functional.normalize(mv, dim=-1).cpu().numpy()
        clip_vec.extend(cv); mobile_vec.extend(mv)
        print(f"Encoded images {min(start+len(batch),len(df))}/{len(df)}")
    clip_vec=np.asarray(clip_vec); mobile_vec=np.asarray(mobile_vec); colors=np.asarray(colors)
    # Build pairs with product groups as labels; reserve whole label groups for test.
    groups=df.label_group.astype(str).to_numpy()
    unique_groups=np.unique(groups); rng=np.random.default_rng(SEED); rng.shuffle(unique_groups)
    n_test=max(1, int(len(unique_groups)*0.15)); n_val=max(1, int(len(unique_groups)*0.15))
    test_groups=set(unique_groups[:n_test]); val_groups=set(unique_groups[n_test:n_test+n_val]); train_groups=set(unique_groups[n_test+n_val:])
    if not train_groups: raise ValueError("Not enough groups for group-wise train/validation/test split")
    members=defaultdict(list)
    for i,g in enumerate(groups): members[g].append(i)
    pair_rows=[]
    def add_pair(i,j,label,split_group):
        pair_rows.append({"i":i,"j":j,"label":label,"split":split_group,
          "sbert_cosine":cosine_features(sbert_vec,i,j),"clip_cosine":cosine_features(clip_vec,i,j),
          "mobilenet_cosine":cosine_features(mobile_vec,i,j),"token_jaccard":token_jaccard(texts[i],texts[j]),
          "color_hist_similarity":cosine(colors[i],colors[j])})
    for g, ids in members.items():
        split="train" if g in train_groups else "validation" if g in val_groups else "test"
        if len(ids)>=2:
            for _ in range(min(args.pairs_per_group, len(ids)*(len(ids)-1)//2)):
                i,j=rng.choice(ids,2,replace=False); add_pair(int(i),int(j),1,split)
    # Negative pairs are assigned to the split of the first endpoint's group.
    for split, gs in [("train",train_groups),("validation",val_groups),("test",test_groups)]:
        candidate_ids=[i for i,g in enumerate(groups) if g in gs]
        if len(candidate_ids)<2: continue
        target_neg=max(100, int(args.negative_pairs * len(gs)/len(unique_groups)))
        made=0; attempts=0
        while made<target_neg and attempts<target_neg*20:
            i,j=map(int,rng.choice(candidate_ids,2,replace=False)); attempts+=1
            if groups[i] == groups[j]: continue
            add_pair(i,j,0,split); made+=1
    pairs=pd.DataFrame(pair_rows)
    if pairs.empty or pairs.groupby("split").label.nunique().min()<2: raise RuntimeError("Pair generation failed to produce both labels in each split")
    out=Path(args.output_dir); out.mkdir(parents=True,exist_ok=True)
    pairs.to_csv(out/"pair_features.csv",index=False)
    train=pairs[pairs.split=="train"]; val=pairs[pairs.split=="validation"]; test=pairs[pairs.split=="test"]
    model=Pipeline([("scale",StandardScaler()),("classifier",LogisticRegression(max_iter=2000,class_weight="balanced",random_state=SEED))])
    model.fit(train[FEATURES],train.label)
    def metrics(frame):
        pred=model.predict(frame[FEATURES]); proba=model.predict_proba(frame[FEATURES])[:,1]
        result={"rows":int(len(frame)),"accuracy":float(accuracy_score(frame.label,pred)),"precision":float(precision_score(frame.label,pred,zero_division=0)),"recall":float(recall_score(frame.label,pred,zero_division=0)),"f1":float(f1_score(frame.label,pred,zero_division=0))}
        if frame.label.nunique()==2: result["roc_auc"]=float(roc_auc_score(frame.label,proba))
        return result
    report={"dataset":"Kaggle Shopee Product Matching","note":"E-commerce same-product proxy; not a lost-and-found benchmark. Encoders frozen; supervised pair scorer trained.","rows_used":int(len(df)),"groups":int(df.label_group.nunique()),"pairs":int(len(pairs)),"features":FEATURES,"encoders":{"sbert":"sentence-transformers/all-MiniLM-L6-v2","clip":"openai/clip-vit-base-patch32","cnn":"torchvision MobileNetV2 pretrained weights"},"split":"label_group-disjoint train/validation/test","train":metrics(train),"validation":metrics(val),"test":metrics(test)}
    joblib.dump({"model":model,"features":FEATURES,"encoders":report["encoders"],"dataset":report["dataset"],"version":1},out/"tracemate_kaggle_pair_scorer.joblib")
    (out/"evaluation_report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2)); print(f"Saved model and report to {out}")

if __name__=="__main__": main()
