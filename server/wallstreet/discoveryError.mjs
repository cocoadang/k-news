const categories=new Set(['http','network','timeout','body_read','document_too_large','dependency','parse','feed_shape','unexpected']);
const mediaTypes=new Set(['application/atom+xml','application/rss+xml','application/xml','text/xml','text/html','text/plain']);
export function safeDiscoveryFailure(error){
  const d=error?.discovery;
  return {source:'official_youtube_rss',category:categories.has(d?.category)?d.category:'unexpected',
    ...(Number.isInteger(d?.httpStatus)&&d.httpStatus>=100&&d.httpStatus<=599?{httpStatus:d.httpStatus}:{}),
    ...(typeof d?.contentType==='string'?{contentType:mediaTypes.has(d.contentType)?d.contentType:'other'}:{})};
}
export function discoveryError(category,response){
  const error=new Error('public_discovery_unavailable');
  error.discovery=safeDiscoveryFailure({discovery:{category,httpStatus:response?.status,
    ...(response?.headers?.get('content-type')?{contentType:response.headers.get('content-type').split(';')[0].trim().toLowerCase()}:{})}});
  return error;
}
