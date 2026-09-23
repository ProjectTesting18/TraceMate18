/**
 * src/services/matchingService.js — TraceMate AI Matching Engine (clean rewrite)
 */
const Fuse = require('fuse.js');
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;

const W = { category:25, nameText:20, description:15, location:10, date:10, colorBrand:5, imageLabels:5, cnnImage:10 };
const CONFIDENCE = { high:75, medium:45 };

function scoreCategory(a,b){
  if(!a||!b) return 0;
  if(a===b) return W.category;
  const rel={wallet:['accessories','bag'],bag:['accessories','wallet'],jewellery:['accessories'],books:['documents'],documents:['books']};
  if(rel[a]?.includes(b)||rel[b]?.includes(a)) return Math.round(W.category*0.5);
  return 0;
}
function scoreText(s1,s2,weight){
  if(!s1||!s2) return 0;
  s1=s1.toLowerCase(); s2=s2.toLowerCase();
  if(s1===s2) return weight;
  const t1=tokenizer.tokenize(s1).map(t=>stemmer.stem(t));
  const t2=tokenizer.tokenize(s2).map(t=>stemmer.stem(t));
  if(!t1.length||!t2.length) return 0;
  const set1=new Set(t1), set2=new Set(t2);
  const inter=[...set1].filter(t=>set2.has(t)).length;
  const union=new Set([...set1,...set2]).size;
  const jaccard=union>0?inter/union:0;
  const fuse=new Fuse([s2],{threshold:0.6,includeScore:true});
  const fr=fuse.search(s1);
  const fuseScore=fr.length>0?(1-(fr[0].score||1)):0;
  return Math.round((jaccard*0.6+fuseScore*0.4)*weight);
}
function scoreDesc(d1,d2){
  if(!d1||!d2) return 0;
  const terms=tokenizer.tokenize(d1.toLowerCase()).map(t=>stemmer.stem(t));
  const set2=new Set(tokenizer.tokenize(d2.toLowerCase()).map(t=>stemmer.stem(t)));
  let hits=0; const checked=new Set();
  for(const t of terms){if(!checked.has(t)&&t.length>3){checked.add(t);if(set2.has(t))hits++;}}
  return Math.round((checked.size>0?hits/checked.size:0)*W.description);
}
function scoreLoc(l1,l2){
  if(!l1||!l2) return 0;
  const w1=new Set(tokenizer.tokenize(l1.toLowerCase()).filter(w=>w.length>2));
  const w2=new Set(tokenizer.tokenize(l2.toLowerCase()).filter(w=>w.length>2));
  if(!w1.size||!w2.size) return 0;
  const c=[...w1].filter(w=>w2.has(w)).length;
  return Math.round((c/Math.max(w1.size,w2.size))*W.location);
}
function scoreDate(dLost,dFound){
  if(!dLost||!dFound) return 0;
  const d1=new Date(dLost),d2=new Date(dFound);
  if(isNaN(d1.getTime())||isNaN(d2.getTime())) return 0;
  const diff=(d2-d1)/(1000*60*60*24);
  if(diff<-1) return 0;
  const abs=Math.abs(diff);
  if(abs<=1) return W.date;
  if(abs<=3) return Math.round(W.date*0.8);
  if(abs<=7) return Math.round(W.date*0.5);
  if(abs<=14) return Math.round(W.date*0.25);
  return 0;
}
function scoreColorBrand(l,f){
  let s=0;
  if(l.color&&f.color){const lc=l.color.toLowerCase(),fc=f.color.toLowerCase();if(lc===fc)s+=W.colorBrand*0.6;else if(lc.includes(fc)||fc.includes(lc))s+=W.colorBrand*0.3;}
  if(l.brand&&f.brand){const lb=l.brand.toLowerCase(),fb=f.brand.toLowerCase();if(lb===fb)s+=W.colorBrand*0.4;else if(lb.includes(fb)||fb.includes(lb))s+=W.colorBrand*0.2;}
  return Math.min(Math.round(s),W.colorBrand);
}
function scoreLabels(a=[],b=[]){
  if(!a.length||!b.length) return 0;
  const sa=new Set(a.map(x=>x.toLowerCase())),sb=new Set(b.map(x=>x.toLowerCase()));
  const c=[...sa].filter(x=>sb.has(x)).length;
  return Math.round((c/Math.max(sa.size,sb.size))*W.imageLabels);
}
function scoreCNN(lost,found){
  if(!Array.isArray(lost.imageEmbedding)||!Array.isArray(found.imageEmbedding)) return 0;
  if(lost.imageEmbedding.length!==found.imageEmbedding.length||!lost.imageEmbedding.length) return 0;
  let dot=0;
  for(let i=0;i<lost.imageEmbedding.length;i++) dot+=Number(lost.imageEmbedding[i])*Number(found.imageEmbedding[i]);
  const cosine=Math.max(-1,Math.min(1,dot));
  // Convert cosine [-1,1] to a bounded 0..10 contribution.
  return Math.round(((cosine+1)/2)*W.cnnImage);
}
function buildReasons(scores,l,f){
  const r=[];
  if(scores.category>=W.category) r.push('Same category');
  else if(scores.category>0) r.push('Related category');
  if(scores.name>=W.nameText*0.7) r.push('Item name matches closely');
  if(scores.desc>=W.description*0.6) r.push('Description keywords overlap');
  if(scores.loc>=W.location*0.5) r.push('Similar location');
  if(scores.date>=8) r.push('Dates are very close');
  else if(scores.date>=5) r.push('Dates are within a week');
  if(scores.colorBrand>0) r.push('Color or brand match');
  if(scores.labels>0) r.push('Image labels matched');
  if(scores.cnnImage>0) r.push(`CNN image similarity contributed ${scores.cnnImage}/${W.cnnImage} points`);
  return r;
}

