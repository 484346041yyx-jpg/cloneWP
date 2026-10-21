import sharp from 'sharp';
const dir='D:/cloneWP/runs/2026-10-17-pet-applied-review-15621/comparison-applied';
for(const viewport of ['desktop-wide','desktop-narrow']){
 try{const file=dir+'/'+viewport+'-target.png',meta=await sharp(file).metadata();
 for(const [key,top,height] of [['top',0,1080],['products',1100,1100],['footer',meta.height!-900,900]] as const)await sharp(file).extract({left:0,top:Math.max(0,top),width:meta.width!,height:Math.min(height,meta.height!-Math.max(0,top))}).resize({width:1440}).png().toFile(dir+'/'+viewport+'-'+key+'.png');
 await sharp(file).resize({width:850}).jpeg({quality:88}).toFile(dir+'/'+viewport+'-overview.jpg');
 console.log(JSON.stringify({viewport,width:meta.width,height:meta.height}));
 }catch{console.log(viewport+' not yet captured');}
}
