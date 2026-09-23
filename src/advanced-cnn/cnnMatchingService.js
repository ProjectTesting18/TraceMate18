const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';

async function requestEmbeddingFromDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('Valid image data URL is required');
  }
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!match) throw new Error('Only JPG, PNG and WEBP data URLs are supported');
  const contentType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  const form = new FormData();
  form.append('image', new Blob([buffer], { type: contentType }), 'tracemate-image');
  const response = await fetch(`${AI_SERVICE_URL}/cv/image-embedding`, { method:'POST', body:form });
  if (!response.ok) throw new Error(`AI service request failed: ${response.status} ${await response.text().catch(()=> '')}`);
  return response.json();
}
function cosineSimilarity(a,b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return null;
  let dot=0; for(let i=0;i<a.length;i++) dot += Number(a[i])*Number(b[i]);
  return Math.max(-1,Math.min(1,dot));
}
function similarityPercentage(cosine) { return cosine === null ? null : ((cosine+1)/2)*100; }
module.exports = { requestEmbeddingFromDataUrl, cosineSimilarity, similarityPercentage };
