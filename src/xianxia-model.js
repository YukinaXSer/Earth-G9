export async function loadCompressedModel(loader,url,resourcePath){
  const response=await fetch(url);
  if(!response.ok||!response.body)throw new Error('Mountain model unavailable: '+url);
  const source=await response.arrayBuffer(),header=new Uint8Array(source,0,Math.min(4,source.byteLength));
  let bytes=source;
  if(header[0]===31&&header[1]===139){
    if(typeof DecompressionStream==='undefined')throw new Error('Native gzip support is required for mountain models');
    bytes=await new Response(new Blob([source]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }else if(header[0]!==103||header[1]!==108||header[2]!==84||header[3]!==70)throw new Error('Invalid mountain model transport: '+url);
  return loader.parseAsync(bytes,resourcePath);
}
