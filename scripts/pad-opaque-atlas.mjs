export function padOpaqueAtlas(pixels,width,height,channels=4){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||![3,4].includes(channels)||pixels.length!==width*height*channels)throw new Error('Invalid atlas dimensions');
  const count=width*height,source=new Int32Array(count).fill(-1),queue=new Int32Array(count),output=new Uint8Array(pixels);
  let head=0,tail=0;
  for(let i=0;i<count;i++)if(Math.max(pixels[i*channels],pixels[i*channels+1],pixels[i*channels+2])>18){source[i]=i;queue[tail++]=i;}
  const visit=(i,origin)=>{if(source[i]!==-1)return;source[i]=origin;queue[tail++]=i;};
  while(head<tail){
    const i=queue[head++],x=i%width,origin=source[i];
    if(x)visit(i-1,origin);if(x+1<width)visit(i+1,origin);
    if(i>=width)visit(i-width,origin);if(i+width<count)visit(i+width,origin);
  }
  for(let i=0;i<count;i++)if(source[i]!==i&&source[i]!==-1)for(let c=0;c<3;c++)output[i*channels+c]=pixels[source[i]*channels+c];
  return output;
}
