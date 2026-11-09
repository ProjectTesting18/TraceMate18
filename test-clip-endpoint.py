import json, base64, urllib.request

with open("data/db.json", encoding="utf-8") as f:
    db = json.load(f)

item = next(x for x in db["lost_items"]
            if str(x.get("image", "")).startswith("data:image/"))

image = base64.b64decode(item["image"].split(",", 1)[1])
text = str(item.get("description", "") or item.get("title", "Cleaning brush"))

boundary = "----TraceMateClipTest"
body = (
    f"--{boundary}\r\n"
    'Content-Disposition: form-data; name="image"; filename="test.jpg"\r\n'
    "Content-Type: image/jpeg\r\n\r\n"
).encode() + image + (
    f"\r\n--{boundary}\r\n"
    'Content-Disposition: form-data; name="text"\r\n\r\n'
    + text + f"\r\n--{boundary}--\r\n"
).encode()

req = urllib.request.Request(
    "http://127.0.0.1:8001/cv/image-text-similarity",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    method="POST"
)

try:
    with urllib.request.urlopen(req, timeout=120) as r:
        result = json.loads(r.read().decode())
        print("HTTP:", r.status)
        print(json.dumps(result, indent=2)[:3000])
except Exception as e:
    print(type(e).__name__ + ":", e)