const calculateMatchScore=(lost,found)=>{
  const scores={
    category: scoreCategory(lost.category,found.category),
    name:     scoreText(lost.itemName,found.itemName,W.nameText),
    desc:     scoreDesc(lost.description,found.description),
    loc:      scoreLoc(lost.lastSeenLocation,found.foundLocation),
    date:     scoreDate(lost.dateLost,found.dateFound),
    colorBrand: scoreColorBrand(lost,found),
    labels:   scoreLabels(lost.detectedLabels,found.detectedLabels),
    cnnImage: scoreCNN(lost,found),
  };
  let total=Object.values(scores).reduce((a,b)=>a+b,0);
  if(scores.category===0) total=Math.min(total,35);
  total=Math.min(100,total);
  const confidence=total>=CONFIDENCE.high?'high':total>=CONFIDENCE.medium?'medium':'low';
  return {score:total,confidence,reasons:buildReasons(scores,lost,found),breakdown:scores};
};

const findMatchesForLostItem=async(lostItem,minScore=30)=>{
  const FoundItem=require('../models/FoundItem');
  const items=await FoundItem.find({status:'open',isDeleted:false}).select('+imageEmbedding');
  return items.map(f=>({foundItem:f,...calculateMatchScore(lostItem,f)}))
    .filter(m=>m.score>=minScore).sort((a,b)=>b.score-a.score);
};

const findMatchesForFoundItem=async(foundItem,minScore=30)=>{
  const LostItem=require('../models/LostItem');
  const items=await LostItem.find({status:'open',isDeleted:false}).select('+imageEmbedding');
  return items.map(l=>({lostItem:l,...calculateMatchScore(l,foundItem)}))
    .filter(m=>m.score>=minScore).sort((a,b)=>b.score-a.score);
};

module.exports={calculateMatchScore,findMatchesForLostItem,findMatchesForFoundItem,CONFIDENCE};
